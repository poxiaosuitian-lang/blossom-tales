(() => {
  'use strict';
  const { ITEMS, ALL_ITEMS, RARITIES, DRAW_COST, fresh, namedItem, exhausted, availableRates } = window.DestinyEngine;
  const $ = id => document.getElementById(id);
  const host = window.HostSystem;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const nameOf = item => namedItem(item, host.config).name;
  const { growth } = window.BlossomGrowth;
  let state = { ...fresh(), balance: 0 }, busy = false, toastTimer;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('skip-animation').checked = reducedMotion;
  function toast(message) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('show');
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3600);
  }
  function card(item, quantity, index = 0) {
    const rarity = RARITIES[item.rarity];
    const name = escape(nameOf(item));
    const limit = item.limit ? (exhausted(item, state) ? ' · 已获得' : ' · 限1份') : '';
    const art = item.image ? `<img class="reward-image" src="assets/rewards/${item.image}" alt="${name}" loading="lazy">` : `<span class="item-symbol">${item.symbol}</span>`;
    return `<article class="reward-card" style="--rarity:${rarity.color};animation-delay:${index * .035}s"><span class="rarity-tag" title="${item.limit ? '每位玩家最多获得1份，获得后不再抽出' : rarity.label}">${item.rarity} · ${rarity.label}${item.image ? limit : ' · 旧版'}</span>${quantity ? `<span class="quantity">× ${quantity}</span>` : ''}${art}<h3 title="${name}">${name}</h3></article>`;
  }
  function render() {
    const growthState = growth(state.total);
    const hostCard = document.querySelector('.host-card');
    hostCard.dataset.stage = growthState.stage;
    hostCard.style.setProperty('--growth-color', growthState.color);
    $('host-level').textContent = `Lv. ${String(growthState.level).padStart(2, '0')}`;
    $('host-realm').textContent = growthState.name;
    $('host-growth-symbol').textContent = growthState.symbol;
    const growthHint = `每 10 次祈愿升 1 级 · 距下一级 ${growthState.remaining} 次`;
    const stageHint = growthState.nextStage ? `再祈愿 ${growthState.stageRemaining} 次进入「${growthState.nextStage}」` : '已抵达花境长明，等级继续成长';
    $('host-level').title = growthHint;
    $('host-realm').title = stageHint;
    $('host-growth').title = `${growthHint}；${stageHint}`;
    $('host-growth').setAttribute('aria-valuenow', growthState.progress);
    $('host-growth').setAttribute('aria-valuetext', `等级 ${growthState.level}，${growthHint}；${stageHint}`);
    $('host-growth-fill').style.width = `${growthState.progress * 10}%`;
    $('account-growth').textContent = `Lv. ${growthState.level} · ${growthState.name} · 距下一级 ${growthState.remaining} 次`;
    $('balance').textContent = state.balance.toLocaleString('zh-CN');
    $('total').textContent = state.total;
    $('inventory-count').textContent = Object.keys(state.inventory).length;
    const limitedOwned = exhausted(ITEMS[0], state);
    document.querySelector('.featured-name h3').textContent = nameOf(ITEMS[0]);
    document.querySelector('.featured h2').firstChild.textContent = nameOf(ITEMS[0]);
    document.querySelector('.featured-name p').textContent = limitedOwned ? '已获得 · 不再重复抽出' : '每位宿主限获 1 份';
    document.querySelector('.featured-reward-image').alt = nameOf(ITEMS[0]);
    $('pity-left').textContent = host.config?.guarantees === false ? '未启用' : 80 - state.pitySSR;
    document.querySelector('.pity').hidden = host.config?.guarantees === false || limitedOwned;
    $('pity-progress').style.width = (state.pitySSR / 80 * 100) + '%';
    $('draw-one').disabled = busy || !host.user;
    $('draw-ten').disabled = busy || !host.user;
    $('account-button').disabled = busy;
    $('draw-free').hidden = state.freeDraws === 0;
    $('draw-free').disabled = busy;
    $('draw-free').textContent = `免费祈愿 · 剩余 ${state.freeDraws} 次`;
    $('collection-summary').textContent = `${Object.keys(state.inventory).length} 种结果 · 共 ${state.total} 次`;
    const collected = ALL_ITEMS.filter(i => state.inventory[i.id]);
    $('inventory-grid').innerHTML = collected.length ? collected.map(i => card(i, state.inventory[i.id])).join('') : '<div class="empty-state"><span>✧</span><h3>宝库静候第一份机缘</h3><p>完成祈愿后，抽中的奖励和趣味结果会记录在这里。</p><button data-back>前往祈愿 ↗</button></div>';
    $('history-list').innerHTML = state.history.length ? state.history.map(h => {
      const item = ALL_ITEMS.find(i => i.id === h.id), rarity = RARITIES[item.rarity];
      const art = item.image ? `<img class="history-image" src="assets/rewards/${item.image}" alt="">` : `<span class="item-symbol">${item.symbol}</span>`;
      return `<div class="history-row" style="--rarity:${rarity.color}">${art}<b>${escape(nameOf(item))}${item.image ? '' : ' · 旧版'}</b><span class="rarity-tag">${item.rarity} · ${rarity.label}</span><small>第 ${h.number} 次 · ${new Date(h.time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div>`;
    }).join('') : '<div class="empty-state"><span>◷</span><h3>命运的篇章尚未写下</h3><p>每一次祈愿，都会留下回响。</p><button data-back>开启第一次祈愿 ↗</button></div>';
  }
  function showView(name) {
    if (busy) return;
    for (const view of ['summon', 'inventory', 'history']) $(`${view}-view`).hidden = view !== name;
    document.querySelectorAll('.tab').forEach(button => {
      button.classList.toggle('active', button.dataset.view === name);
      if (button.dataset.view === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
  }
  function modal(title, body, footer = '', mode = '') {
    $('modal').dataset.mode = mode;
    $('modal-title').textContent = title; $('modal-content').innerHTML = body; $('modal-footer').innerHTML = footer;
    if (!$('modal').open) $('modal').showModal();
  }
  function playSummonAnimation(results, count, useFree = false) {
    const cinematic = $('summon-cinematic');
    const rank = results.some(i => i.rarity === 'SSR') ? 'SSR' : results.some(i => i.rarity === 'SR') ? 'SR' : 'R';
    cinematic.dataset.phase = 'offering';
    cinematic.style.setProperty('--summon-color', RARITIES[rank].color);
    $('cinematic-status').textContent = '以花为引，叩问天命';
    $('cinematic-detail').textContent = useFree ? '免费祈愿已开启，不消耗大红花' : `${count * DRAW_COST} 朵大红花正在汇入法阵`;
    $('cinematic-flowers').innerHTML = Array.from({ length: 10 }, (_, i) => {
      const angle = i * Math.PI / 5;
      return `<img src="assets/red-flower.png" alt="" style="--x:${Math.cos(angle) * 190}px;--y:${Math.sin(angle) * 190}px;--delay:${i * 65}ms;--turn:${i * 36}deg">`;
    }).join('');
    cinematic.showModal();
    window.BlossomAudio.cue('summon');
    return new Promise(resolve => {
      let done = false;
      const timers = [];
      const finish = () => {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        $('skip-cinematic').removeEventListener('click', finish);
        cinematic.removeEventListener('cancel', cancel);
        cinematic.removeEventListener('close', finish);
        cinematic.close();
        resolve();
      };
      const cancel = event => { event.preventDefault(); finish(); };
      $('skip-cinematic').addEventListener('click', finish);
      cinematic.addEventListener('cancel', cancel);
      cinematic.addEventListener('close', finish);
      timers.push(setTimeout(() => {
        cinematic.dataset.phase = 'charging';
        $('cinematic-status').textContent = '诸天之门，正在开启';
        $('cinematic-detail').textContent = '命运的回响，正在向你靠近';
      }, 1500));
      timers.push(setTimeout(() => {
        cinematic.dataset.phase = 'reveal';
        $('cinematic-status').textContent = rank === 'SSR' ? '金光降临 · 天命所归' : rank === 'SR' ? '紫气东来 · 机缘已至' : '星光回应 · 机缘已至';
        $('cinematic-detail').textContent = '叮！宿主的祈愿已获得回应';
        window.BlossomAudio.cue(rank === 'SSR' ? 'legendary' : 'reward');
      }, 3000));
      timers.push(setTimeout(finish, 4400));
    });
  }
  function celebrateGrowth(next) {
    const ceremony = $('growth-ceremony');
    ceremony.style.setProperty('--growth-color', next.color);
    $('growth-title').textContent = next.name;
    $('growth-emblem').textContent = next.symbol;
    $('growth-description').textContent = `累计 ${next.total} 次祈愿 · Lv. ${next.level}。你的花笺，迎来了崭新的一页。`;
    $('growth-petals').innerHTML = Array.from({ length: 24 }, (_, index) => {
      const angle = index * Math.PI / 12;
      return `<i style="--x:${Math.cos(angle) * 310}px;--y:${Math.sin(angle) * 310}px;--turn:${index * 47}deg;--delay:${index * 35}ms">${index % 3 ? '✧' : '❀'}</i>`;
    }).join('');
    return new Promise(resolve => {
      const finish = () => ceremony.close();
      const cleanup = () => {
        $('growth-continue').removeEventListener('click', finish);
        $('growth-petals').replaceChildren();
        resolve();
      };
      $('growth-continue').addEventListener('click', finish);
      ceremony.addEventListener('close', cleanup, { once: true });
      ceremony.showModal();
      window.BlossomAudio.cue('growth');
    });
  }
  async function summon(count, useFree = false) {
    if (count !== 1 && count !== 10) throw new Error('祈愿次数必须为 1 或 10');
    if (busy) return { error: '召唤进行中' };
    if (!host.user) return { error: '请先绑定宿主' };
    if (useFree && (count !== 1 || state.freeDraws < 1)) { toast('没有可用的免费祈愿次数'); return { error: '没有免费次数' }; }
    if (!useFree && state.balance < count * DRAW_COST) { toast(`大红花不足，本次祈愿需要 ${count * DRAW_COST} 朵。`); return { error: '大红花不足' }; }
    busy = true; host.drawing = true; render();
    const previousGrowth = growth(state.total);
    const drawingUser = host.user.id;
    $('system-message').innerHTML = '诸天宝库正在回应……<br>属于你的机缘，即将显现。';
    try {
      const output = await host.api('/api/draw', { count, useFree, requestId: host.requestId() });
      host.accept(output); state = output.state; render();
      if (!$('skip-animation').checked && !reducedMotion) {
        await playSummonAnimation(output.results, count, useFree);
      }
      const nextGrowth = growth(state.total);
      const advanced = nextGrowth.stage > previousGrowth.stage;
      if (advanced && !$('skip-animation').checked && !reducedMotion) await celebrateGrowth(nextGrowth);
      if (host.user?.id !== drawingUser) return { error: '宿主已退出' };
      const legendary = output.results.some(i => i.rarity === 'SSR');
      window.BlossomAudio.cue(legendary ? 'legendary' : 'reward');
      $('modal-eyebrow').textContent = legendary ? 'A LEGEND HAS ANSWERED' : 'YOUR DESTINY HAS ARRIVED';
      const flowersAdded = output.results.reduce((sum, item) => sum + (item.flowers || 0), 0);
      const freeAdded = output.results.reduce((sum, item) => sum + (item.freeDraws || 0), 0);
      const effects = `${flowersAdded ? ` 大红花 +${flowersAdded}，已到账。` : ''}${freeAdded ? ` 免费祈愿 +${freeAdded} 次，点击免费祈愿使用。` : ''}`;
      const growthNotice = nextGrowth.level > previousGrowth.level ? `<p class="growth-result" style="--growth-color:${nextGrowth.color}">${advanced ? '✧ 花笺晋阶' : '✧ 花笺成长'} · Lv. ${previousGrowth.level} → Lv. ${nextGrowth.level} · ${nextGrowth.name}</p>` : '';
      modal(legendary ? '金光降临 · 传说已至' : '叮！祈愿结果已揭晓', `${growthNotice}<p class="modal-note">${count === 10 ? '十次祈愿已完成' : '本次祈愿已完成'}，结果已存入宝库。${effects}</p><div class="${count === 1 ? 'single-result' : 'reward-grid'}">${output.results.map((item, i) => card(item, 0, i)).join('')}</div>`, '<button class="draw-button ten" id="accept-rewards"><span>收下结果</span></button>', count === 10 ? 'result-ten' : 'result-single');
      $('accept-rewards').onclick = () => { window.BlossomAudio.cue('collect'); $('modal').close(); };
      const highest = output.results.find(i => i.rarity === 'SSR') || output.results.find(i => i.rarity === 'SR') || output.results[0];
      $('system-message').textContent = `叮！抽中${RARITIES[highest.rarity].label}结果「${nameOf(highest)}」。${effects}`;
      return { rewards: output.results.map(i => ({ name: nameOf(i), rarity: i.rarity })), balance: state.balance, freeDraws: state.freeDraws };
    } catch (error) { toast(error.message); return { error: error.message }; }
    finally { busy = false; host.drawing = false; document.querySelector('.summoning').classList.remove('is-drawing'); render(); }
  }
  $('draw-one').onclick = () => summon(1);
  $('draw-ten').onclick = () => summon(10);
  $('draw-free').onclick = () => summon(1, true);
  document.querySelectorAll('.tab').forEach(button => button.onclick = () => showView(button.dataset.view));
  document.addEventListener('click', event => { if (event.target.closest('[data-back]')) showView('summon'); if (event.target.closest('[data-pool]')) $('pool-button').click(); });
  $('close-modal').onclick = () => $('modal').close();
  $('modal').addEventListener('click', event => { if (event.target === $('modal')) { const bounds = $('modal').getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $('modal').close(); } });
  $('pool-button').onclick = () => { $('modal-eyebrow').textContent = 'BLOSSOM TALES · GIFTS IN BLOOM'; modal('花间好礼', '<p class="modal-note">九份奇遇，静候相逢。传说奖励每人限获1份，已获得后不再抽出；概率详见拾花手册。</p><div class="reward-grid pool-grid">' + ITEMS.map(i => card(i)).join('') + '</div>', '', 'pool'); };
  $('rules-button').onclick = () => {
    $('modal-eyebrow').textContent = 'BLOSSOM TALES · FIELD GUIDE';
    const config = host.config;
    if (!config) return;
    const ratesForHost = availableRates(state, config);
    const rates = ITEMS.map(item => { const name = escape(nameOf(item)); return `<article class="handbook-rate" style="--rarity:${RARITIES[item.rarity].color}"><img src="assets/rewards/${item.image}" alt=""><div><small>${RARITIES[item.rarity].label}${item.limit ? exhausted(item, state) ? ' · 已获得' : ' · 每人限1份' : ''}</small><b aria-label="${name}" title="${name}"><span class="rate-full-name">${name}</span><span class="rate-compact-name" aria-hidden="true">${name}</span></b></div><strong>${Number(ratesForHost[item.id].toFixed(2))}<small>%</small></strong></article>`; }).join('');
    const promise = config.guarantees
      ? (exhausted(ITEMS[0], state) ? '传说已获得，不再抽出，传说保底结束；连续9抽未出史诗，第10抽按史诗权重补足。' : '连续9抽未出史诗及以上，第10抽至少史诗；连续79抽未出传说，第80抽必得。传说优先，每人限1份。')
      : '每次按基础概率抽取。保底计数仍累积并封顶，重新开启后按已有计数触发。';
    modal('拾花手册', `<div class="handbook">
      <div class="handbook-costs"><div><span>拾花一次</span><strong>10 <small>朵</small></strong></div><div><span>拾花十次</span><strong>100 <small>朵</small></strong></div><div><span>初始红花</span><strong>0 <small>朵</small></strong></div></div>
      <section class="handbook-pool"><div class="handbook-section-title"><h3>花间奇遇</h3><span>9 种奖励 · 当前宿主基础概率</span></div><div class="handbook-rates">${rates}</div><p class="handbook-rate-note">已获限量奖励概率归零，其余按原权重分配；保底另行生效。</p></section>
      <div class="handbook-notes"><section><h3>✧ 好运约定 <span class="handbook-badge">保底已${config.guarantees ? '开启' : '关闭'}</span></h3><p>${promise}</p></section><section><h3>✿ 花朵与收藏</h3><p>红花奖励直接到账；“${escape(nameOf(ITEMS.find(item => item.id === 'retry')))}”赠1次免费祈愿，也计入保底。刷新不重复发奖。礼品与互动结果收入宝库，由参与者安排兑现。</p></section></div>
      <p class="handbook-keepsake">每 10 次祈愿升 1 级，每 100 次晋阶，至「花境长明」；免费祈愿也计入成长。</p>
    </div>`, '<span class="handbook-signature">拾一朵花，遇一份幸运。</span><button class="blossom-action" data-pool>看看花间好礼 <span aria-hidden="true">↗</span></button>', 'handbook');
  };
  function syncAudio() {
    const enabled = window.BlossomAudio.enabled;
    $('sound').style.color = enabled ? '#f1d493' : '';
    $('sound').setAttribute('aria-label', enabled ? '关闭音乐与音效' : '开启音乐与音效');
    $('sound').title = `${enabled ? '关闭' : '开启'}音乐与音效 · 花间晴昼`;
    $('sound').setAttribute('aria-pressed', String(enabled));
    $('sound').classList.toggle('music-playing', window.BlossomAudio.playing);
  }
  window.addEventListener('blossom-audio-change', event => { syncAudio(); if (event.detail.error) toast(event.detail.error); });
  $('sound').onclick = async () => {
    const enabled = await window.BlossomAudio.toggle();
    syncAudio();
    if (!enabled) toast('音乐与音效已关闭');
    else if (window.BlossomAudio.playing) { toast('花间晴昼 · 轻柔音乐与音效已开启'); window.BlossomAudio.cue('reward'); }
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled || button.closest('#auth-screen') || ['sound', 'accept-rewards', 'draw-one', 'draw-ten', 'draw-free'].includes(button.id)) return;
    window.BlossomAudio.cue('click');
  });
  syncAudio();
  function syncFullscreen() {
    const active = Boolean(document.fullscreenElement);
    for (const id of ['fullscreen', 'entry-fullscreen']) {
      $(id).setAttribute('aria-pressed', String(active));
      $(id).setAttribute('aria-label', active ? '退出全屏' : '进入全屏');
      $(id).title = active ? '退出全屏' : '进入全屏';
    }
  }
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch {
      if (!$('auth-screen').hidden) $('auth-message').textContent = '当前浏览器暂不支持全屏，请使用浏览器的全屏功能。';
      else toast('当前浏览器暂不支持全屏。');
    }
  }
  $('fullscreen').onclick = toggleFullscreen;
  $('entry-fullscreen').onclick = toggleFullscreen;
  document.addEventListener('fullscreenchange', syncFullscreen);
  syncFullscreen();
  for (let i = 0; i < 32; i++) { const dot = document.createElement('i'); dot.className = 'particle'; dot.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation-duration:${6 + Math.random() * 10}s;animation-delay:-${Math.random() * 16}s`; $('particles').appendChild(dot); }
  window.addEventListener('host-change', event => {
    state = event.detail?.state || { ...fresh(), balance: 0 };
    if (!event.detail) showView('summon');
    render();
    if ($('modal').open && $('modal').dataset.mode === 'pool') $('pool-button').click();
    if ($('modal').open && $('modal').dataset.mode === 'handbook') $('rules-button').click();
  });
  if (document.modelContext?.registerTool) {
    const lifecycle = new AbortController();
    const register = tool => { try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Optional browser integration. */ } };
    register({ name: 'read_destiny_status', description: 'Read the current local red-flower balance and guarantee counters.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => ({ balance: state.balance, freeDraws: state.freeDraws, total: state.total, legendaryWithin: host.config?.guarantees === false || exhausted(ITEMS[0], state) ? null : 80 - state.pitySSR, epicWithin: host.config?.guarantees === false ? null : 10 - state.pitySR }) });
    register({ name: 'complete_destiny_summon', description: 'Spend local virtual red flowers (10 per summon) and complete one or ten summons, displaying and saving the rewards.', inputSchema: { type: 'object', properties: { count: { type: 'integer', enum: [1, 10] }, useFree: { type: 'boolean' } }, required: ['count'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: input => { if (!input || (input.count !== 1 && input.count !== 10)) throw new Error('count must be 1 or 10'); if (input.useFree !== undefined && typeof input.useFree !== 'boolean') throw new Error('useFree must be boolean'); return summon(input.count, input.useFree === true); } });
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  }
  render();
})();
