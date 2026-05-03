const db = require('../config/db');

const POINTS_MAP = {
  PICK_INGREDIENT: { per_correct: 100, time_bonus: 50 },
  TAG_SEQUENCE:    { per_correct: 100, time_bonus: 50 },
  SPOT_DIFFERENCE: { per_correct: 100, time_bonus: 50 },
};

// ════════════════════════════════════════════════════════════════════════════════
// CREATE GAME
// POST /api/teacher/games
// ════════════════════════════════════════════════════════════════════════════════
const createGame = async (req, res) => {
  try {
    const {
      path_id, game_type_id, title, description, time_limit,
      display_order = 0, thumbnail_url, difficulty = 'easy',
      level = 1, parent_game_id,
    } = req.body;

    if (!path_id || !game_type_id || !title) {
      return res.status(400).json({ message: 'path_id, game_type_id, and title are required.' });
    }

    const [path] = await db.query(`SELECT path_id FROM paths WHERE path_id = ?`, [path_id]);
    if (path.length === 0) return res.status(404).json({ message: 'Path not found.' });

    const [gameType] = await db.query(
      `SELECT game_type_id, code, name FROM game_types WHERE game_type_id = ?`, [game_type_id]
    );
    if (gameType.length === 0) return res.status(404).json({ message: 'Game type not found.' });

    if (parent_game_id) {
      const [parent] = await db.query(`SELECT game_id FROM games WHERE game_id = ?`, [parent_game_id]);
      if (parent.length === 0) return res.status(404).json({ message: 'Parent game not found.' });
    }

    const [result] = await db.query(
      `INSERT INTO games
         (parent_game_id, path_id, game_type_id, title, description,
          time_limit, display_order, thumbnail_url, difficulty, level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [parent_game_id || null, path_id, game_type_id, title, description || null,
       time_limit || null, display_order, thumbnail_url || null, difficulty, level]
    );

    return res.status(201).json({
      message:   'Game created successfully.',
      game_id:   result.insertId,
      game_type: gameType[0].code,
      difficulty,
      level,
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
        g.display_order, g.order_index, g.thumbnail_url,
        g.difficulty, g.level, g.parent_game_id, g.created_at,
        gt.game_type_id, gt.name AS game_type_name, gt.code AS game_type_code,
        p.path_id, p.name AS path_name
      FROM games g
      JOIN game_types gt ON gt.game_type_id = g.game_type_id
      JOIN paths      p  ON p.path_id       = g.path_id
      ORDER BY p.path_id, g.game_type_id, g.level
    `);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get all games error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET GAME BY ID
// GET /api/teacher/games/:game_id
// GET /api/student/games/:game_id
// ════════════════════════════════════════════════════════════════════════════════
const getGameById = async (req, res) => {
  try {
    const { game_id } = req.params;

    const [rows] = await db.query(`
      SELECT g.*, gt.name AS game_type_name, gt.code AS game_type_code,
             p.name AS path_name
      FROM games g
      JOIN game_types gt ON gt.game_type_id = g.game_type_id
      JOIN paths      p  ON p.path_id       = g.path_id
      WHERE g.game_id = ?
    `, [game_id]);

    if (rows.length === 0) return res.status(404).json({ message: 'Game not found.' });
    return res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Get game by ID error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET GAMES BY PATH (teacher)
// GET /api/teacher/games/path/:path_id
// ════════════════════════════════════════════════════════════════════════════════
const getGamesByPath = async (req, res) => {
  try {
    const { path_id } = req.params;

    const [path] = await db.query(`SELECT path_id, name FROM paths WHERE path_id = ?`, [path_id]);
    if (path.length === 0) return res.status(404).json({ message: 'Path not found.' });

    const [rows] = await db.query(`
      SELECT g.game_id, g.title, g.description, g.time_limit,
             g.display_order, g.thumbnail_url, g.difficulty, g.level, g.parent_game_id,
             gt.game_type_id, gt.name AS game_type_name, gt.code AS game_type_code
      FROM games g
      JOIN game_types gt ON gt.game_type_id = g.game_type_id
      WHERE g.path_id = ?
      ORDER BY g.game_type_id, g.level
    `, [path_id]);

    return res.status(200).json({ path_id: path[0].path_id, path_name: path[0].name, games: rows });
  } catch (error) {
    console.error('Get games by path error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET GAMES BY PATH (student) — shows parent games only with lock/completion status
// GET /api/student/games/path/:path_id
// ════════════════════════════════════════════════════════════════════════════════
const getGamesByPathStudent = async (req, res) => {
  try {
    const { path_id } = req.params;
    const user_id = req.user.role_id;

    const [path] = await db.query(`SELECT path_id, name FROM paths WHERE path_id = ?`, [path_id]);
    if (path.length === 0) return res.status(404).json({ message: 'Path not found.' });

    // get parent games only (parent_game_id IS NULL)
    const [rows] = await db.query(`
      SELECT g.game_id, g.title, g.description, g.time_limit,
             g.thumbnail_url, g.display_order,
             gt.code AS game_type_code, gt.name AS game_type_name,
             gt.game_type_id
      FROM games g
      JOIN game_types gt ON gt.game_type_id = g.game_type_id
      WHERE g.path_id = ? AND g.parent_game_id IS NULL
      ORDER BY gt.game_type_id
    `, [path_id]);

    // get student best session per game
    const gameIds = rows.map(g => g.game_id);
    let sessionMap = {};
    if (gameIds.length > 0) {
      const [sessions] = await db.query(
        `SELECT gs.recipe_id AS game_id,
                MAX(gs.score) AS best_score,
                MAX(gs.total_items) AS best_total,
                MAX(ROUND(gs.score / gs.total_items * 100)) AS best_percentage
         FROM game_sessions gs
         WHERE gs.user_id = ? AND gs.recipe_id IN (?)
         GROUP BY gs.recipe_id`,
        [user_id, gameIds]
      );
      for (const s of sessions) sessionMap[s.game_id] = s;
    }

    const PLAY_MAP = {
      PICK_INGREDIENT: (id) => `/api/student/games/${id}/pick-ingredient`,
      TAG_SEQUENCE:    (id) => `/api/student/games/${id}/sequence`,
      SPOT_DIFFERENCE: (id) => `/api/student/games/${id}/difference`,
    };
    const SUBMIT_MAP = {
      PICK_INGREDIENT: (id) => `/api/student/games/${id}/pick-ingredient/submit`,
      TAG_SEQUENCE:    (id) => `/api/student/games/${id}/sequence/submit`,
      SPOT_DIFFERENCE: (id) => `/api/student/games/${id}/difference/check`,
    };

    // lock rule: Pick must be completed before Sequence, Sequence before Spot
    const games = rows.map((g, i) => {
      const session         = sessionMap[g.game_id] || null;
      const best_percentage = session?.best_percentage ?? 0;
      const is_completed    = best_percentage >= 60;
      const prev_completed  = i === 0
        ? true
        : (sessionMap[rows[i - 1].game_id]?.best_percentage ?? 0) >= 60;
      const pts = POINTS_MAP[g.game_type_code] || { per_correct: 100, time_bonus: 50 };

      return {
        game_id:           g.game_id,
        title:             g.title,
        description:       g.description,
        time_limit:        g.time_limit,
        thumbnail_url:     g.thumbnail_url,
        game_type_code:    g.game_type_code,
        game_type_name:    g.game_type_name,
        points_per_correct: pts.per_correct,
        time_attack_bonus:  pts.time_bonus,
        is_locked:         !prev_completed,
        is_completed,
        best_score:        session?.best_score   ?? 0,
        best_total:        session?.best_total   ?? 0,
        best_percentage,
        play_url:          PLAY_MAP[g.game_type_code]?.(g.game_id) || null,
        submit_url:        SUBMIT_MAP[g.game_type_code]?.(g.game_id) || null,
        levels_url:        `/api/student/games/${g.game_id}/levels`,
      };
    });

    return res.status(200).json({
      path_id:    path[0].path_id,
      path_name:  path[0].name,
      games,
      time_attack: {
        bonus_percent: 50,
        description:   '+50% bonus pts if completed in time',
      },
    });
  } catch (error) {
    console.error('Get games by path student error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET LEVELS BY GAME (student clicks a game card → see Easy/Medium/Hard)
// GET /api/student/games/:game_id/levels
// GET /api/teacher/games/:game_id/levels
// ════════════════════════════════════════════════════════════════════════════════
const getGameLevels = async (req, res) => {
  try {
    const { game_id } = req.params;
    const user_id = req.user?.role_id || null;

    const [parent] = await db.query(`
      SELECT g.*, gt.code AS game_type_code, gt.name AS game_type_name,
             p.name AS path_name
      FROM games g
      JOIN game_types gt ON gt.game_type_id = g.game_type_id
      JOIN paths      p  ON p.path_id       = g.path_id
      WHERE g.game_id = ?
    `, [game_id]);
    if (parent.length === 0) return res.status(404).json({ message: 'Game not found.' });

    // get child levels
    const [levels] = await db.query(
      `SELECT game_id, title, description, thumbnail_url,
              time_limit, display_order, difficulty, level
       FROM games
       WHERE parent_game_id = ?
       ORDER BY level ASC`,
      [game_id]
    );

    // if no children, the game itself is the only level
    const allLevels = levels.length > 0 ? levels : [{
      game_id:       parent[0].game_id,
      title:         parent[0].title,
      description:   parent[0].description,
      thumbnail_url: parent[0].thumbnail_url,
      time_limit:    parent[0].time_limit,
      display_order: parent[0].display_order,
      difficulty:    parent[0].difficulty || 'easy',
      level:         parent[0].level || 1,
    }];

    // get student sessions for all levels
    let sessionMap = {};
    if (user_id) {
      const levelIds = allLevels.map(l => l.game_id);
      if (levelIds.length > 0) {
        const [sessions] = await db.query(
          `SELECT gs.recipe_id AS game_id,
                  MAX(gs.score) AS best_score,
                  MAX(gs.total_items) AS best_total,
                  MAX(ROUND(gs.score / gs.total_items * 100)) AS best_percentage
           FROM game_sessions gs
           WHERE gs.user_id = ? AND gs.recipe_id IN (?)
           GROUP BY gs.recipe_id`,
          [user_id, levelIds]
        );
        for (const s of sessions) sessionMap[s.game_id] = s;
      }
    }

    const PLAY_MAP = {
      PICK_INGREDIENT: (id) => `/api/student/games/${id}/pick-ingredient`,
      TAG_SEQUENCE:    (id) => `/api/student/games/${id}/sequence`,
      SPOT_DIFFERENCE: (id) => `/api/student/games/${id}/difference`,
    };
    const SUBMIT_MAP = {
      PICK_INGREDIENT: (id) => `/api/student/games/${id}/pick-ingredient/submit`,
      TAG_SEQUENCE:    (id) => `/api/student/games/${id}/sequence/submit`,
      SPOT_DIFFERENCE: (id) => `/api/student/games/${id}/difference/check`,
    };

    const code = parent[0].game_type_code;

    const enriched = allLevels.map((g, i) => {
      const session         = sessionMap[g.game_id] || null;
      const best_percentage = session?.best_percentage ?? 0;
      const is_completed    = best_percentage >= 60;
      const prev_completed  = i === 0
        ? true
        : (sessionMap[allLevels[i - 1].game_id]?.best_percentage ?? 0) >= 60;

      return {
        game_id:        g.game_id,
        title:          g.title,
        description:    g.description,
        thumbnail_url:  g.thumbnail_url,
        time_limit:     g.time_limit,
        difficulty:     g.difficulty,
        level:          g.level,
        is_locked:      !prev_completed,
        is_completed,
        best_score:     session?.best_score  ?? 0,
        best_total:     session?.best_total  ?? 0,
        best_percentage,
        play_url:       PLAY_MAP[code]?.(g.game_id)   || null,
        submit_url:     SUBMIT_MAP[code]?.(g.game_id) || null,
      };
    });

    return res.status(200).json({
      game_id:        parent[0].game_id,
      title:          parent[0].title,
      game_type_code: code,
      game_type_name: parent[0].game_type_name,
      path_name:      parent[0].path_name,
      levels:         enriched,
    });
  } catch (error) {
    console.error('Get game levels error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET ALL GAME TYPES
// GET /api/teacher/game-types
// ════════════════════════════════════════════════════════════════════════════════
const getGameTypes = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT game_type_id, code, name, description FROM game_types ORDER BY game_type_id`
    );
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get game types error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE GAME
// PUT /api/teacher/games/:game_id
// ════════════════════════════════════════════════════════════════════════════════
const updateGame = async (req, res) => {
  try {
    const { game_id } = req.params;
    const { title, description, time_limit, display_order,
            order_index, thumbnail_url, difficulty, level } = req.body;

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
        thumbnail_url = COALESCE(?, thumbnail_url),
        difficulty    = COALESCE(?, difficulty),
        level         = COALESCE(?, level)
       WHERE game_id = ?`,
      [title || null, description || null, time_limit ?? null,
       display_order ?? null, order_index ?? null, thumbnail_url || null,
       difficulty || null, level ?? null, game_id]
    );

    return res.status(200).json({ message: 'Game updated successfully.' });
  } catch (error) {
    console.error('Update game error:', error.message);
    return res.status(500).json({ message: error.message });
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
    return res.status(500).json({ message: error.message });
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
  getGameLevels,
};