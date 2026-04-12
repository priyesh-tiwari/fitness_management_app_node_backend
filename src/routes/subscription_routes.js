const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscription_controller');
const { protect } = require('../middlewares/auth_middleware');

// Subscription routes
router.get('/test', (req, res) => {
  res.send('Subscription routes working!');
});
router.post('/initiate', protect, subscriptionController.initiateSubscription);
router.get('/my-subscriptions', protect, subscriptionController.getMySubscriptions);
router.post('/renew', protect, subscriptionController.renewSubscription);
router.patch('/:subscriptionId/cancel', protect, subscriptionController.cancelSubscription);
router.get('/:subscriptionId/qr', protect, subscriptionController.getSubscriptionQR);

// Payment redirect pages (NO AUTH - public pages)
router.get('/success', (req, res) => {
  const { session_id } = req.query;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Success</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
          text-align: center;
          background: white;
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.2);
          max-width: 400px;
        }
        .success-icon {
          font-size: 64px;
          color: #4CAF50;
          margin-bottom: 20px;
        }
        h1 { color: #333; margin: 0 0 10px 0; }
        p { color: #666; margin: 10px 0; }
        .small { font-size: 12px; color: #999; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success-icon">✓</div>
        <h1>Payment Successful!</h1>
        <p>Your subscription has been activated.</p>
        <p class="small">You can close this page and return to the app</p>
      </div>
      <script>
        setTimeout(() => {
          window.close();
        }, 3000);
      </script>
    </body>
    </html>
  `);
});

router.get('/cancel', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Cancelled</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        }
        .container {
          text-align: center;
          background: white;
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.2);
          max-width: 400px;
        }
        .cancel-icon {
          font-size: 64px;
          color: #f44336;
          margin-bottom: 20px;
        }
        h1 { color: #333; margin: 0 0 10px 0; }
        p { color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="cancel-icon">✕</div>
        <h1>Payment Cancelled</h1>
        <p>You can close this page and try again</p>
      </div>
      <script>
        setTimeout(() => window.close(), 3000);
      </script>
    </body>
    </html>
  `);
});

module.exports = router;