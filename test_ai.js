// test_ai.js — AI 模拟对局测试（纯 node）
// 验证：叫分合法、出牌合法、无死锁、1000 局全部正常结束
const C = require('./js/cards.js');
const AI = require('./js/ai.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + ' — ' + e.message); }
}

// ---------- 手牌强度 ----------
console.log('== handStrength ==');
t('大王+2 强度高于小牌', () => {
  assert(AI.handStrength([17, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 3, 3, 3]) > AI.handStrength([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 3, 4, 5, 6, 7, 8]));
});
function assert(x) { if (!x) throw new Error('assertion failed'); }

// ---------- 叫分 ----------
console.log('== decideBid ==');
t('好牌叫3分', () => {
  const r = AI.decideBid([17, 16, 15, 15, 14, 14, 14, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5], 'normal', 0);
  assert(r.bid === 3);
});
t('差牌不叫', () => {
  const r = AI.decideBid([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 3, 4, 5, 6, 7, 8], 'normal', 0);
  assert(r.bid === 0);
});
t('叫分范围合法', () => {
  for (let i = 0; i < 200; i++) {
    const deck = C.shuffle(C.buildDeck());
    const hand = deck.slice(0, 17).map(c => c.rank);
    const r = AI.decideBid(hand, 'normal', i % 3);
    assert(r.bid >= 0 && r.bid <= 3);
  }
});

// ---------- 难度档案 ----------
console.log('== 难度档案（4 档） ==');
t('4 档难度齐全', () => {
  const ks = Object.keys(AI.DIFFICULTY).sort();
  assert(JSON.stringify(ks) === JSON.stringify(['easy', 'hard', 'master', 'normal']), '难度键=' + ks.join(','));
});
t('未知难度回退 normal', () => assert(AI.diffLevel('x' + Math.random()) === 1));
t('每档都有策略档案', () => {
  ['easy', 'normal', 'hard', 'master'].forEach(d => {
    const p = AI.profile(d);
    assert(p && typeof p.stablePick === 'number' && typeof p.bombUse === 'string', d + ' 缺档案');
  });
});
t('难度单调：越强越敢叫', () => {
  // 中强牌：master 叫分 >= hard >= normal >= easy
  const mid = [15, 14, 14, 13, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 3, 3];
  const bids = ['easy', 'normal', 'hard', 'master'].map(d => AI.decideBid(mid, d, 0).bid);
  for (let i = 1; i < bids.length; i++) assert(bids[i] >= bids[i - 1], '叫分应单调递增，实际 ' + bids.join(','));
});

// ---------- 完整模拟对局 ----------
console.log('== 模拟对局（500 局，含叫分/出牌/结算） ==');

function simulateOne(difficulty, log) {
  const d = C.deal();
  const hands = d.hands.map(h => h.map(c => c.rank).sort((a,b)=>a-b));
  const roles = ['farmer', 'farmer', 'farmer'];
  let landlord = -1;
  let highestBid = 0;
  let startSeat = Math.floor(Math.random() * 3);

  // 叫分
  let bidderSeat = startSeat;
  let calls = [];
  for (let i = 0; i < 3; i++) {
    const seat = (bidderSeat + i) % 3;
    const r = AI.decideBid(hands[seat], difficulty, seat, highestBid);
    if (r.bid > highestBid) {
      highestBid = r.bid;
      landlord = seat;
    }
    calls.push(r.bid);
  }
  if (landlord === -1) {
    if (log) console.log('  无人叫地主，重发');
    return { restarted: true };
  }
  roles[landlord] = 'landlord';
  // 地主拿底牌
  hands[landlord] = hands[landlord].concat(d.bottom.map(c => c.rank)).sort((a,b)=>a-b);

  // 出牌
  const playerCounts = [17, 17, 17];
  playerCounts[landlord] = 20;
  let currentSeat = landlord;
  let lastPlay = null;
  let lastPlayerIndex = -1;
  let passStreak = 0;
  let guard = 0;
  let bombCount = 0;

  while (guard < 500) {
    guard++;
    const seat = currentSeat;
    const ctx = {
      handRanks: hands[seat],
      lastPlay: lastPlay,
      lastPlayerIndex: lastPlayerIndex,
      myIndex: seat,
      roles: roles,
      difficulty: difficulty,
      playerCounts: playerCounts,
      teammateLastCount: lastPlayerIndex >= 0 ? playerCounts[lastPlayerIndex] : null
    };
    const play = AI.decidePlay(ctx);
    if (play) {
      // 校验合法
      const parsed = C.parseCards(play);
      if (!parsed) {
        if (log) console.log(`  非法出牌 seat=${seat} play=${JSON.stringify(play)}`);
        throw new Error('非法出牌: ' + JSON.stringify(play) + ' hand=' + JSON.stringify(hands[seat]));
      }
      // 校验牌在手牌中
      const copy = hands[seat].slice();
      play.forEach(r => {
        const idx = copy.indexOf(r);
        if (idx < 0) throw new Error('出的牌不在手牌中: ' + r + ' play=' + JSON.stringify(play));
        copy.splice(idx, 1);
      });
      // 校验能压过上家
      if (lastPlay && lastPlayerIndex !== seat) {
        if (!C.canBeat(parsed, C.parseCards(lastPlay))) {
          throw new Error('未能压过上家: play=' + JSON.stringify(play) + ' last=' + JSON.stringify(lastPlay));
        }
      }
      // 执行出牌
      const copy2 = hands[seat].slice();
      play.forEach(r => {
        const idx = copy2.indexOf(r);
        copy2.splice(idx, 1);
      });
      hands[seat] = copy2;
      playerCounts[seat] = hands[seat].length;
      lastPlay = play;
      lastPlayerIndex = seat;
      passStreak = 0;
      if (parsed.type === 'bomb' || parsed.type === 'rocket') bombCount++;
      if (hands[seat].length === 0) {
        return { winner: seat, landlord, bombCount, winnerRole: roles[seat] };
      }
    } else {
      passStreak++;
    }
    // 下一位
    currentSeat = (seat + 1) % 3;
    // 若两家连续 pass，最后出牌者重新自由出
    if (passStreak >= 2) {
      lastPlay = null;
      lastPlayerIndex = -1;
      passStreak = 0;
    }
  }
  throw new Error('死局：500 步未结束');
}

let stats = { finished: 0, restarted: 0, landlordWins: 0, farmerWins: 0, bombs: 0, maxBombs: 0 };
let errors = 0;
for (let i = 0; i < 500; i++) {
  try {
    const result = simulateOne(i % 2 === 0 ? 'easy' : 'normal', false);
    if (result.restarted) { stats.restarted++; continue; }
    stats.finished++;
    stats.bombs += result.bombCount;
    stats.maxBombs = Math.max(stats.maxBombs, result.bombCount);
    if (result.winnerRole === 'landlord') stats.landlordWins++;
    else stats.farmerWins++;
  } catch (e) {
    errors++;
    console.log('  对局异常: ' + e.message);
  }
}
t('500 局全部正常结束（无死锁、无非法出牌）', () => assert(errors === 0));
t('存在地主获胜的对局', () => assert(stats.landlordWins > 0));
t('存在农民获胜的对局', () => assert(stats.farmerWins > 0));
t('有炸弹出现的对局', () => assert(stats.bombs > 0));
console.log(`  --- 统计: 完成 ${stats.finished} 局, 重发 ${stats.restarted}, 地主胜 ${stats.landlordWins}, 农民胜 ${stats.farmerWins}, 炸弹总数 ${stats.bombs}, 单局最多 ${stats.maxBombs}`);

// ---------- 更严格：连续多局保证零异常 ----------
console.log('== 压测（再跑 500 局 normal） ==');
let errors2 = 0;
for (let i = 0; i < 500; i++) {
  try { simulateOne('normal', false); }
  catch (e) { errors2++; console.log('  对局异常: ' + e.message); }
}
t('额外 500 局零异常', () => assert(errors2 === 0));

// ---------- hard / master 档闭环 ----------
console.log('== 高难度档闭环（hard/master 各 300 局） ==');
for (const diff of ['hard', 'master']) {
  let e = 0, ld = 0, fm = 0, fin = 0;
  for (let i = 0; i < 300; i++) {
    try {
      const r = simulateOne(diff, false);
      if (r.restarted) continue;
      fin++;
      if (r.winnerRole === 'landlord') ld++; else fm++;
    } catch (err) { e++; if (e <= 3) console.log('  ' + diff + ' 异常: ' + err.message); }
  }
  t(diff + ' 300 局零异常', () => assert(e === 0, e + ' 个异常'));
  t(diff + ' 有地主胜', () => assert(ld > 0));
  t(diff + ' 有农民胜', () => assert(fm > 0));
  console.log(`  --- ${diff} 统计: 完成 ${fin}, 地主胜 ${ld}, 农民胜 ${fm}`);
}

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed > 0 || errors > 0 || errors2 > 0 ? 1 : 0);
