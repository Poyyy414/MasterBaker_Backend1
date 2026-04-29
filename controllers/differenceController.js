const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// GET DIFFERENCE GAME BY GAME ID (student)
// GET /api/student/games/:game_id/difference
// ════════════════════════════════════════════════════════════════════════════════
const getDifferenceGame = async (req, res) => {
  try {
    const { game_id } = req.params;

    const [images] = await db.query(
      `SELECT gdi.image_id, gdi.game_id, gdi.question_text,
              gdi.original_url, gdi.modified_url,
              COUNT(gds.spot_id) AS total_spots
       FROM game_difference_images gdi
       LEFT JOIN game_difference_spots gds ON gdi.image_id = gds.image_id
       WHERE gdi.game_id = ?
       GROUP BY gdi.image_id`,
      [game_id]
    );

    if (images.length === 0) {
      return res.status(404).json({ message: 'No difference game found.' });
    }

    return res.status(200).json({
      game_id:    parseInt(game_id),
      question:   images[0].question_text || 'Spot the difference.',
      image_id:   images[0].image_id,
      original_url: images[0].original_url,
      modified_url: images[0].modified_url,
      total_spots:  images[0].total_spots,
    });
  } catch (error) {
    console.error('Get difference game error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// CREATE DIFFERENCE IMAGE (teacher)
// POST /api/teacher/games/:game_id/difference
// Body: { question_text, original_url, modified_url }
// ════════════════════════════════════════════════════════════════════════════════
const createDifferenceImage = async (req, res) => {
  try {
    const { game_id } = req.params;
    const { question_text, original_url, modified_url } = req.body;

    if (!original_url || !modified_url) {
      return res.status(400).json({ message: 'original_url and modified_url are required.' });
    }

    const [game] = await db.query(
      `SELECT game_id FROM games WHERE game_id = ?`, [game_id]
    );
    if (game.length === 0) {
      return res.status(404).json({ message: 'Game not found.' });
    }

    const [result] = await db.query(
      `INSERT INTO game_difference_images (game_id, question_text, original_url, modified_url)
       VALUES (?, ?, ?, ?)`,
      [game_id, question_text || null, original_url, modified_url]
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
// ADD DIFFERENCE SPOT (teacher)
// POST /api/teacher/difference/:image_id/spots
// Body: { x_coordinate, y_coordinate, radius }
// ════════════════════════════════════════════════════════════════════════════════
const createDifferenceSpot = async (req, res) => {
  try {
    const { image_id } = req.params;
    const { x_coordinate, y_coordinate, radius = 5.0 } = req.body;

    if (x_coordinate == null || y_coordinate == null) {
      return res.status(400).json({ message: 'x_coordinate and y_coordinate are required.' });
    }

    const [image] = await db.query(
      `SELECT image_id FROM game_difference_images WHERE image_id = ?`, [image_id]
    );
    if (image.length === 0) {
      return res.status(404).json({ message: 'Image not found.' });
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
// DELETE DIFFERENCE SPOT (teacher)
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
// SUBMIT SPOT THE DIFFERENCE (student)
// POST /api/student/games/:game_id/difference/submit
// Body: { tapped_spots: [{ x, y }] }
// ════════════════════════════════════════════════════════════════════════════════
const checkDifferenceSpots = async (req, res) => {
  try {
    const { game_id } = req.params;
    const student_id  = req.user.role_id;
    const { tapped_spots } = req.body;

    if (!Array.isArray(tapped_spots) || tapped_spots.length === 0) {
      return res.status(400).json({ message: 'tapped_spots must be a non-empty array.' });
    }

    // get image for this game
    const [images] = await db.query(
      `SELECT image_id FROM game_difference_images WHERE game_id = ?`, [game_id]
    );
    if (images.length === 0) {
      return res.status(404).json({ message: 'No difference image found for this game.' });
    }

    const image_id = images[0].image_id;

    const [spots] = await db.query(
      `SELECT * FROM game_difference_spots WHERE image_id = ?`, [image_id]
    );

    let correctCount = 0;
    const results = tapped_spots.map(({ x, y }) => {
      const hit = spots.find(spot => {
        const dist = Math.sqrt(
          Math.pow(spot.x_coordinate - x, 2) +
          Math.pow(spot.y_coordinate - y, 2)
        );
        return dist <= spot.radius;
      });
      if (hit) correctCount++;
      return { x, y, is_correct: !!hit };
    });

    const total      = spots.length;
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const passed     = percentage >= 60;

    // save session
    await db.query(
      `INSERT INTO game_sessions (game_id, student_id, score, total, completed, ended_at)
       VALUES (?, ?, ?, ?, 1, NOW())`,
      [game_id, student_id, correctCount, total]
    );

    return res.status(200).json({
      message:    'Spot the difference submitted.',
      score:      correctCount,
      total,
      percentage,
      passed,
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