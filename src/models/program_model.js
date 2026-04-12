const mongoose = require('mongoose');

const programSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    description: String,
    trainer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    schedule: {
        days: [{
            type: String,
            enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        }],
        time: {
            start: String,  // "06:00"
            end: String     // "07:00"
        }
    },
    programType: {
        type: String,
        enum: ['yoga', 'gym', 'cardio', 'strength', 'zumba'],
        required: true
    },
    price: {
        type: Number,
        required: true  // Monthly price
    },
    duration: {
        type: Number,
        default: 30  // 30 days
    },
    capacity: {
        maxParticipants: Number,
        currentActive: {
            type: Number,
            default: 0
        }
    },
    location: String,
    difficulty: {
        type: String,
        enum: ['beginner', 'intermediate', 'advanced']
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Program', programSchema);