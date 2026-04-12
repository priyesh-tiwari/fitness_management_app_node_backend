const Subscription = require('../models/subscription_model');
const DailyActivity = require('../models/daily_activity_model');
const User = require('../models/user_model');
const { generateInsights } = require('../services/ai_service');

/**
 * Generate AI-powered insights for the logged-in user
 * Only generates when user explicitly requests (on-demand)
 */
const generatePersonalInsights = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId).select('name dailyGoals');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // FIX 2: Guard against missing dailyGoals
    if (!user.dailyGoals) {
      return res.status(400).json({
        success: false,
        message: 'Please set your daily goals first.'
      });
    }

    // Calculate date range (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Fetch user's active subscriptions
    const subscriptions = await Subscription.find({
      user: userId,
      status: 'active'
    }).populate('program', 'name schedule');

    // Analyze attendance data (even if no subscriptions)
    const attendanceData = subscriptions.length > 0
      ? analyzeAttendance(subscriptions, thirtyDaysAgo)
      : {
          totalAttended: 0,
          totalPossible: 0,
          attendanceRate: 0,
          byDayOfWeek: {},
          currentStreak: 0,
          longestStreak: 0,
          hasSubscriptions: false
        };

    // Fetch daily activities
    const activities = await DailyActivity.find({
      user: userId,
      date: { $gte: thirtyDaysAgo }
    }).sort({ date: 1 });

    // FIX 1: Use || so user must have at least one of: activities OR subscriptions
    if (activities.length === 0 && subscriptions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No activity data found. Start logging your daily activities or subscribe to a program.'
      });
    }

    // Analyze daily activities
    const dailyActivities = analyzeDailyActivities(activities, user.dailyGoals);

    // Prepare data for AI
    const userData = {
      userName: user.name,
      attendanceData,
      dailyActivities,
      goalSettings: user.dailyGoals
    };

    // Generate insights using AI
    const result = await generateInsights(userData);

    res.status(200).json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Generate insights error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate insights',
      error: error.message
    });
  }
};

/**
 * Helper: Analyze attendance patterns
 */
function analyzeAttendance(subscriptions, thirtyDaysAgo) {
  let totalAttended = 0;
  let byDayOfWeek = {
    Monday: { attended: 0, possible: 0 },
    Tuesday: { attended: 0, possible: 0 },
    Wednesday: { attended: 0, possible: 0 },
    Thursday: { attended: 0, possible: 0 },
    Friday: { attended: 0, possible: 0 },
    Saturday: { attended: 0, possible: 0 },
    Sunday: { attended: 0, possible: 0 }
  };

  const scheduledDays = new Set();

  subscriptions.forEach(sub => {
    const recentAttendance = sub.attendanceHistory.filter(
      att => new Date(att.date) >= thirtyDaysAgo
    );

    totalAttended += recentAttendance.length;

    recentAttendance.forEach(att => {
      // FIX 3: Guard against missing dayOfWeek
      const day = att.dayOfWeek;
      if (day && byDayOfWeek[day]) {
        byDayOfWeek[day].attended++;
      }
    });

    if (sub.program.schedule && sub.program.schedule.days) {
      sub.program.schedule.days.forEach(day => {
        scheduledDays.add(day);
      });
    }
  });

  scheduledDays.forEach(day => {
    let count = 0;
    const checkDate = new Date(thirtyDaysAgo);
    const today = new Date();

    while (checkDate <= today) {
      const dayName = checkDate.toLocaleDateString('en-US', { weekday: 'long' });
      if (dayName === day) count++;
      checkDate.setDate(checkDate.getDate() + 1);
    }

    byDayOfWeek[day].possible = count;
  });

  const totalPossible = Object.values(byDayOfWeek).reduce(
    (sum, day) => sum + day.possible, 0
  );

  const attendanceRate = totalPossible > 0
    ? Math.round((totalAttended / totalPossible) * 100)
    : 0;

  const allAttendance = subscriptions
    .flatMap(sub => sub.attendanceHistory)
    .map(att => new Date(att.date))
    .sort((a, b) => a - b);

  const { currentStreak, longestStreak } = calculateStreaks(allAttendance);

  return {
    totalAttended,
    totalPossible,
    attendanceRate,
    byDayOfWeek,
    currentStreak,
    longestStreak,
    hasSubscriptions: true
  };
}

/**
 * Helper: Calculate attendance streaks
 */
function calculateStreaks(attendanceDates) {
  if (attendanceDates.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  let currentStreak = 0;
  let longestStreak = 1;
  let tempStreak = 1;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const mostRecent = new Date(attendanceDates[attendanceDates.length - 1]);
  mostRecent.setHours(0, 0, 0, 0);

  if (mostRecent.getTime() === today.getTime() ||
      mostRecent.getTime() === yesterday.getTime()) {
    currentStreak = 1;
  }

  for (let i = 1; i < attendanceDates.length; i++) {
    const prevDate = new Date(attendanceDates[i - 1]);
    const currDate = new Date(attendanceDates[i]);

    prevDate.setHours(0, 0, 0, 0);
    currDate.setHours(0, 0, 0, 0);

    const daysDiff = Math.floor(
      (currDate - prevDate) / (1000 * 60 * 60 * 24)
    );

    if (daysDiff === 1) {
      tempStreak++;

      if (currDate.getTime() === today.getTime() ||
          currDate.getTime() === yesterday.getTime()) {
        currentStreak = tempStreak;
      }
    } else if (daysDiff === 0) {
      continue;
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 1;
    }
  }

  longestStreak = Math.max(longestStreak, tempStreak);

  return { currentStreak, longestStreak };
}

/**
 * Helper: Analyze daily activities
 */
function analyzeDailyActivities(activities, goals) {
  if (activities.length === 0) {
    return {
      avgWaterIntake: 0,
      avgExerciseDuration: 0,
      avgMeditation: 0,
      avgSleepTime: 0,
      daysAllGoalsAchieved: 0,
      totalDaysLogged: 0,
      waterGoalRate: 0,
      exerciseGoalRate: 0,
      meditationGoalRate: 0,
      sleepGoalRate: 0
    };
  }

  const totals = activities.reduce((acc, act) => ({
    water: acc.water + act.waterIntake,
    exercise: acc.exercise + act.exerciseDuration,
    meditation: acc.meditation + act.meditation,
    sleep: acc.sleep + act.sleepTime
  }), { water: 0, exercise: 0, meditation: 0, sleep: 0 });

  const goalAchievement = activities.reduce((acc, act) => ({
    water: acc.water + (act.waterIntake >= act.goals.waterIntake ? 1 : 0),
    exercise: acc.exercise + (act.exerciseDuration >= act.goals.exerciseDuration ? 1 : 0),
    meditation: acc.meditation + (act.meditation >= act.goals.meditation ? 1 : 0),
    sleep: acc.sleep + (act.sleepTime >= act.goals.sleepTime ? 1 : 0)
  }), { water: 0, exercise: 0, meditation: 0, sleep: 0 });

  const daysAllGoalsAchieved = activities.filter(act =>
    act.waterIntake >= act.goals.waterIntake &&
    act.exerciseDuration >= act.goals.exerciseDuration &&
    act.meditation >= act.goals.meditation &&
    act.sleepTime >= act.goals.sleepTime
  ).length;

  const totalDays = activities.length;

  return {
    avgWaterIntake: Math.round(totals.water / totalDays),
    avgExerciseDuration: Math.round(totals.exercise / totalDays),
    avgMeditation: Math.round(totals.meditation / totalDays),
    avgSleepTime: Math.round(totals.sleep / totalDays),
    daysAllGoalsAchieved,
    totalDaysLogged: totalDays,
    waterGoalRate: Math.round((goalAchievement.water / totalDays) * 100),
    exerciseGoalRate: Math.round((goalAchievement.exercise / totalDays) * 100),
    meditationGoalRate: Math.round((goalAchievement.meditation / totalDays) * 100),
    sleepGoalRate: Math.round((goalAchievement.sleep / totalDays) * 100)
  };
}

module.exports = {
  generatePersonalInsights
};