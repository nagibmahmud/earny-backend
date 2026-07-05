const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query, run, get } = require('../db');
const { auth, signToken } = require('../middleware/auth');
const { sendOTPEmail } = require('../email');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    const existing = get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const hash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    run('INSERT INTO users (id, name, email, password, created_at) VALUES (?, ?, ?, ?, ?)', [id, name, email, hash, Date.now()]);
    const token = signToken({ email, name, id });
    res.status(201).json({ token, user: { name, email } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const user = get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = signToken({ email: user.email, name: user.name, id: user.id });
    res.json({ token, user: { name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/send-otp', async (req, res) => {
  try {
    const { email, action } = req.body;
    if (!email || !action) {
      return res.status(400).json({ error: 'Email and action are required' });
    }
    if (action === 'reset') {
      const user = get('SELECT id FROM users WHERE email = ?', [email]);
      if (!user) {
        return res.status(404).json({ error: 'No account found with this email' });
      }
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 300000;
    run('DELETE FROM otps WHERE email = ?', [email]);
    run('INSERT INTO otps (email, code, action, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', [email, code, action, expiresAt, Date.now()]);

    const mailResult = await sendOTPEmail(email, code);
    if (mailResult.status === 'failed') {
      run('DELETE FROM otps WHERE email = ?', [email]);
      return res.status(500).json({ error: 'Failed to send OTP email. Check email configuration.' });
    }
    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/verify-otp', (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }
    const record = get('SELECT * FROM otps WHERE email = ? ORDER BY created_at DESC LIMIT 1', [email]);
    if (!record) {
      return res.status(400).json({ error: 'No OTP found. Request a new one.' });
    }
    if (Date.now() > record.expires_at) {
      run('DELETE FROM otps WHERE email = ?', [email]);
      return res.status(400).json({ error: 'OTP expired. Request a new one.' });
    }
    if (record.code !== code.trim()) {
      return res.status(400).json({ error: 'Invalid OTP code' });
    }
    run('DELETE FROM otps WHERE email = ?', [email]);
    res.json({ message: 'OTP verified', action: record.action });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const user = get('SELECT id FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const hash = await bcrypt.hash(password, 12);
    run('UPDATE users SET password = ? WHERE email = ?', [hash, email]);
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', auth, (req, res) => {
  try {
    const user = get('SELECT name, email FROM users WHERE email = ?', [req.user.email]);
    if (!user) return res.status(401).json({ error: 'User not found. Please login again.' });
    res.json({ user: { name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
