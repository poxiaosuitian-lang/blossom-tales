'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const { ITEMS, ALL_ITEMS, fresh, draw, namedItem } = require('./dist/engine.js');
const hashPassword = promisify(scrypt);
const ROOT = path.join(__dirname, 'dist');
const DATA = process.env.DESTINY_DATA_DIR || path.join(__dirname, 'data');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_CONFIG = { rates: { shinchan: 2, secret1: 4.34, secret2: 4.33, secret3: 4.33, retry: 17, empty: 17, steal: 17, bump: 17, flowers: 17 }, guarantees: true, version: 1 };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'university.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','player')), state TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), target_id INTEGER REFERENCES users(id), kind TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS operations(actor_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, kind TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(actor_id,request_id));
  CREATE TABLE IF NOT EXISTS prayers(user_id INTEGER NOT NULL REFERENCES users(id), number INTEGER NOT NULL, item_id TEXT NOT NULL, created_at INTEGER NOT NULL, use_free INTEGER, draw_count INTEGER, PRIMARY KEY(user_id,number));
  CREATE INDEX IF NOT EXISTS prayers_time ON prayers(created_at DESC,user_id DESC,number DESC);`);
db.prepare('INSERT OR IGNORE INTO settings VALUES (?, ?)').run('pool', JSON.stringify(DEFAULT_CONFIG));
db.prepare('INSERT OR IGNORE INTO settings VALUES (?, ?)').run('system', JSON.stringify({ registrationEnabled: true, version: 1 }));
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
const publicUser = u => ({ id: u.id, username: u.username, nickname: u.nickname, role: u.role, createdAt: u.created_at });
const getConfig = () => { const config = JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('pool').value); return { ...config, names: { ...Object.fromEntries(ITEMS.map(item => [item.id, item.name])), ...config.names } }; };
const getSystemSettings = () => JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('system').value);
// Older versions retained only the last 200 results in each player's state.
if (!db.prepare('SELECT key FROM settings WHERE key=?').get('prayers-imported')) transaction(() => {
  const insert = db.prepare('INSERT OR IGNORE INTO prayers VALUES (?,?,?,?,NULL,NULL)');
  for (const player of db.prepare("SELECT id,state FROM users WHERE role='player'").all()) {
    for (const record of JSON.parse(player.state).history) insert.run(player.id, record.number, record.id, record.time);
  }
  db.prepare('INSERT INTO settings VALUES (?,?)').run('prayers-imported', 'true');
});
const getUser = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
const tokenHash = token => createHash('sha256').update(token).digest('hex');
function snapshot(u) { return { user: publicUser(u), state: JSON.parse(u.state), config: getConfig() }; }
function identify(req) {
  const token = /(?:^|;\s*)university_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return null;
  const row = db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(tokenHash(token), Date.now());
  return row ? getUser(row.user_id) : null;
}
function cookie(token, age) { return `university_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`; }
function send(res, status, data, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(data)); }
function session(res, user) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash(token), user.id, Date.now() + 7 * 86400000);
  send(res, 200, snapshot(user), { 'Set-Cookie': cookie(token, 7 * 86400) });
}
async function body(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, '请求格式需为 JSON');
  let raw = '', size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 16384) fail(413, '请求内容过长'); raw += chunk.toString(); }
  try { const data = JSON.parse(raw); if (!data || Array.isArray(data) || typeof data !== 'object') throw Error(); return data; }
  catch { fail(400, '请求格式有误'); }
}
const attempts = new Map();
function limit(req) {
  const key = req.socket.remoteAddress;
  const now = Date.now();
  for (const [ip, record] of attempts) if (record.until < now) attempts.delete(ip);
  const record = attempts.get(key) || { count: 0, until: now + 60000 };
  if (++record.count > 25) fail(429, '操作太频繁，请一分钟后重试');
  attempts.set(key, record);
}
function credentials(data) {
  const username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
  if (!/^[a-z0-9_]{3,24}$/.test(username)) fail(400, '账号需为 3–24 位字母、数字或下划线');
  if (typeof data.password !== 'string' || data.password.length < 6 || data.password.length > 128) fail(400, '密码需为 6–128 位');
  return username;
}
function operation(user, data, kind, fn) {
  if (typeof data.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(data.requestId)) fail(400, '缺少有效操作编号');
  return transaction(() => {
    const old = db.prepare('SELECT * FROM operations WHERE actor_id=? AND request_id=?').get(user.id, data.requestId);
    if (old) { if (old.kind !== kind) fail(409, '操作编号重复'); return { ...JSON.parse(old.response), ...snapshot(getUser(user.id)), replayed: true }; }
    const result = fn(getUser(user.id));
    db.prepare('INSERT INTO operations VALUES (?,?,?,?)').run(user.id, data.requestId, kind, JSON.stringify(result));
    return result;
  });
}
function audit(actor, target, kind, detail) { db.prepare('INSERT INTO audit(actor_id,target_id,kind,detail,created_at) VALUES (?,?,?,?,?)').run(actor, target, kind, JSON.stringify(detail), Date.now()); }
function validateConfig(data) {
  if (typeof data.guarantees !== 'boolean' || !data.rates || typeof data.rates !== 'object' || Object.keys(data.rates).length !== ITEMS.length) fail(400, '请填写全部 9 项奖励概率');
  const rates = {};
  let total = 0;
  for (const item of ITEMS) {
    const rate = data.rates[item.id];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100 || Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-7) fail(400, '概率需为 0–100，最多两位小数');
    rates[item.id] = rate; total += Math.round(rate * 100);
  }
  if (total !== 10000) fail(400, '所有奖励的概率之和必须为 100%');
  if (data.guarantees && (rates.shinchan <= 0 || rates.secret1 + rates.secret2 + rates.secret3 <= 0)) fail(400, '开启保底时，传说和史诗总概率都必须大于 0');
  const names = {};
  const inputNames = data.names === undefined ? getConfig().names : data.names;
  if (!inputNames || typeof inputNames !== 'object' || Array.isArray(inputNames) || Object.keys(inputNames).length !== ITEMS.length) fail(400, '请填写全部 9 项奖励名称');
  for (const item of ITEMS) {
    const name = inputNames[item.id];
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 24 || /[\u0000-\u001f\u007f]/.test(name)) fail(400, '奖励名称需为 1–24 个字符，不能含换行或控制字符');
    names[item.id] = name.trim();
  }
  return { rates, guarantees: data.guarantees, names };
}
async function api(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { service: 'university-system', ready: true });
  if (req.method === 'GET' && pathname === '/api/registration') return send(res, 200, { registrationEnabled: getSystemSettings().registrationEnabled });
  if (!['GET', 'POST'].includes(req.method)) fail(405, '不支持的请求方式');
  if (req.method === 'POST') {
    if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, '不允许跨站操作');
    if (req.headers.origin) { let origin; try { origin = new URL(req.headers.origin); } catch { fail(403, '无效来源'); } if (origin.host !== req.headers.host) fail(403, '不允许跨站操作'); }
  }
  if (req.method === 'POST' && ['/api/login', '/api/register'].includes(pathname)) {
    limit(req);
    const data = await body(req), username = credentials(data);
    if (pathname === '/api/register') {
      if (!getSystemSettings().registrationEnabled) fail(403, '叮！新宿主绑定暂未开放，已有宿主可正常接入。');
      const nickname = typeof data.nickname === 'string' ? data.nickname.trim() : username;
      if (!nickname || nickname.length > 20 || /[\u0000-\u001f]/.test(nickname)) fail(400, '宿主名称需为 1–20 个字符');
      if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) fail(409, '这个账号已被绑定');
      const salt = randomBytes(16).toString('hex'), hash = (await hashPassword(data.password, salt, 64)).toString('hex');
      // Recheck after asynchronous hashing so a concurrent closure takes effect.
      if (!getSystemSettings().registrationEnabled) fail(403, '叮！新宿主绑定暂未开放，已有宿主可正常接入。');
      let id;
      try { id = db.prepare('INSERT INTO users(username,nickname,salt,password_hash,role,state,created_at) VALUES (?,?,?,?,?,?,?)').run(username, nickname, salt, hash, 'player', JSON.stringify(fresh()), Date.now()).lastInsertRowid; }
      catch (error) { if (error.code?.startsWith('ERR_SQLITE')) fail(409, '这个账号已被绑定'); throw error; }
      return session(res, getUser(id));
    }
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    const actual = await hashPassword(data.password, user?.salt || 'university-dummy-salt', 64);
    if (!user || !timingSafeEqual(actual, Buffer.from(user.password_hash, 'hex'))) fail(401, '账号或密码不正确');
    return session(res, user);
  }
  const user = identify(req);
  if (!user) fail(401, '请先绑定宿主');
  if (req.method === 'GET' && pathname === '/api/me') return send(res, 200, snapshot(user));
  if (req.method === 'POST' && pathname === '/api/logout') {
    const token = /university_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }
  if (req.method === 'POST' && pathname === '/api/draw') {
    const data = await body(req);
    if (![1, 10].includes(data.count) || typeof data.useFree !== 'boolean') fail(400, '无效祈愿参数');
    const result = operation(user, data, 'draw', current => {
      let output;
      try { output = draw(JSON.parse(current.state), data.count, undefined, Date.now(), data.useFree, getConfig()); } catch (error) { fail(400, error.message); }
      db.prepare('UPDATE users SET state=? WHERE id=?').run(JSON.stringify(output.state), user.id);
      if (current.role === 'player') {
        const insert = db.prepare('INSERT INTO prayers VALUES (?,?,?,?,?,?)');
        for (const record of output.state.history.slice(0, data.count)) insert.run(user.id, record.number, record.id, record.time, Number(data.useFree), data.count);
      }
      return { ...snapshot(getUser(user.id)), results: output.results };
    });
    return send(res, 200, { ...result, results: result.results.map(item => namedItem(item, result.config)) });
  }
  if (pathname.startsWith('/api/admin/')) {
    if (user.role !== 'admin') fail(403, '仅系统管理员可以操作');
    if (req.method === 'GET' && pathname === '/api/admin/settings') return send(res, 200, { settings: getSystemSettings() });
    if (req.method === 'POST' && pathname === '/api/admin/settings') {
      const data = await body(req);
      if (typeof data.registrationEnabled !== 'boolean') fail(400, '请选择是否开放新宿主注册');
      return send(res, 200, transaction(() => {
        const before = getSystemSettings();
        if (data.version !== before.version) fail(409, '系统设置已在其他页面修改，请刷新后重试');
        const settings = { registrationEnabled: data.registrationEnabled, version: before.version + 1 };
        db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(settings), 'system');
        audit(user.id, null, 'settings', { before, after: settings });
        return { settings };
      }));
    }
    if (req.method === 'GET' && pathname === '/api/admin/prayers') {
      const query = new URL(req.url, 'http://localhost').searchParams;
      const playerId = query.get('playerId') || '', rawPage = query.get('page') || '1';
      if ((playerId && !/^[1-9]\d*$/.test(playerId)) || !/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(Number(rawPage)) || (playerId && !Number.isSafeInteger(Number(playerId)))) fail(400, '无效的宿主或页码');
      if (playerId && getUser(Number(playerId))?.role !== 'player') fail(404, '宿主不存在');
      const where = playerId ? 'WHERE p.user_id=?' : '';
      const args = playerId ? [Number(playerId)] : [];
      const total = db.prepare(`SELECT COUNT(*) AS total FROM prayers p ${where}`).get(...args).total;
      const pageSize = 20, pages = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(Number(rawPage), pages);
      const config = getConfig();
      const records = db.prepare(`SELECT p.*,u.nickname,u.username FROM prayers p JOIN users u ON u.id=p.user_id ${where} ORDER BY p.created_at DESC,p.user_id DESC,p.number DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize).map(row => {
        const item = ALL_ITEMS.find(item => item.id === row.item_id);
        return { playerId: row.user_id, username: row.username, nickname: row.nickname, number: row.number, time: row.created_at, itemId: row.item_id, reward: item ? namedItem(item, config).name : row.item_id, rarity: item?.rarity || '', useFree: row.use_free === null ? null : Boolean(row.use_free), drawCount: row.draw_count };
      });
      return send(res, 200, { records, total, page, pages, pageSize });
    }
    if (req.method === 'GET' && pathname === '/api/admin/players') {
      const players = db.prepare("SELECT * FROM users WHERE role='player' ORDER BY id DESC").all().map(u => ({ ...publicUser(u), ...JSON.parse(u.state) }));
      const logs = db.prepare('SELECT a.*, u.nickname, u.username FROM audit a LEFT JOIN users u ON u.id=a.target_id ORDER BY a.id DESC LIMIT 100').all().map(a => ({ id: a.id, kind: a.kind, nickname: a.nickname, username: a.username, detail: JSON.parse(a.detail), time: a.created_at }));
      return send(res, 200, { players, logs, config: getConfig(), settings: getSystemSettings() });
    }
    if (req.method === 'POST' && pathname === '/api/admin/grant') {
      const data = await body(req);
      if (!Number.isSafeInteger(data.playerId) || !Number.isSafeInteger(data.amount) || data.amount < 1 || data.amount > 1000000) fail(400, '请选择宿主，发放数量为 1–1000000 的整数');
      if (data.note !== undefined && (typeof data.note !== 'string' || data.note.length > 100)) fail(400, '备注最多 100 字');
      return send(res, 200, operation(user, data, 'grant', () => {
        const player = getUser(data.playerId);
        if (!player || player.role !== 'player') fail(404, '宿主不存在');
        const state = JSON.parse(player.state); state.balance += data.amount;
        if (!Number.isSafeInteger(state.balance)) fail(400, '余额超过上限');
        db.prepare('UPDATE users SET state=? WHERE id=?').run(JSON.stringify(state), player.id);
        audit(user.id, player.id, 'grant', { amount: data.amount, note: data.note || '' });
        return { ok: true, player: { ...publicUser(player), balance: state.balance } };
      }));
    }
    if (req.method === 'POST' && pathname === '/api/admin/config') {
      const data = await body(req), config = validateConfig(data);
      return send(res, 200, transaction(() => {
        const before = getConfig();
        if (data.version !== before.version) fail(409, '奖池已在其他页面修改，请刷新管理数据后重试');
        config.version = before.version + 1;
        db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(config), 'pool');
        audit(user.id, null, 'config', { before, after: config });
        return { config };
      }));
    }
  }
  fail(404, '接口不存在');
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
    if (!['GET','HEAD'].includes(req.method)) fail(405, '不支持的请求方式');
    let relative; try { relative = decodeURIComponent(url.pathname); } catch { fail(400, '路径有误'); }
    const file = path.resolve(ROOT, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(ROOT + path.sep) || relative.includes('\\') || relative.includes(':')) fail(404, '文件不存在');
    let stat; try { stat = fs.statSync(file); } catch { fail(404, '文件不存在'); }
    if (!stat.isFile() || !MIME[path.extname(file)]) fail(404, '文件不存在');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res);
  } catch (error) { if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : '系统暂时繁忙，请重试' }); else res.destroy(); if (!error.status) console.error(error); }
});
async function start() {
  if (!db.prepare("SELECT id FROM users WHERE role='admin'").get()) {
    const username = (process.env.ADMIN_USERNAME || 'poxiao').trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) throw Error('ADMIN_USERNAME must contain 3–24 letters, digits or underscores.');
    let password = process.env.ADMIN_PASSWORD;
    if (process.env.ADMIN_PASSWORD_FILE) password = fs.readFileSync(process.env.ADMIN_PASSWORD_FILE, 'utf8').replace(/\r?\n$/, '');
    let salt, hash;
    if (password) {
      if (password.length < 8 || password.length > 128) throw Error('ADMIN_PASSWORD must contain 8–128 characters.');
      salt = randomBytes(16).toString('hex'); hash = (await hashPassword(password, salt, 64)).toString('hex');
    } else if (process.env.NODE_ENV !== 'production' && fs.existsSync(path.join(__dirname, 'admin-bootstrap.cjs'))) {
      // Compatibility with an existing private local installation; never included in Docker/Git.
      ({ salt, hash } = require('./admin-bootstrap.cjs'));
    } else throw Error('Set ADMIN_PASSWORD or ADMIN_PASSWORD_FILE before the first startup.');
    db.prepare('INSERT INTO users(username,nickname,salt,password_hash,role,state,created_at) VALUES (?,?,?,?,?,?,?)').run(username, '系统本身', salt, hash, 'admin', JSON.stringify(fresh()), Date.now());
  }
  server.listen(PORT, HOST, () => console.log(`University system ready: http://localhost:${server.address().port}`));
}
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.` : error.message); process.exitCode = 1; db.close(); });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
start().catch(error => { console.error(error.message); process.exitCode = 1; });
