'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { ITEMS, fresh, draw, validate } = require('../dist/engine.js');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const dataDir = fs.mkdtempSync(path.join(root, 'artifacts', 'server-test-'));
let child, base;
async function start() {
  child = spawn(process.execPath, ['--no-warnings', 'server.cjs'], { cwd: root, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DESTINY_DATA_DIR: dataDir, ADMIN_USERNAME: 'poxiao', ADMIN_PASSWORD: 'test-admin-password', ADMIN_PASSWORD_FILE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('server start timed out')), 10000);
    child.stdout.on('data', chunk => { const port = /localhost:(\d+)/.exec(String(chunk)); if (port) { base = `http://127.0.0.1:${port[1]}`; clearTimeout(timeout); resolve(); } });
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timeout); reject(Error('server exited: ' + code)); });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
  });
}
async function stop() { if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; } }
const client = () => ({ cookie: '' });
async function request(who, route, data, expected = 200, extraHeaders = {}) {
  const response = await fetch(base + route, { method: data === undefined ? 'GET' : 'POST', headers: { ...(who.cookie ? { Cookie: who.cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }), ...extraHeaders }, body: data === undefined ? undefined : JSON.stringify(data) });
  assert.equal(response.status, expected, `${route}: ${await response.clone().text()}`);
  if (response.headers.get('set-cookie')) { who.cookie = response.headers.get('set-cookie').split(';')[0]; assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/); }
  return response.json();
}
let serial = 0;
const op = () => 'integration-operation-' + (++serial);
const drawBody = count => ({ count, useFree: false, requestId: op() });
const only = id => Object.fromEntries(ITEMS.map(i => [i.id, i.id === id ? 100 : 0]));
(async () => {
  await start();
  const anon = client(), admin = client(), alice = client(), bob = client();
  await request(anon, '/api/me', undefined, 401);
  await request(anon, '/api/admin/players', undefined, 401);
  await request(anon, '/api/admin/settings', undefined, 401);
  await request(anon, '/api/admin/prayers', undefined, 401);
  assert.equal((await request(anon, '/api/registration')).registrationEnabled, true);
  await request(anon, '/api/login', { username: 'poxiao', password: 'wrong-password' }, 401);
  const auth = await request(admin, '/api/login', { username: 'poxiao', password: 'test-admin-password' });
  assert.equal(auth.user.role, 'admin'); assert.equal(auth.user.nickname, '系统本身');
  assert.ok(!JSON.stringify(auth).includes('password')); assert.ok(!JSON.stringify(auth).includes('salt'));
  await request(anon, '/api/register', { username: 'POXIAO', password: 'anything' }, 409);
  await request(anon, '/api/register', { username: 'x', password: '123456' }, 400);
  const a = await request(alice, '/api/register', { username: 'alice', password: 'alice-password', nickname: '<script>宿主</script>', role: 'admin', balance: 999999 });
  const b = await request(bob, '/api/register', { username: 'bob', password: 'bob-password', nickname: '第二位宿主' });
  assert.equal(a.state.balance, 0); assert.equal(b.state.balance, 0); assert.equal(a.user.role, 'player');
  await request(alice, '/api/draw', drawBody(1), 400);
  await request(alice, '/api/draw', drawBody(10), 400);
  await stop(); await start();
  assert.equal((await request(alice, '/api/me')).state.balance, 0, 'restart must not award starter flowers');
  await request(anon, '/api/register', { username: 'Alice', password: 'testpassword' }, 409);
  await request(alice, '/api/admin/players', undefined, 403);
  await request(alice, '/api/admin/grant', { playerId: a.user.id, amount: 100, requestId: op() }, 403);
  await request(alice, '/api/admin/config', {}, 403);
  await request(alice, '/api/admin/settings', undefined, 403);
  await request(alice, '/api/admin/settings', { registrationEnabled: false, version: 1 }, 403);
  await request(alice, '/api/admin/prayers', undefined, 403);
  await request(admin, '/api/admin/grant', { playerId: a.user.id, amount: 100, requestId: op() }, 403, { Origin: 'https://foreign.example' });
  for (const resource of ['/server.cjs', '/admin-bootstrap.cjs', '/data/university.sqlite', '/%2e%2e%5cserver.cjs']) assert.equal((await fetch(base + resource)).status, 404);
  // Fund draw fixtures through the administrator; registration gives no flowers.
  for (const playerId of [a.user.id, b.user.id]) await request(admin, '/api/admin/grant', { playerId, amount: 100, requestId: op() });
  let config = auth.config;
  const setPool = async (rates, guarantees = false) => {
    config = (await request(admin, '/api/admin/config', { rates, guarantees, version: config.version })).config;
  };
  await request(admin, '/api/admin/config', { rates: { ...config.rates, flowers: 18 }, guarantees: true, version: config.version }, 400);
  await request(admin, '/api/admin/config', { rates: only('empty'), guarantees: true, version: config.version }, 400);
  await setPool(only('empty'));
  await request(admin, '/api/admin/config', { rates: config.rates, guarantees: false, version: config.version - 1 }, 409);
  const tenRequest = drawBody(10);
  const ten = await request(alice, '/api/draw', { ...tenRequest, state: { balance: 999999 }, results: ['shinchan'] });
  assert.equal(ten.state.balance, 0); assert.equal(ten.results.length, 10); assert.ok(ten.results.every(i => i.id === 'empty'));
  const repeat = await request(alice, '/api/draw', tenRequest); assert.equal(repeat.state.total, 10); assert.equal(repeat.replayed, true);
  await request(alice, '/api/draw', drawBody(1), 400);
  const concurrent = await Promise.all(Array.from({ length: 12 }, async () => {
    const res = await fetch(base + '/api/draw', { method: 'POST', headers: { Cookie: bob.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(drawBody(1)) }); return res.status;
  }));
  assert.equal(concurrent.filter(code => code === 200).length, 10); assert.equal(concurrent.filter(code => code === 400).length, 2);
  assert.equal((await request(bob, '/api/me')).state.balance, 0);
  const grantRequest = { playerId: a.user.id, amount: 50, note: '测试奖励', requestId: op() };
  await request(admin, '/api/admin/grant', grantRequest); await request(admin, '/api/admin/grant', grantRequest);
  assert.equal((await request(alice, '/api/me')).state.balance, 50); assert.equal((await request(bob, '/api/me')).state.balance, 0);
  for (const amount of [-1, 0, 1.2, 1000001]) await request(admin, '/api/admin/grant', { ...grantRequest, amount, requestId: op() }, 400);
  await setPool(only('flowers'));
  assert.equal((await request(alice, '/api/draw', drawBody(1))).state.balance, 60);
  await setPool(only('retry'));
  const retry = await request(alice, '/api/draw', drawBody(1)); assert.equal(retry.state.balance, 50); assert.equal(retry.state.freeDraws, 1);
  const free = await request(alice, '/api/draw', { ...drawBody(1), useFree: true }); assert.equal(free.state.balance, 50); assert.equal(free.state.freeDraws, 1);
  const before = await request(alice, '/api/me');
  const players = await request(admin, '/api/admin/players'); assert.equal(players.players.length, 2); assert.equal(players.logs.filter(l => l.kind === 'grant').length, 3);
  const prayerList = await request(admin, '/api/admin/prayers');
  assert.equal(prayerList.total, 23, 'replayed draws do not duplicate history');
  assert.equal(prayerList.records.length, 20); assert.equal(prayerList.pages, 2);
  const secondPage = await request(admin, '/api/admin/prayers?page=2');
  assert.equal(secondPage.records.length, 3);
  assert.equal(new Set([...prayerList.records, ...secondPage.records].map(r => r.playerId + ':' + r.number)).size, 23);
  const alicePrayers = await request(admin, '/api/admin/prayers?playerId=' + a.user.id);
  assert.equal(alicePrayers.total, 13); assert.ok(alicePrayers.records.every(r => r.playerId === a.user.id));
  assert.equal(alicePrayers.records[0].useFree, true); assert.equal(alicePrayers.records[0].reward, '再抽一次');
  assert.equal(alicePrayers.records.filter(r => r.drawCount === 10).length, 10);
  for (const suffix of ['?page=-1', '?page=1.5', '?playerId=nope']) await request(admin, '/api/admin/prayers' + suffix, undefined, 400);
  await request(admin, '/api/admin/prayers?playerId=999999', undefined, 404);
  assert.ok(!JSON.stringify(players).includes('password_hash'));
  await stop(); await start();
  assert.deepEqual((await request(alice, '/api/me')).state, before.state, 'state and sessions survive restart');
  assert.deepEqual((await request(admin, '/api/me')).config, config, 'settings survive restart');
  assert.deepEqual(await request(admin, '/api/admin/prayers'), prayerList, 'prayers survive restart');
  const oldCookie = alice.cookie; await request(alice, '/api/logout', {});
  await request({ cookie: oldCookie }, '/api/me', undefined, 401);
  const back = await request(alice, '/api/login', { username: 'ALICE', password: 'alice-password' }); assert.deepEqual(back.state, before.state);
  let settings = (await request(admin, '/api/admin/settings')).settings;
  await request(admin, '/api/admin/settings', { registrationEnabled: 'false', version: settings.version }, 400);
  await request(admin, '/api/admin/settings', { registrationEnabled: false, version: settings.version - 1 }, 409);
  settings = (await request(admin, '/api/admin/settings', { registrationEnabled: false, version: settings.version })).settings;
  assert.equal((await request(anon, '/api/registration')).registrationEnabled, false);
  await request(anon, '/api/register', { username: 'closed_user', password: 'closed-password' }, 403);
  assert.equal((await request(client(), '/api/login', { username: 'bob', password: 'bob-password' })).user.id, b.user.id);
  await stop(); await start();
  assert.equal((await request(anon, '/api/registration')).registrationEnabled, false, 'registration closure survives restart');
  await request(anon, '/api/register', { username: 'closed_user', password: 'closed-password' }, 403);
  settings = (await request(admin, '/api/admin/settings', { registrationEnabled: true, version: settings.version })).settings;
  const reopened = await request(anon, '/api/register', { username: 'reopened_user', password: 'new-password' });
  assert.equal(reopened.state.balance, 0);
  assert.equal((await request(admin, '/api/admin/prayers?playerId=' + reopened.user.id)).total, 0);
  const auditRows = (await request(admin, '/api/admin/players')).logs.filter(row => row.kind === 'settings');
  assert.equal(auditRows.length, 2); assert.equal(auditRows[0].detail.after.registrationEnabled, true);
  await setPool(only('empty'));
  await request(admin, '/api/admin/grant', { playerId: b.user.id, amount: 2200, requestId: op() });
  for (let i = 0; i < 22; i++) await request(bob, '/api/draw', drawBody(10));
  assert.equal((await request(bob, '/api/me')).state.history.length, 200);
  assert.equal((await request(admin, '/api/admin/prayers?playerId=' + b.user.id)).total, 230, 'admin records retain draws beyond the player history cap');
  // Emulate a legacy database and verify one-time import without duplicating records.
  await stop();
  const { DatabaseSync } = require('node:sqlite');
  const legacyDb = new DatabaseSync(path.join(dataDir, 'university.sqlite'));
  legacyDb.exec("DROP TABLE prayers; DELETE FROM settings WHERE key='prayers-imported'"); legacyDb.close();
  await start();
  const imported = await request(admin, '/api/admin/prayers');
  assert.equal(imported.total, 213); assert.ok(imported.records.every(r => r.useFree === null && r.drawCount === null));
  await stop(); await start();
  assert.equal((await request(admin, '/api/admin/prayers')).total, 213, 'legacy import runs once');
  // Configured guarantees use weighted epic picks and retain valid counters when disabled.
  const configured = { rates: { ...only('empty'), shinchan: 1, secret1: 1, empty: 98 }, guarantees: true };
  let s = { ...fresh(), balance: 1000 };
  for (let i = 0; i < 80; i++) {
    const out = draw(s, 1, () => .9, 1000, false, configured); s = out.state;
    if ((i + 1) % 10 === 0 && i !== 79) assert.equal(out.results[0].id, 'secret1');
    if (i === 79) assert.equal(out.results[0].id, 'shinchan');
  }
  const disabled = { rates: only('empty'), guarantees: false };
  s = { ...fresh(), balance: 1000 };
  for (let i = 0; i < 10; i++) s = draw(s, 10, () => .9, 1000, false, disabled).state;
  assert.ok(validate(s)); assert.equal(s.pitySSR, 79); assert.equal(s.pitySR, 9); assert.equal(s.inventory.empty, 100);
  // Reward names are shared metadata, while a limited gift belongs to each player independently.
  const names = { ...config.names, shinchan: '校园限定礼盒', retry: '再许一个愿', empty: '<花间 & "晚风">' };
  for (const bad of ['', ' '.repeat(3), '花'.repeat(25), '花\n语', 123]) {
    await request(admin, '/api/admin/config', { ...config, names: { ...names, empty: bad } }, 400);
  }
  await request(alice, '/api/admin/config', { ...config, names }, 403);
  config = (await request(admin, '/api/admin/config', { ...config, names })).config;
  assert.deepEqual((await request(bob, '/api/me')).config.names, names);
  assert.ok((await request(admin, '/api/admin/prayers?playerId=' + b.user.id)).records.every(record => record.reward === names.empty));
  await setPool(only('shinchan'));
  assert.equal(config.names.shinchan, names.shinchan, 'older config clients retain custom names');
  await request(admin, '/api/admin/grant', { playerId: reopened.user.id, amount: 100, requestId: op() });
  const simultaneous = await Promise.all(Array.from({ length: 5 }, async () => {
    const res = await fetch(base + '/api/draw', { method: 'POST', headers: { Cookie: anon.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(drawBody(1)) });
    return res.status;
  }));
  assert.equal(simultaneous.filter(status => status === 200).length, 1, 'simultaneous first wins issue exactly one gift');
  assert.equal(simultaneous.filter(status => status === 400).length, 4);
  assert.equal((await request(anon, '/api/me')).state.balance, 90);
  await request(admin, '/api/admin/grant', { playerId: b.user.id, amount: 300, requestId: op() });
  const beforeLimited = (await request(bob, '/api/me')).state;
  await request(bob, '/api/draw', drawBody(10), 400);
  assert.deepEqual((await request(bob, '/api/me')).state, beforeLimited, 'unavailable ten-pull rolls back all changes');
  const limitedRequest = drawBody(1);
  const gift = await request(bob, '/api/draw', limitedRequest);
  assert.equal(gift.results[0].name, names.shinchan); assert.equal(gift.state.inventory.shinchan, 1);
  assert.equal((await request(bob, '/api/draw', limitedRequest)).state.inventory.shinchan, 1);
  const attempts = await Promise.all(Array.from({ length: 4 }, () => request(bob, '/api/draw', drawBody(1), 400)));
  assert.equal(attempts.length, 4);
  assert.equal((await request(alice, '/api/draw', { ...drawBody(1), useFree: true })).state.inventory.shinchan, 1, 'another player can win independently');
  await stop(); await start();
  assert.deepEqual((await request(bob, '/api/me')).config.names, names);
  await request(bob, '/api/draw', drawBody(1), 400);
  await setPool({ ...only('empty'), shinchan: 99, empty: 1 });
  const afterLimit = await request(bob, '/api/draw', drawBody(10));
  assert.ok(afterLimit.results.every(item => item.id === 'empty' && item.name === names.empty));
  assert.equal(afterLimit.state.inventory.shinchan, 1);
  console.log('PASS: reward name validation, permission, display metadata, history names, per-player limit, concurrent/replayed draws, rollback, restart persistence');
  console.log('PASS: account isolation, admin authorization, input validation, CSRF, private files, probability controls, guarantees, concurrent draws, idempotency, flower/free rewards, restart persistence, logout');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(stop);
