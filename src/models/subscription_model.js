const mongoose = require('mongoose');
const crypto = require('crypto');

const subscriptionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    program: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Program',
        required: true
    },
    qrCode: {
        type: String,
        unique: true
    },
    startDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    expiryDate: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'expired', 'cancelled'],
        default: 'active'
    },
    attendanceCount: {
        type: Number,
        default: 0
    },
    attendanceHistory: [{
        date: {
            type: Date,
            required: true
        },
        markedAt: {
            type: Date,
            default: Date.now
        },
        dayOfWeek: String  // "Monday"
    }],
    paymentStatus: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded'],
        default: 'pending'
    },
    paymentDetails: {
        transactionId: String,
        amount: Number,
        paymentMethod: String,
        paidAt: Date
    },
    cancellationReason: String,
    cancelledAt: Date
}, {
    timestamps: true
});

// Auto-calculate expiry date
subscriptionSchema.pre('save', async function() {
    if (this.isNew && !this.expiryDate) {
        this.expiryDate = new Date(this.startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    }
    
    if (!this.qrCode) {
        this.qrCode = crypto.randomBytes(16).toString('hex');
    }
});

// Check if subscription is valid
subscriptionSchema.methods.isValid = function() {
    return this.status === 'active' && this.expiryDate > new Date();
};

// Check if today is a class day
subscriptionSchema.methods.isClassDay = async function() {
    await this.populate('program');
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    return this.program.schedule.days.includes(today);
};

subscriptionSchema.virtual('qrCodeData').get(function() {
    return JSON.stringify({
        subscriptionId: this._id,
        userId: this.user,
        programId: this.program,
        qrCode: this.qrCode,
        expiryDate: this.expiryDate
    });
});

subscriptionSchema.set('toJSON', { virtuals: true });
subscriptionSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);