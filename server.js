// server.js (UPDATED)
require("node:dns/promises").setServers(["8.8.8.8", "1.1.1.1"]);
const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();
const path = require('path');

const app = express();

const paymentController = require('./src/controllers/payment_controller');
const authRoutes = require('./src/routes/authRoutes.js');
const sessionRoutes = require('./src/routes/program_routes.js');
const userRoutes = require('./src/routes/userRoutes');
const bookingRoutes = require('./src/routes/subscription_routes.js');
const paymentRoutes = require('./src/routes/paymentRoutes');
const dailyActivityRoutes = require('./src/routes/dailyActivityRoutes');
const notificationRoutes = require('./src/routes/notification_routes');
const { startNotificationScheduler } = require('./src/services/notification_scheduler');
const insightsRoutes = require('./src/routes/insights_routes.js');

app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  paymentController.stripeWebhook
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/insights', insightsRoutes);
app.use('/api/attendance', require('./src/routes/attendance_routes.js'));
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/activity', dailyActivityRoutes);
app.use('/api/notifications', notificationRoutes);

mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
})
  .then(() => {
    console.log('MongoDB connected successfully');
    mongoose.connection.db.admin().ping().then(() => {
      console.log('✅ MongoDB ping successful');
    });
  })
  .catch(err => console.error('MongoDB connection error:', err));

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

mongoose.connection.on('connected', () => {
  console.log('MongoDB connected successfully');
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startNotificationScheduler();
});