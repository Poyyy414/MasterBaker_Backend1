const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// GET SEQUENCE STEPS BY RECIPE (shuffled for student, ordered for teacher)
// GET /api/teacher/recipes/:recipe_id/sequence-steps
// GET /api/student/recipes/:recipe_id/sequence-steps
// ════════════════════════════════════════════════════════════════════════════════
const getSequenceSteps = async (req, res) => {
  try {
    const { recipe_id } = req.params;
    const isTeacher     = req.user?.role === 'teacher';

    const orderBy = isTeacher ? 'correct_order' : 'RAND()';

    const [rows] = await db.query(
      `SELECT step_id, recipe_id, description, image_url
       ${isTeacher ? ', correct_order' : ''}
       FROM game_sequence_steps
       WHERE recipe_id = ?
       ORDER BY ${orderBy}`,
      [recipe_id]
    );

    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get sequence steps error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// CREATE SEQUENCE STEP
// POST /api/teacher/recipes/:recipe_id/sequence-steps
// Body: { description, image_url, correct_order }
// ════════════════════════════════════════════════════════════════════════════════
const createSequenceStep = async (req, res) => {
  try {
    const { recipe_id }                    = req.params;
    const { description, image_url, correct_order } = req.body;

    if (!description || correct_order == null) {
      return res.status(400).json({ message: 'description and correct_order are required.' });
    }

    const [result] = await db.query(
      `INSERT INTO game_sequence_steps (recipe_id, description, image_url, correct_order)
       VALUES (?, ?, ?, ?)`,
      [recipe_id, description, image_url || null, correct_order]
    );

    return res.status(201).json({
      message: 'Sequence step created.',
      step_id: result.insertId,
    });
  } catch (error) {
    console.error('Create sequence step error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE SEQUENCE STEP
// PUT /api/teacher/sequence-steps/:step_id
// ════════════════════════════════════════════════════════════════════════════════
const updateSequenceStep = async (req, res) => {
  try {
    const { step_id }                               = req.params;
    const { description, image_url, correct_order } = req.body;

    const [existing] = await db.query(
      `SELECT step_id FROM game_sequence_steps WHERE step_id = ?`, [step_id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Sequence step not found.' });
    }

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

// ════════════════════════════════════════════════════════════════════════════════
// DELETE SEQUENCE STEP
// DELETE /api/teacher/sequence-steps/:step_id
// ════════════════════════════════════════════════════════════════════════════════
const deleteSequenceStep = async (req, res) => {
  try {
    const { step_id } = req.params;

    const [existing] = await db.query(
      `SELECT step_id FROM game_sequence_steps WHERE step_id = ?`, [step_id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Sequence step not found.' });
    }

    await db.query(`DELETE FROM game_sequence_steps WHERE step_id = ?`, [step_id]);
    return res.status(200).json({ message: 'Sequence step deleted.' });
  } catch (error) {
    console.error('Delete sequence step error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// CHECK STUDENT SEQUENCE — Tag the Sequence
// POST /api/student/recipes/:recipe_id/sequence-steps/check
// Body: { user_sequence: [{ step_id, user_order }] }
// ════════════════════════════════════════════════════════════════════════════════
const checkSequence = async (req, res) => {
  try {
    const { recipe_id }   = req.params;
    const { user_sequence } = req.body;

    if (!Array.isArray(user_sequence)) {
      return res.status(400).json({ message: 'user_sequence must be an array.' });
    }

    const [steps] = await db.query(
      `SELECT step_id, correct_order FROM game_sequence_steps WHERE recipe_id = ?`,
      [recipe_id]
    );

    const correctMap = {};
    steps.forEach(s => { correctMap[s.step_id] = s.correct_order; });

    let correctCount = 0;
    const results = user_sequence.map(({ step_id, user_order }) => {
      const is_correct = correctMap[step_id] === user_order;
      if (is_correct) correctCount++;
      return { step_id, user_order, correct_order: correctMap[step_id], is_correct };
    });

    const total        = steps.length;
    const points       = Math.round((correctCount / total) * 100);

    return res.status(200).json({
      score:         correctCount,
      total_items:   total,
      points_earned: points,
      results,
    });
  } catch (error) {
    console.error('Check sequence error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  getSequenceSteps,
  createSequenceStep,
  updateSequenceStep,
  deleteSequenceStep,
  checkSequence,
};
