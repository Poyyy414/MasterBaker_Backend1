const express = require('express');
const router  = express.Router();

const { verifyToken, isTeacher } = require('../middleware/authMiddleware');
const auth = [verifyToken, isTeacher];

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
  createVideo,
  deleteVideo,
  getActivitiesByPath,
  getCheckpointsByActivity,
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

const {
  createDifferenceImage,
  createDifferenceSpot,
  deleteDifferenceSpot,
} = require('../controllers/differenceController');

const {
  getGameItemsTeacher,
  createGameItem,
  updateGameItem,
  deleteGameItem,
} = require('../controllers/gameItemsController');

const {
  getSequenceStepsTeacher, // ← fixed name
  createSequenceStep,
  updateSequenceStep,
  deleteSequenceStep,
} = require('../controllers/sequenceController');

const {
  getLeaderboard,
} = require('../controllers/gamificationController');

// ── Activity management ───────────────────────────────────────────────────────
router.post  ('/activities',                           auth, createActivity);
router.get   ('/activities',                           auth, getAllActivities);
router.get   ('/activities/:id',                       auth, getActivityById);
router.put   ('/activities/:id',                       auth, updateActivity);
router.delete('/activities/:id',                       auth, deleteActivity);
router.get   ('/activities/path/:path_id',              auth, getActivitiesByPath); // ← fixed
router.get   ('/activities/:id/checkpoints',            auth, getCheckpointsByActivity);

// ── Video management ──────────────────────────────────────────────────────────
router.post  ('/activities/:id/videos',                auth, createVideo);
router.delete('/videos/:video_id',                     auth, deleteVideo);

// ── Checkpoint management ─────────────────────────────────────────────────────
router.post  ('/activities/:activity_id/checkpoints',  auth, createCheckpoint);
router.put   ('/checkpoints/:checkpoint_id',           auth, updateCheckpoint);
router.delete('/checkpoints/:checkpoint_id',           auth, deleteCheckpoint);

// ── Question management ───────────────────────────────────────────────────────
router.post  ('/checkpoints/:checkpoint_id/questions', auth, createQuestion);
router.delete('/questions/:question_id',               auth, deleteQuestion);

// ── Spot the Difference ───────────────────────────────────────────────────────
router.post  ('/games/:game_id/difference',            auth, createDifferenceImage); // ← fixed
router.post  ('/difference/:image_id/spots',           auth, createDifferenceSpot);
router.delete('/difference/spots/:spot_id',            auth, deleteDifferenceSpot);

// ── Pick the Right Ingredient ─────────────────────────────────────────────────
router.get   ('/games/:game_id/pick-ingredient',       auth, getGameItemsTeacher);
router.post  ('/games/:game_id/pick-ingredient',       auth, createGameItem);
router.put   ('/game-items/:item_id',                  auth, updateGameItem);
router.delete('/game-items/:item_id',                  auth, deleteGameItem);

// ── Tag the Sequence ──────────────────────────────────────────────────────────
router.get   ('/games/:game_id/sequence',              auth, getSequenceStepsTeacher); // ← fixed
router.post  ('/games/:game_id/sequence',              auth, createSequenceStep);      // ← fixed
router.put   ('/sequence-steps/:step_id',              auth, updateSequenceStep);
router.delete('/sequence-steps/:step_id',              auth, deleteSequenceStep);

// ── Leaderboard ───────────────────────────────────────────────────────────────
router.get   ('/leaderboard',                          auth, getLeaderboard);

// ── Teacher profile (/:id MUST be last) ──────────────────────────────────────
router.get   ('/',    auth, getAllTeachers);
router.get   ('/:id', auth, getTeacherById);
router.put   ('/:id', auth, updateTeacher);
router.delete('/:id', auth, deleteTeacher);

module.exports = router;