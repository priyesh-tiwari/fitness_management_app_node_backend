// src/controllers/daily_activity_controller.js

'use strict';

const DailyActivity = require('../models/daily_activity_model');
const User = require('../models/user_model');
const { checkAndNotifyGoalCompletion } = require('../services/notification_service');
const { calculateCalories } = require('../utils/calorie_calculator');
const logger = { error: console.error, warn: console.warn, info: console.log, debug: console.log };
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_WATER_PER_REQUEST_ML = 5000;   // 5 L per single log — sanity cap
const MAX_EXERCISE_DURATION_MIN = 600;   // 10 h per session — sanity cap
const MAX_EXERCISE_SESSIONS_PER_DAY = 20;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Converts an arbitrary Date (or timestamp) to midnight UTC for the
 * user-local calendar day, given the user's UTC offset in minutes.
 *
 * Example: user in IST (offset = +330), it's 2024-03-15 01:00 IST
 *   → local midnight = 2024-03-15 00:00 IST = 2024-03-14 18:30 UTC
 *
 * @param {Date}   now            - current moment (pass new Date() normally)
 * @param {number} timezoneOffset - client UTC offset in minutes (e.g. 330 for IST)
 * @returns {Date} midnight-UTC representing the user's current local day
 */
const getUserLocalMidnightUTC = (now = new Date(), timezoneOffset = 0) => {
  // Shift the clock to the user's local time, then strip time component
  const localMs = now.getTime() + timezoneOffset * 60 * 1000;
  const localDate = new Date(localMs);
  localDate.setUTCHours(0, 0, 0, 0);
  // Shift back to UTC
  return new Date(localDate.getTime() - timezoneOffset * 60 * 1000);
};

/**
 * Atomically find-or-create today's activity document using upsert.
 * Eliminates the race condition present in find-then-create.
 *
 * @param {string|ObjectId} userId
 * @param {User}            user           - pre-fetched user document (avoids double query)
 * @param {number}          timezoneOffset - client UTC offset in minutes
 * @returns {Promise<DailyActivity>}
 */
const getOrCreateTodayActivity = async (userId, user, timezoneOffset = 0) => {
  const todayUTC = getUserLocalMidnightUTC(new Date(), timezoneOffset);

  const activity = await DailyActivity.findOneAndUpdate(
    { user: userId, date: todayUTC },
    {
      $setOnInsert: {
        user: userId,
        date: todayUTC,
        waterIntake: 0,
        exercises: [],
        meditation: 0,
        sleepTime: 0,
        caloriesBurned: 0,
        timezoneOffset,
        goals: {
          waterIntake:      user.dailyGoals?.waterIntake      ?? 2000,
          exerciseDuration: user.dailyGoals?.exerciseDuration ?? 30,
          meditation:       user.dailyGoals?.meditation       ?? 15,
          sleepTime:        user.dailyGoals?.sleepTime        ?? 7
        }
      }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      // runValidators on upsert would throw on $setOnInsert — skip here;
      // values are validated at the controller level before reaching this call
    }
  );

  return activity;
};

/**
 * Build a lean "previous state" snapshot used by the notification service
 * to detect goal-crossing events (e.g. "you just hit your water goal!").
 *
 * Only the fields the notification service compares are included.
 */
const snapshotForNotification = (activity) => ({
  waterIntake:  activity.waterIntake,
  meditation:   activity.meditation,
  sleepTime:    activity.sleepTime,
  goals:        { ...activity.goals.toObject?.() ?? activity.goals },
  // Minimal exercise info the notification service needs
  exercises: activity.exercises.map((e) => ({ duration: e.duration }))
});

/**
 * Compute current consecutive-day streak for a user.
 * Queries the DB independently from weekly/monthly analytics so the result
 * is never artificially capped at 7 days.
 *
 * Algorithm:
 *   - Walk backwards from today (or yesterday if today isn't complete yet).
 *   - Increment streak for each consecutive day where ALL goals were met.
 *   - Stop as soon as there is a gap or a day where goals were not met.
 *
 * @param {string|ObjectId} userId
 * @param {number}          timezoneOffset
 * @returns {Promise<number>}
 */
const calculateCurrentStreak = async (userId, timezoneOffset = 0) => {
  // Fetch up to 400 days — enough for any realistic streak, limits DB load
  const activities = await DailyActivity.find({ user: userId })
    .sort({ date: -1 })
    .limit(400)
    .lean();

  if (!activities.length) return 0;

  const todayUTC  = getUserLocalMidnightUTC(new Date(), timezoneOffset);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  let streak = 0;
  // Start checking from today; if today isn't complete we'll simply skip it
  let expectedTime = todayUTC.getTime();

  for (const activity of activities) {
    const actTime = new Date(activity.date).getTime();
    const diffDays = Math.round((expectedTime - actTime) / MS_PER_DAY);

    if (diffDays > 1) {
      // Gap detected — streak is broken
      break;
    }

    if (diffDays < 0) {
      // Future date (shouldn't happen, but guard anyway)
      continue;
    }

    const totalExercise = activity.exercises.reduce((s, e) => s + e.duration, 0);
    const allGoalsMet   =
      activity.waterIntake  >= activity.goals.waterIntake  &&
      totalExercise         >= activity.goals.exerciseDuration &&
      activity.meditation   >= activity.goals.meditation   &&
      activity.sleepTime    >= activity.goals.sleepTime;

    if (allGoalsMet) {
      streak++;
      expectedTime = actTime - MS_PER_DAY; // expect previous calendar day next
    } else if (diffDays === 0) {
      // Today exists but goals aren't complete yet — don't penalise; look back
      expectedTime = actTime - MS_PER_DAY;
    } else {
      // A past day where goals were not met — streak ends
      break;
    }
  }

  return streak;
};

/**
 * Shared analytics aggregation helper used by both weekly and monthly routes.
 *
 * @param {string|ObjectId} userId
 * @param {Date}            startDate
 * @param {Date}            endDate
 * @returns {Promise<object>}
 */
const buildAnalytics = async (userId, startDate, endDate) => {
  const activities = await DailyActivity.find({
    user: userId,
    date: { $gte: startDate, $lte: endDate }
  })
    .sort({ date: 1 })
    .lean();

  const totalDays = activities.length;

  const totals = activities.reduce(
    (acc, act) => {
      const exerciseDuration = act.exercises.reduce((s, e) => s + e.duration, 0);
      return {
        water:      acc.water      + act.waterIntake,
        exercise:   acc.exercise   + exerciseDuration,
        meditation: acc.meditation + act.meditation,
        sleep:      acc.sleep      + act.sleepTime,
        calories:   acc.calories   + act.caloriesBurned
      };
    },
    { water: 0, exercise: 0, meditation: 0, sleep: 0, calories: 0 }
  );

  const averages =
    totalDays > 0
      ? {
          water:      Math.round(totals.water      / totalDays),
          exercise:   Math.round(totals.exercise   / totalDays),
          meditation: Math.round(totals.meditation / totalDays),
          sleep:      parseFloat((totals.sleep     / totalDays).toFixed(1)),
          calories:   Math.round(totals.calories   / totalDays)
        }
      : { water: 0, exercise: 0, meditation: 0, sleep: 0, calories: 0 };

  const goalsAchieved = activities.reduce(
    (acc, act) => {
      const exerciseDuration = act.exercises.reduce((s, e) => s + e.duration, 0);
      return {
        water:      acc.water      + (act.waterIntake  >= act.goals.waterIntake      ? 1 : 0),
        exercise:   acc.exercise   + (exerciseDuration >= act.goals.exerciseDuration ? 1 : 0),
        meditation: acc.meditation + (act.meditation   >= act.goals.meditation       ? 1 : 0),
        sleep:      acc.sleep      + (act.sleepTime    >= act.goals.sleepTime        ? 1 : 0)
      };
    },
    { water: 0, exercise: 0, meditation: 0, sleep: 0 }
  );

  const perfectDays = activities.filter((act) => {
    const exerciseDuration = act.exercises.reduce((s, e) => s + e.duration, 0);
    return (
      act.waterIntake  >= act.goals.waterIntake      &&
      exerciseDuration >= act.goals.exerciseDuration &&
      act.meditation   >= act.goals.meditation       &&
      act.sleepTime    >= act.goals.sleepTime
    );
  }).length;

  const enrichedActivities = activities.map((act) => ({
    ...act,
    totalExerciseDuration: act.exercises.reduce((s, e) => s + e.duration, 0)
  }));

  return {
    activities: enrichedActivities,
    totals,
    averages,
    totalDays,
    perfectDays,
    goalsAchieved,
    completionRate: totalDays > 0 ? Math.round((perfectDays / totalDays) * 100) : 0
  };
};

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/activity/today
 * Returns today's activity document enriched with goal progress percentages.
 */
exports.getTodayActivity = async (req, res) => {
  try {
    const userId        = req.user.userId;
    // timezoneOffset is sent by the client as a query param (e.g. ?tz=330)
    const timezoneOffset = parseInt(req.query.tz ?? '0', 10) || 0;

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const activity = await getOrCreateTodayActivity(userId, user, timezoneOffset);
    const progress  = activity.getGoalProgress();

    return res.status(200).json({
      success: true,
      data: {
        ...activity.toObject(),
        goalProgress: progress
      }
    });
  } catch (error) {
    logger.error('getTodayActivity error', { error: error.message, userId: req.user?.userId });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------

/**
 * POST /api/activity/water
 * Body: { amount: number (ml, positive to add / negative to remove) }
 *
 * Uses findOneAndUpdate with $max to prevent negative totals atomically.
 */
exports.updateWater = async (req, res) => {
  try {
    const userId         = req.user.userId;
    const timezoneOffset = parseInt(req.query.tz ?? '0', 10) || 0;
    const amount         = Number(req.body.amount);

    // ── Validation ─────────────────────────────────────────────────────────
    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({
        success: false,
        message: 'amount must be a non-zero finite number'
      });
    }
    if (Math.abs(amount) > MAX_WATER_PER_REQUEST_ML) {
      return res.status(400).json({
        success: false,
        message: `amount cannot exceed ±${MAX_WATER_PER_REQUEST_ML} ml per request`
      });
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Ensure document exists first (upsert-safe)
    const before = await getOrCreateTodayActivity(userId, user, timezoneOffset);
    const prevSnapshot = snapshotForNotification(before);

    // Apply delta; clamp to [0, max] atomically
    const newValue  = Math.min(20000, Math.max(0, before.waterIntake + amount));
    const todayUTC  = getUserLocalMidnightUTC(new Date(), timezoneOffset);

    const activity = await DailyActivity.findOneAndUpdate(
      { user: userId, date: todayUTC },
      { $set: { waterIntake: newValue } },
      { new: true, runValidators: true }
    );

    // Fire-and-forget notification (do not await — keep response fast)
    checkAndNotifyGoalCompletion(userId, prevSnapshot, activity, 'water').catch((err) =>
      logger.error('Notification error (water)', { error: err.message, userId })
    );

    return res.status(200).json({
      success: true,
      data: activity,
      message: amount > 0 ? `Added ${amount} ml` : `Removed ${Math.abs(amount)} ml`
    });
  } catch (error) {
    logger.error('updateWater error', { error: error.message, userId: req.user?.userId });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------

/**
 * POST /api/activity/exercise
 * Body: { exerciseType, duration, customName? }
 */
exports.logExercise = async (req, res) => {
  try {
    const userId         = req.user.userId;
    const timezoneOffset = parseInt(req.query.tz ?? '0', 10) || 0;
    const { exerciseType, duration: rawDuration, customName } = req.body;

    // ── Validation ─────────────────────────────────────────────────────────
    const duration = Number(rawDuration);

    if (!exerciseType || typeof exerciseType !== 'string') {
      return res.status(400).json({ success: false, message: 'exerciseType is required' });
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      return res.status(400).json({ success: false, message: 'duration must be a positive number' });
    }
    if (duration > MAX_EXERCISE_DURATION_MIN) {
      return res.status(400).json({
        success: false,
        message: `duration cannot exceed ${MAX_EXERCISE_DURATION_MIN} minutes per session`
      });
    }
    if (customName && customName.length > 100) {
      return res.status(400).json({ success: false, message: 'customName cannot exceed 100 characters' });
    }

    // Single DB call to fetch user (used for both weight and getOrCreate)
    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const userWeight = user.weight || 70;
    const calories   = calculateCalories(exerciseType, duration, userWeight);

    // Ensure today's document exists
    const before = await getOrCreateTodayActivity(userId, user, timezoneOffset);

    // Guard: prevent an unrealistic number of sessions per day
    if (before.exercises.length >= MAX_EXERCISE_SESSIONS_PER_DAY) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_EXERCISE_SESSIONS_PER_DAY} exercise sessions allowed per day`
      });
    }

    const prevSnapshot = snapshotForNotification(before);
    const todayUTC     = getUserLocalMidnightUTC(new Date(), timezoneOffset);

    const activity = await DailyActivity.findOneAndUpdate(
      { user: userId, date: todayUTC },
      {
        $push: {
          exercises: {
            type:       exerciseType,
            customName: (customName?.trim()) || exerciseType,
            duration,
            calories,
            timestamp: new Date()
          }
        }
      },
      { new: true, runValidators: true }
    );

    // The pre-save hook won't run on findOneAndUpdate; recalculate calories manually
    // and persist with a second atomic update (keeps the hook as source of truth on save())
    const totalCalories = activity.exercises.reduce((s, e) => s + e.calories, 0);
    activity.caloriesBurned = totalCalories;
    await DailyActivity.updateOne(
      { _id: activity._id },
      { $set: { caloriesBurned: totalCalories } }
    );
    activity.caloriesBurned = totalCalories; // reflect in returned object

    checkAndNotifyGoalCompletion(userId, prevSnapshot, activity, 'exercise').catch((err) =>
      logger.error('Notification error (exercise)', { error: err.message, userId })
    );

    return res.status(200).json({
      success: true,
      data: activity,
      message: `Exercise logged: ${duration} minutes, ${calories} calories burned`,
      totalExerciseDuration: activity.exercises.reduce((s, e) => s + e.duration, 0)
    });
  } catch (error) {
    logger.error('logExercise error', { error: error.message, userId: req.user?.userId });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------

/**
 * DELETE /api/activity/exercise/:exerciseId
 * Removes a specific exercise session from today's record.
 */
exports.deleteExercise = async (req, res) => {
  try {
    const userId         = req.user.userId;
    const timezoneOffset = parseInt(req.query.tz ?? '0', 10) || 0;
    const { exerciseId } = req.params;

    if (!exerciseId) {
      return res.status(400).json({ success: false, message: 'exerciseId is required' });
    }

    const todayUTC = getUserLocalMidnightUTC(new Date(), timezoneOffset);

    // Use a direct findOne — do NOT call getOrCreateTodayActivity here to avoid
    // creating an empty document just to return a 404
    const activity = await DailyActivity.findOne({ user: userId, date: todayUTC });

    if (!activity) {
      return res.status(404).json({ success: false, message: "No activity record found for today" });
    }

    const exerciseIndex = activity.exercises.findIndex(
      (ex) => ex._id.toString() === exerciseId
    );

    if (exerciseIndex === -1) {
      return res.status(404).json({ success: false, message: 'Exercise not found' });
    }

    activity.exercises.splice(exerciseIndex, 1);
    // pre-save hook recalculates caloriesBurned
    await activity.save();

    return res.status(200).json({
      success: true,
      data: activity,
      message: 'Exercise deleted successfully'
    });
  } catch (error) {
    logger.error('deleteExercise error', { error: error.message, userId: req.user?.userId });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------

/**
 * POST /api/activity/meditation
 * Body: { duration: number (minutes, set/override model) }
 */
exports.setMeditation = async (req, res) => {
  try {
    const userId         = req.user.userId;
    const timezoneOffset = parseInt(req.query.tz ?? '0', 10) || 0;
    const duration       = Number(req.body.duration);

    if (!Number.isFinite(duration) || duration < 0) {
      return res.status(400).json({
        success: false,
        message: 'duration must be a non-negative number'
      });
    }
    if (duration > 1440) {
      return res.status(400).json({
        success: false,
        message: 'duration cannot exceed 1440 minutes (24 hours)'
      });
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const before       = await getOrCreateTodayActivity(userId, user, timezoneOffset);
    const prevSnapshot = snapshotForNotification(before);
    const todayUTC     = getUserLocalMidnightUTC(new Date(), timezoneOffset);

    const activity = await DailyActivity.findOneAndUpdate(
      { user: userId, date: todayUTC },
      { $set: { meditation: duration } },
      { new: true, runValidators: true }
    );

    checkAndNotifyGoalCompletion(userId, prevSnapshot, activity, 'meditation').catch((err) =>
      logger.error('Notification error (meditation)', { error: err.message, userId })
    );

    return res.status(200).json({
      success: true,
      data: activity,
      message: `Meditation time set to ${duration} minutes`
    });
  } catch (error) {
    logger.error('setMeditation error', { error: error.message, userId: req.user?.userId });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------

/**
 * POST /api/activity/sleep
 * Body: { hours: number (0–24, set/override model) }
 */
exports.setSleepTime = async (req, res) => {
  try {
    const userId         = req.user.userId;
    const timezoneOffset = parseInt(req.query.tz ?? '0', 10) || 0;
    const hours          = Number(req.body.hours);

    if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
      return res.status(400).json({
        success: false,
        message: 'hours must be a number between 0 and 24'
      });
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const before       = await getOrCreateTodayActivity(userId, user, timezoneOffset);
    const prevSnapshot = snapshotForNotification(before);
    const todayUTC     = getUserLocalMidnightUTC(new Date(), timezoneOffset);

    const activity = await DailyActivity.findOneAndUpdate(
      { user: userId, date: todayUTC },
      { $set: { sleepTime: hours } },
      { new: true, runValidators: true }
    );

    checkAndNotifyGoalCompletion(userId, prevSnapshot, activity, 'sleep').catch((err) =>
      logger.error('Notification error (sleep)', { error: err.message, userId })
    );

    return res.status(200).json({
      success: true,
      data: activity,
      message: `Sleep time set to ${hours} hours`
    });
  } catch (error) {
    logger.error('setSleepTime error', { error: error.message, userId: req.user?.userId });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------

/**
 * GET /api/activity/analysis/weekly
 * Returns this week's activity data with totals, averages, goal achievement,
 * and a streak count that accurately crosses week boundaries.
 */
exports.getWeeklyAnalysis = async (req, res) => {
  try {
    const userId         = req.user.userId;
    const timezoneOffset = parseInt(req.query.tz ?? '0', 10) || 0;

    const nowUTC    = getUserLocalMidnightUTC(new Date(), timezoneOffset);
    const dayOfWeek = new Date(nowUTC.getTime() + timezoneOffset * 60 * 1000).getUTCDay();
    // ISO week starts on Monday
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const startOfWeek = new Date(nowUTC);
    startOfWeek.setUTCDate(nowUTC.getUTCDate() + diffToMonday);

    const endOfWeek = new Date(nowUTC);
    endOfWeek.setUTCHours(23, 59, 59, 999);

    const [analytics, streak] = await Promise.all([
      buildAnalytics(userId, startOfWeek, endOfWeek),
      calculateCurrentStreak(userId, timezoneOffset)
    ]);

    return res.status(200).json({
      success: true,
      data: {
        period: 'week',
        startDate: startOfWeek,
        endDate: endOfWeek,
        streak,
        ...analytics
      }
    });
  } catch (error) {
    logger.error('getWeeklyAnalysis error', { error: error.message, userId: req.user?.userId });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------

/**
 * GET /api/activity/analysis/monthly
 * Returns this month's activity data.
 */
exports.getMonthlyAnalysis = async (req, res) => {
  try {
    const userId         = req.user.userId;
    const timezoneOffset = parseInt(req.query.tz ?? '0', 10) || 0;

    // Derive current local year/month from the user's timezone
    const localNow        = new Date(Date.now() + timezoneOffset * 60 * 1000);
    const localYear       = localNow.getUTCFullYear();
    const localMonth      = localNow.getUTCMonth(); // 0-based

    // Start of month in local time → convert to UTC boundary
    const startOfMonthLocal = new Date(Date.UTC(localYear, localMonth, 1, 0, 0, 0, 0));
    const startOfMonth      = new Date(startOfMonthLocal.getTime() - timezoneOffset * 60 * 1000);

    const endOfMonthLocal = new Date(Date.UTC(localYear, localMonth + 1, 0, 23, 59, 59, 999));
    const endOfMonth      = new Date(endOfMonthLocal.getTime() - timezoneOffset * 60 * 1000);

    const analytics = await buildAnalytics(userId, startOfMonth, endOfMonth);

    // Month name derived from local time
    const monthLabel = localNow.toLocaleString('default', { month: 'long', year: 'numeric' });

    return res.status(200).json({
      success: true,
      data: {
        period: 'month',
        month: monthLabel,
        startDate: startOfMonth,
        endDate: endOfMonth,
        ...analytics
      }
    });
  } catch (error) {
    logger.error('getMonthlyAnalysis error', { error: error.message, userId: req.user?.userId });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------

/**
 * PUT /api/activity/goals
 * Updates the user's default daily goals AND syncs today's active document
 * so the UI reflects the change immediately.
 *
 * Body: { waterIntake?, exerciseDuration?, meditation?, sleepTime? }
 */
exports.updateDailyGoals = async (req, res) => {
  try {
    const userId         = req.user.userId;
    const timezoneOffset = parseInt(req.query.tz ?? '0', 10) || 0;
    const { waterIntake, exerciseDuration, meditation, sleepTime } = req.body;

    const userUpdateFields  = {};
    const activityGoalPatch = {};

    if (waterIntake !== undefined) {
      const v = Number(waterIntake);
      if (!Number.isFinite(v) || v <= 0) {
        return res.status(400).json({ success: false, message: 'waterIntake must be a positive number' });
      }
      userUpdateFields['dailyGoals.waterIntake']      = v;
      activityGoalPatch['goals.waterIntake']          = v;
    }

    if (exerciseDuration !== undefined) {
      const v = Number(exerciseDuration);
      if (!Number.isFinite(v) || v <= 0) {
        return res.status(400).json({ success: false, message: 'exerciseDuration must be a positive number' });
      }
      userUpdateFields['dailyGoals.exerciseDuration'] = v;
      activityGoalPatch['goals.exerciseDuration']     = v;
    }

    if (meditation !== undefined) {
      const v = Number(meditation);
      if (!Number.isFinite(v) || v < 0) {
        return res.status(400).json({ success: false, message: 'meditation must be a non-negative number' });
      }
      userUpdateFields['dailyGoals.meditation']       = v;
      activityGoalPatch['goals.meditation']           = v;
    }

    if (sleepTime !== undefined) {
      const v = Number(sleepTime);
      if (!Number.isFinite(v) || v <= 0 || v > 24) {
        return res.status(400).json({ success: false, message: 'sleepTime must be between 0 and 24 hours' });
      }
      userUpdateFields['dailyGoals.sleepTime']        = v;
      activityGoalPatch['goals.sleepTime']            = v;
    }

    if (Object.keys(userUpdateFields).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid goal fields provided' });
    }

    const todayUTC = getUserLocalMidnightUTC(new Date(), timezoneOffset);

    // Run both updates concurrently
    const [user] = await Promise.all([
      User.findByIdAndUpdate(
        userId,
        { $set: userUpdateFields },
        { new: true, runValidators: true }
      ),
      // Sync today's activity document if it exists (don't create if absent)
      DailyActivity.updateOne(
        { user: userId, date: todayUTC },
        { $set: activityGoalPatch }
      )
    ]);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({
      success: true,
      data: user.dailyGoals,
      message: 'Daily goals updated successfully'
    });
  } catch (error) {
    logger.error('updateDailyGoals error', { error: error.message, userId: req.user?.userId });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------

/**
 * PUT /api/activity/weight
 * Body: { weight: number (kg) }
 */
exports.updateWeight = async (req, res) => {
  try {
    const userId = req.user.userId;
    const weight = Number(req.body.weight);

    if (!Number.isFinite(weight) || weight <= 0 || weight > 500) {
      return res.status(400).json({
        success: false,
        message: 'weight must be a number between 1 and 500 kg'
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { weight } },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({
      success: true,
      data: { weight: user.weight },
      message: 'Weight updated successfully'
    });
  } catch (error) {
    logger.error('updateWeight error', { error: error.message, userId: req.user?.userId });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};