// src/controllers/notification_controller.js

const User = require('../models/user_model');
const Notification = require('../models/notification_model');

// Save FCM token
exports.saveFCMToken = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { fcmToken } = req.body;

    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        message: 'FCM token is required'
      });
    }

    await User.findByIdAndUpdate(userId, { fcmToken });

    res.status(200).json({
      success: true,
      message: 'FCM token saved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Update reminder settings
exports.updateReminderSettings = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { enabled, endOfDayReminder, time } = req.body;

    const updateData = {};
    if (enabled !== undefined) updateData['reminderSettings.enabled'] = enabled;
    if (endOfDayReminder !== undefined) updateData['reminderSettings.endOfDayReminder'] = endOfDayReminder;
    if (time) updateData['reminderSettings.time'] = time;

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true }
    );

    res.status(200).json({
      success: true,
      data: user.reminderSettings,
      message: 'Reminder settings updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get reminder settings
exports.getReminderSettings = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId).select('reminderSettings fcmToken');

    res.status(200).json({
      success: true,
      data: {
        reminderSettings: user.reminderSettings,
        hasToken: !!user.fcmToken
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};



// Get notifications for logged-in user
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;
    const notifications = await Notification.find({ user: userId })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Mark single notification as read
exports.markAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    await Notification.findOneAndUpdate(
      { _id: req.params.id, user: userId },
      { isRead: true }
    );
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    await Notification.updateMany({ user: userId, isRead: false }, { isRead: true });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete single notification
exports.deleteNotification = async (req, res) => {
  try {
    const userId = req.user.userId;
    await Notification.findOneAndDelete({ _id: req.params.id, user: userId });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Clear all notifications
exports.clearAll = async (req, res) => {
  try {
    const userId = req.user.userId;
    await Notification.deleteMany({ user: userId });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};