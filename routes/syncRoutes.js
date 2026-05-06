const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { verifyToken } = require('../middleware/authMiddleware');
const auth = verifyToken;

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/sync/game-progress
// App pushes local game progress rows in bulk after playing offline.
//
// Body: {
//   entries: [
//     {
//       game_id:      INT,    ← maps to recipe_id in game_sessions
//       game_type_id: INT,    ← 1=PICK_INGREDIENT 2=TAG_SEQUENCE 3=SPOT_DIFFERENCE
//       score:        INT,
//       total_items:  INT,
//       points_earned:INT,
//       played_at:    ISO string (optional)
//     }
//   ]
// }
// ════════════════════════════════════════════════════════════════════════════════
router.post('/game-progress', auth, async (req, res) => {
  const user_id   = req.user.user_id;
  const { entries } = req.body;

  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ message: 'No entries provided.' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let totalPointsSynced = 0;
    let syncedCount = 0;

    const LEVEL_MAP = {
      strawberry:      'Easy',
      cake_vanilla:    'Easy',
      pie_pumpkin:     'Easy',
      chocolate:       'Medium',
      cake_chocolate:  'Medium',
      pie_apple:       'Medium',
      blueberry:       'Hard',
      cake_blueberry:  'Hard',
      pie_buko:        'Hard',
    };

    for (const e of entries) {
      if (!e.game_type_id || !e.path || !e.level) continue;
      if (!e.client_ref_id) continue;

      const difficulty = LEVEL_MAP[e.level];
      if (!difficulty) continue;

      // Look up game_id from path + difficulty + game_type_id (same logic as createGameSession)
      const [gameRows] = await conn.query(
        `SELECT g.game_id FROM games g
         JOIN paths p ON p.path_id = g.path_id
         WHERE LOWER(p.name) = ? AND g.game_type_id = ? AND LOWER(g.difficulty) = LOWER(?)
           AND g.parent_game_id IS NOT NULL`,
        [e.path.toLowerCase(), e.game_type_id, difficulty]
      );
      if (gameRows.length === 0) continue;
      const game_id = gameRows[0].game_id;

      const points = e.points_earned ?? 0;
      const played = e.played_at ? new Date(e.played_at) : new Date();

      const [[{ max_score }]] = await conn.query(
        `SELECT COALESCE(MAX(score), -1) AS max_score
         FROM game_sessions
         WHERE user_id = ? AND game_id = ? AND game_type_id = ?`,
        [user_id, game_id, e.game_type_id]
      );

      if (max_score >= (e.score ?? 0)) continue;

      const [result] = await conn.query(
        `INSERT INTO game_sessions
           (user_id, game_id, game_type_id, score, total_items, points_earned, completed_at, client_ref_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE session_id = session_id`,
        [user_id, game_id, e.game_type_id,
         e.score ?? 0, e.total_items ?? 0, points, played, e.client_ref_id]
      );
      syncedCount++;

      if (points > 0) {
        await conn.query(
          `INSERT INTO points_log (user_id, session_id, points_earned, earned_at)
           VALUES (?, ?, ?, ?)`,
          [user_id, result.insertId, points, played]
        );
        totalPointsSynced += points;
      }
    }

    await conn.commit();

    return res.status(200).json({
      message:      'Game progress synced.',
      synced:       syncedCount,
      points_added: totalPointsSynced,
    });
  } catch (err) {
    await conn.rollback();
    console.error('Sync game-progress error:', err);
    return res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/sync/coins
// App pushes offline coin/points log entries in bulk.
//
// Body: {
//   entries: [
//     { amount: INT, reason: string, logged_at: ISO string }
//   ]
// }
// ════════════════════════════════════════════════════════════════════════════════
router.post('/coins', auth, async (req, res) => {
  const user_id   = req.user.user_id;
  const { entries } = req.body;

  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ message: 'No entries provided.' });
  }

  try {
    // session_id = 0 marks lesson/manual coin entries (not from a game session)
    let syncedCount = 0;
    
    for (const e of entries) {
      if (!e.client_ref_id) continue; // Require client_ref_id for deduplication
      
      await db.query(
        `INSERT INTO points_log (user_id, session_id, points_earned, earned_at, client_ref_id)
         VALUES (?, 0, ?, ?, ?)
         ON DUPLICATE KEY UPDATE log_id = log_id`,
        [
          user_id,
          e.amount ?? 0,
          e.logged_at ? new Date(e.logged_at) : new Date(),
          e.client_ref_id
        ]
      );
      syncedCount++;
    }

    return res.status(200).json({
      message: 'Coins synced.',
      synced:  syncedCount,
    });
  } catch (err) {
    console.error('Sync coins error:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/sync/pull
// App fetches everything it needs in one request on login / app open.
//
// Returns:
//   user         — profile + avatar
//   total_points — sum from points_log
//   game_sessions — all sessions for this user (most recent 100)
//   points_log    — recent 100 point entries
//   badges        — earned badges
//   leaderboard_rank
// ════════════════════════════════════════════════════════════════════════════════
router.get('/pull', auth, async (req, res) => {
  const user_id = req.user.user_id;

  try {
    const [
      [userRows],
      [sessions],
      [pointsLog],
      [badges],
      [rankRow],
      [totalRow],
    ] = await Promise.all([

      // User profile
      db.query(
        `SELECT u.user_id, u.firstname, u.lastname, u.email, u.avatar_url,
                s.student_id, s.grade_level, s.section
         FROM users u
         LEFT JOIN students s ON s.user_id = u.user_id
         WHERE u.user_id = ?`,
        [user_id]
      ),

      // Game sessions — most recent 100
      db.query(
        `SELECT gs.session_id, gs.game_id AS game_id, gs.game_type_id,
                gt.code AS game_type_code, gt.name AS game_type_name,
                g.title AS game_title,
                gs.score, gs.total_items, gs.points_earned, gs.completed_at,
                CASE WHEN gs.total_items > 0
                     THEN ROUND((gs.score / gs.total_items) * 100)
                     ELSE 0 END AS score_percent
         FROM game_sessions gs
         JOIN game_types gt ON gt.game_type_id = gs.game_type_id
         LEFT JOIN games  g  ON g.game_id       = gs.game_id
         WHERE gs.user_id = ?
         ORDER BY gs.completed_at DESC
         LIMIT 100`,
        [user_id]
      ),

      // Points log — most recent 100
      db.query(
        `SELECT pl.log_id, pl.session_id, pl.points_earned, pl.earned_at,
                CASE WHEN pl.session_id = 0 THEN 'lesson'
                     ELSE 'game' END AS source_type
         FROM points_log pl
         WHERE pl.user_id = ?
         ORDER BY pl.earned_at DESC
         LIMIT 100`,
        [user_id]
      ),

      // Badges
      db.query(
        `SELECT b.badge_id, b.name, b.description, b.icon_url, ub.earned_at
         FROM user_badges ub
         JOIN badges b ON ub.badge_id = b.badge_id
         WHERE ub.user_id = ?
         ORDER BY ub.earned_at DESC`,
        [user_id]
      ),

      // Rank
      db.query(
        `SELECT COUNT(*) + 1 AS rank_position
         FROM (
           SELECT user_id, SUM(points_earned) AS total
           FROM points_log GROUP BY user_id
           HAVING total > (
             SELECT COALESCE(SUM(points_earned), 0)
             FROM points_log WHERE user_id = ?
           )
         ) higher`,
        [user_id]
      ),

      // Total points (all-time, not just last 100)
      db.query(
        `SELECT COALESCE(SUM(points_earned), 0) AS total
         FROM points_log
         WHERE user_id = ?`,
        [user_id]
      ),
    ]);

    if (!userRows[0]) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Total points (from dedicated SUM query, not truncated to 100 rows)
    const total_points = totalRow[0]?.total ?? 0;

    return res.status(200).json({
      user:           userRows[0],
      total_points,
      rank_position:  rankRow[0]?.rank_position ?? 1,
      game_sessions:  sessions,
      points_log:     pointsLog,
      badges,
    });
  } catch (err) {
    console.error('Sync pull error:', err);
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;