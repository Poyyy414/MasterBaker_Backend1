const db = require('../config/db');
const { POINTS, applyTryAgain }         = require('./pointsConfig');
const { getAttemptNumber, awardBadges } = require('./gamificationController');

// REAL game_sequence_steps columns: step_id, recipe_id, description, image_url, correct_order
// recipe_id = game_id from games table

const getSequenceStepsTeacher = async (req, res) => {
  try {
    const { game_id } = req.params;
    const [game] = await db.query(`SELECT game_id, title FROM games WHERE game_id = ?`, [game_id]);
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [steps] = await db.query(
      `SELECT step_id, recipe_id, description, image_url, correct_order
       FROM game_sequence_steps WHERE recipe_id = ? ORDER BY correct_order`,
      [game_id]
    );
    return res.status(200).json({ game_id: game[0].game_id, title: game[0].title, steps });
  } catch (error) {
    console.error('Get sequence steps teacher error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const getSequenceSteps = async (req, res) => {
  try {
    const { game_id } = req.params;
    const [game] = await db.query(
      `SELECT game_id, title, description, time_limit FROM games WHERE game_id = ?`, [game_id]
    );
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    // Return shuffled — correct_order hidden from student
    const [steps] = await db.query(
      `SELECT step_id, description, image_url
       FROM game_sequence_steps WHERE recipe_id = ? ORDER BY RAND()`,
      [game_id]
    );
    return res.status(200).json({
      game_id:     game[0].game_id,
      title:       game[0].title,
      description: game[0].description,
      time_limit:  game[0].time_limit,
      question:    'Arrange the steps in the correct order.',
      steps,
    });
  } catch (error) {
    console.error('Get sequence steps error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const createSequenceStep = async (req, res) => {
  try {
    const { game_id } = req.params;
    const { description, image_url, correct_order } = req.body;

    if (!description || correct_order == null) {
      return res.status(400).json({ message: 'description and correct_order are required.' });
    }

    const [game] = await db.query(`SELECT game_id FROM games WHERE game_id = ?`, [game_id]);
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [result] = await db.query(
      `INSERT INTO game_sequence_steps (recipe_id, description, image_url, correct_order)
       VALUES (?, ?, ?, ?)`,
      [game_id, description, image_url || null, correct_order]
    );
    return res.status(201).json({ message: 'Sequence step created.', step_id: result.insertId });
  } catch (error) {
    console.error('Create sequence step error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const updateSequenceStep = async (req, res) => {
  try {
    const { step_id } = req.params;
    const { description, image_url, correct_order } = req.body;

    const [existing] = await db.query(
      `SELECT step_id FROM game_sequence_steps WHERE step_id = ?`, [step_id]
    );
    if (existing.length === 0) return res.status(404).json({ message: 'Sequence step not found.' });

    await db.query(
      `UPDATE game_sequence_steps SET
         description   = COALESCE(?, description),
         image_url     = COALESCE(?, image_url),
         correct_order = COALESCE(?, correct_order)
       WHERE step_id = ?`,
      [description || null, image_url || null, correct_order ?? null, step_id]
    );
    return res.status(200).json({ message: 'Sequence step updated.' });
  } catch (error) {
    console.error('Update sequence step error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const deleteSequenceStep = async (req, res) => {
  try {
    const { step_id } = req.params;
    const [existing] = await db.query(
      `SELECT step_id FROM game_sequence_steps WHERE step_id = ?`, [step_id]
    );
    if (existing.length === 0) return res.status(404).json({ message: 'Sequence step not found.' });

    await db.query(`DELETE FROM game_sequence_steps WHERE step_id = ?`, [step_id]);
    return res.status(200).json({ message: 'Sequence step deleted.' });
  } catch (error) {
    console.error('Delete sequence step error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const checkSequence = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { game_id } = req.params;
    const user_id     = req.user.user_id;   // use user_id from token, NOT role_id
    const { user_sequence, on_time = false } = req.body;

    if (!Array.isArray(user_sequence) || user_sequence.length === 0) {
      return res.status(400).json({ message: 'user_sequence must be a non-empty array.' });
    }

    const [gtRows] = await conn.query(
      `SELECT game_type_id FROM game_types WHERE code = 'TAG_SEQUENCE'`
    );
    if (!gtRows[0]) return res.status(500).json({ message: "game_type 'TAG_SEQUENCE' not found." });
    const game_type_id  = gtRows[0].game_type_id;
    const recipe_id     = parseInt(game_id);
    const attemptNumber = await getAttemptNumber(conn, user_id, recipe_id, game_type_id);

    const [steps] = await conn.query(
      `SELECT step_id, correct_order FROM game_sequence_steps WHERE recipe_id = ?`, [game_id]
    );

    const correctMap = {};
    steps.forEach(s => { correctMap[s.step_id] = s.correct_order; });

    let correctCount = 0;
    const results = user_sequence.map(({ step_id, user_order }) => {
      const is_correct = correctMap[step_id] === user_order;
      if (is_correct) correctCount++;
      return { step_id, user_order, correct_order: correctMap[step_id], is_correct };
    });

    const total      = steps.length;
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const passed     = percentage >= 60;

    const rawPoints    = correctCount * POINTS.SEQ_CORRECT_STEP
                       + (on_time ? POINTS.SEQ_TIME_ATTACK_BONUS : 0);
    const points_earned = applyTryAgain(rawPoints, attemptNumber);

    const [result] = await conn.query(
      `INSERT INTO game_sessions (user_id, recipe_id, game_type_id, score, total_items, points_earned)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, recipe_id, game_type_id, correctCount, total, points_earned]
    );
    await conn.query(
      `INSERT INTO points_log (user_id, session_id, points_earned) VALUES (?, ?, ?)`,
      [user_id, result.insertId, points_earned]
    );

    const badges_earned = await awardBadges(conn, user_id, correctCount, total);
    await conn.commit();

    return res.status(200).json({
      message: 'Sequence submitted.',
      score: correctCount, total, percentage, passed,
      attempt_number: attemptNumber, try_again_penalty: attemptNumber > 1,
      raw_points: rawPoints, points_earned, on_time,
      results, badges_earned,
    });
  } catch (error) {
    await conn.rollback();
    console.error('Check sequence error:', error);
    return res.status(500).json({ message: 'Server error.' });
  } finally {
    conn.release();
  }
};

module.exports = {
  getSequenceSteps, getSequenceStepsTeacher,
  createSequenceStep, updateSequenceStep, deleteSequenceStep,
  checkSequence,
};