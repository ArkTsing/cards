/* ==========================================================================
   cards.js — 牌定义、洗牌、牌型识别、大小比较、合法出牌生成
   纯逻辑模块，浏览器 (window.DDZCards) 与 Node (module.exports) 双端可用
   rank 映射：3=3 … 10=10, J=11, Q=12, K=13, A=14, 2=15, 小王=16, 大王=17
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DDZCards = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SUITS = { S: '黑桃', H: '红桃', D: '方块', C: '梅花' };
  var SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
  var SUIT_IMG = { S: 'spade', H: 'heart', D: 'diamond', C: 'club' };
  var RANK_LABEL = {};
  for (var r = 3; r <= 10; r++) RANK_LABEL[r] = String(r);
  RANK_LABEL[11] = 'J'; RANK_LABEL[12] = 'Q'; RANK_LABEL[13] = 'K';
  RANK_LABEL[14] = 'A'; RANK_LABEL[15] = '2';
  RANK_LABEL[16] = '小王'; RANK_LABEL[17] = '大王';

  // 花色红色判断
  function isRedSuit(suit) { return suit === 'H' || suit === 'D'; }

  // 生成一副 54 张牌
  function buildDeck() {
    var deck = [];
    var suits = ['S', 'H', 'D', 'C'];
    var ranks = [];
    for (var r = 3; r <= 15; r++) ranks.push(r);
    suits.forEach(function (suit) {
      ranks.forEach(function (rank) {
        deck.push(makeCard(suit, rank));
      });
    });
    deck.push(makeCard('BJ', 16)); // 小王
    deck.push(makeCard('RJ', 17)); // 大王
    return deck;
  }

  function makeCard(suit, rank) {
    var id = suit + '_' + rank;
    return {
      id: id,
      uid: id + '#0',   // 唯一标识：两副牌时同一张牌有两份，用 uid 区分
      suit: suit,
      rank: rank,
      img: cardImg(suit, rank)
    };
  }

  // 生成 n 副牌的总牌池（两副牌时给每张牌唯一 uid，避免 UI 定位时重复）
  function makePool(nDeck) {
    nDeck = nDeck || 1;
    var pool = [];
    for (var d = 0; d < nDeck; d++) {
      buildDeck().forEach(function (c) {
        pool.push({
          id: c.id,
          uid: c.id + '#' + d,
          suit: c.suit,
          rank: c.rank,
          img: c.img
        });
      });
    }
    return pool;
  }

  // 牌面图片路径（本地 assets/cards）
  // 支持子页面（如 play/index.html）正确解析相对路径：
  // 从 cards.js 自身脚本 src 推导站点根目录 + assets/cards/
  var assetBase = null;
  function computeAssetBase() {
    try {
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].src || '';
        var m = /^(.*\/)js\/cards\.js/.exec(src);
        if (m) return m[1] + 'assets/cards/';
      }
    } catch (e) {}
    return 'assets/cards/';
  }
  function getAssetBase() {
    if (assetBase === null) assetBase = computeAssetBase();
    return assetBase;
  }
  function cardImg(suit, rank) {
    var name;
    if (suit === 'BJ') name = 'joker_black';
    else if (suit === 'RJ') name = 'joker_red';
    else {
      // svg-cards 命名：A=1, 2=2 … 10=10, J=jack, Q=queen, K=king
      var num;
      if (rank === 14) num = '1';            // A → 1
      else if (rank === 11) num = 'jack';
      else if (rank === 12) num = 'queen';
      else if (rank === 13) num = 'king';
      else num = String(rank);               // 3-10 及 2（=15，但文件名就是 2）
      if (rank === 15) num = '2';
      name = SUIT_IMG[suit] + '_' + num;
    }
    return getAssetBase() + name + '.png';
  }
  function backImg() { return getAssetBase() + 'back.png'; }

  // 洗牌（crypto 优先）
  function shuffle(deck) {
    var a = deck.slice();
    var i, j, t;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      var vals = new Uint32Array(a.length);
      crypto.getRandomValues(vals);
      for (i = a.length - 1; i > 0; i--) {
        j = vals[i] % (i + 1);
        t = a[i]; a[i] = a[j]; a[j] = t;
      }
    } else {
      for (i = a.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        t = a[i]; a[i] = a[j]; a[j] = t;
      }
    }
    return a;
  }

  // 发牌：返回 { hands, bottom, perHand, bottomCount }
  // nDeck = 1 → 3 手各 17 张，底牌 3 张（54 张牌）
  // nDeck = 2 → 3 手各 34 张，底牌 6 张（108 张牌）
  function deal(nDeck) {
    nDeck = nDeck || 1;
    var deck = shuffle(makePool(nDeck));
    var total = deck.length;
    var perHand = nDeck === 2 ? 34 : 17;
    var bottomCount = nDeck === 2 ? 6 : 3;
    var dealCount = perHand * 3;
    var hands = [[], [], []];
    for (var i = 0; i < dealCount; i++) hands[i % 3].push(deck[i]);
    hands.forEach(function (h) { h.sort(cmpAsc); });
    return {
      hands: hands,
      bottom: deck.slice(dealCount).sort(cmpAsc),
      perHand: perHand,
      bottomCount: bottomCount,
      nDeck: nDeck
    };
  }

  function cmpAsc(a, b) { return a.rank - b.rank; }
  function cmpDesc(a, b) { return b.rank - a.rank; }

  // 由 id 列表还原牌对象（按当前牌池/或构造）
  // pool 可为 { id: card } 映射，或数组（按 id/uid 匹配）
  function cardsFromIds(ids, pool) {
    function find(id) {
      if (!pool) return null;
      if (Array.isArray(pool)) {
        for (var i = 0; i < pool.length; i++) {
          if (pool[i].id === id || pool[i].uid === id) return pool[i];
        }
        return null;
      }
      return pool[id] || null;
    }
    return ids.map(function (id) {
      var found = find(id);
      if (found) return found;
      var m = /^(S|H|D|C|BJ|RJ)_(\d+)$/.exec(id);
      return m ? makeCard(m[1], parseInt(m[2], 10)) : makeCard('BJ', 16);
    });
  }

  /* ============ 牌型识别与比较 ============ */

  // 识别一组牌（rank 数组）返回 { type, mainRank, len, subRank }
  // nDeck：1（默认，一副牌）| 2（两副牌，同点数最多8张、火箭=2小2大共4张王）
  function parseCards(ranks, nDeck) {
    var n = ranks.length;
    if (n === 0) return null;
    nDeck = nDeck === 2 ? 2 : 1;

    var count = {};
    ranks.forEach(function (r) { count[r] = (count[r] || 0) + 1; });
    var kinds = Object.keys(count).map(Number).sort(function (a, b) { return a - b; });
    var counts = kinds.map(function (k) { return count[k]; });
    var maxCount = Math.max.apply(null, counts);

    // 火箭：一副牌=小王+大王（2张）；两副牌=2小王+2大王（4张）
    if (nDeck === 2) {
      if (n === 4 && (count[16] || 0) === 2 && (count[17] || 0) === 2) {
        return { type: 'rocket', mainRank: 17, len: 4 };
      }
    } else {
      if (n === 2 && (count[16] || 0) === 1 && (count[17] || 0) === 1) {
        return { type: 'rocket', mainRank: 17, len: 2 };
      }
    }

    // 单张
    if (n === 1) return { type: 'single', mainRank: ranks[0], len: 1 };

    // 对子 / 三张 / 炸弹（四张及以上；两副牌最多8张）
    if (kinds.length === 1) {
      var c = counts[0];
      if (c === 2) return { type: 'pair', mainRank: kinds[0], len: 2 };
      if (c === 3) return { type: 'triple', mainRank: kinds[0], len: 3 };
      if (c >= 4) return { type: 'bomb', mainRank: kinds[0], len: c };
      return null;
    }

    // 顺子：全是单张且连续（5 张起，最大到 A=14，不含 2/王）
    if (kinds.length === n && counts.every(function (c) { return c === 1; })) {
      if (n >= 5 && kinds[n - 1] <= 14 && kinds[n - 1] - kinds[0] === n - 1) {
        return { type: 'straight', mainRank: kinds[n - 1], len: n };
      }
      return null;
    }

    // 连对：全是对子且连续（3 对起，不含 2/王）
    if (kinds.length === n / 2 && counts.every(function (c) { return c === 2; })) {
      if (n >= 6 && kinds[kinds.length - 1] <= 14 && kinds[kinds.length - 1] - kinds[0] === kinds.length - 1) {
        return { type: 'straight_pair', mainRank: kinds[kinds.length - 1], len: kinds.length };
      }
      return null;
    }

    // 三顺（飞机不带）：全是三张且连续（2 组起，不含 2/王）
    if (kinds.length === n / 3 && counts.every(function (c) { return c === 3; })) {
      if (kinds.length >= 2 && kinds[kinds.length - 1] <= 14 && kinds[kinds.length - 1] - kinds[0] === kinds.length - 1) {
        return { type: 'plane_pure', mainRank: kinds[kinds.length - 1], len: kinds.length };
      }
      return null;
    }

    // 三带一 / 三带二
    if (kinds.length === 2 && n === 4) {
      var has3 = counts.indexOf(3) !== -1;
      if (has3) {
        var tripleRank = count[counts.indexOf(3) === 0 ? kinds[0] : kinds[1]];
        // 找到 3 张那个
        var tRank = counts[0] === 3 ? kinds[0] : kinds[1];
        return { type: 'triple_one', mainRank: tRank, len: 4 };
      }
    }
    if (kinds.length === 2 && n === 5) {
      if (counts[0] === 3 && counts[1] === 2) return { type: 'triple_pair', mainRank: kinds[0], len: 5 };
      if (counts[0] === 2 && counts[1] === 3) return { type: 'triple_pair', mainRank: kinds[1], len: 5 };
    }

    // 飞机带单 / 飞机带对
    if (kinds.length >= 3) {
      // 找出三张组合（可能是 333444 + 单）
      var triples = kinds.filter(function (k) { return count[k] === 3; });
      if (triples.length >= 2 && isConsecutive(triples) && triples[triples.length - 1] <= 14) {
        var wing = n - triples.length * 3;
        if (wing === 0) return { type: 'plane_pure', mainRank: triples[triples.length - 1], len: triples.length };
        if (wing === triples.length) return { type: 'plane_one', mainRank: triples[triples.length - 1], len: triples.length };
        if (wing === triples.length * 2) return { type: 'plane_pair', mainRank: triples[triples.length - 1], len: triples.length };
      }
    }

    // 四带二 / 四带两对
    var quadRank = null;
    kinds.forEach(function (k) { if (count[k] === 4) quadRank = k; });
    if (quadRank !== null) {
      var rest = n - 4;
      if (rest === 2) return { type: 'four_two', mainRank: quadRank, len: 6 };
      if (rest === 4) {
        var remaining = kinds.filter(function (k) { return k !== quadRank; });
        if (remaining.every(function (k) { return count[k] === 2; })) {
          return { type: 'four_two_pair', mainRank: quadRank, len: 8 };
        }
      }
    }

    return null;
  }

  function isConsecutive(arr) {
    if (arr.length < 2) return false;
    for (var i = 1; i < arr.length; i++) {
      if (arr[i] !== arr[i - 1] + 1) return false;
    }
    return true;
  }

  var TYPE_ORDER = {
    single: 0, pair: 1, triple: 2, triple_one: 3, triple_pair: 4,
    straight: 5, straight_pair: 6, plane_pure: 7, plane_one: 8, plane_pair: 9,
    four_two: 10, four_two_pair: 11,
    bomb: 12, rocket: 13
  };

  // 能否用 a 压过 b（a、b 为 parseCards 结果；a 为 null 表示不出）
  // nDeck：两副牌时 5+ 张同点炸弹可压 4 张炸弹（仅同牌数同点数直接比大小，
  // 而炸弹张数更多视为更"厚"的炸弹，可压张数更少的炸弹）
  function canBeat(a, b, nDeck) {
    if (!a) return false;
    if (!b) return true;
    if (a.type === 'rocket') return b.type !== 'rocket';
    if (a.type === 'bomb') {
      if (b.type === 'rocket') return false;
      if (b.type === 'bomb') {
        // 两副牌：张数多的炸弹压张数少的；张数相同按点数
        if (nDeck === 2 && a.len !== b.len) return a.len > b.len;
        return a.mainRank > b.mainRank;
      }
      return true;
    }
    // 普通牌型只能压同型
    if (a.type !== b.type) return false;
    if (a.len !== b.len) return false; // 顺子/飞机等长度需一致
    return a.mainRank > b.mainRank;
  }

  /* ============ 合法出牌生成 ============ */

  // 校验一组出牌（rank 数组）的点数使用次数不超出手牌拥有量
  function isValidMove(ranks, handRanks) {
    var hc = {};
    handRanks.forEach(function (r) { hc[r] = (hc[r] || 0) + 1; });
    var mc = {};
    for (var i = 0; i < ranks.length; i++) {
      mc[ranks[i]] = (mc[ranks[i]] || 0) + 1;
      if (mc[ranks[i]] > (hc[ranks[i]] || 0)) return false;
    }
    return true;
  }

  // 从手牌（rank 数组）生成所有可能的出牌组合（返回 ranks 数组列表）
  function generateMoves(handRanks, nDeck) {
    nDeck = nDeck === 2 ? 2 : 1;
    var moves = [];
    var count = {};
    handRanks.forEach(function (r) { count[r] = (count[r] || 0) + 1; });
    var kinds = Object.keys(count).map(Number).sort(function (a, b) { return a - b; });

    // 单张
    kinds.forEach(function (k) { moves.push([k]); });

    // 对子、三张
    kinds.forEach(function (k) {
      if (count[k] >= 2) moves.push([k, k]);
      if (count[k] >= 3) moves.push([k, k, k]);
    });

    // 炸弹：一副=4张；两副=4~8张（4张起，同点数全都有）
    kinds.forEach(function (k) {
      if (count[k] >= 4) {
        if (nDeck === 2) {
          for (var b = 4; b <= count[k]; b++) {
            var bb = [];
            for (var zz = 0; zz < b; zz++) bb.push(k);
            moves.push(bb);
          }
        } else {
          moves.push([k, k, k, k]);
        }
      }
    });

    // 三带一 / 三带二
    kinds.forEach(function (k) {
      if (count[k] >= 3) {
        kinds.forEach(function (k2) {
          if (k2 !== k && count[k2] >= 1) {
            var m1 = [k, k, k, k2];
            if (isValidMove(m1, handRanks)) moves.push(m1);
          }
          if (k2 !== k && count[k2] >= 2) {
            var m2 = [k, k, k, k2, k2];
            if (isValidMove(m2, handRanks)) moves.push(m2);
          }
        });
      }
    });

    // 顺子
    var maxRank = Math.min(14, kinds[kinds.length - 1]);
    for (var start = 3; start <= maxRank - 4; start++) {
      for (var len = 5; start + len - 1 <= maxRank; len++) {
        var ok = true;
        for (var i = 0; i < len; i++) {
          if (!count[start + i]) { ok = false; break; }
        }
        if (ok) {
          var s = [];
          for (var j = 0; j < len; j++) s.push(start + j);
          moves.push(s);
        }
      }
    }

    // 连对
    for (var s2 = 3; s2 <= maxRank - 2; s2++) {
      for (var len2 = 3; s2 + len2 - 1 <= maxRank; len2++) {
        var ok2 = true;
        for (var i2 = 0; i2 < len2; i2++) {
          if ((count[s2 + i2] || 0) < 2) { ok2 = false; break; }
        }
        if (ok2) {
          var p = [];
          for (var j2 = 0; j2 < len2; j2++) p.push(s2 + j2, s2 + j2);
          moves.push(p);
        }
      }
    }

    // 飞机纯（2 组起）
    var tripleKinds = kinds.filter(function (k) { return count[k] >= 3; });
    for (var t = 0; t < tripleKinds.length; t++) {
      for (var len3 = 2; t + len3 - 1 < tripleKinds.length; len3++) {
        var chain = tripleKinds.slice(t, t + len3);
        if (chain[chain.length - 1] - chain[0] === len3 - 1 && chain[chain.length - 1] <= 14) {
          var pl = [];
          chain.forEach(function (ck) {
            for (var z = 0; z < 3; z++) pl.push(ck);
          });
          moves.push(pl);
          // 带单翼 / 带对翼
          var rest = handRanks.slice();
          chain.forEach(function (ck) {
            for (var z = 0; z < 3; z++) {
              var idx = rest.indexOf(ck);
              if (idx >= 0) rest.splice(idx, 1);
            }
          });
          var rCount = {};
          rest.forEach(function (r) { rCount[r] = (rCount[r] || 0) + 1; });
          var rKinds = Object.keys(rCount).map(Number);
          // 带单（挑 len3 张单）
          if (rKinds.length >= len3) {
            // 简化：只生成一种带法（取前 len3 个不同点）
            var wingS = [];
            for (var w = 0; w < len3; w++) wingS.push(rKinds[w]);
            moves.push(pl.concat(wingS));
          }
          // 带对（挑 len3 对）
          var pairKinds = rKinds.filter(function (r) { return rCount[r] >= 2; });
          if (pairKinds.length >= len3) {
            var wingP = [];
            for (var w2 = 0; w2 < len3; w2++) wingP.push(pairKinds[w2], pairKinds[w2]);
            moves.push(pl.concat(wingP));
          }
        }
      }
    }

    // 四带二 / 四带两对
    var quadKinds = kinds.filter(function (k) { return count[k] >= 4; });
    quadKinds.forEach(function (qk) {
      var rest2 = handRanks.slice();
      for (var z2 = 0; z2 < 4; z2++) {
        var ix = rest2.indexOf(qk);
        if (ix >= 0) rest2.splice(ix, 1);
      }
      var rc2 = {};
      rest2.forEach(function (r) { rc2[r] = (rc2[r] || 0) + 1; });
      var rk2 = Object.keys(rc2).map(Number);
      if (rk2.length >= 2) {
        moves.push([qk, qk, qk, qk, rk2[0], rk2[1]]);
      }
      var pairRanks = rk2.filter(function (r) { return rc2[r] >= 2; });
      if (pairRanks.length >= 2) {
        moves.push([qk, qk, qk, qk, pairRanks[0], pairRanks[0], pairRanks[1], pairRanks[1]]);
      }
    });

    // 火箭：一副牌=16+17；两副牌=16,16,17,17（4张王）
    if (nDeck === 2) {
      if ((count[16] || 0) >= 2 && (count[17] || 0) >= 2) moves.push([16, 16, 17, 17]);
    } else {
      if (count[16] && count[17]) moves.push([16, 17]);
    }

    // 去重（用排序后的 join 做 key）+ 过滤掉无法识别为合法牌型的组合
    var seen = {};
    var unique = [];
    moves.forEach(function (m) {
      if (!parseCards(m, nDeck)) return; // 保证只输出合法牌型
      var key = m.slice().sort(function (a, b) { return a - b; }).join(',');
      if (!seen[key]) { seen[key] = true; unique.push(m); }
    });

    return unique;
  }

  // 找出能压过 given（ranks 数组）的所有出法，返回 moves 列表
  function findBeats(handRanks, givenRanks, nDeck) {
    var given = parseCards(givenRanks, nDeck);
    if (!given) return [];
    var all = generateMoves(handRanks, nDeck);
    return all.filter(function (m) {
      var parsed = parseCards(m, nDeck);
      return parsed && canBeat(parsed, given, nDeck);
    });
  }

  // 人类可读的牌型名
  function typeName(type, len) {
    switch (type) {
      case 'single': return '单张';
      case 'pair': return '对子';
      case 'triple': return '三张';
      case 'triple_one': return '三带一';
      case 'triple_pair': return '三带二';
      case 'straight': return '顺子';
      case 'straight_pair': return '连对';
      case 'plane_pure': return '飞机';
      case 'plane_one': return '飞机带单';
      case 'plane_pair': return '飞机带对';
      case 'four_two': return '四带二';
      case 'four_two_pair': return '四带两对';
      case 'bomb': return '炸弹';
      case 'rocket': return '火箭';
      default: return '牌型';
    }
  }

  // rank 数组 → 展示文字，如 "对子 · 8" "顺子 · 3-7"
  // 炸弹会标注张数（如 "炸弹 · 6张 8"），两副牌时更清楚
  function describe(ranks, nDeck) {
    var parsed = parseCards(ranks, nDeck);
    if (!parsed) return '不合法的出牌';
    var name = typeName(parsed.type);
    var label = RANK_LABEL[parsed.mainRank];
    if (parsed.type === 'bomb' && parsed.len > 4) {
      return '炸弹 · ' + parsed.len + '张 ' + label;
    }
    switch (parsed.type) {
      case 'straight':
        return '顺子 ' + RANK_LABEL[ranks[0]] + ' 到 ' + label;
      case 'straight_pair':
        return '连对 ' + RANK_LABEL[ranks[0]] + ' 到 ' + label;
      case 'plane_pure':
      case 'plane_one':
      case 'plane_pair':
        return name + ' ' + RANK_LABEL[ranks[0]] + ' 到 ' + label;
      default:
        return name + ' · ' + label;
    }
  }

  return {
    SUITS: SUITS,
    SUIT_SYMBOL: SUIT_SYMBOL,
    RANK_LABEL: RANK_LABEL,
    isRedSuit: isRedSuit,
    buildDeck: buildDeck,
    makePool: makePool,
    makeCard: makeCard,
    cardImg: cardImg,
    backImg: backImg,
    shuffle: shuffle,
    deal: deal,
    cardsFromIds: cardsFromIds,
    parseCards: parseCards,
    canBeat: canBeat,
    generateMoves: generateMoves,
    findBeats: findBeats,
    typeName: typeName,
    describe: describe,
    TYPE_ORDER: TYPE_ORDER
  };
});
