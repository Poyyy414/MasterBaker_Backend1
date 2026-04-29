const db = require('../config/db');
const { POINTS } = require('./pointsConfig'); // ✅ no circular dep

// ════════════════════════════════════════════════════════════════════════════════
// GET SEQUENCE STEPS (student — shuffled, no correct_order)
// GET /api/student/games/:game_id/sequence
// ════════════════════════════════════════════════════════════════════════════════
const getSequenceSteps = async (req, res) => {
  try {
    const { game_id } = req.params;

    const [game] = await db.query(
      `SELECT game_id, title, description, time_limit FROM games WHERE game_id = ?`, [game_id]
    );
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [steps] = await db.query(
      `SELECT step_id, step_text, step_image, question_text
       FROM game_sequence_steps WHERE game_id = ? ORDER BY RAND()`,
      [game_id]
    );

    return res.status(200).json({
      game_id:    game[0].game_id,
      title:      game[0].title,
      time_limit: game[0].time_limit,
      question:   steps[0]?.question_text || 'Arrange the steps in the correct order.',
      steps,
    });
  } catch (error) {
    console.error('Get sequence steps error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET SEQUENCE STEPS (teacher — ordered, with correct_order)
// GET /api/teacher/games/:game_id/sequence
// ════════════════════════════════════════════════════════════════════════════════
const getSequenceStepsTeacher = async (req, res) => {
  try {
    const { game_id } = req.params;

    const [game] = await db.query(`SELECT game_id, title FROM games WHERE game_id = ?`, [game_id]);
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [steps] = await db.query(
      `SELECT step_id, game_id, question_text, step_text, step_image, correct_order
       FROM game_sequence_steps WHERE game_id = ? ORDER BY correct_order`,
      [game_id]
    );

    return res.status(200).json({ game_id: game[0].game_id, title: game[0].title, steps });
  } catch (error) {
    console.error('Get sequence steps teacher error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// SUBMIT SEQUENCE (student)
// POST /api/student/games/:game_id/sequence/submit
//
// Body:
//   user_sequence  [{ step_id, user_order }]
//   recipe_id      INT
//   on_time        BOOL
// ════════════════════════════════════════════════════════════════════════════════
const checkSequence = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { game_id }     = req.params;
    const user_id         = req.user.role_id;
    const { user_sequence, recipe_id, on_time = false } = req.body;

    if (!Array.isArray(user_sequence) || user_sequence.length === 0) {
      return res.status(400).json({ message: 'user_sequence must be a non-empty array.' });
    }
    if (!recipe_id) {
      return res.status(400).json({ message: 'recipe_id is required.' });
    }

    // Resolve game_type_id
    const [gtRows] = await conn.query(
      `SELECT game_type_id FROM game_types WHERE code = 'TAG_SEQUENCE'`
    );
    const game_type_id = gtRows[0].game_type_id;

    // Attempt number
    const [prevSessions] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM game_sessions
       WHERE user_id = ? AND recipe_id = ? AND game_type_id = ?`,
      [user_id, recipe_id, game_type_id]
    );
    const attemptNumber = (prevSessions[0].cnt || 0) + 1;

    // Get correct steps
    const [steps] = await conn.query(
      `SELECT step_id, step_text, correct_order FROM game_sequence_steps WHERE game_id = ?`,
      [game_id]
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

    // ── Points calculation ──────────────────────────────────────────────────
    let rawPoints = correctCount * POINTS.SEQ_CORRECT_STEP;
    rawPoints += on_time ? POINTS.SEQ_TIME_ATTACK_BONUS : POINTS.SEQ_TIME_ATTACK_FAIL;
    const points_earned = attemptNumber > 1
      ? Math.floor(rawPoints * POINTS.TRY_AGAIN_MULTIPLIER)
      : rawPoints;

    // ── Save session ────────────────────────────────────────────────────────
    const [result] = await conn.query(
      `INSERT INTO game_sessions
         (user_id, recipe_id, game_type_id, score, total_items, points_earned)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, recipe_id, game_type_id, correctCount, total, points_earned]
    );
    const session_id = result.insertId;

    await conn.query(
      `INSERT INTO points_log (user_id, session_id, points_earned) VALUES (?, ?, ?)`,
      [user_id, session_id, points_earned]
    );

    await conn.commit();

    return res.status(200).json({
      message:           'Sequence submitted.',
      score:             correctCount,
      total,
      percentage,
      passed,
      attempt_number:    attemptNumber,
      try_again_penalty: attemptNumber > 1,
      raw_points:        rawPoints,
      points_earned,
      on_time,
      results,
    });
  } catch (error) {
    await conn.rollback();
    console.error('Check sequence error:', error);
    return res.status(500).json({ message: 'Server error.' });
  } finally {
    conn.release();
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// CREATE SEQUENCE STEP (teacher)
// POST /api/teacher/games/:game_id/sequence
// ════════════════════════════════════════════════════════════════════════════════
const createSequenceStep = async (req, res) => {
  try {
    const { game_id } = req.params;
    const { question_text, step_text, step_image, correct_order } = req.body;

    if (!step_text || correct_order == null) {
      return res.status(400).json({ message: 'step_text and correct_order are required.' });
    }

    const [game] = await db.query(`SELECT game_id FROM games WHERE game_id = ?`, [game_id]);
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [result] = await db.query(
      `INSERT INTO game_sequence_steps (game_id, question_text, step_text, step_image, correct_order)
       VALUES (?, ?, ?, ?, ?)`,
      [game_id, question_text || null, step_text, step_image || null, correct_order]
    );

    return res.status(201).json({ message: 'Sequence step created.', step_id: result.insertId });
  } catch (error) {
    console.error('Create sequence step error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE SEQUENCE STEP (teacher)
// PUT /api/teacher/sequence-steps/:step_id
// ════════════════════════════════════════════════════════════════════════════════
const updateSequenceStep = async (req, res) => {
  try {
    const { step_id } = req.params;
    const { question_text, step_text, step_image, correct_order } = req.body;

    const [existing] = await db.query(
      `SELECT step_id FROM game_sequence_steps WHERE step_id = ?`, [step_id]
    );
    if (existing.length === 0) return res.status(404).json({ message: 'Sequence step not found.' });

    await db.query(
      `UPDATE game_sequence_steps SET
        question_text = COALESCE(?, question_text),
        step_text     = COALESCE(?, step_text),
        step_image    = COALESCE(?, step_image),
        correct_order = COALESCE(?, correct_order)
       WHERE step_id = ?`,
      [question_text || null, step_text || null, step_image || null, correct_order ?? null, step_id]
    );

    return res.status(200).json({ message: 'Sequence step updated.' });
  } catch (error) {
    console.error('Update sequence step error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE SEQUENCE STEP (teacher)
// DELETE /api/teacher/sequence-steps/:step_id
// ════════════════════════════════════════════════════════════════════════════════
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

module.exports = {
  getSequenceSteps,
  getSequenceStepsTeacher,
  createSequenceStep,
  updateSequenceStep,
  deleteSequenceStep,
  checkSequence,
};