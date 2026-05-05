const db = require('../config/db');
const { POINTS, applyTryAgain } = require('./pointsConfig');

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS — exported for use by game controllers
// ════════════════════════════════════════════════════════════════════════════════
const getAttemptNumber = async (conn, user_id, game_id, game_type_id) => {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM game_sessions
     WHERE user_id = ? AND game_id = ? AND game_type_id = ?`,
    [user_id, game_id, game_type_id]
  );
  return (rows[0].cnt || 0) + 1;
};

const awardBadges = async (conn, user_id, score, total_items) => {
  const newBadges = [];

  // Count sessions AFTER the current insert so we use >= 1
  const [sessions] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM game_sessions WHERE user_id = ?`, [user_id]
  );
  const sessionCount = sessions[0].cnt;

  // badge_id 2: First Win
  if (sessionCount === 1) {
    if (await _tryAwardBadge(conn, user_id, 2)) newBadges.push(2);
  }
  // badge_id 1: Perfect Score
  if (score === total_items && total_items > 0) {
    if (await _tryAwardBadge(conn, user_id, 1)) newBadges.push(1);
  }
  // badge_id 3: 5 Games Played
  if (sessionCount >= 5) {
    if (await _tryAwardBadge(conn, user_id, 3)) newBadges.push(3);
  }
  // badge_id 4: Top of Leaderboard
  const [lb] = await conn.query(`
    SELECT user_id FROM (
      SELECT user_id, SUM(points_earned) AS total
      FROM points_log GROUP BY user_id ORDER BY total DESC LIMIT 1
    ) top`);
  if (lb.length > 0 && lb[0].user_id === user_id) {
    if (await _tryAwardBadge(conn, user_id, 4)) newBadges.push(4);
  }

  return newBadges;
};

// Uses your actual `badges` table with user_id stored directly
const _tryAwardBadge = async (conn, user_id, badge_id) => {
  try {
    // Check if badge already awarded
    const [existing] = await conn.query(
      `SELECT badge_id FROM badges WHERE user_id = ? AND badge_id = ?`,
      [user_id, badge_id]
    );
    if (existing.length > 0) return false;

    await conn.query(
      `UPDATE badges SET user_id = ? WHERE badge_id = ? AND user_id IS NULL LIMIT 1`,
      [user_id, badge_id]
    );
    return true;
  } catch (_) { return false; }
};

// ════════════════════════════════════════════════════════════════════════════════
// SAVE GAME SESSION + LOG POINTS + AUTO-AWARD BADGES
// POST /api/student/game-sessions
// NOTE: recipe_id = game_id (no separate recipes table)
// ════════════════════════════════════════════════════════════════════════════════
const createGameSession = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const user_id = req.user.role_id;
    const { game_id, game_type_id, score, total_items, on_time = false } = req.body;

    if (!game_id || !game_type_id || score == null || !total_items) {
      return res.status(400).json({
        message: 'game_id, game_type_id, score, and total_items are required.',
      });
    }

    const [gtRows] = await conn.query(
      `SELECT code FROM game_types WHERE game_type_id = ?`, [game_type_id]
    );
    if (gtRows.length === 0) return res.status(400).json({ message: 'Invalid game_type_id.' });
    const gameCode = gtRows[0].code;

    const attemptNumber = await getAttemptNumber(conn, user_id, game_id, game_type_id);

    let rawPoints = 0;
    if (gameCode === 'PICK_INGREDIENT') {
      rawPoints = score * POINTS.PTRI_CORRECT_INGREDIENT + (on_time ? POINTS.PTRI_TIME_ATTACK_BONUS : 0);
    } else if (gameCode === 'TAG_SEQUENCE') {
      rawPoints = score * POINTS.SEQ_CORRECT_STEP + (on_time ? POINTS.SEQ_TIME_ATTACK_BONUS : 0);
    } else if (gameCode === 'SPOT_DIFFERENCE') {
      rawPoints = score * POINTS.SPOT_PER_ANOMALY + (on_time ? POINTS.SPOT_TIME_ATTACK_BONUS : 0);
    }

    const points_earned = applyTryAgain(rawPoints, attemptNumber);

    const [result] = await conn.query(
      `INSERT INTO game_sessions (user_id, game_id, game_type_id, score, total_items, points_earned)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, game_id, game_type_id, score, total_items, points_earned]
    );
    const session_id = result.insertId;

    await conn.query(
      `INSERT INTO points_log (user_id, session_id, points_earned) VALUES (?, ?, ?)`,
      [user_id, session_id, points_earned]
    );

    const badges_earned = await awardBadges(conn, user_id, score, total_items);
    await conn.commit();

    return res.status(201).json({
      message: 'Game session saved.',
      session_id, score, total_items,
      attempt_number: attemptNumber,
      try_again_penalty: attemptNumber > 1,
      raw_points: rawPoints, points_earned, badges_earned,
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
// LOG VIDEO LESSON COMPLETION
// POST /api/student/video-complete
// ════════════════════════════════════════════════════════════════════════════════
const completeVideoLesson = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const user_id = req.user.role_id;
    const { video_id, activity_id } = req.body;

    if (!video_id || !activity_id)
      return res.status(400).json({ message: 'video_id and activity_id are required.' });

    // Check already completed
    const [already] = await conn.query(
      `SELECT progress_id FROM student_progress
       WHERE student_id = ? AND activity_id = ? AND video_id = ? AND is_completed = 1`,
      [user_id, activity_id, video_id]
    );
    if (already.length > 0) {
      await conn.rollback();
      return res.status(200).json({ message: 'Already completed. No additional points awarded.', points_earned: 0 });
    }

    await conn.query(
      `INSERT INTO student_progress (student_id, activity_id, video_id, is_completed, completed_at)
       VALUES (?, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE is_completed = 1, completed_at = NOW()`,
      [user_id, activity_id, video_id]
    );

    await conn.query(
      `INSERT INTO points_log (user_id, session_id, points_earned) VALUES (?, 0, ?)`,
      [user_id, POINTS.VIDEO_LESSON_COMPLETED]
    );

    await conn.commit();
    return res.status(200).json({
      message: 'Video lesson completed!',
      points_earned: POINTS.VIDEO_LESSON_COMPLETED,
    });
  } catch (error) {
    await conn.rollback();
    console.error('Complete video lesson error:', error);
    return res.status(500).json({ message: 'Server error.' });
  } finally {
    conn.release();
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// LOG CHECKPOINT COMPLETION
// POST /api/student/checkpoint-complete
// ════════════════════════════════════════════════════════════════════════════════
const completeCheckpoint = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const user_id = req.user.role_id;
    const { checkpoint_id, correct_count, difficulty = 'easy', activity_id } = req.body;

    if (!checkpoint_id || correct_count == null || !activity_id)
      return res.status(400).json({ message: 'checkpoint_id, correct_count, and activity_id are required.' });

    const ptsPerCorrect = difficulty === 'hard'
      ? POINTS.CHECKPOINT_CORRECT_HARD
      : POINTS.CHECKPOINT_CORRECT_EASY;

    const rawPoints     = correct_count * ptsPerCorrect;
    const points_earned = rawPoints; // no try-again for checkpoints

    await conn.query(
      `INSERT INTO points_log (user_id, session_id, points_earned) VALUES (?, 0, ?)`,
      [user_id, points_earned]
    );

    await conn.commit();
    return res.status(200).json({
      message: 'Checkpoint points logged.',
      correct_count, difficulty, raw_points: rawPoints, points_earned,
    });
  } catch (error) {
    await conn.rollback();
    console.error('Complete checkpoint error:', error);
    return res.status(500).json({ message: 'Server error.' });
  } finally {
    conn.release();
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET MY GAME SESSIONS
// GET /api/student/game-sessions
// ════════════════════════════════════════════════════════════════════════════════
const getMyGameSessions = async (req, res) => {
  try {
    const user_id = req.user.role_id;
    const [rows] = await db.query(
      `SELECT gs.*, gt.name AS game_type_name, gt.code AS game_type_code
       FROM game_sessions gs
       JOIN game_types gt ON gs.game_type_id = gt.game_type_id
       WHERE gs.user_id = ?
       ORDER BY gs.completed_at DESC`,
      [user_id]
    );
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get game sessions error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// LEADERBOARD — all students ranked by total points
// GET /api/student/leaderboard
// GET /api/teacher/leaderboard
// ════════════════════════════════════════════════════════════════════════════════
const getLeaderboard = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        u.user_id,
        u.firstname,
        u.lastname,
        COALESCE(SUM(pl.points_earned), 0)           AS total_points,
        COUNT(DISTINCT gs.session_id)                 AS games_played,
        COUNT(DISTINCT CASE WHEN sp.is_completed = 1
              THEN sp.activity_id END)                AS lessons_completed,
        RANK() OVER (
          ORDER BY COALESCE(SUM(pl.points_earned), 0) DESC
        )                                             AS rank_position
      FROM users u
      LEFT JOIN points_log     pl ON pl.user_id    = u.user_id
      LEFT JOIN game_sessions  gs ON gs.user_id    = u.user_id
      LEFT JOIN students        s ON s.user_id     = u.user_id
      LEFT JOIN student_progress sp ON sp.student_id = s.student_id
      WHERE u.role = 'student'
      GROUP BY u.user_id, u.firstname, u.lastname
      ORDER BY total_points DESC
    `);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get leaderboard error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET MY BADGES
// GET /api/student/badges
// Uses `badges` table directly (no separate user_badges table)
// ════════════════════════════════════════════════════════════════════════════════
const getMyBadges = async (req, res) => {
  try {
    const user_id = req.user.role_id;
    const [rows] = await db.query(
      `SELECT badge_id, name, description, icon_url, earned_at
       FROM badges
       WHERE user_id = ?
       ORDER BY earned_at DESC`,
      [user_id]
    );
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get badges error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET MY POINTS — total + full history
// GET /api/student/points
// ════════════════════════════════════════════════════════════════════════════════
const getMyPoints = async (req, res) => {
  try {
    const user_id = req.user.role_id;

    // Points from game sessions (session_id > 0)
    const [gameRows] = await db.query(
      `SELECT
         pl.log_id, pl.points_earned, pl.earned_at,
         gt.name  AS source_name,
         gs.score, gs.total_items,
         'game'   AS source_type
       FROM points_log pl
       JOIN game_sessions gs ON pl.session_id = gs.session_id
       JOIN game_types    gt ON gs.game_type_id = gt.game_type_id
       WHERE pl.user_id = ? AND pl.session_id > 0
       ORDER BY pl.earned_at DESC`,
      [user_id]
    );

    // Points from videos/checkpoints (session_id = 0)
    const [lessonRows] = await db.query(
      `SELECT
         pl.log_id, pl.points_earned, pl.earned_at,
         'Lesson / Checkpoint' AS source_name,
         NULL AS score, NULL AS total_items,
         'lesson' AS source_type
       FROM points_log pl
       WHERE pl.user_id = ? AND pl.session_id = 0
       ORDER BY pl.earned_at DESC`,
      [user_id]
    );

    const history = [...gameRows, ...lessonRows].sort(
      (a, b) => new Date(b.earned_at) - new Date(a.earned_at)
    );
    const total_points = history.reduce((sum, r) => sum + r.points_earned, 0);

    return res.status(200).json({ total_points, history });
  } catch (error) {
    console.error('Get points error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  createGameSession,
  completeVideoLesson,
  completeCheckpoint,
  getMyGameSessions,
  getLeaderboard,
  getMyBadges,
  getMyPoints,
  // internal helpers exported for game controllers
  getAttemptNumber,
  awardBadges,
};