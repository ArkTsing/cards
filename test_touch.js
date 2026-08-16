'use strict';
// 触屏交互集成测试：模拟 DOM，验证页面 renderPlayerHand 里触屏绑定的行为
// 逻辑与 play/index.html 逐字一致（touchstart/touchmove/touchend/touchcancel/click）

class FakeClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  contains(c) { return this.set.has(c); }
  add(c) { this.set.add(c); this.el._clsChanged = true; }
  remove(c) { this.set.delete(c); this.el._clsChanged = true; }
  toggle(c, force) {
    if (force === true) this.add(c);
    else if (force === false) this.remove(c);
    else { if (this.set.has(c)) this.remove(c); else this.add(c); }
    return this.set.has(c);
  }
}
class FakeEl {
  constructor(id) {
    this.id = id;
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.classList = new FakeClassList(this);
    this.children = [];
    this.parentNode = null;
    this.offsetHeight = 100;
    this.clientWidth = 800;
    this.clientHeight = 300;
    this.innerHTML = '';
    this._transforms = [];
  }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  fire(ev, args) { (this.listeners[ev] || []).forEach(fn => fn(args || {})); }
  querySelectorAll(sel) {
    if (sel === '.poker-card') return this.children.filter(c => c.classList.contains('poker-card'));
    return [];
  }
  appendChild(c) { this.children.push(c); c.parentNode = this; }
}
// 触发浏览器行为：touchend 后浏览器合成 click（除非 touchMoved 抑制）
function tap(el, opts) {
  const t = { clientX: opts.x0||10, clientY: opts.y0||10 };
  el.fire('touchstart', { changedTouches: [t] });
  if (opts.move) {
    el.fire('touchmove', { changedTouches: [{ clientX: opts.x1||(t.clientX+50), clientY: opts.y1||(t.clientY+50) }] });
    el.fire('touchend', { changedTouches: [t] });
    el.fire('click', {});
  } else {
    el.fire('touchend', { changedTouches: [t] });
    el.fire('click', {});
  }
}

let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; console.log('  ✓ ' + name); } catch(e) { failed++; console.log('  ✗ ' + name + ' — ' + e.message); } }
function assert(x, msg) { if (!x) throw new Error(msg || 'assertion failed'); }

// ---- 测试夹具：模拟 renderPlayerHand 触屏绑定 ----
function makeCardEl(cardId, handlers) {
  const el = new FakeEl(cardId);
  el.classList.add('poker-card');
  el.dataset.cardId = cardId;
  el.dataset.idx = String(handlers.idx);
  el.dataset.cardh = '87';
  el.classList.toggle('selected', !!handlers.selected[cardId]);

  // 触屏绑定（与页面逐字一致；非自己回合也可预选准备，AI 思考中也能预选）
  var touchStartX = 0, touchStartY = 0, touchMoved = false;
  el.addEventListener('touchstart', function (e) {
    var t = e.changedTouches && e.changedTouches[0];
    touchStartX = t ? t.clientX : 0;
    touchStartY = t ? t.clientY : 0;
    touchMoved = false;
    if (handlers.phase === 'playing' && !el.classList.contains('selected')) {
      handlers.cardTransform(el, true);
    }
  });
  el.addEventListener('touchmove', function (e) {
    var t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    var dx = Math.abs(t.clientX - touchStartX);
    var dy = Math.abs(t.clientY - touchStartY);
    if (dx > 10 || dy > 10) {
      touchMoved = true;
      if (!el.classList.contains('selected')) handlers.cardTransform(el, false);
    }
  });
  function touchEnd() {
    if (touchMoved) return;
    if (handlers.phase === 'playing' && !el.classList.contains('selected')) {
      handlers.cardTransform(el, false);
    }
  }
  el.addEventListener('touchend', touchEnd);
  el.addEventListener('touchcancel', function () {
    touchMoved = true;
    if (!el.classList.contains('selected')) handlers.cardTransform(el, false);
  });
  el.addEventListener('click', function () {
    if (touchMoved) { touchMoved = false; return; }
    if (handlers.phase !== 'playing') return;   // 非出牌阶段不选；非自己回合可预选
    if (handlers.selected[cardId]) { delete handlers.selected[cardId]; el.classList.remove('selected'); }
    else { handlers.selected[cardId] = true; el.classList.add('selected'); }
    handlers.layoutCards();
    handlers.updatePlayButton();
  });
  return el;
}

console.log('== 触屏交互测试 ==');

t('点按(无滑动)：touchstart 放大 → touchend 复位 → click 选牌', function () {
  const selected = {}, transforms = [];
  const h = {
    selected: selected, phase: 'playing',
    isPlayerTurn: () => true,
    cardTransform: (el, hover) => transforms.push(hover),
    layoutCards: () => {}, updatePlayButton: () => { h.pressed = true; }
  };
  const el = makeCardEl('c1', h);
  tap(el, { x0: 10, y0: 10 });
  assert(transforms[0] === true, 'touchstart 应触发放大 transform(true)，实际 ' + transforms[0]);
  assert(transforms[1] === false, 'touchend 应复位 transform(false)，实际 ' + transforms[1]);
  assert(el.classList.contains('selected'), 'click 后应选中');
  assert(h.pressed, '应调用 updatePlayButton');
});

t('点按已选中的牌：不触发放大，click 取消选中', function () {
  const selected = { c2: true }, transforms = [];
  const h = {
    selected: selected, phase: 'playing',
    isPlayerTurn: () => true,
    cardTransform: (el, hover) => transforms.push(hover),
    layoutCards: () => {}, updatePlayButton: () => {}
  };
  const el = makeCardEl('c2', h);
  tap(el, { x0: 20, y0: 20 });
  assert(transforms.length === 0, '已选中的牌按下不应放大，实际 ' + transforms.length + ' 次');
  assert(!el.classList.contains('selected'), 'click 后应取消选中');
  assert(!selected.c2, 'selected 对象应删除该牌');
});

t('滑动超过阈值：放大复位，click 被抑制(不选牌)', function () {
  const selected = {}, transforms = [];
  const h = {
    selected: selected, phase: 'playing',
    isPlayerTurn: () => true,
    cardTransform: (el, hover) => transforms.push(hover),
    layoutCards: () => {}, updatePlayButton: () => { h.pressed = true; }
  };
  const el = makeCardEl('c3', h);
  tap(el, { x0: 10, y0: 10, move: true, x1: 80, y1: 12 });
  assert(transforms[0] === true, 'touchstart 先放大，实际 ' + transforms[0]);
  assert(transforms[transforms.length-1] === false, '滑动后应复位，实际 ' + transforms[transforms.length-1]);
  assert(!el.classList.contains('selected'), '滑动不应选中');
  assert(!h.pressed, '滑动不应触发 updatePlayButton');
});

t('微小抖动(位移≤10)：不算滑动，正常选牌', function () {
  const selected = {}, transforms = [];
  const h = {
    selected: selected, phase: 'playing',
    isPlayerTurn: () => true,
    cardTransform: (el, hover) => transforms.push(hover),
    layoutCards: () => {}, updatePlayButton: () => {}
  };
  const el = makeCardEl('c4', h);
  tap(el, { x0: 50, y0: 50, move: true, x1: 58, y1: 54 });  // dx=8 dy=4 ≤10
  assert(el.classList.contains('selected'), '微小抖动应仍算点击，正常选牌');
});

t('未轮到玩家：允许预选（touchstart 放大，click 选牌）', function () {
  const selected = {}, transforms = [];
  const h = {
    selected: selected, phase: 'playing',
    isPlayerTurn: () => false,
    cardTransform: (el, hover) => transforms.push(hover),
    layoutCards: () => {}, updatePlayButton: () => { h.pressed = true; }
  };
  const el = makeCardEl('c5', h);
  tap(el, { x0: 10, y0: 10 });
  assert(transforms[0] === true, '非玩家回合按下也应放大（预选准备）');
  assert(el.classList.contains('selected'), '非玩家回合 click 应能预选');
  assert(h.pressed, '非玩家回合预选也应触发按钮更新');
});

t('非出牌阶段（叫分/结算）：touchstart 不放大，click 不选牌', function () {
  const selected = {}, transforms = [];
  const h = {
    selected: selected, phase: 'bidding',
    isPlayerTurn: () => true,
    cardTransform: (el, hover) => transforms.push(hover),
    layoutCards: () => {}, updatePlayButton: () => { h.pressed = true; }
  };
  const el = makeCardEl('c6b', h);
  tap(el, { x0: 10, y0: 10 });
  assert(transforms.length === 0, '非出牌阶段按下不应放大');
  assert(!el.classList.contains('selected'), '非出牌阶段 click 不应选牌');
  assert(!h.pressed, '非出牌阶段不应触发按钮更新');
});

t('touchcancel：与 touchend 一样复位且不选牌', function () {
  const selected = {}, transforms = [];
  const h = {
    selected: selected, phase: 'playing',
    isPlayerTurn: () => true,
    cardTransform: (el, hover) => transforms.push(hover),
    layoutCards: () => {}, updatePlayButton: () => {}
  };
  const el = makeCardEl('c6', h);
  el.fire('touchstart', { changedTouches: [{ clientX: 10, clientY: 10 }] });
  el.fire('touchcancel', { changedTouches: [{ clientX: 10, clientY: 10 }] });
  el.fire('click', {});
  assert(transforms.length === 2 && transforms[0] === true && transforms[1] === false, 'touchstart放大+touchcancel复位');
  assert(!el.classList.contains('selected'), 'touchcancel 后 click 被抑制，不应选牌');
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
