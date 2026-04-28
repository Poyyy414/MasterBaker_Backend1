const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// CREATE ACTIVITY
// POST /api/activities
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
// GET /api/activities
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
// GET ACTIVITY BY ID (with videos only — checkpoints loaded separately)
// GET /api/activities/:id
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
// GET /api/activities/path/:path_id
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
// PUT /api/activities/:id
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
// DELETE /api/activities/:id
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

module.exports = {
  createActivity,
  getAllActivities,
  getActivityById,
  getActivitiesByPath,
  updateActivity,
  deleteActivity,
};