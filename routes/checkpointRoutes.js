const express  = require('express');
const router   = express.Router();
const {
  getCheckpointById,
  updateCheckpoint,
  deleteCheckpoint,
  submitCheckpoint,
} = require('../controllers/checkpointController');

const {
  createQuestion,
  getQuestionsByCheckpoint,
} = require('../controllers/questionController');

// ── Checkpoint CRUD ───────────────────────────────────────────────────────────
router.get   ('/:checkpoint_id',         getCheckpointById);   // GET    /api/checkpoints/:checkpoint_id
router.put   ('/:checkpoint_id',         updateCheckpoint);    // PUT    /api/checkpoints/:checkpoint_id
router.delete('/:checkpoint_id',         deleteCheckpoint);    // DELETE /api/checkpoints/:checkpoint_id
router.post  ('/:checkpoint_id/submit',  submitCheckpoint);    // POST   /api/checkpoints/:checkpoint_id/submit

// ── Questions nested under checkpoint ────────────────────────────────────────
router.post  ('/:checkpoint_id/questions', createQuestion);          // POST /api/checkpoints/:checkpoint_id/questions
router.get   ('/:checkpoint_id/questions', getQuestionsByCheckpoint);// GET  /api/checkpoints/:checkpoint_id/questions

module.exports = router;