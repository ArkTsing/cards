/* ==========================================================================
   ai.js — 电脑叫分与出牌 AI（大师难度深度强化版 + 蒙特卡洛模拟）
   双端可用（浏览器 window.DDZAI / Node module.exports）
   优化：农民配合、地主压制、两副牌四人玩法、蒙特卡洛决策
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

  // ---- 难度档案（加入两副牌调整系数、蒙特卡洛参数） ----
  var PROFILES = {
    easy:   { level: 0, stablePick: .60, memory: false, bombUse: 'rare',    teamPlay: 'none', breakPairs: false, twoDeckBidAdjust: -6, mcEnabled: false },
    normal: { level: 1, stablePick: .72, memory: false, bombUse: 'current', teamPlay: 'basic', breakPairs: false, twoDeckBidAdjust: -4, mcEnabled: false },
    hard:   { level: 2, stablePick: .82, memory: true,  bombUse: 'smart',   teamPlay: 'deep',  breakPairs: true,  twoDeckBidAdjust: -3, mcEnabled: true,  mcTimeLimit: 200 },
    master: { level: 3, stablePick: 1.00, memory: true,  bombUse: 'optimal', teamPlay: 'deep',  breakPairs: true,  twoDeckBidAdjust: -2, mcEnabled: true,  mcTimeLimit: 500 }
  };
  function profile(d) { return PROFILES[d] || PROFILES.normal; }

  // ---------- 记牌器 ----------
  function remainingRanks(hand, discarded, nDeck) {
    var totalCount = {};
    for (var r = 3; r <= 17; r++) {
      totalCount[r] = (r === 16 || r === 17) ? nDeck : 4 * nDeck;
    }
    var seen = {};
    (hand || []).forEach(function (r) { seen[r] = (seen[r] || 0) + 1; });
    (discarded || []).forEach(function (r) { seen[r] = (seen[r] || 0) + 1; });
    var left = {};
    for (var r = 3; r <= 17; r++) {
      left[r] = Math.max(0, totalCount[r] - (seen[r] || 0));
    }
    return left;
  }

  function missingRanks(hand, discarded, nDeck) {
    var left = remainingRanks(hand, discarded, nDeck);
    var total = (nDeck === 2) ? { 16: 2, 17: 2, 3: 8, 4: 8, 5: 8, 6: 8, 7: 8, 8: 8, 9: 8, 10: 8, 11: 8, 12: 8, 13: 8, 14: 8, 15: 8 } : { 16: 1, 17: 1, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4, 9: 4, 10: 4, 11: 4, 12: 4, 13: 4, 14: 4, 15: 4 };
    var missing = {};
    for (var r in total) {
      if (left[r] === total[r]) missing[r] = true;
    }
    return missing;
  }

  // 计算最长可一手出的牌型长度（性能优化，避免全量 generateMoves）
  function calcMaxCover(ranks, nDeck) {
    var count = {};
    ranks.forEach(function (r) { count[r] = (count[r] || 0) + 1; });
    var kinds = Object.keys(count).map(Number).sort(function (a, b) { return a - b; });

    var maxStraight = 0, curStraight = 0, prev = -1;
    for (var i = 0; i < kinds.length; i++) {
      var r = kinds[i];
      if (r <= 14 && count[r] >= 1) {
        if (r === prev + 1) curStraight++;
        else curStraight = 1;
        if (curStraight >= 5) maxStraight = Math.max(maxStraight, curStraight);
        prev = r;
      } else { curStraight = 0; prev = -1; }
    }

    var maxPairStraight = 0, curPair = 0; prev = -1;
    for (var j = 0; j < kinds.length; j++) {
      var r2 = kinds[j];
      if (r2 <= 14 && count[r2] >= 2) {
        if (r2 === prev + 1) curPair++;
        else curPair = 1;
        if (curPair >= 3) maxPairStraight = Math.max(maxPairStraight, curPair);
        prev = r2;
      } else { curPair = 0; prev = -1; }
    }

    var maxPlane = 0, curPlane = 0; prev = -1;
    for (var k = 0; k < kinds.length; k++) {
      var r3 = kinds[k];
      if (r3 <= 14 && count[r3] >= 3) {
        if (r3 === prev + 1) curPlane++;
        else curPlane = 1;
        if (curPlane >= 2) maxPlane = Math.max(maxPlane, curPlane);
        prev = r3;
      } else { curPlane = 0; prev = -1; }
    }
    var planeWithWings = maxPlane * 5;

    var maxBombLen = 0;
    for (var r4 in count) {
      if (Number(r4) >= 3 && Number(r4) <= 15 && count[r4] >= 4) {
        maxBombLen = Math.max(maxBombLen, count[r4]);
      }
    }
    var rocketLen = (nDeck === 2) ? ((count[16] >= 2 && count[17] >= 2) ? 4 : 0) : ((count[16] && count[17]) ? 2 : 0);
    return Math.max(maxStraight, maxPairStraight * 2, maxPlane * 3, planeWithWings, maxBombLen, rocketLen);
  }

  // 高精度手牌强度（大师专用）
  function handStrengthMaster(ranks, nDeck, opts) {
    opts = opts || {};
    nDeck = nDeck === 2 ? 2 : 1;
    var score = 0;
    var count = {};
    ranks.forEach(function (r) { count[r] = (count[r] || 0) + 1; });

    Object.keys(count).forEach(function (k) {
      var r = Number(k), c = count[r];
      if (r >= 14) score += (r - 12) * 2;
      if (r === 16) score += 6;
      if (r === 17) score += 8;
      if (c === 4) score += 12;
      if (nDeck === 2 && c >= 5) score += 12 + (c - 4) * 6;
      if (c === 3) score += 2;
    });
    var hasRocket = nDeck === 2 ? (count[16] >= 2 && count[17] >= 2) : (count[16] >= 1 && count[17] >= 1);
    if (hasRocket) score += (nDeck === 2 ? 20 : 16);

    var maxCover = calcMaxCover(ranks, nDeck);
    var threshold = nDeck === 2 ? 14 : 8;
    if (maxCover >= threshold) score += 22;
    else if (maxCover >= (nDeck === 2 ? 10 : 5)) score += 12;

    var kinds = Object.keys(count).map(Number).sort(function (a, b) { return a - b; });
    var solo = 0;
    for (var i = 0; i < kinds.length; i++) {
      var r = kinds[i];
      if (r > 14) continue;
      if (count[r] === 1) {
        var hasLeft = kinds.indexOf(r - 1) > -1 && count[r - 1] >= 1;
        var hasRight = kinds.indexOf(r + 1) > -1 && count[r + 1] >= 1;
        if (!hasLeft && !hasRight) solo++;
      }
    }
    score -= solo * 3;

    if (opts.discarded) {
      var missing = missingRanks(ranks, opts.discarded, nDeck);
      for (var r2 = 3; r2 <= 15; r2++) {
        if (missing[r2] && !count[r2]) score -= (nDeck === 2 ? 6 : 4);
      }
    }

    if (opts.seat != null && opts.seat === 0) score -= 2;
    else if (opts.seat === (opts.players === 4 ? 3 : 2) && opts.minBid <= 1) score += 3;
    return Math.max(0, score);
  }

  function decideBid(handRanks, difficulty, seat, minBid, nDeck, opts) {
    opts = opts || {};
    var prof = profile(difficulty);
    var players = opts.players === 4 ? 4 : 3;
    var s;
    if (prof.level >= 3) {
      s = handStrengthMaster(handRanks, nDeck, { memory: true, discarded: opts.discarded, nDeck: nDeck, seat: seat, minBid: minBid, players: players });
    } else {
      s = handStrength(handRanks, nDeck, { memory: prof.memory, discarded: opts.discarded, nDeck: nDeck });
    }

    var level = prof.level;
    var th3, th2, th1;
    if (level === 0) { th3 = 42; th2 = 32; th1 = 26; }
    else if (level === 1) { th3 = 34; th2 = 24; th1 = 18; }
    else if (level === 2) { th3 = 28; th2 = 19; th1 = 14; }
    else { th3 = 22; th2 = 14; th1 = 10; }
    if (nDeck === 2) { th3 += prof.twoDeckBidAdjust; th2 += prof.twoDeckBidAdjust; th1 += prof.twoDeckBidAdjust; }
    if (players === 4) { th3 -= 5; th2 -= 4; th1 -= 3; }

    var want = 0, reason = '';
    if (s >= th3) { want = 3; reason = '牌型完整，强势叫3分'; }
    else if (s >= th2) { want = 2; reason = '牌力充足，叫2分'; }
    else if (s >= th1) { want = 1; reason = '可以一试，叫1分'; }
    else { want = 0; reason = '牌型零散，不叫'; }

    if (want > 0 && want <= minBid) {
      if (minBid < 3 && s >= th2 - 4) {
        want = minBid + 1;
        reason = '跟叫到' + want + '分';
      } else {
        want = 0;
        reason = '前面叫得高，保留实力';
      }
    }
    return { bid: want, reason: reason, strength: s };
  }

  function handStrength(ranks, nDeck, opts) {
    opts = opts || {};
    nDeck = nDeck === 2 ? 2 : 1;
    var score = 0;
    var count = {};
    ranks.forEach(function (r) { count[r] = (count[r] || 0) + 1; });
    Object.keys(count).forEach(function (k) {
      var r = Number(k), c = count[r];
      if (r >= 14) score += (r - 12) * 2;
      if (r === 16) score += 6;
      if (r === 17) score += 8;
      if (c === 4) score += 12;
      if (nDeck === 2 && c >= 5) score += 12 + (c - 4) * 6;
      if (c === 3) score += 2;
    });
    var hasRocket = nDeck === 2 ? (count[16] >= 2 && count[17] >= 2) : (count[16] >= 1 && count[17] >= 1);
    if (hasRocket) score += (nDeck === 2 ? 20 : 16);
    var kinds = Object.keys(count).map(Number).sort(function (a, b) { return a - b; });
    var seq = 0, best = 0;
    kinds.forEach(function (k) {
      if (k <= 14 && count[k] >= 1) { seq++; best = Math.max(best, seq); }
      else seq = 0;
    });
    score += Math.min(best, 6);
    if (opts.memory && opts.discarded) {
      var left = highLeft(ranks, opts.discarded, nDeck);
      var highOut = (4 * nDeck - left[14]) + (4 * nDeck - left[15]) + (nDeck - left[16]) + (nDeck - left[17]);
      score += Math.min(6, Math.round(highOut * 0.25));
    }
    return score;
  }

  function highLeft(hand, discarded, nDeck) {
    var total = { 14: 4 * nDeck, 15: 4 * nDeck, 16: nDeck, 17: nDeck };
    var seen = {};
    (hand || []).forEach(function (r) { seen[r] = (seen[r] || 0) + 1; });
    (discarded || []).forEach(function (r) { seen[r] = (seen[r] || 0) + 1; });
    var left = {};
    Object.keys(total).forEach(function (k) { left[k] = Math.max(0, total[k] - (seen[k] || 0)); });
    return left;
  }

  function bigsLeft(hand, discarded, nDeck) {
    var h = highLeft(hand, discarded, nDeck);
    return (h[14] || 0) + (h[15] || 0) + (h[16] || 0) + (h[17] || 0);
  }

  // ---------- 出牌评分 ----------
  function moveScore(ranks, nDeck) {
    var parsed = C.parseCards(ranks, nDeck);
    if (!parsed) return 999;
    var base = parsed.mainRank;
    var typePenalty = {
      single: 0, pair: 1, triple: 2,
      straight: -4, straight_pair: -3, plane_pure: -6, plane_one: -5, plane_pair: -5,
      four_two: -2, four_two_pair: -2,
      triple_one: 2, triple_pair: 2,
      bomb: 8, rocket: 10
    };
    var bombPenalty = 0;
    if (parsed.type === 'bomb') {
      if (nDeck === 2) bombPenalty = (parsed.len - 4) * 4;
    }
    return base + (typePenalty[parsed.type] || 0) + bombPenalty;
  }

  function shedAdjust(ranks, hand, nDeck, hc) {
    var parsed = C.parseCards(ranks, nDeck);
    if (!parsed) return 0;
    var remaining = hand.length - ranks.length;
    if (remaining === 0) return -40;
    if (parsed.type === 'single' && (hc[parsed.mainRank] || 0) > 1) return 12;
    return 0;
  }

  function variedPick(sorted, rng, stable) {
    if (!sorted || !sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    var s = (stable == null) ? 0.7 : stable;
    if (s >= 1.0) return sorted[0];
    var r = (rng || Math.random)();
    if (r < s) return sorted[0];
    if (r < (s + 0.18)) return sorted[Math.min(1, sorted.length - 1)];
    return sorted[Math.min(2, sorted.length - 1)];
  }

  function rankCounts(hand) {
    var hc = {};
    (hand || []).forEach(function (r) { hc[r] = (hc[r] || 0) + 1; });
    return hc;
  }

  // ---------- 位置与角色辅助 ----------
  function getNextSeat(seat, playerCount) { return (seat + 1) % playerCount; }
  function getPrevSeat(seat, playerCount) { return (seat - 1 + playerCount) % playerCount; }

  function getLandlordSeats(ctx) {
    var roles = ctx.roles || [];
    var seats = [];
    for (var i = 0; i < roles.length; i++) {
      if (roles[i] === 'landlord') seats.push(i);
    }
    return seats;
  }

  // ---------- 首出候选 ----------
  function leadCandidates(handRanks, nDeck, opts) {
    opts = opts || {};
    var prof = opts.profile || PROFILES.normal;
    var ctx = opts.ctx || {};
    var moves = C.generateMoves(handRanks, nDeck);
    var hc = rankCounts(handRanks);
    var cands = [];
    var bl = (prof.memory && ctx.discarded) ? bigsLeft(handRanks, ctx.discarded, nDeck) : null;
    var isMaster = prof.level >= 3;
    var mySeat = ctx.myIndex;
    var playerCount = (ctx.roles && ctx.roles.length) || 3;
    var roles = ctx.roles || [];
    var myRole = roles[mySeat] || (mySeat === ctx.landlordSeat ? 'landlord' : 'farmer');
    var landlordSeats = getLandlordSeats(ctx);
    var landlordSeat = landlordSeats[0];

    moves.forEach(function (m) {
      var parsed = C.parseCards(m, nDeck);
      if (!parsed) return;
      if (parsed.type === 'bomb' || parsed.type === 'rocket') return;
      if (parsed.type === 'single' && parsed.mainRank >= 14 && handRanks.length > 2) return;

      var sc = moveScore(m, nDeck) + shedAdjust(m, handRanks, nDeck, hc);

      if (prof.level >= 2 && (parsed.type === 'straight' || parsed.type === 'straight_pair' ||
          parsed.type === 'plane_pure' || parsed.type === 'plane_one' || parsed.type === 'plane_pair')) {
        sc -= 3;
      }

      if (isMaster && myRole === 'farmer' && landlordSeat != null) {
        var isUpstream = (getNextSeat(mySeat, playerCount) === landlordSeat);
        var isDownstream = (getPrevSeat(mySeat, playerCount) === landlordSeat);
        if (isUpstream && parsed.type === 'single' && parsed.mainRank >= 13 && parsed.mainRank <= 14) {
          sc -= 6;
        }
        if (isDownstream && parsed.type === 'single' && parsed.mainRank >= 13) {
          sc += 8;
        }
      }

      if (prof.breakPairs && parsed.type === 'single' && hc[parsed.mainRank] > 1) sc += 5;
      if (bl != null && parsed.type === 'single' && parsed.mainRank >= 15) {
        sc += (bl <= 2 ? 8 : (bl <= 4 ? 4 : 0));
      }

      if (isMaster && handRanks.length <= 6) {
        var remaining = handRanks.length - m.length;
        if (remaining === 0) sc -= 30;
        else if (remaining <= 3) sc -= 10;
      }

      cands.push({ ranks: m, score: sc });
    });

    if (!cands.length) {
      moves.forEach(function (m) {
        cands.push({ ranks: m, score: moveScore(m, nDeck) });
      });
    }
    cands.sort(function (a, b) { return a.score - b.score; });
    return cands.map(function (c) { return c.ranks; });
  }

  // ---------- 跟牌候选 ----------
  function followCandidates(handRanks, givenRanks, nDeck, opts) {
    opts = opts || {};
    var prof = opts.profile || PROFILES.normal;
    var ctx = opts.ctx || {};
    var beats = C.findBeats(handRanks, givenRanks, nDeck);
    if (!beats.length) return [];
    var given = C.parseCards(givenRanks, nDeck);
    var oppLeft = opts.oppLeft == null ? 99 : opts.oppLeft;
    var hc = rankCounts(handRanks);
    var bl = (prof.memory && ctx.discarded) ? bigsLeft(handRanks, ctx.discarded, nDeck) : null;
    var isMaster = prof.level >= 3;
    var roles = ctx.roles || [];
    var playerCount = roles.length || 3;
    var mySeat = ctx.myIndex;
    var myRole = roles[mySeat] || (mySeat === ctx.landlordSeat ? 'landlord' : 'farmer');
    var lastSeat = ctx.lastPlayerIndex;
    var lastRole = roles[lastSeat];
    var cands = [];
    var landlordSeats = getLandlordSeats(ctx);
    var landlordSeat = landlordSeats[0];

    var isOpponent = true;
    if (lastRole === 'landlord' && myRole === 'landlord') isOpponent = false;
    else if (lastRole === 'farmer' && myRole === 'farmer') isOpponent = false;

    beats.forEach(function (m) {
      var parsed = C.parseCards(m, nDeck);
      if (!parsed) return;
      var sc = moveScore(m, nDeck) + shedAdjust(m, handRanks, nDeck, hc);
      var remaining = handRanks.length - m.length;
      if (remaining === 0) sc -= 30;
      if (oppLeft <= 2) sc -= 6;

      if (parsed.type === 'bomb' || parsed.type === 'rocket') {
        var bombCost = 20;
        if (isMaster) {
          if (remaining <= 2) bombCost = 0;
          else {
            var afterHand = handRanks.slice();
            m.forEach(function (r) { var idx = afterHand.indexOf(r); if (idx > -1) afterHand.splice(idx, 1); });
            var afterMoves = C.generateMoves(afterHand, nDeck);
            var canFinish = afterMoves.some(function (am) { return am.length === afterHand.length; });
            bombCost = canFinish ? 0 : 25;
            if (nDeck === 2 && !canFinish) bombCost += 10;
          }
          if (isOpponent && oppLeft <= 2 && bombCost > 0) bombCost = 5;
        } else {
          bombCost = bombPenalty(parsed, given, oppLeft, prof);
        }
        sc += bombCost;
      }

      if (prof.level >= 2 && remaining <= 3) sc -= 4;
      if (prof.breakPairs && parsed.type === 'single' && hc[parsed.mainRank] > 1) sc += 4;
      if (bl != null && parsed.type === 'single' && parsed.mainRank >= 15) {
        sc += (bl <= 2 ? 8 : (bl <= 4 ? 4 : 0));
      }

      if (isMaster) {
        if (!isOpponent && myRole === 'farmer') {
          var minLandlordCount = 99;
          if (ctx.playerCounts) {
            landlordSeats.forEach(function (s) { minLandlordCount = Math.min(minLandlordCount, ctx.playerCounts[s]); });
          }
          if (remaining !== 0) sc += 20;
          var isLandlordDownstream = (landlordSeat != null && mySeat != null && getNextSeat(mySeat, playerCount) === landlordSeat);
          if (isLandlordDownstream && given && given.type === 'single' && given.mainRank <= 10 && parsed.type === 'single' && parsed.mainRank > given.mainRank && parsed.mainRank <= 14) {
            sc -= 15;
          }
          if (minLandlordCount <= 2 && remaining !== 0) sc -= 25;
          if (ctx.playerCounts && ctx.playerCounts[lastSeat] <= 2) sc += 30;
        }

        if (isOpponent) {
          if (myRole === 'farmer') {
            if (oppLeft <= 3) {
              if (parsed.type === 'single' && parsed.mainRank > given.mainRank && parsed.mainRank <= 14) sc -= 12;
              if (parsed.type === 'pair' && parsed.mainRank > given.mainRank && parsed.mainRank <= 12) sc -= 8;
            }
            if (given && given.type === 'single' && given.mainRank <= 10) {
              if (parsed.type === 'single' && parsed.mainRank >= 12 && parsed.mainRank <= 14) sc -= 10;
            }
          } else if (myRole === 'landlord') {
            if (oppLeft <= 2) sc -= 15;
            if (given && given.type === 'single' && given.mainRank <= 10 && parsed.type === 'single' && parsed.mainRank > given.mainRank) {
              sc -= 5;
            }
          }
        }

        if (parsed.type === 'single' && hc[parsed.mainRank] >= 4 && remaining > 0) sc += 30;
      }

      cands.push({ ranks: m, score: sc });
    });

    cands.sort(function (a, b) { return a.score - b.score; });
    return cands.map(function (c) { return c.ranks; });
  }

  function bombPenalty(parsed, given, oppLeft, prof) {
    var givenType = given ? given.type : '';
    if (givenType === 'bomb' || givenType === 'rocket') return 0;
    switch (prof.bombUse) {
      case 'rare':    return oppLeft <= 1 ? 6 : 999;
      case 'current': return 20;
      case 'smart':   return oppLeft <= 3 ? 0 : 40;
      case 'optimal': return oppLeft <= 4 ? 0 : 30;
      default: return 20;
    }
  }

  // ---------- 选牌入口（保留，供外部调用，内部不使用） ----------
  function pickBestLead(handRanks, opts) {
    opts = opts || {};
    var prof = opts.profile || PROFILES.normal;
    var ctx = opts.ctx || {};
    var sorted = leadCandidates(handRanks, opts.nDeck, { profile: prof, discarded: ctx.discarded, ctx: ctx });
    if (opts.variety === false) return sorted[0] || null;
    return variedPick(sorted, opts.rng, prof.stablePick);
  }

  function pickBestFollow(handRanks, givenRanks, opts) {
    opts = opts || {};
    var prof = opts.profile || PROFILES.normal;
    var ctx = opts.ctx || {};
    var oppLeft = ctx.playerCounts && ctx.lastPlayerIndex != null
      ? ctx.playerCounts[ctx.lastPlayerIndex]
      : (opts.oppLeft != null ? opts.oppLeft : 99);
    var sorted = followCandidates(handRanks, givenRanks, opts.nDeck, { profile: prof, oppLeft: oppLeft, discarded: ctx.discarded, ctx: ctx });
    if (!sorted.length) return null;
    if (opts.variety === false) return sorted[0];
    return variedPick(sorted, opts.rng, prof.stablePick);
  }

  // ---------- 是否过牌 ----------
  function shouldPass(ctx, beats, given, prof) {
    var hand = ctx.handRanks || [];
    var nDeck = ctx.nDeck === 2 ? 2 : 1;
    var roles = ctx.roles || [];
    var playerCount = roles.length || 3;
    var lastSeat = ctx.lastPlayerIndex;
    var myIndex = ctx.myIndex;
    var myRole = roles[myIndex];
    var lastRole = lastSeat != null ? roles[lastSeat] : undefined;
    var canFinish = beats.some(function (m) { return m.length === hand.length; });
    if (!beats || !beats.length) return true;
    var isMaster = prof.level >= 3;

    if (myRole === 'farmer' && lastRole === 'farmer') {
      if (canFinish) return false;
      if (ctx.playerCounts && ctx.playerCounts[lastSeat] <= 2) return true;
      var landlordSeats = getLandlordSeats(ctx);
      var minLandlordCount = 99;
      landlordSeats.forEach(function (s) { if (ctx.playerCounts) minLandlordCount = Math.min(minLandlordCount, ctx.playerCounts[s]); });
      if (minLandlordCount <= 2) return false;
      if (isMaster && given && given.type === 'single' && given.mainRank <= 10) {
        var hasMediumBeat = beats.some(function (m) {
          var p = C.parseCards(m, nDeck);
          return p && p.type === 'single' && p.mainRank > given.mainRank && p.mainRank <= 14;
        });
        if (hasMediumBeat) return false;
      }
      var landlordSeat = landlordSeats[0];
      if (landlordSeat != null && myIndex != null && getNextSeat(myIndex, playerCount) === landlordSeat && given && given.type === 'single' && given.mainRank <= 10) {
        var hasMediumBeat2 = beats.some(function (m) {
          var p = C.parseCards(m, nDeck);
          return p && p.type === 'single' && p.mainRank > given.mainRank && p.mainRank <= 14;
        });
        if (hasMediumBeat2) return false;
      }
      return true;
    }

    var oppCount = ctx.playerCounts && lastSeat != null ? ctx.playerCounts[lastSeat] : 99;
    if (canFinish) return false;
    if (oppCount <= 3) return false;
    if (hand.length <= 3) return false;

    var hasBombOnly = beats.every(function (m) {
      var p = C.parseCards(m, nDeck);
      return p && (p.type === 'bomb' || p.type === 'rocket');
    });
    if (hasBombOnly) {
      if (hand.length >= (nDeck === 2 ? 12 : 6)) return true;
      return false;
    }

    if (prof.level <= 1) return false;

    if (isMaster && given && given.type === 'single' && given.mainRank <= 10) {
      return false;
    }

    if (oppCount > 6) {
      var minFollowRank = Infinity;
      beats.forEach(function (m) {
        var p = C.parseCards(m, nDeck);
        if (p && p.mainRank < minFollowRank) minFollowRank = p.mainRank;
      });
      if (isMaster && minFollowRank >= 16) return true;
      if (!isMaster && minFollowRank >= 15) return true;
    }
    return false;
  }

  // ---------- 蒙特卡洛模拟模块 ----------
  // 将手牌数组随机分配给其他玩家
  function sampleOpponentHands(ctx, hand) {
    var roles = ctx.roles || [];
    var playerCount = roles.length;
    var nDeck = ctx.nDeck === 2 ? 2 : 1;
    var discarded = ctx.discarded || [];
    var totalRemaining = [];
    for (var r = 3; r <= 17; r++) {
      var total = (r === 16 || r === 17) ? nDeck : 4 * nDeck;
      var seen = (hand.filter(function(x){return x===r;}).length) + (discarded.filter(function(x){return x===r;}).length);
      var left = total - seen;
      for (var i = 0; i < left; i++) totalRemaining.push(r);
    }
    // 玩家手牌数量约束
    var counts = (ctx.playerCounts || []).slice();
    // 减去自己和已经出牌玩家的手牌数（假设其他玩家手牌数已知）
    // 这里我们默认 counts 中每个玩家的剩余张数已知
    var otherSeats = [];
    for (var seat = 0; seat < playerCount; seat++) {
      if (seat !== ctx.myIndex) otherSeats.push(seat);
    }
    // 随机打乱剩余牌
    shuffle(totalRemaining);
    var hands = {};
    for (var j = 0; j < otherSeats.length; j++) {
      var seat = otherSeats[j];
      var cnt = counts[seat] || 0;
      hands[seat] = totalRemaining.splice(0, cnt);
    }
    // 如果还有剩余牌（可能因为 counts 不准确），忽略
    return hands;
  }

  // Fisher–Yates 洗牌
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = arr[i]; arr[i] = arr[j]; arr[j] = temp;
    }
    return arr;
  }

  // 模拟一个简短牌局：从当前玩家出牌开始，直到某玩家手牌清空或达到最大步数
  function simulateGame(ctx, startAction, sampledHands) {
    var roles = ctx.roles.slice();
    var playerCount = roles.length;
    var nDeck = ctx.nDeck === 2 ? 2 : 1;
    var discarded = ctx.discarded.slice();
    var playerCounts = ctx.playerCounts.slice();
    // 创建手牌副本
    var hands = {};
    for (var i = 0; i < playerCount; i++) {
      hands[i] = (i === ctx.myIndex) ? ctx.handRanks.slice() : (sampledHands[i] || []).slice();
    }
    var landlordSeats = getLandlordSeats(ctx);
    var myRole = roles[ctx.myIndex];

    // 执行自己的初始出牌
    var currentSeat = ctx.myIndex;
    var currentPlay = startAction;
    var action = startAction;
    if (action) {
      action.forEach(function(r) {
        var idx = hands[ctx.myIndex].indexOf(r);
        if (idx > -1) hands[ctx.myIndex].splice(idx, 1);
      });
      playerCounts[ctx.myIndex] = hands[ctx.myIndex].length;
      discarded = discarded.concat(action);
    }
    var lastPlaySeat = ctx.myIndex;
    // 下一位
    currentSeat = getNextSeat(currentSeat, playerCount);

    var maxSteps = 100; // 防止无限循环
    var steps = 0;

    while (steps < maxSteps) {
      steps++;
      // 检查当前玩家是否已出完
      if (hands[currentSeat].length === 0) {
        return isWinner(currentSeat, landlordSeats, roles);
      }

      // 为当前玩家构建上下文
      var ctxCopy = {
        handRanks: hands[currentSeat],
        lastPlay: currentPlay,
        lastPlayerIndex: lastPlaySeat,
        myIndex: currentSeat,
        roles: roles,
        playerCounts: playerCounts,
        discarded: discarded,
        nDeck: nDeck,
        difficulty: 'normal', // 模拟时用普通难度，避免递归
        landlordSeat: landlordSeats[0]
      };
      var action = decidePlaySimple(ctxCopy);
      if (action === null) {
        // 过牌
        currentSeat = getNextSeat(currentSeat, playerCount);
        continue;
      }
      // 出牌
      action.forEach(function(r) {
        var idx = hands[currentSeat].indexOf(r);
        if (idx > -1) hands[currentSeat].splice(idx, 1);
      });
      playerCounts[currentSeat] = hands[currentSeat].length;
      discarded = discarded.concat(action);
      currentPlay = action;
      lastPlaySeat = currentSeat;
      currentSeat = getNextSeat(currentSeat, playerCount);
    }
    // 达到最大步数，用牌力评估近似
    return estimateWinProb(hands, myRole, landlordSeats);
  }

  // 非蒙特卡洛的简单决策函数（用于模拟内部）
  function decidePlaySimple(ctx) {
    var hand = ctx.handRanks;
    var last = ctx.lastPlay;
    var nDeck = ctx.nDeck === 2 ? 2 : 1;
    var prof = PROFILES.normal; // 模拟时使用普通难度，避免复杂策略和递归
    if (last && ctx.lastPlayerIndex != null && ctx.lastPlayerIndex !== ctx.myIndex) {
      var beats = C.findBeats(hand, last, nDeck);
      if (shouldPass(ctx, beats, C.parseCards(last, nDeck), prof)) return null;
      // 简化：选择最小的可行牌
      return beats[0] || null;
    } else {
      // 首出：简单选择最小的单张
      var sorted = hand.slice().sort(function(a,b){return a-b;});
      return [sorted[0]];
    }
  }

  function isWinner(seat, landlordSeats, roles) {
    var seatRole = roles[seat];
    if (landlordSeats.indexOf(seat) > -1) {
      return seatRole === 'landlord'; // 地主自己赢
    } else {
      return seatRole !== 'landlord'; // 农民赢
    }
  }

  function estimateWinProb(hands, myRole, landlordSeats) {
    // 简化：根据剩余手牌总数判断，农民队与地主队的牌量对比
    var landlordCount = 0, farmerCount = 0;
    for (var seat in hands) {
      var role = (landlordSeats.indexOf(Number(seat)) > -1) ? 'landlord' : 'farmer';
      var cnt = hands[seat].length;
      if (role === 'landlord') landlordCount += cnt;
      else farmerCount += cnt;
    }
    var prob = farmerCount < landlordCount ? 0.6 : 0.4;
    if (myRole === 'landlord') {
      return 1 - prob;
    } else {
      return prob;
    }
  }

  // 蒙特卡洛决策：评估候选动作
  function monteCarloDecision(ctx, candidates, timeLimitMs) {
    if (!ctx.playerCounts || !ctx.roles || !ctx.handRanks) {
      return candidates[0]; // 如果缺少必要信息，直接返回规则首选
    }
    var startTime = Date.now();
    var bestAction = candidates[0];
    var bestScore = -Infinity;
    var nSims = 0;

    for (var i = 0; i < candidates.length; i++) {
      var action = candidates[i];
      var wins = 0, total = 0;
      while (Date.now() - startTime < timeLimitMs) {
        // 随机分配对手手牌
        var sampled = sampleOpponentHands(ctx, ctx.handRanks);
        // 模拟
        var win = simulateGame(ctx, action, sampled);
        if (win) wins++;
        total++;
      }
      if (total > 0) {
        var winRate = wins / total;
        // 融合规则评分：规则分越低越好，胜率越高越好
        var ruleScore = moveScore(action, ctx.nDeck === 2 ? 2 : 1);
        // 规则分归一化（这里简单处理，假设在0~100之间）
        var normRule = Math.min(1, ruleScore / 100);
        var combined = winRate * 0.8 + (1 - normRule) * 0.2;
        if (combined > bestScore) {
          bestScore = combined;
          bestAction = action;
        }
      }
      nSims += total;
      if (Date.now() - startTime >= timeLimitMs) break;
    }
    // 如果模拟次数太少，回退到规则选择
    if (nSims < 10) {
      return candidates[0];
    }
    return bestAction;
  }

  // ---------- 主入口 decidePlay（集成蒙特卡洛，修正候选列表处理） ----------
  function decidePlay(ctx) {
    var hand = ctx.handRanks || [];
    var last = ctx.lastPlay;
    var nDeck = ctx.nDeck === 2 ? 2 : 1;
    var prof = profile(ctx.difficulty);
    var seatRng = ctx.seatRng || Math.random;
    var mcEnabled = prof.mcEnabled !== false;
    var mcTimeLimit = prof.mcTimeLimit || 200;

    if (ctx.disableMC) mcEnabled = false;

    // 跟牌阶段
    if (last && ctx.lastPlayerIndex != null && ctx.lastPlayerIndex !== ctx.myIndex) {
      var beats = C.findBeats(hand, last, nDeck);
      if (shouldPass(ctx, beats, C.parseCards(last, nDeck), prof)) return null;

      var canFinish = beats.some(function (m) { return m.length === hand.length; });
      if (canFinish) {
        // 直接获胜，选择最优的获胜牌型
        var winMoves = beats.filter(function (m) { return m.length === hand.length; });
        var bestWin = null;
        var bestScore = Infinity;
        winMoves.forEach(function (m) {
          var sc = moveScore(m, nDeck);
          if (sc < bestScore) { bestScore = sc; bestWin = m; }
        });
        return bestWin;
      }

      // 获取排序后的候选列表
      var candidates = followCandidates(hand, last, nDeck, {
        profile: prof,
        oppLeft: ctx.playerCounts && ctx.lastPlayerIndex != null ? ctx.playerCounts[ctx.lastPlayerIndex] : 99,
        discarded: ctx.discarded,
        ctx: ctx
      });
      if (!candidates || candidates.length === 0) return null;

      // 如果启用蒙特卡洛且手牌数量较少，使用模拟
      if (mcEnabled && hand.length <= 10) {
        var topCandidates = candidates.slice(0, 3);
        var bestAction = monteCarloDecision(ctx, topCandidates, mcTimeLimit);
        return bestAction;
      } else {
        // 普通选择：根据稳定度选择
        return variedPick(candidates, seatRng, prof.stablePick);
      }
    }

    // 首出阶段
    var opts = { profile: prof, discarded: ctx.discarded, ctx: ctx };
    var candidates = leadCandidates(hand, nDeck, opts);
    if (!candidates || candidates.length === 0) return null;

    // 手牌少时禁用随机，直接用最优
    var useVariety = hand.length > 6; // 原来逻辑是 hand.length <= 6 时 variety=false
    if (mcEnabled && hand.length <= 12) {
      var topCandidates = candidates.slice(0, 3);
      var bestLead = monteCarloDecision(ctx, topCandidates, mcTimeLimit);
      return bestLead;
    } else {
      if (useVariety) {
        return variedPick(candidates, seatRng, prof.stablePick);
      } else {
        return candidates[0];
      }
    }
  }

  // ---------- 导出 ----------
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
    variedPick: variedPick,
    monteCarloDecision: monteCarloDecision // 暴露供调试
  };
});
