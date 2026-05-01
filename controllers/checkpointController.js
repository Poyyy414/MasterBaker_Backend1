const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// CREATE CHECKPOINT (linked to a video + timestamp)
// POST /api/teacher/activities/:activity_id/checkpoints
// Body: { title, order_index, video_id, trigger_timestamp }
//
// trigger_timestamp = seconds into the video when the video pauses and
//                     questions pop up. e.g. 120 = pause at 2:00
// ════════════════════════════════════════════════════════════════════════════════
const createCheckpoint = async (req, res) => {
  try {
    const { activity_id } = req.params;
    const { title, order_index = 0, video_id = null, trigger_timestamp = 0 } = req.body;

    const [activity] = await db.query(
      `SELECT activity_id FROM activities WHERE activity_id = ?`, [activity_id]
    );
    if (activity.length === 0) {
      return res.status(404).json({ message: 'Activity not found.' });
    }

    // If video_id given, verify it belongs to this activity
    if (video_id) {
      const [video] = await db.query(
        `SELECT video_id FROM activity_videos WHERE video_id = ? AND activity_id = ?`,
        [video_id, activity_id]
      );
      if (video.length === 0) {
        return res.status(404).json({ message: 'Video not found in this activity.' });
      }
    }

    const [result] = await db.query(
      `INSERT INTO checkpoints (activity_id, title, order_index, video_id, trigger_timestamp)
       VALUES (?, ?, ?, ?, ?)`,
      [activity_id, title || null, order_index, video_id, trigger_timestamp]
    );

    return res.status(201).json({
      message:       'Checkpoint created successfully.',
      checkpoint_id: result.insertId,
    });
  } catch (error) {
    console.error('Create checkpoint error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET ALL CHECKPOINTS OF AN ACTIVITY (with questions, no correct answers)
// GET /api/student/activities/:id/checkpoints
// GET /api/teacher/activities/:id/checkpoints
// ════════════════════════════════════════════════════════════════════════════════
const getCheckpointsByActivity = async (req, res) => {
  try {
    const { id, activity_id } = req.params;
    const aid = activity_id || id;

    const [activity] = await db.query(
      `SELECT activity_id, title FROM activities WHERE activity_id = ?`, [aid]
    );
    if (activity.length === 0) {
      return res.status(404).json({ message: 'Activity not found.' });
    }

    const [checkpoints] = await db.query(
      `SELECT c.*, v.video_url, v.label AS video_label, v.duration
       FROM checkpoints c
       LEFT JOIN activity_videos v ON c.video_id = v.video_id
       WHERE c.activity_id = ?
       ORDER BY c.order_index`,
      [aid]
    );

    for (const cp of checkpoints) {
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

      cp.questions = questions;
    }

    return res.status(200).json({
      activity_id:    activity[0].activity_id,
      activity_title: activity[0].title,
      checkpoints,
    });
  } catch (error) {
    console.error('Get checkpoints error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET CHECKPOINT BY ID
// GET /api/student/checkpoints/:checkpoint_id
// ════════════════════════════════════════════════════════════════════════════════
const getCheckpointById = async (req, res) => {
  try {
    const { checkpoint_id } = req.params;

    const [rows] = await db.query(
      `SELECT c.*, v.video_url, v.label AS video_label, v.duration
       FROM checkpoints c
       LEFT JOIN activity_videos v ON c.video_id = v.video_id
       WHERE c.checkpoint_id = ?`,
      [checkpoint_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Checkpoint not found.' });
    }

    // attach questions
    const [questions] = await db.query(
      `SELECT * FROM questions WHERE checkpoint_id = ? ORDER BY order_index`,
      [checkpoint_id]
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

    return res.status(200).json({ ...rows[0], questions });
  } catch (error) {
    console.error('Get checkpoint error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE CHECKPOINT
// PUT /api/teacher/checkpoints/:checkpoint_id
// Body: { title, order_index, video_id, trigger_timestamp }
// ════════════════════════════════════════════════════════════════════════════════
const updateCheckpoint = async (req, res) => {
  try {
    const { checkpoint_id } = req.params;
    const { title, order_index, video_id, trigger_timestamp } = req.body;

    const [existing] = await db.query(
      `SELECT checkpoint_id FROM checkpoints WHERE checkpoint_id = ?`, [checkpoint_id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Checkpoint not found.' });
    }

    await db.query(
      `UPDATE checkpoints SET
        title             = COALESCE(?, title),
        order_index       = COALESCE(?, order_index),
        video_id          = COALESCE(?, video_id),
        trigger_timestamp = COALESCE(?, trigger_timestamp)
       WHERE checkpoint_id = ?`,
      [title || null, order_index ?? null, video_id ?? null, trigger_timestamp ?? null, checkpoint_id]
    );

    return res.status(200).json({ message: 'Checkpoint updated successfully.' });
  } catch (error) {
    console.error('Update checkpoint error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE CHECKPOINT
// DELETE /api/teacher/checkpoints/:checkpoint_id
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
// GET ACTIVITY LEARN VIEW
// GET /api/student/activities/:id/learn
//
// Returns videos, each video has its checkpoints with trigger_timestamp so the
// frontend knows exactly when to pause and show questions.
//
// Flow per video:
//   play video → at trigger_timestamp pause → show checkpoint questions →
//   student submits → video resumes → next checkpoint → ... → video ends
// ════════════════════════════════════════════════════════════════════════════════
const getActivityLearnView = async (req, res) => {
  try {
    const { id } = req.params;

    const [activity] = await db.query(`
      SELECT a.*, p.name AS path_name
      FROM activities a
      JOIN paths p ON a.path_id = p.path_id
      WHERE a.activity_id = ?
    `, [id]);

    if (activity.length === 0) {
      return res.status(404).json({ message: 'Activity not found.' });
    }

    // Get all videos
    const [videos] = await db.query(
      `SELECT * FROM activity_videos WHERE activity_id = ? ORDER BY order_index`,
      [id]
    );

    // For each video, attach its checkpoints (ordered by trigger_timestamp)
    for (const video of videos) {
      const [checkpoints] = await db.query(
        `SELECT checkpoint_id, title, order_index, trigger_timestamp
         FROM checkpoints
         WHERE video_id = ? AND activity_id = ?
         ORDER BY trigger_timestamp`,
        [video.video_id, id]
      );

      for (const cp of checkpoints) {
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

        cp.questions = questions;
      }

      video.checkpoints = checkpoints;
    }

    return res.status(200).json({
      ...activity[0],
      videos, // each video has checkpoints[].trigger_timestamp + questions[]
    });
  } catch (error) {
    console.error('Get activity learn view error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// SUBMIT CHECKPOINT ANSWERS + AUTO SCORE
// POST /api/student/checkpoints/:checkpoint_id/submit
// Body: { activity_id, answers: [{ question_id, given_answer }] }
//
// After submit → frontend resumes the video from trigger_timestamp
// Student can retake: old answers cleared on each submit
// matching_type format → "Flour:Structure,Butter:Flakiness,Salt:Flavor"
// ════════════════════════════════════════════════════════════════════════════════
const submitCheckpoint = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { checkpoint_id } = req.params;
    const student_id = req.user.role_id;
    const { activity_id, answers = [] } = req.body;

    if (!activity_id) {
      return res.status(400).json({ message: 'activity_id is required.' });
    }

    // ── Clear old answers for retake support ──────────────────────────────────
    const [questionIds] = await conn.query(
      `SELECT question_id FROM questions WHERE checkpoint_id = ?`, [checkpoint_id]
    );
    if (questionIds.length > 0) {
      const ids = questionIds.map(q => q.question_id);
      await conn.query(
        `DELETE FROM student_answers WHERE student_id = ? AND question_id IN (?)`,
        [student_id, ids]
      );
    }
    await conn.query(
      `DELETE FROM student_progress WHERE student_id = ? AND checkpoint_id = ?`,
      [student_id, checkpoint_id]
    );

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
          const [allOptions] = await conn.query(
            `SELECT option_text, is_correct FROM question_options WHERE question_id = ?`,
            [question_id]
          );
          const correctAnswers = allOptions
            .filter(o => o.is_correct === 1)
            .map(o => o.option_text.toLowerCase().trim())
            .sort();
          const givenAnswers = given_answer.split(',').map(a => a.toLowerCase().trim()).sort();
          is_correct = JSON.stringify(correctAnswers) === JSON.stringify(givenAnswers) ? 1 : 0;
          break;
        }
        case 'true_or_false': {
          const [tf] = await conn.query(
            `SELECT correct_answer FROM question_tf_answers WHERE question_id = ?`,
            [question_id]
          );
          is_correct = tf.length > 0 &&
            tf[0].correct_answer.toLowerCase().trim() === given_answer.toLowerCase().trim() ? 1 : 0;
          break;
        }
        case 'identification': {
          const [ident] = await conn.query(
            `SELECT correct_answer FROM question_identification_answers WHERE question_id = ?`,
            [question_id]
          );
          is_correct = ident.length > 0 &&
            ident[0].correct_answer.toLowerCase().trim() === given_answer.toLowerCase().trim() ? 1 : 0;
          break;
        }
        case 'matching_type': {
          const [pairs] = await conn.query(
            `SELECT left_item, right_item FROM question_matching_pairs WHERE question_id = ?`,
            [question_id]
          );
          const correctMap = {};
          pairs.forEach(p => {
            correctMap[p.left_item.toLowerCase().trim()] = p.right_item.toLowerCase().trim();
          });
          const givenPairs = given_answer.split(',').map(p => p.trim().split(':'));
          let allMatch = givenPairs.length === pairs.length;
          for (const [left, right] of givenPairs) {
            if (!left || !right || correctMap[left.toLowerCase().trim()] !== right.toLowerCase().trim()) {
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
         VALUES (?, ?, ?, ?)`,
        [student_id, question_id, given_answer, is_correct]
      );

      results.push({ question_id, is_correct });
    }

    await conn.query(
      `INSERT INTO student_progress (student_id, activity_id, checkpoint_id, score)
       VALUES (?, ?, ?, ?)`,
      [student_id, activity_id, checkpoint_id, totalScore]
    );

    // Get the checkpoint's video_id + trigger_timestamp so frontend knows to resume
    const [cp] = await conn.query(
      `SELECT video_id, trigger_timestamp FROM checkpoints WHERE checkpoint_id = ?`,
      [checkpoint_id]
    );

    await conn.commit();
    return res.status(200).json({
      message:           'Checkpoint submitted. Video can now resume.',
      score:             totalScore,
      total:             answers.length,
      results,
      resume_video_id:          cp[0]?.video_id || null,
      resume_from_timestamp:    cp[0]?.trigger_timestamp || 0,
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
// GET ACTIVITY PROGRESS
// GET /api/student/activities/:activity_id/progress
// ════════════════════════════════════════════════════════════════════════════════
const getActivityProgress = async (req, res) => {
  try {
    const { activity_id } = req.params;
    const student_id = req.user.role_id;

    const [checkpoints] = await db.query(
      `SELECT c.checkpoint_id, c.title, c.order_index,
              c.video_id, c.trigger_timestamp, sp.score
       FROM checkpoints c
       LEFT JOIN student_progress sp
         ON sp.checkpoint_id = c.checkpoint_id AND sp.student_id = ?
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
           ON sa.question_id = q.question_id AND sa.student_id = ?
         WHERE q.checkpoint_id = ?
         ORDER BY q.order_index`,
        [student_id, cp.checkpoint_id]
      );

      cp.questions       = questions;
      cp.total_questions = questions.length;
      cp.correct         = questions.filter(q => q.is_correct === 1).length;
      cp.wrong           = questions.filter(q => q.is_correct === 0 && q.given_answer !== null).length;
      cp.unanswered      = questions.filter(q => q.given_answer === null).length;
      cp.submitted       = cp.unanswered === 0 && cp.total_questions > 0;
    }

    const totalQuestions = checkpoints.reduce((s, cp) => s + cp.total_questions, 0);
    const totalCorrect   = checkpoints.reduce((s, cp) => s + cp.correct, 0);
    const totalWrong     = checkpoints.reduce((s, cp) => s + cp.wrong, 0);
    const completed      = checkpoints.every(cp => cp.submitted);

    return res.status(200).json({
      activity_id:  parseInt(activity_id),
      student_id,
      can_retake:   true,
      summary: {
        total_questions: totalQuestions,
        correct:         totalCorrect,
        wrong:           totalWrong,
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

// ════════════════════════════════════════════════════════════════════════════════
// END ACTIVITY — returns final summary then clears progress for retake
// POST /api/student/activities/:activity_id/end
// ════════════════════════════════════════════════════════════════════════════════
const endActivity = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { activity_id } = req.params;
    const student_id = req.user.role_id;

    const [checkpoints] = await conn.query(
      `SELECT c.checkpoint_id, c.title, c.order_index,
              c.video_id, c.trigger_timestamp, sp.score
       FROM checkpoints c
       LEFT JOIN student_progress sp
         ON sp.checkpoint_id = c.checkpoint_id AND sp.student_id = ?
       WHERE c.activity_id = ?
       ORDER BY c.order_index`,
      [student_id, activity_id]
    );

    if (checkpoints.length === 0) {
      return res.status(404).json({ message: 'No checkpoints found for this activity.' });
    }

    for (const cp of checkpoints) {
      const [questions] = await conn.query(
        `SELECT q.question_id, q.question_text, q.question_type,
                sa.given_answer, sa.is_correct
         FROM questions q
         LEFT JOIN student_answers sa
           ON sa.question_id = q.question_id AND sa.student_id = ?
         WHERE q.checkpoint_id = ?
         ORDER BY q.order_index`,
        [student_id, cp.checkpoint_id]
      );

      cp.questions       = questions;
      cp.total_questions = questions.length;
      cp.correct         = questions.filter(q => q.is_correct === 1).length;
      cp.wrong           = questions.filter(q => q.is_correct === 0 && q.given_answer !== null).length;
      cp.unanswered      = questions.filter(q => q.given_answer === null).length;
    }

    const totalQuestions  = checkpoints.reduce((s, cp) => s + cp.total_questions, 0);
    const totalCorrect    = checkpoints.reduce((s, cp) => s + cp.correct, 0);
    const totalWrong      = checkpoints.reduce((s, cp) => s + cp.wrong, 0);
    const totalUnanswered = checkpoints.reduce((s, cp) => s + cp.unanswered, 0);
    const percentage      = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

    // ── Clear progress so student can retake ──────────────────────────────────
    const checkpointIds = checkpoints.map(c => c.checkpoint_id);
    if (checkpointIds.length > 0) {
      const [allQuestions] = await conn.query(
        `SELECT question_id FROM questions WHERE checkpoint_id IN (?)`,
        [checkpointIds]
      );
      const questionIds = allQuestions.map(q => q.question_id);

      if (questionIds.length > 0) {
        await conn.query(
          `DELETE FROM student_answers WHERE student_id = ? AND question_id IN (?)`,
          [student_id, questionIds]
        );
      }
      await conn.query(
        `DELETE FROM student_progress WHERE student_id = ? AND checkpoint_id IN (?)`,
        [student_id, checkpointIds]
      );
    }

    await conn.commit();

    return res.status(200).json({
      message:     'Activity completed! You can retake it anytime.',
      activity_id: parseInt(activity_id),
      student_id,
      can_retake:  true,
      summary: {
        total_questions: totalQuestions,
        correct:         totalCorrect,
        wrong:           totalWrong,
        unanswered:      totalUnanswered,
        score:           `${totalCorrect}/${totalQuestions}`,
        percentage,
        passed:          percentage >= 60,
      },
      checkpoints,
    });
  } catch (error) {
    await conn.rollback();
    console.error('End activity error:', error);
    return res.status(500).json({ message: 'Server error.' });
  } finally {
    conn.release();
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET NEXT UNANSWERED CHECKPOINT
// GET /api/student/activities/:activity_id/next-question
// ════════════════════════════════════════════════════════════════════════════════
const getNextQuestion = async (req, res) => {
  try {
    const { activity_id } = req.params;
    const student_id = req.user.role_id;

    const [checkpoints] = await db.query(
      `SELECT c.checkpoint_id, c.title, c.order_index,
              c.video_id, c.trigger_timestamp
       FROM checkpoints c
       WHERE c.activity_id = ?
       ORDER BY c.order_index`,
      [activity_id]
    );

    if (checkpoints.length === 0) {
      return res.status(404).json({ message: 'No checkpoints found.' });
    }

    for (const cp of checkpoints) {
      const [progress] = await db.query(
        `SELECT score FROM student_progress
         WHERE student_id = ? AND checkpoint_id = ?`,
        [student_id, cp.checkpoint_id]
      );

      if (progress.length === 0) {
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
          activity_id:       parseInt(activity_id),
          checkpoint_id:     cp.checkpoint_id,
          checkpoint_title:  cp.title,
          order_index:       cp.order_index,
          video_id:          cp.video_id,
          trigger_timestamp: cp.trigger_timestamp,
          total_checkpoints: checkpoints.length,
          is_last:           cp.order_index === checkpoints[checkpoints.length - 1].order_index,
          questions,
        });
      }
    }

    return res.status(200).json({
      activity_id:   parseInt(activity_id),
      all_completed: true,
      message:       'All checkpoints completed. Call POST /end to finish.',
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
  getActivityLearnView,
};