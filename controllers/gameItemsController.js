const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// GET GAME ITEMS BY RECIPE
// GET /api/teacher/recipes/:recipe_id/game-items  (teacher: manage)
// GET /api/student/recipes/:recipe_id/game-items  (student: play)
// ════════════════════════════════════════════════════════════════════════════════
const getGameItems = async (req, res) => {
  try {
    const { recipe_id } = req.params;

    const [rows] = await db.query(
      `SELECT item_id, recipe_id, name, image_url, is_correct
       FROM game_items
       WHERE recipe_id = ?
       ORDER BY RAND()`,
      [recipe_id]
    );

    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get game items error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// CREATE GAME ITEM
// POST /api/teacher/recipes/:recipe_id/game-items
// Body: { name, image_url, is_correct }
// ════════════════════════════════════════════════════════════════════════════════
const createGameItem = async (req, res) => {
  try {
    const { recipe_id } = req.params;
    const { name, image_url, is_correct = false } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'name is required.' });
    }

    const [result] = await db.query(
      `INSERT INTO game_items (recipe_id, name, image_url, is_correct)
       VALUES (?, ?, ?, ?)`,
      [recipe_id, name, image_url || null, is_correct ? 1 : 0]
    );

    return res.status(201).json({
      message: 'Game item created.',
      item_id: result.insertId,
    });
  } catch (error) {
    console.error('Create game item error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE GAME ITEM
// PUT /api/teacher/game-items/:item_id
// ════════════════════════════════════════════════════════════════════════════════
const updateGameItem = async (req, res) => {
  try {
    const { item_id } = req.params;
    const { name, image_url, is_correct } = req.body;

    const [existing] = await db.query(
      `SELECT item_id FROM game_items WHERE item_id = ?`, [item_id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Game item not found.' });
    }

    await db.query(
      `UPDATE game_items SET
        name       = COALESCE(?, name),
        image_url  = COALESCE(?, image_url),
        is_correct = COALESCE(?, is_correct)
       WHERE item_id = ?`,
      [name || null, image_url || null, is_correct ?? null, item_id]
    );

    return res.status(200).json({ message: 'Game item updated.' });
  } catch (error) {
    console.error('Update game item error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE GAME ITEM
// DELETE /api/teacher/game-items/:item_id
// ════════════════════════════════════════════════════════════════════════════════
const deleteGameItem = async (req, res) => {
  try {
    const { item_id } = req.params;

    const [existing] = await db.query(
      `SELECT item_id FROM game_items WHERE item_id = ?`, [item_id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Game item not found.' });
    }

    await db.query(`DELETE FROM game_items WHERE item_id = ?`, [item_id]);
    return res.status(200).json({ message: 'Game item deleted.' });
  } catch (error) {
    console.error('Delete game item error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// CHECK STUDENT ANSWERS — Pick the Right Ingredient
// POST /api/student/recipes/:recipe_id/game-items/check
// Body: { selected_item_ids: [1, 3, 5] }
// ════════════════════════════════════════════════════════════════════════════════
const checkGameItems = async (req, res) => {
  try {
    const { recipe_id } = req.params;
    const { selected_item_ids } = req.body;

    if (!Array.isArray(selected_item_ids)) {
      return res.status(400).json({ message: 'selected_item_ids must be an array.' });
    }

    const [correctItems] = await db.query(
      `SELECT item_id FROM game_items WHERE recipe_id = ? AND is_correct = 1`,
      [recipe_id]
    );

    const correctIds   = correctItems.map(i => i.item_id);
    const correctCount = selected_item_ids.filter(id => correctIds.includes(id)).length;
    const total        = correctIds.length;
    const points       = Math.round((correctCount / total) * 100);

    return res.status(200).json({
      score:           correctCount,
      total_items:     total,
      points_earned:   points,
      correct_item_ids: correctIds,
    });
  } catch (error) {
    console.error('Check game items error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  getGameItems,
  createGameItem,
  updateGameItem,
  deleteGameItem,
  checkGameItems,
};
