
const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification_controller');
const { protect } = require('../middlewares/auth_middleware');

router.use(protect);

// Existing routes - unchanged
router.post('/fcm-token', notificationController.saveFCMToken);
router.put('/settings', notificationController.updateReminderSettings);
router.get('/settings', notificationController.getReminderSettings);

// New routes
router.get('/', notificationController.getNotifications);
router.patch('/read-all', notificationController.markAllAsRead);
router.patch('/:id/read', notificationController.markAsRead);
router.delete('/clear-all', notificationController.clearAll);
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;