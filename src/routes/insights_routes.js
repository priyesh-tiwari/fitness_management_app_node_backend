const express = require('express');
const router = express.Router();
const insightsController = require('../controllers/insights_controller');
const { protect } = require('../middlewares/auth_middleware');

/**
 * @route   POST /api/insights/generate
 * @desc    Generate AI-powered insights for logged-in user (on-demand only)
 * @access  Private
 * @note    Only generates when user explicitly clicks "Get Insights"
 */
router.post('/generate', protect, insightsController.generatePersonalInsights);

module.exports = router;