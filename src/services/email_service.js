const nodemailer=require('nodemailer');

const transporter=nodemailer.createTransport({
    service:'gmail',
    auth:{
        user:process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    logger: true,   // 👈 enables logs
    debug: true,    // 👈 enables SMTP debug
});

transporter.verify((error, success) => {
  if (error) {
    console.error('❌ SMTP VERIFY FAILED:', error);
  } else {
    console.log('✅ SMTP SERVER READY');
  }
});


// exports.sendOTPEmail=async(email,otp)=>{
//     const mailOptions={
//         from:process.env.EMAIL_USER,
//         to:email,
//         subject:'Your OTP for Fitness App Registration',
//         html: `
//         <div style="font-family: Arial, sans-serif; padding: 20px;">
//             <h2>Email Verification</h2>
//             <p>Your OTP code is:</p>
//             <h1 style="color: #4A90E2; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
//             <p>This code will expire in 5 minutes.</p>
//             <p>If you didn't request this, please ignore this email.</p>
//         </div>`
//     };

//     try{
//         await transporter.sendMail(mailOptions);
//         return  {success: true};
//     }catch(error){
//         console.error('Email send error:',error);
//         return {success:false, error: error.message};
//      };
// };

exports.sendOTPEmail = async (email, otp) => {
  const mailOptions = {
    from: `"Fitness App" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Fitness App OTP - ${new Date().toLocaleTimeString()}`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Email Verification</h2>
        <p>Your OTP code is:</p>
        <h1 style="color: #4A90E2; font-size: 32px;">${otp}</h1>
        <p>This code will expire in 5 minutes.</p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ EMAIL SENT:', info.messageId);
    return { success: true };
  } catch (error) {
    console.error('❌ EMAIL SEND FAILED:', error);
    return { success: false, error: error.message };
  }
};
