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
  endActivity,
  getNextQuestion,
} = require('../controllers/checkpointController');

const {
  getQuestionsByCheckpoint,
} = require('../controllers/questionController');

const {
  getDifferenceGame,
  checkDifferenceSpots,
} = require('../controllers/differenceController');

const {
  getGameItems,
  checkGameItems,
} = require('../controllers/gameItemsController');

const {
  getSequenceSteps,
  checkSequence,
} = require('../controllers/sequenceController');

const {
  createGameSession,
  getMyGameSessions,
  getLeaderboard,
  getMyBadges,
  getMyPoints,
} = require('../controllers/gamificationController');

// ── Activities ────────────────────────────────────────────────────────────────
router.get('/activities/path/:path_id',               auth, getActivitiesByPath);
router.get('/activities/:id/learn',                   auth, getActivityLearnView);
router.get('/activities/:id/videos',                  auth, getVideosByActivity);
router.get('/activities/:id/checkpoints',             auth, getCheckpointsByActivity);
router.get('/activities/:activity_id/progress',       auth, getActivityProgress);
router.get('/activities/:activity_id/next-question',  auth, getNextQuestion);
router.get('/activities/:id',                         auth, getActivityById);
router.post('/activities/:activity_id/end',           auth, endActivity);

// ── Videos ────────────────────────────────────────────────────────────────────
router.get('/videos/:video_id',                       auth, getVideoById);

// ── Checkpoints ───────────────────────────────────────────────────────────────
router.get ('/checkpoints/:checkpoint_id/questions',  auth, getQuestionsByCheckpoint);
router.get ('/checkpoints/:checkpoint_id',            auth, getCheckpointById);
router.post('/checkpoints/:checkpoint_id/submit',     auth, submitCheckpoint);

// ── Spot the Difference ───────────────────────────────────────────────────────
router.get ('/recipes/:recipe_id/difference',         auth, getDifferenceGame);
router.post('/difference/:image_id/check',            auth, checkDifferenceSpots);

// ── Pick the Right Ingredient ─────────────────────────────────────────────────
router.get ('/recipes/:recipe_id/game-items',         auth, getGameItems);
router.post('/recipes/:recipe_id/game-items/check',   auth, checkGameItems);

// ── Tag the Sequence ──────────────────────────────────────────────────────────
router.get ('/recipes/:recipe_id/sequence-steps',       auth, getSequenceSteps);
router.post('/recipes/:recipe_id/sequence-steps/check', auth, checkSequence);

// ── Game Sessions, Points, Badges, Leaderboard ───────────────────────────────
router.post('/game-sessions',                         auth, createGameSession);
router.get ('/game-sessions',                         auth, getMyGameSessions);
router.get ('/leaderboard',                           auth, getLeaderboard);
router.get ('/badges',                                auth, getMyBadges);
router.get ('/points',                                auth, getMyPoints);

// ── Student profile (/:id MUST be last) ──────────────────────────────────────
router.get   ('/',    auth, getAllStudents);
router.get   ('/:id', auth, getStudentById);
router.put   ('/:id', auth, updateStudent);
router.delete('/:id', auth, deleteStudent);

module.exports = router;