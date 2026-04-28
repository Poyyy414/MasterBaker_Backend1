const express = require('express');
const router  = express.Router();

const {
  getAllTeachers,
  getTeacherById,
  updateTeacher,
  deleteTeacher,
} = require('../controllers/teacherController');

const {
  createActivity,
  getAllActivities,
  getActivityDetail,
  updateActivity,
  deleteActivity,
} = require('../controllers/activityController');

const { verifyToken, isTeacher } = require('../middleware/authMiddleware');

// ── Teacher profile ───────────────────────────────────────────────────────────
router.get   ('/',    getAllTeachers);       // GET    /api/teacher
router.get   ('/:id', getTeacherById);      // GET    /api/teacher/:id
router.put   ('/:id', updateTeacher);       // PUT    /api/teacher/:id
router.delete('/:id', deleteTeacher);       // DELETE /api/teacher/:id

// ── Activity management ───────────────────────────────────────────────────────
router.post  ('/activities',     createActivity);    // POST   /api/teacher/activities
router.get   ('/activities',     getAllActivities);   // GET    /api/teacher/activities
router.get   ('/activities/:id', getActivityDetail); // GET    /api/teacher/activities/:id
router.put   ('/activities/:id', updateActivity);    // PUT    /api/teacher/activities/:id
router.delete('/activities/:id', deleteActivity);    // DELETE /api/teacher/activities/:id

router.use(verifyToken, isTeacher);

module.exports = router;