/* ==========================================================================
   ai.js — 电脑叫分与出牌 AI
   双端可用（浏览器 window.DDZAI / Node module.exports）
   策略目标：下得了、有策略、不坑长辈。难度档：easy / normal
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./cards.js'));
  } else {
    root.DDZAI = factory(root.DDZCards);
  }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var DIFFICULTY = { easy: 0, normal: 1 };

  // ---------- 手牌强度评估 ----------
  function handStrength(ranks, nDeck) {
    var score = 0;
    var count = {};
    ranks.forEach(function (r) { count[r] = (count[r] || 0) + 1; });
    Object.keys(count).forEach(function (k) {
      var r = Number(k), c = count[r];
      // 大牌权重
      if (r >= 14) score += (r - 12) * 2;   // A=4, 2=6
      if (r === 16) score += 6;             // 小王
      if (r === 17) score += 8;             // 大王
      // 炸弹加成：一副=4张；两副牌 5+ 张更厚，加成更大
      if (c === 4) score += 12;
      if (nDeck === 2 && c >= 5) score += 12 + (c - 4) * 6;
      // 三张略微加成（可能组三带/飞机）
      if (c === 3) score += 2;
    });
    // 顺子潜力
    var kinds = Object.keys(count).map(Number).sort(function (a, b) { return a - b; });
    var seq = 0, best = 0;
    kinds.forEach(function (k) {
      if (k <= 14 && count[k] >= 1) {
        seq++;
        best = Math.max(best, seq);
      } else seq = 0;
    });
    score += Math.min(best, 6);
    return score;
  }

  // ---------- 出牌选择 ----------

  // 简化打分：一组牌的打分（越小越"舍得先出"）
  function moveScore(ranks, nDeck) {
    var parsed = C.parseCards(ranks, nDeck);
    if (!parsed) return 999;
    var base = parsed.mainRank;
    // 牌型权重：先出复杂大结构，小牌后出
    var typePenalty = {
      single: 0, pair: 1, triple: 2,
      straight: -4, straight_pair: -3, plane_pure: -6, plane_one: -5, plane_pair: -5,
      four_two: -2, four_two_pair: -2,
      triple_one: 2, triple_pair: 2,
      bomb: 8, rocket: 10
    };
    // 两副牌：张数越厚的炸弹越金贵，越不舍得先出
    var bombPenalty = (parsed.type === 'bomb' && nDeck === 2) ? (parsed.len - 4) * 3 : 0;
    return base + (typePenalty[parsed.type] || 0) + bombPenalty;
  }

  // 多样化选牌：稳定优先，但在"足够好"的候选里偶尔换花样。
  // sorted 按打分升序（最优在前）。返回一个候选。
  // - 多数时候（~70%）选最优 → 稳定
  // - 其余时候在次优/第三优里随机 → 可变
  // 所有候选都经过 generateMoves 过滤，必然合法 → 安全
  function variedPick(sorted, rng) {
    if (!sorted || !sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    var r = (rng || Math.random)();
    if (r < 0.7) return sorted[0];                                  // 稳定：最优
    if (r < 0.88) return sorted[Math.min(1, sorted.length - 1)];    // 次优
    return sorted[Math.min(2, sorted.length - 1)];                  // 再次优
  }

  // 首出候选（升序打分）。opts: { variety, rng }
  function leadCandidates(handRanks, nDeck) {
    var moves = C.generateMoves(handRanks, nDeck);
    var cands = [];
    moves.forEach(function (m) {
      var parsed = C.parseCards(m, nDeck);
      // 不推荐先出炸弹/火箭（除非只剩它）
      if (parsed.type === 'bomb' || parsed.type === 'rocket') return;
      // 单张不先出最大的单（A、2、王留给收尾），除非手里只剩单
      if (parsed.type === 'single' && parsed.mainRank >= 14 && handRanks.length > 2) return;
      cands.push({ ranks: m, score: moveScore(m, nDeck) });
    });
    if (!cands.length) {
      // 全部是炸弹/火箭或只剩单张：退而求其次，全要
      moves.forEach(function (m) {
        cands.push({ ranks: m, score: moveScore(m, nDeck) });
      });
    }
    cands.sort(function (a, b) { return a.score - b.score; });
    return cands.map(function (c) { return c.ranks; });
  }

  // 选出"最值得先出"的牌（用于首出/自由出）
  function pickBestLead(handRanks, opts) {
    opts = opts || {};
    var sorted = leadCandidates(handRanks, opts.nDeck);
    if (opts.variety === false) return sorted[0] || null;
    return variedPick(sorted, opts.rng);
  }

  // 跟牌候选（升序打分）
  function followCandidates(handRanks, givenRanks, nDeck) {
    var beats = C.findBeats(handRanks, givenRanks, nDeck);
    if (!beats.length) return [];
    var given = C.parseCards(givenRanks, nDeck);
    var cands = [];
    beats.forEach(function (m) {
      var parsed = C.parseCards(m, nDeck);
      var sc = moveScore(m, nDeck);
      // 除非必要，别用炸弹/火箭去压普通牌
      if ((parsed.type === 'bomb' || parsed.type === 'rocket') && given.type !== 'bomb' && given.type !== 'rocket') {
        sc += 20;
      }
      // 压完后剩余手牌少更优
      var remaining = handRanks.length - m.length;
      if (remaining === 0) sc -= 30; // 能一次出完优先
      cands.push({ ranks: m, score: sc });
    });
    cands.sort(function (a, b) { return a.score - b.score; });
    return cands.map(function (c) { return c.ranks; });
  }

  // 跟牌：在能压的组合里选"最不亏"的
  function pickBestFollow(handRanks, givenRanks, opts) {
    opts = opts || {};
    var sorted = followCandidates(handRanks, givenRanks, opts.nDeck);
    if (!sorted.length) return null;
    if (opts.variety === false) return sorted[0];
    return variedPick(sorted, opts.rng);
  }

  // 需要拆牌/炸弹决策：跟 vs 不跟的智能判断
  function shouldPass(handRanks, givenRanks, opponentCount, difficulty, nDeck) {
    var beats = C.findBeats(handRanks, givenRanks, nDeck);
    if (!beats.length) return true;
    var parsed = C.parseCards(givenRanks, nDeck);
    var level = DIFFICULTY[difficulty] || 0;
    // 对方只剩很少牌时，能压就压（防止对方走完）
    if (opponentCount <= 2) return false;
    // 手牌很少且是对方出完就赢，压
    if (handRanks.length <= 2) return false;
    // 普通情况：让 AI 在简单难度更随意跟牌
    if (level === 0) {
      // easy 更常跟
      return false;
    }
    // normal：评估是否有必要
    var hasBombOnly = beats.every(function (m) {
      var p = C.parseCards(m, nDeck);
      return p.type === 'bomb' || p.type === 'rocket';
    });
    // 如果只能用炸弹/火箭压，且手牌还多，考虑不压
    if (hasBombOnly && handRanks.length >= 6) return true;
    return false;
  }

  // 主入口：根据局面出牌
  // ctx: { handRanks, lastPlay(或null), lastPlayerIndex, myIndex, playersCount, difficulty, teammateIndex, seat, bidInfo, nDeck }
  // 每局开局会为每家生成一个随机的"打法种子"，让同一手牌也可能出不同的方案（随机+可变），
  // 但每个方案都是合法的、合理的（稳定）。
  function decidePlay(ctx) {
    var hand = ctx.handRanks;
    var last = ctx.lastPlay;
    var nDeck = ctx.nDeck === 2 ? 2 : 1;
    // 座位风格的差异：不同座位用不同的随机倾向，打起来更有"个性"
    var seatRng = ctx.seatRng || Math.random;
    if (last && ctx.lastPlayerIndex !== ctx.myIndex) {
      // 轮到我跟牌
      // 农民配合：如果是队友(农民阵营)出的牌，默认不要
      var myRole = ctx.roles[ctx.myIndex];
      var lastRole = ctx.roles[ctx.lastPlayerIndex];
      if (myRole === 'farmer' && lastRole === 'farmer' && last) {
        // 队友出的牌，不压（除非队友只剩1张需要接/或我有必要）
        if (ctx.teammateLastCount && ctx.teammateLastCount <= 2) {
          // 帮队友接，看情况
        } else {
          return null; // 队友出牌，不要
        }
      }
      var pass = shouldPass(hand, last, ctx.playerCounts[ctx.lastPlayerIndex], ctx.difficulty, nDeck);
      if (pass) return null;
      return pickBestFollow(hand, last, { rng: seatRng, nDeck: nDeck });
    } else {
      // 首出/自由出
      return pickBestLead(hand, { rng: seatRng, nDeck: nDeck });
    }
  }

  // 叫地主
  // nDeck 传入手牌强度（两副牌牌更多，叫分更看炸弹/王炸）
  function decideBid(handRanks, difficulty, seat, minBid, nDeck) {
    var s = handStrength(handRanks, nDeck);
    var level = DIFFICULTY[difficulty] || 0;
    // 简单难度：阈值降低，更保守
    var th3 = level === 0 ? 40 : 34;
    var th2 = level === 0 ? 30 : 24;
    var th1 = level === 0 ? 24 : 18;
    // 两副牌牌更多（34张/手），大牌密度低，适当下调叫分阈值
    if (nDeck === 2) { th3 -= 4; th2 -= 4; th1 -= 3; }
    var want = 0, reason = '牌一般，先不叫';
    if (s >= th3) { want = 3; reason = '牌很好，叫3分当地主'; }
    else if (s >= th2) { want = 2; reason = '牌不错，叫2分'; }
    else if (s >= th1) { want = 1; reason = '牌还可以，叫1分试试'; }
    else { want = 0; reason = '牌一般，不叫'; }

    minBid = minBid || 0;
    // 若想叫的分不够高，则不叫（除非手里牌极好，且必须追到 minBid+1）
    if (want > 0 && want <= minBid) {
      if (minBid < 3 && s >= th2) {
        want = minBid + 1;
        reason = '牌不错，跟叫到' + want + '分';
      } else {
        want = 0;
        reason = '前面叫得高，这手先不抢';
      }
    }
    return { bid: want, reason: reason, strength: s };
  }

  return {
    DIFFICULTY: DIFFICULTY,
    handStrength: handStrength,
    decideBid: decideBid,
    decidePlay: decidePlay,
    pickBestLead: pickBestLead,
    pickBestFollow: pickBestFollow,
    leadCandidates: leadCandidates,
    followCandidates: followCandidates,
    variedPick: variedPick
  };
});
