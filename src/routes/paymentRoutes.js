const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment_controller.js');
const { protect } = require('../middlewares/auth_middleware');

// Verify payment after checkout
router.post('/verify', protect, paymentController.verifyPayment);

// Payment history
router.get('/history', protect, paymentController.getPaymentHistory);

module.exports = router;