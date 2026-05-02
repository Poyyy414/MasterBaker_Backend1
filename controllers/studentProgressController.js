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
// HELPER — fetch session stats for one game + game_type
// ════════════════════════════════════════════════════════════════════════════════
const _getLevelStats = async (studentId, game_id, game_type_id) => {
  const [sessions] = await db.query(
    `SELECT
       session_id, score, total_items, points_earned, completed_at,
       CASE WHEN total_items > 0
            THEN ROUND((score / total_items) * 100)
            ELSE 0
       END AS score_percent
     FROM game_sessions
     WHERE user_id = ? AND recipe_id = ? AND game_type_id = ?
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
// 1. STUDENT OVERVIEW
// GET /api/teacher/progress/student/:student_id
// ════════════════════════════════════════════════════════════════════════════════
const getStudentOverview = async (req, res) => {
  try {
    const { student_id: studentId } = req.params;
    const student = await _getStudentInfo(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    // Total points
    const [[pointsRow]] = await db.query(
      `SELECT COALESCE(SUM(points_earned), 0) AS total_points
       FROM points_log WHERE user_id = ?`,
      [studentId]
    );

    // Rank position
    const [[rankRow]] = await db.query(
      `SELECT COUNT(*) + 1 AS rank_position
       FROM (
         SELECT user_id, SUM(points_earned) AS total
         FROM points_log GROUP BY user_id
         HAVING total > ?
       ) higher`,
      [pointsRow.total_points]
    );

    // Badges — uses badges table with user_id column directly
    const [badges] = await db.query(
      `SELECT badge_id, name, description, icon_url, earned_at
       FROM badges
       WHERE user_id = ?
       ORDER BY earned_at DESC`,
      [studentId]
    );

    // Games played
    const [[gamesRow]] = await db.query(
      `SELECT COUNT(*) AS games_played FROM game_sessions WHERE user_id = ?`,
      [studentId]
    );

    // Activity completion per path
    const [paths] = await db.query(
      `SELECT path_id, name FROM paths ORDER BY path_id`
    );

    const pathProgress = [];
    let totalActivitiesAll = 0, completedActivitiesAll = 0;

    for (const path of paths) {
      const [activities] = await db.query(
        `SELECT activity_id FROM activities WHERE path_id = ?`,
        [path.path_id]
      );

      let completedCount = 0;
      for (const act of activities) {
        const [[cpRow]] = await db.query(
          `SELECT COUNT(*) AS total FROM checkpoints WHERE activity_id = ?`,
          [act.activity_id]
        );
        const [[doneRow]] = await db.query(
          `SELECT COUNT(DISTINCT checkpoint_id) AS done
           FROM student_progress
           WHERE student_id = ? AND activity_id = ?
             AND checkpoint_id IS NOT NULL AND score IS NOT NULL`,
          [student.student_id, act.activity_id]
        );
        if (cpRow.total > 0 && doneRow.done >= cpRow.total) completedCount++;
      }

      totalActivitiesAll    += activities.length;
      completedActivitiesAll += completedCount;

      pathProgress.push({
        path_id:               path.path_id,
        path_name:             path.name,
        total_activities:      activities.length,
        completed_activities:  completedCount,
        completion_percent:    activities.length > 0
          ? Math.round((completedCount / activities.length) * 100) : 0,
      });
    }

    return res.status(200).json({
      student: {
        user_id:   student.user_id,
        firstname: student.firstname,
        lastname:  student.lastname,
        email:     student.email,
      },
      total_points:               pointsRow.total_points,
      rank_position:              rankRow.rank_position,
      games_played:               gamesRow.games_played,
      badges_earned:              badges.length,
      badges,
      overall_completion_percent: totalActivitiesAll > 0
        ? Math.round((completedActivitiesAll / totalActivitiesAll) * 100) : 0,
      paths: pathProgress,
    });
  } catch (error) {
    console.error('Get student overview error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// 2. LESSON PROGRESS
// GET /api/teacher/progress/student/:student_id/lessons
// ════════════════════════════════════════════════════════════════════════════════
const getStudentLessonProgress = async (req, res) => {
  try {
    const { student_id: studentId } = req.params;
    const student = await _getStudentInfo(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const [paths] = await db.query(
      `SELECT path_id, name FROM paths ORDER BY path_id`
    );
    const result = [];

    for (const path of paths) {
      const [activities] = await db.query(
        `SELECT activity_id, title FROM activities
         WHERE path_id = ? ORDER BY order_index`,
        [path.path_id]
      );
      const activityData = [];

      for (const act of activities) {
        // activity_videos columns: video_id, activity_id, title, video_url, duration, order_index
        const [videos] = await db.query(
          `SELECT
             v.video_id,
             v.title     AS video_title,
             v.video_url,
             v.duration,
             sp.is_completed,
             sp.completed_at
           FROM activity_videos v
           LEFT JOIN student_progress sp
             ON sp.video_id    = v.video_id
             AND sp.student_id = ?
             AND sp.activity_id = ?
           WHERE v.activity_id = ?
           ORDER BY v.order_index`,
          [student.student_id, act.activity_id, act.activity_id]
        );

        const completed        = videos.filter(v => v.is_completed).length;
        const pointsFromVideos = completed * 30;

        activityData.push({
          activity_id:        act.activity_id,
          activity_title:     act.title,
          total_videos:       videos.length,
          completed_videos:   completed,
          completion_percent: videos.length > 0
            ? Math.round((completed / videos.length) * 100) : 0,
          points_from_videos: pointsFromVideos,
          videos: videos.map(v => ({
            video_id:     v.video_id,
            video_title:  v.video_title,
            video_url:    v.video_url,
            duration:     v.duration,
            is_completed: !!v.is_completed,
            completed_at: v.completed_at,
            points:       v.is_completed ? 30 : 0,
          })),
        });
      }

      const totalVideos     = activityData.reduce((s, a) => s + a.total_videos, 0);
      const completedVideos = activityData.reduce((s, a) => s + a.completed_videos, 0);

      result.push({
        path_id:            path.path_id,
        path_name:          path.name,
        total_videos:       totalVideos,
        completed_videos:   completedVideos,
        completion_percent: totalVideos > 0
          ? Math.round((completedVideos / totalVideos) * 100) : 0,
        activities: activityData,
      });
    }

    return res.status(200).json({
      student: {
        user_id:   student.user_id,
        firstname: student.firstname,
        lastname:  student.lastname,
      },
      lesson_progress: result,
    });
  } catch (error) {
    console.error('Get student lesson progress error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// 3. CHECKPOINT PROGRESS
// GET /api/teacher/progress/student/:student_id/checkpoints
// ════════════════════════════════════════════════════════════════════════════════
const getStudentCheckpointProgress = async (req, res) => {
  try {
    const { student_id: studentId } = req.params;
    const student = await _getStudentInfo(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const [paths] = await db.query(
      `SELECT path_id, name FROM paths ORDER BY path_id`
    );
    const result = [];

    for (const path of paths) {
      const [activities] = await db.query(
        `SELECT activity_id, title FROM activities
         WHERE path_id = ? ORDER BY order_index`,
        [path.path_id]
      );
      const activityData = [];

      for (const act of activities) {
        const [checkpoints] = await db.query(
          `SELECT checkpoint_id, title AS checkpoint_title, order_index
           FROM checkpoints
           WHERE activity_id = ? ORDER BY order_index`,
          [act.activity_id]
        );

        const checkpointData = [];

        for (const cp of checkpoints) {
          // Questions + student answers
          const [questions] = await db.query(
            `SELECT q.question_id, q.question_text, q.question_type,
                    sa.given_answer, sa.is_correct
             FROM questions q
             LEFT JOIN student_answers sa
               ON sa.question_id = q.question_id
               AND sa.student_id = ?
             WHERE q.checkpoint_id = ?
             ORDER BY q.order_index`,
            [student.student_id, cp.checkpoint_id]
          );

          // Progress row — student_progress columns:
          // progress_id, student_id, activity_id, video_id, checkpoint_id,
          // is_completed, score, updated_at, attempt_count, completed_at
          const [progressRows] = await db.query(
            `SELECT score, attempt_count, completed_at, is_completed
             FROM student_progress
             WHERE student_id = ? AND checkpoint_id = ?
             ORDER BY completed_at DESC
             LIMIT 1`,
            [student.student_id, cp.checkpoint_id]
          );
          const progress = progressRows[0] || null;

          const totalQ   = questions.length;
          const correct  = questions.filter(q => q.is_correct === 1).length;
          const wrong    = questions.filter(q => q.is_correct === 0 && q.given_answer !== null).length;
          const percent  = totalQ > 0 ? Math.round((correct / totalQ) * 100) : 0;
          const submitted = !!progress;

          checkpointData.push({
            checkpoint_id:    cp.checkpoint_id,
            checkpoint_title: cp.checkpoint_title,
            total_questions:  totalQ,
            correct_answers:  correct,
            wrong_answers:    wrong,
            unanswered:       totalQ - correct - wrong,
            score_percent:    percent,
            passed:           percent >= 60,
            submitted,
            score:            progress?.score ?? null,
            attempt_count:    progress?.attempt_count ?? 0,
            completed_at:     progress?.completed_at ?? null,
            questions,
          });
        }

        const passedCp = checkpointData.filter(c => c.passed).length;
        activityData.push({
          activity_id:        act.activity_id,
          activity_title:     act.title,
          total_checkpoints:  checkpointData.length,
          passed_checkpoints: passedCp,
          completion_percent: checkpointData.length > 0
            ? Math.round((passedCp / checkpointData.length) * 100) : 0,
          checkpoints: checkpointData,
        });
      }

      result.push({
        path_id:    path.path_id,
        path_name:  path.name,
        activities: activityData,
      });
    }

    return res.status(200).json({
      student: {
        user_id:   student.user_id,
        firstname: student.firstname,
        lastname:  student.lastname,
      },
      checkpoint_progress: result,
    });
  } catch (error) {
    console.error('Get student checkpoint progress error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// 4. GAME PROGRESS
// GET /api/teacher/progress/student/:student_id/games
// ════════════════════════════════════════════════════════════════════════════════
const getStudentGameProgress = async (req, res) => {
  try {
    const { student_id: studentId } = req.params;
    const student = await _getStudentInfo(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const [gameTypes] = await db.query(
      `SELECT game_type_id, code, name FROM game_types ORDER BY game_type_id`
    );
    const [allGames] = await db.query(
      `SELECT game_id, title, description, time_limit, order_index
       FROM games ORDER BY order_index`
    );

    const gameTypeResults = [];

    for (const gt of gameTypes) {
      const levels = [];
      let levelsPassed = 0;

      for (const game of allGames) {
        let content_info = {};

        if (gt.code === 'PICK_INGREDIENT') {
          const [[row]] = await db.query(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct
             FROM game_items WHERE game_id = ?`,
            [game.game_id]
          );
          content_info = {
            total_ingredients:   row.total,
            correct_ingredients: row.correct,
          };
        } else if (gt.code === 'TAG_SEQUENCE') {
          const [[row]] = await db.query(
            `SELECT COUNT(*) AS total_steps
             FROM game_sequence_steps WHERE game_id = ?`,
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
              `SELECT COUNT(*) AS cnt
               FROM game_difference_spots WHERE image_id = ?`,
              [img.image_id]
            );
            total_spots += row.cnt;
          }
          content_info = {
            total_image_pairs: images.length,
            total_spots,
          };
        }

        const stats = await _getLevelStats(studentId, game.game_id, gt.game_type_id);
        if (stats.passed) levelsPassed++;

        levels.push({
          game_id:             game.game_id,
          level_title:         game.title,
          description:         game.description,
          time_limit:          game.time_limit,
          content_info,
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

      gameTypeResults.push({
        game_type_id:            gt.game_type_id,
        game_type_code:          gt.code,
        game_type_name:          gt.name,
        total_levels:            allGames.length,
        levels_passed:           levelsPassed,
        type_completion_percent: allGames.length > 0
          ? Math.round((levelsPassed / allGames.length) * 100) : 0,
        levels,
      });
    }

    const grandTotal  = gameTypeResults.reduce((s, g) => s + g.total_levels, 0);
    const grandPassed = gameTypeResults.reduce((s, g) => s + g.levels_passed, 0);
    const grandPoints = gameTypeResults.reduce(
      (s, g) => s + g.levels.reduce((ls, l) => ls + l.total_points_earned, 0), 0
    );

    return res.status(200).json({
      student: {
        user_id:   student.user_id,
        firstname: student.firstname,
        lastname:  student.lastname,
      },
      summary: {
        overall_total_levels:        grandTotal,
        overall_levels_passed:       grandPassed,
        overall_completion_percent:  grandTotal > 0
          ? Math.round((grandPassed / grandTotal) * 100) : 0,
        overall_total_points_earned: grandPoints,
      },
      game_types: gameTypeResults,
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