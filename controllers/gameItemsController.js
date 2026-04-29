const db = require('../config/db');
const { POINTS } = require('./pointsConfig'); // ✅ no circular dep

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
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [items] = await db.query(
      `SELECT item_id, item_text, item_image, question_text, order_index
       FROM game_items
       WHERE game_id = ?
       ORDER BY RAND()`,
      [game_id]
    );

    return res.status(200).json({
      game_id:     game[0].game_id,
      title:       game[0].title,
      description: game[0].description,
      time_limit:  game[0].time_limit,
      question:    items[0]?.question_text || 'Pick the right ingredients.',
      items,
    });
  } catch (error) {
    console.error('Get pick ingredient game error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// SUBMIT ANSWER — Pick the Right Ingredient
// POST /api/student/games/:game_id/pick-ingredient/submit
//
// Body:
//   selected_item_ids  INT[]   — IDs the student picked
//   recipe_id          INT     — for session logging
//   on_time            BOOL    — true if finished within time_limit
// ════════════════════════════════════════════════════════════════════════════════
const submitPickIngredient = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { game_id }  = req.params;
    const user_id      = req.user.role_id;
    const { selected_item_ids, recipe_id, on_time = false } = req.body;

    if (!Array.isArray(selected_item_ids) || selected_item_ids.length === 0) {
      return res.status(400).json({ message: 'selected_item_ids must be a non-empty array.' });
    }
    if (!recipe_id) {
      return res.status(400).json({ message: 'recipe_id is required.' });
    }

    // Resolve game_type_id for PICK_INGREDIENT
    const [gtRows] = await conn.query(
      `SELECT game_type_id FROM game_types WHERE code = 'PICK_INGREDIENT'`
    );
    const game_type_id = gtRows[0].game_type_id;

    // Attempt number (try-again tracking)
    const [prevSessions] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM game_sessions
       WHERE user_id = ? AND recipe_id = ? AND game_type_id = ?`,
      [user_id, recipe_id, game_type_id]
    );
    const attemptNumber = (prevSessions[0].cnt || 0) + 1;

    // Fetch correct and all items
    const [correctItems] = await conn.query(
      `SELECT item_id FROM game_items WHERE game_id = ? AND is_correct = 1`, [game_id]
    );
    const [allItems] = await conn.query(
      `SELECT item_id, item_text, is_correct FROM game_items WHERE game_id = ?`, [game_id]
    );

    const correctIds   = correctItems.map(i => i.item_id);
    const correctCount = selected_item_ids.filter(id => correctIds.includes(id)).length;
    const wrongCount   = selected_item_ids.filter(id => !correctIds.includes(id)).length;
    const total        = correctIds.length;
    const percentage   = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const passed       = percentage >= 60;

    // ── Points calculation ──────────────────────────────────────────────────
    let rawPoints = correctCount * POINTS.PTRI_CORRECT_INGREDIENT;
    rawPoints += on_time ? POINTS.PTRI_TIME_ATTACK_BONUS : POINTS.PTRI_TIME_ATTACK_FAIL;
    const points_earned = attemptNumber > 1
      ? Math.floor(rawPoints * POINTS.TRY_AGAIN_MULTIPLIER)
      : rawPoints;

    // ── Save session ────────────────────────────────────────────────────────
    const [result] = await conn.query(
      `INSERT INTO game_sessions
         (user_id, recipe_id, game_type_id, score, total_items, points_earned)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, recipe_id, game_type_id, correctCount, total, points_earned]
    );
    const session_id = result.insertId;

    // ── Log points ──────────────────────────────────────────────────────────
    await conn.query(
      `INSERT INTO points_log (user_id, session_id, points_earned) VALUES (?, ?, ?)`,
      [user_id, session_id, points_earned]
    );

    await conn.commit();

    const results = allItems.map(item => ({
      item_id:    item.item_id,
      item_text:  item.item_text,
      is_correct: !!item.is_correct,
      selected:   selected_item_ids.includes(item.item_id),
    }));

    return res.status(200).json({
      message:           'Pick ingredient submitted.',
      score:             correctCount,
      total,
      wrong:             wrongCount,
      percentage,
      passed,
      attempt_number:    attemptNumber,
      try_again_penalty: attemptNumber > 1,
      raw_points:        rawPoints,
      points_earned,
      on_time,
      results,
    });
  } catch (error) {
    await conn.rollback();
    console.error('Submit pick ingredient error:', error);
    return res.status(500).json({ message: 'Server error.' });
  } finally {
    conn.release();
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// CREATE GAME ITEM (teacher)
// POST /api/teacher/games/:game_id/pick-ingredient
// ════════════════════════════════════════════════════════════════════════════════
const createGameItem = async (req, res) => {
  try {
    const { game_id } = req.params;
    const { question_text, item_text, item_image, is_correct = false, order_index = 0 } = req.body;

    if (!item_text) return res.status(400).json({ message: 'item_text is required.' });

    const [game] = await db.query(`SELECT game_id FROM games WHERE game_id = ?`, [game_id]);
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [result] = await db.query(
      `INSERT INTO game_items (game_id, question_text, item_text, item_image, is_correct, order_index)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [game_id, question_text || null, item_text, item_image || null, is_correct ? 1 : 0, order_index]
    );

    return res.status(201).json({ message: 'Game item created.', item_id: result.insertId });
  } catch (error) {
    console.error('Create game item error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET ALL ITEMS (teacher — includes is_correct)
// GET /api/teacher/games/:game_id/pick-ingredient
// ════════════════════════════════════════════════════════════════════════════════
const getGameItemsTeacher = async (req, res) => {
  try {
    const { game_id } = req.params;

    const [game] = await db.query(`SELECT game_id, title FROM games WHERE game_id = ?`, [game_id]);
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [items] = await db.query(
      `SELECT item_id, game_id, question_text, item_text, item_image, is_correct, order_index
       FROM game_items WHERE game_id = ? ORDER BY order_index`,
      [game_id]
    );

    return res.status(200).json({ game_id: game[0].game_id, title: game[0].title, items });
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

    const [existing] = await db.query(`SELECT item_id FROM game_items WHERE item_id = ?`, [item_id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Game item not found.' });

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

    const [existing] = await db.query(`SELECT item_id FROM game_items WHERE item_id = ?`, [item_id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Game item not found.' });

    await db.query(`DELETE FROM game_items WHERE item_id = ?`, [item_id]);
    return res.status(200).json({ message: 'Game item deleted.' });
  } catch (error) {
    console.error('Delete game item error:', error);
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