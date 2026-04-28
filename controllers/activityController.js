const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// CREATE ACTIVITY
// POST /api/teacher/activities
// Body: { path_id, title, order_index }
// ════════════════════════════════════════════════════════════════════════════════
const createActivity = async (req, res) => {
  try {
    const { path_id, title, order_index = 0 } = req.body;

    if (!path_id || !title) {
      return res.status(400).json({ message: 'path_id and title are required.' });
    }

    const [result] = await db.query(
      `INSERT INTO activities (path_id, title, order_index) VALUES (?, ?, ?)`,
      [path_id, title, order_index]
    );

    return res.status(201).json({
      message: 'Activity created successfully.',
      activity_id: result.insertId,
    });
  } catch (error) {
    console.error('Create activity error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET ALL ACTIVITIES
// GET /api/teacher/activities
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
// GET ACTIVITY BY ID (with videos only)
// GET /api/teacher/activities/:id
// ════════════════════════════════════════════════════════════════════════════════
const getActivityById = async (req, res) => {
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

    const [videos] = await db.query(
      `SELECT * FROM activity_videos WHERE activity_id = ? ORDER BY order_index`,
      [id]
    );

    return res.status(200).json({ ...activity[0], videos });
  } catch (error) {
    console.error('Get activity error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET ACTIVITIES BY PATH
// GET /api/student/activities/path/:path_id
// ════════════════════════════════════════════════════════════════════════════════
const getActivitiesByPath = async (req, res) => {
  try {
    const { path_id } = req.params;

    const [activities] = await db.query(`
      SELECT a.activity_id, a.title, a.order_index, p.name AS path_name
      FROM activities a
      JOIN paths p ON a.path_id = p.path_id
      WHERE a.path_id = ?
      ORDER BY a.order_index
    `, [path_id]);

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
// UPDATE ACTIVITY
// PUT /api/teacher/activities/:id
// Body: { title, order_index }
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
// DELETE ACTIVITY
// DELETE /api/teacher/activities/:id
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
// CREATE VIDEO
// POST /api/teacher/activities/:id/videos
// Body: { video_url, title, order_index }
// ════════════════════════════════════════════════════════════════════════════════
const createVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const { video_url, title, order_index = 0 } = req.body;

    if (!video_url) {
      return res.status(400).json({ message: 'video_url is required.' });
    }

    const [activity] = await db.query(
      `SELECT activity_id FROM activities WHERE activity_id = ?`, [id]
    );
    if (activity.length === 0) {
      return res.status(404).json({ message: 'Activity not found.' });
    }

    const [result] = await db.query(
      `INSERT INTO activity_videos (activity_id, video_url, title, order_index) VALUES (?, ?, ?, ?)`,
      [id, video_url, title || null, order_index]
    );

    return res.status(201).json({
      message: 'Video added successfully.',
      video_id: result.insertId,
    });
  } catch (error) {
    console.error('Create video error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE VIDEO
// DELETE /api/teacher/videos/:video_id
// ════════════════════════════════════════════════════════════════════════════════
const deleteVideo = async (req, res) => {
  try {
    const { video_id } = req.params;

    const [existing] = await db.query(
      `SELECT video_id FROM activity_videos WHERE video_id = ?`, [video_id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Video not found.' });
    }

    await db.query(`DELETE FROM activity_videos WHERE video_id = ?`, [video_id]);
    return res.status(200).json({ message: 'Video deleted successfully.' });
  } catch (error) {
    console.error('Delete video error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET VIDEOS BY ACTIVITY
// GET /api/student/activities/:id/videos
// ════════════════════════════════════════════════════════════════════════════════
const getVideosByActivity = async (req, res) => {
  try {
    const { id } = req.params;

    const [activity] = await db.query(
      `SELECT activity_id, title FROM activities WHERE activity_id = ?`, [id]
    );
    if (activity.length === 0) {
      return res.status(404).json({ message: 'Activity not found.' });
    }

    const [videos] = await db.query(
      `SELECT * FROM activity_videos WHERE activity_id = ? ORDER BY order_index`,
      [id]
    );

    return res.status(200).json({
      activity_id:    activity[0].activity_id,
      activity_title: activity[0].title,
      videos,
    });
  } catch (error) {
    console.error('Get videos error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET SINGLE VIDEO BY ID
// GET /api/student/videos/:video_id
// ════════════════════════════════════════════════════════════════════════════════
const getVideoById = async (req, res) => {
  try {
    const { video_id } = req.params;

    const [rows] = await db.query(
      `SELECT * FROM activity_videos WHERE video_id = ?`, [video_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Video not found.' });
    }

    return res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Get video error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET ACTIVITY LEARN VIEW (video + checkpoints + questions, no correct answers)
// GET /api/student/activities/:id/learn
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

    const [videos] = await db.query(
      `SELECT * FROM activity_videos WHERE activity_id = ? ORDER BY order_index`,
      [id]
    );

    const [checkpoints] = await db.query(
      `SELECT * FROM checkpoints WHERE activity_id = ? ORDER BY order_index`,
      [id]
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
      ...activity[0],
      videos,
      checkpoints,
    });
  } catch (error) {
    console.error('Get activity learn view error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  createActivity,
  getAllActivities,
  getActivityById,
  getActivitiesByPath,
  updateActivity,
  deleteActivity,
  createVideo,
  deleteVideo,
  getVideosByActivity,
  getVideoById,
  getActivityLearnView,
};