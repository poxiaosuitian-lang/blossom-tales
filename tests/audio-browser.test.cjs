'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { fresh } = require('../dist/engine.js');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const Original = window.AudioContext;
      window.audioContexts = [];
      window.AudioContext = class extends Original {
        constructor(...args) { super(...args); window.audioContexts.push(this); }
        createDynamicsCompressor() {
          const compressor = super.createDynamicsCompressor();
          this.monitor = this.createAnalyser(); this.monitor.fftSize = 2048;
          compressor.connect(this.monitor);
          return compressor;
        }
      };
    });
    await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      user: { id: 99, username: 'audio_test', nickname: '聆听花语', role: 'player' }, state: fresh(), registrationEnabled: true
    }) }));
    const url = pathToFileURL(path.resolve(__dirname, '../dist/index.html')).href;
    await page.goto(url);
    const button = page.locator('#sound');
    await button.waitFor();
    assert.equal(await button.getAttribute('aria-pressed'), 'true', 'music defaults to enabled');
    await page.locator('[data-view="inventory"]').click();
    await page.waitForFunction(() => BlossomAudio.playing);
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.match(await button.getAttribute('aria-label'), /关闭音乐与音效/);
    const signal = await page.evaluate(async () => {
      const monitor = audioContexts[0].monitor, buffer = new Float32Array(monitor.fftSize);
      let energy = 0, peak = 0;
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        monitor.getFloatTimeDomainData(buffer);
        for (const n of buffer) { energy += n * n; peak = Math.max(peak, Math.abs(n)); }
      }
      return { energy, peak };
    });
    assert.ok(signal.energy > .0001, 'music produces a non-silent signal');
    assert.ok(signal.peak < .95, 'music leaves headroom');
    for (const cue of ['click', 'summon', 'reward', 'legendary', 'collect', 'growth']) await page.evaluate(kind => BlossomAudio.cue(kind), cue);
    await button.click();
    await page.waitForFunction(() => !BlossomAudio.enabled && audioContexts[0].state === 'suspended');
    assert.equal(await page.evaluate(() => localStorage.getItem('blossom-audio-enabled')), 'false');
    await button.click(); await page.waitForFunction(() => BlossomAudio.playing);
    assert.equal(await page.evaluate(() => audioContexts.length), 1, 'toggling reuses one audio context');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => !BlossomAudio.playing && audioContexts[0].state === 'suspended');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => BlossomAudio.playing);
    await page.reload(); await button.waitFor();
    assert.equal(await button.getAttribute('aria-pressed'), 'true', 'preference survives refresh');
    await page.locator('[data-view="inventory"]').click();
    await page.waitForFunction(() => BlossomAudio.playing);
    await button.click();
    await page.reload(); await button.waitFor();
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => audioContexts.length), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: default on, first-interaction playback, music signal/headroom, all cues, mute, single context, hidden-tab pause/resume and saved preference');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
