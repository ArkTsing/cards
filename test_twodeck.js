// test_twodeck.js — 两副牌（108张）玩法测试
// 覆盖：发牌数量、牌唯一性、game 状态机两副牌闭环、牌桌各家牌同时显示
const G = require('./js/game.js');
const C = require('./js/cards.js');
const AI = require('./js/ai.js');
const assert = require('assert');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + ' — ' + e.message); }
}
function ok(x, msg) { if (!x) throw new Error(msg || 'assertion failed'); }

console.log('== 两副牌发牌 ==');
{
  const d = C.deal(2);
  t('3手各34张', () => assert.deepStrictEqual([d.hands[0].length, d.hands[1].length, d.hands[2].length], [34, 34, 34]));
  t('底牌6张', () => assert.strictEqual(d.bottom.length, 6));
  t('perHand=34 bottomCount=6 nDeck=2', () => ok(d.perHand === 34 && d.bottomCount === 6 && d.nDeck === 2));
  const allUids = d.hands.flat().concat(d.bottom).map(c => c.uid);
  t('108张uid全部唯一', () => assert.strictEqual(new Set(allUids).size, 108));
  t('每张牌都有uid', () => ok(allUids.every(u => /#\d+$/.test(u))));
  t('每张牌都有图片', () => ok(d.hands.flat().concat(d.bottom).every(c => c.img && c.img.indexOf('assets/cards/') !== -1)));
}

console.log('== 一副牌兼容（默认） ==');
{
  const d = C.deal();
  t('默认仍是一副牌', () => ok(d.hands[0].length === 17 && d.bottom.length === 3));
  const d1 = C.deal(1);
  t('nDeck=1 显式', () => ok(d1.hands[0].length === 17 && d1.bottom.length === 3));
}

console.log('== 两副牌完整对局闭环 ==');
function simulateTwoDeck(difficulty) {
  const game = G.createGame({ difficulty: difficulty, humanSeat: 2, nDeck: 2 });
  let guard = 0;
  while (guard++ < 2000) {
    const st = G.getState(game);
    if (st.phase === 'ended') return st;
    if (st.phase === 'bidding') {
      const seat = st.currentBidder;
      const r = AI.decideBid(st.handRanks[seat], difficulty, seat, st.highestBid, 2);
      const res = G.placeBid(game, r.bid);
      ok(res.ok, 'placeBid 失败: ' + res.msg);
      if (res.restart) return 'restart';
      if (res.finished) {
        ok(game.landlord === res.landlord, '地主不一致');
        assert.strictEqual(st.hands[game.landlord].length, 40, '两副牌地主应有40张，实际' + st.hands[game.landlord].length);
        assert.strictEqual(st.hands[(game.landlord+1)%3].length, 34, '农民应34张');
      }
    } else if (st.phase === 'playing') {
      const seat = st.currentPlayer;
      const ctx = {
        handRanks: st.handRanks[seat],
        lastPlay: st.lastPlayRanks,
        lastPlayerIndex: st.lastPlaySeat,
        myIndex: seat,
        roles: st.roles,
        difficulty: difficulty,
        playerCounts: st.handRanks.map(h => h.length),
        teammateLastCount: st.lastPlaySeat >= 0 ? st.handRanks[st.lastPlaySeat].length : null,
        nDeck: 2
      };
      const play = AI.decidePlay(ctx);
      const res = G.playCards(game, seat, play);
      ok(res.ok, 'playCards 失败 seat=' + seat + ' msg=' + res.msg + ' play=' + JSON.stringify(play));
      if (res.finished) return st;
    } else break;
  }
  ok(false, '两副牌对局未结束，guard 到达上限');
}
let finished = 0, restarts = 0, errors = 0;
for (let i = 0; i < 150; i++) {
  try {
    const r = simulateTwoDeck(i % 2 === 0 ? 'easy' : 'normal');
    if (r === 'restart') { restarts++; continue; }
    finished++;
    const sum = r.scores.reduce((a,b) => a+b, 0);
    assert.ok(Math.abs(sum) < 0.01, '得分之和应为0，实际 ' + sum);
  } catch (e) { errors++; if (errors <= 5) console.log('  异常: ' + e.message); }
}
t('150局两副牌闭环无异常', () => ok(errors === 0, errors + ' 个异常'));
t('有完成的对局', () => ok(finished > 0));
console.log(`  统计: 完成 ${finished}, 重发 ${restarts}, 异常 ${errors}`);

console.log('== 牌桌各家牌同时显示（lastPlays） ==');
{
  const game = G.createGame({ difficulty: 'normal', humanSeat: 2, nDeck: 1 });
  game.phase = 'playing';
  game.landlord = 0;
  game.roles = ['landlord', 'farmer', 'farmer'];
  game.currentPlayer = 0;
  game.hands[0] = [3, 3, 9];
  game.hands[1] = [7, 7, 8];
  game.hands[2] = [8, 8, 10];
  game.lastPlay = null;
  game.lastPlays = [];
  game.multiplier = 1;

  let res = G.playCards(game, 0, [3, 3]);
  t('seat0出对3', () => ok(res.ok));
  let st = G.getState(game);
  t('lastPlays[0] 有牌', () => ok(st.lastPlays[0] && st.lastPlays[0].cards.length === 2));
  t('lastPlays[1] 尚无', () => ok(st.lastPlays[1] === undefined));

  res = G.playCards(game, 1, [7, 7]);
  st = G.getState(game);
  t('lastPlays[0] 仍在（同时显示）', () => ok(st.lastPlays[0] && st.lastPlays[0].cards.length === 2));
  t('lastPlays[1] 有牌', () => ok(st.lastPlays[1] && st.lastPlays[1].cards.length === 2));

  res = G.playCards(game, 2, null); // 不要
  st = G.getState(game);
  t('lastPlays[2] 为 null(不要)', () => ok(st.lastPlays[2] === null));
  t('仅一次pass 不清空牌桌', () => ok(st.lastPlays[0] && st.lastPlays[1] && st.lastPlays[2] === null));

  // 再来一次 pass（seat0 不要）→ 连续两家 pass → 清空，seat1 重新自由出
  res = G.playCards(game, 0, null);
  t('seat0 再 pass 合法（压不过/选择不要）', () => ok(res.ok));
  st = G.getState(game);
  t('连续两家pass后牌桌清空', () => ok(!st.lastPlays || st.lastPlays.length === 0));
  t('lastPlay 已清空（自由出）', () => ok(st.lastPlay === null && st.lastPlaySeat === -1));
  t('下一家轮到 seat1 自由出', () => ok(st.currentPlayer === 1));
}

console.log('== 两副牌牌型识别（炸弹/王炸规则） ==');
t('两副牌 对子可识别', () => ok(C.parseCards([8,8], 2).type === 'pair'));
t('两副牌 4张炸弹可识别', () => ok(C.parseCards([8,8,8,8], 2).type === 'bomb' && C.parseCards([8,8,8,8], 2).len === 4));
t('两副牌 5张炸弹可识别', () => ok(C.parseCards([8,8,8,8,8], 2).type === 'bomb' && C.parseCards([8,8,8,8,8], 2).len === 5));
t('两副牌 6张炸弹可识别', () => ok(C.parseCards([9,9,9,9,9,9], 2).type === 'bomb' && C.parseCards([9,9,9,9,9,9], 2).len === 6));
t('两副牌 8张炸弹可识别', () => ok(C.parseCards([5,5,5,5,5,5,5,5], 2).type === 'bomb' && C.parseCards([5,5,5,5,5,5,5,5], 2).len === 8));
t('两副牌 小王+大王两张不算王炸', () => ok(C.parseCards([16,17], 2) === null));
t('两副牌 四张王(双小王+双大王)是王炸', () => {
  const p = C.parseCards([16,16,17,17], 2);
  ok(p && p.type === 'rocket' && p.len === 4, JSON.stringify(p));
});
t('两副牌 四张王乱序也可识别', () => ok(C.parseCards([17,16,16,17], 2).type === 'rocket'));

console.log('== 两副牌炸弹压牌规则 ==');
t('厚炸弹压过薄炸弹（5张压4张）', () => ok(C.canBeat(C.parseCards([9,9,9,9,9], 2), C.parseCards([8,8,8,8], 2), 2)));
t('薄炸弹压不过厚炸弹（4张压5张）', () => ok(!C.canBeat(C.parseCards([8,8,8,8], 2), C.parseCards([9,9,9,9,9], 2), 2)));
t('同张数比点数（4张9压4张8）', () => ok(C.canBeat(C.parseCards([9,9,9,9], 2), C.parseCards([8,8,8,8], 2), 2)));
t('6张压5张', () => ok(C.canBeat(C.parseCards([6,6,6,6,6,6], 2), C.parseCards([10,10,10,10,10], 2), 2)));
t('厚炸弹也压不过王炸', () => ok(!C.canBeat(C.parseCards([9,9,9,9,9], 2), C.parseCards([16,16,17,17], 2), 2)));
t('王炸压一切', () => ok(C.canBeat(C.parseCards([16,16,17,17], 2), C.parseCards([9,9,9,9], 2), 2)));
t('两副牌 普通牌压不过炸弹', () => ok(!C.canBeat(C.parseCards([12,12], 2), C.parseCards([8,8,8,8], 2), 2)));

console.log('== 两副牌 generateMoves 炸弹/王炸 ==');
t('6张8能生成4/5/6张炸弹', () => {
  const moves = C.generateMoves([8,8,8,8,8,8, 5, 10], 2);
  const bombs = moves.filter(m => {
    const p = C.parseCards(m, 2);
    return p && p.type === 'bomb' && p.mainRank === 8;
  }).map(m => m.length).sort((a,b) => a-b);
  ok(JSON.stringify(bombs) === JSON.stringify([4,5,6]), '炸弹长度=' + JSON.stringify(bombs));
});
t('两王生成不了王炸（缺一对）', () => {
  const moves = C.generateMoves([16,16,17, 3,3,3, 8], 2);
  ok(!moves.some(m => { const p = C.parseCards(m, 2); return p && p.type === 'rocket'; }));
});
t('四王能生成王炸', () => {
  const moves = C.generateMoves([16,16,17,17, 3,3,3], 2);
  ok(moves.some(m => { const p = C.parseCards(m, 2); return p && p.type === 'rocket' && m.length === 4; }));
});
t('findBeats 两副牌能找到厚炸弹压薄炸弹', () => {
  const beats = C.findBeats([9,9,9,9,9, 3,4], [8,8,8,8], 2);
  ok(beats.some(m => { const p = C.parseCards(m, 2); return p.type === 'bomb' && p.mainRank === 9 && p.len === 5; }));
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed > 0 || errors > 0 ? 1 : 0);
