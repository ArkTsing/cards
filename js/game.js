/* ==========================================================================
   game.js — 对局状态机（发牌 → 叫地主 → 出牌 → 结算）
   纯逻辑，不依赖 DOM；浏览器 window.DDZGame / Node module.exports 双端
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./cards.js'), require('./ai.js'));
  } else {
    root.DDZGame = factory(root.DDZCards, root.DDZAI);
  }
})(typeof self !== 'undefined' ? self : this, function (C, AI) {
  'use strict';

  var BASE_SCORE = 1;

  // 创建新对局
  // opts.nDeck: 1（一副，54张）| 2（两副，108张，每手34张+6底牌）
  function createGame(opts) {
    opts = opts || {};
    var difficulty = opts.difficulty || 'normal';
    var humanSeat = opts.humanSeat || 2;   // 0/1 为电脑，2 为真人（下方）
    var nDeck = opts.nDeck === 2 ? 2 : 1;

    var d = C.deal(nDeck);
    // hands: 3 个「牌对象」数组（降序）；ranks 方法供逻辑使用
    var hands = d.hands.map(function (h) { return h.sort(cmpDescObj); });
    var bottom = d.bottom.sort(cmpDescObj);

    return {
      phase: 'bidding',        // bidding | playing | ended
      difficulty: difficulty,
      humanSeat: humanSeat,
      nDeck: nDeck,
      perHand: d.perHand,
      bottomCount: d.bottomCount,
      hands: hands,            // 3 个牌对象数组（降序）
      bottom: bottom,          // 底牌（牌对象）：1副3张 / 2副6张
      roles: ['farmer', 'farmer', 'farmer'],   // 初始都是农民，选出地主后改
      landlord: -1,
      bidValue: 0,
      bidHistory: [],
      currentBidder: Math.floor(Math.random() * 3), // 第一个叫分的人
      highestBid: 0,
      passes: 0,               // 连续 pass 数（叫分阶段用）
      // 出牌阶段
      currentPlayer: -1,
      lastPlay: null,          // 当前"必须压"的基准牌 { cards, ranks, seat, parsed }
      lastPlays: [],           // 最近一圈各家出的牌（按座位索引 0/1/2），同时显示用
      passStreak: 0,
      bombs: 0,
      spring: false,           // 春天（结算时判断）
      winner: -1,
      winnerRole: null,
      multiplier: 1,
      scores: [0, 0, 0],
      log: []
    };
  }

  function cmpDesc(a, b) { return b - a; }
  function cmpDescObj(a, b) { return b.rank - a.rank; }
  function ranksOf(cards) { return cards.map(function (c) { return c.rank; }).sort(cmpDesc); }
  function rankOf(entry) { return typeof entry === 'object' ? entry.rank : entry; }

  // 叫分阶段：当前玩家叫分
  // bid: 0=不叫, 1/2/3
  function placeBid(game, bid) {
    if (game.phase !== 'bidding') return { ok: false, msg: '现在不是叫分阶段' };
    var seat = game.currentBidder;
    if (seat === game.humanSeat) {
      // 真人的叫分由 UI 调用
    }
    if (bid < 0 || bid > 3) return { ok: false, msg: '叫分只能是 0~3' };
    if (bid > 0 && bid <= game.highestBid) return { ok: false, msg: '必须叫比之前更高的分' };

    game.bidHistory.push({ seat: seat, bid: bid });
    if (bid > game.highestBid) {
      game.highestBid = bid;
      game.landlord = seat;
      game.bidValue = bid;
    }
    game.passes = 0;

    // 下一家
    game.currentBidder = (seat + 1) % 3;
    // 判断叫分是否结束：轮完一圈，或者有人叫了 3 分
    var done = false;
    if (game.highestBid === 3) done = true;
    if (game.bidHistory.length >= 3) done = true; // 3 人各叫过一次

    if (!done) {
      return { ok: true, bid: bid, next: game.currentBidder, finished: false };
    }

    // 叫分结束
    if (game.landlord === -1) {
      // 无人叫地主 → 重发
      return { ok: true, bid: bid, finished: true, restart: true };
    }

    // 地主拿底牌
    game.hands[game.landlord] = game.hands[game.landlord].concat(game.bottom).sort(cmpDescObj);
    game.roles[game.landlord] = 'landlord';
    game.multiplier = game.bidValue; // 叫分倍数（1/2/3）
    game.phase = 'playing';
    game.currentPlayer = game.landlord;
    return { ok: true, bid: bid, finished: true, landlord: game.landlord, multiplier: game.multiplier };
  }

  // 出牌：seat 出一手牌（ranks 数组）或 pass（null）
  function playCards(game, seat, ranksOrCards) {
    if (game.phase !== 'playing') return { ok: false, msg: '对局已结束' };
    if (seat !== game.currentPlayer) return { ok: false, msg: '还没轮到您' };

    var hand = game.hands[seat];

    if (ranksOrCards === null) {
      // 不要
      if (game.lastPlay && game.lastPlay.seat !== seat) {
        game.passStreak++;
        recordLastPlay(game, seat, null);
        game.log.push({ seat: seat, type: 'pass' });
        return advance(game, seat, null);
      }
      return { ok: false, msg: '您是上一手出牌的人，必须出牌' };
    }

    // 支持传入 rank 数组或牌对象数组
    var cards = [];
    var given = ranksOrCards;
    var isCards = given.length && typeof given[0] === 'object';
    var handIsCards = hand.length && typeof hand[0] === 'object';
    var pool = hand.slice();
    if (isCards) {
      // 传入牌对象：按 uid（优先）/ id 匹配
      given.forEach(function (c) {
        for (var i = 0; i < pool.length; i++) {
          if (pool[i].uid === c.uid || (pool[i].uid == null && pool[i].id === c.id)) { cards.push(pool[i]); pool.splice(i, 1); break; }
        }
      });
    } else {
      // 传入 rank 数组：按 rank 匹配
      given.forEach(function (r) {
        for (var i = 0; i < pool.length; i++) {
          if (rankOf(pool[i]) === r) { cards.push(pool[i]); pool.splice(i, 1); break; }
        }
      });
    }
    if (cards.length !== given.length) {
      return { ok: false, msg: '这张牌不在您手里' };
    }
    var ranksSorted = cards.map(rankOf).sort(cmpDesc);
    var nDeck = game.nDeck === 2 ? 2 : 1;

    var parsed = C.parseCards(ranksSorted, nDeck);
    if (!parsed) return { ok: false, msg: '这不是一个合法的出牌' };

    // 校验能压过上家
    if (game.lastPlay && game.lastPlay.seat !== seat) {
      if (!C.canBeat(parsed, C.parseCards(game.lastPlay.ranks, nDeck), nDeck)) {
        return { ok: false, msg: '压不过上家，要选"不要"哦' };
      }
    }

    // 执行
    game.hands[seat] = pool;
    if (parsed.type === 'bomb' || parsed.type === 'rocket') {
      game.bombs++;
      game.multiplier *= 2;
    }
    game.lastPlay = { cards: cards.slice(), ranks: ranksSorted, seat: seat, parsed: parsed };
    recordLastPlay(game, seat, { cards: cards.slice(), ranks: ranksSorted, parsed: parsed });
    game.passStreak = 0;
    game.log.push({ seat: seat, type: 'play', cards: cards.slice(), ranks: ranksSorted });

    if (pool.length === 0) {
      // 有人出完了
      return finishGame(game, seat);
    }

    return advance(game, seat, parsed);
  }

  // 记录这一家最近一次出的牌（null 表示"不要"），供牌桌同时显示左右两家的牌
  function recordLastPlay(game, seat, play) {
    if (!Array.isArray(game.lastPlays)) game.lastPlays = [];
    if (play === null) {
      game.lastPlays[seat] = null;
    } else {
      game.lastPlays[seat] = {
        cards: (play.cards || []).slice(),
        ranks: (play.ranks || []).slice(),
        parsed: play.parsed || null
      };
    }
  }

  function makeErr(msg) { var e = new Error(msg); e.isExpected = true; return e; }

  function advance(game, seat, parsed) {
    game.currentPlayer = (seat + 1) % 3;
    // 若连续两家 pass，则最后出牌者重新自由出
    if (game.passStreak >= 2) {
      game.lastPlay = null;
      game.passStreak = 0;
      // 新的一圈开始：清掉牌桌上的各家牌，重新累积
      game.lastPlays = [];
    }
    return {
      ok: true,
      next: game.currentPlayer,
      lastPlay: game.lastPlay,
      canFreePlay: game.lastPlay === null
    };
  }

  function finishGame(game, winnerSeat) {
    game.phase = 'ended';
    game.winner = winnerSeat;
    game.winnerRole = game.roles[winnerSeat];

    // 春天判定：若地主先出完，且农民从未出过牌（无 lastPlay 由农民产生的记录）
    // 简化：记录农民是否出过牌
    // 在 playCards 里没有记录……这里从 log 判断
    var farmerPlayed = game.log.some(function (l) {
      return l.type === 'play' && game.roles[l.seat] === 'farmer';
    });
    var landlordPlayed = game.log.some(function (l) {
      return l.type === 'play' && game.roles[l.seat] === 'landlord';
    });
    if (game.winnerRole === 'landlord' && !farmerPlayed) {
      game.spring = true;
      game.multiplier *= 2;
    }
    if (game.winnerRole === 'farmer' && !landlordPlayed) {
      game.spring = true;
      game.multiplier *= 2; // 反春天
    }

    // 结算
    var base = BASE_SCORE;
    var total = base * game.multiplier;
    if (game.winnerRole === 'landlord') {
      game.scores[game.landlord] = total * 2;
      game.scores[(game.landlord + 1) % 3] = -total;
      game.scores[(game.landlord + 2) % 3] = -total;
    } else {
      game.scores[game.landlord] = -total * 2;
      game.scores[(game.landlord + 1) % 3] = total;
      game.scores[(game.landlord + 2) % 3] = total;
    }

    return {
      ok: true,
      finished: true,
      winner: winnerSeat,
      winnerRole: game.winnerRole,
      landlord: game.landlord,
      spring: game.spring,
      multiplier: game.multiplier,
      base: base,
      scores: game.scores
    };
  }

  // 获取当前状态摘要（供 UI 渲染 / AI）
  function getState(game) {
    return {
      phase: game.phase,
      hands: game.hands,
      handRanks: game.hands.map(function (h) { return ranksOf(h); }),
      bottom: game.bottom,
      bottomRanks: ranksOf(game.bottom),
      roles: game.roles,
      landlord: game.landlord,
      nDeck: game.nDeck || 1,
      currentPlayer: game.currentPlayer,
      currentBidder: game.currentBidder,
      highestBid: game.highestBid,
      bidHistory: game.bidHistory,
      lastPlay: game.lastPlay,
      lastPlayRanks: game.lastPlay ? game.lastPlay.ranks : null,
      lastPlaySeat: game.lastPlay ? game.lastPlay.seat : -1,
      lastPlays: game.lastPlays || [],   // 牌桌各家牌：lastPlays[0/1/2] = {cards,ranks,parsed} | null(不要)
      multiplier: game.multiplier,
      bombs: game.bombs,
      humanSeat: game.humanSeat,
      scores: game.scores,
      winner: game.winner,
      winnerRole: game.winnerRole
    };
  }

  return {
    BASE_SCORE: BASE_SCORE,
    createGame: createGame,
    placeBid: placeBid,
    playCards: playCards,
    getState: getState
  };
});
