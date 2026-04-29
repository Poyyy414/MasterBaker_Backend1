const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// GET DIFFERENCE GAME BY RECIPE
// GET /api/student/recipes/:recipe_id/difference
// ════════════════════════════════════════════════════════════════════════════════
const getDifferenceGame = async (req, res) => {
  try {
    const { recipe_id } = req.params;

    const [images] = await db.query(
      `SELECT gdi.image_id, gdi.image_a_url, gdi.image_b_url,
              COUNT(gds.spot_id) AS total_spots
       FROM game_difference_images gdi
       LEFT JOIN game_difference_spots gds ON gdi.image_id = gds.image_id
       WHERE gdi.recipe_id = ?
       GROUP BY gdi.image_id`,
      [recipe_id]
    );

    if (images.length === 0) {
      return res.status(404).json({ message: 'No difference game found for this recipe.' });
    }

    return res.status(200).json(images[0]);
  } catch (error) {
    console.error('Get difference game error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// CREATE DIFFERENCE IMAGE (Teacher)
// POST /api/teacher/recipes/:recipe_id/difference
// Body: { image_a_url, image_b_url }
// ════════════════════════════════════════════════════════════════════════════════
const createDifferenceImage = async (req, res) => {
  try {
    const { recipe_id }              = req.params;
    const { image_a_url, image_b_url } = req.body;

    if (!image_a_url || !image_b_url) {
      return res.status(400).json({ message: 'image_a_url and image_b_url are required.' });
    }

    const [result] = await db.query(
      `INSERT INTO game_difference_images (recipe_id, image_a_url, image_b_url)
       VALUES (?, ?, ?)`,
      [recipe_id, image_a_url, image_b_url]
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
// ADD DIFFERENCE SPOT (Teacher)
// POST /api/teacher/difference/:image_id/spots
// Body: { x_coordinate, y_coordinate, radius }
// ════════════════════════════════════════════════════════════════════════════════
const createDifferenceSpot = async (req, res) => {
  try {
    const { image_id }                           = req.params;
    const { x_coordinate, y_coordinate, radius = 20.0 } = req.body;

    if (x_coordinate == null || y_coordinate == null) {
      return res.status(400).json({ message: 'x_coordinate and y_coordinate are required.' });
    }

    const [result] = await db.query(
      `INSERT INTO game_difference_spots (image_id, x_coordinate, y_coordinate, radius)
       VALUES (?, ?, ?, ?)`,
      [image_id, x_coordinate, y_coordinate, radius]
    );

    return res.status(201).json({
      message: 'Difference spot added.',
      spot_id: result.insertId,
    });
  } catch (error) {
    console.error('Create difference spot error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE DIFFERENCE SPOT (Teacher)
// DELETE /api/teacher/difference/spots/:spot_id
// ════════════════════════════════════════════════════════════════════════════════
const deleteDifferenceSpot = async (req, res) => {
  try {
    const { spot_id } = req.params;

    const [existing] = await db.query(
      `SELECT spot_id FROM game_difference_spots WHERE spot_id = ?`, [spot_id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Spot not found.' });
    }

    await db.query(`DELETE FROM game_difference_spots WHERE spot_id = ?`, [spot_id]);
    return res.status(200).json({ message: 'Spot deleted.' });
  } catch (error) {
    console.error('Delete difference spot error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// CHECK STUDENT TAPPED SPOTS — Spot the Difference
// POST /api/student/difference/:image_id/check
// Body: { tapped_spots: [{ x, y }] }
// ════════════════════════════════════════════════════════════════════════════════
const checkDifferenceSpots = async (req, res) => {
  try {
    const { image_id }   = req.params;
    const { tapped_spots } = req.body;

    if (!Array.isArray(tapped_spots) || tapped_spots.length === 0) {
      return res.status(400).json({ message: 'tapped_spots must be a non-empty array.' });
    }

    const [spots] = await db.query(
      `SELECT * FROM game_difference_spots WHERE image_id = ?`, [image_id]
    );

    let correctCount = 0;
    const results = tapped_spots.map(({ x, y }) => {
      const hit = spots.find(spot => {
        const dist = Math.sqrt(
          Math.pow(spot.x_coordinate - x, 2) + Math.pow(spot.y_coordinate - y, 2)
        );
        return dist <= spot.radius;
      });
      if (hit) correctCount++;
      return { x, y, is_correct: !!hit };
    });

    const total        = spots.length;
    const points       = Math.round((correctCount / total) * 100);

    return res.status(200).json({
      score:         correctCount,
      total_items:   total,
      points_earned: points,
      results,
    });
  } catch (error) {
    console.error('Check difference spots error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  getDifferenceGame,
  createDifferenceImage,
  createDifferenceSpot,
  deleteDifferenceSpot,
  checkDifferenceSpots,
};
