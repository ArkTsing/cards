/* ==========================================================================
   hint.js — 提示引擎：当前局面该出什么 + 为什么（教学核心）
   浏览器 window.DDZHint / Node module.exports 双端
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./cards.js'), require('./ai.js'));
  } else {
    root.DDZHint = factory(root.DDZCards, root.DDZAI);
  }
})(typeof self !== 'undefined' ? self : this, function (C, AI) {
  'use strict';

  // 给真人玩家当前局面的建议
  // ctx: { handRanks, lastPlay: ranks|null, lastSeat, myIndex, roles, teammateCount }
  function suggest(ctx) {
    var hand = ctx.handRanks;
    var last = ctx.lastPlay;
    var needBeat = last && ctx.lastSeat !== ctx.myIndex;

    if (!needBeat) {
      // 自由出
      var lead = AI.pickBestLead(hand);
      if (!lead) {
        return { move: null, text: '这一手您随便出，尽量先出小的。', title: '自由出牌' };
      }
      var parsed = C.parseCards(lead);
      var name = C.typeName(parsed.type);
      var why = freeWhy(parsed, hand, lead);
      return {
        move: lead,
        title: '建议出：' + C.describe(lead),
        text: why
      };
    }

    // 需要压上家
    var beats = C.findBeats(hand, last);
    if (!beats.length) {
      // 有炸弹/火箭也可以压，但这里判断是否值得
      var hasBomb = C.findBeats(hand, last).some(function (m) {
        var p = C.parseCards(m);
        return p.type === 'bomb' || p.type === 'rocket';
      });
      if (hasBomb && hand.length >= 8) {
        return { move: null, title: '建议：先不要', text: '您有炸弹可以压，但现在不着急。炸弹留在关键时候用更值。先不要。' };
      }
      return { move: null, title: '建议：不要', text: '您压不过「' + C.describe(last) + '」，选择"不要"就好，不丢人。' };
    }

    // 有能压的，选最小的
    var best = null, bestScore = 999;
    beats.forEach(function (m) {
      var parsed = C.parseCards(m);
      var sc = parsed.mainRank;
      if (parsed.type === 'bomb' || parsed.type === 'rocket') sc += 30;
      if (hand.length - m.length === 0) sc -= 40; // 出完就赢
      if (sc < bestScore) { bestScore = sc; best = m; }
    });
    var bp = C.parseCards(best);
    var bt = C.parseCards(last);
    var text;
    if (bp.type === 'bomb' || bp.type === 'rocket') {
      text = '您可以用「' + C.describe(best) + '」压过对方的「' + C.describe(last) + '」。这一手值得炸一下，拿到出牌权。';
    } else {
      text = '用「' + C.describe(best) + '」压过对方的「' + C.describe(last) + '」——这是最小的能压住的牌，不浪费大牌。';
    }
    return { move: best, title: '建议出：' + C.describe(best), text: text };
  }

  // 自由出牌时的一句话理由
  function freeWhy(parsed, hand, move) {
    switch (parsed.type) {
      case 'straight':
        return '出「' + C.describe(move) + '」，先把连着的牌一次清掉，减少手里的"手数"。';
      case 'straight_pair':
        return '出「' + C.describe(move) + '」这种连对，一次能带走好几手牌，很划算。';
      case 'plane_pure':
      case 'plane_one':
      case 'plane_pair':
        return '出飞机「' + C.describe(move) + '」，一次性清掉很多牌，是很好的开局。';
      case 'single':
        if (parsed.mainRank >= 14) {
          return '手里只剩大牌单张了，可以先出一张试试。';
        }
        return '先出最小的单牌「' + C.describe(move) + '」，把不好搭配的小牌先甩掉。';
      case 'pair':
        return '出对子「' + C.describe(move) + '」，先清掉小对子。';
      case 'triple':
        return '出三张「' + C.describe(move) + '」。';
      case 'triple_one':
      case 'triple_pair':
        return '出「' + C.describe(move) + '」，三张带上多余的牌一起出。';
      case 'four_two':
      case 'four_two_pair':
        return '出「' + C.describe(move) + '」，四张带上小牌，清牌很快。';
      default:
        return '出「' + C.describe(move) + '」。';
    }
  }

  // 多套建议：主推 + 备选（用户要求"多几套、随机、可变、稳定"）
  // 返回最多 n 套不同建议，每套 { move, title, text }，move 为 null 表示"不要"。
  function suggestMultiple(ctx, n) {
    n = n || 3;
    var hand = ctx.handRanks;
    var last = ctx.lastPlay;
    var needBeat = last && ctx.lastSeat !== ctx.myIndex;
    var out = [];

    if (!needBeat) {
      // 自由出：从 AI 的候选中挑几套不同的（都合法、都合理）
      var leads = AI.leadCandidates(hand);
      leads.forEach(function (m) {
        var parsed = C.parseCards(m);
        if (parsed.type === 'bomb' || parsed.type === 'rocket') return;
        if (parsed.type === 'single' && parsed.mainRank >= 14 && hand.length > 2) return;
        if (out.length >= n) return;
        out.push({
          move: m,
          title: C.describe(m),
          text: freeWhy(parsed, hand, m)
        });
      });
      if (!out.length) {
        // 只剩大单/炸弹等
        out.push({ move: null, title: '随便出', text: '这一手您随便出，尽量先出小的。' });
      }
      return out.slice(0, n);
    }

    // 需要压上家
    var beats = C.findBeats(hand, last);
    if (!beats.length) {
      out.push({ move: null, title: '建议：不要', text: '您压不过「' + C.describe(last) + '」，选择"不要"就好，不丢人。' });
      return out;
    }

    // 把能压的牌按"划算程度"排序，取前几套
    var cands = AI.followCandidates(hand, last);
    cands.forEach(function (m) {
      if (out.length >= n) return;
      var parsed = C.parseCards(m);
      var text;
      if (parsed.type === 'bomb' || parsed.type === 'rocket') {
        text = '用「' + C.describe(m) + '」压过对方的「' + C.describe(last) + '」。这一手值得炸一下，拿到出牌权。';
      } else {
        text = '用「' + C.describe(m) + '」压过对方的「' + C.describe(last) + '」——这是比较划算的压法，不浪费大牌。';
      }
      out.push({ move: m, title: C.describe(m), text: text });
    });
    // 如果还有位置，补一个"不要"作为备选
    if (out.length < n && hand.length > 2) {
      out.push({ move: null, title: '也可以：先不要', text: '这一手可以不压，留着大牌等更关键的时候再用。' });
    }
    return out.slice(0, n);
  }

  // 电脑出牌的讲解（练习模式用）
  function explainAIPlay(seatName, ranks) {
    if (!ranks) return seatName + ' 选择"不要"。';
    var parsed = C.parseCards(ranks);
    if (!parsed) return seatName + ' 出了一手牌。';
    var desc = C.describe(ranks);
    switch (parsed.type) {
      case 'single':
        return seatName + ' 出了一张 ' + C.RANK_LABEL[parsed.mainRank] + '。单牌一张一张出，比较小就先出。';
      case 'pair':
        return seatName + ' 出了一对 ' + C.RANK_LABEL[parsed.mainRank] + '。';
      case 'triple':
        return seatName + ' 出了三张 ' + C.RANK_LABEL[parsed.mainRank] + '。';
      case 'straight':
        return seatName + ' 出了一个顺子（' + desc + '），一次走了 5 张牌。';
      case 'bomb':
        return '炸！' + seatName + ' 出了一个炸弹（四个' + C.RANK_LABEL[parsed.mainRank] + '），倍数翻倍了！';
      case 'rocket':
        return '王炸！' + seatName + ' 打出了火箭，这是最大的牌！';
      case 'triple_one':
      case 'triple_pair':
      case 'plane_pure':
      case 'plane_one':
      case 'plane_pair':
      case 'four_two':
      case 'four_two_pair':
        return seatName + ' 出了「' + desc + '」。';
      default:
        return seatName + ' 出了「' + desc + '」。';
    }
  }

  // 叫分建议
  function suggestBid(handRanks, minBid) {
    var r = AI.decideBid(handRanks, 'normal', 2, minBid);
    if (r.bid === 0) {
      return { bid: 0, title: '建议：不叫', text: r.reason + '。叫分越高，倍数越大，输赢也越大。牌不好就先不叫。' };
    }
    return { bid: r.bid, title: '建议叫 ' + r.bid + ' 分', text: r.reason + '。您觉得呢？' };
  }

  return {
    suggest: suggest,
    suggestMultiple: suggestMultiple,
    suggestBid: suggestBid,
    explainAIPlay: explainAIPlay
  };
});
