// src/models/user_model.js

'use strict';

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      required: false
    },
    role: {
      type: String,
      enum: ['trainer', 'user'],
      default: 'user'
    },
    profileImage: {
      type: String,
      default: ''
    },

    // ── Subscription / payments ──────────────────────────────────────────────
    paymentHistory: [
      {
        sessionId:       String,
        paymentIntentId: String,
        planType:        String,
        amount:          Number,
        currency:        String,
        status:          String,
        paidAt:          Date
      }
    ],
    activeSubscriptions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Subscription'
      }
    ],
    totalAttendance: {
      type: Number,
      default: 0
    },

    // ── Daily goals ──────────────────────────────────────────────────────────
    dailyGoals: {
      waterIntake:      { type: Number, default: 2000 },
      exerciseDuration: { type: Number, default: 30   },
      meditation:       { type: Number, default: 10   },
      sleepTime:        { type: Number, default: 8    }
    },

    // ── Notifications ────────────────────────────────────────────────────────
    fcmToken: { type: String, default: null },
    reminderSettings: {
      enabled:          { type: Boolean, default: false  },
      time:             { type: String,  default: '09:00' },
      endOfDayReminder: { type: Boolean, default: true   },
      endOfDayTime:     { type: String,  default: '21:00' }
    },

    // ── Profile ──────────────────────────────────────────────────────────────
    username: {
      type:      String,
      unique:    true,
      sparse:    true,   // allows multiple null values
      trim:      true,
      lowercase: true,
      minlength: [3,  'Username must be at least 3 characters'],
      maxlength: [30, 'Username cannot exceed 30 characters'],
      match: [
        /^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/,
        'Username must start and end with a letter or number, and can only contain letters, numbers, dots and underscores'
      ]
    },
    weight: { type: Number, default: 70 },

    // ── Email verification (signup OTP) ──────────────────────────────────────
    isEmailVerified: { type: Boolean, default: false },
    otp:             { type: String,  default: null  }, // stored as bcrypt hash
    otpExpiry:       { type: Date,    default: null  },
    otpAttempts:     { type: Number,  default: 0     },
    otpLockedUntil:  { type: Date,    default: null  },
    lastOtpSentAt:   { type: Date,    default: null  },

    // ── Password reset OTP ───────────────────────────────────────────────────
    resetOtp:            { type: String,  default: null  }, // stored as bcrypt hash
    resetOtpExpiry:      { type: Date,    default: null  },
    resetOtpAttempts:    { type: Number,  default: 0     },
    resetOtpLockedUntil: { type: Date,    default: null  },
    lastResetOtpSentAt:  { type: Date,    default: null  },
    canResetPassword:    { type: Boolean, default: false },
  },
  {
    timestamps: true
  }
);

// Indexes for frequent query patterns
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });

module.exports = mongoose.model('User', userSchema);