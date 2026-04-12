const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, uniqueSuffix + extension);
    }
});

const fileFilter = (req, file, cb) => {
    console.log('👉 File:', file.originalname);
    console.log('👉 MIME:', file.mimetype);
    
    // ✅ Accept based on extension only
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedExtensions.includes(ext)) {
        console.log('✅ File accepted:', ext);
        cb(null, true);
    } else {
        console.log('❌ File rejected:', ext);
        cb(new Error(`Invalid file type: ${ext}. Allowed: ${allowedExtensions.join(', ')}`), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024  // 5MB
    }
});

module.exports = upload;