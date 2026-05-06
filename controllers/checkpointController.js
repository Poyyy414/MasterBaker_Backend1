const db = require('../config/db');
const { POINTS } = require('./pointsConfig');

const CHECKPOINT_POINTS_PER_CORRECT = POINTS.CHECKPOINT_CORRECT_EASY;

const buildActivityProgressSummary = async (conn, student_id, activity_id) => {
  const [checkpoints] = await conn.query(
    `SELECT c.checkpoint_id, c.title, c.order_index,
            c.video_id, c.trigger_at_seconds AS trigger_timestamp
     FROM checkpoints c
     WHERE c.activity_id = ?
     ORDER BY c.order_index`,
    [activity_id]
  );

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
    cp.submitted       = cp.unanswered === 0 && cp.total_questions > 0;
    cp.score           = cp.correct;
  }

  const totalQuestions  = checkpoints.reduce((s, cp) => s + cp.total_questions, 0);
  const totalCorrect    = checkpoints.reduce((s, cp) => s + cp.correct, 0);
  const totalWrong      = checkpoints.reduce((s, cp) => s + cp.wrong, 0);
  const totalUnanswered = checkpoints.reduce((s, cp) => s + cp.unanswered, 0);
  const completed       = checkpoints.length > 0 && checkpoints.every(cp => cp.submitted);
  const pointsEarned    = totalCorrect * CHECKPOINT_POINTS_PER_CORRECT;

  return {
    checkpoints,
    summary: {
      total_questions: totalQuestions,
      correct: totalCorrect,
      wrong: totalWrong,
      unanswered: totalUnanswered,
      points_per_correct: CHECKPOINT_POINTS_PER_CORRECT,
      points_earned: pointsEarned,
      score: `${totalCorrect}/${totalQuestions}`,
      percentage: totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0,
      completed,
      passed: totalQuestions > 0 && Math.round((totalCorrect / totalQuestions) * 100) >= 60,
    },
  };
};

const persistActivityProgress = async (conn, student_id, activity_id, summary, finalize = false) => {
  const [existingRows] = await conn.query(
    `SELECT progress_id, is_completed, score, completed_at
     FROM student_progress
     WHERE student_id = ? AND activity_id = ?
     FOR UPDATE`,
    [student_id, activity_id]
  );

  const existingProgress = existingRows[0] || null;
  const wasActivityCompleted = existingProgress?.is_completed === 1
    && existingProgress?.score != null
    && existingProgress?.completed_at != null;
  const shouldComplete = finalize && summary.completed;
  const isCompleted = wasActivityCompleted || shouldComplete ? 1 : 0;

  await conn.query(
    `INSERT INTO student_progress
       (student_id, activity_id, checkpoint_id, is_completed, score, completed_at)
     VALUES (?, ?, NULL, ?, ?, IF(? = 1, NOW(), NULL))
     ON DUPLICATE KEY UPDATE
       checkpoint_id = NULL,
       score = VALUES(score),
       is_completed = VALUES(is_completed),
       completed_at = CASE
         WHEN VALUES(is_completed) = 1 THEN COALESCE(completed_at, NOW())
         ELSE NULL
       END`,
    [student_id, activity_id, isCompleted, summary.correct, isCompleted]
  );

  const shouldAwardPoints = shouldComplete && !wasActivityCompleted && summary.points_earned > 0;
  if (shouldAwardPoints) {
    await conn.query(
      `INSERT INTO points_log (user_id, session_id, points_earned)
       VALUES (?, 0, ?)`,
      [student_id, summary.points_earned]
    );
  }

  return {
    saved: true,
    completed_saved: isCompleted === 1,
    points_saved: shouldAwardPoints,
    points_earned: shouldAwardPoints ? summary.points_earned : 0,
    already_completed: wasActivityCompleted,
  };
};

// ════════════════════════════════════════════════════════════════════════════════
// CREATE CHECKPOINT (linked to a video + timestamp)
// POST /api/teacher/activities/:activity_id/checkpoints
// Body: { title, order_index, video_id, trigger_timestamp }
//
// trigger_timestamp = seconds into the video when the video pauses and
//                     questions pop up. e.g. 120 = pause at 2:00
// ════════════════════════════════════════════════════════════════════════════════
const normalizeGivenAnswer = (givenAnswer) => {
  if (Array.isArray(givenAnswer)) return givenAnswer.join(',');

  if (givenAnswer && typeof givenAnswer === 'object') {
    return Object.entries(givenAnswer)
      .map(([left, right]) => `${left}:${right}`)
      .join(',');
  }

  return givenAnswer == null ? '' : String(givenAnswer);
};

const normalizeSubmittedAnswers = (body = {}) => {
  if (Array.isArray(body.answers)) return body.answers;

  if (body.answers && typeof body.answers === 'object') {
    return Object.entries(body.answers).map(([question_id, given_answer]) => ({
      question_id,
      given_answer,
    }));
  }

  if (Array.isArray(body.checkpoints)) {
    return body.checkpoints.flatMap(cp => Array.isArray(cp.answers) ? cp.answers : []);
  }

  return [];
};

const splitAnswerList = (answer) =>
  normalizeGivenAnswer(answer)
    .split(',')
    .map(a => a.toLowerCase().trim())
    .filter(Boolean)
    .sort();

const parseMatchingPairs = (answer) =>
  normalizeGivenAnswer(answer)
    .split(',')
    .map(pair => {
      const separatorIndex = pair.indexOf(':');
      if (separatorIndex === -1) return [null, null];
      return [
        pair.slice(0, separatorIndex).toLowerCase().trim(),
        pair.slice(separatorIndex + 1).toLowerCase().trim(),
      ];
    })
    .filter(([left, right]) => left && right);

const scoreQuestionAnswer = async (conn, question_id, givenAnswer) => {
  const [qRows] = await conn.query(
    `SELECT question_type FROM questions WHERE question_id = ?`,
    [question_id]
  );
  if (qRows.length === 0) return null;

  const { question_type } = qRows[0];
  const normalizedAnswer = normalizeGivenAnswer(givenAnswer);

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
      const givenAnswers = splitAnswerList(normalizedAnswer);
      return JSON.stringify(correctAnswers) === JSON.stringify(givenAnswers) ? 1 : 0;
    }
    case 'true_or_false': {
      const [tf] = await conn.query(
        `SELECT correct_answer FROM question_tf_answers WHERE question_id = ?`,
        [question_id]
      );
      return tf.length > 0 &&
        tf[0].correct_answer.toLowerCase().trim() === normalizedAnswer.toLowerCase().trim() ? 1 : 0;
    }
    case 'identification': {
      const [ident] = await conn.query(
        `SELECT correct_answer FROM question_identification_answers WHERE question_id = ?`,
        [question_id]
      );
      return ident.length > 0 &&
        ident[0].correct_answer.toLowerCase().trim() === normalizedAnswer.toLowerCase().trim() ? 1 : 0;
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

      const givenPairs = parseMatchingPairs(normalizedAnswer);
      let allMatch = givenPairs.length === pairs.length;
      for (const [left, right] of givenPairs) {
        if (correctMap[left] !== right) {
          allMatch = false;
          break;
        }
      }
      return allMatch ? 1 : 0;
    }
    default:
      return 0;
  }
};

const saveActivityAnswers = async (conn, student_id, activity_id, answers) => {
  const [questionRows] = await conn.query(
    `SELECT q.question_id
     FROM questions q
     JOIN checkpoints c ON c.checkpoint_id = q.checkpoint_id
     WHERE c.activity_id = ?`,
    [activity_id]
  );

  if (questionRows.length === 0) {
    return { answers_saved: 0, results: [] };
  }

  const activityQuestionIds = questionRows.map(q => q.question_id);
  const allowedQuestionIds = new Set(activityQuestionIds.map(id => Number(id)));

  await conn.query(
    `DELETE FROM student_answers WHERE student_id = ? AND question_id IN (?)`,
    [student_id, activityQuestionIds]
  );

  let answersSaved = 0;
  const seenQuestionIds = new Set();
  const results = [];

  for (const ans of answers) {
    const question_id = Number(ans.question_id);
    const rawAnswer = ans.given_answer ?? ans.answer ?? ans.selected_answer ?? ans.selected_options ?? ans.value;

    if (!allowedQuestionIds.has(question_id)) {
      results.push({ question_id: ans.question_id, saved: false, reason: 'question_not_in_activity' });
      continue;
    }

    if (seenQuestionIds.has(question_id)) {
      results.push({ question_id, saved: false, reason: 'duplicate_question' });
      continue;
    }
    seenQuestionIds.add(question_id);

    const given_answer = normalizeGivenAnswer(rawAnswer);
    const is_correct = await scoreQuestionAnswer(conn, question_id, given_answer);
    if (is_correct == null) {
      results.push({ question_id, saved: false, reason: 'question_not_found' });
      continue;
    }

    await conn.query(
      `INSERT INTO student_answers (student_id, question_id, given_answer, is_correct)
       VALUES (?, ?, ?, ?)`,
      [student_id, question_id, given_answer, is_correct]
    );

    answersSaved++;
    results.push({ question_id, saved: true, given_answer, is_correct });
  }

  return { answers_saved: answersSaved, results };
};

const createCheckpoint = async (req, res) => {
  try {
    const { activity_id } = req.params;
    const {
      title,
      order_index = 0,
      video_id = null,
      trigger_timestamp,
      trigger_at_seconds,
    } = req.body;
    const triggerAtSeconds = trigger_timestamp ?? trigger_at_seconds ?? 0;

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
      `INSERT INTO checkpoints (activity_id, title, order_index, video_id, trigger_at_seconds)
       VALUES (?, ?, ?, ?, ?)`,
      [activity_id, title || null, order_index, video_id, triggerAtSeconds]
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
      `SELECT c.*, c.trigger_at_seconds AS trigger_timestamp,
              v.video_url, v.title AS video_label, v.duration
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
      `SELECT c.*, c.trigger_at_seconds AS trigger_timestamp,
              v.video_url, v.title AS video_label, v.duration
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
    const { title, order_index, video_id, trigger_timestamp, trigger_at_seconds } = req.body;
    const triggerAtSeconds = trigger_timestamp ?? trigger_at_seconds ?? null;

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
        trigger_at_seconds = COALESCE(?, trigger_at_seconds)
       WHERE checkpoint_id = ?`,
      [title || null, order_index ?? null, video_id ?? null, triggerAtSeconds, checkpoint_id]
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
        `SELECT checkpoint_id, title, order_index,
                trigger_at_seconds AS trigger_timestamp
         FROM checkpoints
         WHERE video_id = ? AND activity_id = ?
         ORDER BY trigger_at_seconds`,
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

    // Get the checkpoint's video_id + trigger_timestamp so frontend knows to resume
    const [cp] = await conn.query(
      `SELECT video_id, trigger_at_seconds AS trigger_timestamp
       FROM checkpoints WHERE checkpoint_id = ?`,
      [checkpoint_id]
    );

    const correct = totalScore;
    const wrong = Math.max(answers.length - correct, 0);
    const pointsEarned = correct * CHECKPOINT_POINTS_PER_CORRECT;
    const { summary } = await buildActivityProgressSummary(conn, student_id, activity_id);
    const progressSave = await persistActivityProgress(conn, student_id, activity_id, summary, false);

    await conn.commit();
    return res.status(200).json({
      message:           'Checkpoint submitted. Video can now resume.',
      score:             totalScore,
      total:             answers.length,
      correct,
      wrong,
      points_per_correct: CHECKPOINT_POINTS_PER_CORRECT,
      points_earned:      pointsEarned,
      activity_summary:   summary,
      progress_saved:     progressSave.saved,
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

    const { checkpoints, summary } = await buildActivityProgressSummary(db, student_id, activity_id);

    return res.status(200).json({
      activity_id:  parseInt(activity_id),
      student_id,
      can_retake:   true,
      summary,
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

    const submittedAnswers = normalizeSubmittedAnswers(req.body || {});
    const answerSave = submittedAnswers.length > 0
      ? await saveActivityAnswers(conn, student_id, activity_id, submittedAnswers)
      : { answers_saved: 0, results: [] };

    const { checkpoints, summary } = await buildActivityProgressSummary(conn, student_id, activity_id);

    if (checkpoints.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'No checkpoints found for this activity.' });
    }

    const saveResult = await persistActivityProgress(conn, student_id, activity_id, summary, true);

    await conn.commit();

    return res.status(200).json({
      message:     summary.completed
        ? 'Activity progress saved.'
        : 'Activity progress saved, but not all questions are answered yet.',
      activity_id: parseInt(activity_id),
      student_id,
      can_retake:  true,
      saved:       saveResult.saved,
      completed_saved: saveResult.completed_saved,
      points_saved:    saveResult.points_saved,
      points_added_to_log: saveResult.points_earned,
      answers_saved:   answerSave.answers_saved,
      answer_results:  answerSave.results,
      summary,
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
              c.video_id, c.trigger_at_seconds AS trigger_timestamp
       FROM checkpoints c
       WHERE c.activity_id = ?
       ORDER BY c.order_index`,
      [activity_id]
    );

    if (checkpoints.length === 0) {
      return res.status(404).json({ message: 'No checkpoints found.' });
    }

    for (const cp of checkpoints) {
      const [[answerState]] = await db.query(
        `SELECT
           COUNT(q.question_id) AS total_questions,
           SUM(CASE WHEN sa.given_answer IS NOT NULL THEN 1 ELSE 0 END) AS answered_questions
         FROM questions q
         LEFT JOIN student_answers sa
           ON sa.question_id = q.question_id AND sa.student_id = ?
         WHERE q.checkpoint_id = ?`,
        [student_id, cp.checkpoint_id]
      );

      if ((answerState.answered_questions || 0) < (answerState.total_questions || 0)) {
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
