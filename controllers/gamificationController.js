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

const _tryAwardBadge = async (conn, user_id, badge_id) => {
  try {
    const [existing] = await conn.query(
      `SELECT id FROM user_badges WHERE user_id = ? AND badge_id = ?`,
      [user_id, badge_id]
    );
    if (existing.length > 0) return false;

    await conn.query(
      `INSERT INTO user_badges (user_id, badge_id) VALUES (?, ?)`,
      [user_id, badge_id]
    );
    return true;
  } catch (_) { return false; }
};

// ════════════════════════════════════════════════════════════════════════════════
// SAVE GAME SESSION + LOG POINTS + AUTO-AWARD BADGES
// POST /api/student/game-sessions
// ════════════════════════════════════════════════════════════════════════════════
const createGameSession = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const user_id = req.user.role_id;
    const {
      game_type,
      path,
      level,
      score,
      total,
      is_time_attack = false,
    } = req.body;

    if (!game_type || !path || !level || score == null || !total) {
      return res.status(400).json({
        message: 'game_type, path, level, score, and total are required.',
      });
    }

    // ── Map game_type string → DB code ───────────────────────────────────────
    const GAME_TYPE_MAP = {
      pick_right_ingredient: 'PICK_INGREDIENT',
      sequential_baking:     'TAG_SEQUENCE',
      spot_difference:       'SPOT_DIFFERENCE',
    };

    const code = GAME_TYPE_MAP[game_type];
    if (!code) {
      return res.status(400).json({
        message: `Invalid game_type. Must be one of: ${Object.keys(GAME_TYPE_MAP).join(', ')}`,
      });
    }

    const [gtRows] = await conn.query(
      `SELECT game_type_id FROM game_types WHERE code = ?`, [code]
    );
    if (gtRows.length === 0) {
      return res.status(400).json({ message: 'game_type not found in DB.' });
    }
    const game_type_id = gtRows[0].game_type_id;

    // ── Map level string → difficulty ─────────────────────────────────────────
    const LEVEL_MAP = {
      strawberry: 'Easy',
      chocolate:  'Medium',
      blueberry:  'Hard',
    };

    const difficulty = LEVEL_MAP[level];
    if (!difficulty) {
      return res.status(400).json({
        message: `Invalid level. Must be one of: ${Object.keys(LEVEL_MAP).join(', ')}`,
      });
    }

    // ── Resolve game_id from path + difficulty + game_type ───────────────────
    const [gameRows] = await conn.query(
      `SELECT g.game_id
       FROM games g
       JOIN paths p ON p.path_id = g.path_id
       WHERE LOWER(p.name)    = ?
         AND g.game_type_id   = ?
         AND LOWER(g.difficulty) = LOWER(?)
         AND g.parent_game_id IS NOT NULL`,
      [path.toLowerCase(), game_type_id, difficulty]
    );

    if (gameRows.length === 0) {
      return res.status(404).json({
        message: `No game found for path="${path}", level="${level}", game_type="${game_type}". Make sure the child game exists with the correct difficulty.`,
      });
    }
    const game_id = gameRows[0].game_id;

    // ── Attempt number ────────────────────────────────────────────────────────
    const attemptNumber = await getAttemptNumber(conn, user_id, game_id, game_type_id);

    // ── Calculate points ──────────────────────────────────────────────────────
    let rawPoints = 0;
    if (code === 'PICK_INGREDIENT') {
      rawPoints = score * POINTS.PTRI_CORRECT_INGREDIENT
        + (is_time_attack ? POINTS.PTRI_TIME_ATTACK_BONUS : 0);
    } else if (code === 'TAG_SEQUENCE') {
      rawPoints = score * POINTS.SEQ_CORRECT_STEP
        + (is_time_attack ? POINTS.SEQ_TIME_ATTACK_BONUS : 0);
    } else if (code === 'SPOT_DIFFERENCE') {
      rawPoints = score * POINTS.SPOT_PER_ANOMALY
        + (is_time_attack ? POINTS.SPOT_TIME_ATTACK_BONUS : 0);
    }

    const points_earned = applyTryAgain(rawPoints, attemptNumber);

    // ── Save session ──────────────────────────────────────────────────────────
    const [result] = await conn.query(
      `INSERT INTO game_sessions (user_id, game_id, game_type_id, score, total_items, points_earned)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, game_id, game_type_id, score, total, points_earned]
    );
    const session_id = result.insertId;

    // ── Log points ────────────────────────────────────────────────────────────
    await conn.query(
      `INSERT INTO points_log (user_id, session_id, points_earned) VALUES (?, ?, ?)`,
      [user_id, session_id, points_earned]
    );

    // ── Award badges ──────────────────────────────────────────────────────────
    const badges_earned = await awardBadges(conn, user_id, score, total);

    await conn.commit();

    return res.status(201).json({
      message:           'Game session saved.',
      session_id,
      game_id,
      game_type,
      path,
      level,
      score,
      total,
      is_perfect:        score === total,
      is_time_attack,
      attempt_number:    attemptNumber,
      try_again_penalty: attemptNumber > 1,
      raw_points:        rawPoints,
      points_earned,
      badges_earned,
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

    const [already] = await conn.query(
      `SELECT progress_id FROM student_progress
       WHERE student_id = ? AND activity_id = ? AND video_id = ? AND is_completed = 1`,
      [user_id, activity_id, video_id]
    );
    if (already.length > 0) {
      await conn.rollback();
      return res.status(200).json({
        message:      'Already completed. No additional points awarded.',
        points_earned: 0,
      });
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
      message:       'Video lesson completed!',
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
      return res.status(400).json({
        message: 'checkpoint_id, correct_count, and activity_id are required.',
      });

    const ptsPerCorrect = difficulty === 'hard'
      ? POINTS.CHECKPOINT_CORRECT_HARD
      : POINTS.CHECKPOINT_CORRECT_EASY;

    const points_earned = correct_count * ptsPerCorrect;

    await conn.query(
      `INSERT INTO points_log (user_id, session_id, points_earned) VALUES (?, 0, ?)`,
      [user_id, points_earned]
    );

    await conn.commit();
    return res.status(200).json({
      message: 'Checkpoint points logged.',
      correct_count,
      difficulty,
      points_earned,
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
// LEADERBOARD
// GET /api/student/leaderboard
// GET /api/teacher/leaderboard
// ════════════════════════════════════════════════════════════════════════════════
const getLeaderboard = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        ranked.student_id,
        ranked.user_id,
        ranked.firstname,
        ranked.lastname,
        ranked.total_points,
        ranked.games_played,
        ranked.lessons_completed,
        RANK() OVER (
          ORDER BY ranked.total_points DESC
        ) AS rank_position
      FROM (
        SELECT
          s.student_id,
          u.user_id,
          u.firstname,
          u.lastname,
          CAST(COALESCE(points.total_points, 0) AS UNSIGNED) AS total_points,
          COALESCE(games.games_played, 0)                    AS games_played,
          COALESCE(lessons.lessons_completed, 0)             AS lessons_completed
        FROM users u
        JOIN students s ON s.user_id = u.user_id
        LEFT JOIN (
          SELECT user_id AS student_id, SUM(points_earned) AS total_points
          FROM points_log
          GROUP BY user_id
        ) points ON points.student_id = s.student_id
        LEFT JOIN (
          SELECT user_id AS student_id, COUNT(*) AS games_played
          FROM game_sessions
          GROUP BY user_id
        ) games ON games.student_id = s.student_id
        LEFT JOIN (
          SELECT student_id, COUNT(DISTINCT activity_id) AS lessons_completed
          FROM student_progress
          WHERE is_completed = 1
          GROUP BY student_id
        ) lessons ON lessons.student_id = s.student_id
        WHERE u.role = 'student'
      ) ranked
      ORDER BY ranked.total_points DESC, ranked.user_id ASC
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
// ════════════════════════════════════════════════════════════════════════════════
const getMyBadges = async (req, res) => {
  try {
    const user_id = req.user.role_id;
    const [rows] = await db.query(
      `SELECT b.badge_id, b.name, b.description, b.icon_url, ub.earned_at
       FROM user_badges ub
       JOIN badges b ON b.badge_id = ub.badge_id
       WHERE ub.user_id = ?
       ORDER BY ub.earned_at DESC`,
      [user_id]
    );
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get badges error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET MY POINTS
// GET /api/student/points
// ════════════════════════════════════════════════════════════════════════════════
const getMyPoints = async (req, res) => {
  try {
    const user_id = req.user.role_id;

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
  getAttemptNumber,
  awardBadges,
};
