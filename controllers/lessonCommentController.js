const db = require('../config/db');

// GET /api/lessons/:lessonId/messages
const getMyThread = async (req, res) => {
  const { lessonId } = req.params;
  const studentId    = req.user.user_id;
  try {
    const [rows] = await db.query(
      `SELECT m.id, m.sender_id,
              CONCAT(u.firstname, ' ', u.lastname) AS sender_name,
              u.avatar_url                          AS sender_avatar,
              m.sender_role, m.content, m.created_at
       FROM lesson_messages m
       LEFT JOIN users u ON u.user_id = m.sender_id
       WHERE m.lesson_id = ? AND m.student_id = ?
       ORDER BY m.created_at ASC`,
      [lessonId, studentId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[getMyThread]', err);
    res.status(500).json({ message: 'Failed to fetch messages.' });
  }
};

// POST /api/lessons/:lessonId/messages
const sendMessage = async (req, res) => {
  const { lessonId } = req.params;
  const { content }  = req.body;
  const user         = req.user;

  if (!content?.trim()) {
    return res.status(400).json({ message: 'Message cannot be empty.' });
  }

  try {
    const [users] = await db.query(
      'SELECT firstname, lastname, avatar_url FROM users WHERE user_id = ?',
      [user.user_id]
    );
    const u        = users[0] ?? {};
    const fullName = `${u.firstname ?? ''} ${u.lastname ?? ''}`.trim() || 'User';

    const [result] = await db.query(
      `INSERT INTO lesson_messages
         (lesson_id, student_id, student_name, sender_id, sender_name, sender_role, content)
       VALUES (?, ?, ?, ?, ?, 'student', ?)`,
      [lessonId, user.user_id, fullName, user.user_id, fullName, content.trim()]
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
    res.status(500).json({ message: 'Failed to send message.' });
  }
};

// GET /api/lessons/:lessonId/threads
const getThreadList = async (req, res) => {
  const { lessonId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT m1.student_id,
              CONCAT(u.firstname, ' ', u.lastname) AS student_name,
              u.avatar_url                          AS student_avatar,
              MAX(m1.created_at)                    AS last_message_at,
              COUNT(*)                              AS message_count,
              (SELECT content FROM lesson_messages m2
               WHERE m2.lesson_id = m1.lesson_id AND m2.student_id = m1.student_id
               ORDER BY created_at DESC LIMIT 1)   AS last_message
       FROM lesson_messages m1
       LEFT JOIN users u ON u.user_id = m1.student_id
       WHERE m1.lesson_id = ?
       GROUP BY m1.student_id, u.firstname, u.lastname, u.avatar_url
       ORDER BY last_message_at DESC`,
      [lessonId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[getThreadList]', err);
    res.status(500).json({ message: 'Failed to fetch threads.' });
  }
};

// GET /api/lessons/:lessonId/threads/:studentId
const getStudentThread = async (req, res) => {
  const { lessonId, studentId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT m.id, m.sender_id,
              CONCAT(u.firstname, ' ', u.lastname) AS sender_name,
              u.avatar_url                          AS sender_avatar,
              m.sender_role, m.content, m.created_at
       FROM lesson_messages m
       LEFT JOIN users u ON u.user_id = m.sender_id
       WHERE m.lesson_id = ? AND m.student_id = ?
       ORDER BY m.created_at ASC`,
      [lessonId, studentId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[getStudentThread]', err);
    res.status(500).json({ message: 'Failed to fetch thread.' });
  }
};

// POST /api/lessons/:lessonId/threads/:studentId
const replyToStudent = async (req, res) => {
  const { lessonId, studentId } = req.params;
  const { content }             = req.body;
  const teacher                 = req.user;

  if (!content?.trim()) {
    return res.status(400).json({ message: 'Reply cannot be empty.' });
  }

  try {
    const [students] = await db.query(
      `SELECT CONCAT(u.firstname, ' ', u.lastname) AS student_name
       FROM users u WHERE u.user_id = ?`,
      [studentId]
    );
    if (!students.length) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    const [teachers] = await db.query(
      'SELECT firstname, lastname FROM users WHERE user_id = ?',
      [teacher.user_id]
    );
    const t           = teachers[0] ?? {};
    const teacherName = `${t.firstname ?? ''} ${t.lastname ?? ''}`.trim() || 'Teacher';

    const [result] = await db.query(
      `INSERT INTO lesson_messages
         (lesson_id, student_id, student_name, sender_id, sender_name, sender_role, content)
       VALUES (?, ?, ?, ?, ?, 'teacher', ?)`,
      [lessonId, studentId, students[0].student_name, teacher.user_id, teacherName, content.trim()]
    );
    const [rows] = await db.query(
      `SELECT m.id, m.sender_id,
              CONCAT(u.firstname, ' ', u.lastname) AS sender_name,
              u.avatar_url                          AS sender_avatar,
              m.sender_role, m.content, m.created_at
       FROM lesson_messages m
       LEFT JOIN users u ON u.user_id = m.sender_id
       WHERE m.id = ?`,
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[replyToStudent]', err);
    res.status(500).json({ message: 'Failed to send reply.' });
  }
};

// DELETE /api/lessons/messages/:messageId
const deleteMessage = async (req, res) => {
  const { messageId }          = req.params;
  const { user_id: uid, role } = req.user;
  try {
    const [rows] = await db.query('SELECT * FROM lesson_messages WHERE id = ?', [messageId]);
    if (!rows.length) return res.status(404).json({ message: 'Message not found.' });

    if (rows[0].sender_id !== uid && role !== 'teacher') {
      return res.status(403).json({ message: 'Not allowed to delete this message.' });
    }
    await db.query('DELETE FROM lesson_messages WHERE id = ?', [messageId]);
    res.json({ message: 'Deleted.' });
  } catch (err) {
    console.error('[deleteMessage]', err);
    res.status(500).json({ message: 'Failed to delete message.' });
  }
};

module.exports = { getMyThread, sendMessage, getThreadList, getStudentThread, replyToStudent, deleteMessage };