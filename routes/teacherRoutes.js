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
} = require('../controllers/activityController');

const {
  createCheckpoint,
  updateCheckpoint,
  deleteCheckpoint,
  getCheckpointsByActivity,
} = require('../controllers/checkpointController');

const {
  createQuestion,
  deleteQuestion,
} = require('../controllers/questionController');

const {
  createDifferenceImage,
  getDifferenceGameTeacher,
  deleteDifferenceImage,
  createDifferenceSpot,
  updateDifferenceSpot,
  deleteDifferenceSpot,
} = require('../controllers/differenceController');

const {
  getGameItemsTeacher,
  createGameItem,
  updateGameItem,
  deleteGameItem,
} = require('../controllers/gameItemsController');

const {
  getSequenceStepsTeacher,
  createSequenceStep,
  updateSequenceStep,
  deleteSequenceStep,
} = require('../controllers/sequenceController');

const {
  getLeaderboard,
} = require('../controllers/gamificationController');

const {
  getGameTypes,
  createGame,
  getAllGames,
  getGameById,
  getGamesByPath,   // ← path not activity
  updateGame,
  deleteGame,
} = require('../controllers/gamesController');

const {
  getStudentOverview,
  getStudentLessonProgress,
  getStudentGameProgress,
  getStudentCheckpointProgress,
} = require('../controllers/studentProgressController');

// ── Activity management (Lessons) ─────────────────────────────────────────────
router.post  ('/activities',                            auth, createActivity);
router.get   ('/activities',                            auth, getAllActivities);
router.get   ('/activities/path/:path_id',              auth, getActivitiesByPath);
router.get   ('/activities/:id/checkpoints',            auth, getCheckpointsByActivity);
router.get   ('/activities/:id',                        auth, getActivityById);
router.put   ('/activities/:id',                        auth, updateActivity);
router.delete('/activities/:id',                        auth, deleteActivity);

// ── Video management ──────────────────────────────────────────────────────────
router.post  ('/activities/:id/videos',                 auth, createVideo);
router.delete('/videos/:video_id',                      auth, deleteVideo);

// ── Checkpoint management ───────────────────────────────────────── ────────────
router.post  ('/activities/:activity_id/checkpoints',   auth, createCheckpoint);
router.put   ('/checkpoints/:checkpoint_id',            auth, updateCheckpoint);
router.delete('/checkpoints/:checkpoint_id',            auth, deleteCheckpoint);

// ── Question management ───────────────────────────────────────────────────────
router.post  ('/checkpoints/:checkpoint_id/questions',  auth, createQuestion);
router.delete('/questions/:question_id',                auth, deleteQuestion);

// ── Game management ───────────────────────────────────────────────────────────
// Games are linked to a PATH (Cake/Pie), NOT to activities
router.get   ('/game-types',                            auth, getGameTypes);
router.post  ('/games',                                 auth, createGame);
router.get   ('/games',                                 auth, getAllGames);
router.get   ('/games/path/:path_id',                   auth, getGamesByPath);  // ← get games by path
router.get   ('/games/:game_id',                        auth, getGameById);
router.put   ('/games/:game_id',                        auth, updateGame);
router.delete('/games/:game_id',                        auth, deleteGame);

// ── Spot the Difference ───────────────────────────────────────────────────────
router.get   ('/games/:game_id/difference',             auth, getDifferenceGameTeacher);
router.post  ('/games/:game_id/difference',             auth, createDifferenceImage);
router.delete('/difference/images/:image_id',           auth, deleteDifferenceImage);
router.post  ('/difference/:image_id/spots',            auth, createDifferenceSpot);
router.put   ('/difference/spots/:spot_id',             auth, updateDifferenceSpot);
router.delete('/difference/spots/:spot_id',             auth, deleteDifferenceSpot);

// ── Pick the Right Ingredient ─────────────────────────────────────────────────
router.get   ('/games/:game_id/pick-ingredient',        auth, getGameItemsTeacher);
router.post  ('/games/:game_id/pick-ingredient',        auth, createGameItem);
router.put   ('/game-items/:item_id',                   auth, updateGameItem);
router.delete('/game-items/:item_id',                   auth, deleteGameItem);

// ── Tag the Sequence ──────────────────────────────────────────────────────────
router.get   ('/games/:game_id/sequence',               auth, getSequenceStepsTeacher);
router.post  ('/games/:game_id/sequence',               auth, createSequenceStep);
router.put   ('/sequence-steps/:step_id',               auth, updateSequenceStep);
router.delete('/sequence-steps/:step_id',               auth, deleteSequenceStep);

// ── Student Progress (for teacher monitoring) ─────────────────────────────────
router.get   ('/students/:student_id/overview',         auth, getStudentOverview);
router.get   ('/students/:student_id/lessons',          auth, getStudentLessonProgress);
router.get   ('/students/:student_id/games',            auth, getStudentGameProgress);
router.get   ('/students/:student_id/checkpoints',      auth, getStudentCheckpointProgress);

// ── Leaderboard ───────────────────────────────────────────────────────────────
router.get   ('/leaderboard',                           auth, getLeaderboard);

// ── Teacher profile (/:id MUST be last) ──────────────────────────────────────
router.get   ('/',    auth, getAllTeachers);
router.get   ('/:id', auth, getTeacherById);
router.put   ('/:id', auth, updateTeacher);
router.delete('/:id', auth, deleteTeacher);

module.exports = router;