const Program = require('../models/program_model');
const Subscription = require('../models/subscription_model');
const User = require('../models/user_model');

// Get all programs
const getAllPrograms = async (req, res) => {
  try {
    const page=parseInt(req.query.page)||1;
    const limit=parseInt(req.query.limit)||10;
    const skip=(page-1)*limit;


    const filter={};
    if(req.query.programType){
      filter.programType=req.query.programType;
    }
    if(req.query.difficulty){
      filter.difficulty=req.query.difficulty;
    }
    if(req.query.trainer){
      filter.trainer=req.query.trainer;
    }

    if(req.query.minPrice||req.query.maxPrice){
      filter.price={};
      if(req.query.minPrice){
        filter.price.$gte=parseInt(req.query.minPrice);
      }
      if(req.query.maxPrice){
        filter.price.$lte=parseInt(req.query.maxPrice);
      }
    }

    if(req.query.search){
      filter.$or=[
        {name: {$regex: req.query.search, $options: 'i'}},
        {description:{$regex: req.query.search, $options: 'i'}}
      ];
    }


    let sort={};
    if(req.query.sortBy){
      const order=req.query.order==='desc'?-1:1;
      sort[req.query.sortBy]=order;
    }else {
      sort.createdAt = -1;
    }


    const programs = await Program.find(filter)
      .populate('trainer', 'name email profileImage')
      .sort(sort)
      .skip(skip)
      .limit(limit);

    const totalProgram=await Program.countDocuments(filter);
    const totalPages=Math.ceil(totalProgram/limit);

    
    res.json({
      success: true,
      data:programs,
      pagination: {
        currentPage: page,
        totalPages,
        totalProgram,
        limit
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get program by ID
const getProgramById = async (req, res) => {
  try {
    const { programId } = req.params;
    const program = await Program.findById(programId)
      .populate('trainer', 'name email profileImage');

    if (!program) {
      return res.status(404).json({ success: false, message: 'Program not found' });
    }

    res.status(200).json({ success: true, data: program });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create program (Trainer only)
const createProgram = async (req, res) => {
  console.log('Program API hit');
  try {
    const {
      name,
      description,
      schedule,
      programType,
      price,
      capacity,
      location,
      difficulty
    } = req.body;

    const trainerId = req.user.userId;

    // Check if user is trainer
    const user = await User.findById(trainerId);
    if (user.role !== 'trainer') {
      return res.status(403).json({ success: false, message: 'Only trainers can create programs' });
    }

    const program = new Program({
      name,
      description,
      trainer: trainerId,
      schedule,
      programType,
      price,
      capacity,
      location,
      difficulty
    });

    await program.save();
    await program.populate('trainer', 'name email profileImage');

    res.status(201).json({
      success: true,
      message: 'Program created successfully',
      data: program
    });

  } catch (error) {
    console.error('Create program error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update program
const updateProgram = async (req, res) => {
  try {
    const { programId } = req.params;
    const updates = req.body;
    const trainerId = req.user.userId;

    const program = await Program.findById(programId);
    if (!program) {
      return res.status(404).json({ success: false, message: 'Program not found' });
    }

    // Check if user is the trainer
    if (program.trainer.toString() !== trainerId.toString() && req.user.role !== 'trainer') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    Object.assign(program, updates);
    await program.save();

    res.status(200).json({
      success: true,
      message: 'Program updated successfully',
      data: program
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete program
const deleteProgram = async (req, res) => {
  try {
    const { programId } = req.params;
    const trainerId = req.user.userId;

    const program = await Program.findById(programId);
    if (!program) {
      return res.status(404).json({ success: false, message: 'Program not found' });
    }

    // Check authorization
    if (program.trainer.toString() !== trainerId.toString() && req.user.role !== 'trainer') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // Check if there are active subscriptions
    const activeSubscriptions = await Subscription.countDocuments({
      program: programId,
      status: 'active'
    });

    if (activeSubscriptions > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete program with ${activeSubscriptions} active subscriptions`
      });
    }

    await Program.findByIdAndDelete(programId);

    res.status(200).json({
      success: true,
      message: 'Program deleted successfully'
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get programs by trainer
const getProgramsByTrainer = async (req, res) => {
  try {
    const { trainerId } = req.params;

    const programs = await Program.find({ trainer: trainerId, status: 'active' })
      .populate('trainer', 'name email profileImage')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: programs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get active subscribers of a program
const getProgramSubscribers = async (req, res) => {
  try {
    const { programId } = req.params;
    const trainerId = req.user.userId;

    const program = await Program.findById(programId);
    if (!program) {
      return res.status(404).json({ success: false, message: 'Program not found' });
    }

    // Check if user is the trainer
    if (program.trainer.toString() !== trainerId.toString() && req.user.role !== 'trainer') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const subscribers = await Subscription.find({
      program: programId,
      status: 'active',
      expiryDate: { $gt: new Date() }
    }).populate('user', 'name email profileImage')
      .select('user startDate expiryDate attendanceCount attendanceHistory');

    res.status(200).json({
      success: true,
      data: {
        totalSubscribers: subscribers.length,
        subscribers
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAllPrograms,
  getProgramById,
  createProgram,
  updateProgram,
  deleteProgram,
  getProgramsByTrainer,
  getProgramSubscribers
};