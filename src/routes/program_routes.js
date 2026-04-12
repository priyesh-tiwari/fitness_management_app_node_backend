const express = require('express');
const router = express.Router();
const programController = require('../controllers/program_controller');
const { protect, checkTrainerRole } = require('../middlewares/auth_middleware');

// Public routes - Browse programs
router.get('/', programController.getAllPrograms);

// Get programs by trainer (must come before programId route!)
router.get('/trainer/:trainerId', programController.getProgramsByTrainer);

// Trainer routes - Manage programs
router.post('/create', protect, checkTrainerRole, programController.createProgram);
router.patch('/:programId/update', protect, checkTrainerRole, programController.updateProgram);
router.delete('/:programId/delete', protect, checkTrainerRole, programController.deleteProgram);

// Get program by ID
router.get('/:programId', programController.getProgramById);

// Get active subscribers of a program (for trainer)
router.get('/:programId/subscribers', protect, checkTrainerRole, programController.getProgramSubscribers);

module.exports = router;
