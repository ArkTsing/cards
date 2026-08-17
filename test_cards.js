// test_cards.js — cards.js 单元测试（纯 node，无需浏览器）
const assert = require('assert');
const C = require('./js/cards.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + ' — ' + e.message); }
}

// ---------- 牌型识别 ----------
console.log('== parseCards ==');
t('单张 8', () => assert.deepStrictEqual(C.parseCards([8]), { type: 'single', mainRank: 8, len: 1 }));
t('对子 55', () => assert.deepStrictEqual(C.parseCards([5, 5]), { type: 'pair', mainRank: 5, len: 2 }));
t('三张 777', () => assert.deepStrictEqual(C.parseCards([7, 7, 7]), { type: 'triple', mainRank: 7, len: 3 }));
t('炸弹 9999', () => assert.deepStrictEqual(C.parseCards([9, 9, 9, 9]), { type: 'bomb', mainRank: 9, len: 4 }));
t('三带一 8885', () => assert.deepStrictEqual(C.parseCards([8, 8, 8, 5]), { type: 'triple_one', mainRank: 8, len: 4 }));
t('三带二 88855', () => assert.deepStrictEqual(C.parseCards([8, 8, 8, 5, 5]), { type: 'triple_pair', mainRank: 8, len: 5 }));
t('顺子 34567', () => assert.deepStrictEqual(C.parseCards([3, 4, 5, 6, 7]), { type: 'straight', mainRank: 7, len: 5 }));
t('顺子到A 10JQKA', () => assert.deepStrictEqual(C.parseCards([10, 11, 12, 13, 14]), { type: 'straight', mainRank: 14, len: 5 }));
t('顺子含2非法', () => assert.strictEqual(C.parseCards([10, 11, 12, 13, 15]), null));
t('连对 334455', () => assert.deepStrictEqual(C.parseCards([3, 3, 4, 4, 5, 5]), { type: 'straight_pair', mainRank: 5, len: 3 }));
t('飞机纯 333444', () => assert.deepStrictEqual(C.parseCards([3, 3, 3, 4, 4, 4]), { type: 'plane_pure', mainRank: 4, len: 2 }));
t('飞机带单 33344456', () => assert.deepStrictEqual(C.parseCards([3, 3, 3, 4, 4, 4, 5, 6]), { type: 'plane_one', mainRank: 4, len: 2 }));
t('飞机带对 3334445566', () => assert.deepStrictEqual(C.parseCards([3, 3, 3, 4, 4, 4, 5, 5, 6, 6]), { type: 'plane_pair', mainRank: 4, len: 2 }));
t('四带二 999956', () => assert.deepStrictEqual(C.parseCards([9, 9, 9, 9, 5, 6]), { type: 'four_two', mainRank: 9, len: 6 }));
t('四带两对 99995566', () => assert.deepStrictEqual(C.parseCards([9, 9, 9, 9, 5, 5, 6, 6]), { type: 'four_two_pair', mainRank: 9, len: 8 }));
t('火箭 王+王', () => assert.deepStrictEqual(C.parseCards([16, 17]), { type: 'rocket', mainRank: 17, len: 2 }));
t('散牌非法', () => assert.strictEqual(C.parseCards([3, 5, 9]), null));
t('3344非法(连对不够3对)', () => assert.strictEqual(C.parseCards([3, 3, 4, 4]), null));

// ---------- 大小比较 ----------
console.log('== canBeat ==');
t('8>5', () => assert.ok(C.canBeat(C.parseCards([8]), C.parseCards([5]))));
t('5<8', () => assert.ok(!C.canBeat(C.parseCards([5]), C.parseCards([8]))));
t('对8>对5', () => assert.ok(C.canBeat(C.parseCards([8, 8]), C.parseCards([5, 5]))));
t('对子不能压单张', () => assert.ok(!C.canBeat(C.parseCards([8, 8]), C.parseCards([5]))));
t('顺子34567<45678', () => assert.ok(C.canBeat(C.parseCards([4, 5, 6, 7, 8]), C.parseCards([3, 4, 5, 6, 7]))));
t('顺子长度不同不能压', () => assert.ok(!C.canBeat(C.parseCards([4, 5, 6, 7, 8, 9]), C.parseCards([3, 4, 5, 6, 7]))));
t('炸弹压顺子', () => assert.ok(C.canBeat(C.parseCards([9, 9, 9, 9]), C.parseCards([3, 4, 5, 6, 7]))));
t('炸弹大小比较', () => assert.ok(C.canBeat(C.parseCards([10, 10, 10, 10]), C.parseCards([9, 9, 9, 9]))));
t('火箭压炸弹', () => assert.ok(C.canBeat(C.parseCards([16, 17]), C.parseCards([9, 9, 9, 9]))));
t('火箭压一切(单)', () => assert.ok(C.canBeat(C.parseCards([16, 17]), C.parseCards([14]))));
t('2是最强单牌(非王)', () => assert.ok(C.canBeat(C.parseCards([15]), C.parseCards([14]))));
t('王压2', () => assert.ok(C.canBeat(C.parseCards([17]), C.parseCards([15]))));

// ---------- 出牌生成 ----------
console.log('== generateMoves ==');
let hand = [3, 3, 4, 5, 6, 7, 8, 9, 9, 10, 12, 13, 14, 15, 16, 17];
let moves = C.generateMoves(hand);
t('包含单张3', () => assert.ok(moves.some(m => m.length === 1 && m[0] === 3)));
t('包含对3', () => assert.ok(moves.some(m => m.length === 2 && m[0] === 3 && m[1] === 3)));
t('包含顺子3-7', () => assert.ok(moves.some(m => m.length === 5 && m.join(',') === '3,4,5,6,7')));
t('包含顺子4-8', () => assert.ok(moves.some(m => m.length === 5 && m.join(',') === '4,5,6,7,8')));
t('不生成含2的顺子', () => assert.ok(!moves.some(m => m.length >= 5 && m.indexOf(15) !== -1 && m.indexOf(14) === -1)));
t('包含火箭', () => assert.ok(moves.some(m => m.join(',') === '16,17')));
t('无重复', () => {
  const keys = new Set();
  let dup = false;
  moves.forEach(m => {
    const k = m.slice().sort((a,b)=>a-b).join(',');
    if (keys.has(k)) dup = true;
    keys.add(k);
  });
  assert.ok(!dup, '存在重复组合');
});

// 三带一生成
hand = [5, 5, 5, 8, 9];
moves = C.generateMoves(hand);
t('三带一 5558', () => assert.ok(moves.some(m => m.join(',') === '5,5,5,8')));
t('三带一 5559', () => assert.ok(moves.some(m => m.join(',') === '5,5,5,9')));

// 连对生成
hand = [3, 3, 4, 4, 5, 5, 8];
moves = C.generateMoves(hand);
t('连对334455', () => assert.ok(moves.some(m => m.join(',') === '3,3,4,4,5,5')));

// 飞机生成
hand = [3, 3, 3, 4, 4, 4, 5, 6, 5, 6, 5, 6];
moves = C.generateMoves(hand);
t('飞机纯333444', () => assert.ok(moves.some(m => m.join(',') === '3,3,3,4,4,4')));
t('飞机带单(生成33344456)', () => assert.ok(moves.some(m => m.join(',') === '3,3,3,4,4,4,5,6')));
t('飞机带对(生成3334445566)', () => assert.ok(moves.some(m => m.join(',') === '3,3,3,4,4,4,5,5,6,6')));

// 炸弹生成
hand = [9, 9, 9, 9, 3, 4];
moves = C.generateMoves(hand);
t('炸弹9999', () => assert.ok(moves.some(m => m.join(',') === '9,9,9,9')));
t('四带二999934', () => assert.ok(moves.some(m => m.join(',') === '9,9,9,9,3,4')));

// ---------- findBeats ----------
console.log('== findBeats ==');
hand = [5, 5, 8, 8, 10, 12, 12, 12, 16, 17];
let beats = C.findBeats(hand, [5, 5]);
t('对5能压(88/1010/1212)', () => assert.ok(beats.some(m => m.join(',') === '8,8')));
t('对5用炸弹也能压', () => assert.ok(beats.some(m => m.join(',') === '12,12,12,12') === false)); // 没有4张炸弹
t('火箭可压对子', () => assert.ok(beats.some(m => m.join(',') === '16,17')));

beats = C.findBeats(hand, [3, 4, 5, 6, 7]);
t('顺子无法被对子压', () => assert.ok(beats.length === 0 || beats.every(m => C.parseCards(m).type === 'bomb' || C.parseCards(m).type === 'rocket')));

// ---------- 发牌 ----------
console.log('== deal ==');
const d = C.deal();
t('3手各17张', () => assert.deepStrictEqual([d.hands[0].length, d.hands[1].length, d.hands[2].length], [17, 17, 17]));
t('底牌3张', () => assert.strictEqual(d.bottom.length, 3));
const allIds = d.hands.flat().concat(d.bottom).map(c => c.id);
t('54张不重复', () => assert.strictEqual(new Set(allIds).size, 54));
t('含大小王', () => assert.ok(allIds.includes('BJ_16') && allIds.includes('RJ_17')));

// ---------- describe ----------
console.log('== describe ==');
t('描述对子', () => assert.ok(C.describe([8, 8]).includes('对子')));
t('描述顺子', () => assert.ok(C.describe([3, 4, 5, 6, 7]).includes('顺子')));
t('描述火箭', () => assert.ok(C.describe([16, 17]).includes('火箭')));
// v0.4: 降序数组（game 内部 ranksSorted）也要显示正确起点
t('降序顺子 7,6,5,4,3 → 顺子3到7', () => assert.ok(C.describe([7, 6, 5, 4, 3]).includes('3 到 7')));
t('降序连对 7,7,6,6,5,5 → 连对5到7', () => assert.ok(C.describe([7, 7, 6, 6, 5, 5]).includes('5 到 7')));
t('降序飞机 7,7,7,6,6,6 → 飞机 6 到 7', () => assert.ok(C.describe([7, 7, 7, 6, 6, 6]).includes('6 到 7')));
t('顺子起点取最小', () => assert.ok(C.describe([9, 8, 7, 6, 5]).includes('5 到 9')));

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed > 0 ? 1 : 0);
