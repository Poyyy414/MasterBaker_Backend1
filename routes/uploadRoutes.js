const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { verifyToken } = require('../middleware/authMiddleware');

const {
  uploadAvatar,
  deleteAvatar,
} = require('../controllers/uploadController');

// ── Multer — memory storage (buffer goes straight to Cloudinary) ──────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WEBP, and GIF images are allowed.'));
    }
  },
});

const auth = verifyToken;

// POST /api/upload/avatar   — upload or replace avatar
// DELETE /api/upload/avatar — remove avatar
router.post  ('/avatar', auth, upload.single('avatar'), uploadAvatar);
router.delete('/avatar', auth, deleteAvatar);

// ── Multer error handler ──────────────────────────────────────────────────────
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Image too large. Max 5 MB.' });
    }
  }
  if (err) {
    return res.status(400).json({ message: err.message });
  }
  next();
});

module.exports = router;