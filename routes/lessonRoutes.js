const express = require('express');
const router  = express.Router();

const { verifyToken, isTeacher } = require('../middleware/authMiddleware');
const {
  getMyThread,
  sendMessage,
  getThreadList,
  getStudentThread,
  replyToStudent,
  deleteMessage,
} = require('../controllers/lessonCommentController');

// Student
router.get   ('/:lessonId/messages',            verifyToken, getMyThread);
router.post  ('/:lessonId/messages',            verifyToken, sendMessage);

// Teacher
router.get   ('/:lessonId/threads',             verifyToken, isTeacher, getThreadList);
router.get   ('/:lessonId/threads/:studentId',  verifyToken, isTeacher, getStudentThread);
router.post  ('/:lessonId/threads/:studentId',  verifyToken, isTeacher, replyToStudent);

// Shared
router.delete('/messages/:messageId',           verifyToken, deleteMessage);

module.exports = router;
