const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');

const {
  uploadImage,
  uploadGameItemImage,
  uploadSequenceStepImage,
  uploadDifferenceImages,
  uploadThumbnail,
  deleteImage,
} = require('../controllers/uploadController');

// POST /api/upload/image
router.post('/image',         verifyToken, uploadImage);

// POST /api/upload/game-item
router.post('/game-item',     verifyToken, uploadGameItemImage);

// POST /api/upload/sequence-step
router.post('/sequence-step', verifyToken, uploadSequenceStepImage);

// POST /api/upload/difference
router.post('/difference',    verifyToken, uploadDifferenceImages);

// POST /api/upload/thumbnail
router.post('/thumbnail',     verifyToken, uploadThumbnail);

// DELETE /api/upload/image
router.delete('/image',       verifyToken, deleteImage);

module.exports = router;