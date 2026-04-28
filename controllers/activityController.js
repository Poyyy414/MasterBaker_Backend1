const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// TEACHER — CREATE ACTIVITY (with videos + checkpoints + questions + answers)
// ════════════════════════════════════════════════════════════════════════════════
/*
  POST /api/activities
  Body example:
  {
    "path_id": 1,
    "title": "Basic with Babish",
    "order_index": 1,
    "videos": [
      { "label": "Pies | Basic with Babish", "video_url": "https://...", "duration": "5:24", "order_index": 1 }
    ],
    "checkpoints": [
      {
        "title": "Checkpoint #1",
        "order_index": 1,
        "questions": [
          {
            "question_type": "multiple_choice",
            "question_text": "How many minutes to cook a pie?",
            "order_index": 1,
            "options": [
              { "option_text": "30 Minutes", "is_correct": 0 },
              { "option_text": "45 Minutes", "is_correct": 1 },
              { "option_text": "50 Minutes", "is_correct": 0 },
              { "option_text": "35 Minutes", "is_correct": 0 }
            ]
          },
          {
            "question_type": "true_or_false",
            "question_text": "Butter is used in pie crust.",
            "order_index": 2,
            "tf_answer": "true"
          },
          {
            "question_type": "identification",
            "question_text": "What is the main ingredient in a pie crust?",
            "order_index": 3,
            "identification_answer": "Flour"
          },
          {
            "question_type": "matching_type",
            "question_text": "Match the ingredient to its role.",
            "order_index": 4,
            "matching_pairs": [
              { "left_item": "Flour",  "right_item": "Structure" },
              { "left_item": "Butter", "right_item": "Flakiness" },
              { "left_item": "Salt",   "right_item": "Flavor" }
            ]
          }
        ]
      }
    ]
  }
*/
const createActivity = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { path_id, title, order_index = 0, videos = [], checkpoints = [] } = req.body;

    if (!path_id || !title) {
      return res.status(400).json({ message: 'path_id and title are required.' });
    }

    // 1. Insert activity
    const [actResult] = await conn.query(
      `INSERT INTO activities (path_id, title, order_index) VALUES (?, ?, ?)`,
      [path_id, title, order_index]
    );
    const activity_id = actResult.insertId;

    // 2. Insert videos
    for (const v of videos) {
      await conn.query(
        `INSERT INTO activity_videos (activity_id, label, video_url, duration, order_index)
         VALUES (?, ?, ?, ?, ?)`,
        [activity_id, v.label || null, v.video_url, v.duration || null, v.order_index || 0]
      );
    }

    // 3. Insert checkpoints
    for (const cp of checkpoints) {
      const [cpResult] = await conn.query(
        `INSERT INTO checkpoints (activity_id, title, order_index) VALUES (?, ?, ?)`,
        [activity_id, cp.title || null, cp.order_index || 0]
      );
      const checkpoint_id = cpResult.insertId;

      // 4. Insert questions per checkpoint
      for (const q of cp.questions || []) {
        const [qResult] = await conn.query(
          `INSERT INTO questions (checkpoint_id, question_type, question_text, order_index)
           VALUES (?, ?, ?, ?)`,
          [checkpoint_id, q.question_type, q.question_text, q.order_index || 0]
        );
        const question_id = qResult.insertId;

        // 5. Insert answers based on question type
        switch (q.question_type) {
          case 'multiple_choice':
            for (const opt of q.options || []) {
              await conn.query(
                `INSERT INTO question_options (question_id, option_text, is_correct) VALUES (?, ?, ?)`,
                [question_id, opt.option_text, opt.is_correct ? 1 : 0]
              );
            }
            break;

          case 'true_or_false':
            await conn.query(
              `INSERT INTO question_tf_answers (question_id, correct_answer) VALUES (?, ?)`,
              [question_id, q.tf_answer]
            );
            break;

          case 'identification':
            await conn.query(
              `INSERT INTO question_identification_answers (question_id, correct_answer) VALUES (?, ?)`,
              [question_id, q.identification_answer]
            );
            break;

          case 'matching_type':
            for (const pair of q.matching_pairs || []) {
              await conn.query(
                `INSERT INTO question_matching_pairs (question_id, left_item, right_item) VALUES (?, ?, ?)`,
                [question_id, pair.left_item, pair.right_item]
              );
            }
            break;

          default:
            break;
        }
      }
    }

    await conn.commit();
    return res.status(201).json({ message: 'Activity created successfully.', activity_id });

  } catch (error) {
    await conn.rollback();
    console.error('Create activity error:', error);
    return res.status(500).json({ message: 'Server error while creating activity.' });
  } finally {
    conn.release();
  }
};


// ════════════════════════════════════════════════════════════════════════════════
// TEACHER — GET ALL ACTIVITIES (with path info)
// ════════════════════════════════════════════════════════════════════════════════
const getAllActivities = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT a.activity_id, a.title, a.order_index, a.created_at,
             p.path_id, p.name AS path_name
      FROM activities a
      JOIN paths p ON a.path_id = p.path_id
      ORDER BY p.path_id, a.order_index
    `);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get all activities error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};


// ════════════════════════════════════════════════════════════════════════════════
// TEACHER — GET FULL ACTIVITY DETAIL (videos + checkpoints + questions + answers)
// ════════════════════════════════════════════════════════════════════════════════
const getActivityDetail = async (req, res) => {
  try {
    const { id } = req.params;

    // Activity basic info
    const [activity] = await db.query(`
      SELECT a.*, p.name AS path_name
      FROM activities a
      JOIN paths p ON a.path_id = p.path_id
      WHERE a.activity_id = ?
    `, [id]);

    if (activity.length === 0) {
      return res.status(404).json({ message: 'Activity not found.' });
    }

    // Videos
    const [videos] = await db.query(
      `SELECT * FROM activity_videos WHERE activity_id = ? ORDER BY order_index`,
      [id]
    );

    // Checkpoints
    const [checkpoints] = await db.query(
      `SELECT * FROM checkpoints WHERE activity_id = ? ORDER BY order_index`,
      [id]
    );

    // Questions + answers per checkpoint
    for (const cp of checkpoints) {
      const [questions] = await db.query(
        `SELECT * FROM questions WHERE checkpoint_id = ? ORDER BY order_index`,
        [cp.checkpoint_id]
      );

      for (const q of questions) {
        switch (q.question_type) {
          case 'multiple_choice':
            const [options] = await db.query(
              `SELECT * FROM question_options WHERE question_id = ?`, [q.question_id]
            );
            q.options = options;
            break;

          case 'true_or_false':
            const [tf] = await db.query(
              `SELECT * FROM question_tf_answers WHERE question_id = ?`, [q.question_id]
            );
            q.tf_answer = tf[0] || null;
            break;

          case 'identification':
            const [ident] = await db.query(
              `SELECT * FROM question_identification_answers WHERE question_id = ?`, [q.question_id]
            );
            q.identification_answer = ident[0] || null;
            break;

          case 'matching_type':
            const [pairs] = await db.query(
              `SELECT * FROM question_matching_pairs WHERE question_id = ?`, [q.question_id]
            );
            q.matching_pairs = pairs;
            break;
        }
      }

      cp.questions = questions;
    }

    return res.status(200).json({
      ...activity[0],
      videos,
      checkpoints,
    });

  } catch (error) {
    console.error('Get activity detail error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};


// ════════════════════════════════════════════════════════════════════════════════
// TEACHER — UPDATE ACTIVITY (title, order_index only — questions managed separately)
// ════════════════════════════════════════════════════════════════════════════════
const updateActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, order_index } = req.body;

    const [existing] = await db.query(
      `SELECT activity_id FROM activities WHERE activity_id = ?`, [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Activity not found.' });
    }

    await db.query(
      `UPDATE activities SET
        title       = COALESCE(?, title),
        order_index = COALESCE(?, order_index)
       WHERE activity_id = ?`,
      [title || null, order_index ?? null, id]
    );

    return res.status(200).json({ message: 'Activity updated successfully.' });
  } catch (error) {
    console.error('Update activity error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};


// ════════════════════════════════════════════════════════════════════════════════
// TEACHER — DELETE ACTIVITY
// ════════════════════════════════════════════════════════════════════════════════
const deleteActivity = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query(
      `SELECT activity_id FROM activities WHERE activity_id = ?`, [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Activity not found.' });
    }

    await db.query(`DELETE FROM activities WHERE activity_id = ?`, [id]);
    return res.status(200).json({ message: 'Activity deleted successfully.' });
  } catch (error) {
    console.error('Delete activity error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};


// ════════════════════════════════════════════════════════════════════════════════
// STUDENT — GET ACTIVITIES BY PATH (e.g. Cake or Pie)
// ════════════════════════════════════════════════════════════════════════════════
const getActivitiesByPath = async (req, res) => {
  try {
    const { path_id } = req.params;

    const [activities] = await db.query(`
      SELECT a.activity_id, a.title, a.order_index,
             p.name AS path_name
      FROM activities a
      JOIN paths p ON a.path_id = p.path_id
      WHERE a.path_id = ?
      ORDER BY a.order_index
    `, [path_id]);

    // Attach first video thumbnail per activity
    for (const act of activities) {
      const [videos] = await db.query(
        `SELECT * FROM activity_videos WHERE activity_id = ? ORDER BY order_index LIMIT 1`,
        [act.activity_id]
      );
      act.first_video = videos[0] || null;
    }

    return res.status(200).json(activities);
  } catch (error) {
    console.error('Get activities by path error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};


// ════════════════════════════════════════════════════════════════════════════════
// STUDENT — SUBMIT CHECKPOINT ANSWERS + AUTO SCORE
// ════════════════════════════════════════════════════════════════════════════════
/*
  POST /api/activities/checkpoint/:checkpoint_id/submit
  Body:
  {
    "student_id": 1,
    "activity_id": 2,
    "answers": [
      { "question_id": 1, "given_answer": "45 Minutes" },
      { "question_id": 2, "given_answer": "true" },
      { "question_id": 3, "given_answer": "Flour" },
      { "question_id": 4, "given_answer": "Flour:Structure,Butter:Flakiness,Salt:Flavor" }
    ]
  }
  Note: matching_type answer format → "left:right,left:right"
*/
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

      // Get question type
      const [qRows] = await conn.query(
        `SELECT question_type FROM questions WHERE question_id = ?`, [question_id]
      );
      if (qRows.length === 0) continue;

      const { question_type } = qRows[0];
      let is_correct = 0;

      switch (question_type) {
        case 'multiple_choice': {
          const [opt] = await conn.query(
            `SELECT is_correct FROM question_options
             WHERE question_id = ? AND option_text = ?`,
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
          // given_answer format: "Flour:Structure,Butter:Flakiness,Salt:Flavor"
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

      // Save student answer
      await conn.query(
        `INSERT INTO student_answers (student_id, question_id, given_answer, is_correct)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE given_answer = VALUES(given_answer), is_correct = VALUES(is_correct)`,
        [student_id, question_id, given_answer, is_correct]
      );

      results.push({ question_id, is_correct });
    }

    // Update student progress
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
// STUDENT — SAVE VIDEO PROGRESS
// ════════════════════════════════════════════════════════════════════════════════
const saveVideoProgress = async (req, res) => {
  try {
    const { student_id, activity_id, video_id, is_completed } = req.body;

    await db.query(
      `INSERT INTO student_progress (student_id, activity_id, video_id, is_completed)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE video_id = VALUES(video_id), is_completed = VALUES(is_completed)`,
      [student_id, activity_id, video_id, is_completed ? 1 : 0]
    );

    return res.status(200).json({ message: 'Video progress saved.' });
  } catch (error) {
    console.error('Save video progress error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};


// ════════════════════════════════════════════════════════════════════════════════
// STUDENT — GET MY PROGRESS
// ════════════════════════════════════════════════════════════════════════════════
const getStudentProgress = async (req, res) => {
  try {
    const { student_id } = req.params;

    const [progress] = await db.query(`
      SELECT sp.*, a.title AS activity_title, p.name AS path_name,
             v.label AS video_label, c.title AS checkpoint_title
      FROM student_progress sp
      JOIN activities a ON sp.activity_id = a.activity_id
      JOIN paths p ON a.path_id = p.path_id
      LEFT JOIN activity_videos v ON sp.video_id = v.video_id
      LEFT JOIN checkpoints c ON sp.checkpoint_id = c.checkpoint_id
      WHERE sp.student_id = ?
      ORDER BY sp.updated_at DESC
    `, [student_id]);

    return res.status(200).json(progress);
  } catch (error) {
    console.error('Get student progress error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  // Teacher
  createActivity,
  getAllActivities,
  getActivityDetail,
  updateActivity,
  deleteActivity,
  // Student
  getActivitiesByPath,
  submitCheckpoint,
  saveVideoProgress,
  getStudentProgress,
};