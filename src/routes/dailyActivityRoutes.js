// src/routes/daily_activity_routes.js

'use strict';

const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/daily_activity_controller');
const { protect } = require('../middlewares/auth_middleware');

// ---------------------------------------------------------------------------
// All routes require a valid JWT
// ---------------------------------------------------------------------------
router.use(protect);

// ---------------------------------------------------------------------------
// Daily snapshot
// ---------------------------------------------------------------------------

/**
 * GET /api/activity/today
 * Returns (or creates) today's activity document for the authenticated user.
 *
 * Query params:
 *   tz  {number}  UTC offset in minutes (e.g. 330 for IST, -300 for EST)
 *                 Defaults to 0 (UTC) if omitted.
 */
router.get('/today', controller.getTodayActivity);

// ---------------------------------------------------------------------------
// Tracking endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/activity/water
 * Body: { amount: number }  — positive to add, negative to subtract
 */
router.post('/water', controller.updateWater);

/**
 * POST /api/activity/exercise
 * Body: { exerciseType: string, duration: number, customName?: string }
 */
router.post('/exercise', controller.logExercise);

/**
 * DELETE /api/activity/exercise/:exerciseId
 * Removes a specific exercise session from today's record.
 */
router.delete('/exercise/:exerciseId', controller.deleteExercise);

/**
 * POST /api/activity/meditation
 * Body: { duration: number }  — sets (overrides) today's meditation total
 */
router.post('/meditation', controller.setMeditation);

/**
 * POST /api/activity/sleep
 * Body: { hours: number }  — sets (overrides) last night's sleep total
 */
router.post('/sleep', controller.setSleepTime);

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * GET /api/activity/analysis/weekly
 * Returns aggregated stats for the current ISO week (Mon–Sun).
 * Includes a streak count that correctly spans beyond the current week.
 */
router.get('/analysis/weekly', controller.getWeeklyAnalysis);

/**
 * GET /api/activity/analysis/monthly
 * Returns aggregated stats for the current calendar month.
 */
router.get('/analysis/monthly', controller.getMonthlyAnalysis);

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------

/**
 * PUT /api/activity/goals
 * Body: { waterIntake?, exerciseDuration?, meditation?, sleepTime? }
 * Updates user-level default goals AND patches today's active document.
 */
router.put('/goals', controller.updateDailyGoals);

/**
 * PUT /api/activity/weight
 * Body: { weight: number }
 */
router.put('/weight', controller.updateWeight);

// ---------------------------------------------------------------------------

module.exports = router;