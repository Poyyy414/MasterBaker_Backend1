const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');

const {
  uploadImage,
  uploadGameItemImage,
  uploadSequenceStepImage,
  uploadDifferenceImages,
  uploadThumbnail,
  uploadBulk,
  deleteImage,
} = require('../controllers/uploadController');

router.post  ('/image',         verifyToken, uploadImage);
router.post  ('/game-item',     verifyToken, uploadGameItemImage);
router.post  ('/sequence-step', verifyToken, uploadSequenceStepImage);
router.post  ('/difference',    verifyToken, uploadDifferenceImages);
router.post  ('/thumbnail',     verifyToken, uploadThumbnail);
router.post  ('/bulk',          verifyToken, uploadBulk);
router.delete('/image',         verifyToken, deleteImage);

module.exports = router;