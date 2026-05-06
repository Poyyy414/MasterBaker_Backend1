const db = require('../config/db');
const { POINTS, applyTryAgain }         = require('./pointsConfig');
const { getAttemptNumber, awardBadges } = require('./gamificationController');

// REAL game_items columns: item_id, recipe_id, name, image_url, is_correct
// recipe_id here = game_id from games table

const getGameItemsTeacher = async (req, res) => {
  try {
    const { game_id } = req.params;
    const [game] = await db.query(`SELECT game_id, title FROM games WHERE game_id = ?`, [game_id]);
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [items] = await db.query(
      `SELECT item_id, recipe_id, name, image_url, is_correct
       FROM game_items WHERE recipe_id = ? ORDER BY item_id`,
      [game_id]
    );
    return res.status(200).json({ game_id: game[0].game_id, title: game[0].title, items });
  } catch (error) {
    console.error('Get game items teacher error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const createGameItem = async (req, res) => {
  try {
    const { game_id } = req.params;
    const { name, image_url, is_correct = false } = req.body;

    if (!name) return res.status(400).json({ message: 'name is required.' });

    const [game] = await db.query(`SELECT game_id FROM games WHERE game_id = ?`, [game_id]);
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [result] = await db.query(
      `INSERT INTO game_items (recipe_id, name, image_url, is_correct) VALUES (?, ?, ?, ?)`,
      [game_id, name, image_url || null, is_correct ? 1 : 0]
    );
    return res.status(201).json({ message: 'Game item created.', item_id: result.insertId });
  } catch (error) {
    console.error('Create game item error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const updateGameItem = async (req, res) => {
  try {
    const { item_id } = req.params;
    const { name, image_url, is_correct } = req.body;

    const [existing] = await db.query(`SELECT item_id FROM game_items WHERE item_id = ?`, [item_id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Game item not found.' });

    await db.query(
      `UPDATE game_items SET
         name       = COALESCE(?, name),
         image_url  = COALESCE(?, image_url),
         is_correct = COALESCE(?, is_correct)
       WHERE item_id = ?`,
      [name || null, image_url || null,
       is_correct != null ? (is_correct ? 1 : 0) : null, item_id]
    );
    return res.status(200).json({ message: 'Game item updated.' });
  } catch (error) {
    console.error('Update game item error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

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

const getPickIngredientGame = async (req, res) => {
  try {
    const { game_id } = req.params;
    const [game] = await db.query(
      `SELECT game_id, title, description, time_limit FROM games WHERE game_id = ?`, [game_id]
    );
    if (game.length === 0) return res.status(404).json({ message: 'Game not found.' });

    const [items] = await db.query(
      `SELECT item_id, name, image_url FROM game_items WHERE recipe_id = ? ORDER BY RAND()`,
      [game_id]
    );
    return res.status(200).json({
      game_id:     game[0].game_id,
      title:       game[0].title,
      description: game[0].description,
      time_limit:  game[0].time_limit,
      question:    'Pick all the correct ingredients.',
      items,
    });
  } catch (error) {
    console.error('Get pick ingredient game error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const submitPickIngredient = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { game_id }  = req.params;
    const user_id      = req.user.user_id;   // use user_id from token, NOT role_id
    const { selected_item_ids, on_time = false } = req.body;

    if (!Array.isArray(selected_item_ids) || selected_item_ids.length === 0) {
      return res.status(400).json({ message: 'selected_item_ids must be a non-empty array.' });
    }

    const [gtRows] = await conn.query(
      `SELECT game_type_id FROM game_types WHERE code = 'PICK_INGREDIENT'`
    );
    if (!gtRows[0]) return res.status(500).json({ message: "game_type 'PICK_INGREDIENT' not found." });
    const game_type_id  = gtRows[0].game_type_id;
    const recipe_id     = parseInt(game_id);
    const attemptNumber = await getAttemptNumber(conn, user_id, recipe_id, game_type_id);

    const [correctItems] = await conn.query(
      `SELECT item_id FROM game_items WHERE recipe_id = ? AND is_correct = 1`, [game_id]
    );
    const [allItems] = await conn.query(
      `SELECT item_id, name, is_correct FROM game_items WHERE recipe_id = ?`, [game_id]
    );

    const correctIds   = correctItems.map(i => i.item_id);
    const correctCount = selected_item_ids.filter(id => correctIds.includes(id)).length;
    const wrongCount   = selected_item_ids.filter(id => !correctIds.includes(id)).length;
    const total        = correctIds.length;
    const percentage   = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const passed       = percentage >= 60;

    const rawPoints    = correctCount * POINTS.PTRI_CORRECT_INGREDIENT
                       + (on_time ? POINTS.PTRI_TIME_ATTACK_BONUS : 0);
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
      message: 'Pick ingredient submitted.',
      score: correctCount, total, wrong: wrongCount,
      percentage, passed,
      attempt_number: attemptNumber, try_again_penalty: attemptNumber > 1,
      raw_points: rawPoints, points_earned, on_time,
      results: allItems.map(item => ({
        item_id:    item.item_id,
        name:       item.name,
        is_correct: !!item.is_correct,
        selected:   selected_item_ids.includes(item.item_id),
      })),
      badges_earned,
    });
  } catch (error) {
    await conn.rollback();
    console.error('Submit pick ingredient error:', error);
    return res.status(500).json({ message: 'Server error.' });
  } finally {
    conn.release();
  }
};

module.exports = {
  getPickIngredientGame, getGameItemsTeacher,
  createGameItem, updateGameItem, deleteGameItem,
  submitPickIngredient,
};