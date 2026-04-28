const db     = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');

// ─── REGISTER ─────────────────────────────────────────────────────────────────
const register = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { firstname, lastname, email, password, grade_level, section, specialization, department } = req.body;
    const role = req.body.role?.toLowerCase().trim(); // normalize here

    if (!firstname || !lastname || !email || !password || !role) {
      return res.status(400).json({ message: 'firstname, lastname, email, password, and role are required.' });
    }

    if (!['student', 'teacher'].includes(role)) {
      return res.status(400).json({ message: 'Role must be student or teacher.' });
    }

    const [existing] = await conn.query('SELECT user_id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [userResult] = await conn.query(
      `INSERT INTO users (firstname, lastname, email, password, role) VALUES (?, ?, ?, ?, ?)`,
      [firstname, lastname, email, hashedPassword, role] // role is now always lowercase
    );
    const user_id = userResult.insertId;

    if (role === 'student') {
      await conn.query(
        `INSERT INTO students (user_id, grade_level, section) VALUES (?, ?, ?)`,
        [user_id, grade_level || null, section || null]
      );
    } else if (role === 'teacher') {
      await conn.query(
        `INSERT INTO teachers (user_id, specialization, department) VALUES (?, ?, ?)`,
        [user_id, specialization || null, department || null]
      );
    }

    await conn.commit();
    return res.status(201).json({ message: 'Account created successfully.' });

  } catch (error) {
    await conn.rollback();
    console.error('Register error:', error);
    return res.status(500).json({ message: 'Server error during registration.' });
  } finally {
    conn.release();
  }
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const user = rows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const role = user.role?.toLowerCase().trim(); // normalize from DB too

    let role_id = null;
    if (role === 'student') {
      const [s] = await db.query('SELECT student_id FROM students WHERE user_id = ?', [user.user_id]);
      role_id = s[0]?.student_id || null;
    } else if (role === 'teacher') {
      const [t] = await db.query('SELECT teacher_id FROM teachers WHERE user_id = ?', [user.user_id]);
      role_id = t[0]?.teacher_id || null;
    }

    const token = jwt.sign(
      { user_id: user.user_id, role, role_id }, // always lowercase in token
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: {
        user_id:   user.user_id,
        role_id,
        firstname: user.firstname,
        lastname:  user.lastname,
        email:     user.email,
        role,
      },
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error during login.' });
  }
};

module.exports = { register, login };