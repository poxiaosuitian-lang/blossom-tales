'use strict';
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const suffix = randomUUID().slice(0, 8), container = `blossom-smoke-${suffix}`, volume = `${container}-data`;
const password = randomUUID();
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 60000, env: { ...process.env, ADMIN_PASSWORD: password } }).trim();
let started = false, volumeCreated = false, base;
async function ready() {
  // Docker can allocate a different ephemeral host port after a restart.
  const info = JSON.parse(docker(['inspect', container]))[0];
  base = 'http://127.0.0.1:' + info.NetworkSettings.Ports['5173/tcp'][0].HostPort;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).ready) return;
    } catch { /* The server may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error('Docker health check timed out');
}
async function request(route, data, cookie = '') {
  const response = await fetch(base + route, { method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base },
    body: data === undefined ? undefined : JSON.stringify(data) });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  return { body, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
(async () => {
  try {
    docker(['volume', 'create', volume]); volumeCreated = true;
    docker(['run', '-d', '--name', container, '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '-e', 'ADMIN_USERNAME=smoke_admin', '-e', 'ADMIN_PASSWORD', '-p', '127.0.0.1::5173', '-v', `${volume}:/app/data`, 'blossom-tales:test']);
    started = true;
    const info = JSON.parse(docker(['inspect', container]))[0];
    assert.equal(info.Config.User, 'node');
    base = 'http://127.0.0.1:' + info.NetworkSettings.Ports['5173/tcp'][0].HostPort;
    await ready(); docker(['exec', container, 'node', 'scripts/healthcheck.cjs']);
    console.log('PASS: container startup and health');
    const admin = await request('/api/login', { username: 'smoke_admin', password });
    const player = await request('/api/register', { username: 'smoke_player', password: randomUUID() });
    const config = admin.body.config;
    const rates = Object.fromEntries(Object.keys(config.rates).map(id => [id, id === 'empty' ? 100 : 0]));
    const names = { ...config.names, empty: 'Docker 烟雾测试' };
    await request('/api/admin/config', { rates, names, guarantees: false, version: config.version }, admin.cookie);
    await request('/api/admin/grant', { playerId: player.body.user.id, amount: 50, requestId: randomUUID() }, admin.cookie);
    const draw = await request('/api/draw', { count: 1, useFree: false, requestId: randomUUID() }, player.cookie);
    assert.equal(draw.body.state.balance, 40);
    assert.equal(draw.body.results[0].name, names.empty);
    console.log('PASS: administrator bootstrap and player draw');
    docker(['restart', container]); await ready();
    const restored = await request('/api/me', undefined, player.cookie);
    assert.deepEqual(restored.body.state, draw.body.state);
    assert.equal(restored.body.config.names.empty, names.empty);
    // Recreate the container with the same volume, not only the same writable layer.
    docker(['rm', '-f', container]); started = false;
    docker(['run', '-d', '--name', container, '--read-only', '--tmpfs', '/tmp', '-e', 'ADMIN_PASSWORD', '-p', '127.0.0.1::5173', '-v', `${volume}:/app/data`, 'blossom-tales:test']);
    started = true;
    const recreated = JSON.parse(docker(['inspect', container]))[0];
    base = 'http://127.0.0.1:' + recreated.NetworkSettings.Ports['5173/tcp'][0].HostPort;
    await ready();
    assert.deepEqual((await request('/api/me', undefined, player.cookie)).body.state, draw.body.state);
    console.log('PASS: Docker non-root/read-only startup, health, configurable admin, draw, restart and volume persistence');
  } catch (error) {
    if (started) { try { console.error(docker(['logs', '--tail', '30', container])); } catch { /* Preserve original failure. */ } }
    throw error;
  } finally {
    if (started) docker(['rm', '-f', container]);
    if (volumeCreated) docker(['volume', 'rm', volume]);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
