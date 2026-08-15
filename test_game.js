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
  game.hands[1] = [7, 7, 8];
  game.hands[2] = [8, 8, 10];
  game.lastPlay = null;
  game.multiplier = 1;
  G.playCards(game, 0, [3, 3]);
  // 现在 currentPlayer = 1，出对8
  const r = G.playCards(game, 1, [7, 7]);
  t('对7>对3 合法', () => assert(r.ok === true));
  // 轮到2，出对8压对7
  const r2 = G.playCards(game, 2, [8, 8]);
  t('对8>对7 合法', () => assert(r2.ok === true));
}

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed > 0 || errors > 0 ? 1 : 0);
