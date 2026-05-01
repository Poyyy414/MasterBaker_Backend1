const db = require('../config/db');
const { POINTS, applyTryAgain }         = require('./pointsConfig');
const { getAttemptNumber, awardBadges } = require('./gamificationController');

// ════════════════════════════════════════════════════════════════════════════════
// CREATE DIFFERENCE IMAGE (teacher)
// POST /api/teacher/games/:game_id/difference
// ════════════════════════════════════════════════════════════════════════════════
const createDifferenceImage = async (req, res) => {
  try {
    const { game_id } = req.params;
    const { original_image_url, modified_image_url } = req.body;

    if (!original_image_url || !modified_image_url)
      return res.status(400).json({ message: 'original_image_url and modified_image_url are required.' });

    const [game] = await db.query(`SELECT game_id FROM games WHERE game_id = ?`, [game_id]);
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [result] = await db.query(
      `INSERT INTO game_difference_images (game_id, original_image_url, modified_image_url)
       VALUES (?, ?, ?)`,
      [game_id, original_image_url, modified_image_url]
    );
    return res.status(201).json({ message: 'Difference image created.', image_id: result.insertId });
  } catch (error) {
    console.error('Create difference image error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET DIFFERENCE IMAGES + SPOTS (teacher — full coords)
// GET /api/teacher/games/:game_id/difference
// ════════════════════════════════════════════════════════════════════════════════
const getDifferenceGameTeacher = async (req, res) => {
  try {
    const { game_id } = req.params;
    const [game] = await db.query(`SELECT game_id, title FROM games WHERE game_id = ?`, [game_id]);
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [images] = await db.query(
      `SELECT image_id, original_image_url, modified_image_url
       FROM game_difference_images WHERE game_id = ?`, [game_id]
    );
    for (const img of images) {
      const [spots] = await db.query(
        `SELECT spot_id, x_percent, y_percent, radius_percent, label
         FROM game_difference_spots WHERE image_id = ?`, [img.image_id]
      );
      img.spots = spots;
    }
    return res.status(200).json({ game_id: game[0].game_id, title: game[0].title, images });
  } catch (error) {
    console.error('Get difference game teacher error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE DIFFERENCE IMAGE (teacher)
// DELETE /api/teacher/difference/images/:image_id
// ════════════════════════════════════════════════════════════════════════════════
const deleteDifferenceImage = async (req, res) => {
  try {
    const { image_id } = req.params;
    const [existing] = await db.query(
      `SELECT image_id FROM game_difference_images WHERE image_id = ?`, [image_id]
    );
    if (existing.length === 0) return res.status(404).json({ message: 'Difference image not found.' });

    await db.query(`DELETE FROM game_difference_spots  WHERE image_id = ?`, [image_id]);
    await db.query(`DELETE FROM game_difference_images WHERE image_id = ?`, [image_id]);
    return res.status(200).json({ message: 'Difference image and its spots deleted.' });
  } catch (error) {
    console.error('Delete difference image error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// CREATE DIFFERENCE SPOT (teacher)
// POST /api/teacher/difference/:image_id/spots
// ════════════════════════════════════════════════════════════════════════════════
const createDifferenceSpot = async (req, res) => {
  try {
    const { image_id } = req.params;
    const { x_percent, y_percent, radius_percent = 5, label } = req.body;

    if (x_percent == null || y_percent == null)
      return res.status(400).json({ message: 'x_percent and y_percent are required.' });

    const [image] = await db.query(
      `SELECT image_id FROM game_difference_images WHERE image_id = ?`, [image_id]
    );
    if (image.length === 0) return res.status(404).json({ message: 'Difference image not found.' });

    const [result] = await db.query(
      `INSERT INTO game_difference_spots (image_id, x_percent, y_percent, radius_percent, label)
       VALUES (?, ?, ?, ?, ?)`,
      [image_id, x_percent, y_percent, radius_percent, label || null]
    );
    return res.status(201).json({ message: 'Difference spot created.', spot_id: result.insertId });
  } catch (error) {
    console.error('Create difference spot error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE DIFFERENCE SPOT (teacher)
// PUT /api/teacher/difference/spots/:spot_id
// ════════════════════════════════════════════════════════════════════════════════
const updateDifferenceSpot = async (req, res) => {
  try {
    const { spot_id } = req.params;
    const { x_percent, y_percent, radius_percent, label } = req.body;

    const [existing] = await db.query(
      `SELECT spot_id FROM game_difference_spots WHERE spot_id = ?`, [spot_id]
    );
    if (existing.length === 0) return res.status(404).json({ message: 'Spot not found.' });

    await db.query(
      `UPDATE game_difference_spots SET
         x_percent      = COALESCE(?, x_percent),
         y_percent      = COALESCE(?, y_percent),
         radius_percent = COALESCE(?, radius_percent),
         label          = COALESCE(?, label)
       WHERE spot_id = ?`,
      [x_percent ?? null, y_percent ?? null, radius_percent ?? null, label ?? null, spot_id]
    );
    return res.status(200).json({ message: 'Difference spot updated.' });
  } catch (error) {
    console.error('Update difference spot error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE DIFFERENCE SPOT (teacher)
// DELETE /api/teacher/difference/spots/:spot_id
// ════════════════════════════════════════════════════════════════════════════════
const deleteDifferenceSpot = async (req, res) => {
  try {
    const { spot_id } = req.params;
    const [existing] = await db.query(
      `SELECT spot_id FROM game_difference_spots WHERE spot_id = ?`, [spot_id]
    );
    if (existing.length === 0) return res.status(404).json({ message: 'Spot not found.' });

    await db.query(`DELETE FROM game_difference_spots WHERE spot_id = ?`, [spot_id]);
    return res.status(200).json({ message: 'Difference spot deleted.' });
  } catch (error) {
    console.error('Delete difference spot error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET DIFFERENCE GAME (student — coordinates hidden, count only)
// GET /api/student/games/:game_id/difference
// ════════════════════════════════════════════════════════════════════════════════
const getDifferenceGame = async (req, res) => {
  try {
    const { game_id } = req.params;
    const [game] = await db.query(
      `SELECT game_id, title, description, time_limit FROM games WHERE game_id = ?`, [game_id]
    );
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [images] = await db.query(
      `SELECT image_id, original_image_url, modified_image_url
       FROM game_difference_images WHERE game_id = ?`, [game_id]
    );
    if (images.length === 0) return res.status(404).json({ message: 'No images found for this game.' });

    for (const img of images) {
      const [spots] = await db.query(
        `SELECT COUNT(*) AS total FROM game_difference_spots WHERE image_id = ?`, [img.image_id]
      );
      img.total_spots = spots[0].total;
    }

    return res.status(200).json({
      game_id: game[0].game_id, title: game[0].title,
      description: game[0].description, time_limit: game[0].time_limit, images,
    });
  } catch (error) {
    console.error('Get difference game error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// CHECK DIFFERENCE SPOTS (student submission)
// POST /api/student/games/:game_id/difference/check
// NOTE: game_id is used as recipe_id (no separate recipes table)
// ════════════════════════════════════════════════════════════════════════════════
const checkDifferenceSpots = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { game_id }                              = req.params;
    const user_id                                  = req.user.role_id;
    const { image_id, clicked_spots = [], on_time = false } = req.body;
    const recipe_id                                = parseInt(game_id); // no recipes table

    if (!image_id) return res.status(400).json({ message: 'image_id is required.' });

    const [gtRows] = await conn.query(
      `SELECT game_type_id FROM game_types WHERE code = 'SPOT_DIFFERENCE'`
    );
    if (!gtRows[0]) return res.status(500).json({ message: "game_type 'SPOT_DIFFERENCE' not found." });
    const game_type_id = gtRows[0].game_type_id;

    const attemptNumber = await getAttemptNumber(conn, user_id, recipe_id, game_type_id);

    const [answerSpots] = await conn.query(
      `SELECT spot_id, x_percent, y_percent, radius_percent, label
       FROM game_difference_spots WHERE image_id = ?`, [image_id]
    );

    const total        = answerSpots.length;
    const foundSpotIds = new Set();

    const click_results = clicked_spots.map(({ x_percent, y_percent }) => {
      for (const spot of answerSpots) {
        if (foundSpotIds.has(spot.spot_id)) continue;
        const dx = x_percent - spot.x_percent;
        const dy = y_percent - spot.y_percent;
        if (Math.sqrt(dx * dx + dy * dy) <= spot.radius_percent) {
          foundSpotIds.add(spot.spot_id);
          return { x_percent, y_percent, hit: true, spot_id: spot.spot_id, label: spot.label };
        }
      }
      return { x_percent, y_percent, hit: false };
    });

    const correctCount  = foundSpotIds.size;
    const percentage    = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const passed        = percentage >= 60;
    const rawPoints     = correctCount * POINTS.SPOT_PER_ANOMALY + (on_time ? POINTS.SPOT_TIME_ATTACK_BONUS : 0);
    const points_earned = applyTryAgain(rawPoints, attemptNumber);

    const [result] = await conn.query(
      `INSERT INTO game_sessions (user_id, recipe_id, game_type_id, score, total_items, points_earned)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, recipe_id, game_type_id, correctCount, total, points_earned]
    );
    await conn.query(
      `INSERT INTO points_log (user_id, session_id, points_earned) VALUES (?, ?, ?)`,
      [user_id, result.insertId, points_earned]
    );

    const badges_earned = await awardBadges(conn, user_id, correctCount, total);
    await conn.commit();

    return res.status(200).json({
      message: 'Spots checked.',
      score: correctCount, total, percentage, passed,
      attempt_number: attemptNumber, try_again_penalty: attemptNumber > 1,
      raw_points: rawPoints, points_earned, on_time,
      click_results, answer_spots: answerSpots, badges_earned,
    });
  } catch (error) {
    await conn.rollback();
    console.error('Check difference spots error:', error);
    return res.status(500).json({ message: 'Server error.' });
  } finally {
    conn.release();
  }
};

module.exports = {
  createDifferenceImage, getDifferenceGameTeacher, deleteDifferenceImage,
  createDifferenceSpot,  updateDifferenceSpot,     deleteDifferenceSpot,
  getDifferenceGame,     checkDifferenceSpots,
};