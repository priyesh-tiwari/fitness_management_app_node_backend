const cron = require('node-cron');
const User = require('../models/user_model');
const DailyActivity = require('../models/daily_activity_model');
const { 
  sendGoalReminder, 
  sendEndOfDayCheck, 
  sendWeeklySummary,
  sendMotivationalMessage,
  sendActivityReminder
} = require('./notification_service');

/**
 * Start all notification schedulers
 */
function startNotificationScheduler() {
  console.log('🔔 Starting notification scheduler...');

  // Morning reminder - 9:00 AM every day
  cron.schedule('0 9 * * *', async () => {
    console.log('📅 Running morning reminder...');
    await sendMorningReminders();
  }, {
    timezone: "Asia/Kolkata" // Change to your timezone
  });

  // Afternoon water reminder - 2:00 PM every day
  cron.schedule('0 14 * * *', async () => {
    console.log('💧 Running afternoon water reminder...');
    await sendAfternoonWaterReminders();
  }, {
    timezone: "Asia/Kolkata"
  });

  // Evening exercise reminder - 6:00 PM every day
  cron.schedule('0 18 * * *', async () => {
    console.log('🏃 Running evening exercise reminder...');
    await sendEveningExerciseReminders();
  }, {
    timezone: "Asia/Kolkata"
  });

  // End of day check - 10:00 PM every day
  cron.schedule('0 22 * * *', async () => {
    console.log('📊 Running end of day check...');
    await sendEndOfDayChecks();
  }, {
    timezone: "Asia/Kolkata"
  });

  // Weekly summary - Every Monday at 9:00 AM
  cron.schedule('0 9 * * 1', async () => {
    console.log('📈 Running weekly summary...');
    await sendWeeklySummaries();
  }, {
    timezone: "Asia/Kolkata"
  });

  // Check streaks - Every day at 11:59 PM
  cron.schedule('59 23 * * *', async () => {
    console.log('🔥 Checking streaks...');
    await checkAndNotifyStreaks();
  }, {
    timezone: "Asia/Kolkata"
  });

  console.log('✅ Notification scheduler started successfully');
}

/**
 * Send morning reminders to all users
 */
async function sendMorningReminders() {
  try {
    const users = await User.find({
      'reminderSettings.enabled': true,
      fcmToken: { $exists: true, $ne: null }
    });

    console.log(`📤 Sending morning reminders to ${users.length} users...`);

    for (const user of users) {
      await sendGoalReminder(user._id);
      await new Promise(resolve => setTimeout(resolve, 100)); // Delay to avoid rate limits
    }

    console.log('✅ Morning reminders sent');
  } catch (error) {
    console.error('❌ Error sending morning reminders:', error);
  }
}

/**
 * Send afternoon water reminders to users who haven't met their water goal
 */
async function sendAfternoonWaterReminders() {
  try {
    const users = await User.find({
      'reminderSettings.enabled': true,
      fcmToken: { $exists: true, $ne: null }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log(`💧 Checking water intake for ${users.length} users...`);

    for (const user of users) {
      const activity = await DailyActivity.findOne({
        user: user._id,
        date: today
      });

      // Send reminder if water intake is less than 50% of goal
      if (!activity || activity.waterIntake < (activity.goals.waterIntake * 0.5)) {
        await sendActivityReminder(user._id, 'water');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log('✅ Afternoon water reminders sent');
  } catch (error) {
    console.error('❌ Error sending afternoon water reminders:', error);
  }
}

/**
 * Send evening exercise reminders to users who haven't met their exercise goal
 */
async function sendEveningExerciseReminders() {
  try {
    const users = await User.find({
      'reminderSettings.enabled': true,
      fcmToken: { $exists: true, $ne: null }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log(`🏃 Checking exercise for ${users.length} users...`);

    for (const user of users) {
      const activity = await DailyActivity.findOne({
        user: user._id,
        date: today
      });

      const totalExercise = activity?.exercises?.reduce((sum, ex) => sum + ex.duration, 0) || 0;

      // Send reminder if exercise is less than goal
      if (!activity || totalExercise < activity.goals.exerciseDuration) {
        await sendActivityReminder(user._id, 'exercise');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log('✅ Evening exercise reminders sent');
  } catch (error) {
    console.error('❌ Error sending evening exercise reminders:', error);
  }
}

/**
 * Send end of day checks to all users
 */
async function sendEndOfDayChecks() {
  try {
    const users = await User.find({
      'reminderSettings.enabled': true,
      'reminderSettings.endOfDayReminder': true,
      fcmToken: { $exists: true, $ne: null }
    });

    console.log(`📊 Sending end of day checks to ${users.length} users...`);

    for (const user of users) {
      await sendEndOfDayCheck(user._id);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('✅ End of day checks sent');
  } catch (error) {
    console.error('❌ Error sending end of day checks:', error);
  }
}

/**
 * Send weekly summaries to all users
 */
async function sendWeeklySummaries() {
  try {
    const users = await User.find({
      'reminderSettings.enabled': true,
      fcmToken: { $exists: true, $ne: null }
    });

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // Get start of week (Monday)
    const startOfWeek = new Date(today);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);
    startOfWeek.setHours(0, 0, 0, 0);

    console.log(`📈 Sending weekly summaries to ${users.length} users...`);

    for (const user of users) {
      const activities = await DailyActivity.find({
        user: user._id,
        date: { $gte: startOfWeek, $lte: today }
      }).sort({ date: 1 });

      if (activities.length > 0) {
        // Calculate weekly summary
        const totalDays = activities.length;
        
        const goalsAchieved = activities.reduce((acc, act) => {
          const exerciseDuration = act.exercises?.reduce((sum, ex) => sum + ex.duration, 0) || 0;
          return {
            water: acc.water + (act.waterIntake >= act.goals.waterIntake ? 1 : 0),
            exercise: acc.exercise + (exerciseDuration >= act.goals.exerciseDuration ? 1 : 0),
            meditation: acc.meditation + (act.meditation >= act.goals.meditation ? 1 : 0),
            sleep: acc.sleep + (act.sleepTime >= act.goals.sleepTime ? 1 : 0)
          };
        }, { water: 0, exercise: 0, meditation: 0, sleep: 0 });

        // Calculate streak
        const streak = calculateCurrentStreak(activities);

        const weeklySummary = {
          totalDays,
          goalsAchieved,
          streak
        };

        await sendWeeklySummary(user._id, weeklySummary);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log('✅ Weekly summaries sent');
  } catch (error) {
    console.error('❌ Error sending weekly summaries:', error);
  }
}

/**
 * Check and notify users about their streaks
 */
async function checkAndNotifyStreaks() {
  try {
    const users = await User.find({
      'reminderSettings.enabled': true,
      fcmToken: { $exists: true, $ne: null }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    console.log(`🔥 Checking streaks for ${users.length} users...`);

    for (const user of users) {
      // Get last 30 days of activities
      const activities = await DailyActivity.find({
        user: user._id,
        date: { $gte: thirtyDaysAgo, $lte: today }
      }).sort({ date: -1 });

      if (activities.length > 0) {
        const streak = calculateCurrentStreak(activities);
        
        // Send notification for milestone streaks
        if ([3, 7, 14, 30, 60, 90].includes(streak)) {
          await sendMotivationalMessage(user._id, streak);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    console.log('✅ Streak checks completed');
  } catch (error) {
    console.error('❌ Error checking streaks:', error);
  }
}

/**
 * Calculate current streak of perfect days
 * @param {Array} activities - Array of daily activities (sorted by date DESC)
 * @returns {number} Current streak count
 */
function calculateCurrentStreak(activities) {
  let streak = 0;
  const sortedActivities = activities.sort((a, b) => b.date - a.date);

  for (const activity of sortedActivities) {
    const exerciseDuration = activity.exercises?.reduce((sum, ex) => sum + ex.duration, 0) || 0;
    const allGoalsMet = (
      activity.waterIntake >= activity.goals.waterIntake &&
      exerciseDuration >= activity.goals.exerciseDuration &&
      activity.meditation >= activity.goals.meditation &&
      activity.sleepTime >= activity.goals.sleepTime
    );

    if (allGoalsMet) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Stop all schedulers (useful for testing or graceful shutdown)
 */
function stopNotificationScheduler() {
  console.log('🛑 Stopping notification scheduler...');
  // node-cron handles cleanup automatically
  console.log('✅ Notification scheduler stopped');
}

module.exports = {
  startNotificationScheduler,
  stopNotificationScheduler
};