const express = require('express');
const router  = express.Router();

const { verifyToken, isStudent } = require('../middleware/authMiddleware');
const auth = [verifyToken, isStudent];

const {
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
} = require('../controllers/studentController');

const {
  getActivitiesByPath,
  getActivityById,
  getVideosByActivity,
  getVideoById,
  getActivityLearnView,
} = require('../controllers/activityController');

const {
  getCheckpointsByActivity,
  getCheckpointById,
  submitCheckpoint,
  getActivityProgress,
} = require('../controllers/checkpointController');

const {
  getQuestionsByCheckpoint,
} = require('../controllers/questionController');

// ── Activities (BEFORE /:id) ──────────────────────────────────────────────────
router.get('/activities/path/:path_id',              auth, getActivitiesByPath);
router.get('/activities/:id/learn',                  auth, getActivityLearnView);
router.get('/activities/:id/videos',                 auth, getVideosByActivity);
router.get('/activities/:id/checkpoints',            auth, getCheckpointsByActivity);
router.get('/activities/:id',                        auth, getActivityById);

// ── Videos ────────────────────────────────────────────────────────────────────
router.get('/videos/:video_id',                      auth, getVideoById);

// ── Checkpoints ───────────────────────────────────────────────────────────────
router.get ('/checkpoints/:checkpoint_id/questions', auth, getQuestionsByCheckpoint);
router.get ('/checkpoints/:checkpoint_id',           auth, getCheckpointById);
router.post('/checkpoints/:checkpoint_id/submit',    auth, submitCheckpoint);
router.get('/activities/:activity_id/progress',     auth, getActivityProgress);

// ── Student profile (/:id MUST be last) ──────────────────────────────────────
router.get   ('/',    auth, getAllStudents);
router.get   ('/:id', auth, getStudentById);
router.put   ('/:id', auth, updateStudent);
router.delete('/:id', auth, deleteStudent);

module.exports = router;