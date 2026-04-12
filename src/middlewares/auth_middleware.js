const jwt = require('jsonwebtoken');
const User = require('../models/user_model');

// Protect middleware: authenticate any logged-in user
const protect = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No authentication token, access denied'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId).select('-password -otp -otpExpiry');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    req.user = { userId: user._id, email: user.email, role: user.role };
    next();
    
  } catch (error) {
    console.error('❌ Auth error:', error);
    res.status(401).json({
      success: false,
      message: 'Token is not valid'
    });
  }
};

// Check trainer role middleware
const checkTrainerRole = (req, res, next) => {
  if(!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }
  if (req.user.role !== 'trainer') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only trainers can perform this action.'
    });
  }
  next();
};

module.exports = { protect, checkTrainerRole };
