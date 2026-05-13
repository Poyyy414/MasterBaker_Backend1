const db = require('../config/db');

const resolveName = (u) =>
  u.name || `${u.firstname ?? u.firstName ?? ''}`.trim() || 'User';

const getMyThread = async (req, res) => {
  const { lessonId } = req.params;
  const studentId = req.user.id;
  try {
    const [rows] = await db.query(
      `SELECT id, sender_id, sender_name, sender_role, content, created_at
       FROM lesson_messages
       WHERE lesson_id = ? AND student_id = ?
       ORDER BY created_at ASC`,
      [lessonId, studentId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[getMyThread]', err);
    res.status(500).json({ message: 'Failed to fetch messages.' });
  }
};

const sendMessage = async (req, res) => {
  const { lessonId } = req.params;
  const { content } = req.body;
  const user = req.user;

  if (!content?.trim()) {
    return res.status(400).json({ message: 'Message cannot be empty.' });
  }

  const sender_name = resolveName(user);

  try {
    const [result] = await db.query(
      `INSERT INTO lesson_messages
         (lesson_id, student_id, student_name, sender_id, sender_name, sender_role, content)
       VALUES (?, ?, ?, ?, ?, 'student', ?)`,
      [lessonId, user.id, sender_name, user.id, sender_name, content.trim()]
    );
    const [rows] = await db.query('SELECT * FROM lesson_messages WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[sendMessage]', err);
    res.status(500).json({ message: 'Failed to send message.' });
  }
};

const getThreadList = async (req, res) => {
  const { lessonId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT student_id, student_name,
              MAX(created_at) AS last_message_at,
              COUNT(*) AS message_count,
              (SELECT content FROM lesson_messages m2
               WHERE m2.lesson_id = m1.lesson_id AND m2.student_id = m1.student_id
               ORDER BY created_at DESC LIMIT 1) AS last_message
       FROM lesson_messages m1
       WHERE lesson_id = ?
       GROUP BY student_id, student_name
       ORDER BY last_message_at DESC`,
      [lessonId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[getThreadList]', err);
    res.status(500).json({ message: 'Failed to fetch threads.' });
  }
};

const getStudentThread = async (req, res) => {
  const { lessonId, studentId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT id, sender_id, sender_name, sender_role, content, created_at
       FROM lesson_messages
       WHERE lesson_id = ? AND student_id = ?
       ORDER BY created_at ASC`,
      [lessonId, studentId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[getStudentThread]', err);
    res.status(500).json({ message: 'Failed to fetch thread.' });
  }
};

const replyToStudent = async (req, res) => {
  const { lessonId, studentId } = req.params;
  const { content } = req.body;
  const teacher = req.user;

  if (!content?.trim()) {
    return res.status(400).json({ message: 'Reply cannot be empty.' });
  }

  try {
    const [students] = await db.query(
      `SELECT student_name FROM lesson_messages
       WHERE lesson_id = ? AND student_id = ? LIMIT 1`,
      [lessonId, studentId]
    );
    if (!students.length) {
      return res.status(404).json({ message: 'No thread found for this student.' });
    }

    const [result] = await db.query(
      `INSERT INTO lesson_messages
         (lesson_id, student_id, student_name, sender_id, sender_name, sender_role, content)
       VALUES (?, ?, ?, ?, ?, 'teacher', ?)`,
      [lessonId, studentId, students[0].student_name, teacher.id, resolveName(teacher), content.trim()]
    );
    const [rows] = await db.query('SELECT * FROM lesson_messages WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[replyToStudent]', err);
    res.status(500).json({ message: 'Failed to send reply.' });
  }
};

const deleteMessage = async (req, res) => {
  const { messageId } = req.params;
  const { id: uid, role } = req.user;
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