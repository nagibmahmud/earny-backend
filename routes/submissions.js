const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query, run, get } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.post('/claim', auth, (req, res) => {
  try {
    const { taskId } = req.body;
    if (!taskId) return res.status(400).json({ error: 'Task ID required' });
    const task = get('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status === 'filled') return res.status(400).json({ error: 'Task is full' });
    if (task.posted_by === req.user.email) return res.status(400).json({ error: 'Cannot claim your own task' });
    if (task.workers_done >= task.workers) return res.status(400).json({ error: 'All spots filled' });
    const existing = get('SELECT id, status FROM submissions WHERE task_id = ? AND user_email = ?', [taskId, req.user.email]);
    if (existing) {
      if (existing.status === 'in_progress') return res.status(400).json({ error: 'You are already working on this job' });
      if (existing.status === 'pending') return res.status(400).json({ error: 'Your submission is pending review' });
      if (existing.status === 'approved') return res.status(400).json({ error: 'You already completed this job' });
      if (existing.status === 'rejected') {
        run('UPDATE submissions SET status = ?, submitted_at = NULL WHERE id = ?', ['in_progress', existing.id]);
        res.status(200).json({ message: 'Re-opened for resubmission' });
        return;
      }
    }
    const id = uuidv4();
    run('INSERT INTO submissions (id, task_id, user_email, status) VALUES (?, ?, ?, ?)', [id, taskId, req.user.email, 'in_progress']);
    run('UPDATE tasks SET workers_done = workers_done + 1 WHERE id = ?', [taskId]);
    const updated = get('SELECT workers_done, workers FROM tasks WHERE id = ?', [taskId]);
    if (updated.workers_done >= updated.workers) {
      run('UPDATE tasks SET status = ? WHERE id = ?', ['filled', taskId]);
    }
    res.status(201).json({ message: 'Claimed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/submit', auth, (req, res) => {
  try {
    const { taskId, proof } = req.body;
    if (!taskId) return res.status(400).json({ error: 'Task ID required' });
    if (!proof || !proof.trim()) return res.status(400).json({ error: 'Proof is required' });
    const sub = get('SELECT * FROM submissions WHERE task_id = ? AND user_email = ? AND status = ?', [taskId, req.user.email, 'in_progress']);
    if (!sub) return res.status(404).json({ error: 'No active submission found' });
    run('UPDATE submissions SET proof = ?, status = ?, submitted_at = ? WHERE id = ?', [proof, 'pending', Date.now(), sub.id]);
    res.json({ message: 'Submitted for review' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/mine', auth, (req, res) => {
  try {
    const subs = query(`
      SELECT s.*, t.title, t.payout, t.category
      FROM submissions s JOIN tasks t ON s.task_id = t.id
      WHERE s.user_email = ?
      ORDER BY s.submitted_at DESC
    `, [req.user.email]);
    res.json({ submissions: subs });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/posted/:taskId', auth, (req, res) => {
  try {
    const task = get('SELECT * FROM tasks WHERE id = ?', [req.params.taskId]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.posted_by !== req.user.email) return res.status(403).json({ error: 'Not your task' });
    const subs = query(`
      SELECT s.*, t.title, t.payout
      FROM submissions s JOIN tasks t ON s.task_id = t.id
      WHERE s.task_id = ?
      ORDER BY s.submitted_at DESC
    `, [req.params.taskId]);
    res.json({ submissions: subs, task });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/review', auth, (req, res) => {
  try {
    const { submissionId, action } = req.body;
    if (!submissionId || !action) return res.status(400).json({ error: 'Submission ID and action required' });
    if (!['approved', 'rejected'].includes(action)) return res.status(400).json({ error: 'Action must be approved or rejected' });
    const sub = get('SELECT s.*, t.posted_by FROM submissions s JOIN tasks t ON s.task_id = t.id WHERE s.id = ?', [submissionId]);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });
    if (sub.posted_by !== req.user.email) return res.status(403).json({ error: 'Not your task' });
    if (sub.status !== 'pending') return res.status(400).json({ error: 'Submission is not pending' });
    run('UPDATE submissions SET status = ?, reviewed_at = ? WHERE id = ?', [action, Date.now(), submissionId]);
    res.json({ message: `Submission ${action}` });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/resubmit', auth, (req, res) => {
  try {
    const { taskId, proof } = req.body;
    if (!taskId || !proof || !proof.trim()) return res.status(400).json({ error: 'Task ID and proof required' });
    const sub = get('SELECT * FROM submissions WHERE task_id = ? AND user_email = ? AND status = ?', [taskId, req.user.email, 'rejected']);
    if (!sub) return res.status(404).json({ error: 'No rejected submission found' });
    run('UPDATE submissions SET proof = ?, status = ?, submitted_at = ? WHERE id = ?', [proof, 'pending', Date.now(), sub.id]);
    res.json({ message: 'Resubmitted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/stats', auth, (req, res) => {
  try {
    const subs = query('SELECT * FROM submissions WHERE user_email = ?', [req.user.email]);
    const tasks = query('SELECT * FROM tasks WHERE posted_by = ?', [req.user.email]);
    let earnings = 0;
    const approved = subs.filter(s => s.status === 'approved');
    approved.forEach(s => {
      const t = query('SELECT payout FROM tasks WHERE id = ?', [s.task_id]);
      if (t.length) earnings += t[0].payout;
    });
    res.json({
      totalClaimed: subs.length,
      inProgress: subs.filter(s => s.status === 'in_progress').length,
      pending: subs.filter(s => s.status === 'pending').length,
      approved: approved.length,
      rejected: subs.filter(s => s.status === 'rejected').length,
      postedCount: tasks.length,
      earnings
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
