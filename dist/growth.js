(function (root) {
  'use strict';
  const STAGES = [
    { name: '拾花初识', symbol: '芽', color: '#bce6ff' },
    { name: '花芽初醒', symbol: '蕾', color: '#b9eedb' },
    { name: '花语渐浓', symbol: '花', color: '#ffd0e6' },
    { name: '繁花入梦', symbol: '梦', color: '#d9c3ff' },
    { name: '星海花冠', symbol: '星', color: '#ffe2a2' },
    { name: '花境长明', symbol: '光', color: '#fff0d0' }
  ];
  function growth(total) {
    total = Number.isSafeInteger(total) && total >= 0 ? total : 0;
    const stage = Math.min(Math.floor(total / 100), STAGES.length - 1);
    return { ...STAGES[stage], stage, total, level: Math.floor(total / 10) + 1,
      progress: total % 10, remaining: 10 - total % 10,
      nextStage: STAGES[stage + 1]?.name || null,
      stageRemaining: stage < STAGES.length - 1 ? (stage + 1) * 100 - total : 0 };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { STAGES, growth };
  else root.BlossomGrowth = { STAGES, growth };
})(globalThis);
