const Subscription = require('../models/subscription_model');
const Program = require('../models/program_model');
const User = require('../models/user_model');
const QRCode = require('qrcode');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Initiate subscription (creates Stripe checkout immediately)
const initiateSubscription = async (req, res) => {
  try {
    const { programId } = req.body;
    const userId = req.user.userId;

    const program = await Program.findById(programId);
    if (!program) {
      return res.status(404).json({ success: false, message: 'Program not found' });
    }

    if (program.capacity.currentActive >= program.capacity.maxParticipants) {
      return res.status(400).json({ success: false, message: 'Program is full' });
    }

    // Check if already subscribed
    const existingSubscription = await Subscription.findOne({
      user: userId,
      program: programId,
      status: 'active',
      expiryDate: { $gt: new Date() }
    });

    if (existingSubscription) {
      return res.status(400).json({ success: false, message: 'Already subscribed to this program' });
    }

    // If free program, create subscription immediately
    if (program.price === 0) {
      const startDate = new Date();
      const expiryDate = new Date(startDate.getTime() + (program.duration || 30) * 24 * 60 * 60 * 1000);

      const subscription = new Subscription({
        user: userId,
        program: programId,
        startDate,
        expiryDate,
        paymentStatus: 'completed',
        paymentDetails: { 
          amount: 0,
          paymentMethod: 'free',
          paidAt: new Date()
        }
      });

      await subscription.save();

      program.capacity.currentActive += 1;
      await program.save();

      await subscription.populate([
        { path: 'user', select: 'name email' },
        { path: 'program', select: 'name trainer schedule price' }
      ]);

      const qrCodeImage = await QRCode.toDataURL(subscription.qrCodeData);

      return res.status(201).json({
        success: true,
        message: 'Free subscription created successfully',
        data: { subscription, qrCodeImage }
      });
    }

    // For paid programs, create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'inr',
            product_data: {
              name: program.name,
              description: program.description || 'Fitness program subscription',
            },
            unit_amount: program.price * 100,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/api/bookings/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/api/bookings/cancel`,
      client_reference_id: userId.toString(),
      metadata: {
        userId: userId.toString(),
        programId: programId.toString(),
        programName: program.name,
        purpose: 'program_subscription'
      }
    });

    console.log('Created session with URLs:');
    console.log('Success URL:', session.success_url);
    console.log('Cancel URL:', session.cancel_url);
    console.log('Checkout URL:', session.url);

    res.status(200).json({
      success: true,
      message: 'Checkout session created',
      data: {
        sessionId: session.id,
        url: session.url,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
      }
    });

  } catch (error) {
    console.error('Initiate subscription error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get user's subscriptions
const getMySubscriptions = async (req, res) => {
  try {
    const userId = req.user.userId;

    // 📌 1. Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // 📌 2. Subscription-level Filters
    const subscriptionFilter = { user: userId };

    if (req.query.status) {
      subscriptionFilter.status = req.query.status; // active / expired / cancelled
    }

    if (req.query.paymentStatus) {
      subscriptionFilter.paymentStatus = req.query.paymentStatus; // completed / pending
    }

    // Filter by start/end date
    if (req.query.startDate || req.query.endDate) {
      subscriptionFilter.startDate = {};
      if (req.query.startDate) subscriptionFilter.startDate.$gte = new Date(req.query.startDate);
      if (req.query.endDate) subscriptionFilter.startDate.$lte = new Date(req.query.endDate);
    }

    // 📌 3. Program-level Filters (inside populate)
    const programFilter = {};

    if (req.query.programType) {
      programFilter.programType = req.query.programType;
    }

    if (req.query.difficulty) {
      programFilter.difficulty = req.query.difficulty;
    }

    // Search program name/description
    if (req.query.search) {
      programFilter.$or = [
        { name: { $regex: req.query.search, $options: "i" } },
        { description: { $regex: req.query.search, $options: "i" } }
      ];
    }

    // Price range filtering
    if (req.query.minPrice || req.query.maxPrice) {
      programFilter.price = {};
      if (req.query.minPrice) programFilter.price.$gte = parseInt(req.query.minPrice);
      if (req.query.maxPrice) programFilter.price.$lte = parseInt(req.query.maxPrice);
    }

    // 📌 4. Sorting
    let sort = {};
    if (req.query.sortBy) {
      const order = req.query.order === "desc" ? -1 : 1;
      sort[req.query.sortBy] = order;
    } else {
      sort.createdAt = -1; // Default: newest subscription first
    }

    // 📌 5. Fetch Subscriptions
    const subscriptions = await Subscription.find(subscriptionFilter)
      .populate({
        path: "program",
        match: programFilter,
        select: "name description programType difficulty price trainer"
      })
      .sort(sort)
      .skip(skip)
      .limit(limit);

    // Remove subscriptions where program didn't match populate filter
    const finalSubscriptions = subscriptions.filter(s => s.program !== null);

    // 📌 6. Count (filtered)
    const totalSubscriptions = await Subscription.countDocuments(subscriptionFilter);
    const totalPages = Math.ceil(totalSubscriptions / limit);

    // 📌 7. Response
    res.status(200).json({
      success: true,
      data: finalSubscriptions,
      pagination: {
        currentPage: page,
        totalPages,
        totalSubscriptions,
        limit
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// Renew subscription (extend expiry date)
const renewSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    const userId = req.user.userId;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId
    }).populate('program');

    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Subscription not found' });
    }

    const program = subscription.program;

    // If free program, extend immediately
    if (program.price === 0) {
      const currentExpiry = subscription.expiryDate;
      const newExpiry = new Date(currentExpiry.getTime() + (program.duration || 30) * 24 * 60 * 60 * 1000);
      
      subscription.expiryDate = newExpiry;
      subscription.status = 'active';
      await subscription.save();

      return res.status(200).json({
        success: true,
        message: 'Subscription renewed successfully',
        data: { subscription }
      });
    }

    // For paid programs, create Stripe checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'inr',
            product_data: {
              name: `${program.name} - Renewal`,
              description: 'Subscription renewal',
            },
            unit_amount: program.price * 100,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/api/bookings/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/api/bookings/cancel`,
      client_reference_id: userId.toString(),
      metadata: {
        userId: userId.toString(),
        programId: program._id.toString(),
        subscriptionId: subscriptionId.toString(),
        purpose: 'subscription_renewal'
      }
    });

    res.status(200).json({
      success: true,
      message: 'Renewal checkout created',
      data: {
        sessionId: session.id,
        url: session.url,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Cancel subscription
const cancelSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const { cancellationReason } = req.body;
    const userId = req.user.userId;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId
    }).populate('program');

    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Subscription not found' });
    }

    subscription.status = 'cancelled';
    subscription.cancelledAt = new Date();
    subscription.cancellationReason = cancellationReason;
    subscription.qrCode = null;
    await subscription.save();

    const program = subscription.program;
    program.capacity.currentActive = Math.max(0, program.capacity.currentActive - 1);
    await program.save();

    res.status(200).json({ success: true, message: 'Subscription cancelled successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get QR code for active subscription
const getSubscriptionQR = async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const userId = req.user.userId;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    if (subscription.paymentStatus !== 'completed') {
      return res.status(403).json({
        success: false,
        message: 'Payment not completed'
      });
    }

    if (subscription.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Subscription is not active'
      });
    }

    const qrCodeImage = await QRCode.toDataURL(subscription.qrCodeData);

    res.status(200).json({
      success: true,
      data: { qrCodeImage }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

module.exports = {
  initiateSubscription,
  getMySubscriptions,
  renewSubscription,
  cancelSubscription,
  getSubscriptionQR
};