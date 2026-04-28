const db = require('../config/db');

// ─── GET ALL STUDENTS ─────────────────────────────────────────────────────────
const getAllStudents = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT s.student_id, s.grade_level, s.section,
             u.user_id, u.firstname, u.lastname, u.email, u.created_at
      FROM students s
      JOIN users u ON s.user_id = u.user_id
    `);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get all students error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ─── GET STUDENT BY ID ────────────────────────────────────────────────────────
const getStudentById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(`
      SELECT s.student_id, s.grade_level, s.section,
             u.user_id, u.firstname, u.lastname, u.email, u.created_at
      FROM students s
      JOIN users u ON s.user_id = u.user_id
      WHERE s.student_id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    return res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Get student by ID error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ─── UPDATE STUDENT ───────────────────────────────────────────────────────────
const updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstname, lastname, grade_level, section } = req.body;

    // Check student exists
    const [student] = await db.query(
      'SELECT * FROM students WHERE student_id = ?', [id]
    );
    if (student.length === 0) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    const userId = student[0].user_id;

    // Update users table
    if (firstname || lastname) {
      await db.query(
        `UPDATE users SET firstname = COALESCE(?, firstname),
                          lastname  = COALESCE(?, lastname)
         WHERE user_id = ?`,
        [firstname || null, lastname || null, userId]
      );
    }

    // Update students table
    await db.query(
      `UPDATE students SET grade_level = COALESCE(?, grade_level),
                           section     = COALESCE(?, section)
       WHERE student_id = ?`,
      [grade_level || null, section || null, id]
    );

    return res.status(200).json({ message: 'Student updated successfully.' });
  } catch (error) {
    console.error('Update student error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ─── DELETE STUDENT ───────────────────────────────────────────────────────────
const deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;

    const [student] = await db.query(
      'SELECT user_id FROM students WHERE student_id = ?', [id]
    );
    if (student.length === 0) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    // Deleting from users will cascade to students
    await db.query('DELETE FROM users WHERE user_id = ?', [student[0].user_id]);

    return res.status(200).json({ message: 'Student deleted successfully.' });
  } catch (error) {
    console.error('Delete student error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { getAllStudents, getStudentById, updateStudent, deleteStudent };