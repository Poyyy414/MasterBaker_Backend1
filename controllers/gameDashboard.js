const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// SCREEN 1 — GAME ACTIVITIES DASHBOARD
// ════════════════════════════════════════════════════════════════════════════════
const getGameDashboard = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const [paths] = await db.query(
      `SELECT path_id, name, description, image_url
       FROM paths
       ORDER BY path_id ASC`
    );

    if (paths.length === 0) {
      return res.status(200).json({ paths: [] });
    }

    for (const path of paths) {
      // Total games
      const [totalRow] = await db.query(
        `SELECT COUNT(DISTINCT g.game_id) AS total
         FROM games g
         WHERE g.path_id = ?`,
        [path.path_id]
      );

      path.total_games = totalRow[0].total;

      // ✅ FIXED: recipe_id → game_id
      const [passedRow] = await db.query(
        `SELECT COUNT(DISTINCT gs.game_id) AS passed
         FROM game_sessions gs
         JOIN games g ON g.game_id = gs.game_id
         WHERE gs.user_id = ?
           AND g.path_id  = ?
           AND gs.score   >= (gs.total_items * 0.6)`,
        [user_id, path.path_id]
      );

      path.completed_games = passedRow[0].passed;
    }

    return res.status(200).json({ paths });

  } catch (error) {
    console.error('Get game dashboard error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// SCREEN 2 — GAME LIST FOR A PATH
// ════════════════════════════════════════════════════════════════════════════════
const getPathGames = async (req, res) => {
  try {
    const { path_id } = req.params;
    const user_id     = req.user.user_id;

    const [pathRows] = await db.query(
      `SELECT path_id, name FROM paths WHERE path_id = ?`,
      [path_id]
    );

    if (pathRows.length === 0) {
      return res.status(404).json({ message: 'Path not found.' });
    }

    const path = pathRows[0];

    const [games] = await db.query(
      `SELECT
         g.game_id,
         g.title,
         g.description,
         g.time_limit,
         g.display_order,
         g.thumbnail_url,
         gt.code AS game_type_code,
         gt.name AS game_type_name
       FROM games g
       JOIN game_types gt ON gt.game_type_id = g.game_type_id
       WHERE g.path_id = ?
       ORDER BY g.display_order ASC`,
      [path_id]
    );

    if (games.length === 0) {
      return res.status(200).json({
        path_id,
        path_name: path.name,
        games: []
      });
    }

    const gameIds = games.map(g => g.game_id);

    // ✅ FIXED: recipe_id → game_id
    const [sessions] = await db.query(
      `SELECT
         gs.game_id,
         MAX(gs.score) AS best_score,
         MAX(gs.total_items) AS best_total,
         MAX(ROUND(gs.score / gs.total_items * 100)) AS best_percentage
       FROM game_sessions gs
       WHERE gs.user_id = ? AND gs.game_id IN (?)
       GROUP BY gs.game_id`,
      [user_id, gameIds]
    );

    const sessionMap = {};
    for (const s of sessions) {
      sessionMap[s.game_id] = s;
    }

    const POINTS_MAP = {
      PICK_INGREDIENT: { per_correct: 100, time_attack_bonus: 50 },
      TAG_SEQUENCE:    { per_correct: 100, time_attack_bonus: 50 },
      SPOT_DIFFERENCE: { per_correct: 100, time_attack_bonus: 50 },
    };

    const enriched = [];
    let previousPassed = true;

    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      const session = sessionMap[g.game_id] || null;

      const best_score      = session?.best_score ?? 0;
      const best_total      = session?.best_total ?? 0;
      const best_percentage = session?.best_percentage ?? 0;

      const is_completed = best_percentage >= 60;
      const is_locked    = !previousPassed;

      const pts = POINTS_MAP[g.game_type_code] || {
        per_correct: 100,
        time_attack_bonus: 50
      };

      const ENDPOINT_MAP = {
        PICK_INGREDIENT: `/api/student/games/${g.game_id}/pick-ingredient`,
        TAG_SEQUENCE:    `/api/student/games/${g.game_id}/sequence`,
        SPOT_DIFFERENCE: `/api/student/games/${g.game_id}/difference`,
      };

      const SUBMIT_MAP = {
        PICK_INGREDIENT: `/api/student/games/${g.game_id}/pick-ingredient/submit`,
        TAG_SEQUENCE:    `/api/student/games/${g.game_id}/sequence/submit`,
        SPOT_DIFFERENCE: `/api/student/games/${g.game_id}/difference/check`,
      };

      enriched.push({
        game_id:            g.game_id,
        title:              g.title,
        description:        g.description,
        time_limit:         g.time_limit,
        thumbnail_url:      g.thumbnail_url,
        game_type_code:     g.game_type_code,
        game_type_name:     g.game_type_name,
        points_per_correct: pts.per_correct,
        time_attack_bonus:  pts.time_attack_bonus,
        is_locked,
        is_completed,
        best_score,
        best_total,
        best_percentage,
        play_url:   ENDPOINT_MAP[g.game_type_code] || null,
        submit_url: SUBMIT_MAP[g.game_type_code]   || null,
      });

      previousPassed = is_completed;
    }

    return res.status(200).json({
      path_id,
      path_name: path.name,
      games: enriched,
      time_attack: {
        bonus_percent: 50,
        description: '+50% bonus pts if completed in time',
      },
    });

  } catch (error) {
    console.error('Get path games error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// ACHIEVEMENTS
// ════════════════════════════════════════════════════════════════════════════════
const getAchievements = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const [[pointsRow]] = await db.query(
      `SELECT COALESCE(SUM(points_earned), 0) AS total_points
       FROM points_log
       WHERE user_id = ?`,
      [user_id]
    );

    const [[gamesRow]] = await db.query(
      `SELECT COUNT(*) AS games_played
       FROM game_sessions
       WHERE user_id = ?`,
      [user_id]
    );

    const [badges] = await db.query(
      `SELECT b.badge_id, b.name, b.description, b.icon_url, ub.earned_at
       FROM user_badges ub
       JOIN badges b ON b.badge_id = ub.badge_id
       WHERE ub.user_id = ?
       ORDER BY ub.earned_at DESC`,
      [user_id]
    );

    return res.status(200).json({
      total_points: pointsRow.total_points,
      games_played: gamesRow.games_played,
      badges,
    });

  } catch (error) {
    console.error('Get achievements error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  getGameDashboard,
  getPathGames,
  getAchievements,
};