

// Middleware to check if user has required role(s)
const authorize = (...roles) => {
  return (req, res, next) => {
    // Check if user exists (should be set by authenticate middleware)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if user's role is in the allowed roles
    if (!roles.includes(req.user.role.toLowerCase())) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}`
      });
    }

    next();
  };
};

module.exports = authorize;