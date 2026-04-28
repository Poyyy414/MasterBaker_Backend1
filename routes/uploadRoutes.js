const express = require('express');
const router  = express.Router();
const { uploadVideo, uploadImage } = require('../config/cloudinary.js');

// POST /api/upload/video
router.post('/video', uploadVideo.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No video file uploaded.' });
  return res.status(200).json({
    message:   'Video uploaded successfully.',
    video_url: req.file.path,
    public_id: req.file.filename,
  });
});

// POST /api/upload/image
router.post('/image', uploadImage.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No image file uploaded.' });
  return res.status(200).json({
    message:   'Image uploaded successfully.',
    image_url: req.file.path,
    public_id: req.file.filename,
  });
});

module.exports = router;