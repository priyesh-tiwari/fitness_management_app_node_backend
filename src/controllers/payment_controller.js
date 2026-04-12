const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Subscription = require('../models/subscription_model');
const Program = require('../models/program_model');
const QRCode = require('qrcode');

// Verify payment and get subscription details
exports.verifyPayment = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user.userId;
    
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment not completed' 
      });
    }

    const { programId, purpose, subscriptionId } = session.metadata;

    let subscription;

    // Handle new subscription
    if (purpose === 'program_subscription') {
      // Check if subscription already created by webhook
      subscription = await Subscription.findOne({
        user: userId,
        program: programId,
        'paymentDetails.transactionId': session.payment_intent
      }).populate('program');

      // If webhook didn't create it, create it now
      if (!subscription) {
        console.log('Webhook did not create subscription, creating manually...');
        
        const program = await Program.findById(programId);
        if (!program) {
          return res.status(404).json({ success: false, message: 'Program not found' });
        }

        const startDate = new Date();
        const expiryDate = new Date(startDate.getTime() + (program.duration || 30) * 24 * 60 * 60 * 1000);

        subscription = new Subscription({
          user: userId,
          program: programId,
          startDate,
          expiryDate,
          status: 'active',
          paymentStatus: 'completed',
          paymentDetails: {
            transactionId: session.payment_intent,
            amount: session.amount_total / 100,
            paymentMethod: 'stripe',
            paidAt: new Date()
          }
        });

        await subscription.save();

        // Increase capacity
        program.capacity.currentActive += 1;
        await program.save();

        await subscription.populate('program');
      }
    } 
    // Handle renewal
    else if (purpose === 'subscription_renewal') {
      subscription = await Subscription.findById(subscriptionId).populate('program');
      
      if (!subscription) {
        return res.status(404).json({ success: false, message: 'Subscription not found' });
      }

      // Check if already renewed
      if (subscription.paymentDetails.transactionId !== session.payment_intent) {
        const program = subscription.program;
        const currentExpiry = subscription.expiryDate;
        const newExpiry = new Date(currentExpiry.getTime() + (program.duration || 30) * 24 * 60 * 60 * 1000);
        
        subscription.expiryDate = newExpiry;
        subscription.status = 'active';
        subscription.paymentDetails = {
          transactionId: session.payment_intent,
          amount: session.amount_total / 100,
          paymentMethod: 'stripe',
          paidAt: new Date()
        };
        
        await subscription.save();
      }
    }

    if (!subscription) {
      return res.status(404).json({ 
        success: false, 
        message: 'Subscription not found' 
      });
    }

    // Generate QR code
    const qrCodeImage = await QRCode.toDataURL(subscription.qrCodeData);

    res.status(200).json({ 
      success: true, 
      message: 'Payment verified successfully', 
      data: { 
        subscription,
        qrCodeImage
      }
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Payment verification failed', 
      error: error.message 
    });
  }
};

// Stripe webhook - THIS CREATES THE SUBSCRIPTION
exports.stripeWebhook = async (req, res) => {
  console.log('🔔 Webhook received');
  
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try { 
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret); 
    console.log('✅ Webhook verified, event type:', event.type);
  } catch (err) { 
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`); 
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        console.log('💰 Payment completed:', session.id);
        console.log('Metadata:', session.metadata);
        
        if (session.payment_status === 'paid') {
          const { userId, programId, purpose, subscriptionId } = session.metadata;
          console.log('Creating subscription for user:', userId, 'program:', programId);

          if (purpose === 'program_subscription') {
            const program = await Program.findById(programId);
            if (!program) {
              console.error('❌ Program not found:', programId);
              break;
            }

            const startDate = new Date();
            const expiryDate = new Date(startDate.getTime() + (program.duration || 30) * 24 * 60 * 60 * 1000);

            const subscription = new Subscription({
              user: userId,
              program: programId,
              startDate,
              expiryDate,
              status: 'active',
              paymentStatus: 'completed',
              paymentDetails: {
                transactionId: session.payment_intent,
                amount: session.amount_total / 100,
                paymentMethod: 'stripe',
                paidAt: new Date()
              }
            });

            await subscription.save();

            program.capacity.currentActive += 1;
            await program.save();

            console.log('✅ Subscription created successfully:', subscription._id);

          } else if (purpose === 'subscription_renewal') {
            const subscription = await Subscription.findById(subscriptionId).populate('program');
            if (subscription) {
              const currentExpiry = subscription.expiryDate;
              const program = subscription.program;
              const newExpiry = new Date(currentExpiry.getTime() + (program.duration || 30) * 24 * 60 * 60 * 1000);
              
              subscription.expiryDate = newExpiry;
              subscription.status = 'active';
              subscription.paymentDetails = {
                transactionId: session.payment_intent,
                amount: session.amount_total / 100,
                paymentMethod: 'stripe',
                paidAt: new Date()
              };
              
              await subscription.save();
              console.log('✅ Subscription renewed:', subscription._id);
            }
          }
        }
        break;

      case 'payment_intent.payment_failed':
        console.log('❌ Payment failed:', event.data.object.id);
        break;

      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

// Get payment history
exports.getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const subscriptions = await Subscription.find({ 
      user: userId, 
      paymentStatus: 'completed' 
    })
      .select('paymentDetails program createdAt expiryDate')
      .populate('program', 'name programType price')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: subscriptions });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve payment history', 
      error: error.message 
    });
  }
};