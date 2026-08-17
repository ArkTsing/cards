/* ==========================================================================
   ai.js — 电脑叫分与出牌 AI
   双端可用（浏览器 window.DDZAI / Node module.exports）
   策略目标：下得了、有策略、不坑长辈。难度分配向真人打牌逻辑靠拢：
   - easy   简单（1档）：适合新手/长辈——让着您打，几乎不用炸弹、不抢叫、有得压就压
   - normal 普通（2档）：适合新手/长辈——稳当不犀利，会留大牌控场，偶尔放水
   - hard   困难（3档）：普通/困难真人水平——会记牌、会用炸弹时机、农民配合、拆大牌谨慎
   - master 大师（4档）：常人高手水平——记牌控场、收尾果断、关键时刻稳准狠、农民深度配合
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./cards.js'));
  } else {
    root.DDZAI = factory(root.DDZCards);
  }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var DIFFICULTY = { easy: 0, normal: 1, hard: 2, master: 3 };
  function diffLevel(d) { var l = DIFFICULTY[d]; return l == null ? 1 : l; }

  // 每个难度一份策略档案：聪明程度由这些维度决定
  //   stablePick：选最优方案的倾向（越高越稳定/少犯错）
  //   memory    ：是否记牌（估算剩余大牌）
  //   bombUse   ：炸弹使用门槛 rare / current / smart / optimal
  //   teamPlay  ：农民配合 none / basic / deep
  //   breakPairs：是否避免拆对（出单张时）
  var PROFILES = {
    easy:   { level: 0, stablePick: .60, memory: false, bombUse: 'rare',    teamPlay: 'none', breakPairs: false },
    normal: { level: 1, stablePick: .72, memory: false, bombUse: 'current', teamPlay: 'basic', breakPairs: false },
    hard:   { level: 2, stablePick: .82, memory: true,  bombUse: 'smart',   teamPlay: 'deep',  breakPairs: true },
    master: { level: 3, stablePick: .95, memory: true,  bombUse: 'optimal', teamPlay: 'deep',  breakPairs: true }
  };
  function profile(d) { return PROFILES[d] || PROFILES.normal; }

  // ---------- 记牌：估算场上还没出的"大牌"剩多少 ----------
  // 每人可见：自己手牌 + 已出的牌。总张数 = 每副张数 × nDeck。
  // 差 = 别人手里可能还有的 A/2/小王/大王。只对 memory 档位启用。
  function highLeft(hand, discarded, nDeck) {
    var total = { 14: 4 * nDeck, 15: 4 * nDeck, 16: nDeck, 17: nDeck };
    var seen = {};
    (hand || []).forEach(function (r) { seen[r] = (seen[r] || 0) + 1; });
    (discarded || []).forEach(function (r) { seen[r] = (seen[r] || 0) + 1; });
    var left = {};
    Object.keys(total).forEach(function (k) {
      left[k] = Math.max(0, total[k] - (seen[k] || 0));
    });
    return left;
  }

  // 场上还没出过的 A/2/小王/大王 总数（memory 档用）：
  // 越小说明大牌已被打掉很多 → 我手里的 2/王 越安全，可以放心作收尾/控场牌
  function bigsLeft(hand, discarded, nDeck) {
    var h = highLeft(hand, discarded, nDeck);
    return (h[14] || 0) + (h[15] || 0) + (h[16] || 0) + (h[17] || 0);
  }

  // ---------- 手牌强度评估 ----------
  // opts: { nDeck, memory, discarded }
  function handStrength(ranks, nDeck, opts) {
    opts = opts || {};
    nDeck = nDeck === 2 ? 2 : 1;
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
    // 王炸加成（火箭是最大的牌，手里有它叫分底气足）
    var hasRocket = nDeck === 2
      ? (count[16] >= 2 && count[17] >= 2)
      : (count[16] >= 1 && count[17] >= 1);
    if (hasRocket) score += 16;
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
    // 记牌：场面上大牌已打掉很多 → 我的大牌更安全，加分
    if (opts.memory && opts.discarded) {
      var left = highLeft(ranks, opts.discarded, nDeck);
      var highOut = (4 * nDeck - left[14]) + (4 * nDeck - left[15]) + (nDeck - left[16]) + (nDeck - left[17]);
      score += Math.min(6, Math.round(highOut * 0.25));
    }
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

  // 收尾价值：这手牌能让"剩余手"更好打就加分。
  //   - 能一把出完：最大优先（真人最后一手绝不会留着不打）
  //   - 出单张拆了对/三：留单牌残骸，扣分（拆结构要谨慎）
  function shedAdjust(ranks, hand, nDeck, hc) {
    var parsed = C.parseCards(ranks, nDeck);
    if (!parsed) return 0;
    var remaining = hand.length - ranks.length;
    if (remaining === 0) return -40;
    if (parsed.type === 'single' && (hc[parsed.mainRank] || 0) > 1) return 12;
    return 0;
  }

  // 多样化选牌：稳定优先，但在"足够好"的候选里偶尔换花样。
  // stable 表示选最优的倾向（越高越稳定）。所有候选都合法 → 安全。
  function variedPick(sorted, rng, stable) {
    if (!sorted || !sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    var s = (stable == null) ? 0.7 : stable;
    var r = (rng || Math.random)();
    if (r < s) return sorted[0];                                  // 稳定：最优
    if (r < (s + 0.18)) return sorted[Math.min(1, sorted.length - 1)];    // 次优
    return sorted[Math.min(2, sorted.length - 1)];                // 再次优
  }

  // 手牌里每种点数的张数（用于"拆不拆对"判断）
  function rankCounts(hand) {
    var hc = {};
    (hand || []).forEach(function (r) { hc[r] = (hc[r] || 0) + 1; });
    return hc;
  }

  // 首出候选（升序打分）。opts: { profile, discarded }
  function leadCandidates(handRanks, nDeck, opts) {
    opts = opts || {};
    var prof = opts.profile || PROFILES.normal;
    var moves = C.generateMoves(handRanks, nDeck);
    var hc = rankCounts(handRanks);
    var cands = [];
    // 记牌：大牌还很金贵时，手里的 2/王 更要留作控场/收尾，不要轻易单张打出
    var bl = (prof.memory && opts.discarded) ? bigsLeft(handRanks, opts.discarded, nDeck) : null;
    moves.forEach(function (m) {
      var parsed = C.parseCards(m, nDeck);
      if (!parsed) return;
      // 不推荐先出炸弹/火箭（除非只剩它）
      if (parsed.type === 'bomb' || parsed.type === 'rocket') return;
      // 单张不先出最大的单（A、2、王留给收尾），除非手里只剩单
      if (parsed.type === 'single' && parsed.mainRank >= 14 && handRanks.length > 2) return;
      var sc = moveScore(m, nDeck) + shedAdjust(m, handRanks, nDeck, hc);
      // hard/master：优先出复杂结构（顺子/连对/飞机），一次减掉多手
      if (prof.level >= 2 && (parsed.type === 'straight' || parsed.type === 'straight_pair' ||
          parsed.type === 'plane_pure' || parsed.type === 'plane_one' || parsed.type === 'plane_pair')) {
        sc -= 3;
      }
      // master：先出单张时不拆对/不拆三
      if (prof.breakPairs && parsed.type === 'single' && hc[parsed.mainRank] > 1) {
        sc += 5;
      }
      // memory 档：场上大牌已少（2/王 更值钱）→ 这些单张大牌更不该先出
      if (bl != null && parsed.type === 'single' && parsed.mainRank >= 15) {
        sc += (bl <= 2 ? 8 : (bl <= 4 ? 4 : 0));
      }
      cands.push({ ranks: m, score: sc });
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
    var prof = opts.profile || PROFILES.normal;
    var sorted = leadCandidates(handRanks, opts.nDeck, { profile: prof, discarded: opts.discarded });
    if (opts.variety === false) return sorted[0] || null;
    return variedPick(sorted, opts.rng, prof.stablePick);
  }

  // 炸弹使用罚分：在"用炸弹去压"上加的分（越大越不舍得用）
  function bombPenalty(parsed, given, oppLeft, prof) {
    var givenType = given ? given.type : '';
    if (givenType === 'bomb' || givenType === 'rocket') return 0;  // 应炸必炸
    switch (prof.bombUse) {
      case 'rare':    return oppLeft <= 1 ? 6 : 999;   // 简单：对手快走才用
      case 'current': return 20;                        // 普通：现水平
      case 'smart':   return oppLeft <= 3 ? 0 : 40;     // 困难：对手快走才值得
      case 'optimal': return oppLeft <= 4 ? 0 : 30;     // 大师：更有判断力
      default: return 20;
    }
  }

  // 跟牌候选（升序打分）。opts: { profile, oppLeft }
  function followCandidates(handRanks, givenRanks, nDeck, opts) {
    opts = opts || {};
    var prof = opts.profile || PROFILES.normal;
    var beats = C.findBeats(handRanks, givenRanks, nDeck);
    if (!beats.length) return [];
    var given = C.parseCards(givenRanks, nDeck);
    var oppLeft = opts.oppLeft;
    if (oppLeft == null) oppLeft = 99;
    var hc = rankCounts(handRanks);
    var bl = (prof.memory && opts.discarded) ? bigsLeft(handRanks, opts.discarded, nDeck) : null;
    var cands = [];
    beats.forEach(function (m) {
      var parsed = C.parseCards(m, nDeck);
      var sc = moveScore(m, nDeck) + shedAdjust(m, handRanks, nDeck, hc);
      var remaining = handRanks.length - m.length;
      if (remaining === 0) sc -= 30; // 能一次出完优先
      if (oppLeft <= 2) sc -= 6;     // 对手快走：压住优先
      // 除非必要，别用炸弹/火箭去压普通牌
      if (parsed.type === 'bomb' || parsed.type === 'rocket') {
        sc += bombPenalty(parsed, given, oppLeft, prof);
      }
      // hard/master：压完剩得少更优
      if (prof.level >= 2 && remaining <= 3) sc -= 4;
      // master：跟单张时尽量不拆对
      if (prof.breakPairs && parsed.type === 'single' && hc[parsed.mainRank] > 1) sc += 4;
      // memory 档：场上大牌已少 → 别拿 2/王 去压普通牌（留着控场）
      if (bl != null && parsed.type === 'single' && parsed.mainRank >= 15) {
        sc += (bl <= 2 ? 8 : (bl <= 4 ? 4 : 0));
      }
      cands.push({ ranks: m, score: sc });
    });
    cands.sort(function (a, b) { return a.score - b.score; });
    return cands.map(function (c) { return c.ranks; });
  }

  // 跟牌：在能压的组合里选"最不亏"的
  function pickBestFollow(handRanks, givenRanks, opts) {
    opts = opts || {};
    var prof = opts.profile || PROFILES.normal;
    var ctx = opts.ctx || {};
    var oppLeft = ctx.playerCounts && ctx.lastPlayerIndex != null
      ? ctx.playerCounts[ctx.lastPlayerIndex]
      : (opts.oppLeft != null ? opts.oppLeft : 99);
    var sorted = followCandidates(handRanks, givenRanks, opts.nDeck, { profile: prof, oppLeft: oppLeft, discarded: ctx.discarded });
    if (!sorted.length) return null;
    if (opts.variety === false) return sorted[0];
    return variedPick(sorted, opts.rng, prof.stablePick);
  }

  // 判断这一手要不要过（不压）。ctx 含完整局面信息（roles/playerCounts/discarded 等）。
  function shouldPass(ctx, beats, given, prof) {
    var hand = ctx.handRanks || [];
    var nDeck = ctx.nDeck === 2 ? 2 : 1;
    var roles = ctx.roles || [];
    var lastSeat = ctx.lastPlayerIndex;
    var myIndex = ctx.myIndex;
    var myRole = roles[myIndex];
    var lastRole = lastSeat != null ? roles[lastSeat] : undefined;
    var canFinish = beats.some(function (m) { return m.length === hand.length; });

    if (!beats || !beats.length) return true;  // 没得压

    // ---- 队友出的牌：原则上不压，除非能一把走完 ----
    if (myRole === 'farmer' && lastRole === 'farmer') {
      if (canFinish) return false;  // 我能一次出完 → 出（农民赢）
      if (ctx.teammateLastCount != null && ctx.teammateLastCount <= 2) return true; // 队友马上走 → 放
      // 地主快走 → 压住队友也不行，地主才是共同的敌人；看地主剩几张
      var landlordCount = 99;
      for (var i = 0; i < roles.length; i++) {
        if (roles[i] === 'landlord' && ctx.playerCounts) landlordCount = Math.min(landlordCount, ctx.playerCounts[i]);
      }
      if (landlordCount <= 2) return false;   // 地主快走了，别让队友先出 → 我来压着
      return true;  // 其余情况都不压队友（省牌给队友收尾）
    }

    // ---- 对手出的牌 ----
    var oppCount = ctx.playerCounts && lastSeat != null ? ctx.playerCounts[lastSeat] : 99;
    if (canFinish) return false;
    if (oppCount <= 3) return false;          // 对手剩≤3张：必须拦（真人：快走必压，含炸弹）
    if (oppCount <= 5 && prof.level >= 2) return false; // hard/master：剩5张也尽量拦
    if (hand.length <= 3) return false;        // 我快走：压

    var hasBombOnly = beats.every(function (m) {
      var p = C.parseCards(m, nDeck);
      return p && (p.type === 'bomb' || p.type === 'rocket');
    });
    if (hasBombOnly) {
      // 炸弹是稀缺资源：手牌还多时不轻易拆
      if (hand.length >= 6) return true;
      return false;
    }

    // easy 有得压就压（让着打）；normal 也压，给老人陪练感
    if (prof.level <= 1) return false;

    // hard/master：对手牌还多时，用普通小牌压合适；只能用大牌压且对手牌多 → 留控场
    if (oppCount > 6) {
      var minFollowRank = Infinity;
      beats.forEach(function (m) {
        var p = C.parseCards(m, nDeck);
        if (p && p.mainRank < minFollowRank) minFollowRank = p.mainRank;
      });
      if (minFollowRank >= 15) return true;
    }
    return false;
  }

  // 主入口：根据局面出牌
  // ctx: { handRanks, lastPlay(或null), lastPlayerIndex, myIndex, playersCount, difficulty,
  //        teammateIndex, seat, seatRng, nDeck, roles, playerCounts, discarded }
  function decidePlay(ctx) {
    var hand = ctx.handRanks || [];
    var last = ctx.lastPlay;
    var nDeck = ctx.nDeck === 2 ? 2 : 1;
    var prof = profile(ctx.difficulty);
    var seatRng = ctx.seatRng || Math.random;

    if (last && ctx.lastPlayerIndex != null && ctx.lastPlayerIndex !== ctx.myIndex) {
      // 轮到我跟牌
      var given = C.parseCards(last, nDeck);
      var beats = C.findBeats(hand, last, nDeck);
      if (shouldPass(ctx, beats, given, prof)) return null;
      // 能一把走完 → 绝不犹豫（真人最后一手必出能赢的组合）
      var canFinish = beats.some(function (m) { return m.length === hand.length; });
      return pickBestFollow(hand, last, { rng: seatRng, nDeck: nDeck, profile: prof, ctx: ctx, variety: canFinish ? false : undefined });
    }
    // 首出/自由出
    var opts = { rng: seatRng, nDeck: nDeck, profile: prof, discarded: ctx.discarded };
    if (hand.length <= 6) opts.variety = false;   // 收尾阶段不犹豫：直接出最可能一把走完的
    return pickBestLead(hand, opts);
  }

  // 叫地主
  // opts: { players, discarded }
  function decideBid(handRanks, difficulty, seat, minBid, nDeck, opts) {
    opts = opts || {};
    var prof = profile(difficulty);
    var players = opts.players === 4 ? 4 : 3;
    var s = handStrength(handRanks, nDeck, {
      memory: prof.memory,
      discarded: opts.discarded,
      nDeck: nDeck
    });
    var level = prof.level;
    // 每档不同的叫分阈值：越聪明越敢叫（阈值越低）
    var th3, th2, th1;
    if (level === 0) { th3 = 42; th2 = 32; th1 = 26; }
    else if (level === 1) { th3 = 34; th2 = 24; th1 = 18; }
    else if (level === 2) { th3 = 28; th2 = 19; th1 = 14; }
    else { th3 = 24; th2 = 16; th1 = 12; }
    // 两副牌牌更多（34张/手），大牌密度低，适当下调叫分阈值
    if (nDeck === 2) { th3 -= 4; th2 -= 4; th1 -= 3; }
    // 四人局每人只 25 张，大牌密度更低，再下调
    if (players === 4) { th3 -= 5; th2 -= 4; th1 -= 3; }

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
    PROFILES: PROFILES,
    diffLevel: diffLevel,
    profile: profile,
    highLeft: highLeft,
    bigsLeft: bigsLeft,
    handStrength: handStrength,
    decideBid: decideBid,
    decidePlay: decidePlay,
    pickBestLead: pickBestLead,
    pickBestFollow: pickBestFollow,
    leadCandidates: leadCandidates,
    followCandidates: followCandidates,
    shouldPass: shouldPass,
    variedPick: variedPick
  };
});
