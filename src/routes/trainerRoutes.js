const express = require('express');
const router = express.Router();

const auth = require('../middlewares/auth_middleware.js');
const trainerMiddleware = require('../middlewares/trainer_middleware.js');

// Example Trainer-only route
router.get('/dashboard', auth, trainerMiddleware, (req, res) => {
    res.json({
        message: 'Welcome Trainer Dashboard!',
        user: req.user
    });
});

module.exports = router;
