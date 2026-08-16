// test_game.js — game.js 状态机 + AI 驱动的完整对局测试
const G = require('./js/game.js');
const C = require('./js/cards.js');
const AI = require('./js/ai.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + ' — ' + e.message); }
}
function assert(x, msg) { if (!x) throw new Error(msg || 'assertion failed'); }

console.log('== 完整对局模拟（所有座位由 AI 控制，验证状态机闭环） ==');

function simulateOne(difficulty) {
  const game = G.createGame({ difficulty: difficulty, humanSeat: 2 });
  let guard = 0;
  const seen = new Set();
  while (guard++ < 1000) {
    const st = G.getState(game);
    if (st.phase === 'ended') break;
    if (st.phase === 'bidding') {
      const seat = st.currentBidder;
      const minBid = st.highestBid;
      const r = AI.decideBid(st.handRanks[seat], difficulty, seat, minBid);
      const res = G.placeBid(game, r.bid);
      assert(res.ok, 'placeBid 失败: ' + res.msg);
      if (res.restart) return 'restart';
      if (res.finished) {
        assert(game.landlord === res.landlord, '地主不一致');
        assert(st.hands[game.landlord].length === 20, '地主应有20张，实际' + st.hands[game.landlord].length);
        assert(st.hands[(game.landlord+1)%3].length === 17, '农民应17张');
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
        teammateLastCount: st.lastPlaySeat >= 0 ? st.handRanks[st.lastPlaySeat].length : null
      };
      const play = AI.decidePlay(ctx);
      const res = G.playCards(game, seat, play);
      assert(res.ok, 'playCards 失败 seat=' + seat + ' msg=' + res.msg);
      if (res.finished) {
        return { winner: res.winner, winnerRole: res.winnerRole, multiplier: res.multiplier, spring: res.spring, scores: res.scores };
      }
    } else {
      break;
    }
  }
  assert(game.phase === 'ended', '对局未结束，guard 到达上限');
  return 'ended';
}

let finished = 0, restarts = 0, landlordWins = 0, farmerWins = 0, errors = 0, totalMultiplier = 0;
for (let i = 0; i < 300; i++) {
  try {
    const r = simulateOne(i % 2 === 0 ? 'easy' : 'normal');
    if (r === 'restart') { restarts++; continue; }
    finished++;
    totalMultiplier += r.multiplier;
    if (r.winnerRole === 'landlord') landlordWins++;
    else farmerWins++;
  } catch (e) {
    errors++;
    if (errors <= 5) console.log('  异常: ' + e.message);
  }
}
t('300 局闭环无异常', () => assert(errors === 0, errors + ' 个异常'));
t('有地主胜局', () => assert(landlordWins > 0));
t('有农民胜局', () => assert(farmerWins > 0));
console.log(`  统计: 完成 ${finished}, 重发 ${restarts}, 地主胜 ${landlordWins}, 农民胜 ${farmerWins}, 平均倍数 ${(totalMultiplier/Math.max(finished,1)).toFixed(1)}`);

console.log('== 结算正确性 ==');
// 构造一个简单局面手动验证：地主直接出完
{
  const game = G.createGame({ difficulty: 'normal', humanSeat: 2 });
  // 强制：seat0 当地主，且已经只剩1张
  game.phase = 'playing';
  game.landlord = 0;
  game.roles = ['landlord', 'farmer', 'farmer'];
  game.currentPlayer = 0;
  game.hands[0] = [3];
  game.hands[1] = [5, 6];
  game.hands[2] = [7, 8];
  game.lastPlay = null;
  game.multiplier = 2; // 叫2分
  const res = G.playCards(game, 0, [3]);
  t('地主出完立即结束', () => assert(res.finished === true));
  t('地主获胜', () => assert(res.winnerRole === 'landlord'));
  t('无农民出牌=春天 倍数×2', () => {
    // 底分1 × 叫分2 × 春天2 = 4
    assert(res.multiplier === 4, '实际倍数 ' + res.multiplier);
  });
  t('地主得分 = 4×2 = 8', () => assert(res.scores[0] === 8, '实际 ' + res.scores[0]));
  t('农民各扣4分', () => assert(res.scores[1] === -4 && res.scores[2] === -4));
}

console.log('== 玩家非法操作被拒绝 ==');
{
  const game = G.createGame({ difficulty: 'normal', humanSeat: 2 });
  game.phase = 'playing';
  game.landlord = 2;
  game.roles = ['farmer', 'farmer', 'landlord'];
  game.currentPlayer = 2;
  game.hands[2] = [3, 5, 5, 8];
  game.lastPlay = null;
  game.multiplier = 1;
  // 出不对的牌型：手牌没有4,却出 444
  const r = G.playCards(game, 2, [4, 4, 4]);
  t('拒绝手牌中没有的牌', () => assert(r.ok === false));
  // 出非法组合
  const r2 = G.playCards(game, 2, [3, 5, 8]);
  t('拒绝非法牌型', () => assert(r2.ok === false));
  // 合法出牌
  const r3 = G.playCards(game, 2, [5, 5]);
  t('接受合法出牌', () => assert(r3.ok === true));
  // 轮到别人时不能出
  const r4 = G.playCards(game, 2, [8]);
  t('拒绝非当前玩家出牌', () => assert(r4.ok === false));
}

console.log('== 压牌规则 ==');
{
  const game = G.createGame({ difficulty: 'normal', humanSeat: 2 });
  game.phase = 'playing';
  game.landlord = 0;
  game.roles = ['landlord', 'farmer', 'farmer'];
  game.currentPlayer = 0;
  game.hands[0] = [3, 3, 9];
  game.hands[1] = [9, 9, 8];   // seat1 有对9，能压 seat2 的对8
  game.hands[2] = [8, 8, 10];
  game.lastPlay = null;
  game.multiplier = 1;
  G.playCards(game, 0, [3, 3]);
  // 逆时针：0 出完 → 轮到 2，出对8
  const r = G.playCards(game, 2, [8, 8]);
  t('对8>对3 合法', () => assert(r.ok === true));
  // 逆时针：2 出完 → 轮到 1，出对9压对8
  const r2 = G.playCards(game, 1, [9, 9]);
  t('对9>对8 合法', () => assert(r2.ok === true));
}

console.log('== 四人两副牌（25张/人 + 8底） ==');
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '值不等') + ' 实际 ' + JSON.stringify(a)); }
{
  const d = C.deal(2, 4);
  t('4人发牌：每人25张', () => eq(d.hands.map(h => h.length), [25, 25, 25, 25]));
  t('4人发牌：底牌8张', () => eq(d.bottom.length, 8));
  t('4人发牌：强制两副牌', () => eq(d.nDeck, 2));
}
{
  // 4 人完整对局闭环（4 档难度都跑）
  function simFour(difficulty) {
    const game = G.createGame({ difficulty, humanSeat: 3, nDeck: 2, players: 4 });
    let guard = 0;
    while (guard++ < 3000) {
      const st = G.getState(game);
      if (st.phase === 'ended') return st;
      if (st.phase === 'bidding') {
        const seat = st.currentBidder;
        const r = AI.decideBid(st.handRanks[seat], difficulty, seat, st.highestBid, 2, { players: 4 });
        const res = G.placeBid(game, r.bid);
        assert(res.ok, '4人 placeBid 失败: ' + res.msg);
        if (res.finished) {
          eq(game.hands[game.landlord].length, 33, '4人地主应有33张');
          eq(st.hands[(game.landlord + 1) % 4].length, 25, '4人农民应25张');
        }
      } else if (st.phase === 'playing') {
        const seat = st.currentPlayer;
        const ctx = {
          handRanks: st.handRanks[seat],
          lastPlay: st.lastPlayRanks,
          lastPlayerIndex: st.lastPlaySeat,
          myIndex: seat,
          roles: st.roles,
          difficulty,
          players: 4,
          playerCounts: st.handRanks.map(h => h.length),
          teammateLastCount: st.lastPlaySeat >= 0 ? st.handRanks[st.lastPlaySeat].length : null,
          nDeck: 2,
          discarded: st.discardedRanks
        };
        const res = G.playCards(game, seat, AI.decidePlay(ctx));
        assert(res.ok, '4人 playCards 失败 seat=' + seat + ' msg=' + res.msg);
        if (res.finished) return res;
      } else break;
    }
    assert(game.phase === 'ended', '4人对局未结束，guard 到达上限');
    return 'ended';
  }
  let fin = 0, ld = 0, fm = 0, err4 = 0;
  for (let i = 0; i < 200; i++) {
    try {
      const r = simFour(i % 4 === 0 ? 'easy' : i % 4 === 1 ? 'normal' : i % 4 === 2 ? 'hard' : 'master');
      if (r === 'restart') continue;
      fin++;
      if (r.winnerRole === 'landlord') ld++; else fm++;
      const sum = r.scores.reduce((a, b) => a + b, 0);
      assert(Math.abs(sum) < 0.01, '4人得分之和应为0，实际 ' + sum);
    } catch (e) { err4++; if (err4 <= 5) console.log('  4人异常: ' + e.message); }
  }
  t('200局4人两副闭环无异常', () => assert(err4 === 0, err4 + ' 个异常'));
  t('4人局有地主胜', () => assert(ld > 0));
  t('4人局有农民胜', () => assert(fm > 0));
  console.log(`  4人统计: 完成 ${fin}, 地主胜 ${ld}, 农民胜 ${fm}`);
}
{
  // 4 人结算精确性：地主胜 = 每个农民各扣 total
  const game = G.createGame({ difficulty: 'normal', humanSeat: 3, nDeck: 2, players: 4 });
  game.phase = 'playing';
  game.landlord = 0;
  game.roles = ['landlord', 'farmer', 'farmer', 'farmer'];
  game.currentPlayer = 0;
  game.hands[0] = [3];
  game.hands[1] = [5, 6];
  game.hands[2] = [7, 8];
  game.hands[3] = [9, 10];
  game.lastPlay = null;
  game.multiplier = 2; // 叫2分，无炸弹无春天
  const res4 = G.playCards(game, 0, [3]);
  // 无农民出过牌 → 春天，倍数 ×2：total = 1×2×2 = 4；地主 +4×3=12，农民各 -4
  t('4人地主胜(春天)：地主 +12，农民各 -4', () => eq(res4.scores, [12, -4, -4, -4]));
  t('4人得分和为0', () => eq(res4.scores.reduce((a, b) => a + b, 0), 0));
}
{
  // 记牌数据：discardedRanks 累积已出牌
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
  game.discarded = [];
  game.multiplier = 1;
  G.playCards(game, 0, [3, 3]);
  G.playCards(game, 2, [8, 8]);   // 逆时针：0 → 2
  let stG = G.getState(game);
  t('记牌：discardedRanks 含已出的 3,3,8,8', () => assert(JSON.stringify(stG.discardedRanks.slice().sort((a,b)=>a-b)) === JSON.stringify([3,3,8,8])));
  t('getState 带 players', () => assert(stG.players === 3));
}

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed > 0 || errors > 0 ? 1 : 0);
