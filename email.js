const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const otpEnvPath = path.join(__dirname, '..', '..', 'otp', '.env');
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  let email = process.env.GMAIL_EMAIL;
  let pass = process.env.GMAIL_APP_PASSWORD;
  if ((!email || !pass) && fs.existsSync(otpEnvPath)) {
    const envContent = fs.readFileSync(otpEnvPath, 'utf-8');
    const lines = envContent.split('\n').filter(Boolean);
    lines.forEach(line => {
      const [k, ...v] = line.split('=');
      const key = k.trim();
      const val = v.join('=').trim().replace(/^['"]|['"]$/g, '');
      if (key === 'GMAIL_EMAIL') email = val;
      if (key === 'GMAIL_APP_PASSWORD') pass = val;
    });
  }
  if (!email || !pass) {
    console.warn('GMAIL_EMAIL or GMAIL_APP_PASSWORD not set. OTP emails will not be sent.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: email, pass }
  });
  return transporter;
}

async function sendOTPEmail(to, code, expiryMinutes = 5) {
  const t = getTransporter();
  if (!t) return { status: 'failed', error: 'Email not configured' };
  try {
    await t.sendMail({
      from: `"OTP Service" <${process.env.GMAIL_EMAIL || 'creator360.n@gmail.com'}>`,
      to,
      subject: 'Your Verification Code',
      text: `Hello,\n\nYour verification code is: ${code}\n\nThis code will expire in ${expiryMinutes} minutes.\n\nIf you did not request this code, please ignore this email.\n\n— OTP Service`
    });
    return { status: 'sent' };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}

module.exports = { sendOTPEmail };