const express = require('express');
const {
  sendOTP,
  verifyOTP,
  createPassword,
  completeProfile,
  loginUser,
  getCurrentUser,
  sendForgotPasswordOTP,
  verifyForgotPasswordOTP,
  resetPassword,
  googleSignIn
} = require('../controllers/auth_controller.js');
const { getProfile } = require('../controllers/user_controller.js');
const { protect } = require('../middlewares/auth_middleware.js');

const router = express.Router();

// Public routes
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);
router.post('/create-password', createPassword);
router.post('/login', loginUser);
router.post('/forgot-password/send-otp', sendForgotPasswordOTP);
router.post('/forgot-password/verify-otp', verifyForgotPasswordOTP);
router.post('/forgot-password/reset', resetPassword);
router.post('/google', googleSignIn);

// Protected routes
router.get('/me', protect, getCurrentUser);
router.post('/complete-profile', protect, completeProfile);
router.get('/profile', protect, getProfile);

module.exports = router;