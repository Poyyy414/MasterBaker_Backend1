const db = require('../config/db');

const POINTS_MAP = {
  PICK_INGREDIENT: { per_correct: 100, time_bonus: 50 },
  TAG_SEQUENCE:    { per_correct: 100, time_bonus: 50 },
  SPOT_DIFFERENCE: { per_correct: 100, time_bonus: 50 },
};

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

// ════════════════════════════════════════════════════════════════════════════════
// GET ALL PATHS
// GET /api/student/paths
// GET /api/teacher/paths
// ════════════════════════════════════════════════════════════════════════════════
const getPaths = async (req, res) => {
  try {
    const [paths] = await db.query(
      `SELECT path_id, name, description, image_url FROM paths ORDER BY path_id`
    );
    return res.status(200).json(paths);
  } catch (error) {
    console.error('Get paths error:', error.message);
    return res.status(500).json({ message: 'Server error.' });
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
// CREATE GAME
// POST /api/teacher/games
// ════════════════════════════════════════════════════════════════════════════════
const createGame = async (req, res) => {
  try {
    const {
      path_id, game_type_id, title, description, time_limit,
      display_order = 0, thumbnail_url, difficulty,
      level, parent_game_id,
    } = req.body;

    if (!path_id || !game_type_id || !title) {
      return res.status(400).json({ message: 'path_id, game_type_id, and title are required.' });
    }

    const [path] = await db.query(`SELECT path_id FROM paths WHERE path_id = ?`, [path_id]);
    if (path.length === 0) return res.status(404).json({ message: 'Path not found.' });

    const [gameType] = await db.query(
      `SELECT game_type_id, code FROM game_types WHERE game_type_id = ?`, [game_type_id]
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
       time_limit || null, display_order, thumbnail_url || null,
       difficulty || null, level || null]
    );

    return res.status(201).json({
      message:   'Game created successfully.',
      game_id:   result.insertId,
      game_type: gameType[0].code,
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
      ORDER BY p.path_id, g.game_type_id, g.display_order
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
// GET GAMES BY PATH (teacher) — returns all games including children
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
      ORDER BY gt.game_type_id, g.display_order
    `, [path_id]);

    return res.status(200).json({ path_id: path[0].path_id, path_name: path[0].name, games: rows });
  } catch (error) {
    console.error('Get games by path error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET GAMES BY PATH (student) — returns PARENT games only (the 3 game type cards)
// GET /api/student/games/path/:path_id
// ════════════════════════════════════════════════════════════════════════════════
const getGamesByPathStudent = async (req, res) => {
  try {
    const { path_id } = req.params;
    const user_id = req.user.role_id;

    const [path] = await db.query(`SELECT path_id, name FROM paths WHERE path_id = ?`, [path_id]);
    if (path.length === 0) return res.status(404).json({ message: 'Path not found.' });

    // ── ONLY parent games (parent_game_id IS NULL) ─────────────────────────────
    const [rows] = await db.query(`
      SELECT g.game_id, g.title, g.description, g.time_limit,
             g.thumbnail_url, g.display_order,
             gt.code AS game_type_code, gt.name AS game_type_name,
             gt.game_type_id
      FROM games g
      JOIN game_types gt ON gt.game_type_id = g.game_type_id
      WHERE g.path_id = ? AND g.parent_game_id IS NULL
      ORDER BY g.display_order ASC
    `, [path_id]);

    // ── Get student best session per parent game ────────────────────────────────
    // For parent game completion: check if ANY child level has been passed
    const enriched = [];
    let previousPassed = true;

    for (let i = 0; i < rows.length; i++) {
      const g = rows[i];

      // Get child game IDs
      const [children] = await db.query(
        `SELECT game_id FROM games WHERE parent_game_id = ?`, [g.game_id]
      );
      const childIds = children.map(c => c.game_id);

      // Check if student has passed any child level (>= 60%)
      let is_completed = false;
      let best_score = 0, best_total = 0, best_percentage = 0;

      if (childIds.length > 0) {
        const [sessions] = await db.query(
          `SELECT MAX(ROUND(gs.score / gs.total_items * 100)) AS best_pct,
                  MAX(gs.score) AS best_score,
                  MAX(gs.total_items) AS best_total
           FROM game_sessions gs
           WHERE gs.user_id = ? AND gs.recipe_id IN (?)`,
          [user_id, childIds]
        );
        best_percentage = sessions[0]?.best_pct   ?? 0;
        best_score      = sessions[0]?.best_score  ?? 0;
        best_total      = sessions[0]?.best_total  ?? 0;
        is_completed    = best_percentage >= 60;
      }

      const pts = POINTS_MAP[g.game_type_code] || { per_correct: 100, time_bonus: 50 };

      enriched.push({
        game_id:            g.game_id,
        title:              g.title,
        description:        g.description,
        time_limit:         g.time_limit,
        thumbnail_url:      g.thumbnail_url,
        game_type_code:     g.game_type_code,
        game_type_name:     g.game_type_name,
        points_per_correct: pts.per_correct,
        time_attack_bonus:  pts.time_bonus,
        is_locked:          !previousPassed,
        is_completed,
        best_score,
        best_total,
        best_percentage,
        levels_url:         `/api/student/games/${g.game_id}/levels`,
      });

      previousPassed = is_completed;
    }

    return res.status(200).json({
      path_id:   path[0].path_id,
      path_name: path[0].name,
      games:     enriched,
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
// GET LEVELS BY GAME — student clicks a game card → Easy/Medium/Hard
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

    // ── Only child levels ──────────────────────────────────────────────────────
    const [levels] = await db.query(
      `SELECT game_id, title, description, thumbnail_url,
              time_limit, display_order, difficulty, level
       FROM games
       WHERE parent_game_id = ?
       ORDER BY display_order ASC`,
      [game_id]
    );

    if (levels.length === 0) {
      return res.status(200).json({
        game_id:        parent[0].game_id,
        title:          parent[0].title,
        game_type_code: parent[0].game_type_code,
        game_type_name: parent[0].game_type_name,
        path_name:      parent[0].path_name,
        levels:         [],
        message:        'No levels created yet for this game.',
      });
    }

    // ── Student sessions per level ─────────────────────────────────────────────
    let sessionMap = {};
    if (user_id) {
      const levelIds = levels.map(l => l.game_id);
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

    const code = parent[0].game_type_code;

    const enriched = levels.map((g, i) => {
      const session         = sessionMap[g.game_id] || null;
      const best_percentage = session?.best_percentage ?? 0;
      const is_completed    = best_percentage >= 60;
      // level 1 always unlocked, next unlocks only after prev is completed
      const prev_completed  = i === 0
        ? true
        : (sessionMap[levels[i - 1].game_id]?.best_percentage ?? 0) >= 60;

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
        play_url:       `/api/student/games/${g.game_id}/play`,
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
// PLAY GAME — auto-detects type, checks lock, returns content
// GET /api/student/games/:game_id/play
// ════════════════════════════════════════════════════════════════════════════════
const playGame = async (req, res) => {
  try {
    const { game_id } = req.params;
    const user_id = req.user.role_id;

    const [gameRows] = await db.query(`
      SELECT g.*, gt.code AS game_type_code, gt.name AS game_type_name,
             p.name AS path_name
      FROM games g
      JOIN game_types gt ON gt.game_type_id = g.game_type_id
      JOIN paths p ON p.path_id = g.path_id
      WHERE g.game_id = ?
    `, [game_id]);
    if (gameRows.length === 0) return res.status(404).json({ message: 'Game not found.' });
    const game = gameRows[0];

    // ── If parent game → find first unlocked child and play it ────────────────
    if (!game.parent_game_id) {
      const [children] = await db.query(
        `SELECT game_id FROM games
         WHERE parent_game_id = ?
         ORDER BY display_order ASC`,
        [game_id]
      );

      if (children.length === 0) {
        return res.status(404).json({ message: 'No levels created for this game yet.' });
      }

      let targetGameId = children[0].game_id;

      for (let i = 1; i < children.length; i++) {
        const prevId = children[i - 1].game_id;
        const [prev] = await db.query(
          `SELECT MAX(ROUND(score / total_items * 100)) AS best_pct
           FROM game_sessions WHERE user_id = ? AND recipe_id = ?`,
          [user_id, prevId]
        );
        if ((prev[0]?.best_pct ?? 0) >= 60) {
          targetGameId = children[i].game_id;
        } else {
          break;
        }
      }

      req.params.game_id = targetGameId;
      return playGame(req, res);
    }

    // ── Lock check — only for child games ─────────────────────────────────────
    const [siblings] = await db.query(
      `SELECT game_id FROM games
       WHERE parent_game_id = ?
       ORDER BY display_order ASC`,
      [game.parent_game_id]
    );

    const myIndex = siblings.findIndex(s => s.game_id === parseInt(game_id));
    if (myIndex > 0) {
      const prevGameId = siblings[myIndex - 1].game_id;
      const [prevSession] = await db.query(
        `SELECT MAX(ROUND(score / total_items * 100)) AS best_pct
         FROM game_sessions WHERE user_id = ? AND recipe_id = ?`,
        [user_id, prevGameId]
      );
      const prevPct = prevSession[0]?.best_pct ?? 0;
      if (prevPct < 60) {
        return res.status(403).json({
          message:          'This level is locked. Complete the previous level first.',
          required_game_id: prevGameId,
          your_best:        prevPct,
          required:         60,
        });
      }
    }

    // ── Load content ──────────────────────────────────────────────────────────
    let content = {};

    switch (game.game_type_code) {
      case 'PICK_INGREDIENT': {
        const [items] = await db.query(
          `SELECT item_id, name, image_url, question_text
           FROM game_items WHERE game_id = ? ORDER BY RAND()`,
          [game_id]
        );
        content = {
          question: items[0]?.question_text || 'Pick the correct ingredients.',
          items,
        };
        break;
      }
      case 'TAG_SEQUENCE': {
        const [steps] = await db.query(
          `SELECT step_id, description AS step_text, image_url AS step_image
           FROM game_sequence_steps WHERE recipe_id = ? ORDER BY RAND()`,
          [game_id]
        );
        content = {
          question: 'Arrange the steps in the correct order.',
          steps,
        };
        break;
      }
      case 'SPOT_DIFFERENCE': {
        const [images] = await db.query(
          `SELECT image_id, original_image_url, modified_image_url
           FROM game_difference_images WHERE game_id = ?`,
          [game_id]
        );
        for (const img of images) {
          const [[spotRow]] = await db.query(
            `SELECT COUNT(*) AS total_spots FROM game_difference_spots WHERE image_id = ?`,
            [img.image_id]
          );
          img.total_spots = spotRow.total_spots;
        }
        content = { images };
        break;
      }
    }

    // ── My stats ──────────────────────────────────────────────────────────────
    const [[stats]] = await db.query(
      `SELECT MAX(score) AS best_score,
              MAX(total_items) AS best_total,
              MAX(ROUND(score / total_items * 100)) AS best_percentage,
              COUNT(*) AS attempts
       FROM game_sessions
       WHERE user_id = ? AND recipe_id = ?`,
      [user_id, game_id]
    );

    return res.status(200).json({
      game_id:        game.game_id,
      title:          game.title,
      description:    game.description,
      thumbnail_url:  game.thumbnail_url,
      time_limit:     game.time_limit,
      difficulty:     game.difficulty,
      level:          game.level,
      game_type_code: game.game_type_code,
      game_type_name: game.game_type_name,
      path_name:      game.path_name,
      submit_url:     SUBMIT_MAP[game.game_type_code]?.(game_id) || null,
      my_stats: {
        attempts:        stats?.attempts        ?? 0,
        best_score:      stats?.best_score      ?? 0,
        best_total:      stats?.best_total      ?? 0,
        best_percentage: stats?.best_percentage ?? 0,
        is_completed:    (stats?.best_percentage ?? 0) >= 60,
      },
      ...content,
    });

  } catch (error) {
    console.error('Play game error:', error.message);
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
            thumbnail_url, difficulty, level } = req.body;

    const [existing] = await db.query(`SELECT game_id FROM games WHERE game_id = ?`, [game_id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Game not found.' });

    await db.query(
      `UPDATE games SET
        title         = COALESCE(?, title),
        description   = COALESCE(?, description),
        time_limit    = COALESCE(?, time_limit),
        display_order = COALESCE(?, display_order),
        thumbnail_url = COALESCE(?, thumbnail_url),
        difficulty    = COALESCE(?, difficulty),
        level         = COALESCE(?, level)
       WHERE game_id = ?`,
      [title || null, description || null, time_limit ?? null,
       display_order ?? null, thumbnail_url || null,
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

    const [existing] = await db.query(`SELECT game_id FROM games WHERE game_id = ?`, [game_id]);
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
  playGame,
  getPaths,
};