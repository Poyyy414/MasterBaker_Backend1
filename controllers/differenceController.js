const db = require('../config/db');
const { POINTS } = require('./pointsConfig'); // ✅ no circular dep

// ════════════════════════════════════════════════════════════════════════════════
// CREATE DIFFERENCE IMAGE (teacher)
// POST /api/teacher/games/:game_id/difference
// Body: { original_image_url, modified_image_url }
// ════════════════════════════════════════════════════════════════════════════════
const createDifferenceImage = async (req, res) => {
  try {
    const { game_id } = req.params;
    const { original_image_url, modified_image_url } = req.body;

    if (!original_image_url || !modified_image_url) {
      return res.status(400).json({
        message: 'original_image_url and modified_image_url are required.',
      });
    }

    const [game] = await db.query(
      `SELECT game_id FROM games WHERE game_id = ?`, [game_id]
    );
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [result] = await db.query(
      `INSERT INTO difference_images (game_id, original_image_url, modified_image_url)
       VALUES (?, ?, ?)`,
      [game_id, original_image_url, modified_image_url]
    );

    return res.status(201).json({
      message:  'Difference image created.',
      image_id: result.insertId,
    });
  } catch (error) {
    console.error('Create difference image error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// CREATE DIFFERENCE SPOT (teacher)
// POST /api/teacher/difference/:image_id/spots
// Body: { x_percent, y_percent, radius_percent, label }
// Coordinates are stored as percentages (0–100) so they scale to any image size.
// ════════════════════════════════════════════════════════════════════════════════
const createDifferenceSpot = async (req, res) => {
  try {
    const { image_id } = req.params;
    const { x_percent, y_percent, radius_percent = 5, label } = req.body;

    if (x_percent == null || y_percent == null) {
      return res.status(400).json({ message: 'x_percent and y_percent are required.' });
    }

    const [image] = await db.query(
      `SELECT image_id FROM difference_images WHERE image_id = ?`, [image_id]
    );
    if (image.length === 0) return res.status(404).json({ message: 'Difference image not found.' });

    const [result] = await db.query(
      `INSERT INTO difference_spots (image_id, x_percent, y_percent, radius_percent, label)
       VALUES (?, ?, ?, ?, ?)`,
      [image_id, x_percent, y_percent, radius_percent, label || null]
    );

    return res.status(201).json({
      message: 'Difference spot created.',
      spot_id: result.insertId,
    });
  } catch (error) {
    console.error('Create difference spot error:', error);
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
      `SELECT spot_id FROM difference_spots WHERE spot_id = ?`, [spot_id]
    );
    if (existing.length === 0) return res.status(404).json({ message: 'Spot not found.' });

    await db.query(`DELETE FROM difference_spots WHERE spot_id = ?`, [spot_id]);
    return res.status(200).json({ message: 'Difference spot deleted.' });
  } catch (error) {
    console.error('Delete difference spot error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET DIFFERENCE GAME (student — no correct spot coords)
// GET /api/student/games/:game_id/difference
// ════════════════════════════════════════════════════════════════════════════════
const getDifferenceGame = async (req, res) => {
  try {
    const { game_id } = req.params;

    const [game] = await db.query(
      `SELECT game_id, title, description, time_limit FROM games WHERE game_id = ?`,
      [game_id]
    );
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [images] = await db.query(
      `SELECT image_id, original_image_url, modified_image_url
       FROM difference_images WHERE game_id = ?`,
      [game_id]
    );

    if (images.length === 0) {
      return res.status(404).json({ message: 'No images found for this game.' });
    }

    // Return spot COUNT only — not coordinates (that would reveal the answers)
    for (const img of images) {
      const [spots] = await db.query(
        `SELECT COUNT(*) AS total FROM difference_spots WHERE image_id = ?`,
        [img.image_id]
      );
      img.total_spots = spots[0].total;
    }

    return res.status(200).json({
      game_id:    game[0].game_id,
      title:      game[0].title,
      description: game[0].description,
      time_limit: game[0].time_limit,
      images,
    });
  } catch (error) {
    console.error('Get difference game error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// CHECK DIFFERENCE SPOTS (student submission)
// POST /api/student/games/:game_id/difference/check
//
// Body:
//   image_id          INT
//   clicked_spots     [{ x_percent, y_percent }]
//   recipe_id         INT
//   on_time           BOOL
//
// A click is "correct" if it lands within radius_percent of any answer spot.
// ════════════════════════════════════════════════════════════════════════════════
const checkDifferenceSpots = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { game_id }  = req.params;
    const user_id      = req.user.role_id;
    const { image_id, clicked_spots = [], recipe_id, on_time = false } = req.body;

    if (!image_id)  return res.status(400).json({ message: 'image_id is required.' });
    if (!recipe_id) return res.status(400).json({ message: 'recipe_id is required.' });

    // Resolve game_type_id
    const [gtRows] = await conn.query(
      `SELECT game_type_id FROM game_types WHERE code = 'SPOT_DIFFERENCE'`
    );
    const game_type_id = gtRows[0]?.game_type_id;
    if (!game_type_id) {
      return res.status(500).json({ message: "game_type 'SPOT_DIFFERENCE' not found in DB." });
    }

    // Attempt number
    const [prevSessions] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM game_sessions
       WHERE user_id = ? AND recipe_id = ? AND game_type_id = ?`,
      [user_id, recipe_id, game_type_id]
    );
    const attemptNumber = (prevSessions[0].cnt || 0) + 1;

    // Fetch answer spots
    const [answerSpots] = await conn.query(
      `SELECT spot_id, x_percent, y_percent, radius_percent, label
       FROM difference_spots WHERE image_id = ?`,
      [image_id]
    );

    const total = answerSpots.length;
    const foundSpotIds = new Set();

    const clickResults = clicked_spots.map(({ x_percent, y_percent }) => {
      for (const spot of answerSpots) {
        if (foundSpotIds.has(spot.spot_id)) continue;
        const dx = x_percent - spot.x_percent;
        const dy = y_percent - spot.y_percent;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= spot.radius_percent) {
          foundSpotIds.add(spot.spot_id);
          return { x_percent, y_percent, hit: true, spot_id: spot.spot_id, label: spot.label };
        }
      }
      return { x_percent, y_percent, hit: false };
    });

    const correctCount = foundSpotIds.size;
    const percentage   = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const passed       = percentage >= 60;

    // Points
    let rawPoints = correctCount * POINTS.SPOT_PER_ANOMALY;
    rawPoints += on_time ? POINTS.SPOT_TIME_ATTACK_BONUS : POINTS.SPOT_TIME_ATTACK_FAIL;
    const points_earned = attemptNumber > 1
      ? Math.floor(rawPoints * POINTS.TRY_AGAIN_MULTIPLIER)
      : rawPoints;

    // Save session
    const [result] = await conn.query(
      `INSERT INTO game_sessions
         (user_id, recipe_id, game_type_id, score, total_items, points_earned)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, recipe_id, game_type_id, correctCount, total, points_earned]
    );
    const session_id = result.insertId;

    await conn.query(
      `INSERT INTO points_log (user_id, session_id, points_earned) VALUES (?, ?, ?)`,
      [user_id, session_id, points_earned]
    );

    await conn.commit();

    return res.status(200).json({
      message:           'Spots checked.',
      score:             correctCount,
      total,
      percentage,
      passed,
      attempt_number:    attemptNumber,
      try_again_penalty: attemptNumber > 1,
      raw_points:        rawPoints,
      points_earned,
      on_time,
      click_results:     clickResults,
      answer_spots:      answerSpots, // reveal correct spots after submission
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
  createDifferenceImage,
  createDifferenceSpot,
  deleteDifferenceSpot,
  getDifferenceGame,
  checkDifferenceSpots,
};