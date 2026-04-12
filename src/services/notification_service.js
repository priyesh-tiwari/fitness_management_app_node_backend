const admin = require('firebase-admin');
const User = require('../models/user_model');
const DailyActivity = require('../models/daily_activity_model');
const Notification = require('../models/notification_model');

if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_PROJECT_ID) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        })
      });
      console.log('✅ Firebase Admin initialized with environment variables');
    } else {
      const serviceAccount = require('../../firebase-service-account.json');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('✅ Firebase Admin initialized with service account file');
    }
  } catch (error) {
    console.error('❌ Firebase Admin initialization error:', error);
  }
}

async function saveNotificationToDB(userId, title, body, type, data = {}) {
  try {
    await Notification.create({ user: userId, title, body, type, data });
  } catch (e) {
    console.error('❌ Error saving notification to DB:', e);
  }
}

async function sendPushNotification(fcmToken, title, body, data = {}) {
  try {
    if (!fcmToken) {
      console.log('⚠️ No FCM token provided');
      return { success: false, error: 'No FCM token' };
    }

    const message = {
      notification: { title, body },
      data: { ...data, timestamp: new Date().toISOString() },
      token: fcmToken,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'daily_activity',
          color: '#4CAF50'
        }
      },
      apns: {
        payload: {
          aps: { sound: 'default', badge: 1 }
        }
      }
    };

    const response = await admin.messaging().send(message);
    console.log('✅ Notification sent successfully:', response);
    return { success: true, response };
  } catch (error) {
    console.error('❌ Notification error:', error);
    if (
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered'
    ) {
      await User.findOneAndUpdate({ fcmToken }, { $unset: { fcmToken: 1 } });
      console.log('🗑️ Removed invalid FCM token');
    }
    return { success: false, error: error.message };
  }
}

async function checkAndNotifyGoalCompletion(userId, previousActivity, currentActivity, goalType) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.fcmToken) return;

    const currentExerciseDuration = currentActivity.exercises?.reduce((sum, ex) => sum + ex.duration, 0) || 0;
    const previousExerciseDuration = previousActivity?.exercises?.reduce((sum, ex) => sum + ex.duration, 0) || 0;

    const currentGoalStatus = {
      water: currentActivity.waterIntake >= currentActivity.goals.waterIntake,
      exercise: currentExerciseDuration >= currentActivity.goals.exerciseDuration,
      meditation: currentActivity.meditation >= currentActivity.goals.meditation,
      sleep: currentActivity.sleepTime >= currentActivity.goals.sleepTime
    };

    const previousGoalStatus = {
      water: previousActivity ? previousActivity.waterIntake >= previousActivity.goals.waterIntake : false,
      exercise: previousActivity ? previousExerciseDuration >= previousActivity.goals.exerciseDuration : false,
      meditation: previousActivity ? previousActivity.meditation >= previousActivity.goals.meditation : false,
      sleep: previousActivity ? previousActivity.sleepTime >= previousActivity.goals.sleepTime : false
    };

    const justCompleted = {
      water: currentGoalStatus.water && !previousGoalStatus.water,
      exercise: currentGoalStatus.exercise && !previousGoalStatus.exercise,
      meditation: currentGoalStatus.meditation && !previousGoalStatus.meditation,
      sleep: currentGoalStatus.sleep && !previousGoalStatus.sleep
    };

    if (goalType && justCompleted[goalType]) {
      const notifications = {
        water: {
          title: '💧 Water Goal Achieved!',
          body: `Great job! You've reached your daily water goal of ${currentActivity.goals.waterIntake}ml`,
          type: 'water_goal_completed'
        },
        exercise: {
          title: '🏋️ Exercise Goal Achieved!',
          body: `Awesome! You've completed your ${currentActivity.goals.exerciseDuration} min exercise goal`,
          type: 'exercise_goal_completed'
        },
        meditation: {
          title: '🧘 Meditation Goal Achieved!',
          body: `Well done! You've completed ${currentActivity.goals.meditation} minutes of meditation`,
          type: 'meditation_goal_completed'
        },
        sleep: {
          title: '😴 Sleep Goal Achieved!',
          body: `Excellent! You got ${currentActivity.goals.sleepTime} hours of quality sleep`,
          type: 'sleep_goal_completed'
        }
      };

      const notification = notifications[goalType];
      if (notification) {
        await sendPushNotification(user.fcmToken, notification.title, notification.body, {
          type: notification.type,
          goalType,
          userId: userId.toString()
        });
        await saveNotificationToDB(userId, notification.title, notification.body, notification.type);
      }
    }

    const allGoalsAchieved = Object.values(currentGoalStatus).every(status => status);
    const wasAllGoalsAchieved = Object.values(previousGoalStatus).every(status => status);

    if (allGoalsAchieved && !wasAllGoalsAchieved) {
      const title = '🎉 Perfect Day Achieved!';
      const body = 'Congratulations! You\'ve achieved ALL your daily goals today! 🌟';
      await sendPushNotification(user.fcmToken, title, body, {
        type: 'all_goals_completed',
        userId: userId.toString()
      });
      await saveNotificationToDB(userId, title, body, 'all_goals_completed');
    }
  } catch (error) {
    console.error('❌ Error in checkAndNotifyGoalCompletion:', error);
  }
}

async function sendGoalReminder(userId) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.fcmToken || !user.reminderSettings?.enabled) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activity = await DailyActivity.findOne({ user: userId, date: today });

    if (!activity) {
      const title = '💪 Time to Get Moving!';
      const body = 'Don\'t forget to log your activity today. Stay consistent!';
      await sendPushNotification(user.fcmToken, title, body, { type: 'workout_reminder' });
      await saveNotificationToDB(userId, title, body, 'workout_reminder');
      return;
    }

    const totalExercise = activity.exercises?.reduce((sum, ex) => sum + ex.duration, 0) || 0;
    const lowProgress = [
      { name: 'Water', progress: Math.round((activity.waterIntake / activity.goals.waterIntake) * 100) },
      { name: 'Exercise', progress: Math.round((totalExercise / activity.goals.exerciseDuration) * 100) },
      { name: 'Meditation', progress: Math.round((activity.meditation / activity.goals.meditation) * 100) },
      { name: 'Sleep', progress: Math.round((activity.sleepTime / activity.goals.sleepTime) * 100) }
    ].filter(item => item.progress < 50);

    if (lowProgress.length > 0) {
      const progressText = lowProgress.map(item => `${item.name}: ${item.progress}%`).join(', ');
      const title = '⏰ Goal Reminder';
      const body = `Keep going! ${progressText}`;
      await sendPushNotification(user.fcmToken, title, body, { type: 'progress_reminder', progressText });
      await saveNotificationToDB(userId, title, body, 'progress_reminder');
    }
  } catch (error) {
    console.error('❌ Goal reminder error:', error);
  }
}

async function sendEndOfDayCheck(userId) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.fcmToken || !user.reminderSettings?.endOfDayReminder) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activity = await DailyActivity.findOne({ user: userId, date: today });

    if (!activity) {
      const title = '📊 Daily Check';
      const body = 'You haven\'t logged any activity today. There\'s still time!';
      await sendPushNotification(user.fcmToken, title, body, { type: 'end_of_day_no_activity' });
      await saveNotificationToDB(userId, title, body, 'end_of_day_no_activity');
      return;
    }

    const totalExercise = activity.exercises?.reduce((sum, ex) => sum + ex.duration, 0) || 0;
    const goalsAchieved = {
      water: activity.waterIntake >= activity.goals.waterIntake,
      exercise: totalExercise >= activity.goals.exerciseDuration,
      meditation: activity.meditation >= activity.goals.meditation,
      sleep: activity.sleepTime >= activity.goals.sleepTime
    };

    const achievedCount = Object.values(goalsAchieved).filter(Boolean).length;
    const totalGoals = Object.keys(goalsAchieved).length;

    let title, body, type;

    if (achievedCount === totalGoals) {
      title = '🎉 Perfect Day!';
      body = 'Amazing work today! You crushed ALL your goals. Keep it up! 🌟';
      type = 'goal_completed';
    } else if (achievedCount > 0) {
      title = '💪 Good Progress!';
      body = `You completed ${achievedCount} out of ${totalGoals} goals today. Keep pushing!`;
      type = 'partial_goals';
    } else {
      const messages = [];
      if (!goalsAchieved.water) messages.push(`Water: ${activity.waterIntake}/${activity.goals.waterIntake}ml`);
      if (!goalsAchieved.exercise) messages.push(`Exercise: ${totalExercise}/${activity.goals.exerciseDuration}min`);
      if (!goalsAchieved.meditation) messages.push(`Meditation: ${activity.meditation}/${activity.goals.meditation}min`);
      if (!goalsAchieved.sleep) messages.push(`Sleep: ${activity.sleepTime}/${activity.goals.sleepTime}h`);
      title = '💪 Tomorrow Is a New Day!';
      body = `${messages.join(', ')}. You can do better tomorrow!`;
      type = 'goal_incomplete';
    }

    await sendPushNotification(user.fcmToken, title, body, { type, achievedCount, totalGoals });
    await saveNotificationToDB(userId, title, body, type);
  } catch (error) {
    console.error('❌ End of day check error:', error);
  }
}

async function sendWeeklySummary(userId, weeklySummary) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.fcmToken || !user.reminderSettings?.enabled) return;

    const { goalsAchieved, totalDays, streak } = weeklySummary;
    const perfectDays = goalsAchieved
      ? Math.min(goalsAchieved.water, goalsAchieved.exercise, goalsAchieved.meditation, goalsAchieved.sleep)
      : 0;

    const title = '📊 Your Weekly Summary';
    const body = `This week: ${perfectDays} perfect days out of ${totalDays}! ${streak > 0 ? `Current streak: ${streak} days 🔥` : 'Start a new streak!'}`;

    await sendPushNotification(user.fcmToken, title, body, {
      type: 'weekly_summary',
      userId: userId.toString(),
      perfectDays,
      totalDays,
      streak
    });
    await saveNotificationToDB(userId, title, body, 'weekly_summary');
  } catch (error) {
    console.error('❌ Error sending weekly summary:', error);
  }
}

async function sendMotivationalMessage(userId, streak) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.fcmToken || !user.reminderSettings?.enabled) return;

    const milestones = {
      3:  { title: '⭐ 3 Day Streak!',  body: 'Nice! You\'re building a great habit! Keep it going!' },
      7:  { title: '🔥 7 Day Streak!',  body: 'Incredible! You\'ve maintained a perfect week!' },
      14: { title: '💎 14 Day Streak!', body: 'Two weeks strong! You\'re unstoppable!' },
      30: { title: '🏆 30 Day Streak!', body: 'Outstanding! A full month of crushing your goals!' },
      60: { title: '👑 60 Day Streak!', body: 'You\'re a legend! Two months of dedication!' },
      90: { title: '🎖️ 90 Day Streak!', body: 'Phenomenal! Three months of excellence!' }
    };

    const milestone = milestones[streak];
    if (milestone) {
      await sendPushNotification(user.fcmToken, milestone.title, milestone.body, {
        type: 'motivation',
        streak,
        userId: userId.toString()
      });
      await saveNotificationToDB(userId, milestone.title, milestone.body, 'motivation');
    }
  } catch (error) {
    console.error('❌ Error sending motivational message:', error);
  }
}

async function sendActivityReminder(userId, reminderType) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.fcmToken || !user.reminderSettings?.enabled) return;

    const reminders = {
      water:      { title: '💧 Hydration Time!',   body: 'Don\'t forget to drink water! Stay hydrated throughout the day.' },
      exercise:   { title: '🏃 Exercise Reminder', body: 'Ready to get moving? Even 10 minutes of activity counts!' },
      meditation: { title: '🧘 Meditation Time',   body: 'Take a moment to breathe and meditate. Your mind will thank you.' },
      sleep:      { title: '😴 Sleep Reminder',    body: 'Time to wind down. Aim for your sleep goal tonight for a productive tomorrow!' }
    };

    const reminder = reminders[reminderType];
    if (reminder) {
      await sendPushNotification(user.fcmToken, reminder.title, reminder.body, {
        type: `activity_reminder_${reminderType}`,
        reminderType,
        userId: userId.toString()
      });
      await saveNotificationToDB(userId, reminder.title, reminder.body, `activity_reminder_${reminderType}`);
    }
  } catch (error) {
    console.error('❌ Error sending activity reminder:', error);
  }
}

module.exports = {
  sendPushNotification,
  sendGoalReminder,
  sendEndOfDayCheck,
  checkAndNotifyGoalCompletion,
  sendWeeklySummary,
  sendMotivationalMessage,
  sendActivityReminder
};