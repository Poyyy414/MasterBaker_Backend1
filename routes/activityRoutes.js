const express  = require('express');
const router   = express.Router();
const {
  createActivity,
  getAllActivities,
  getActivityById,
  getActivitiesByPath,
  updateActivity,
  deleteActivity,
} = require('../controllers/activityController');

const {
  createCheckpoint,
  getCheckpointsByActivity,
} = require('../controllers/checkpointController');

// ── Activity CRUD ─────────────────────────────────────────────────────────────
router.post  ('/',                  createActivity);      // POST   /api/activities
router.get   ('/',                  getAllActivities);     // GET    /api/activities
router.get   ('/path/:path_id',     getActivitiesByPath); // GET    /api/activities/path/:path_id
router.get   ('/:id',              getActivityById);      // GET    /api/activities/:id
router.put   ('/:id',              updateActivity);       // PUT    /api/activities/:id
router.delete('/:id',              deleteActivity);       // DELETE /api/activities/:id

// ── Checkpoints nested under activity ────────────────────────────────────────
router.post  ('/:activity_id/checkpoints', createCheckpoint);         // POST /api/activities/:activity_id/checkpoints
router.get   ('/:activity_id/checkpoints', getCheckpointsByActivity); // GET  /api/activities/:activity_id/checkpoints

module.exports = router;