const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db'); // your mysql2 connection

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

// ─── REGISTER ────────────────────────────────────────────────────────────────
const register = async (req, res) => {
  try {
    const { firstname, lastname, email, password, role } = req.body;

    // Validate required fields
    if (!firstname || !email || !password || !role) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    if (!['Student', 'Teacher'].includes(role)) {
      return res.status(400).json({ message: 'Role must be Student or Teacher.' });
    }

    // Check if email already exists
    const [existing] = await db.query('SELECT user_id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email is already registered.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const [result] = await db.query(
      `INSERT INTO users (firstname, lastname, email, password, role)
       VALUES (?, ?, ?, ?, ?)`,
      [firstname, lastname || '', email, hashedPassword, role]
    );

    const userId = result.insertId;

    // Create role-specific record
    if (role === 'Teacher') {
      const { specialization, department } = req.body;
      await db.query(
        `INSERT INTO teachers (user_id, specialization, department) VALUES (?, ?, ?)`,
        [userId, specialization || null, department || null]
      );
    } else if (role === 'Student') {
      const { grade_level, section } = req.body;
      await db.query(
        `INSERT INTO students (user_id, grade_level, section) VALUES (?, ?, ?)`,
        [userId, grade_level || null, section || null]
      );
    }

    return res.status(201).json({
      message: 'Registration successful.',
      user: { user_id: userId, firstname, lastname, email, role },
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ message: 'Server error during registration.' });
  }
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    // Find user
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const user = rows[0];

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // Generate JWT
    const token = jwt.sign(
      { user_id: user.user_id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: {
        user_id: user.user_id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error during login.' });
  }
};

module.exports = { register, login };