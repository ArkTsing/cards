/* ==========================================================================
   ui.js — 对局页牌面渲染、选中、动画、弹窗（依赖 DOM）
   ========================================================================== */
(function () {
  'use strict';

  var C = window.DDZCards;

  // 渲染一张牌 DOM（data-card-id 定位；data-selected 标记选中）
  function cardEl(card, opts) {
    opts = opts || {};
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'poker-card';
    el.dataset.cardId = card.id;
    el.dataset.rank = String(card.rank);
    if (opts.faceDown) {
      el.classList.add('poker-card--down');
      var back = document.createElement('img');
      back.src = C.backImg();
      back.alt = '牌背';
      back.loading = 'lazy';
      back.draggable = false;
      el.appendChild(back);
      return el;
    }
    var img = document.createElement('img');
    img.src = card.img;
    img.alt = C.RANK_LABEL[card.rank] + (C.SUIT_SYMBOL[card.suit] || '');
    img.loading = 'lazy';
    img.draggable = false;
    img.onerror = function () {
      // 图片加载失败兜底：显示文字角标
      el.classList.add('poker-card--fallback');
      el.textContent = C.RANK_LABEL[card.rank] + (C.SUIT_SYMBOL[card.suit] || '');
    };
    el.appendChild(img);
    // 大点数角标（老人友好，覆盖在牌面上）
    var corner = document.createElement('span');
    corner.className = 'poker-card__corner ' + (C.isRedSuit(card.suit) ? 'is-red' : 'is-black');
    corner.textContent = C.RANK_LABEL[card.rank];
    el.appendChild(corner);
    return el;
  }

  // 渲染一组牌到容器（支持间隔展开）
  function renderHand(container, cards, opts) {
    container.innerHTML = '';
    if (!cards || !cards.length) {
      container.innerHTML = '<span class="empty-hand">—</span>';
      return;
    }
    cards.forEach(function (card) {
      var el = cardEl(card, opts);
      container.appendChild(el);
    });
  }

  // 渲染电脑玩家的牌（背面小牌）
  function renderBacks(container, count) {
    container.innerHTML = '';
    for (var i = 0; i < count; i++) {
      container.appendChild(cardEl({ id: 'back_' + i }, { faceDown: true }));
    }
  }

  // 渲染桌面中央的上一手牌
  function renderCenter(container, cards, label) {
    container.innerHTML = '';
    if (!cards || !cards.length) {
      container.innerHTML = '<span class="center-empty">💭 等出牌…</span>';
      return;
    }
    cards.forEach(function (card) {
      var el = cardEl(card, {});
      el.classList.add('poker-card--center');
      container.appendChild(el);
    });
    if (label) {
      var tag = document.createElement('div');
      tag.className = 'center-label';
      tag.textContent = label;
      container.appendChild(tag);
    }
  }

  // 震动提示（非法操作）
  function shake(el) {
    if (!el) return;
    el.classList.remove('shake');
    // 触发重绘以重启动画
    void el.offsetWidth;
    el.classList.add('shake');
    setTimeout(function () { el.classList.remove('shake'); }, 400);
  }

  // 简单 toast 提示
  function toast(msg, container) {
    var box = container || document.body;
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    box.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 2400);
  }

  // 弹窗（确认/提示）
  function modal(opt) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="ddz-modal-title">' +
        '<h2 class="modal__title" id="ddz-modal-title"></h2>' +
        '<div class="modal__body"></div>' +
        '<div class="modal__actions"></div>' +
      '</div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector('.modal__title').textContent = opt.title || '';
    backdrop.querySelector('.modal__body').innerHTML = opt.body || '';

    function close() {
      backdrop.classList.remove('show');
      setTimeout(function () { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }, 250);
    }

    if (opt.buttons && opt.buttons.length) {
      var actions = backdrop.querySelector('.modal__actions');
      opt.buttons.forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = b.className || 'btn';
        btn.textContent = b.label;
        btn.addEventListener('click', function () {
          close();
          if (b.onClick) b.onClick();
        });
        actions.appendChild(btn);
      });
    } else {
      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn';
      ok.textContent = '好的';
      ok.addEventListener('click', close);
      backdrop.querySelector('.modal__actions').appendChild(ok);
    }
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) close();
    });
    requestAnimationFrame(function () { backdrop.classList.add('show'); });
    return { close: close, el: backdrop };
  }

  window.DDZUI = {
    cardEl: cardEl,
    renderHand: renderHand,
    renderBacks: renderBacks,
    renderCenter: renderCenter,
    shake: shake,
    toast: toast,
    modal: modal
  };
})();
