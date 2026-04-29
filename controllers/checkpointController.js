const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// CREATE CHECKPOINT
// POST /api/activities/:activity_id/checkpoints
// ════════════════════════════════════════════════════════════════════════════════
const createCheckpoint = async (req, res) => {
  try {
    const { activity_id } = req.params;
    const { title, order_index = 0 } = req.body;

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
    const { id, activity_id } = req.params;
    const aid = activity_id || id;

    const [checkpoints] = await db.query(
      `SELECT * FROM checkpoints WHERE activity_id = ? ORDER BY order_index`,
      [aid]
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
// ════════════════════════════════════════════════════════════════════════════════
const submitCheckpoint = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { checkpoint_id } = req.params;
    const { student_id, activity_id, answers = [] } = req.body;

    if (!student_id || !activity_id) {
      return res.status(400).json({ message: 'student_id and activity_id are required.' });
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

// ════════════════════════════════════════════════════════════════════════════════
// GET ACTIVITY PROGRESS (for a student)
// GET /api/student/activities/:activity_id/progress
// ════════════════════════════════════════════════════════════════════════════════
const getActivityProgress = async (req, res) => {
  try {
    const { activity_id } = req.params;
    const student_id = req.user?.student_id || req.user?.id;

    if (!student_id) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    // Get all checkpoints for this activity
    const [checkpoints] = await db.query(
      `SELECT checkpoint_id, title, order_index FROM checkpoints WHERE activity_id = ? ORDER BY order_index`,
      [activity_id]
    );

    // Get progress records for this student + activity
    const [progress] = await db.query(
      `SELECT checkpoint_id, score, updated_at
       FROM student_progress
       WHERE student_id = ? AND activity_id = ?`,
      [student_id, activity_id]
    );

    const progressMap = {};
    progress.forEach(p => { progressMap[p.checkpoint_id] = p; });

    const checkpointsWithProgress = checkpoints.map(cp => ({
      ...cp,
      completed: !!progressMap[cp.checkpoint_id],
      score: progressMap[cp.checkpoint_id]?.score ?? null,
      completed_at: progressMap[cp.checkpoint_id]?.updated_at ?? null,
    }));

    const completedCount = checkpointsWithProgress.filter(cp => cp.completed).length;

    return res.status(200).json({
      activity_id: parseInt(activity_id),
      student_id,
      total_checkpoints: checkpoints.length,
      completed_checkpoints: completedCount,
      percent_complete: checkpoints.length > 0
        ? Math.round((completedCount / checkpoints.length) * 100)
        : 0,
      checkpoints: checkpointsWithProgress,
    });
  } catch (error) {
    console.error('Get activity progress error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// END ACTIVITY
// POST /api/student/activities/:activity_id/end
// ════════════════════════════════════════════════════════════════════════════════
const endActivity = async (req, res) => {
  try {
    const { activity_id } = req.params;
    const student_id = req.user?.student_id || req.user?.id;

    if (!student_id) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    // Get total score across all checkpoints for this activity
    const [progressRows] = await db.query(
      `SELECT SUM(score) AS total_score, COUNT(*) AS checkpoints_done
       FROM student_progress
       WHERE student_id = ? AND activity_id = ?`,
      [student_id, activity_id]
    );

    const totalScore = progressRows[0]?.total_score ?? 0;

    // Mark activity as completed (upsert)
    await db.query(
      `INSERT INTO student_activity_completion (student_id, activity_id, total_score, completed_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE total_score = VALUES(total_score), completed_at = NOW()`,
      [student_id, activity_id, totalScore]
    );

    return res.status(200).json({
      message: 'Activity completed.',
      activity_id: parseInt(activity_id),
      student_id,
      total_score: totalScore,
    });
  } catch (error) {
    console.error('End activity error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET NEXT QUESTION
// GET /api/student/activities/:activity_id/next-question
// Returns the next unanswered question for the student in this activity
// ════════════════════════════════════════════════════════════════════════════════
const getNextQuestion = async (req, res) => {
  try {
    const { activity_id } = req.params;
    const student_id = req.user?.student_id || req.user?.id;

    if (!student_id) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    // Get all questions for this activity (ordered by checkpoint then question order)
    const [questions] = await db.query(
      `SELECT q.question_id, q.question_text, q.question_type, q.checkpoint_id,
              c.order_index AS checkpoint_order, q.order_index AS question_order
       FROM questions q
       JOIN checkpoints c ON q.checkpoint_id = c.checkpoint_id
       WHERE c.activity_id = ?
       ORDER BY c.order_index, q.order_index`,
      [activity_id]
    );

    if (questions.length === 0) {
      return res.status(404).json({ message: 'No questions found for this activity.' });
    }

    // Get already-answered question IDs for this student
    const questionIds = questions.map(q => q.question_id);
    const [answered] = await db.query(
      `SELECT question_id FROM student_answers WHERE student_id = ? AND question_id IN (?)`,
      [student_id, questionIds]
    );
    const answeredSet = new Set(answered.map(a => a.question_id));

    // Find first unanswered question
    const nextQuestion = questions.find(q => !answeredSet.has(q.question_id));

    if (!nextQuestion) {
      return res.status(200).json({
        message: 'All questions completed.',
        completed: true,
        next_question: null,
      });
    }

    // Fetch options/pairs depending on type
    switch (nextQuestion.question_type) {
      case 'multiple_choice': {
        const [opts] = await db.query(
          `SELECT option_id, option_text FROM question_options WHERE question_id = ?`,
          [nextQuestion.question_id]
        );
        nextQuestion.options = opts;
        break;
      }
      case 'true_or_false': {
        nextQuestion.options = [{ option_text: 'true' }, { option_text: 'false' }];
        break;
      }
      case 'identification': {
        nextQuestion.options = [];
        break;
      }
      case 'matching_type': {
        const [pairs] = await db.query(
          `SELECT pair_id, left_item, right_item FROM question_matching_pairs WHERE question_id = ?`,
          [nextQuestion.question_id]
        );
        nextQuestion.matching_pairs = pairs;
        break;
      }
    }

    return res.status(200).json({
      completed: false,
      questions_total: questions.length,
      questions_answered: answeredSet.size,
      next_question: nextQuestion,
    });
  } catch (error) {
    console.error('Get next question error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  createCheckpoint,
  getCheckpointsByActivity,
  getCheckpointById,
  updateCheckpoint,
  deleteCheckpoint,
  submitCheckpoint,
  // ✅ Added missing exports that studentRoutes.js requires:
  getActivityProgress,
  endActivity,
  getNextQuestion,
};