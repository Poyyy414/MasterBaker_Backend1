const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// CREATE CHECKPOINT
// POST /api/activities/:activity_id/checkpoints
// Body: { title, order_index }
// ════════════════════════════════════════════════════════════════════════════════
const createCheckpoint = async (req, res) => {
  try {
    const { activity_id } = req.params;
    const { title, order_index = 0 } = req.body;

    // Verify activity exists
    const [activity] = await db.query(
      `SELECT activity_id FROM activities WHERE activity_id = ?`, [activity_id]
    );
    if (activity.length === 0) {
      return res.status(404).json({ message: 'Activity not found.' });
    }

    const [result] = await db.query(
      `INSERT INTO checkpoints (activity_id, title, order_index) VALUES (?, ?, ?)`,
      [activity_id, title || null, order_index]
    );

    return res.status(201).json({
      message: 'Checkpoint created successfully.',
      checkpoint_id: result.insertId,
    });
  } catch (error) {
    console.error('Create checkpoint error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET ALL CHECKPOINTS OF AN ACTIVITY
// GET /api/activities/:activity_id/checkpoints
// ════════════════════════════════════════════════════════════════════════════════
const getCheckpointsByActivity = async (req, res) => {
  try {
    const { activity_id } = req.params;

    const [checkpoints] = await db.query(
      `SELECT * FROM checkpoints WHERE activity_id = ? ORDER BY order_index`,
      [activity_id]
    );

    return res.status(200).json(checkpoints);
  } catch (error) {
    console.error('Get checkpoints error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET CHECKPOINT BY ID
// GET /api/checkpoints/:checkpoint_id
// ════════════════════════════════════════════════════════════════════════════════
const getCheckpointById = async (req, res) => {
  try {
    const { checkpoint_id } = req.params;

    const [rows] = await db.query(
      `SELECT * FROM checkpoints WHERE checkpoint_id = ?`, [checkpoint_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Checkpoint not found.' });
    }

    return res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Get checkpoint error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE CHECKPOINT
// PUT /api/checkpoints/:checkpoint_id
// Body: { title, order_index }
// ════════════════════════════════════════════════════════════════════════════════
const updateCheckpoint = async (req, res) => {
  try {
    const { checkpoint_id } = req.params;
    const { title, order_index } = req.body;

    const [existing] = await db.query(
      `SELECT checkpoint_id FROM checkpoints WHERE checkpoint_id = ?`, [checkpoint_id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Checkpoint not found.' });
    }

    await db.query(
      `UPDATE checkpoints SET
        title       = COALESCE(?, title),
        order_index = COALESCE(?, order_index)
       WHERE checkpoint_id = ?`,
      [title || null, order_index ?? null, checkpoint_id]
    );

    return res.status(200).json({ message: 'Checkpoint updated successfully.' });
  } catch (error) {
    console.error('Update checkpoint error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE CHECKPOINT
// DELETE /api/checkpoints/:checkpoint_id
// ════════════════════════════════════════════════════════════════════════════════
const deleteCheckpoint = async (req, res) => {
  try {
    const { checkpoint_id } = req.params;

    const [existing] = await db.query(
      `SELECT checkpoint_id FROM checkpoints WHERE checkpoint_id = ?`, [checkpoint_id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Checkpoint not found.' });
    }

    await db.query(`DELETE FROM checkpoints WHERE checkpoint_id = ?`, [checkpoint_id]);
    return res.status(200).json({ message: 'Checkpoint deleted successfully.' });
  } catch (error) {
    console.error('Delete checkpoint error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// SUBMIT CHECKPOINT ANSWERS + AUTO SCORE
// POST /api/checkpoints/:checkpoint_id/submit
// Body: { student_id, activity_id, answers: [{ question_id, given_answer }] }
// matching_type answer format → "Flour:Structure,Butter:Flakiness,Salt:Flavor"
// ════════════════════════════════════════════════════════════════════════════════
const submitCheckpoint = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { checkpoint_id } = req.params;
    const student_id = req.user.role_id;        // ← from JWT, no longer from body
    const { activity_id, answers = [] } = req.body;

    if (!activity_id) {
      return res.status(400).json({ message: 'activity_id is required.' });
    }

    let totalScore = 0;
    const results = [];

    for (const ans of answers) {
      const { question_id, given_answer } = ans;

      const [qRows] = await conn.query(
        `SELECT question_type FROM questions WHERE question_id = ?`, [question_id]
      );
      if (qRows.length === 0) continue;

      const { question_type } = qRows[0];
      let is_correct = 0;

      switch (question_type) {
        case 'multiple_choice': {
          const [opt] = await conn.query(
            `SELECT is_correct FROM question_options WHERE question_id = ? AND option_text = ?`,
            [question_id, given_answer]
          );
          is_correct = opt.length > 0 && opt[0].is_correct === 1 ? 1 : 0;
          break;
        }
        case 'true_or_false': {
          const [tf] = await conn.query(
            `SELECT correct_answer FROM question_tf_answers WHERE question_id = ?`,
            [question_id]
          );
          is_correct = tf.length > 0 && tf[0].correct_answer === given_answer.toLowerCase() ? 1 : 0;
          break;
        }
        case 'identification': {
          const [ident] = await conn.query(
            `SELECT correct_answer FROM question_identification_answers WHERE question_id = ?`,
            [question_id]
          );
          is_correct = ident.length > 0 &&
            ident[0].correct_answer.toLowerCase() === given_answer.toLowerCase() ? 1 : 0;
          break;
        }
        case 'matching_type': {
          const [pairs] = await conn.query(
            `SELECT left_item, right_item FROM question_matching_pairs WHERE question_id = ?`,
            [question_id]
          );
          const correctMap = {};
          pairs.forEach(p => { correctMap[p.left_item.toLowerCase()] = p.right_item.toLowerCase(); });
          const givenPairs = given_answer.split(',').map(p => p.trim().split(':'));
          let allMatch = givenPairs.length === pairs.length;
          for (const [left, right] of givenPairs) {
            if (!left || !right || correctMap[left.toLowerCase()] !== right.toLowerCase()) {
              allMatch = false;
              break;
            }
          }
          is_correct = allMatch ? 1 : 0;
          break;
        }
      }

      if (is_correct) totalScore++;

      await conn.query(
        `INSERT INTO student_answers (student_id, question_id, given_answer, is_correct)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE given_answer = VALUES(given_answer), is_correct = VALUES(is_correct)`,
        [student_id, question_id, given_answer, is_correct]
      );

      results.push({ question_id, is_correct });
    }

    await conn.query(
      `INSERT INTO student_progress (student_id, activity_id, checkpoint_id, score)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE checkpoint_id = VALUES(checkpoint_id), score = VALUES(score)`,
      [student_id, activity_id, checkpoint_id, totalScore]
    );

    await conn.commit();
    return res.status(200).json({
      message: 'Checkpoint submitted.',
      score: totalScore,
      total: answers.length,
      results,
    });
  } catch (error) {
    await conn.rollback();
    console.error('Submit checkpoint error:', error);
    return res.status(500).json({ message: 'Server error during submission.' });
  } finally {
    conn.release();
  }
};
module.exports = {
  createCheckpoint,
  getCheckpointsByActivity,
  getCheckpointById,
  updateCheckpoint,
  deleteCheckpoint,
  submitCheckpoint,
};