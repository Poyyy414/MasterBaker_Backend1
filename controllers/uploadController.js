const db             = require('../config/db');
const { cloudinary } = require('../config/cloudinary');
const multer         = require('multer');
const { Readable }   = require('stream');

// ════════════════════════════════════════════════════════════════════════════════
// MULTER — store in memory (we stream to Cloudinary, not disk)
// ════════════════════════════════════════════════════════════════════════════════
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, png, webp, gif)'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
});

// ════════════════════════════════════════════════════════════════════════════════
// HELPER — stream a buffer to Cloudinary
// ════════════════════════════════════════════════════════════════════════════════
const streamToCloudinary = (buffer, folder) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
};

// ════════════════════════════════════════════════════════════════════════════════
// UPLOAD SINGLE IMAGE
// POST /api/upload/image
// Form field: "image"
// ════════════════════════════════════════════════════════════════════════════════
const uploadImage = [
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No image file provided. Use field name "image".' });
      }
      const folder = req.body.folder || 'masterbaker/general';
      const result = await streamToCloudinary(req.file.buffer, folder);
      return res.status(200).json({
        message:   'Image uploaded successfully.',
        url:       result.secure_url,
        public_id: result.public_id,
        width:     result.width,
        height:    result.height,
        format:    result.format,
        size:      req.file.size,
      });
    } catch (error) {
      console.error('Upload image error:', error);
      return res.status(500).json({ message: 'Image upload failed.', error: error.message });
    }
  },
];

// ════════════════════════════════════════════════════════════════════════════════
// UPLOAD GAME ITEM IMAGE
// POST /api/upload/game-item
// Form field: "image"
// ════════════════════════════════════════════════════════════════════════════════
const uploadGameItemImage = [
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No image file provided.' });
      const result = await streamToCloudinary(req.file.buffer, 'masterbaker/game-items');
      return res.status(200).json({
        message:   'Game item image uploaded.',
        url:       result.secure_url,
        public_id: result.public_id,
      });
    } catch (error) {
      console.error('Upload game item image error:', error);
      return res.status(500).json({ message: 'Upload failed.', error: error.message });
    }
  },
];

// ════════════════════════════════════════════════════════════════════════════════
// UPLOAD SEQUENCE STEP IMAGE
// POST /api/upload/sequence-step
// Form field: "image"
// ════════════════════════════════════════════════════════════════════════════════
const uploadSequenceStepImage = [
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No image file provided.' });
      const result = await streamToCloudinary(req.file.buffer, 'masterbaker/sequence-steps');
      return res.status(200).json({
        message:   'Sequence step image uploaded.',
        url:       result.secure_url,
        public_id: result.public_id,
      });
    } catch (error) {
      console.error('Upload sequence step image error:', error);
      return res.status(500).json({ message: 'Upload failed.', error: error.message });
    }
  },
];

// ════════════════════════════════════════════════════════════════════════════════
// UPLOAD DIFFERENCE IMAGES (original + modified pair)
// POST /api/upload/difference
// Form fields: "original" and "modified"
// ════════════════════════════════════════════════════════════════════════════════
const uploadDifferenceImages = [
  upload.fields([
    { name: 'original', maxCount: 1 },
    { name: 'modified', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const originalFile = req.files?.original?.[0];
      const modifiedFile = req.files?.modified?.[0];

      if (!originalFile || !modifiedFile) {
        return res.status(400).json({
          message: 'Both "original" and "modified" image files are required.',
        });
      }

      const [originalResult, modifiedResult] = await Promise.all([
        streamToCloudinary(originalFile.buffer, 'masterbaker/difference/original'),
        streamToCloudinary(modifiedFile.buffer, 'masterbaker/difference/modified'),
      ]);

      return res.status(200).json({
        message:            'Difference images uploaded successfully.',
        original_image_url: originalResult.secure_url,
        modified_image_url: modifiedResult.secure_url,
        original_public_id: originalResult.public_id,
        modified_public_id: modifiedResult.public_id,
      });
    } catch (error) {
      console.error('Upload difference images error:', error);
      return res.status(500).json({ message: 'Upload failed.', error: error.message });
    }
  },
];

// ════════════════════════════════════════════════════════════════════════════════
// UPLOAD THUMBNAIL
// POST /api/upload/thumbnail
// Form field: "image"
// ════════════════════════════════════════════════════════════════════════════════
const uploadThumbnail = [
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No image file provided.' });
      const result = await streamToCloudinary(req.file.buffer, 'masterbaker/thumbnails');
      return res.status(200).json({
        message:   'Thumbnail uploaded.',
        url:       result.secure_url,
        public_id: result.public_id,
      });
    } catch (error) {
      console.error('Upload thumbnail error:', error);
      return res.status(500).json({ message: 'Upload failed.', error: error.message });
    }
  },
];

// ════════════════════════════════════════════════════════════════════════════════
// BULK UPLOAD — multiple images at once
// POST /api/upload/bulk
// Form field: "images" (multiple files, max 20)
// Body field: folder (text) — e.g. masterbaker/game-items
// ════════════════════════════════════════════════════════════════════════════════
const uploadBulk = [
  upload.array('images', 20),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No images uploaded. Use field name "images".' });
      }

      const folder = req.body.folder || 'masterbaker/general';

      const uploads = await Promise.all(
        req.files.map(file => streamToCloudinary(file.buffer, folder))
      );

      return res.status(200).json({
        message: `${uploads.length} image(s) uploaded successfully.`,
        images: uploads.map((result, i) => ({
          index:     i,
          filename:  req.files[i].originalname,
          url:       result.secure_url,
          public_id: result.public_id,
        })),
      });
    } catch (error) {
      console.error('Bulk upload error:', error);
      return res.status(500).json({ message: 'Bulk upload failed.', error: error.message });
    }
  },
];

// ════════════════════════════════════════════════════════════════════════════════
// DELETE IMAGE FROM CLOUDINARY
// DELETE /api/upload/image
// Body: { public_id }
// ════════════════════════════════════════════════════════════════════════════════
const deleteImage = async (req, res) => {
  try {
    const { public_id } = req.body;
    if (!public_id) return res.status(400).json({ message: 'public_id is required.' });

    const result = await cloudinary.uploader.destroy(public_id);

    if (result.result === 'ok') {
      return res.status(200).json({ message: 'Image deleted from Cloudinary.' });
    } else {
      return res.status(404).json({ message: 'Image not found or already deleted.', result });
    }
  } catch (error) {
    console.error('Delete image error:', error);
    return res.status(500).json({ message: 'Delete failed.', error: error.message });
  }
};

const uploadAvatar = [
  upload.single('avatar'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No avatar file provided. Use field name "avatar".' });
      }
      const user_id = req.user.user_id;
      const publicId = `user_${user_id}`;
      const result = await streamToCloudinary(req.file.buffer, 'masterbaker/avatars');

      await db.query(
        `UPDATE users SET avatar_url = ? WHERE user_id = ?`,
        [result.secure_url, user_id]
      );

      return res.status(200).json({
        message:    'Avatar uploaded successfully.',
        avatar_url: result.secure_url,
        public_id:  publicId,
      });
    } catch (error) {
      console.error('Upload avatar error:', error);
      return res.status(500).json({ message: 'Avatar upload failed.', error: error.message });
    }
  },
];

const deleteAvatar = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const publicId = `masterbaker/avatars/user_${user_id}`;

    await cloudinary.uploader.destroy(publicId);
    await db.query(
      `UPDATE users SET avatar_url = NULL WHERE user_id = ?`,
      [user_id]
    );

    return res.status(200).json({ message: 'Avatar removed.' });
  } catch (error) {
    console.error('Delete avatar error:', error);
    return res.status(500).json({ message: 'Avatar delete failed.', error: error.message });
  }
};

module.exports = {
  uploadImage,
  uploadGameItemImage,
  uploadSequenceStepImage,
  uploadDifferenceImages,
  uploadThumbnail,
  uploadBulk,
  deleteImage,
  uploadAvatar,
  deleteAvatar,
  upload,
};