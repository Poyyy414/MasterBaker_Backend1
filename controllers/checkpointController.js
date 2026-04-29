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

// ════════════════════════════════════════════════════════════════════════════════
// GET STUDENT PROGRESS FOR AN ACTIVITY
// GET /api/student/activities/:activity_id/progress
// ════════════════════════════════════════════════════════════════════════════════
const getActivityProgress = async (req, res) => {
  try {
    const { activity_id } = req.params;
    const student_id = req.user.role_id;

    const [checkpoints] = await db.query(
      `SELECT c.checkpoint_id, c.title, c.order_index,
              sp.score
       FROM checkpoints c
       LEFT JOIN student_progress sp 
         ON sp.checkpoint_id = c.checkpoint_id 
         AND sp.student_id = ?
       WHERE c.activity_id = ?
       ORDER BY c.order_index`,
      [student_id, activity_id]
    );

    for (const cp of checkpoints) {
      const [questions] = await db.query(
        `SELECT q.question_id, q.question_text, q.question_type,
                sa.given_answer, sa.is_correct
         FROM questions q
         LEFT JOIN student_answers sa 
           ON sa.question_id = q.question_id 
           AND sa.student_id = ?
         WHERE q.checkpoint_id = ?
         ORDER BY q.order_index`,
        [student_id, cp.checkpoint_id]
      );

      cp.questions       = questions;
      cp.total_questions = questions.length;
      cp.correct         = questions.filter(q => q.is_correct === 1).length;
      cp.wrong           = questions.filter(q => q.is_correct === 0 && q.given_answer !== null).length;
      cp.unanswered      = questions.filter(q => q.given_answer === null).length;
      cp.score           = cp.correct;
    }

    const totalQuestions  = checkpoints.reduce((sum, cp) => sum + cp.total_questions, 0);
    const totalCorrect    = checkpoints.reduce((sum, cp) => sum + cp.correct, 0);
    const totalWrong      = checkpoints.reduce((sum, cp) => sum + cp.wrong, 0);
    const totalUnanswered = checkpoints.reduce((sum, cp) => sum + cp.unanswered, 0);
    const completed       = checkpoints.every(cp => cp.unanswered === 0);

    return res.status(200).json({
      activity_id: parseInt(activity_id),
      student_id,
      summary: {
        total_questions: totalQuestions,
        correct:         totalCorrect,
        wrong:           totalWrong,
        unanswered:      totalUnanswered,
        score:           `${totalCorrect}/${totalQuestions}`,
        percentage:      totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0,
        completed,
      },
      checkpoints,
    });
  } catch (error) {
    console.error('Get activity progress error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const endActivity = async (req, res) => {
  try {
    const { activity_id } = req.params;
    const student_id = req.user.role_id;

    const [checkpoints] = await db.query(
      `SELECT c.checkpoint_id, c.title, c.order_index,
              sp.score
       FROM checkpoints c
       LEFT JOIN student_progress sp
         ON sp.checkpoint_id = c.checkpoint_id
         AND sp.student_id = ?
       WHERE c.activity_id = ?
       ORDER BY c.order_index`,
      [student_id, activity_id]
    );

    if (checkpoints.length === 0) {
      return res.status(404).json({ message: 'No checkpoints found for this activity.' });
    }

    for (const cp of checkpoints) {
      const [questions] = await db.query(
        `SELECT q.question_id, q.question_text, q.question_type,
                sa.given_answer, sa.is_correct
         FROM questions q
         LEFT JOIN student_answers sa
           ON sa.question_id = q.question_id
           AND sa.student_id = ?
         WHERE q.checkpoint_id = ?
         ORDER BY q.order_index`,
        [student_id, cp.checkpoint_id]
      );

      cp.questions       = questions;
      cp.total_questions = questions.length;
      cp.correct         = questions.filter(q => q.is_correct === 1).length;
      cp.wrong           = questions.filter(q => q.is_correct === 0 && q.given_answer !== null).length;
      cp.unanswered      = questions.filter(q => q.given_answer === null).length;
      cp.score           = cp.correct;
    }

    const totalQuestions  = checkpoints.reduce((sum, cp) => sum + cp.total_questions, 0);
    const totalCorrect    = checkpoints.reduce((sum, cp) => sum + cp.correct, 0);
    const totalWrong      = checkpoints.reduce((sum, cp) => sum + cp.wrong, 0);
    const totalUnanswered = checkpoints.reduce((sum, cp) => sum + cp.unanswered, 0);

    // mark activity as completed in student_progress
    await db.query(
      `INSERT INTO student_progress (student_id, activity_id, checkpoint_id, score)
       VALUES (?, ?, NULL, ?)
       ON DUPLICATE KEY UPDATE score = VALUES(score)`,
      [student_id, activity_id, totalCorrect]
    );

    return res.status(200).json({
      message:     'Activity completed.',
      activity_id: parseInt(activity_id),
      student_id,
      summary: {
        total_questions: totalQuestions,
        correct:         totalCorrect,
        wrong:           totalWrong,
        unanswered:      totalUnanswered,
        score:           `${totalCorrect}/${totalQuestions}`,
        percentage:      totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0,
        passed:          totalQuestions > 0 && Math.round((totalCorrect / totalQuestions) * 100) >= 60,
      },
      checkpoints,
    });
  } catch (error) {
    console.error('End activity error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET NEXT CHECKPOINT QUESTION
// GET /api/student/activities/:activity_id/next-question
// ════════════════════════════════════════════════════════════════════════════════
const getNextQuestion = async (req, res) => {
  try {
    const { activity_id } = req.params;
    const student_id = req.user.role_id;

    // get all checkpoints for this activity
    const [checkpoints] = await db.query(
      `SELECT c.checkpoint_id, c.title, c.order_index
       FROM checkpoints c
       WHERE c.activity_id = ?
       ORDER BY c.order_index`,
      [activity_id]
    );

    if (checkpoints.length === 0) {
      return res.status(404).json({ message: 'No checkpoints found.' });
    }

    // find first checkpoint not yet submitted
    for (const cp of checkpoints) {
      const [progress] = await db.query(
        `SELECT score FROM student_progress
         WHERE student_id = ? AND checkpoint_id = ?`,
        [student_id, cp.checkpoint_id]
      );

      if (progress.length === 0) {
        // this checkpoint has not been answered yet — return its question
        const [questions] = await db.query(
          `SELECT * FROM questions WHERE checkpoint_id = ? ORDER BY order_index`,
          [cp.checkpoint_id]
        );

        for (const q of questions) {
          switch (q.question_type) {
            case 'multiple_choice': {
              const [opts] = await db.query(
                `SELECT option_id, option_text FROM question_options WHERE question_id = ?`,
                [q.question_id]
              );
              q.options = opts;
              break;
            }
            case 'true_or_false': {
              q.options = [{ option_text: 'true' }, { option_text: 'false' }];
              break;
            }
            case 'identification': {
              q.options = [];
              break;
            }
            case 'matching_type': {
              const [pairs] = await db.query(
                `SELECT pair_id, left_item, right_item FROM question_matching_pairs WHERE question_id = ?`,
                [q.question_id]
              );
              q.matching_pairs = pairs;
              break;
            }
          }
        }

        return res.status(200).json({
          activity_id:      parseInt(activity_id),
          checkpoint_id:    cp.checkpoint_id,
          checkpoint_title: cp.title,
          order_index:      cp.order_index,
          total_checkpoints: checkpoints.length,
          is_last:          cp.order_index === checkpoints[checkpoints.length - 1].order_index,
          questions,
        });
      }
    }

    // all checkpoints answered
    return res.status(200).json({
      activity_id:   parseInt(activity_id),
      all_completed: true,
      message:       'All checkpoints completed. Call POST /end to get your summary.',
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
  getActivityProgress,
  endActivity,
  getNextQuestion,
};