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
} = require('../controllers/checkpointController');

const {
  getQuestionsByCheckpoint,
} = require('../controllers/questionController');

// ── Student profile ───────────────────────────────────────────────────────────
router.get   ('/',    auth, getAllStudents);
router.get   ('/:id', auth, getStudentById);
router.put   ('/:id', auth, updateStudent);
router.delete('/:id', auth, deleteStudent);

// ── Browse activities ─────────────────────────────────────────────────────────
router.get('/activities/path/:path_id',           auth, getActivitiesByPath);
router.get('/activities/:id',                     auth, getActivityById);
router.get('/activities/:id/learn',               auth, getActivityLearnView);
router.get('/activities/:id/videos',              auth, getVideosByActivity);

// ── Single video ──────────────────────────────────────────────────────────────
router.get('/videos/:video_id',                   auth, getVideoById);

// ── Checkpoints ───────────────────────────────────────────────────────────────
router.get ('/activities/:activity_id/checkpoints',   auth, getCheckpointsByActivity);
router.get ('/checkpoints/:checkpoint_id',            auth, getCheckpointById);
router.post('/checkpoints/:checkpoint_id/submit',     auth, submitCheckpoint);

// ── Questions ─────────────────────────────────────────────────────────────────
router.get('/checkpoints/:checkpoint_id/questions',   auth, getQuestionsByCheckpoint);

module.exports = router;