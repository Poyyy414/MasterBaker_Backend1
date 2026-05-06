const db = require('../config/db');

// REAL SCHEMA REMINDER:
//   game_items:             item_id, recipe_id, name, image_url, is_correct
//   game_sequence_steps:    step_id, recipe_id, description, image_url, correct_order
//   game_difference_images: image_id, recipe_id, image_a_url, image_b_url
//   game_difference_spots:  spot_id, image_id, x_percent, y_percent, radius
//   game_sessions:          session_id, user_id, recipe_id(=game_id), game_type_id, score, total_items, points_earned
//   student_progress:       progress_id, student_id, activity_id, video_id, checkpoint_id, is_completed, score, attempt_count, completed_at
//   paths (NOT learning_paths): path_id, name

const _getStudent = async (user_id) => {
  const [rows] = await db.query(
    `SELECT u.user_id, u.firstname, u.lastname, u.email, u.avatar_url,
            s.student_id, s.grade_level, s.section
     FROM users u
     JOIN students s ON s.user_id = u.user_id
     WHERE u.user_id = ? AND u.role = 'student'`,
    [user_id]
  );
  return rows[0] || null;
};

// ════════════════════════════════════════════════════════════════════════════════
// 1. OVERVIEW
// GET /api/teacher/progress/students/:student_id/overview
// ════════════════════════════════════════════════════════════════════════════════
const getStudentOverview = async (req, res) => {
  try {
    const { student_id } = req.params;
    const student = await _getStudent(student_id);
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const [[ptRow]] = await db.query(
      `SELECT COALESCE(SUM(points_earned), 0) AS total FROM points_log WHERE user_id = ?`,
      [student_id]
    );

    const [[rankRow]] = await db.query(
      `SELECT COUNT(*) + 1 AS rank_position
       FROM (SELECT user_id, SUM(points_earned) AS total FROM points_log
             GROUP BY user_id HAVING total > ?) h`,
      [ptRow.total]
    );

    const [badges] = await db.query(
      `SELECT b.badge_id, b.name, b.description, b.icon_url, ub.earned_at
       FROM user_badges ub JOIN badges b ON ub.badge_id = b.badge_id
       WHERE ub.user_id = ? ORDER BY ub.earned_at DESC`,
      [student_id]
    );

    const [[gamesRow]] = await db.query(
      `SELECT COUNT(*) AS games_played FROM game_sessions WHERE user_id = ?`, [student_id]
    );

    const [paths] = await db.query(`SELECT path_id, name FROM paths ORDER BY path_id`);
    const pathProgress = [];
    let totalAll = 0, passedAll = 0;

    for (const path of paths) {
      const [games] = await db.query(
        `SELECT game_id FROM games WHERE path_id = ?`, [path.path_id]
      );
      const gameIds    = games.map(g => g.game_id);
      const totalGames = gameIds.length;

      let passedGames = 0;
      if (totalGames > 0) {
        const [[pRow]] = await db.query(
          `SELECT COUNT(DISTINCT recipe_id) AS passed
           FROM game_sessions
           WHERE user_id = ? AND recipe_id IN (?)
             AND total_items > 0 AND (score / total_items) >= 0.6`,
          [student_id, gameIds]
        );
        passedGames = pRow.passed;
      }

      totalAll += totalGames;
      passedAll += passedGames;

      pathProgress.push({
        path_id:            path.path_id,
        path_name:          path.name,
        total_games:        totalGames,
        games_passed:       passedGames,
        completion_percent: totalGames > 0 ? Math.round((passedGames / totalGames) * 100) : 0,
      });
    }

    return res.status(200).json({
      student: {
        user_id:     student.user_id,
        firstname:   student.firstname,
        lastname:    student.lastname,
        email:       student.email,
        avatar_url:  student.avatar_url,
        grade_level: student.grade_level,
        section:     student.section,
      },
      points: {
        total:         ptRow.total,
        rank_position: rankRow.rank_position,
      },
      games_played:               gamesRow.games_played,
      badges_earned:              badges.length,
      badges,
      overall_completion_percent: totalAll > 0 ? Math.round((passedAll / totalAll) * 100) : 0,
      paths:                      pathProgress,
    });
  } catch (error) {
    console.error('Get student overview error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// 2. LESSON PROGRESS
// GET /api/teacher/progress/students/:student_id/lessons
// ════════════════════════════════════════════════════════════════════════════════
const getStudentLessonProgress = async (req, res) => {
  try {
    const { student_id } = req.params;
    const student = await _getStudent(student_id);
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const [paths]  = await db.query(`SELECT path_id, name FROM paths ORDER BY path_id`);
    const result   = [];

    for (const path of paths) {
      const [activities] = await db.query(
        `SELECT activity_id, title FROM activities WHERE path_id = ? ORDER BY order_index`,
        [path.path_id]
      );
      const activityData = [];

      for (const act of activities) {
        // activity_videos: video_id, activity_id, title, video_url, duration, order_index
        const [videos] = await db.query(
          `SELECT av.video_id, av.title, av.video_url, av.duration, av.order_index,
                  COALESCE(sp.is_completed, 0) AS is_completed,
                  sp.completed_at,
                  CASE WHEN sp.is_completed = 1 THEN 30 ELSE 0 END AS points_earned
           FROM activity_videos av
           LEFT JOIN student_progress sp
             ON sp.video_id    = av.video_id
             AND sp.activity_id = av.activity_id
             AND sp.student_id  = ?
           WHERE av.activity_id = ?
           ORDER BY av.order_index`,
          [student.student_id, act.activity_id]
        );

        const completed = videos.filter(v => v.is_completed).length;
        activityData.push({
          activity_id:        act.activity_id,
          activity_title:     act.title,
          total_videos:       videos.length,
          completed_videos:   completed,
          completion_percent: videos.length > 0 ? Math.round((completed / videos.length) * 100) : 0,
          points_from_videos: completed * 30,
          videos,
        });
      }

      const pt = activityData.reduce((s, a) => s + a.total_videos,    0);
      const pc = activityData.reduce((s, a) => s + a.completed_videos, 0);
      result.push({
        path_id:            path.path_id,
        path_name:          path.name,
        total_videos:       pt,
        completed_videos:   pc,
        completion_percent: pt > 0 ? Math.round((pc / pt) * 100) : 0,
        activities:         activityData,
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
// GET /api/teacher/progress/students/:student_id/checkpoints
// ════════════════════════════════════════════════════════════════════════════════
const getStudentCheckpointProgress = async (req, res) => {
  try {
    const { student_id } = req.params;
    const student = await _getStudent(student_id);
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const [paths]  = await db.query(`SELECT path_id, name FROM paths ORDER BY path_id`);
    const result   = [];

    for (const path of paths) {
      const [activities] = await db.query(
        `SELECT activity_id, title FROM activities WHERE path_id = ? ORDER BY order_index`,
        [path.path_id]
      );
      const activityData = [];

      for (const act of activities) {
        const [checkpoints] = await db.query(
          `SELECT checkpoint_id, title,
             (SELECT COUNT(*) FROM questions q WHERE q.checkpoint_id = c.checkpoint_id) AS total_questions
           FROM checkpoints c WHERE activity_id = ? ORDER BY order_index`,
          [act.activity_id]
        );

        const checkpointData = [];
        for (const cp of checkpoints) {
          // student_progress: student_id, checkpoint_id, activity_id, score, attempt_count, completed_at
          const [prog] = await db.query(
            `SELECT score, attempt_count, completed_at, is_completed
             FROM student_progress
             WHERE student_id = ? AND checkpoint_id = ? AND activity_id = ?
             ORDER BY completed_at DESC LIMIT 1`,
            [student.student_id, cp.checkpoint_id, act.activity_id]
          );
          const p          = prog[0] || null;
          const best_score = p?.score ?? 0;
          const best_pct   = cp.total_questions > 0
            ? Math.round((best_score / cp.total_questions) * 100) : 0;

          checkpointData.push({
            checkpoint_id:    cp.checkpoint_id,
            checkpoint_title: cp.title,
            total_questions:  cp.total_questions,
            best_score,
            best_percent:     best_pct,
            passed:           best_pct >= 60,
            attempt_count:    p?.attempt_count ?? 0,
            completed_at:     p?.completed_at  ?? null,
            estimated_points: best_score * 50,
          });
        }

        const passed_count = checkpointData.filter(c => c.passed).length;
        activityData.push({
          activity_id:        act.activity_id,
          activity_title:     act.title,
          total_checkpoints:  checkpointData.length,
          passed_checkpoints: passed_count,
          completion_percent: checkpointData.length > 0
            ? Math.round((passed_count / checkpointData.length) * 100) : 0,
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
// 4. GAME PROGRESS — per path → per game_type → per level
// GET /api/teacher/progress/students/:student_id/games
// ════════════════════════════════════════════════════════════════════════════════
const getStudentGameProgress = async (req, res) => {
  try {
    const { student_id } = req.params;
    const student = await _getStudent(student_id);
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const [paths]     = await db.query(`SELECT path_id, name FROM paths ORDER BY path_id`);
    const [gameTypes] = await db.query(
      `SELECT game_type_id, code, name FROM game_types ORDER BY game_type_id`
    );

    const pathResults = [];

    for (const path of paths) {
      const gameTypeResults = [];

      for (const gt of gameTypes) {
        const [games] = await db.query(
          `SELECT game_id, title, description, time_limit, display_order, thumbnail_url
           FROM games WHERE path_id = ? AND game_type_id = ?
           ORDER BY display_order ASC`,
          [path.path_id, gt.game_type_id]
        );
        if (games.length === 0) continue;

        const levels = [];
        let type_passed = 0;

        for (const game of games) {
          // Content info — uses REAL column names
          let content_info = {};
          if (gt.code === 'PICK_INGREDIENT') {
            const [[row]] = await db.query(
              `SELECT COUNT(*) AS total,
                 SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct_count
               FROM game_items WHERE recipe_id = ?`,   // ← recipe_id not game_id
              [game.game_id]
            );
            content_info = { total_ingredients: row.total, correct_ingredients: row.correct_count };

          } else if (gt.code === 'TAG_SEQUENCE') {
            const [[row]] = await db.query(
              `SELECT COUNT(*) AS total_steps FROM game_sequence_steps WHERE recipe_id = ?`,  // ← recipe_id
              [game.game_id]
            );
            content_info = { total_steps: row.total_steps };

          } else if (gt.code === 'SPOT_DIFFERENCE') {
            const [images] = await db.query(
              `SELECT image_id FROM game_difference_images WHERE recipe_id = ?`,  // ← recipe_id
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
            content_info = { total_image_pairs: images.length, total_spots };
          }

          // Student sessions for this game
          const [sessions] = await db.query(
            `SELECT session_id, score, total_items, points_earned, completed_at,
               CASE WHEN total_items > 0 THEN ROUND((score / total_items) * 100) ELSE 0 END AS score_percent
             FROM game_sessions
             WHERE user_id = ? AND recipe_id = ? AND game_type_id = ?
             ORDER BY completed_at ASC`,
            [student_id, game.game_id, gt.game_type_id]
          );

          const attempts = sessions.length;
          const best     = attempts > 0
            ? sessions.reduce((b, s) => s.score_percent > b.score_percent ? s : b)
            : null;

          const best_percentage     = best?.score_percent   ?? 0;
          const passed              = best_percentage >= 60;
          const total_points_earned = sessions.reduce((s, r) => s + (r.points_earned || 0), 0);

          if (passed) type_passed++;

          levels.push({
            game_id:             game.game_id,
            level_title:         game.title,
            description:         game.description,
            time_limit:          game.time_limit,
            display_order:       game.display_order,
            thumbnail_url:       game.thumbnail_url,
            content_info,
            attempts,
            best_score:          best?.score       ?? 0,
            best_total:          best?.total_items  ?? 0,
            best_percentage,
            passed,
            total_points_earned,
            last_played:         attempts > 0 ? sessions[attempts - 1].completed_at : null,
            session_history:     sessions.map(s => ({
              session_id:    s.session_id,
              score:         s.score,
              total_items:   s.total_items,
              score_percent: s.score_percent,
              points_earned: s.points_earned,
              completed_at:  s.completed_at,
            })),
          });
        }

        gameTypeResults.push({
          game_type_id:            gt.game_type_id,
          game_type_code:          gt.code,
          game_type_name:          gt.name,
          total_levels:            games.length,
          levels_passed:           type_passed,
          type_completion_percent: Math.round((type_passed / games.length) * 100),
          total_points_earned:     levels.reduce((s, l) => s + l.total_points_earned, 0),
          levels,
        });
      }

      const path_total   = gameTypeResults.reduce((s, g) => s + g.total_levels,       0);
      const path_passed  = gameTypeResults.reduce((s, g) => s + g.levels_passed,       0);
      const path_points  = gameTypeResults.reduce((s, g) => s + g.total_points_earned, 0);

      pathResults.push({
        path_id:                  path.path_id,
        path_name:                path.name,
        path_total_levels:        path_total,
        path_levels_passed:       path_passed,
        path_completion_percent:  path_total > 0 ? Math.round((path_passed / path_total) * 100) : 0,
        path_total_points_earned: path_points,
        game_types:               gameTypeResults,
      });
    }

    const grand_total  = pathResults.reduce((s, p) => s + p.path_total_levels,       0);
    const grand_passed = pathResults.reduce((s, p) => s + p.path_levels_passed,      0);
    const grand_points = pathResults.reduce((s, p) => s + p.path_total_points_earned, 0);

    const [[logRow]] = await db.query(
      `SELECT COALESCE(SUM(points_earned), 0) AS total
       FROM points_log WHERE user_id = ? AND session_id > 0`, [student_id]
    );

    return res.status(200).json({
      student: {
        user_id:   student.user_id,
        firstname: student.firstname,
        lastname:  student.lastname,
      },
      summary: {
        total_points_from_games:    logRow.total,
        total_levels_attempted:     grand_total,
        total_levels_passed:        grand_passed,
        overall_completion_percent: grand_total > 0
          ? Math.round((grand_passed / grand_total) * 100) : 0,
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