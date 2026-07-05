const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query, run, get, getSetting } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.post('/', auth, (req, res) => {
  try {
    const { amount, method, account } = req.body;
    if (!amount || !method || !account) {
      return res.status(400).json({ error: 'Amount, method, and account are required' });
    }
    const minWd = parseFloat(getSetting('min_withdrawal', 5));
    if (amount < minWd) return res.status(400).json({ error: `Minimum withdrawal is $${minWd.toFixed(2)}` });
    const subs = query('SELECT s.*, t.payout FROM submissions s JOIN tasks t ON s.task_id = t.id WHERE s.user_email = ? AND s.status = ?', [req.user.email, 'approved']);
    let balance = 0;
    subs.forEach(s => balance += s.payout);
    const withdrawals = query('SELECT SUM(amount) as total FROM withdrawals WHERE user_email = ? AND status = ?', [req.user.email, 'pending']);
    const pendingTotal = withdrawals.length && withdrawals[0].total ? withdrawals[0].total : 0;
    const available = balance - pendingTotal;
    if (amount > available) return res.status(400).json({ error: `Insufficient balance. Available: $${available.toFixed(2)}` });
    const feePct = parseFloat(getSetting('withdrawal_fee', 5));
    const fee = (amount * feePct) / 100;
    const netAmount = amount - fee;
    const id = uuidv4();
    run('INSERT INTO withdrawals (id, user_email, amount, fee, method, account, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, req.user.email, netAmount, fee, method, account, 'pending', Date.now()]);
    res.status(201).json({ message: 'Withdrawal requested', fee, netAmount, feePct });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/history', auth, (req, res) => {
  try {
    const withdrawals = query('SELECT * FROM withdrawals WHERE user_email = ? ORDER BY created_at DESC', [req.user.email]);
    res.json({ withdrawals });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/balance', auth, (req, res) => {
  try {
    const subs = query('SELECT s.*, t.payout FROM submissions s JOIN tasks t ON s.task_id = t.id WHERE s.user_email = ? AND s.status = ?', [req.user.email, 'approved']);
    let balance = 0;
    subs.forEach(s => balance += s.payout);
    const withdrawals = query('SELECT SUM(amount) as total FROM withdrawals WHERE user_email = ? AND status = ?', [req.user.email, 'pending']);
    const pendingTotal = withdrawals.length && withdrawals[0].total ? withdrawals[0].total : 0;
    const feePct = parseFloat(getSetting('withdrawal_fee', 5));
    const minWd = parseFloat(getSetting('min_withdrawal', 5));
    res.json({ balance, pendingWithdrawals: pendingTotal, available: balance - pendingTotal, feePct, minWithdrawal: minWd });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
