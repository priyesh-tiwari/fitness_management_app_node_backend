const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendance_controller');
const { protect, checkTrainerRole } = require('../middlewares/auth_middleware');

// Mark attendance - Trainer only
router.post('/mark', protect, checkTrainerRole, attendanceController.markAttendance);

// Get attendance - Both user and trainer
router.get('/my-attendance', protect, attendanceController.getMyAttendance);

// Get weekly attendance for specific subscription
router.get('/weekly/:subscriptionId', protect, attendanceController.getSubscriptionWeeklyAttendance);

// Get weekly attendance for all subscriptions
router.get('/weekly', protect, attendanceController.getWeeklyAttendance);

// Get program attendance report - Trainer only
router.get('/program/:programId/report', protect, checkTrainerRole, attendanceController.getProgramAttendanceReport);

module.exports = router;