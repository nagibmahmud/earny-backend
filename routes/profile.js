const express = require('express');
const bcrypt = require('bcryptjs');
const { query, run, get } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.put('/', auth, async (req, res) => {
  try {
    const { name, currentPassword, newPassword } = req.body;
    if (name) {
      run('UPDATE users SET name = ? WHERE email = ?', [name, req.user.email]);
    }
    if (currentPassword && newPassword) {
      if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
      const user = get('SELECT * FROM users WHERE email = ?', [req.user.email]);
      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) return res.status(400).json({ error: 'Current password is incorrect' });
      const hash = await bcrypt.hash(newPassword, 12);
      run('UPDATE users SET password = ? WHERE email = ?', [hash, req.user.email]);
    }
    res.json({ message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
