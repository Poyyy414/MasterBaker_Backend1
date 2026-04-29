const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// SAVE GAME SESSION + LOG POINTS + AUTO-AWARD BADGES
// POST /api/student/game-sessions
// Body: { recipe_id, game_type_id, score, total_items, points_earned }
// ════════════════════════════════════════════════════════════════════════════════
const createGameSession = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const student_id = req.user.role_id;   // from JWT, same pattern as submitCheckpoint
    const { recipe_id, game_type_id, score, total_items, points_earned = 0 } = req.body;

    if (!recipe_id || !game_type_id || score == null || !total_items) {
      return res.status(400).json({ message: 'recipe_id, game_type_id, score, and total_items are required.' });
    }

    // Save session
    const [result] = await conn.query(
      `INSERT INTO game_sessions (user_id, recipe_id, game_type_id, score, total_items, points_earned)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [student_id, recipe_id, game_type_id, score, total_items, points_earned]
    );
    const session_id = result.insertId;

    // Log points
    await conn.query(
      `INSERT INTO points_log (user_id, session_id, points_earned) VALUES (?, ?, ?)`,
      [student_id, session_id, points_earned]
    );

    // Auto-award badges
    const newBadges = await awardBadges(conn, student_id, score, total_items);

    await conn.commit();

    return res.status(201).json({
      message:       'Game session saved.',
      session_id,
      score,
      total_items,
      points_earned,
      badges_earned: newBadges,
    });
  } catch (error) {
    await conn.rollback();
    console.error('Create game session error:', error);
    return res.status(500).json({ message: 'Server error.' });
  } finally {
    conn.release();
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET ALL SESSIONS OF A STUDENT
// GET /api/student/game-sessions
// ════════════════════════════════════════════════════════════════════════════════
const getMyGameSessions = async (req, res) => {
  try {
    const student_id = req.user.role_id;

    const [rows] = await db.query(
      `SELECT gs.*, gt.name AS game_type_name
       FROM game_sessions gs
       JOIN game_types gt ON gs.game_type_id = gt.game_type_id
       WHERE gs.user_id = ?
       ORDER BY gs.completed_at DESC`,
      [student_id]
    );

    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get game sessions error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET LEADERBOARD
// GET /api/student/leaderboard
// GET /api/teacher/leaderboard
// ════════════════════════════════════════════════════════════════════════════════
const getLeaderboard = async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT * FROM leaderboard LIMIT 50`);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get leaderboard error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET MY BADGES
// GET /api/student/badges
// ════════════════════════════════════════════════════════════════════════════════
const getMyBadges = async (req, res) => {
  try {
    const student_id = req.user.role_id;

    const [rows] = await db.query(
      `SELECT b.badge_id, b.name, b.description, b.icon_url, ub.earned_at
       FROM user_badges ub
       JOIN badges b ON ub.badge_id = b.badge_id
       WHERE ub.user_id = ?
       ORDER BY ub.earned_at DESC`,
      [student_id]
    );

    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get badges error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET MY POINTS LOG
// GET /api/student/points
// ════════════════════════════════════════════════════════════════════════════════
const getMyPoints = async (req, res) => {
  try {
    const student_id = req.user.role_id;

    const [rows] = await db.query(
      `SELECT pl.log_id, pl.points_earned, pl.earned_at,
              gt.name AS game_type_name, gs.score, gs.total_items
       FROM points_log pl
       JOIN game_sessions gs ON pl.session_id = gs.session_id
       JOIN game_types gt    ON gs.game_type_id = gt.game_type_id
       WHERE pl.user_id = ?
       ORDER BY pl.earned_at DESC`,
      [student_id]
    );

    const total_points = rows.reduce((sum, r) => sum + r.points_earned, 0);

    return res.status(200).json({ total_points, history: rows });
  } catch (error) {
    console.error('Get points error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL — Badge logic (runs inside transaction)
// ════════════════════════════════════════════════════════════════════════════════
const awardBadges = async (conn, user_id, score, total_items) => {
  const newBadges = [];

  const [sessions] = await conn.query(
    `SELECT session_id FROM game_sessions WHERE user_id = ?`, [user_id]
  );

  // badge_id 2: First Win
  if (sessions.length === 1) {
    const awarded = await tryAwardBadge(conn, user_id, 2);
    if (awarded) newBadges.push(2);
  }

  // badge_id 1: Perfect Score
  if (score === total_items) {
    const awarded = await tryAwardBadge(conn, user_id, 1);
    if (awarded) newBadges.push(1);
  }

  // badge_id 3: Streak Master (5+ games)
  if (sessions.length >= 5) {
    const awarded = await tryAwardBadge(conn, user_id, 3);
    if (awarded) newBadges.push(3);
  }

  return newBadges;
};

const tryAwardBadge = async (conn, user_id, badge_id) => {
  try {
    const [res] = await conn.query(
      `INSERT IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)`,
      [user_id, badge_id]
    );
    return res.affectedRows > 0;
  } catch (_) {
    return false;
  }
};

module.exports = {
  createGameSession,
  getMyGameSessions,
  getLeaderboard,
  getMyBadges,
  getMyPoints,
};
