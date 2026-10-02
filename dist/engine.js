(function (root) {
  'use strict';
  const RARITIES = { SSR: { label: '传说', color: '#f1d493' }, SR: { label: '史诗', color: '#d2b7fb' }, R: { label: '稀有', color: '#a6d7f8' } };
  const LEGACY_ITEMS = [
    { id: 'sword', name: '太虚神剑', rarity: 'SSR', symbol: '剑', desc: '一剑破万法，诸天任我行。' },
    { id: 'body', name: '混沌圣体', rarity: 'SSR', symbol: '道', desc: '以身为界，容纳诸天万道。' },
    { id: 'time', name: '时光回溯', rarity: 'SSR', symbol: '溯', desc: '让命运，再给你一次机会。' },
    { id: 'eye', name: '洞察之眼', rarity: 'SR', symbol: '瞳', desc: '看破虚妄，万物皆有答案。' },
    { id: 'step', name: '踏星步', rarity: 'SR', symbol: '星', desc: '一步踏出，已在千里之外。' },
    { id: 'ring', name: '须弥灵戒', rarity: 'SR', symbol: '界', desc: '方寸之间，藏下一片天地。' },
    { id: 'book', name: '九转玄功', rarity: 'SR', symbol: '玄', desc: '九转归一，重塑无上根基。' },
    { id: 'pill', name: '洗髓灵丹', rarity: 'R', symbol: '丹', desc: '洗尽尘埃，唤醒沉睡的天赋。' },
    { id: 'stone', name: '上品灵石', rarity: 'R', symbol: '灵', desc: '一缕精纯灵气，修行的起点。' },
    { id: 'charm', name: '护身灵符', rarity: 'R', symbol: '符', desc: '危险来临时，为你挡下一击。' },
    { id: 'dew', name: '月华灵露', rarity: 'R', symbol: '月', desc: '凝结月色，滋养神魂。' },
    { id: 'luck', name: '小幸运符', rarity: 'R', symbol: '运', desc: '为平凡的今天，添一点好运。' }
  ];
  const ITEMS = [
    { id: 'shinchan', name: '蜡笔小新联动', rarity: 'SSR', image: 'shinchan.png', limit: 1, desc: '袋子、贴纸和袜子，一整套小新快乐。每位宿主限获 1 份。' },
    { id: 'secret1', name: '告诉系统1个秘密', rarity: 'SR', image: 'secret.png', desc: '和系统分享 1 个小秘密。' },
    { id: 'secret2', name: '告诉系统2个秘密', rarity: 'SR', image: 'secret.png', desc: '和系统分享 2 个小秘密。' },
    { id: 'secret3', name: '告诉系统3个秘密', rarity: 'SR', image: 'secret.png', desc: '和系统分享 3 个小秘密。' },
    { id: 'retry', name: '再抽一次', rarity: 'R', image: 'retry.png', desc: '获得 1 次免费祈愿，不消耗大红花。', freeDraws: 1 },
    { id: 'empty', name: '啥也没中', rarity: 'R', image: 'empty.png', desc: '这次空手而归，下次好运！' },
    { id: 'steal', name: '被偷菜一次', rarity: 'R', image: 'steal.png', desc: '菜园被光顾，记下这一次偷菜。' },
    { id: 'bump', name: '被撞3次', rarity: 'R', image: 'bump-v3.png', desc: '游戏里的碰撞挑战，共 3 次。' },
    { id: 'flowers', name: '奖励20朵红花', rarity: 'R', image: 'flowers.png', desc: '20 朵大红花直接计入余额。', flowers: 20 }
  ];
  const ALL_ITEMS = [...ITEMS, ...LEGACY_ITEMS];
  const DRAW_COST = 10, INITIAL_BALANCE = 0;
  const namedItem = (item, config) => ({ ...item, name: config?.names?.[item.id] || item.name });
  const exhausted = (item, state) => Boolean(item.limit && (state.inventory[item.id] || 0) >= item.limit);
  function availableRates(state, config) {
    const weights = Object.fromEntries(ITEMS.map(item => [item.id, exhausted(item, state) ? 0 : config?.rates?.[item.id] ?? (item.rarity === 'SSR' ? 2 : item.rarity === 'SR' ? 13 / 3 : 17)]));
    const total = Object.values(weights).reduce((sum, rate) => sum + rate, 0);
    return Object.fromEntries(ITEMS.map(item => [item.id, total ? weights[item.id] / total * 100 : 0]));
  }
  const fresh = () => ({ version: 3, balance: INITIAL_BALANCE, freeDraws: 0, total: 0, pitySSR: 0, pitySR: 0, inventory: {}, history: [], gifts: 0 });
  function validate(value) {
    if (!value || ![1, 2, 3].includes(value.version)) return null;
    const integer = (n, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= 0 && n <= max;
    if (!integer(value.balance) || !integer(value.total) || !integer(value.pitySSR, 79) || !integer(value.pitySR, 9) || !integer(value.gifts)) return null;
    if (value.version === 3 && !integer(value.freeDraws)) return null;
    if (!value.inventory || typeof value.inventory !== 'object' || Array.isArray(value.inventory)) return null;
    if (!Object.entries(value.inventory).every(([id, n]) => ALL_ITEMS.some(item => item.id === id) && integer(n) && n > 0)) return null;
    if (!Array.isArray(value.history) || value.history.length > 200 || !value.history.every(h => h && ALL_ITEMS.some(i => i.id === h.id) && Number.isFinite(h.time) && integer(h.number) && h.number <= value.total)) return null;
    if (Object.values(value.inventory).reduce((a, b) => a + b, 0) !== value.total) return null;
    return value.version < 3 ? { ...value, version: 3, balance: value.version === 1 ? Math.floor(value.balance / 16) : value.balance, freeDraws: 0 } : value;
  }
  function random() { const bytes = new Uint32Array(1); root.crypto.getRandomValues(bytes); return bytes[0] / 4294967296; }
  function draw(state, count, rng = random, now = Date.now(), useFree = false, config = null) {
    if (count !== 1 && count !== 10) throw new Error('仅支持单次或十次祈愿');
    if (useFree && (count !== 1 || state.freeDraws < 1)) throw new Error('没有可用的免费祈愿次数');
    if (!useFree && state.balance < count * DRAW_COST) throw new Error('大红花不足');
    const next = { ...state, inventory: { ...state.inventory }, history: [...state.history], balance: state.balance - (useFree ? 0 : count * DRAW_COST), freeDraws: state.freeDraws - (useFree ? 1 : 0) };
    const results = [];
    for (let n = 0; n < count; n++) {
      const chance = rng();
      const rates = availableRates(next, config);
      const weight = item => rates[item.id];
      const totalWeight = rank => ITEMS.filter(i => i.rarity === rank).reduce((sum, i) => sum + weight(i), 0);
      const ssr = totalWeight('SSR') / 100;
      const sr = totalWeight('SR') / 100;
      if (!Object.values(rates).some(rate => rate > 0)) throw new Error('可抽奖励已领完，请联系管理员调整奖池；本次不扣红花或免费次数');
      let rarity = chance < ssr ? 'SSR' : chance < ssr + sr ? 'SR' : 'R';
      if (!config || config.guarantees) {
        if (ssr > 0 && next.pitySSR >= 79) rarity = 'SSR';
        else if (sr > 0 && next.pitySR >= 9 && rarity === 'R') rarity = 'SR';
      }
      const pool = ITEMS.filter(item => item.rarity === rarity && weight(item) > 0);
      let pick = rng() * totalWeight(rarity);
      const item = pool.find(i => (pick -= weight(i)) < 0) || pool[pool.length - 1];
      next.total++;
      next.pitySSR = rarity === 'SSR' ? 0 : Math.min(79, next.pitySSR + 1);
      next.pitySR = rarity === 'R' ? Math.min(9, next.pitySR + 1) : 0;
      next.inventory[item.id] = (next.inventory[item.id] || 0) + 1;
      next.balance += item.flowers || 0;
      next.freeDraws += item.freeDraws || 0;
      const record = { id: item.id, time: now, number: next.total };
      next.history.unshift(record);
      results.push(namedItem(item, config));
    }
    next.history = next.history.slice(0, 200);
    return { state: next, results };
  }
  const api = { ITEMS, ALL_ITEMS, RARITIES, DRAW_COST, INITIAL_BALANCE, fresh, validate, draw, namedItem, exhausted, availableRates };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DestinyEngine = api;
})(globalThis);
