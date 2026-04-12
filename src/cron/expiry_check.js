const cron = require('node-cron');
const Subscription = require('../models/subscription_model');
const Program = require('../models/program_model');

// Run every day at midnight
cron.schedule('0 0 * * *', async () => {
  console.log('Running subscription expiry check...');
  
  try {
    const expiredSubscriptions = await Subscription.find({
      expiryDate: { $lt: new Date() },
      status: 'active'
    }).populate('program');

    for (const sub of expiredSubscriptions) {
      sub.status = 'expired';
      sub.qrCode = null;
      await sub.save();

      // Update program capacity
      const program = sub.program;
      program.capacity.currentActive -= 1;
      await program.save();

      console.log(`Expired subscription: ${sub._id}`);
    }

    console.log(`Expired ${expiredSubscriptions.length} subscriptions`);
  } catch (error) {
    console.error('Cron job error:', error);
  }
});

module.exports = cron;