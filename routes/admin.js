const express = require('express');
const { query, run, get, getSetting, setSetting } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

function isAdmin(req, res, next) {
  if (req.user.email !== 'admin@demo.com') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

router.get('/stats', auth, isAdmin, (req, res) => {
  try {
    const users = query('SELECT COUNT(*) as c FROM users');
    const tasks = query('SELECT COUNT(*) as c FROM tasks');
    const openTasks = query("SELECT COUNT(*) as c FROM tasks WHERE status='open'");
    const submissions = query('SELECT COUNT(*) as c FROM submissions');
    const approved = query("SELECT COUNT(*) as c FROM submissions WHERE status='approved'");
    const pending = query("SELECT COUNT(*) as c FROM submissions WHERE status='pending'");
    const withdrawals = query('SELECT COUNT(*) as c FROM withdrawals');
    const pendingWithdrawals = query("SELECT COUNT(*) as c FROM withdrawals WHERE status='pending'");
    const totalPayouts = query('SELECT COALESCE(SUM(t.payout),0) as total FROM submissions s JOIN tasks t ON s.task_id=t.id WHERE s.status=?', ['approved']);
    res.json({
      users: users[0].c,
      tasks: tasks[0].c,
      openTasks: openTasks[0].c,
      submissions: submissions[0].c,
      approvedSubmissions: approved[0].c,
      pendingSubmissions: pending[0].c,
      withdrawals: withdrawals[0].c,
      pendingWithdrawals: pendingWithdrawals[0].c,
      totalPayouts: totalPayouts[0].total
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users', auth, isAdmin, (req, res) => {
  try {
    let sql = 'SELECT id, name, email, created_at FROM users WHERE 1=1';
    const params = [];
    if (req.query.search) {
      sql += ' AND (name LIKE ? OR email LIKE ?)';
      const s = '%' + req.query.search + '%';
      params.push(s, s);
    }
    sql += ' ORDER BY created_at DESC';
    const users = query(sql, params);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/users/:email', auth, isAdmin, (req, res) => {
  try {
    if (req.params.email === 'admin@demo.com') {
      return res.status(400).json({ error: 'Cannot delete admin account' });
    }
    run('DELETE FROM submissions WHERE user_email = ?', [req.params.email]);
    run('DELETE FROM withdrawals WHERE user_email = ?', [req.params.email]);
    run('DELETE FROM adjustments WHERE user_email = ?', [req.params.email]);
    run('UPDATE tasks SET posted_by = ? WHERE posted_by = ?', ['admin@demo.com', req.params.email]);
    run('DELETE FROM users WHERE email = ?', [req.params.email]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users/:email', auth, isAdmin, (req, res) => {
  try {
    const user = get('SELECT id, name, email, created_at FROM users WHERE email = ?', [req.params.email]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const subs = query('SELECT s.*, t.title, t.payout FROM submissions s JOIN tasks t ON s.task_id = t.id WHERE s.user_email = ? ORDER BY s.submitted_at DESC', [req.params.email]);
    const tasksPosted = query('SELECT * FROM tasks WHERE posted_by = ? ORDER BY created_at DESC', [req.params.email]);
    const withdrawals = query('SELECT * FROM withdrawals WHERE user_email = ? ORDER BY created_at DESC', [req.params.email]);
    const adjustments = query('SELECT * FROM adjustments WHERE user_email = ? ORDER BY created_at DESC', [req.params.email]);

    let earned = 0;
    subs.filter(s => s.status === 'approved').forEach(s => earned += s.payout);
    const adjTotal = adjustments.reduce((sum, a) => sum + a.amount, 0);
    const wdTotal = withdrawals.filter(w => w.status === 'approved').reduce((sum, w) => sum + w.amount, 0);
    const pendingTotal = withdrawals.filter(w => w.status === 'pending').reduce((sum, w) => sum + w.amount, 0);

    res.json({
      user: { ...user, earned, adjustments: adjTotal, withdrawn: wdTotal, pendingWithdrawals: pendingTotal, available: earned + adjTotal - wdTotal - pendingTotal },
      submissions: subs,
      tasksPosted,
      withdrawals,
      adjustments
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/tasks', auth, isAdmin, (req, res) => {
  try {
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];
    if (req.query.search) {
      sql += ' AND (title LIKE ? OR description LIKE ? OR posted_by LIKE ?)';
      const s = '%' + req.query.search + '%';
      params.push(s, s, s);
    }
    sql += ' ORDER BY created_at DESC';
    const tasks = query(sql, params);
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/tasks/:id', auth, isAdmin, (req, res) => {
  try {
    run('DELETE FROM submissions WHERE task_id = ?', [req.params.id]);
    run('DELETE FROM tasks WHERE id = ?', [req.params.id]);
    res.json({ message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/tasks/:id/status', auth, isAdmin, (req, res) => {
  try {
    const { status } = req.body;
    if (!['open', 'closed', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Status must be open, closed, or cancelled' });
    const task = get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    run('UPDATE tasks SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ message: 'Task status updated', status });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/submissions', auth, isAdmin, (req, res) => {
  try {
    let sql = `
      SELECT s.*, t.title, t.payout, t.posted_by
      FROM submissions s JOIN tasks t ON s.task_id = t.id
      WHERE 1=1`;
    const params = [];
    if (req.query.search) {
      sql += ' AND (s.user_email LIKE ? OR t.title LIKE ?)';
      const s = '%' + req.query.search + '%';
      params.push(s, s);
    }
    if (req.query.task_id) {
      sql += ' AND s.task_id = ?';
      params.push(req.query.task_id);
    }
    sql += ' ORDER BY s.submitted_at DESC';
    const subs = query(sql, params);
    res.json({ submissions: subs });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/withdrawals', auth, isAdmin, (req, res) => {
  try {
    let sql = 'SELECT * FROM withdrawals WHERE 1=1';
    const params = [];
    if (req.query.search) {
      sql += ' AND (user_email LIKE ? OR method LIKE ? OR account LIKE ?)';
      const s = '%' + req.query.search + '%';
      params.push(s, s, s);
    }
    sql += ' ORDER BY created_at DESC';
    const withdrawals = query(sql, params);
    res.json({ withdrawals });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/withdrawals/:id', auth, isAdmin, (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be approved or rejected' });
    }
    const w = get('SELECT * FROM withdrawals WHERE id = ?', [req.params.id]);
    if (!w) return res.status(404).json({ error: 'Withdrawal not found' });
    run('UPDATE withdrawals SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ message: `Withdrawal ${status}` });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/submissions/:id/review', auth, isAdmin, (req, res) => {
  try {
    const { action } = req.body;
    if (!['approved', 'rejected'].includes(action)) return res.status(400).json({ error: 'Action must be approved or rejected' });
    const sub = get('SELECT * FROM submissions WHERE id = ?', [req.params.id]);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });
    if (sub.status !== 'pending') return res.status(400).json({ error: 'Submission is not pending' });
    run('UPDATE submissions SET status = ?, reviewed_at = ? WHERE id = ?', [action, Date.now(), req.params.id]);
    res.json({ message: `Submission ${action}` });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/users/:email/balance', auth, isAdmin, (req, res) => {
  try {
    const { amount, reason } = req.body;
    if (amount === undefined || isNaN(amount)) return res.status(400).json({ error: 'Valid amount required' });
    const user = get('SELECT * FROM users WHERE email = ?', [req.params.email]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (req.params.email === 'admin@demo.com') return res.status(400).json({ error: 'Cannot adjust admin balance' });
    const adjustmentId = require('uuid').v4();
    run('INSERT INTO adjustments (id, user_email, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)',
      [adjustmentId, req.params.email, parseFloat(amount), reason || 'Admin adjustment', Date.now()]);
    res.json({ message: 'Balance adjusted', amount: parseFloat(amount) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users/:email/balance', auth, isAdmin, (req, res) => {
  try {
    const subs = query('SELECT s.*, t.payout FROM submissions s JOIN tasks t ON s.task_id = t.id WHERE s.user_email = ? AND s.status = ?', [req.params.email, 'approved']);
    let earned = 0;
    subs.forEach(s => earned += s.payout);
    const adjustments = query('SELECT SUM(amount) as total FROM adjustments WHERE user_email = ?', [req.params.email]);
    const adjTotal = adjustments.length && adjustments[0].total ? adjustments[0].total : 0;
    const withdrawals = query('SELECT SUM(amount) as total FROM withdrawals WHERE user_email = ? AND status = ?', [req.params.email, 'approved']);
    const wdTotal = withdrawals.length && withdrawals[0].total ? withdrawals[0].total : 0;
    const pendingWd = query('SELECT SUM(amount) as total FROM withdrawals WHERE user_email = ? AND status = ?', [req.params.email, 'pending']);
    const pendingTotal = pendingWd.length && pendingWd[0].total ? pendingWd[0].total : 0;
    res.json({ earned, adjustments: adjTotal, withdrawn: wdTotal, pendingWithdrawals: pendingTotal, available: earned + adjTotal - wdTotal - pendingTotal });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/tasks/:id', auth, isAdmin, (req, res) => {
  try {
    const { title, description, category, payout, workers, deadline, instructions, status } = req.body;
    const task = get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const updates = [];
    const params = [];
    if (title !== undefined) { updates.push('title=?'); params.push(title); }
    if (description !== undefined) { updates.push('description=?'); params.push(description); }
    if (category !== undefined) { updates.push('category=?'); params.push(category); }
    if (payout !== undefined) { updates.push('payout=?'); params.push(payout); }
    if (workers !== undefined) { updates.push('workers=?'); params.push(workers); }
    if (deadline !== undefined) { updates.push('deadline=?'); params.push(deadline); }
    if (instructions !== undefined) { updates.push('instructions=?'); params.push(instructions); }
    if (status !== undefined) { updates.push('status=?'); params.push(status); }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    run('UPDATE tasks SET ' + updates.join(',') + ' WHERE id=?', params);
    res.json({ message: 'Task updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/settings/withdrawal-fee', auth, isAdmin, (req, res) => {
  try {
    const fee = parseFloat(getSetting('withdrawal_fee', 5));
    res.json({ fee });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/settings/withdrawal-fee', auth, isAdmin, (req, res) => {
  try {
    let { value } = req.body;
    if (value === undefined || value === null) return res.status(400).json({ error: 'Fee value is required' });
    value = parseFloat(value);
    if (isNaN(value) || value < 0 || value > 100) return res.status(400).json({ error: 'Fee must be between 0 and 100' });
    setSetting('withdrawal_fee', value);
    res.json({ message: 'Fee updated', fee: value });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/settings/min-withdrawal', auth, isAdmin, (req, res) => {
  try {
    const min = parseFloat(getSetting('min_withdrawal', 5));
    res.json({ min });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/settings/min-withdrawal', auth, isAdmin, (req, res) => {
  try {
    let { value } = req.body;
    if (value === undefined || value === null) return res.status(400).json({ error: 'Value is required' });
    value = parseFloat(value);
    if (isNaN(value) || value < 0) return res.status(400).json({ error: 'Min withdrawal must be 0 or more' });
    setSetting('min_withdrawal', value);
    res.json({ message: 'Min withdrawal updated', min: value });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/categories', auth, isAdmin, (req, res) => {
  try {
    const cats = query('SELECT * FROM categories ORDER BY name ASC');
    res.json({ categories: cats });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/categories', auth, isAdmin, (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Category name is required' });
    const existing = get('SELECT * FROM categories WHERE name = ?', [name.trim()]);
    if (existing) return res.status(400).json({ error: 'Category already exists' });
    const id = require('uuid').v4();
    run('INSERT INTO categories (id, name) VALUES (?, ?)', [id, name.trim()]);
    res.json({ message: 'Category added', category: { id, name: name.trim() } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/categories/:id', auth, isAdmin, (req, res) => {
  try {
    run('DELETE FROM categories WHERE id = ?', [req.params.id]);
    res.json({ message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/settings', auth, isAdmin, (req, res) => {
  try {
    const fee = parseFloat(getSetting('withdrawal_fee', 5));
    const minWd = parseFloat(getSetting('min_withdrawal', 5));
    res.json({ withdrawal_fee: fee, min_withdrawal: minWd });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
