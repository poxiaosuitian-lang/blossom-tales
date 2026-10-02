(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const requestId = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), n => n.toString(16).padStart(2, '0')).join('');
  let current = null, epoch = 0, registering = false, players = [], logs = [], draftVersion = 0, adminBusy = false, refreshing = false, authenticating = false;
  let registrationEnabled = true, availabilityBusy = false, settingsVersion = 0, prayerPage = 1, prayerPages = 1, prayerSequence = 0;
  const host = window.HostSystem = { drawing: false, get user() { return current?.user; }, get config() { return current?.config; }, api, accept, requestId };
  function status(id, message, good = false) { $(id).textContent = message; $(id).classList.toggle('success', good); }
  function unbind(message = '') {
    current = null; epoch++; prayerSequence++;
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    document.body.classList.add('auth-active');
    document.body.classList.remove('world-entering');
    $('auth-screen').classList.remove('is-entering');
    $('auth-screen').hidden = false; document.querySelector('.app-shell').inert = true;
    $('auth-screen').inert = false;
    authMode(false);
    $('account-button').textContent = '宿主绑定';
    $('auth-password').value = ''; $('auth-confirm').value = ''; status('auth-message', message);
    window.dispatchEvent(new CustomEvent('host-change', { detail: null }));
  }
  function accept(data) {
    if (!data.user || !data.state) return;
    const entering = !current;
    current = data;
    $('auth-screen').hidden = true; document.querySelector('.app-shell').inert = false;
    document.body.classList.remove('auth-active');
    if (entering) {
      document.body.classList.add('world-entering');
      history.replaceState(null, '', data.user.role === 'admin' ? '#/admin' : '#/home');
      document.title = data.user.role === 'admin' ? '系统管理 · 拾花物语' : '万界祈愿 · 拾花物语';
      setTimeout(() => document.body.classList.remove('world-entering'), 850);
    }
    const accountButton = $('account-button');
    accountButton.classList.toggle('flower-entry', data.user.role !== 'admin');
    if (data.user.role === 'admin') accountButton.textContent = '系统管理';
    else {
      if (!accountButton.querySelector('.flower-entry-name')) accountButton.innerHTML = '<span class="flower-entry-seal" aria-hidden="true">✿</span><span class="flower-entry-copy"><small>我的花笺</small><b class="flower-entry-name"></b></span><span class="flower-entry-arrow" aria-hidden="true">›</span>';
      accountButton.querySelector('.flower-entry-name').textContent = data.user.nickname;
    }
    $('account-button').title = data.user.role === 'admin' ? '打开系统管理' : '翻开 ' + data.user.nickname + ' 的宿主花笺';
    $('account-button').setAttribute('aria-label', $('account-button').title);
    $('host-name').textContent = data.user.nickname;
    $('host-role').textContent = data.user.role === 'admin' ? '系统本身 ✦' : '命运之子 ✦';
    renderAccount();
    window.dispatchEvent(new CustomEvent('host-change', { detail: data }));
  }
  async function api(url, data) {
    if (data !== undefined) epoch++;
    let response;
    try {
      response = await fetch(url, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    } catch { throw new Error('连接系统失败，请重新运行「启动.bat」；操作结果可刷新核对。'); }
    finally { if (data !== undefined) epoch++; }
    let result; try { result = await response.json(); } catch { throw new Error('请使用「启动.bat」打开系统。'); }
    if (!response.ok) {
      if (response.status === 401 && current && !['/api/login', '/api/register'].includes(url)) unbind('叮！宿主连接已中断，请重新接入。');
      throw Object.assign(new Error(result.error || '操作失败，请重试'), { status: response.status });
    }
    return result;
  }
  function authMode(register) {
    if (authenticating) return;
    register = register && registrationEnabled;
    registering = register;
    $('auth-screen').dataset.mode = register ? 'register' : 'login';
    history.replaceState(null, '', register ? '#/register' : '#/login');
    document.title = register ? '初次绑定 · 拾花物语' : '宿主接入 · 拾花物语';
    $('auth-login-tab').classList.toggle('active', !register); $('auth-register-tab').classList.toggle('active', register);
    $('auth-login-tab').setAttribute('aria-pressed', String(!register)); $('auth-register-tab').setAttribute('aria-pressed', String(register));
    $('auth-nickname-row').hidden = !register; $('auth-confirm-row').hidden = !register;
    $('auth-nickname').required = register; $('auth-confirm').required = register;
    $('auth-password').autocomplete = register ? 'new-password' : 'current-password';
    $('auth-submit-label').textContent = register ? '确认绑定' : '唤醒系统';
    $('auth-username').placeholder = register ? '3–24 位字母、数字或下划线' : '输入宿主编号';
    $('auth-password').placeholder = register ? '设定系统密钥 · 至少 6 位' : '输入系统密钥 · 至少 6 位';
    $('entry-whisper').textContent = register ? '叮！发现新宿主，是否开启拾花物语？' : '叮！宿主，欢迎回到你的大学生活。';
    $('entry-note').textContent = register ? '建立宿主档案，开启你的校园奇遇' : '接入宿主档案，继续你的校园奇遇';
    status('auth-message', '');
  }
  $('auth-login-tab').onclick = () => authMode(false); $('auth-register-tab').onclick = () => authMode(true);
  function registrationState(enabled) {
    registrationEnabled = enabled;
    $('auth-register-tab').disabled = authenticating || !enabled;
    $('registration-notice').hidden = enabled;
    if (!current && !enabled && registering && !authenticating) authMode(false);
  }
  async function refreshRegistration() {
    if (availabilityBusy) return;
    availabilityBusy = true;
    try { const data = await api('/api/registration'); registrationState(data.registrationEnabled); }
    catch { /* Login remains available; registration is always checked by the server. */ }
    finally { availabilityBusy = false; }
  }
  $('auth-form').onsubmit = async event => {
    event.preventDefault();
    if (authenticating) return;
    if (registering && $('auth-password').value !== $('auth-confirm').value) return status('auth-message', '叮！两次密钥不一致，请重新确认。');
    authenticating = true;
    $('auth-submit').disabled = true;
    $('auth-login-tab').disabled = true; $('auth-register-tab').disabled = true;
    $('auth-form').setAttribute('aria-busy', 'true');
    status('auth-message', registering ? '正在建立宿主档案……' : '正在核验宿主身份……');
    const mode = registering;
    try {
      const data = await api(mode ? '/api/register' : '/api/login', { username: $('auth-username').value, password: $('auth-password').value, ...(mode ? { nickname: $('auth-nickname').value } : {}) });
      $('auth-password').value = ''; $('auth-confirm').value = '';
      status('auth-message', mode ? '叮！绑定成功，拾花物语为你开启。' : '叮！身份确认，欢迎宿主归来。', true);
      $('auth-screen').classList.add('is-entering');
      $('auth-screen').inert = true;
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(resolve => setTimeout(resolve, 700));
      accept(data);
      $('auth-screen').classList.remove('is-entering');
      $('auth-screen').inert = false;
      if (data.user.role === 'admin') await openAdmin();
      else $('account-button').focus({ preventScroll: true });
    } catch (error) { status('auth-message', error.message); }
    finally { authenticating = false; $('auth-submit').disabled = false; $('auth-login-tab').disabled = false; registrationState(registrationEnabled); $('auth-form').removeAttribute('aria-busy'); if (!current) refreshRegistration(); }
  };
  async function logout() {
    if (host.drawing || adminBusy) return;
    try { await api('/api/logout', {}); unbind('系统已待机，宿主档案已保留。'); } catch (error) { status('account-message', error.message); status('admin-message', error.message); }
  }
  $('logout-button').onclick = logout; $('admin-logout').onclick = logout;
  function renderAccount() {
    if (!current) return;
    $('account-name').textContent = current.user.nickname;
    $('account-username').textContent = '宿主编号 · ' + current.user.username;
    $('account-flowers').textContent = current.state.balance.toLocaleString('zh-CN');
    $('account-free').textContent = current.state.freeDraws.toLocaleString('zh-CN');
  }
  $('account-button').onclick = async () => {
    if (host.drawing) return;
    if (!current) return unbind();
    if (current.user.role === 'admin') return openAdmin();
    renderAccount();
    status('account-message', ''); $('account-dialog').showModal();
  };
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.onclick = () => button.closest('dialog').close());
  const date = time => new Date(time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  function renderPlayers() {
    const query = $('player-search').value.trim().toLowerCase();
    const visible = players.filter(p => (p.nickname + ' ' + p.username).toLowerCase().includes(query));
    $('player-count').textContent = players.length;
    $('flower-count').textContent = players.reduce((n, p) => n + p.balance, 0).toLocaleString();
    $('players-list').innerHTML = visible.length ? visible.map(p => `<article class="player-card"><div class="player-avatar">${escape(p.nickname.slice(0, 1))}</div><div class="player-info"><h3>${escape(p.nickname)}</h3><small>@${escape(p.username)} · 绑定于 ${date(p.createdAt)}</small><p><span>大红花 <b>${p.balance}</b></span><span>祈愿 <b>${p.total}</b> 次</span><span>免费 <b>${p.freeDraws}</b> 次</span></p></div><div class="player-card-actions"><button class="account-action" data-prayer-player="${p.id}">祈愿记录</button><button class="account-action" data-grant-player="${p.id}">发放红花</button></div></article>`).join('') : '<div class="admin-empty">' + (players.length ? '没有匹配的宿主' : '还没有宿主绑定。玩家注册后会显示在这里。') + '</div>';
    const selected = $('grant-player').value;
    $('grant-player').innerHTML = '<option value="">选择接收红花的宿主</option>' + players.map(p => `<option value="${p.id}">${escape(p.nickname)} (@${escape(p.username)}) · ${p.balance} 朵</option>`).join('');
    if (players.some(p => String(p.id) === selected)) $('grant-player').value = selected;
    $('grant-submit').disabled = adminBusy || players.length === 0;
  }
  $('player-search').oninput = renderPlayers;
  $('players-list').onclick = event => {
    const historyButton = event.target.closest('[data-prayer-player]');
    if (historyButton) { $('prayer-player').value = historyButton.dataset.prayerPlayer; prayerPage = 1; selectAdminTab('prayers'); return; }
    const button = event.target.closest('[data-grant-player]');
    if (button) { $('grant-player').value = button.dataset.grantPlayer; $('grant-amount').focus(); }
  };
  function configForm(config) {
    draftVersion = config.version;
    $('probability-fields').innerHTML = window.DestinyEngine.ITEMS.map(item => `<div class="probability-row" role="group" aria-label="${escape(item.name)}设置"><img src="assets/rewards/${item.image}" alt=""><span><small>${item.rarity} · ${window.DestinyEngine.RARITIES[item.rarity].label}${item.limit ? ' · 每人限1份' : ''}</small><input class="reward-name-input" aria-label="${escape(item.name)}名称" title="奖励名称 · 最多24字${item.limit ? ' · 每位玩家限获1份' : ''}" data-reward-name="${item.id}" maxlength="24" value="${escape(window.DestinyEngine.namedItem(item, config).name)}" required></span><span class="rate-input"><input aria-label="${escape(item.name)}概率" data-rate="${item.id}" type="number" min="0" max="100" step="0.01" value="${config.rates[item.id]}" required> %</span></div>`).join('');
    $('guarantees-enabled').checked = config.guarantees;
    updateTotal(); status('probability-message', '');
  }
  function updateTotal() {
    const total = [...document.querySelectorAll('[data-rate]')].reduce((n, el) => n + Math.round(Number(el.value) * 100), 0) / 100;
    $('probability-total').textContent = total.toFixed(2) + '%';
    $('probability-total').classList.toggle('invalid', total !== 100);
  }
  $('probability-fields').oninput = updateTotal;
  function renderLogs() {
    $('admin-logs').innerHTML = logs.length ? logs.map(log => {
      const title = log.kind === 'grant' ? escape(log.nickname) + ' · 红花 +' + log.detail.amount : log.kind === 'settings' ? '新宿主注册已' + (log.detail.after.registrationEnabled ? '开放' : '关闭') : '奖池名称与概率已更新';
      const detail = log.kind === 'grant' ? escape(log.detail.note || '系统发放') + ' · @' + escape(log.username) : log.kind === 'settings' ? '系统设置版本 ' + log.detail.after.version : '规则版本 ' + log.detail.after.version + ' · 保底' + (log.detail.after.guarantees ? '开启' : '关闭');
      return `<article class="audit-row"><span>${log.kind === 'grant' ? '❀' : '◇'}</span><div><b>${title}</b><p>${detail}</p></div><time>${date(log.time)}</time></article>`;
    }).join('') : '<div class="admin-empty">暂无管理记录</div>';
  }
  function settingsForm(settings) {
    settingsVersion = settings.version;
    $('registration-enabled').checked = settings.registrationEnabled;
    registrationState(settings.registrationEnabled);
    describeRegistration();
  }
  function describeRegistration() { $('registration-state').textContent = $('registration-enabled').checked ? '允许新宿主建立绑定 · 保存后生效' : '暂停新宿主绑定 · 保存后生效'; }
  $('registration-enabled').onchange = describeRegistration;
  function renderPrayerPlayers() {
    const selected = $('prayer-player').value;
    $('prayer-player').innerHTML = '<option value="">全部宿主</option>' + players.map(p => `<option value="${p.id}">${escape(p.nickname)} (@${escape(p.username)})</option>`).join('');
    if (players.some(p => String(p.id) === selected)) $('prayer-player').value = selected;
  }
  async function loadPrayers() {
    const sequence = ++prayerSequence;
    const playerId = $('prayer-player').value;
    $('prayer-prev').disabled = true; $('prayer-next').disabled = true;
    $('admin-prayers').innerHTML = ''; $('prayer-summary').textContent = '正在读取记录'; status('prayer-message', '正在读取祈愿记录……');
    try {
      const data = await api(`/api/admin/prayers?page=${prayerPage}&playerId=${encodeURIComponent(playerId)}`);
      if (sequence !== prayerSequence || current?.user.role !== 'admin') return;
      prayerPage = data.page; prayerPages = data.pages;
      $('admin-prayers').innerHTML = data.records.length ? data.records.map(record => {
        const rarity = window.DestinyEngine.RARITIES[record.rarity];
        const kind = record.useFree === null ? '历史祈愿' : record.useFree ? '免费祈愿' : record.drawCount === 10 ? '十连祈愿' : '单次祈愿';
        return `<article class="admin-prayer-row"><div class="prayer-host"><b>${escape(record.nickname)}</b><small>@${escape(record.username)}</small></div><div class="prayer-reward"><b style="color:${rarity?.color || '#dfedff'}">${escape(record.reward)}</b><small>${escape(rarity?.label || '历史奖励')} · 第 ${record.number} 次</small></div><span class="prayer-kind">${kind}</span><time>${new Date(record.time).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time></article>`;
      }).join('') : '<div class="admin-empty">这段花间故事还未开始，暂无祈愿记录。</div>';
      $('prayer-summary').textContent = `共 ${data.total} 条 · 第 ${data.page} / ${data.pages} 页`;
      $('prayer-prev').disabled = prayerPage <= 1; $('prayer-next').disabled = prayerPage >= prayerPages;
      status('prayer-message', '');
    } catch (error) { if (sequence === prayerSequence) { status('prayer-message', error.message); $('prayer-summary').textContent = '读取失败，请刷新重试'; } }
  }
  $('prayer-player').onchange = () => { prayerPage = 1; loadPrayers(); };
  $('prayer-refresh').onclick = () => loadPrayers();
  $('prayer-prev').onclick = () => { if (prayerPage > 1) { prayerPage--; loadPrayers(); } };
  $('prayer-next').onclick = () => { if (prayerPage < prayerPages) { prayerPage++; loadPrayers(); } };
  $('system-settings-form').onsubmit = async event => {
    event.preventDefault(); if (adminBusy) return;
    adminBusy = true; $('system-settings-save').disabled = true;
    status('settings-message', '正在保存……');
    try {
      const data = await api('/api/admin/settings', { registrationEnabled: $('registration-enabled').checked, version: settingsVersion });
      settingsForm(data.settings);
      status('settings-message', data.settings.registrationEnabled ? '已保存，新宿主注册已开放。' : '已保存，新宿主注册已关闭，已有宿主仍可接入。', true);
      await loadAdmin(false);
    } catch (error) { status('settings-message', error.message); }
    finally { adminBusy = false; $('system-settings-save').disabled = false; }
  };
  async function loadAdmin(resetConfig = true) {
    const data = await api('/api/admin/players');
    if (current?.user.role !== 'admin') return;
    players = data.players; logs = data.logs; current.config = data.config;
    renderPlayers(); renderLogs(); renderPrayerPlayers();
    if (resetConfig) { configForm(data.config); settingsForm(data.settings); status('settings-message', ''); }
    if (!$('admin-prayers-panel').hidden) await loadPrayers();
  }
  async function openAdmin() {
    if (!$('admin-dialog').open) $('admin-dialog').showModal();
    status('admin-message', '正在读取宿主档案……');
    try { await loadAdmin(); status('admin-message', ''); } catch (error) { status('admin-message', error.message); }
  }
  $('admin-refresh').onclick = openAdmin;
  function selectAdminTab(name) {
    $('admin-dialog').dataset.tab = name;
    document.querySelectorAll('[data-admin-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.adminTab === name);
      $('admin-' + button.dataset.adminTab + '-panel').hidden = button.dataset.adminTab !== name;
    });
    if (name === 'prayers') loadPrayers();
  }
  document.querySelectorAll('[data-admin-tab]').forEach(button => button.onclick = () => selectAdminTab(button.dataset.adminTab));
  $('grant-form').onsubmit = async event => {
    event.preventDefault(); if (adminBusy) return;
    adminBusy = true; $('grant-submit').disabled = true; status('grant-message', '正在发放……');
    const recipient = players.find(p => p.id === Number($('grant-player').value));
    const amount = Number($('grant-amount').value);
    try {
      await api('/api/admin/grant', { playerId: Number($('grant-player').value), amount, note: $('grant-note').value, requestId: requestId() });
      status('grant-message', `已向 ${recipient?.nickname || '宿主'} 发放 ${amount} 朵大红花。`, true);
      await loadAdmin(false);
    } catch (error) { status('grant-message', error.message); }
    finally { adminBusy = false; $('grant-submit').disabled = players.length === 0; }
  };
  $('probability-form').onsubmit = async event => {
    event.preventDefault(); if (adminBusy) return;
    const rates = Object.fromEntries([...document.querySelectorAll('[data-rate]')].map(el => [el.dataset.rate, Number(el.value)]));
    const names = Object.fromEntries([...document.querySelectorAll('[data-reward-name]')].map(el => [el.dataset.rewardName, el.value.trim()]));
    adminBusy = true; $('probability-save').disabled = true;
    try {
      const data = await api('/api/admin/config', { rates, names, guarantees: $('guarantees-enabled').checked, version: draftVersion });
      current.config = data.config; draftVersion = data.config.version;
      status('probability-message', '已保存名称与概率，名称同步所有页面，新概率用于后续祈愿。', true);
      window.dispatchEvent(new CustomEvent('host-change', { detail: current }));
      await loadAdmin(false);
    } catch (error) { status('probability-message', error.message); }
    finally { adminBusy = false; $('probability-save').disabled = false; }
  };
  async function refresh(initial = false) {
    if (refreshing || authenticating || host.drawing || (!initial && !current)) return;
    refreshing = true; const version = epoch;
    try { const data = await api('/api/me'); if (version === epoch && !host.drawing && !authenticating) { accept(data); if (initial && data.user.role === 'admin') await openAdmin(); } }
    catch (error) { if (initial && version === epoch && !authenticating) status('auth-message', error.status === 401 ? '' : location.protocol === 'file:' ? '请双击「启动.bat」打开系统。' : error.message); }
    finally { refreshing = false; $('auth-screen').dataset.ready = 'true'; }
  }
  setInterval(() => { if (!document.hidden) { if (current) refresh(); else refreshRegistration(); } }, 5000);
  window.addEventListener('focus', () => { if (current) refresh(); else refreshRegistration(); });
  document.querySelector('.app-shell').inert = true;
  authMode(location.hash === '#/register');
  for (let i = 0; i < 84; i++) {
    const star = document.createElement('i');
    let x = (i * 37 + 11) % 100;
    if (x > 38 && x < 62) x += i % 2 ? 28 : -28;
    star.style.cssText = `--x:${x}%;--y:${(i * 23 + 7) % 100}%;--size:${2 + i % 4}px;--duration:${6 + i % 8}s;--delay:-${i * .83}s`;
    $('entry-stars').appendChild(star);
  }
  const meteorOrigins = [[-10, 8], [4, 28], [12, 53], [68, 5], [76, 23], [88, 42], [-5, 72], [82, 66]];
  meteorOrigins.forEach(([x, y], i) => {
    const meteor = document.createElement('i');
    meteor.className = 'entry-meteor';
    meteor.style.cssText = `--x:${x}%;--y:${y}%;--duration:${5.8 + i * .43}s;--delay:-${i * 1.37 + .7}s;--tail:${150 + i % 3 * 45}px`;
    $('entry-meteors').appendChild(meteor);
  });
  window.addEventListener('DOMContentLoaded', () => { refresh(true); refreshRegistration(); });
})();
