const express = require('express');
const router  = express.Router();

const {
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
} = require('../controllers/studentController');

const {
  getActivitiesByPath,
  submitCheckpoint,
  saveVideoProgress,
  getStudentProgress,
} = require('../controllers/activityController');

const { verifyToken, isStudent } = require('../middleware/authMiddleware'); 

// ── Student profile ───────────────────────────────────────────────────────────
router.get   ('/',    getAllStudents);       // GET    /api/student
router.get   ('/:id', getStudentById);      // GET    /api/student/:id
router.put   ('/:id', updateStudent);       // PUT    /api/student/:id
router.delete('/:id', deleteStudent);       // DELETE /api/student/:id

// ── Browse activities ─────────────────────────────────────────────────────────
router.get('/activities/path/:path_id', getActivitiesByPath); // GET /api/student/activities/path/:path_id

// ── Checkpoint submission ─────────────────────────────────────────────────────
router.post('/checkpoint/:checkpoint_id/submit', submitCheckpoint); // POST /api/student/checkpoint/:checkpoint_id/submit

// ── Video progress ────────────────────────────────────────────────────────────
router.post('/video/progress', saveVideoProgress); // POST /api/student/video/progress

// ── My progress ───────────────────────────────────────────────────────────────
router.get('/progress/:student_id', getStudentProgress); // GET /api/student/progress/:student_id

router.use(verifyToken, isStudent);
module.exports = router;