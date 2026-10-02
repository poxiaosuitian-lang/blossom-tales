'use strict';
const assert = require('node:assert/strict');
const { growth } = require('../dist/growth.js');
const { fresh, draw } = require('../dist/engine.js');
for (const [total, level, stage, progress] of [[0,1,0,0],[9,1,0,9],[10,2,0,0],[99,10,0,9],[100,11,1,0],[499,50,4,9],[500,51,5,0],[1234,124,5,4]]) {
  const actual = growth(total);
  assert.equal(actual.level, level);
  assert.equal(actual.stage, stage);
  assert.equal(actual.progress, progress);
  assert.equal(actual.remaining, 10 - progress);
}
const before = { ...fresh(), total: 95, balance: 100, freeDraws: 1 };
const batch = draw(before, 10, () => .6).state;
assert.equal(growth(batch.total).stage, 1);
assert.equal(growth(batch.total).level, 11);
const free = draw({ ...before, total: 99 }, 1, () => .6, Date.now(), true).state;
assert.equal(growth(free.total).stage, 1);
assert.equal(free.balance, before.balance);
assert.deepEqual(growth(JSON.parse(JSON.stringify(batch)).total), growth(batch.total));
assert.throws(() => draw({ ...before, balance: 0 }, 1));
assert.equal(before.total, 95);
assert.equal(growth(500).nextStage, null);
assert.equal(growth(0).stageRemaining, 100);
console.log('PASS: growth boundaries, batch/free draws, failed draw, saved totals and final stage');
