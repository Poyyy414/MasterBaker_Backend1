const db = require('../config/db');

// ─── GET ALL TEACHERS ─────────────────────────────────────────────────────────
const getAllTeachers = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT t.teacher_id, t.specialization, t.department,
             u.user_id, u.firstname, u.lastname, u.email, u.created_at
      FROM teachers t
      JOIN users u ON t.user_id = u.user_id
    `);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Get all teachers error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ─── GET TEACHER BY ID ────────────────────────────────────────────────────────
const getTeacherById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(`
      SELECT t.teacher_id, t.specialization, t.department,
             u.user_id, u.firstname, u.lastname, u.email, u.created_at
      FROM teachers t
      JOIN users u ON t.user_id = u.user_id
      WHERE t.teacher_id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Teacher not found.' });
    }

    return res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Get teacher by ID error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ─── UPDATE TEACHER ───────────────────────────────────────────────────────────
const updateTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstname, lastname, specialization, department } = req.body;

    // Check teacher exists
    const [teacher] = await db.query(
      'SELECT * FROM teachers WHERE teacher_id = ?', [id]
    );
    if (teacher.length === 0) {
      return res.status(404).json({ message: 'Teacher not found.' });
    }

    const userId = teacher[0].user_id;

    // Update users table
    if (firstname || lastname) {
      await db.query(
        `UPDATE users SET firstname = COALESCE(?, firstname),
                          lastname  = COALESCE(?, lastname)
         WHERE user_id = ?`,
        [firstname || null, lastname || null, userId]
      );
    }

    // Update teachers table
    await db.query(
      `UPDATE teachers SET specialization = COALESCE(?, specialization),
                           department     = COALESCE(?, department)
       WHERE teacher_id = ?`,
      [specialization || null, department || null, id]
    );

    return res.status(200).json({ message: 'Teacher updated successfully.' });
  } catch (error) {
    console.error('Update teacher error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ─── DELETE TEACHER ───────────────────────────────────────────────────────────
const deleteTeacher = async (req, res) => {
  try {
    const { id } = req.params;

    const [teacher] = await db.query(
      'SELECT user_id FROM teachers WHERE teacher_id = ?', [id]
    );
    if (teacher.length === 0) {
      return res.status(404).json({ message: 'Teacher not found.' });
    }

    // Deleting from users will cascade to teachers
    await db.query('DELETE FROM users WHERE user_id = ?', [teacher[0].user_id]);

    return res.status(200).json({ message: 'Teacher deleted successfully.' });
  } catch (error) {
    console.error('Delete teacher error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { getAllTeachers, getTeacherById, updateTeacher, deleteTeacher };