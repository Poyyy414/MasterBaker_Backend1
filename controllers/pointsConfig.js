// controllers/pointsConfig.js
// Standalone POINTS config — imported by any controller that needs it
// This avoids circular dependency between gamificationController ↔ game controllers

const POINTS = {
  // ── Video Lessons ────────────────────────────────────────────────────────────
  VIDEO_LESSON_COMPLETED:  1000,

  // ── Checkpoints ──────────────────────────────────────────────────────────────
  CHECKPOINT_CORRECT_EASY: 50,
  CHECKPOINT_CORRECT_HARD: 100,

  // ── Pick the Right Ingredient (PTRI) ─────────────────────────────────────────
  PTRI_CORRECT_INGREDIENT: 100,
  PTRI_TIME_ATTACK_BONUS:  150,
  PTRI_TIME_ATTACK_FAIL:   0,

  // ── Tag the Sequence ─────────────────────────────────────────────────────────
  SEQ_CORRECT_STEP:        100,
  SEQ_TIME_ATTACK_BONUS:   150,
  SEQ_TIME_ATTACK_FAIL:    0,

  // ── Spot the Difference ──────────────────────────────────────────────────────
  SPOT_PER_ANOMALY:        50,
  SPOT_TIME_ATTACK_BONUS:  100,
  SPOT_TIME_ATTACK_FAIL:   0,

  // ── Try Again Multiplier ─────────────────────────────────────────────────────
  TRY_AGAIN_MULTIPLIER:    0.5,
};

const applyTryAgain = (rawPoints, attemptNumber = 1) => {
  if (attemptNumber > 1) return Math.floor(rawPoints * POINTS.TRY_AGAIN_MULTIPLIER);
  return rawPoints;
};

module.exports = { POINTS, applyTryAgain };