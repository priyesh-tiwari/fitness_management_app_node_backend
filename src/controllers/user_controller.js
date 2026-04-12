// src/controllers/profile_controller.js

'use strict';

const User = require('../models/user_model');

// Fields never returned to the client
const SENSITIVE_FIELDS =
  '-password -otp -otpExpiry -otpAttempts -otpLockedUntil -lastOtpSentAt ' +
  '-resetOtp -resetOtpExpiry -resetOtpAttempts -resetOtpLockedUntil ' +
  '-lastResetOtpSentAt -canResetPassword';

// ---------------------------------------------------------------------------
// GET /profile
// --------------------------------------------------------------------------- 

exports.getProfile = async (req, res) => {
  try {
    // FIX #16: Exclude ALL sensitive fields, not just password
    const user = await User.findById(req.user.userId).select(SENSITIVE_FIELDS);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile fetched successfully',
      user
    });

  } catch (error) {
    console.error('getProfile error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------
// POST /profile/image
// ---------------------------------------------------------------------------

exports.uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // NOTE: This stores a local file path which works for single-server setups.
    // For production scale (multiple servers / cloud deployment), migrate to
    // S3, Cloudinary, or Firebase Storage and store the CDN URL instead.
    const imageUrl = `/${req.file.path.replace(/\\/g, '/')}`;
    user.profileImage = imageUrl;
    await user.save();

    // FIX #16: Exclude sensitive fields from response
    const updatedUser = await User.findById(user._id).select(SENSITIVE_FIELDS);

    return res.status(200).json({
      success: true,
      message: 'Profile image uploaded successfully',
      imageUrl,
      user: updatedUser
    });

  } catch (error) {
    console.error('uploadProfileImage error:', error);

    if (error.message?.includes('Invalid file type')) {
      return res.status(400).json({ success: false, message: error.message });
    }

    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};