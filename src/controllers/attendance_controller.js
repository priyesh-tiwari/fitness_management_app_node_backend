const Subscription = require('../models/subscription_model');
const Program = require('../models/program_model');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Mark attendance (Trainer only for their students)
const markAttendance = async (req, res) => {
  try {
    let { qrCode } = req.body;
    const trainerId = req.user.userId;

    if (!qrCode) {
      return res.status(400).json({
        success: false,
        message: 'QR code is required'
      });
    }

    // QR contains JSON — parse and extract actual hash
    try {
      const parsed = JSON.parse(qrCode);
      qrCode = parsed.qrCode;
    } catch (e) {
      // not JSON, use as-is
    }

    const subscription = await Subscription.findOne({ qrCode })
      .populate({
        path: 'program',
        populate: {
          path: 'trainer',
          select: '_id name email'
        }
      })
      .populate('user', 'name email');

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Invalid QR code or subscription not found'
      });
    }

    if (subscription.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Subscription is ${subscription.status}`
      });
    }

    if (subscription.expiryDate < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Subscription has expired'
      });
    }

    if (subscription.paymentStatus !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Payment not completed for this subscription'
      });
    }

    const programTrainerId = subscription.program.trainer._id || subscription.program.trainer;

    if (programTrainerId.toString() !== trainerId.toString()) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to mark attendance for this student. This student belongs to another trainer's program."
      });
    }

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    if (!subscription.program.schedule.days.includes(today)) {
      return res.status(400).json({
        success: false,
        message: `Today (${today}) is not a class day for this program. Class days: ${subscription.program.schedule.days.join(', ')}`
      });
    }

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    const alreadyMarked = subscription.attendanceHistory.some(attendance => {
      const attDate = new Date(attendance.date);
      attDate.setHours(0, 0, 0, 0);
      return attDate.getTime() === todayDate.getTime();
    });

    if (alreadyMarked) {
      return res.status(400).json({
        success: false,
        message: 'Attendance already marked for today'
      });
    }

    subscription.attendanceHistory.push({
      date: new Date(),
      markedAt: new Date(),
      dayOfWeek: today
    });

    subscription.attendanceCount += 1;
    await subscription.save();

    res.status(200).json({
      success: true,
      message: 'Attendance marked successfully',
      data: {
        student: subscription.user,
        program: subscription.program.name,
        trainer: subscription.program.trainer.name,
        date: new Date(),
        totalAttendance: subscription.attendanceCount
      }
    });

  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get attendance for a student (User can see their own, Trainer can see their students)
const getMyAttendance = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { subscriptionId } = req.query;

    let query = {};

    if (userRole === 'user') {
      query.user = userId;
      if (subscriptionId) {
        query._id = subscriptionId;
      }
    } else if (userRole === 'trainer') {
      if (subscriptionId) {
        const subscription = await Subscription.findById(subscriptionId).populate('program');
        if (!subscription) {
          return res.status(404).json({
            success: false,
            message: 'Subscription not found'
          });
        }

        if (subscription.program.trainer.toString() !== userId.toString()) {
          return res.status(403).json({
            success: false,
            message: 'You are not authorized to view this attendance'
          });
        }

        query._id = subscriptionId;
      } else {
        const trainerPrograms = await Program.find({ trainer: userId }).select('_id');
        const programIds = trainerPrograms.map(p => p._id);
        query.program = { $in: programIds };
      }
    }

    const subscriptions = await Subscription.find(query)
      .populate('program', 'name schedule programType')
      .populate('user', 'name email')
      .select('attendanceHistory attendanceCount status expiryDate')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: subscriptions
    });

  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get weekly attendance for specific subscription
const getSubscriptionWeeklyAttendance = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { subscriptionId } = req.params;

    const now = new Date();
    const currentWeekStart = new Date(now);
    currentWeekStart.setDate(now.getDate() - (now.getDay() === 0 ? 6 : now.getDay() - 1));
    currentWeekStart.setHours(0, 0, 0, 0);

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId
    }).populate('program', 'name schedule');

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    const weeklyAttendance = subscription.attendanceHistory.filter(att => {
      const attDate = new Date(att.date);
      attDate.setHours(0, 0, 0, 0);
      return attDate >= currentWeekStart;
    });

    res.status(200).json({
      success: true,
      data: {
        subscriptionId: subscription._id,
        programName: subscription.program.name,
        programId: subscription.program._id,
        schedule: subscription.program.schedule,
        weeklyAttendance,
        totalAttendance: subscription.attendanceCount
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get weekly attendance for all subscriptions
const getWeeklyAttendance = async (req, res) => {
  try {
    const userId = req.user.userId;

    const now = new Date();
    const currentWeekStart = new Date(now);
    currentWeekStart.setDate(now.getDate() - (now.getDay() === 0 ? 6 : now.getDay() - 1));
    currentWeekStart.setHours(0, 0, 0, 0);

    const subscriptions = await Subscription.find({
      user: userId,
      status: 'active'
    }).populate('program', 'name schedule');

    const result = subscriptions.map(sub => ({
      subscriptionId: sub._id,
      programName: sub.program.name,
      programId: sub.program._id,
      schedule: sub.program.schedule,
      weeklyAttendance: sub.attendanceHistory.filter(att => {
        const attDate = new Date(att.date);
        attDate.setHours(0, 0, 0, 0);
        return attDate >= currentWeekStart;
      }),
      totalAttendance: sub.attendanceCount
    }));

    res.status(200).json({
      success: true,
      data: result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get attendance report for trainer's program
const getProgramAttendanceReport = async (req, res) => {
  try {
    const { programId } = req.params;
    const trainerId = req.user.userId;

    const program = await Program.findById(programId);
    if (!program) {
      return res.status(404).json({
        success: false,
        message: 'Program not found'
      });
    }

    if (program.trainer.toString() !== trainerId.toString()) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view this program's attendance"
      });
    }

    const subscriptions = await Subscription.find({
      program: programId,
      status: 'active'
    })
      .populate('user', 'name email')
      .select('user attendanceCount attendanceHistory startDate expiryDate')
      .sort({ 'user.name': 1 });

    const report = subscriptions.map(sub => ({
      student: sub.user,
      totalAttendance: sub.attendanceCount,
      subscriptionPeriod: {
        start: sub.startDate,
        end: sub.expiryDate
      },
      recentAttendance: sub.attendanceHistory.slice(-5).reverse()
    }));

    res.status(200).json({
      success: true,
      data: {
        program: program.name,
        totalStudents: subscriptions.length,
        students: report
      }
    });

  } catch (error) {
    console.error('Get program attendance report error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};



module.exports = {
  markAttendance,
  getMyAttendance,
  getSubscriptionWeeklyAttendance,
  getWeeklyAttendance,
  getProgramAttendanceReport
};