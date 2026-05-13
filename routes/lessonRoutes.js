const express = require('express');
const router  = express.Router();

const { verifyToken } = require('../middleware/authMiddleware');
const { getComments, addComment, deleteComment } = require('../controllers/lessonCommentController');

router.get   ('/:lessonId/comments',  verifyToken, getComments);
router.post  ('/:lessonId/comments',  verifyToken, addComment);
router.delete('/comments/:commentId', verifyToken, deleteComment);

module.exports = router;