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
  getPickIngredientGame,
  submitPickIngredient,
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
  completeVideoLesson,
  completeCheckpoint,
} = require('../controllers/gamificationController');

const { 
  getGameDashboard, 
  getAchievements,
  getPathGames,
 } = require('../controllers/gameDashboard');

 const {
  getAllGames,
  getGameById,
  getGamesByPathStudent,
  getLevelsByPathAndType,
  getGameLevels,
 } = require('../controllers/gamesController'); 

// ── Activities ────────────────────────────────────────────────────────────────
router.get ('/activities/path/:path_id',              auth, getActivitiesByPath);
router.get ('/activities/:id/learn',                  auth, getActivityLearnView);
router.get ('/activities/:id/videos',                 auth, getVideosByActivity);
router.get ('/activities/:id/checkpoints',            auth, getCheckpointsByActivity);
router.get ('/activities/:activity_id/progress',      auth, getActivityProgress);
router.get ('/activities/:activity_id/next-question', auth, getNextQuestion);
router.get ('/activities/:id',                        auth, getActivityById);
router.post('/activities/:activity_id/end',           auth, endActivity);

// ── Videos ────────────────────────────────────────────────────────────────────
router.get ('/videos/:video_id',                      auth, getVideoById);

// ── Checkpoints ───────────────────────────────────────────────────────────────
router.get ('/checkpoints/:checkpoint_id/questions',  auth, getQuestionsByCheckpoint);
router.get ('/checkpoints/:checkpoint_id',            auth, getCheckpointById);
router.post('/checkpoints/:checkpoint_id/submit',     auth, submitCheckpoint);

// ── Spot the Difference ───────────────────────────────────────────────────────
router.get ('/games/:game_id/difference',             auth, getDifferenceGame);
router.post('/games/:game_id/difference/check',       auth, checkDifferenceSpots);

// ── Pick the Right Ingredient ─────────────────────────────────────────────────
router.get ('/games/:game_id/pick-ingredient',        auth, getPickIngredientGame);
router.post('/games/:game_id/pick-ingredient/submit', auth, submitPickIngredient);

// ── Tag the Sequence ──────────────────────────────────────────────────────────
router.get ('/games/:game_id/sequence',               auth, getSequenceSteps);
router.post('/games/:game_id/sequence/submit',        auth, checkSequence);

// ── Gamification — Sessions, Points, Badges, Leaderboard ─────────────────────
router.post('/game-sessions',                         auth, createGameSession);
router.get ('/game-sessions',                         auth, getMyGameSessions);
router.get ('/leaderboard',                           auth, getLeaderboard);
router.get ('/badges',                                auth, getMyBadges);
router.get ('/points',                                auth, getMyPoints);
router.post('/video-complete',                        auth, completeVideoLesson);    // ✅ added
router.post('/checkpoint-complete',                   auth, completeCheckpoint);     // ✅ added

// ── Game Dashboard ─────────────────────────────────────────────────────────────
router.get('/game-dashboard',                        auth, getGameDashboard);
router.get('/achievements',                          auth, getAchievements);
router.get('/path-games/:path_id',                  auth, getPathGames);
router.get('/games/:game_id/levels',                 auth, getGameLevels);
router.get('/games/path/:path_id',                   auth, getGamesByPathStudent);  // ← get games by path for students
router.get('/games/levels/:path_id/:game_type_id',   auth, getLevelsByPathAndType);  // ← get levels by path and game type
router.get('/games/:game_id',                        auth, getGameById);
router.get('/games/:game_id/levels',                 auth, getGameLevels);



// ── Student profile (/:id MUST be last) ──────────────────────────────────────
router.get   ('/',    auth, getAllStudents);
router.get   ('/:id', auth, getStudentById);
router.put   ('/:id', auth, updateStudent);
router.delete('/:id', auth, deleteStudent);

module.exports = router;