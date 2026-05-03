const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// CREATE GAME
// POST /api/teacher/games
// Body: { path_id, game_type_id, title, description, time_limit, display_order, thumbnail_url }
// ════════════════════════════════════════════════════════════════════════════════
const createGame = async (req, res) => {
  try {
    const {
      path_id, game_type_id, title, description,
      time_limit = 60, display_order = 0, order_index = 0, thumbnail_url,
    } = req.body;

    if (!path_id || !game_type_id || !title) {
      return res.status(400).json({ message: 'path_id, game_type_id, and title are required.' });
    }

    // Verify path exists
    const [path] = await db.query(
      `SELECT path_id FROM paths WHERE path_id = ?`, [path_id]
    );
    if (path.length === 0) return res.status(404).json({ message: 'Path not found.' });

    // Verify game_type exists — only check game_type_id column
    const [gameType] = await db.query(
      `SELECT game_type_id, code, name FROM game_types WHERE game_type_id = ?`, [game_type_id]
    );
    if (gameType.length === 0) return res.status(404).json({ message: 'Game type not found.' });

    const [result] = await db.query(
      `INSERT INTO games
         (path_id, game_type_id, title, description, time_limit, display_order, order_index, thumbnail_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [path_id, game_type_id, title, description || null,
       time_limit, display_order, order_index, thumbnail_url || null]
    );

    return res.status(201).json({
      message:      'Game created successfully.',
      game_id:      result.insertId,
      game_type:    gameType[0].code,
    });
  } catch (error) {
    console.error('Create game error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET ALL GAMES (teacher)
// GET /api/teacher/games
// ════════════════════════════════════════════════════════════════════════════════
const getAllGames = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        g.game_id, g.title, g.description, g.time_limit,
        g.display_order, g.order_index, g.thumbnail_url, g.created_at,
        gt.game_type_id, gt.name  AS game_type_name, gt.code AS game_type_code,
        p.path_id,       p.name  AS path_name
      FROM games g
      JOIN game_types gt ON gt.game_type_id = g.game_type_id
      JOIN paths      p  ON p.path_id       = g.path_id
      ORDER BY p.path_id, g.display_order
    `);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get all games error:', error.message);
    return res.status(500).json({ message: error.message });
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
      SELECT
        g.*,
        gt.name  AS game_type_name,
        gt.code  AS game_type_code,
        gt.description AS game_type_description,
        p.name   AS path_name
      FROM games g
      JOIN game_types gt ON gt.game_type_id = g.game_type_id
      JOIN paths      p  ON p.path_id       = g.path_id
      WHERE g.game_id = ?
    `, [game_id]);

    if (rows.length === 0) return res.status(404).json({ message: 'Game not found.' });
    return res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Get game by ID error:', error.message);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET GAMES BY PATH (teacher)
// GET /api/teacher/games/path/:path_id
// ════════════════════════════════════════════════════════════════════════════════
const getGamesByPath = async (req, res) => {
  try {
    const { path_id } = req.params;

    const [path] = await db.query(
      `SELECT path_id, name FROM paths WHERE path_id = ?`, [path_id]
    );
    if (path.length === 0) return res.status(404).json({ message: 'Path not found.' });

    const [rows] = await db.query(`
      SELECT
        g.game_id, g.title, g.description, g.time_limit,
        g.display_order, g.order_index, g.thumbnail_url,
        gt.game_type_id, gt.name AS game_type_name, gt.code AS game_type_code
      FROM games g
      JOIN game_types gt ON gt.game_type_id = g.game_type_id
      WHERE g.path_id = ?
      ORDER BY g.display_order
    `, [path_id]);

    return res.status(200).json({
      path_id:   path[0].path_id,
      path_name: path[0].name,
      games:     rows,
    });
  } catch (error) {
    console.error('Get games by path error:', error.message);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET ALL GAME TYPES
// GET /api/teacher/game-types
// Returns: game_type_id, code, name, description
// ════════════════════════════════════════════════════════════════════════════════
const getGameTypes = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT game_type_id, code, name, description FROM game_types ORDER BY game_type_id`
    );
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get game types error:', error.message);
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
    const { title, description, time_limit, display_order, order_index, thumbnail_url } = req.body;

    const [existing] = await db.query(
      `SELECT game_id FROM games WHERE game_id = ?`, [game_id]
    );
    if (existing.length === 0) return res.status(404).json({ message: 'Game not found.' });

    await db.query(
      `UPDATE games SET
        title         = COALESCE(?, title),
        description   = COALESCE(?, description),
        time_limit    = COALESCE(?, time_limit),
        display_order = COALESCE(?, display_order),
        order_index   = COALESCE(?, order_index),
        thumbnail_url = COALESCE(?, thumbnail_url)
       WHERE game_id = ?`,
      [title || null, description || null, time_limit ?? null,
       display_order ?? null, order_index ?? null, thumbnail_url || null, game_id]
    );

    return res.status(200).json({ message: 'Game updated successfully.' });
  } catch (error) {
    console.error('Update game error:', error.message);
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
    console.error('Delete game error:', error.message);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET GAMES BY PATH FOR STUDENT
// GET /api/student/games/path/:path_id
// Returns games without admin fields
// ════════════════════════════════════════════════════════════════════════════════
const getGamesByPathStudent = async (req, res) => {
  try {
    const { path_id } = req.params;

    const [path] = await db.query(
      `SELECT path_id, name FROM paths WHERE path_id = ?`, [path_id]
    );
    if (path.length === 0) return res.status(404).json({ message: 'Path not found.' });

    const [rows] = await db.query(`
      SELECT
        g.game_id, g.title, g.description, g.time_limit,
        g.display_order, g.thumbnail_url,
        gt.code AS game_type_code, gt.name AS game_type_name
      FROM games g
      JOIN game_types gt ON gt.game_type_id = g.game_type_id
      WHERE g.path_id = ?
      ORDER BY g.display_order
    `, [path_id]);

    return res.status(200).json({
      path_id:   path[0].path_id,
      path_name: path[0].name,
      games:     rows,
    });
  } catch (error) {
    console.error('Get games by path student error:', error.message);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  createGame,
  getAllGames,
  getGameById,
  getGamesByPath,
  getGamesByPathStudent,
  getGameTypes,
  updateGame,
  deleteGame,
};