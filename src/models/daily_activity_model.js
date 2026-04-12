// src/models/daily_activity_model.js

'use strict';

const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Sub-schema: single exercise session
// ---------------------------------------------------------------------------
const exerciseSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: [true, 'Exercise type is required'],
      enum: {
        values: [
          'running', 'walking', 'cycling', 'weight_training',
          'hiit', 'yoga', 'swimming', 'jump_rope', 'dancing',
          'basketball', 'football', 'tennis', 'boxing', 'other'
        ],
        message: '{VALUE} is not a supported exercise type'
      }
    },
    customName: {
      type: String,
      trim: true,
      maxlength: [100, 'Custom name cannot exceed 100 characters'],
      default: function () {
        return this.type;
      }
    },
    duration: {
      type: Number,
      required: [true, 'Duration is required'],
      min: [1, 'Duration must be at least 1 minute'],
      max: [600, 'Duration cannot exceed 600 minutes per session']
    },
    calories: {
      type: Number,
      required: true,
      min: [0, 'Calories cannot be negative']
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  { _id: true }
);

// ---------------------------------------------------------------------------
// Main schema
// ---------------------------------------------------------------------------
const dailyActivitySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true
    },

    // Stored as midnight UTC of the user-local day (normalised by controller)
    date: {
      type: Date,
      required: [true, 'Date is required'],
      index: true
    },

    // ── Tracked values ──────────────────────────────────────────────────────

    waterIntake: {
      type: Number,
      default: 0,
      min: [0, 'Water intake cannot be negative'],
      max: [20000, 'Water intake value seems unrealistic (>20 L)']
    },

    exercises: {
      type: [exerciseSchema],
      default: []
    },

    // Kept in sync via pre-save hook — do NOT write directly
    caloriesBurned: {
      type: Number,
      default: 0,
      min: [0, 'Calories burned cannot be negative']
    },

    meditation: {
      type: Number,
      default: 0,
      min: [0, 'Meditation duration cannot be negative'],
      max: [1440, 'Meditation duration exceeds 24 hours']
    },

    // Stored in hours (decimals allowed, e.g. 7.5)
    sleepTime: {
      type: Number,
      default: 0,
      min: [0, 'Sleep time cannot be negative'],
      max: [24, 'Sleep time cannot exceed 24 hours']
    },

    // ── Goals (snapshot from user settings at record-creation time) ─────────
    goals: {
      waterIntake: {
        type: Number,
        default: 2000,
        min: [0, 'Water goal cannot be negative']
      },
      exerciseDuration: {
        type: Number,
        default: 30,
        min: [0, 'Exercise duration goal cannot be negative']
      },
      meditation: {
        type: Number,
        default: 15,
        min: [0, 'Meditation goal cannot be negative']
      },
      sleepTime: {
        type: Number,
        default: 7,
        min: [0, 'Sleep goal cannot be negative'],
        max: [24, 'Sleep goal cannot exceed 24 hours']
      }
    },

    // Timezone offset in minutes (e.g. +330 for IST, -300 for EST)
    // Stored so analytics queries can reconstruct the user-local date correctly
    timezoneOffset: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Primary access pattern: one document per user per day
dailyActivitySchema.index({ user: 1, date: 1 }, { unique: true });

// Analytics range queries
dailyActivitySchema.index({ user: 1, date: -1 });

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

dailyActivitySchema.virtual('totalExerciseDuration').get(function () {
  return this.exercises.reduce((sum, ex) => sum + ex.duration, 0);
});

dailyActivitySchema.virtual('allGoalsAchieved').get(function () {
  return (
    this.waterIntake >= this.goals.waterIntake &&
    this.totalExerciseDuration >= this.goals.exerciseDuration &&
    this.meditation >= this.goals.meditation &&
    this.sleepTime >= this.goals.sleepTime
  );
});

// ---------------------------------------------------------------------------
// Instance methods
// ---------------------------------------------------------------------------

/**
 * Returns per-goal progress { achieved, current, goal, percentage }
 */
dailyActivitySchema.methods.getGoalProgress = function () {
  const totalExercise = this.totalExerciseDuration;

  const calc = (current, goal) => ({
    achieved: current >= goal,
    current,
    goal,
    percentage: goal > 0 ? Math.min(100, Math.round((current / goal) * 100)) : 100
  });

  return {
    water: calc(this.waterIntake, this.goals.waterIntake),
    exercise: calc(totalExercise, this.goals.exerciseDuration),
    meditation: calc(this.meditation, this.goals.meditation),
    sleep: calc(this.sleepTime, this.goals.sleepTime)
  };
};

// ---------------------------------------------------------------------------
// Pre-save hook — keep caloriesBurned consistent
// ---------------------------------------------------------------------------

dailyActivitySchema.pre('save', function (next) {
  this.caloriesBurned = this.exercises.reduce((sum, ex) => sum + (ex.calories || 0), 0);
  next();
});

// ---------------------------------------------------------------------------

module.exports = mongoose.model('DailyActivity', dailyActivitySchema);