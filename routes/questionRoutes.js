const express  = require('express');
const router   = express.Router();
const {
  deleteQuestion,
} = require('../controllers/questionController');

// ── Question CRUD ─────────────────────────────────────────────────────────────
router.delete('/:question_id', deleteQuestion); // DELETE /api/questions/:question_id

module.exports = router;