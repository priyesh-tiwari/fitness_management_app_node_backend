const express = require('express');
const router = express.Router();

const { uploadProfileImage } = require('../controllers/user_controller');
const { protect } = require('../middlewares/auth_middleware');
const upload = require('../middlewares/upload');

// Upload profile image (protected route)
router.post(
  '/upload-profile-image',
  protect,
  upload.single('image'),
  uploadProfileImage
);

module.exports = router;
