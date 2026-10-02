(() => {
  'use strict';
  const STORAGE_KEY = 'blossom-audio-enabled';
  let enabled = true, context, master, music, effects, reverb, timer;
  let nextBeat = 0, beat = 0, generation = 0, lastCue = -Infinity;
  const voices = new Set();
  try { enabled = localStorage.getItem(STORAGE_KEY) !== 'false'; } catch { /* Private browsing still supports the switch. */ }
  const frequency = midi => 440 * 2 ** ((midi - 69) / 12);
  // An original, slow 16-bar phrase: warm keys, a quiet bass and airy upper notes.
  const chords = [[48,60,64,67,71],[45,60,64,67,69],[41,60,64,65,69],[43,59,62,67,69],
    [40,59,62,64,67],[45,60,64,67,71],[38,57,60,62,65],[43,59,62,67,69]];
  const melody = [[76,null,79,74],[76,72,null,71],[69,null,72,76],[74,71,null,67],
    [71,null,74,76],[79,76,null,72],[74,null,72,69],[71,74,null,72],
    [79,null,76,74],[72,76,null,79],[76,null,72,69],[74,79,null,74],
    [76,null,74,71],[72,71,null,69],[69,null,72,74],[71,null,67,null]];
  const secondsPerBeat = 60 / 72;
  function notify(error = '') {
    window.dispatchEvent(new CustomEvent('blossom-audio-change', { detail: { enabled, playing: Boolean(timer), error } }));
  }
  function save() { try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch { /* Optional preference persistence. */ } }
  function init() {
    if (context) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw Error('当前浏览器暂不支持音乐播放');
    context = new Audio();
    master = context.createGain(); master.gain.value = 0;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -16; limiter.knee.value = 20; limiter.ratio.value = 4;
    master.connect(limiter); limiter.connect(context.destination);
    music = context.createGain(); music.gain.value = .52; music.connect(master);
    effects = context.createGain(); effects.gain.value = .58; effects.connect(master);
    reverb = context.createConvolver();
    const impulse = context.createBuffer(2, Math.floor(context.sampleRate * 2.2), context.sampleRate);
    let seed = 117;
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        seed = (1664525 * seed + 1013904223) >>> 0;
        data[i] = (seed / 4294967296 * 2 - 1) * (1 - i / data.length) ** 3;
      }
    }
    reverb.buffer = impulse;
    const wet = context.createGain(); wet.gain.value = .2;
    music.connect(reverb); effects.connect(reverb); reverb.connect(wet); wet.connect(master);
    context.addEventListener('statechange', () => {
      if (context.state !== 'running' && timer) { clearInterval(timer); timer = null; clearVoices(); notify(); }
    });
  }
  function note(midi, at, duration, volume, bus, soft = false) {
    if (voices.size > 180) return;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(volume, at + (soft ? .32 : .018));
    envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
    envelope.gain.linearRampToValueAtTime(0, at + duration + .05);
    envelope.connect(bus);
    const harmonics = soft ? [[1,1]] : [[1,1],[2,.16],[3,.035]];
    let remaining = harmonics.length;
    for (const [multiple, strength] of harmonics) {
      const oscillator = context.createOscillator(), partial = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency(midi) * multiple;
      partial.gain.value = strength;
      oscillator.connect(partial); partial.connect(envelope);
      voices.add(oscillator);
      oscillator.onended = () => {
        voices.delete(oscillator); oscillator.disconnect(); partial.disconnect();
        if (--remaining === 0) envelope.disconnect();
      };
      oscillator.start(at); oscillator.stop(at + duration + .07);
    }
  }
  function clearVoices() {
    for (const voice of voices) { try { voice.stop(); } catch { /* Already finished. */ } }
    voices.clear();
  }
  function schedule() {
    if (!enabled || document.hidden || context.state !== 'running') return;
    // Resume gracefully if the browser throttled this tab; never replay a backlog.
    if (nextBeat < context.currentTime) nextBeat = context.currentTime + .05;
    while (nextBeat < context.currentTime + .35) {
      const bar = Math.floor(beat / 4) % 16, position = beat % 4, chord = chords[bar % 8];
      if (position === 0) {
        note(chord[0], nextBeat, 3.5, .10, music, true);
        chord.slice(1, 4).forEach(n => note(n, nextBeat, 4, .024, music, true));
      }
      note(chord[[1,3,2,4][position]], nextBeat + .02, 2.1, position % 2 ? .043 : .055, music);
      const top = melody[bar][position];
      if (top !== null) note(top, nextBeat + .06, 2.7, .047, music);
      nextBeat += secondsPerBeat; beat++;
    }
  }
  async function activate() {
    if (!enabled || document.hidden || timer) return;
    const ticket = generation;
    try {
      init();
      await context.resume();
      if (!enabled || document.hidden || ticket !== generation || timer || context.state !== 'running') return;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setValueAtTime(master.gain.value, context.currentTime);
      master.gain.linearRampToValueAtTime(.65, context.currentTime + .65);
      nextBeat = context.currentTime + .08;
      timer = setInterval(schedule, 150); schedule(); notify();
    } catch {
      // A later user gesture can resume an interrupted or autoplay-blocked context.
      notify('音乐暂未启动，请再点一次音乐按钮');
    }
  }
  function pause() {
    generation++;
    clearInterval(timer); timer = null;
    if (context) {
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setValueAtTime(0, context.currentTime);
      clearVoices();
      // Silence the reverb tail as well as the instruments when returning to the page.
      reverb.buffer = reverb.buffer;
      context.suspend().catch(() => {});
    }
    notify();
  }
  async function toggle() {
    enabled = !enabled; save();
    if (enabled) { notify(); await activate(); }
    else pause();
    return enabled;
  }
  function cue(kind) {
    if (!enabled || !timer || document.hidden || context.state !== 'running') return;
    const now = context.currentTime;
    if (kind === 'click' && now - lastCue < .12) return;
    lastCue = now;
    const phrases = {
      click: [79], summon: [60,64,67,72], reward: [72,76,79],
      legendary: [72,76,79,83,84], collect: [79,76,72], growth: [60,67,72,76,79,84]
    };
    (phrases[kind] || phrases.click).forEach((pitch, i) => note(pitch, now + .015 + i * .14,
      kind === 'click' ? .42 : 1.6, kind === 'click' ? .034 : .075, effects));
  }
  const unlock = event => {
    if (event.isTrusted && !event.target.closest?.('#sound')) activate();
  };
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => document.hidden ? pause() : activate());
  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', () => activate());
  window.BlossomAudio = { toggle, activate, cue, get enabled() { return enabled; }, get playing() { return Boolean(timer); } };
})();
