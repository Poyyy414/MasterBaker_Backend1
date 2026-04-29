const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// GET ALL ITEMS FOR A GAME (student view — shuffled, no is_correct)
// GET /api/student/games/:game_id/pick-ingredient
// ════════════════════════════════════════════════════════════════════════════════
const getPickIngredientGame = async (req, res) => {
  try {
    const { game_id } = req.params;

    const [game] = await db.query(
      `SELECT game_id, title, description, time_limit FROM games WHERE game_id = ?`, [game_id]
    );
    if (game.length === 0) {
      return res.status(404).json({ message: 'Game not found.' });
    }

    const [items] = await db.query(
      `SELECT item_id, item_text, item_image, question_text, order_index
       FROM game_items
       WHERE game_id = ?
       ORDER BY RAND()`,        // shuffled so student can't guess by position
      [game_id]
    );

    return res.status(200).json({
      game_id:      game[0].game_id,
      title:        game[0].title,
      description:  game[0].description,
      time_limit:   game[0].time_limit,
      question:     items[0]?.question_text || 'Pick the right ingredients.',
      items,        // no is_correct sent to student
    });
  } catch (error) {
    console.error('Get pick ingredient game error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// CREATE GAME ITEM (teacher)
// POST /api/teacher/games/:game_id/pick-ingredient
// Body: { question_text, item_text, item_image, is_correct, order_index }
// ════════════════════════════════════════════════════════════════════════════════
const createGameItem = async (req, res) => {
  try {
    const { game_id } = req.params;
    const { question_text, item_text, item_image, is_correct = false, order_index = 0 } = req.body;

    if (!item_text) {
      return res.status(400).json({ message: 'item_text is required.' });
    }

    const [game] = await db.query(
      `SELECT game_id FROM games WHERE game_id = ?`, [game_id]
    );
    if (game.length === 0) {
      return res.status(404).json({ message: 'Game not found.' });
    }

    const [result] = await db.query(
      `INSERT INTO game_items (game_id, question_text, item_text, item_image, is_correct, order_index)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [game_id, question_text || null, item_text, item_image || null, is_correct ? 1 : 0, order_index]
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
// GET ALL ITEMS FOR A GAME (teacher view — includes is_correct)
// GET /api/teacher/games/:game_id/pick-ingredient
// ════════════════════════════════════════════════════════════════════════════════
const getGameItemsTeacher = async (req, res) => {
  try {
    const { game_id } = req.params;

    const [game] = await db.query(
      `SELECT game_id, title FROM games WHERE game_id = ?`, [game_id]
    );
    if (game.length === 0) {
      return res.status(404).json({ message: 'Game not found.' });
    }

    const [items] = await db.query(
      `SELECT item_id, game_id, question_text, item_text, item_image, is_correct, order_index
       FROM game_items
       WHERE game_id = ?
       ORDER BY order_index`,
      [game_id]
    );

    return res.status(200).json({
      game_id: game[0].game_id,
      title:   game[0].title,
      items,
    });
  } catch (error) {
    console.error('Get game items teacher error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE GAME ITEM (teacher)
// PUT /api/teacher/game-items/:item_id
// ════════════════════════════════════════════════════════════════════════════════
const updateGameItem = async (req, res) => {
  try {
    const { item_id } = req.params;
    const { question_text, item_text, item_image, is_correct, order_index } = req.body;

    const [existing] = await db.query(
      `SELECT item_id FROM game_items WHERE item_id = ?`, [item_id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Game item not found.' });
    }

    await db.query(
      `UPDATE game_items SET
        question_text = COALESCE(?, question_text),
        item_text     = COALESCE(?, item_text),
        item_image    = COALESCE(?, item_image),
        is_correct    = COALESCE(?, is_correct),
        order_index   = COALESCE(?, order_index)
       WHERE item_id = ?`,
      [question_text || null, item_text || null, item_image || null,
       is_correct ?? null, order_index ?? null, item_id]
    );

    return res.status(200).json({ message: 'Game item updated.' });
  } catch (error) {
    console.error('Update game item error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE GAME ITEM (teacher)
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
// SUBMIT ANSWER — Pick the Right Ingredient
// POST /api/student/games/:game_id/pick-ingredient/submit
// Body: { selected_item_ids: [1, 3, 5] }
// ════════════════════════════════════════════════════════════════════════════════
const submitPickIngredient = async (req, res) => {
  try {
    const { game_id } = req.params;
    const student_id = req.user.role_id;
    const { selected_item_ids } = req.body;

    if (!Array.isArray(selected_item_ids) || selected_item_ids.length === 0) {
      return res.status(400).json({ message: 'selected_item_ids must be a non-empty array.' });
    }

    // get all correct items
    const [correctItems] = await db.query(
      `SELECT item_id, item_text FROM game_items WHERE game_id = ? AND is_correct = 1`,
      [game_id]
    );

    // get all wrong items selected
    const [allItems] = await db.query(
      `SELECT item_id, item_text, is_correct FROM game_items WHERE game_id = ?`,
      [game_id]
    );

    const correctIds   = correctItems.map(i => i.item_id);
    const correctCount = selected_item_ids.filter(id => correctIds.includes(id)).length;
    const wrongCount   = selected_item_ids.filter(id => !correctIds.includes(id)).length;
    const total        = correctIds.length;
    const percentage   = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const passed       = percentage >= 60;

    // save session
    await db.query(
      `INSERT INTO game_sessions (game_id, student_id, score, total, completed, ended_at)
       VALUES (?, ?, ?, ?, 1, NOW())`,
      [game_id, student_id, correctCount, total]
    );

    // show results with each item marked
    const results = allItems.map(item => ({
      item_id:    item.item_id,
      item_text:  item.item_text,
      is_correct: item.is_correct,
      selected:   selected_item_ids.includes(item.item_id),
    }));

    return res.status(200).json({
      message:    'Pick ingredient submitted.',
      score:      correctCount,
      total,
      wrong:      wrongCount,
      percentage,
      passed,
      results,
    });
  } catch (error) {
    console.error('Submit pick ingredient error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  getPickIngredientGame,
  getGameItemsTeacher,
  createGameItem,
  updateGameItem,
  deleteGameItem,
  submitPickIngredient,
};