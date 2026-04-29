// Run this from your project root: node debug-imports.js
// It will tell you exactly which functions are undefined/missing

const path = require('path');

const checks = [
  {
    file: './controllers/checkpointController',
    needs: ['createCheckpoint','updateCheckpoint','deleteCheckpoint','getCheckpointsByActivity','getCheckpointById','submitCheckpoint','getActivityProgress','endActivity','getNextQuestion'],
  },
  {
    file: './controllers/activityController',
    needs: ['createActivity','getAllActivities','getActivityById','updateActivity','deleteActivity','createVideo','deleteVideo','getActivitiesByPath','getVideosByActivity','getVideoById','getActivityLearnView'],
  },
  {
    file: './controllers/gamificationController',
    needs: ['createGameSession','getMyGameSessions','getLeaderboard','getMyBadges','getMyPoints','POINTS','applyTryAgain'],
  },
  {
    file: './controllers/gameItemsController',
    needs: ['getPickIngredientGame','submitPickIngredient','getGameItemsTeacher','createGameItem','updateGameItem','deleteGameItem'],
  },
  {
    file: './controllers/sequenceController',
    needs: ['getSequenceSteps','getSequenceStepsTeacher','createSequenceStep','updateSequenceStep','deleteSequenceStep','checkSequence'],
  },
  {
    file: './controllers/differenceController',
    needs: ['createDifferenceImage','createDifferenceSpot','deleteDifferenceSpot','getDifferenceGame','checkDifferenceSpots'],
  },
  {
    file: './controllers/questionController',
    needs: ['createQuestion','getQuestionsByCheckpoint','deleteQuestion'],
  },
];

let allGood = true;

for (const { file, needs } of checks) {
  let mod;
  try {
    mod = require(file);
  } catch (e) {
    console.error(`❌ CANNOT LOAD ${file}\n   → ${e.message}\n`);
    allGood = false;
    continue;
  }

  const missing = needs.filter(fn => typeof mod[fn] === 'undefined');
  const wrong   = needs.filter(fn => mod[fn] !== undefined && typeof mod[fn] !== 'function' && fn !== 'POINTS');

  if (missing.length === 0 && wrong.length === 0) {
    console.log(`✅ ${file}`);
  } else {
    allGood = false;
    if (missing.length) console.error(`❌ ${file}\n   MISSING exports: ${missing.join(', ')}`);
    if (wrong.length)   console.error(`   WRONG type (not a function): ${wrong.join(', ')}`);
    console.log('');
  }
}

if (allGood) {
  console.log('\n🎉 All imports look good! The bug is elsewhere.');
} else {
  console.log('\n⬆️  Fix the ❌ items above, then run npm start again.');
}