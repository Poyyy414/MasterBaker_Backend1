const { cloudinary } = require('../config/cloudinary');
const multer      = require('multer');
const { Readable } = require('stream');

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
// folder: where to store in Cloudinary (e.g. 'masterbaker/games')
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
// Optional body: folder (default: 'masterbaker/general')
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
        url:       result.secure_url,       // ← use this as image_url in your game controllers
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
// For: Pick the Right Ingredient item images
// Form field: "image"
// ════════════════════════════════════════════════════════════════════════════════
const uploadGameItemImage = [
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No image file provided.' });

      const result = await streamToCloudinary(req.file.buffer, 'masterbaker/game-items');

      return res.status(200).json({
        message: 'Game item image uploaded.',
        url:     result.secure_url,
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
// For: Tag the Sequence step images
// Form field: "image"
// ════════════════════════════════════════════════════════════════════════════════
const uploadSequenceStepImage = [
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No image file provided.' });

      const result = await streamToCloudinary(req.file.buffer, 'masterbaker/sequence-steps');

      return res.status(200).json({
        message: 'Sequence step image uploaded.',
        url:     result.secure_url,
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
// For: Spot the Difference — uploads BOTH images in one request
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

      // Upload both in parallel
      const [originalResult, modifiedResult] = await Promise.all([
        streamToCloudinary(originalFile.buffer, 'masterbaker/difference/original'),
        streamToCloudinary(modifiedFile.buffer, 'masterbaker/difference/modified'),
      ]);

      return res.status(200).json({
        message:            'Difference images uploaded successfully.',
        original_image_url: originalResult.secure_url,  // ← pass to createDifferenceImage
        modified_image_url: modifiedResult.secure_url,  // ← pass to createDifferenceImage
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
// UPLOAD ACTIVITY VIDEO THUMBNAIL
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
        message: 'Thumbnail uploaded.',
        url:     result.secure_url,
        public_id: result.public_id,
      });
    } catch (error) {
      console.error('Upload thumbnail error:', error);
      return res.status(500).json({ message: 'Upload failed.', error: error.message });
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

module.exports = {
  uploadImage,
  uploadGameItemImage,
  uploadSequenceStepImage,
  uploadDifferenceImages,
  uploadThumbnail,
  deleteImage,
  upload, // export multer instance in case other controllers need it
};