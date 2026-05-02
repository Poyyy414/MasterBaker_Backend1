const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// HELPER — verify student exists
// ════════════════════════════════════════════════════════════════════════════════
const _getStudentInfo = async (studentId) => {
  const [rows] = await db.query(
    `SELECT u.user_id, u.firstname, u.lastname, u.email, s.student_id
     FROM users u
     JOIN students s ON s.user_id = u.user_id
     WHERE u.user_id = ? AND u.role = 'student'`,
    [studentId]
  );
  return rows[0] || null;
};

// ════════════════════════════════════════════════════════════════════════════════
// HELPER — fetch & compute session stats for one level (game_id + game_type_id)
// recipe_id = game_id (confirmed across all 3 game controllers)
// ════════════════════════════════════════════════════════════════════════════════
const _getLevelStats = async (studentId, game_id, game_type_id) => {
  const [sessions] = await db.query(
    `SELECT
       session_id,
       score,
       total_items,
       points_earned,
       completed_at,
       CASE WHEN total_items > 0
            THEN ROUND((score / total_items) * 100)
            ELSE 0
       END AS score_percent
     FROM game_sessions
     WHERE user_id      = ?
       AND recipe_id    = ?
       AND game_type_id = ?
     ORDER BY completed_at ASC`,
    [studentId, game_id, game_type_id]
  );

  if (sessions.length === 0) {
    return {
      attempts: 0, best_score: 0, best_total: 0,
      best_percentage: 0, passed: false,
      total_points_earned: 0, last_played: null,
      session_history: [],
    };
  }

  const best = sessions.reduce((b, s) => s.score_percent > b.score_percent ? s : b);

  return {
    attempts:            sessions.length,
    best_score:          best.score,
    best_total:          best.total_items,
    best_percentage:     best.score_percent,
    passed:              best.score_percent >= 60,
    total_points_earned: sessions.reduce((sum, s) => sum + (s.points_earned || 0), 0),
    last_played:         sessions[sessions.length - 1].completed_at,
    session_history:     sessions.map(s => ({
      session_id:    s.session_id,
      score:         s.score,
      total_items:   s.total_items,
      score_percent: s.score_percent,
      points_earned: s.points_earned,
      completed_at:  s.completed_at,
    })),
  };
};

// ════════════════════════════════════════════════════════════════════════════════
// 1. OVERVIEW
// GET /api/teacher/progress/student/:studentId
// ════════════════════════════════════════════════════════════════════════════════
const getStudentOverview = async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await _getStudentInfo(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const [[pointsRow]] = await db.query(
      `SELECT COALESCE(SUM(points_earned), 0) AS total_points FROM points_log WHERE user_id = ?`,
      [studentId]
    );

    const [[rankRow]] = await db.query(
      `SELECT COUNT(*) + 1 AS rank_position
       FROM (
         SELECT user_id, SUM(points_earned) AS total
         FROM points_log GROUP BY user_id
         HAVING total > ?
       ) higher`,
      [pointsRow.total_points]
    );

    const [badges] = await db.query(
      `SELECT b.badge_id, b.name, b.icon_url, ub.earned_at
       FROM user_badges ub
       JOIN badges b ON ub.badge_id = b.badge_id
       WHERE ub.user_id = ? ORDER BY ub.earned_at DESC`,
      [studentId]
    );

    const [[gamesRow]] = await db.query(
      `SELECT COUNT(*) AS games_played FROM game_sessions WHERE user_id = ?`,
      [studentId]
    );

    const [paths] = await db.query(`SELECT path_id, name FROM learning_paths ORDER BY path_id`);
    const pathProgress = [];
    let totalGamesAll = 0, passedGamesAll = 0;

    for (const path of paths) {
      const [[totalRow]] = await db.query(
        `SELECT COUNT(DISTINCT g.game_id) AS total
         FROM games g JOIN activities a ON a.activity_id = g.activity_id
         WHERE a.path_id = ?`,
        [path.path_id]
      );
      const [[passedRow]] = await db.query(
        `SELECT COUNT(DISTINCT gs.recipe_id) AS passed
         FROM game_sessions gs
         JOIN games g ON g.game_id = gs.recipe_id
         JOIN activities a ON a.activity_id = g.activity_id
         WHERE gs.user_id = ? AND a.path_id = ?
           AND gs.total_items > 0
           AND (gs.score / gs.total_items) >= 0.6`,
        [studentId, path.path_id]
      );

      const total = totalRow.total, passed = passedRow.passed;
      totalGamesAll += total; passedGamesAll += passed;
      pathProgress.push({
        path_id: path.path_id, path_name: path.name,
        total_games: total, completed_games: passed,
        completion_percent: total > 0 ? Math.round((passed / total) * 100) : 0,
      });
    }

    return res.status(200).json({
      student: {
        user_id: student.user_id, firstname: student.firstname,
        lastname: student.lastname, email: student.email,
      },
      total_points:               pointsRow.total_points,
      rank_position:              rankRow.rank_position,
      games_played:               gamesRow.games_played,
      badges_earned:              badges.length,
      badges,
      overall_completion_percent: totalGamesAll > 0
        ? Math.round((passedGamesAll / totalGamesAll) * 100) : 0,
      paths: pathProgress,
    });
  } catch (error) {
    console.error('Get student overview error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// 2. LESSON PROGRESS
// GET /api/teacher/progress/student/:studentId/lessons
// ════════════════════════════════════════════════════════════════════════════════
const getStudentLessonProgress = async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await _getStudentInfo(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const [paths] = await db.query(`SELECT path_id, name FROM learning_paths ORDER BY path_id`);
    const result = [];

    for (const path of paths) {
      const [activities] = await db.query(
        `SELECT activity_id, title FROM activities WHERE path_id = ? ORDER BY order_index`,
        [path.path_id]
      );
      const activityData = [];

      for (const act of activities) {
        const [videos] = await db.query(
          `SELECT v.video_id, v.title AS video_title, v.duration_sec,
             sp.is_completed, sp.completed_at,
             CASE WHEN sp.is_completed = 1 THEN 30 ELSE 0 END AS points_earned
           FROM videos v
           LEFT JOIN student_progress sp
             ON sp.video_id = v.video_id
             AND sp.student_id = ? AND sp.activity_id = ?
           WHERE v.activity_id = ? ORDER BY v.order_index`,
          [student.student_id, act.activity_id, act.activity_id]
        );

        const completed = videos.filter(v => v.is_completed).length;
        activityData.push({
          activity_id: act.activity_id, activity_title: act.title,
          total_videos: videos.length, completed_videos: completed,
          completion_percent: videos.length > 0 ? Math.round((completed / videos.length) * 100) : 0,
          points_from_videos: videos.reduce((s, v) => s + v.points_earned, 0),
          videos,
        });
      }

      const pt = activityData.reduce((s, a) => s + a.total_videos, 0);
      const pc = activityData.reduce((s, a) => s + a.completed_videos, 0);
      result.push({
        path_id: path.path_id, path_name: path.name,
        total_videos: pt, completed_videos: pc,
        completion_percent: pt > 0 ? Math.round((pc / pt) * 100) : 0,
        activities: activityData,
      });
    }

    return res.status(200).json({
      student: { user_id: student.user_id, firstname: student.firstname, lastname: student.lastname },
      lesson_progress: result,
    });
  } catch (error) {
    console.error('Get student lesson progress error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// 3. CHECKPOINT PROGRESS
// GET /api/teacher/progress/student/:studentId/checkpoints
// ════════════════════════════════════════════════════════════════════════════════
const getStudentCheckpointProgress = async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await _getStudentInfo(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const [paths] = await db.query(`SELECT path_id, name FROM learning_paths ORDER BY path_id`);
    const result = [];

    for (const path of paths) {
      const [activities] = await db.query(
        `SELECT activity_id, title FROM activities WHERE path_id = ? ORDER BY order_index`,
        [path.path_id]
      );
      const activityData = [];

      for (const act of activities) {
        const [checkpoints] = await db.query(
          `SELECT c.checkpoint_id, c.title AS checkpoint_title, c.difficulty, c.passing_score,
             (SELECT COUNT(*) FROM questions q WHERE q.checkpoint_id = c.checkpoint_id) AS total_questions
           FROM checkpoints c WHERE c.activity_id = ? ORDER BY c.order_index`,
          [act.activity_id]
        );

        const checkpointData = [];
        for (const cp of checkpoints) {
          const [attempts] = await db.query(
            `SELECT attempt_id, correct_count, score_percent, passed, points_earned, attempted_at
             FROM checkpoint_student_attempts
             WHERE student_id = ? AND checkpoint_id = ? ORDER BY attempted_at ASC`,
            [student.student_id, cp.checkpoint_id]
          );

          const best = attempts.reduce((b, a) =>
            (!b || a.score_percent > b.score_percent) ? a : b, null
          );

          checkpointData.push({
            checkpoint_id: cp.checkpoint_id, checkpoint_title: cp.checkpoint_title,
            difficulty: cp.difficulty, passing_score: cp.passing_score,
            total_questions: cp.total_questions, attempt_count: attempts.length,
            best_correct: best?.correct_count ?? 0, best_percent: best?.score_percent ?? 0,
            best_passed: best?.passed ?? false,
            total_points_earned: attempts.reduce((s, a) => s + (a.points_earned || 0), 0),
            attempts,
          });
        }

        const passed_cp = checkpointData.filter(c => c.best_passed).length;
        activityData.push({
          activity_id: act.activity_id, activity_title: act.title,
          total_checkpoints: checkpointData.length, passed_checkpoints: passed_cp,
          completion_percent: checkpointData.length > 0
            ? Math.round((passed_cp / checkpointData.length) * 100) : 0,
          checkpoints: checkpointData,
        });
      }

      result.push({ path_id: path.path_id, path_name: path.name, activities: activityData });
    }

    return res.status(200).json({
      student: { user_id: student.user_id, firstname: student.firstname, lastname: student.lastname },
      checkpoint_progress: result,
    });
  } catch (error) {
    console.error('Get student checkpoint progress error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// 4. GAME PROGRESS — per-level breakdown per game type per path
// GET /api/teacher/progress/student/:studentId/games
//
// Response structure:
//   summary { overall totals }
//   paths[]
//     path_id, path_name, path_completion_percent, path_total_points_earned
//     game_types[]
//       game_type_code (PICK_INGREDIENT | TAG_SEQUENCE | SPOT_DIFFERENCE)
//       type_completion_percent
//       levels[]                ← each game is one level
//         game_id, level_title
//         content_info          ← ingredients count / steps count / spots count
//         attempts, best_score, best_percentage, passed
//         total_points_earned, last_played
//         session_history[]
// ════════════════════════════════════════════════════════════════════════════════
const getStudentGameProgress = async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await _getStudentInfo(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const [gameTypes] = await db.query(
      `SELECT game_type_id, code, name FROM game_types ORDER BY game_type_id`
    );
    const [paths] = await db.query(
      `SELECT path_id, name FROM learning_paths ORDER BY path_id`
    );

    const pathResults = [];

    for (const path of paths) {
      const gameTypeResults = [];

      for (const gt of gameTypes) {

        // All games of this type in this path, ordered by display_order (= difficulty level)
        const [games] = await db.query(
          `SELECT g.game_id, g.title, g.description, g.time_limit, g.display_order
           FROM games g
           JOIN activities a ON a.activity_id = g.activity_id
           WHERE a.path_id      = ?
             AND g.game_type_id = ?
           ORDER BY g.display_order ASC`,
          [path.path_id, gt.game_type_id]
        );

        if (games.length === 0) continue;

        const levels = [];
        let type_levels_passed = 0;

        for (const game of games) {

          // ── Content info (what the teacher set up) ──────────────────────────
          let content_info = {};

          if (gt.code === 'PICK_INGREDIENT') {
            const [[row]] = await db.query(
              `SELECT
                 COUNT(*) AS total_ingredients,
                 SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct_ingredients
               FROM game_items WHERE game_id = ?`,
              [game.game_id]
            );
            content_info = {
              total_ingredients:   row.total_ingredients,
              correct_ingredients: row.correct_ingredients,
              // e.g. student must identify 5 correct out of 12 shown
            };

          } else if (gt.code === 'TAG_SEQUENCE') {
            const [[row]] = await db.query(
              `SELECT COUNT(*) AS total_steps FROM game_sequence_steps WHERE game_id = ?`,
              [game.game_id]
            );
            content_info = { total_steps: row.total_steps };

          } else if (gt.code === 'SPOT_DIFFERENCE') {
            const [images] = await db.query(
              `SELECT image_id FROM game_difference_images WHERE game_id = ?`,
              [game.game_id]
            );
            let total_spots = 0;
            for (const img of images) {
              const [[row]] = await db.query(
                `SELECT COUNT(*) AS cnt FROM game_difference_spots WHERE image_id = ?`,
                [img.image_id]
              );
              total_spots += row.cnt;
            }
            content_info = {
              total_image_pairs: images.length,
              total_spots,
            };
          }

          // ── Student session stats for this level ────────────────────────────
          // recipe_id = game_id (pattern confirmed across all 3 controllers)
          const stats = await _getLevelStats(studentId, game.game_id, gt.game_type_id);

          if (stats.passed) type_levels_passed++;

          levels.push({
            game_id:       game.game_id,
            level_title:   game.title,
            description:   game.description,
            time_limit:    game.time_limit,
            display_order: game.display_order,
            content_info,
            // student progress fields spread in:
            attempts:            stats.attempts,
            best_score:          stats.best_score,
            best_total:          stats.best_total,
            best_percentage:     stats.best_percentage,
            passed:              stats.passed,
            total_points_earned: stats.total_points_earned,
            last_played:         stats.last_played,
            session_history:     stats.session_history,
          });
        }

        const type_completion_percent = games.length > 0
          ? Math.round((type_levels_passed / games.length) * 100)
          : 0;

        gameTypeResults.push({
          game_type_id:           gt.game_type_id,
          game_type_code:         gt.code,
          game_type_name:         gt.name,
          total_levels:           games.length,
          levels_passed:          type_levels_passed,
          type_completion_percent,
          levels,
        });
      }

      // ── Path totals ─────────────────────────────────────────────────────────
      const path_total_levels  = gameTypeResults.reduce((s, g) => s + g.total_levels,  0);
      const path_levels_passed = gameTypeResults.reduce((s, g) => s + g.levels_passed, 0);
      const path_total_points  = gameTypeResults.reduce(
        (s, g) => s + g.levels.reduce((ls, l) => ls + l.total_points_earned, 0), 0
      );

      pathResults.push({
        path_id:                  path.path_id,
        path_name:                path.name,
        path_total_levels,
        path_levels_passed,
        path_completion_percent:  path_total_levels > 0
          ? Math.round((path_levels_passed / path_total_levels) * 100) : 0,
        path_total_points_earned: path_total_points,
        game_types:               gameTypeResults,
      });
    }

    // ── Grand totals ─────────────────────────────────────────────────────────
    const grand_total  = pathResults.reduce((s, p) => s + p.path_total_levels,  0);
    const grand_passed = pathResults.reduce((s, p) => s + p.path_levels_passed, 0);
    const grand_points = pathResults.reduce((s, p) => s + p.path_total_points_earned, 0);

    return res.status(200).json({
      student: {
        user_id:   student.user_id,
        firstname: student.firstname,
        lastname:  student.lastname,
      },
      summary: {
        overall_total_levels:        grand_total,
        overall_levels_passed:       grand_passed,
        overall_completion_percent:  grand_total > 0
          ? Math.round((grand_passed / grand_total) * 100) : 0,
        overall_total_points_earned: grand_points,
      },
      paths: pathResults,
    });
  } catch (error) {
    console.error('Get student game progress error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  getStudentOverview,
  getStudentLessonProgress,
  getStudentCheckpointProgress,
  getStudentGameProgress,
};