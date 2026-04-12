// src/controllers/auth_controller.js

'use strict';

const crypto  = require('crypto');
const User    = require('../models/user_model');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { sendOTPEmail } = require('../services/email_service');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OTP_COOLDOWN_SECONDS  = 60;       // min gap between OTP resend requests
const OTP_EXPIRY_MINUTES    = 5;
const OTP_MAX_ATTEMPTS      = 5;        // failed verifications before lockout
const OTP_LOCK_MINUTES      = 15;       // lockout duration after max attempts
const BCRYPT_ROUNDS         = 10;

// Fields always excluded from user responses — never leak OTP/reset data
const SENSITIVE_FIELDS =
  '-password -otp -otpExpiry -otpAttempts -otpLockedUntil -lastOtpSentAt ' +
  '-resetOtp -resetOtpExpiry -resetOtpAttempts -resetOtpLockedUntil ' +
  '-lastResetOtpSentAt -canResetPassword';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Cryptographically secure 6-digit OTP.
 */
const generateOTP = () =>
  crypto.randomInt(100000, 1000000).toString();

/**
 * Returns a sanitised user object safe to send to the client.
 */
const safeUser = (user) => ({
  id:              user._id,
  email:           user.email,
  name:            user.name,
  username:        user.username,
  role:            user.role,
  profileImage:    user.profileImage,
  isEmailVerified: user.isEmailVerified,
  createdAt:       user.createdAt
});

/**
 * Generic 500 response — never leaks internal error details in production.
 */
const serverError = (res) =>
  res.status(500).json({ success: false, message: 'Internal server error' });

// ---------------------------------------------------------------------------
// 1. Send OTP (signup)
// ---------------------------------------------------------------------------

exports.sendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    let user = await User.findOne({ email });

    if (user && user.isEmailVerified && user.password) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered. Please login.'
      });
    }

    if (user?.lastOtpSentAt) {
      const secondsSinceLast =
        (Date.now() - new Date(user.lastOtpSentAt).getTime()) / 1000;
      if (secondsSinceLast < OTP_COOLDOWN_SECONDS) {
        const wait = Math.ceil(OTP_COOLDOWN_SECONDS - secondsSinceLast);
        return res.status(429).json({
          success: false,
          message: `Please wait ${wait} seconds before requesting a new OTP`
        });
      }
    }

    const otp       = generateOTP();
    const expiry    = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    const hashedOtp = await bcrypt.hash(otp, BCRYPT_ROUNDS);

    if (user) {
      user.otp            = hashedOtp;
      user.otpExpiry      = expiry;
      user.otpAttempts    = 0;
      user.otpLockedUntil = null;
      user.lastOtpSentAt  = new Date();
      await user.save();
    } else {
      user = await User.create({
        email,
        otp:           hashedOtp,
        otpExpiry:     expiry,
        lastOtpSentAt: new Date()
      });
    }

    const emailResult = await sendOTPEmail(email, otp);
    if (!emailResult.success) {
      return res.status(500).json({ success: false, message: 'Failed to send OTP email' });
    }

    return res.status(200).json({ success: true, message: 'OTP sent to your email' });

  } catch (error) {
    console.error('sendOTP error:', error);
    return serverError(res);
  }
};

// ---------------------------------------------------------------------------
// 2. Verify OTP (signup)
// ---------------------------------------------------------------------------

exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.otpLockedUntil && new Date() < user.otpLockedUntil) {
      const mins = Math.ceil((user.otpLockedUntil - Date.now()) / 60000);
      return res.status(429).json({
        success: false,
        message: `Too many failed attempts. Try again in ${mins} minutes.`
      });
    }

    if (!user.otpExpiry || new Date() > user.otpExpiry) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }

    const isValid = user.otp ? await bcrypt.compare(otp, user.otp) : false;

    if (!isValid) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      if (user.otpAttempts >= OTP_MAX_ATTEMPTS) {
        user.otpLockedUntil = new Date(Date.now() + OTP_LOCK_MINUTES * 60 * 1000);
        await user.save();
        return res.status(429).json({
          success: false,
          message: `Too many failed attempts. Account locked for ${OTP_LOCK_MINUTES} minutes.`
        });
      }
      await user.save();
      const remaining = OTP_MAX_ATTEMPTS - user.otpAttempts;
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
      });
    }

    user.isEmailVerified = true;
    user.otp             = null;
    user.otpExpiry       = null;
    user.otpAttempts     = 0;
    user.otpLockedUntil  = null;
    await user.save();

    return res.status(200).json({ success: true, message: 'Email verified successfully' });

  } catch (error) {
    console.error('verifyOTP error:', error);
    return serverError(res);
  }
};

// ---------------------------------------------------------------------------
// 3. Create Password (signup)
// ---------------------------------------------------------------------------

exports.createPassword = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (!user.isEmailVerified) {
      return res.status(400).json({ success: false, message: 'Please verify your email first' });
    }
    if (user.password) {
      return res.status(400).json({ success: false, message: 'Password already set. Please login.' });
    }

    user.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await user.save();

    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.status(200).json({
      success: true,
      message: 'Password created successfully',
      token,
      user: safeUser(user)
    });

  } catch (error) {
    console.error('createPassword error:', error);
    return serverError(res);
  }
};

// ---------------------------------------------------------------------------
// 4. Complete Profile
// ---------------------------------------------------------------------------

exports.completeProfile = async (req, res) => {
  try {
    const { name, username } = req.body;
    const userId = req.user.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (name) user.name = name.trim();

    if (username) {
      const normalized = username.trim().toLowerCase();

      // Must be 3–30 chars, start and end with letter/number,
      // only letters, numbers, dots, underscores allowed,
      // no consecutive dots or underscores
      if (!/^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/.test(normalized)) {
        return res.status(400).json({
          success: false,
          message: 'Username must be 3–30 characters, start and end with a letter or number, and can only contain letters, numbers, dots and underscores'
        });
      }

      if (/[._]{2,}/.test(normalized)) {
        return res.status(400).json({
          success: false,
          message: 'Username cannot have consecutive dots or underscores'
        });
      }

      const existing = await User.findOne({ username: normalized, _id: { $ne: userId } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Username already taken' });
      }

      user.username = normalized;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: safeUser(user)
    });

  } catch (error) {
    console.error('completeProfile error:', error);
    return serverError(res);
  }
};

// ---------------------------------------------------------------------------
// 5. Login
// ---------------------------------------------------------------------------

exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });

    if (!user || !user.password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: safeUser(user)
    });

  } catch (error) {
    console.error('loginUser error:', error);
    return serverError(res);
  }
};

// ---------------------------------------------------------------------------
// 6. Get Current User
// ---------------------------------------------------------------------------

exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(SENSITIVE_FIELDS);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({ success: true, user: safeUser(user) });

  } catch (error) {
    console.error('getCurrentUser error:', error);
    return serverError(res);
  }
};

// ---------------------------------------------------------------------------
// 7. Forgot Password — Send OTP
// ---------------------------------------------------------------------------

exports.sendForgotPasswordOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const user = await User.findOne({ email });

    if (!user || !user.isEmailVerified) {
      return res.status(200).json({
        success: true,
        message: 'If this email is registered, an OTP has been sent.'
      });
    }

    if (user.lastResetOtpSentAt) {
      const secondsSinceLast =
        (Date.now() - new Date(user.lastResetOtpSentAt).getTime()) / 1000;
      if (secondsSinceLast < OTP_COOLDOWN_SECONDS) {
        const wait = Math.ceil(OTP_COOLDOWN_SECONDS - secondsSinceLast);
        return res.status(429).json({
          success: false,
          message: `Please wait ${wait} seconds before requesting a new OTP`
        });
      }
    }

    const otp       = generateOTP();
    const expiry    = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    const hashedOtp = await bcrypt.hash(otp, BCRYPT_ROUNDS);

    user.resetOtp             = hashedOtp;
    user.resetOtpExpiry       = expiry;
    user.resetOtpAttempts     = 0;
    user.resetOtpLockedUntil  = null;
    user.canResetPassword     = false;
    user.lastResetOtpSentAt   = new Date();
    await user.save();

    const emailResult = await sendOTPEmail(email, otp);
    if (!emailResult.success) {
      return res.status(500).json({ success: false, message: 'Failed to send OTP email' });
    }

    return res.status(200).json({
      success: true,
      message: 'If this email is registered, an OTP has been sent.'
    });

  } catch (error) {
    console.error('sendForgotPasswordOTP error:', error);
    return serverError(res);
  }
};

// ---------------------------------------------------------------------------
// 8. Forgot Password — Verify OTP
// ---------------------------------------------------------------------------

exports.verifyForgotPasswordOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.resetOtpLockedUntil && new Date() < user.resetOtpLockedUntil) {
      const mins = Math.ceil((user.resetOtpLockedUntil - Date.now()) / 60000);
      return res.status(429).json({
        success: false,
        message: `Too many failed attempts. Try again in ${mins} minutes.`
      });
    }

    if (!user.resetOtpExpiry || new Date() > user.resetOtpExpiry) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }

    const isValid = user.resetOtp ? await bcrypt.compare(otp, user.resetOtp) : false;

    if (!isValid) {
      user.resetOtpAttempts = (user.resetOtpAttempts || 0) + 1;
      if (user.resetOtpAttempts >= OTP_MAX_ATTEMPTS) {
        user.resetOtpLockedUntil = new Date(Date.now() + OTP_LOCK_MINUTES * 60 * 1000);
        await user.save();
        return res.status(429).json({
          success: false,
          message: `Too many failed attempts. Account locked for ${OTP_LOCK_MINUTES} minutes.`
        });
      }
      await user.save();
      const remaining = OTP_MAX_ATTEMPTS - user.resetOtpAttempts;
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
      });
    }

    user.resetOtp            = null;
    user.resetOtpExpiry      = null;
    user.resetOtpAttempts    = 0;
    user.resetOtpLockedUntil = null;
    user.canResetPassword    = true;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'OTP verified. You can now reset your password.'
    });

  } catch (error) {
    console.error('verifyForgotPasswordOTP error:', error);
    return serverError(res);
  }
};

// ---------------------------------------------------------------------------
// 9. Reset Password
// ---------------------------------------------------------------------------

exports.resetPassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ success: false, message: 'Email and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.canResetPassword) {
      return res.status(400).json({ success: false, message: 'Please verify OTP first' });
    }

    user.password         = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    user.canResetPassword = false;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully. Please login.'
    });

  } catch (error) {
    console.error('resetPassword error:', error);
    return serverError(res);
  }
};

exports.googleSignIn = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ success: false, message: 'Google ID token is required' });
    }

    // Verify the Google ID token
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (verifyError) {
      console.error('Google token verification failed:', verifyError);
      return res.status(401).json({ success: false, message: 'Invalid Google token' });
    }

    const { email, name, picture, sub: googleId } = payload;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email not provided by Google' });
    }

    let user = await User.findOne({ email });

    if (user) {
      // Existing user — just log them in
      // If user registered via email/password, allow Google login too
    } else {
      // New user — auto-register with Google info
      user = await User.create({
        email,
        name: name || '',
        profileImage: picture || '',
        isEmailVerified: true, // Google has already verified the email
        role: 'user',
      });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // isNewUser = no username set yet → frontend will show profile completion
    const isNewUser = !user.username;

    return res.status(200).json({
      success: true,
      message: 'Google sign-in successful',
      token,
      user: safeUser(user),
      isNewUser,
    });

  } catch (error) {
    console.error('googleSignIn error:', error);
    return serverError(res);
  }
};