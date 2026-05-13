const db = require('../config/db');

// GET /api/lessons/:lessonId/messages — all public comments for this lesson
const getMyThread = async (req, res) => {
  const { lessonId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT m.id, m.sender_id,
              CONCAT(u.firstname, ' ', u.lastname) AS sender_name,
              u.avatar_url                          AS sender_avatar,
              m.sender_role, m.content, m.created_at
       FROM lesson_messages m
       LEFT JOIN users u ON u.user_id = m.sender_id
       WHERE m.lesson_id = ?
       ORDER BY m.created_at ASC`,
      [lessonId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[getMyThread]', err);
    res.status(500).json({ message: 'Failed to fetch comments.' });
  }
};

// POST /api/lessons/:lessonId/messages — anyone posts a comment
const sendMessage = async (req, res) => {
  const { lessonId } = req.params;
  const { content }  = req.body;
  const user         = req.user;

  if (!content?.trim()) {
    return res.status(400).json({ message: 'Comment cannot be empty.' });
  }

  try {
    const [users] = await db.query(
      'SELECT firstname, lastname, avatar_url FROM users WHERE user_id = ?',
      [user.user_id]
    );
    const u        = users[0] ?? {};
    const fullName = `${u.firstname ?? ''} ${u.lastname ?? ''}`.trim() || 'User';
    const role     = user.role ?? 'student';

    const [result] = await db.query(
      `INSERT INTO lesson_messages
         (lesson_id, student_id, student_name, sender_id, sender_name, sender_role, content)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [lessonId, user.user_id, fullName, user.user_id, fullName, role, content.trim()]
    );
    const [rows] = await db.query(
      `SELECT m.id, m.sender_id,
              CONCAT(u2.firstname, ' ', u2.lastname) AS sender_name,
              u2.avatar_url                           AS sender_avatar,
              m.sender_role, m.content, m.created_at
       FROM lesson_messages m
       LEFT JOIN users u2 ON u2.user_id = m.sender_id
       WHERE m.id = ?`,
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[sendMessage]', err);
    res.status(500).json({ message: 'Failed to post comment.' });
  }
};

// DELETE /api/lessons/messages/:messageId — delete own comment (teacher can delete any)
const deleteMessage = async (req, res) => {
  const { messageId }          = req.params;
  const { user_id: uid, role } = req.user;
  try {
    const [rows] = await db.query('SELECT * FROM lesson_messages WHERE id = ?', [messageId]);
    if (!rows.length) return res.status(404).json({ message: 'Comment not found.' });

    if (rows[0].sender_id !== uid && role !== 'teacher') {
      return res.status(403).json({ message: 'Not allowed to delete this comment.' });
    }
    await db.query('DELETE FROM lesson_messages WHERE id = ?', [messageId]);
    res.json({ message: 'Deleted.' });
  } catch (err) {
    console.error('[deleteMessage]', err);
    res.status(500).json({ message: 'Failed to delete comment.' });
  }
};

const getThreadList    = getMyThread;
const getStudentThread = getMyThread;
const replyToStudent   = sendMessage;

module.exports = { getMyThread, sendMessage, getThreadList, getStudentThread, replyToStudent, deleteMessage };