const db = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════════
// CREATE QUESTION (with its answer)
// POST /api/checkpoints/:checkpoint_id/questions
//
// Body examples:
//
// multiple_choice:
// { "question_type": "multiple_choice", "question_text": "...", "order_index": 1,
//   "options": [{ "option_text": "A", "is_correct": 0 }, { "option_text": "B", "is_correct": 1 }] }
//
// true_or_false:
// { "question_type": "true_or_false", "question_text": "...", "order_index": 2,
//   "tf_answer": "true" }
//
// identification:
// { "question_type": "identification", "question_text": "...", "order_index": 3,
//   "identification_answer": "Flour" }
//
// matching_type:
// { "question_type": "matching_type", "question_text": "...", "order_index": 4,
//   "matching_pairs": [{ "left_item": "Flour", "right_item": "Structure" }] }
// ════════════════════════════════════════════════════════════════════════════════
const createQuestion = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { checkpoint_id } = req.params;
    const { question_type, question_text, order_index = 0,
            options, tf_answer, identification_answer, matching_pairs } = req.body;

    if (!question_type || !question_text) {
      return res.status(400).json({ message: 'question_type and question_text are required.' });
    }

    const validTypes = ['multiple_choice', 'true_or_false', 'identification', 'matching_type'];
    if (!validTypes.includes(question_type)) {
      return res.status(400).json({ message: `question_type must be one of: ${validTypes.join(', ')}` });
    }

    // Verify checkpoint exists
    const [cp] = await conn.query(
      `SELECT checkpoint_id FROM checkpoints WHERE checkpoint_id = ?`, [checkpoint_id]
    );
    if (cp.length === 0) {
      return res.status(404).json({ message: 'Checkpoint not found.' });
    }

    // Insert question
    const [qResult] = await conn.query(
      `INSERT INTO questions (checkpoint_id, question_type, question_text, order_index)
       VALUES (?, ?, ?, ?)`,
      [checkpoint_id, question_type, question_text, order_index]
    );
    const question_id = qResult.insertId;

    // Insert answer based on type
    switch (question_type) {
      case 'multiple_choice':
        if (!options || options.length === 0) {
          return res.status(400).json({ message: 'options are required for multiple_choice.' });
        }
        for (const opt of options) {
          await conn.query(
            `INSERT INTO question_options (question_id, option_text, is_correct) VALUES (?, ?, ?)`,
            [question_id, opt.option_text, opt.is_correct ? 1 : 0]
          );
        }
        break;

      case 'true_or_false':
        if (!tf_answer) {
          return res.status(400).json({ message: 'tf_answer is required for true_or_false.' });
        }
        await conn.query(
          `INSERT INTO question_tf_answers (question_id, correct_answer) VALUES (?, ?)`,
          [question_id, tf_answer.toLowerCase()]
        );
        break;

      case 'identification':
        if (!identification_answer) {
          return res.status(400).json({ message: 'identification_answer is required for identification.' });
        }
        await conn.query(
          `INSERT INTO question_identification_answers (question_id, correct_answer) VALUES (?, ?)`,
          [question_id, identification_answer]
        );
        break;

      case 'matching_type':
        if (!matching_pairs || matching_pairs.length === 0) {
          return res.status(400).json({ message: 'matching_pairs are required for matching_type.' });
        }
        for (const pair of matching_pairs) {
          await conn.query(
            `INSERT INTO question_matching_pairs (question_id, left_item, right_item) VALUES (?, ?, ?)`,
            [question_id, pair.left_item, pair.right_item]
          );
        }
        break;
    }

    await conn.commit();
    return res.status(201).json({
      message: 'Question created successfully.',
      question_id,
    });
  } catch (error) {
    await conn.rollback();
    console.error('Create question error:', error);
    return res.status(500).json({ message: 'Server error.' });
  } finally {
    conn.release();
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET ALL QUESTIONS OF A CHECKPOINT (with answers)
// GET /api/checkpoints/:checkpoint_id/questions
// ════════════════════════════════════════════════════════════════════════════════
const getQuestionsByCheckpoint = async (req, res) => {
  try {
    const { checkpoint_id } = req.params;

    const [questions] = await db.query(
      `SELECT * FROM questions WHERE checkpoint_id = ? ORDER BY order_index`,
      [checkpoint_id]
    );

    for (const q of questions) {
      switch (q.question_type) {
        case 'multiple_choice': {
          const [opts] = await db.query(
            `SELECT * FROM question_options WHERE question_id = ?`, [q.question_id]
          );
          q.options = opts;
          break;
        }
        case 'true_or_false': {
          const [tf] = await db.query(
            `SELECT * FROM question_tf_answers WHERE question_id = ?`, [q.question_id]
          );
          q.tf_answer = tf[0]?.correct_answer || null;
          break;
        }
        case 'identification': {
          const [ident] = await db.query(
            `SELECT * FROM question_identification_answers WHERE question_id = ?`, [q.question_id]
          );
          q.identification_answer = ident[0]?.correct_answer || null;
          break;
        }
        case 'matching_type': {
          const [pairs] = await db.query(
            `SELECT * FROM question_matching_pairs WHERE question_id = ?`, [q.question_id]
          );
          q.matching_pairs = pairs;
          break;
        }
      }
    }

    return res.status(200).json(questions);
  } catch (error) {
    console.error('Get questions error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE QUESTION
// DELETE /api/questions/:question_id
// ════════════════════════════════════════════════════════════════════════════════
const deleteQuestion = async (req, res) => {
  try {
    const { question_id } = req.params;

    const [existing] = await db.query(
      `SELECT question_id FROM questions WHERE question_id = ?`, [question_id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Question not found.' });
    }

    await db.query(`DELETE FROM questions WHERE question_id = ?`, [question_id]);
    return res.status(200).json({ message: 'Question deleted successfully.' });
  } catch (error) {
    console.error('Delete question error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  createQuestion,
  getQuestionsByCheckpoint,
  deleteQuestion,
};