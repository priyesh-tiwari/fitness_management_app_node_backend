const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: { type: String, required: true },
  body: { type: String, required: true },
  type: { type: String, default: 'general' },
  isRead: { type: Boolean, default: false },
  data: { type: Map, of: String },
}, {
  timestamps: true
});

// Auto-delete after 15 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 15 });

module.exports = mongoose.model('Notification', notificationSchema);