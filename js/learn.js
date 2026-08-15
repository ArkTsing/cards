/* ==========================================================================
   learn.js — 教学区渲染逻辑（章节页 / 目录 / 图鉴 / 测验共用）
   依赖：data.js, cards.js, speak.js, storage.js
   ========================================================================== */
(function () {
  'use strict';

  var D = window.DDZData;
  var C = window.DDZCards;

  // 生成一张可展示的牌（真实牌面图片 + 大点数角标，老人友好）
  function miniCardEl(card) {
    var el = document.createElement('span');
    el.className = 'mini-card';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', C.RANK_LABEL[card.rank] + (C.SUIT_SYMBOL[card.suit] || ''));
    var img = document.createElement('img');
    img.src = card.img;
    img.alt = C.RANK_LABEL[card.rank] + (C.SUIT_SYMBOL[card.suit] || '');
    img.loading = 'lazy';
    img.draggable = false;
    img.onerror = function () {
      // 兜底：图片失败时显示点数文字
      el.textContent = C.RANK_LABEL[card.rank] + (C.SUIT_SYMBOL[card.suit] || '');
      el.style.cssText = 'display:flex;align-items:center;justify-content:center;font-weight:900;font-size:1.4em;';
    };
    el.appendChild(img);
    // 大点数角标
    var corner = document.createElement('span');
    corner.className = 'mini-card__corner ' + (C.isRedSuit(card.suit) ? 'is-red' : 'is-black');
    corner.textContent = C.RANK_LABEL[card.rank];
    el.appendChild(corner);
    return el;
  }

  // 渲染一个"牌例展示区"（绿桌底）
  // opts: { ranks, caption, bid, compare, score, roles }
  function renderCardDemo(block) {
    var wrap = document.createElement('div');
    wrap.className = 'card-demo';
    var row = document.createElement('div');
    row.className = 'card-demo__row';

    if (block.roles) {
      // 角色示意：地主 vs 农民（用文字+图标表示）
      row.innerHTML =
        '<div class="role-chip landlord">🏠 地主<br>20 张</div>' +
        '<div class="role-chip farmer">👨‍🌾 农民<br>17 张</div>' +
        '<div class="role-chip farmer">👩‍🌾 农民<br>17 张</div>';
    } else if (block.bid) {
      // 叫分演示：三个叫分按钮（点击反馈）
      row.innerHTML = '';
      [1, 2, 3].forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bid-demo-btn';
        btn.textContent = b + ' 分';
        btn.addEventListener('click', function () {
          document.querySelectorAll('.bid-demo-btn').forEach(function (x) { x.classList.remove('picked'); });
          btn.classList.add('picked');
          var hint = wrap.querySelector('.card-demo__caption');
          hint.textContent = '您叫了 ' + b + ' 分。牌好可以叫高一点，牌差先别喊。';
        });
        row.appendChild(btn);
      });
    } else if (block.compare) {
      // 比大小演示：上家对 8，下家给可选对子
      var above = D.ranksToCards([8, 8]);
      above.forEach(function (c) { row.appendChild(miniCardEl(c)); });
      row.appendChild(arrowEl('⬇'));
      var below = D.ranksToCards([9, 9]);
      below.forEach(function (c) { row.appendChild(miniCardEl(c)); });
    } else if (block.score) {
      row.innerHTML =
        '<div class="score-chip">底分 1</div><span class="score-op">×</span>' +
        '<div class="score-chip">叫分 2</div><span class="score-op">×</span>' +
        '<div class="score-chip">炸弹 ×2</div><span class="score-op">=</span>' +
        '<div class="score-chip score-chip--big">4 倍</div>';
    } else if (block.ranks) {
      var cards = D.ranksToCards(block.ranks);
      cards.forEach(function (c) { row.appendChild(miniCardEl(c)); });
    }

    if (block.caption) {
      var cap = document.createElement('div');
      cap.className = 'card-demo__caption';
      cap.textContent = block.caption;
      wrap.appendChild(row);
      wrap.appendChild(cap);
    } else {
      wrap.appendChild(row);
    }
    return wrap;
  }

  function arrowEl(text) {
    var s = document.createElement('span');
    s.className = 'card-demo__arrow';
    s.textContent = text;
    return s;
  }

  // 渲染一个正文段落（lesson-block）
  function renderBlock(block) {
    switch (block.type) {
      case 'p': {
        var div = document.createElement('div');
        div.className = 'lesson-block';
        var p = document.createElement('p');
        p.innerHTML = block.text;
        div.appendChild(p);
        return div;
      }
      case 'mnemonic': {
        var m = document.createElement('div');
        m.className = 'lesson-mnemonic';
        m.innerHTML = '📌 ' + block.text;
        return m;
      }
      case 'tip': {
        var t = document.createElement('div');
        t.className = 'lesson-tip';
        t.innerHTML = '💡 <b>小提示：</b>' + block.text;
        return t;
      }
      case 'example':
        return renderCardDemo(block);
      case 'qa': {
        var qa = document.createElement('div');
        qa.className = 'lesson-qa';
        qa.innerHTML =
          '<div class="lesson-qa__q">❓ ' + block.q + '</div>' +
          '<div class="lesson-qa__a">✅ ' + block.a + '</div>' +
          (block.hint ? '<div class="lesson-qa__hint">再看一眼：' + block.hint + '</div>' : '');
        return qa;
      }
      default:
        return null;
    }
  }

  // 组装整章页面（body 挂载点 + 章节数据）
  function renderChapter(mount, chapter) {
    mount.innerHTML = '';
    // 页头
    var header = document.createElement('header');
    header.className = 'lesson-page__header';
    header.innerHTML =
      '<div class="lesson-page__ch">第 ' + chapter.id + ' 课 / 共 7 课</div>' +
      '<h1 class="lesson-page__title">' + chapter.emoji + ' ' + chapter.title + '</h1>' +
      '<p class="lesson-page__intro">' + chapter.intro + '</p>';
    mount.appendChild(header);

    // 朗读按钮
    var speakBtn = document.createElement('button');
    speakBtn.type = 'button';
    speakBtn.className = 'speak-btn lesson-page__speak';
    speakBtn.innerHTML = '🔊 朗读这一课';
    speakBtn.addEventListener('click', function () {
      if (window.DDZSpeak) {
        var s = chapter.readAloud || chapter.intro;
        if (speakBtn.classList.contains('speaking')) {
          window.DDZSpeak.stop();
          speakBtn.classList.remove('speaking');
          speakBtn.textContent = '🔊 朗读这一课';
        } else {
          window.DDZSpeak.speak(s);
          speakBtn.classList.add('speaking');
          speakBtn.textContent = '🔊 停止朗读';
        }
      }
    });
    mount.appendChild(speakBtn);

    // 正文块
    chapter.body.forEach(function (block) {
      var el = renderBlock(block);
      if (el) mount.appendChild(el);
    });

    // 底部导航：上一课 / 下一课 / 做测验
    var nav = document.createElement('nav');
    nav.className = 'lesson-nav';
    var prev = document.createElement('a');
    prev.className = 'btn btn--ghost';
    prev.href = chapter.id > 1 ? 'ch' + (chapter.id - 1) + '.html' : 'index.html';
    prev.textContent = chapter.id > 1 ? '‹ 上一课' : '‹ 课程目录';
    var next;
    if (chapter.id < 7) {
      next = document.createElement('a');
      next.className = 'btn';
      next.href = 'ch' + (chapter.id + 1) + '.html';
      next.textContent = '下一课 ›';
      // 点击"下一课"代表这一课看完了，记一下进度
      next.addEventListener('click', function () { markDone(chapter.id); });
    } else {
      next = document.createElement('a');
      next.className = 'btn btn--accent';
      next.href = 'quiz.html';
      next.textContent = '去做小测验 ✍';
      next.addEventListener('click', function () { markDone(chapter.id); });
    }
    nav.appendChild(prev);
    nav.appendChild(next);
    mount.appendChild(nav);

    // 滚动到接近页尾时，也算这一课看完了
    var markTimer = null;
    var markIfBottom = function () {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight - 40;
      if ((window.pageYOffset || doc.scrollTop || 0) >= max) {
        markDone(chapter.id);
      }
    };
    window.addEventListener('scroll', function () {
      if (markTimer) return;
      markTimer = setTimeout(function () {
        markTimer = null;
        markIfBottom();
      }, 300);
    }, { passive: true });
  }

  // 标记某章已学完（学完自动打勾）
  function markDone(chapterId) {
    var done = window.DDZStorage.get('learn_done', {});
    done['ch' + chapterId] = true;
    window.DDZStorage.set('learn_done', done);
  }

  // 目录页：渲染 7 章列表 + 进度
  function renderIndex(mount, progressTextEl, progressFillEl) {
    var done = window.DDZStorage.get('learn_done', {});
    var completed = 0;

    mount.innerHTML = '';
    D.CHAPTERS.forEach(function (ch) {
      var isDone = !!done['ch' + ch.id];
      if (isDone) completed++;

      var card = document.createElement('a');
      card.className = 'lesson-card';
      card.href = 'ch' + ch.id + '.html';
      card.setAttribute('aria-label', (isDone ? '已完成：' : '') + '第' + ch.id + '课 ' + ch.title);
      card.innerHTML =
        '<span class="lesson-card__emoji" aria-hidden="true">' + ch.emoji + '</span>' +
        '<span class="lesson-card__body">' +
          '<span class="lesson-card__num">第 ' + ch.id + ' 课</span>' +
          '<span class="lesson-card__title">' + ch.title + '</span>' +
          '<span class="lesson-card__intro">' + ch.intro + '</span>' +
        '</span>' +
        '<span class="lesson-card__done ' + (isDone ? 'done' : '') + '" aria-hidden="true">' +
          (isDone ? '✓' : (ch.id + '/7')) +
        '</span>';
      mount.appendChild(card);
    });

    if (progressTextEl && progressFillEl) {
      var total = D.totalChapters;
      if (completed === 0) {
        progressTextEl.textContent = '还没开始，先看第一课吧';
        progressFillEl.style.width = '0%';
      } else if (completed >= total) {
        progressTextEl.textContent = '全部学完啦！去玩一局吧 👏';
        progressFillEl.style.width = '100%';
      } else {
        progressTextEl.textContent = '已完成 ' + completed + ' / ' + total + ' 课';
        progressFillEl.style.width = Math.round(completed / total * 100) + '%';
      }
    }
  }

  window.DDZLearn = {
    miniCardEl: miniCardEl,
    renderCardDemo: renderCardDemo,
    renderBlock: renderBlock,
    renderChapter: renderChapter,
    renderIndex: renderIndex,
    markDone: markDone
  };
})();
