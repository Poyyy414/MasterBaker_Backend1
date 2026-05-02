const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// CREATE GAME
// POST /api/teacher/games
// Body: { activity_id, game_type_id, title, description, time_limit, display_order }
// ════════════════════════════════════════════════════════════════════════════════
const createGame = async (req, res) => {
  try {
    const { activity_id, game_type_id, title, description, time_limit, display_order = 0 } = req.body;

    if (!activity_id || !game_type_id || !title) {
      return res.status(400).json({ message: 'activity_id, game_type_id, and title are required.' });
    }

    const [activity] = await db.query(
      `SELECT activity_id FROM activities WHERE activity_id = ?`, [activity_id]
    );
    if (activity.length === 0) return res.status(404).json({ message: 'Activity not found.' });

    const [gameType] = await db.query(
      `SELECT game_type_id FROM game_types WHERE game_type_id = ?`, [game_type_id]
    );
    if (gameType.length === 0) return res.status(404).json({ message: 'Game type not found.' });

    const [result] = await db.query(
      `INSERT INTO games (activity_id, game_type_id, title, description, time_limit, display_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [activity_id, game_type_id, title, description || null, time_limit || null, display_order]
    );

    return res.status(201).json({
      message: 'Game created successfully.',
      game_id: result.insertId,
    });
  } catch (error) {
    console.error('Create game error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET ALL GAMES (teacher)
// GET /api/teacher/games
// ════════════════════════════════════════════════════════════════════════════════
const getAllGames = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT g.game_id, g.title, g.description, g.time_limit, g.display_order,
             gt.name AS game_type_name, gt.code AS game_type_code,
             a.title AS activity_title, a.activity_id
      FROM games g
      JOIN game_types  gt ON gt.game_type_id = g.game_type_id
      JOIN activities   a ON a.activity_id   = g.activity_id
      ORDER BY a.activity_id, g.display_order
    `);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get all games error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET GAME BY ID (teacher)
// GET /api/teacher/games/:game_id
// ════════════════════════════════════════════════════════════════════════════════
const getGameById = async (req, res) => {
  try {
    const { game_id } = req.params;

    const [rows] = await db.query(`
      SELECT g.*, gt.name AS game_type_name, gt.code AS game_type_code,
             a.title AS activity_title
      FROM games g
      JOIN game_types gt ON gt.game_type_id = g.game_type_id
      JOIN activities  a ON a.activity_id   = g.activity_id
      WHERE g.game_id = ?
    `, [game_id]);

    if (rows.length === 0) return res.status(404).json({ message: 'Game not found.' });
    return res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Get game by ID error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET GAMES BY ACTIVITY (teacher)
// GET /api/teacher/activities/:activity_id/games
// ════════════════════════════════════════════════════════════════════════════════
const getGamesByActivity = async (req, res) => {
  try {
    const { activity_id } = req.params;

    const [rows] = await db.query(`
      SELECT g.game_id, g.title, g.description, g.time_limit, g.display_order,
             gt.name AS game_type_name, gt.code AS game_type_code
      FROM games g
      JOIN game_types gt ON gt.game_type_id = g.game_type_id
      WHERE g.activity_id = ?
      ORDER BY g.display_order
    `, [activity_id]);

    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get games by activity error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET ALL GAME TYPES
// GET /api/teacher/game-types
// ════════════════════════════════════════════════════════════════════════════════
const getGameTypes = async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT * FROM game_types ORDER BY game_type_id`);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get game types error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE GAME
// PUT /api/teacher/games/:game_id
// ════════════════════════════════════════════════════════════════════════════════
const updateGame = async (req, res) => {
  try {
    const { game_id } = req.params;
    const { title, description, time_limit, display_order } = req.body;

    const [existing] = await db.query(
      `SELECT game_id FROM games WHERE game_id = ?`, [game_id]
    );
    if (existing.length === 0) return res.status(404).json({ message: 'Game not found.' });

    await db.query(
      `UPDATE games SET
         title         = COALESCE(?, title),
         description   = COALESCE(?, description),
         time_limit    = COALESCE(?, time_limit),
         display_order = COALESCE(?, display_order)
       WHERE game_id = ?`,
      [title || null, description || null, time_limit ?? null, display_order ?? null, game_id]
    );

    return res.status(200).json({ message: 'Game updated successfully.' });
  } catch (error) {
    console.error('Update game error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE GAME
// DELETE /api/teacher/games/:game_id
// ════════════════════════════════════════════════════════════════════════════════
const deleteGame = async (req, res) => {
  try {
    const { game_id } = req.params;

    const [existing] = await db.query(
      `SELECT game_id FROM games WHERE game_id = ?`, [game_id]
    );
    if (existing.length === 0) return res.status(404).json({ message: 'Game not found.' });

    await db.query(`DELETE FROM games WHERE game_id = ?`, [game_id]);
    return res.status(200).json({ message: 'Game deleted successfully.' });
  } catch (error) {
    console.error('Delete game error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  createGame,
  getAllGames,
  getGameById,
  getGamesByActivity,
  getGameTypes,
  updateGame,
  deleteGame,
};