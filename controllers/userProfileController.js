const db         = require('../config/db');
const cloudinary  = require('../config/cloudinary');
const { Readable } = require('stream');

// ════════════════════════════════════════════════════════════════════════════════
// HELPER — stream a buffer to Cloudinary
// ════════════════════════════════════════════════════════════════════════════════
const _uploadToCloudinary = (buffer, folder, publicId) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id:      publicId,
        overwrite:      true,
        transformation: [
          { width: 300, height: 300, crop: 'fill', gravity: 'face' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    Readable.from(buffer).pipe(stream);
  });

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/student/profile
// GET /api/teacher/profile
// Returns full profile: user info, avatar, total_points, rank, badges, stats
// ════════════════════════════════════════════════════════════════════════════════
const getProfile = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    // User + student details
    const [userRows] = await db.query(
      `SELECT u.user_id, u.firstname, u.lastname, u.email,
              u.avatar_url, u.role, u.created_at,
              s.student_id, s.grade_level, s.section
       FROM users u
       LEFT JOIN students s ON s.user_id = u.user_id
       WHERE u.user_id = ?`,
      [user_id]
    );
    if (!userRows[0]) return res.status(404).json({ message: 'User not found.' });
    const user = userRows[0];

    // Total points
    const [[ptRow]] = await db.query(
      `SELECT COALESCE(SUM(points_earned), 0) AS total FROM points_log WHERE user_id = ?`,
      [user_id]
    );

    // Rank
    const [[rankRow]] = await db.query(
      `SELECT COUNT(*) + 1 AS rank_position
       FROM (
         SELECT user_id, SUM(points_earned) AS total
         FROM points_log GROUP BY user_id
         HAVING total > ?
       ) higher`,
      [ptRow.total]
    );

    // Badges
    const [badges] = await db.query(
      `SELECT b.badge_id, b.name, b.description, b.icon_url, ub.earned_at
       FROM user_badges ub
       JOIN badges b ON ub.badge_id = b.badge_id
       WHERE ub.user_id = ?
       ORDER BY ub.earned_at DESC`,
      [user_id]
    );

    // Game stats
    const [[statsRow]] = await db.query(
      `SELECT
         COUNT(*)                                       AS total_sessions,
         COALESCE(SUM(score), 0)                        AS total_correct,
         COALESCE(SUM(total_items), 0)                  AS total_items,
         COUNT(DISTINCT recipe_id)                       AS games_attempted,
         COUNT(DISTINCT CASE
           WHEN total_items > 0
            AND (score / total_items) >= 0.6
           THEN recipe_id END)                           AS games_passed
       FROM game_sessions WHERE user_id = ?`,
      [user_id]
    );

    // Points breakdown
    const [[gamePts]] = await db.query(
      `SELECT COALESCE(SUM(points_earned), 0) AS total
       FROM points_log WHERE user_id = ? AND session_id > 0`, [user_id]
    );
    const [[lessonPts]] = await db.query(
      `SELECT COALESCE(SUM(points_earned), 0) AS total
       FROM points_log WHERE user_id = ? AND session_id = 0`, [user_id]
    );

    return res.status(200).json({
      user: {
        user_id:     user.user_id,
        firstname:   user.firstname,
        lastname:    user.lastname,
        email:       user.email,
        avatar_url:  user.avatar_url || null,
        role:        user.role,
        member_since: user.created_at,
        // student-specific (null for teachers)
        student_id:  user.student_id  || null,
        grade_level: user.grade_level || null,
        section:     user.section     || null,
      },
      points: {
        total:        ptRow.total,
        from_games:   gamePts.total,
        from_lessons: lessonPts.total,
        rank_position: rankRow.rank_position,
      },
      stats: {
        total_sessions:  statsRow.total_sessions,
        games_attempted: statsRow.games_attempted,
        games_passed:    statsRow.games_passed,
        overall_accuracy: statsRow.total_items > 0
          ? Math.round((statsRow.total_correct / statsRow.total_items) * 100) : 0,
      },
      badges_earned: badges.length,
      badges,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// PUT /api/student/profile
// PUT /api/teacher/profile
// Update name or email (NOT avatar — that's a separate upload endpoint)
// Body: { firstname?, lastname?, email? }
// ════════════════════════════════════════════════════════════════════════════════
const updateProfile = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const { firstname, lastname, email } = req.body;

    if (!firstname && !lastname && !email) {
      return res.status(400).json({ message: 'Provide at least one field to update.' });
    }

    // Check email uniqueness if changing
    if (email) {
      const [existing] = await db.query(
        `SELECT user_id FROM users WHERE email = ? AND user_id != ?`, [email, user_id]
      );
      if (existing.length > 0) {
        return res.status(409).json({ message: 'Email already in use.' });
      }
    }

    await db.query(
      `UPDATE users SET
         firstname = COALESCE(?, firstname),
         lastname  = COALESCE(?, lastname),
         email     = COALESCE(?, email)
       WHERE user_id = ?`,
      [firstname || null, lastname || null, email || null, user_id]
    );

    return res.status(200).json({ message: 'Profile updated.' });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/upload/avatar
// Upload or replace avatar image. Uses multer (set up in route file).
// Saves Cloudinary URL to users.avatar_url
// ════════════════════════════════════════════════════════════════════════════════
const uploadAvatar = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided.' });
    }

    // Upload to Cloudinary — one avatar per user, keyed by user_id (overwrites old one)
    const result = await _uploadToCloudinary(
      req.file.buffer,
      'masterbaker/avatars',
      `user_${user_id}`
    );

    const avatar_url = result.secure_url;

    // Save URL to DB
    await db.query(
      `UPDATE users SET avatar_url = ? WHERE user_id = ?`,
      [avatar_url, user_id]
    );

    return res.status(200).json({
      message:    'Avatar uploaded successfully.',
      avatar_url,
    });
  } catch (error) {
    console.error('Upload avatar error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /api/upload/avatar
// Remove avatar — resets to null (frontend shows default placeholder)
// ════════════════════════════════════════════════════════════════════════════════
const deleteAvatar = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    // Delete from Cloudinary
    try {
      await cloudinary.uploader.destroy(`masterbaker/avatars/user_${user_id}`);
    } catch (_) {
      // If not on Cloudinary yet, just continue
    }

    await db.query(
      `UPDATE users SET avatar_url = NULL WHERE user_id = ?`, [user_id]
    );

    return res.status(200).json({ message: 'Avatar removed.' });
  } catch (error) {
    console.error('Delete avatar error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { getProfile, updateProfile, uploadAvatar, deleteAvatar };