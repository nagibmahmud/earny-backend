const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query, run, get } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const { category, search, status, sort } = req.query;
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];
    if (category && category !== 'all') { sql += ' AND category = ?'; params.push(category); }
    if (search) { sql += ' AND (title LIKE ? OR description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (status && status !== 'all') { sql += ' AND status = ?'; params.push(status); }
    if (sort === 'newest') sql += ' ORDER BY created_at DESC';
    else if (sort === 'oldest') sql += ' ORDER BY created_at ASC';
    else if (sort === 'highest') sql += ' ORDER BY payout DESC';
    else if (sort === 'lowest') sql += ' ORDER BY payout ASC';
    else sql += ' ORDER BY created_at DESC';
    const tasks = query(sql, params);
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/featured', (req, res) => {
  try {
    const tasks = query('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT 6', ['open']);
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', auth, (req, res) => {
  try {
    const { title, description, category, payout, workers, deadline, instructions } = req.body;
    if (!title || !description || !category || !payout || !workers || !deadline) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }
    if (payout < 0.1) return res.status(400).json({ error: 'Minimum payout is $0.10' });
    if (workers < 1) return res.status(400).json({ error: 'Must have at least 1 worker' });
    const id = uuidv4();
    run('INSERT INTO tasks (id,title,description,category,payout,workers,workers_done,deadline,instructions,status,created_at,posted_by) VALUES (?,?,?,?,?,?,0,?,?,?,?,?)',
      [id, title, description, category, payout, workers, deadline, instructions || '', 'open', Date.now(), req.user.email]);
    res.status(201).json({ task: { id } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', auth, (req, res) => {
  try {
    const task = get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.posted_by !== req.user.email && req.user.email !== 'admin@demo.com') return res.status(403).json({ error: 'Not your task' });
      const { title, description, category, payout, workers, deadline, instructions } = req.body;
      if (payout < 0.1) return res.status(400).json({ error: 'Minimum payout is $0.10' });
      if (workers < 1) return res.status(400).json({ error: 'Must have at least 1 worker' });
      run('UPDATE tasks SET title=?,description=?,category=?,payout=?,workers=?,deadline=?,instructions=? WHERE id=?',
        [title, description, category, payout, workers, deadline, instructions || '', req.params.id]);
    res.json({ message: 'Updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', auth, (req, res) => {
  try {
    const task = get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.posted_by !== req.user.email && req.user.email !== 'admin@demo.com') return res.status(403).json({ error: 'Not your task' });
    run('DELETE FROM submissions WHERE task_id = ?', [req.params.id]);
    run('DELETE FROM tasks WHERE id = ?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/my', auth, (req, res) => {
  try {
    const tasks = query('SELECT * FROM tasks WHERE posted_by = ? ORDER BY created_at DESC', [req.user.email]);
    const tasksWithCounts = tasks.map(t => {
      const pendingCount = query("SELECT COUNT(*) as c FROM submissions WHERE task_id = ? AND status = 'pending'", [t.id]);
      const totalSubs = query('SELECT COUNT(*) as c FROM submissions WHERE task_id = ?', [t.id]);
      return { ...t, pendingSubmissions: pendingCount[0]?.c || 0, totalSubmissions: totalSubs[0]?.c || 0 };
    });
    res.json({ tasks: tasksWithCounts });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const task = get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ task });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/categories/list', (req, res) => {
  try {
    const categories = query('SELECT * FROM categories ORDER BY name ASC');
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
