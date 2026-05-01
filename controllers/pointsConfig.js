// ════════════════════════════════════════════════════════════════════════════════
// POINTS CONFIG — single source of truth for all point values
// Import this directly in every controller. Never import from gamificationController.
// ════════════════════════════════════════════════════════════════════════════════

const POINTS = {
  // Pick the Right Ingredient
  PTRI_CORRECT_INGREDIENT: 100,
  PTRI_TIME_ATTACK_BONUS:  50,   // added when on_time === true
  PTRI_TIME_ATTACK_FAIL:   0,    // no deduction, just no bonus

  // Tag the Sequence
  SEQ_CORRECT_STEP:        100,
  SEQ_TIME_ATTACK_BONUS:   50,
  SEQ_TIME_ATTACK_FAIL:    0,

  // Spot the Difference
  SPOT_PER_ANOMALY:        100,
  SPOT_TIME_ATTACK_BONUS:  50,
  SPOT_TIME_ATTACK_FAIL:   0,

  // Checkpoint quizzes
  CHECKPOINT_CORRECT_EASY: 50,
  CHECKPOINT_CORRECT_HARD: 100,

  // Video lesson completion (one-time per video)
  VIDEO_LESSON_COMPLETED:  30,

  // Try-again multiplier — applied on attempt 2+
  TRY_AGAIN_MULTIPLIER:    0.5,  // 50 % of raw points
};

/**
 * Apply try-again penalty if attempt > 1.
 * @param {number} rawPoints
 * @param {number} attemptNumber  1-based
 * @returns {number}
 */
const applyTryAgain = (rawPoints, attemptNumber) =>
  attemptNumber > 1 ? Math.floor(rawPoints * POINTS.TRY_AGAIN_MULTIPLIER) : rawPoints;

module.exports = { POINTS, applyTryAgain };