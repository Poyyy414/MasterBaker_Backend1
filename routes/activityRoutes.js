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

// ── Specific routes BEFORE /:id ───────────────────────────────────────────────
router.post  ('/',                              createActivity);
router.get   ('/',                              getAllActivities);
router.get   ('/path/:path_id',                 getActivitiesByPath);
router.post  ('/:activity_id/checkpoints',      createCheckpoint);
router.get   ('/:activity_id/checkpoints',      getCheckpointsByActivity);

// ── Wildcard /:id LAST ────────────────────────────────────────────────────────
router.get   ('/:id',                           getActivityById);
router.put   ('/:id',                           updateActivity);
router.delete('/:id',                           deleteActivity);

module.exports = router;