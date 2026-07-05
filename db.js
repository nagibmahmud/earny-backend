const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data.db');
let db = null;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');
  migrate();
  return db;
}

function migrate() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS otps (
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      action TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      payout REAL NOT NULL,
      workers INTEGER NOT NULL,
      workers_done INTEGER DEFAULT 0,
      deadline TEXT NOT NULL,
      instructions TEXT DEFAULT '',
      status TEXT DEFAULT 'open',
      created_at INTEGER NOT NULL,
      posted_by TEXT NOT NULL,
      FOREIGN KEY (posted_by) REFERENCES users(email)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      proof TEXT DEFAULT '',
      status TEXT DEFAULT 'in_progress',
      submitted_at INTEGER,
      reviewed_at INTEGER,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (user_email) REFERENCES users(email)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL DEFAULT 0,
      method TEXT NOT NULL,
      account TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_email) REFERENCES users(email)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS adjustments (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_email) REFERENCES users(email)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    )
  `);
  const existingFee = db.exec("SELECT value FROM settings WHERE key='withdrawal_fee'");
  if (!existingFee.length) {
    db.run("INSERT INTO settings (key, value) VALUES (?, ?)", ['withdrawal_fee', '5']);
    save();
  }
  const existingMin = db.exec("SELECT value FROM settings WHERE key='min_withdrawal'");
  if (!existingMin.length) {
    db.run("INSERT INTO settings (key, value) VALUES (?, ?)", ['min_withdrawal', '5']);
    save();
  }
  seed();
}

function seed() {
  const count = db.exec('SELECT COUNT(*) as c FROM tasks');
  if (count.length && count[0].values[0][0] > 0) return;
  const hasAdmin = db.exec("SELECT COUNT(*) as c FROM users WHERE email='admin@demo.com'");
  if (!hasAdmin.length || hasAdmin[0].values[0][0] === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin123', 12);
    db.run("INSERT INTO users (id, name, email, password, created_at) VALUES ('admin', 'Admin', 'admin@demo.com', ?, ?)", [hash, Date.now() - 86400000]);
  }
  const now = Date.now();
  const tasks = [
    { id:'t1', title:'Categorize 50 product images', description:'Review each image and assign the correct category tag.', category:'Data Entry', payout:3.50, workers:100, workersDone:42, deadline:'2026-08-15', instructions:'https://example.com/guidelines', status:'open', createdAt:now-172800000, postedBy:'admin@demo.com' },
    { id:'t2', title:'Test checkout flow on demo store', description:'Go through checkout on our demo store. Report bugs.', category:'Website Testing', payout:5.00, workers:30, workersDone:12, deadline:'2026-07-30', instructions:'https://demo-store.example.com', status:'open', createdAt:now-259200000, postedBy:'admin@demo.com' },
    { id:'t3', title:'Complete market research survey', description:'Answer 20 questions about your shopping habits.', category:'Survey', payout:1.50, workers:200, workersDone:187, deadline:'2026-08-01', instructions:'', status:'open', createdAt:now-86400000, postedBy:'admin@demo.com' },
    { id:'t4', title:'Write 5 product descriptions', description:'Write compelling 50-word descriptions for 5 kitchen products.', category:'Content Writing', payout:8.00, workers:20, workersDone:5, deadline:'2026-08-10', instructions:'Write in friendly tone.', status:'open', createdAt:now-345600000, postedBy:'admin@demo.com' },
    { id:'t5', title:'Design social media banner', description:'Create a 1200x628px banner for a fitness brand.', category:'Design', payout:12.00, workers:10, workersDone:9, deadline:'2026-08-20', instructions:'Use Canva or Photoshop.', status:'open', createdAt:now-432000000, postedBy:'admin@demo.com' },
    { id:'t6', title:'Verify business contact info', description:'Look up 30 businesses and verify phone numbers/addresses.', category:'Research', payout:4.00, workers:50, workersDone:18, deadline:'2026-07-28', instructions:'Use Google Maps.', status:'open', createdAt:now-172800000, postedBy:'admin@demo.com' },
    { id:'t7', title:'Follow 10 Instagram accounts', description:'Follow specified accounts and like latest 3 posts.', category:'Social Media', payout:2.00, workers:150, workersDone:143, deadline:'2026-07-25', instructions:'List in instructions.', status:'open', createdAt:now-518400000, postedBy:'admin@demo.com' },
    { id:'t8', title:'Transcribe 5 audio clips', description:'Type out 30-60 second audio clips verbatim.', category:'Transcription', payout:6.00, workers:25, workersDone:8, deadline:'2026-08-05', instructions:'Type verbatim.', status:'open', createdAt:now-259200000, postedBy:'admin@demo.com' },
    { id:'t9', title:'Rate website UX (10 pages)', description:'Rate pages on load speed, layout, mobile-friendliness.', category:'Website Testing', payout:4.50, workers:40, workersDone:38, deadline:'2026-08-12', instructions:'Use rating sheet.', status:'open', createdAt:now-86400000, postedBy:'admin@demo.com' },
    { id:'t10', title:'Data extraction from receipts', description:'Extract store name, date, total, category from 25 receipts.', category:'Data Entry', payout:3.00, workers:80, workersDone:35, deadline:'2026-08-18', instructions:'Enter exactly as shown.', status:'open', createdAt:now-604800000, postedBy:'admin@demo.com' },
    { id:'t11', title:'Record voice samples (50 phrases)', description:'Read and record 50 short English phrases.', category:'Transcription', payout:10.00, workers:15, workersDone:4, deadline:'2026-08-25', instructions:'Use phone or computer mic.', status:'open', createdAt:now-172800000, postedBy:'admin@demo.com' },
    { id:'t12', title:'Find email addresses (B2B leads)', description:'Find verified emails for 20 marketing managers.', category:'Research', payout:7.00, workers:30, workersDone:10, deadline:'2026-08-08', instructions:'LinkedIn & company sites.', status:'open', createdAt:now-345600000, postedBy:'admin@demo.com' }
  ];
  const stmt = db.prepare('INSERT INTO tasks (id,title,description,category,payout,workers,workers_done,deadline,instructions,status,created_at,posted_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  tasks.forEach(t => {
    stmt.run([t.id, t.title, t.description, t.category, t.payout, t.workers, t.workersDone, t.deadline, t.instructions, t.status, t.createdAt, t.postedBy]);
  });
  stmt.free();

  const catCount = db.exec('SELECT COUNT(*) as c FROM categories');
  if (!catCount.length || catCount[0].values[0][0] === 0) {
    const catNames = ['Data Entry','Website Testing','Survey','Content Writing','Design','Research','Social Media','Transcription','Video Editing','Virtual Assistant','Other'];
    const catStmt = db.prepare('INSERT INTO categories (id, name) VALUES (?, ?)');
    catNames.forEach(n => catStmt.run([require('uuid').v4(), n]));
    catStmt.free();
  }

  save();
}

function save() {
  if (db) {
    const data = db.export();
    const buf = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buf);
  }
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  db.run(sql, params);
  save();
}

function get(sql, params = []) {
  const rows = query(sql, params);
  return rows.length ? rows[0] : null;
}

function getSetting(key, defaultVal = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : defaultVal;
}

function setSetting(key, value) {
  run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
}

module.exports = { getDb, query, run, get, getSetting, setSetting };
