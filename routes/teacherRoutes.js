const express = require('express');
const router  = express.Router();

const { verifyToken, isTeacher } = require('../middleware/authMiddleware');
const auth = [verifyToken, isTeacher]; // reusable array

const {
  getAllTeachers,
  getTeacherById,
  updateTeacher,
  deleteTeacher,
} = require('../controllers/teacherController');

const {
  createActivity,
  getAllActivities,
  getActivityById,
  updateActivity,
  deleteActivity,
} = require('../controllers/activityController');

const {
  createCheckpoint,
  updateCheckpoint,
  deleteCheckpoint,
} = require('../controllers/checkpointController');

const {
  createQuestion,
  deleteQuestion,
} = require('../controllers/questionController');

// ── Teacher profile ───────────────────────────────────────────────────────────
router.get   ('/',    auth, getAllTeachers);
router.get   ('/:id', auth, getTeacherById);
router.put   ('/:id', auth, updateTeacher);
router.delete('/:id', auth, deleteTeacher);

// ── Activity management ───────────────────────────────────────────────────────
router.post  ('/activities',     auth, createActivity);
router.get   ('/activities',     auth, getAllActivities);
router.get   ('/activities/:id', auth, getActivityById);
router.put   ('/activities/:id', auth, updateActivity);
router.delete('/activities/:id', auth, deleteActivity);

// ── Checkpoint management ─────────────────────────────────────────────────────
router.post  ('/activities/:activity_id/checkpoints', auth, createCheckpoint);
router.put   ('/checkpoints/:checkpoint_id',          auth, updateCheckpoint);
router.delete('/checkpoints/:checkpoint_id',          auth, deleteCheckpoint);

// ── Question management ───────────────────────────────────────────────────────
router.post  ('/checkpoints/:checkpoint_id/questions', auth, createQuestion);
router.delete('/questions/:question_id',               auth, deleteQuestion);

module.exports = router;