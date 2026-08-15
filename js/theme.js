/* ==========================================================================
   theme.js — 多档字号调节（全局实时生效 + localStorage 持久化）
   档位：standard 20px / large 22px / xlarge 24px / xxlarge 27px
   ========================================================================== */
(function () {
  'use strict';

  var KEY = 'ddz_fontsize';
  var LEVELS = [
    { key: 'standard', label: '标准', px: 20 },
    { key: 'large',    label: '大',   px: 22 },
    { key: 'xlarge',   label: '特大', px: 24 },
    { key: 'xxlarge',  label: '超大', px: 27 }
  ];

  var current = load();

  function load() {
    try {
      var saved = localStorage.getItem(KEY);
      if (saved) {
        var match = LEVELS.filter(function (l) { return l.key === saved; });
        if (match.length) return match[0];
      }
    } catch (e) { /* localStorage 不可用时静默回退 */ }
    return LEVELS[0];
  }

  function apply(level) {
    document.documentElement.style.setProperty('--fs', level.px + 'px');
  }

  function setLevel(key) {
    var level = LEVELS.filter(function (l) { return l.key === key; })[0];
    if (!level) return;
    current = level;
    apply(level);
    try { localStorage.setItem(KEY, key); } catch (e) {}
    // 广播事件，供各页面刷新动态控件字号
    document.dispatchEvent(new CustomEvent('ddz:fontsize', { detail: level }));
    // 通知顶栏按钮状态
    updateCtrls();
  }

  function bump(delta) {
    var idx = LEVELS.indexOf(current);
    var next = Math.max(0, Math.min(LEVELS.length - 1, idx + delta));
    setLevel(LEVELS[next].key);
  }

  // 构建顶栏 A-/A+ 控件（如页面需要）
  function buildTopbarCtrl(container) {
    if (!container) return;
    container.innerHTML =
      '<div class="fontsize-ctrl" role="group" aria-label="调整字号">' +
        '<button type="button" class="fs-down" aria-label="缩小字号">A−</button>' +
        '<button type="button" class="fs-up" aria-label="放大字号">A＋</button>' +
      '</div>';
    container.querySelector('.fs-down').addEventListener('click', function () { bump(-1); });
    container.querySelector('.fs-up').addEventListener('click', function () { bump(1); });
    updateCtrls();
  }

  function updateCtrls() {
    document.querySelectorAll('.fs-down').forEach(function (b) {
      b.disabled = LEVELS.indexOf(current) === 0;
    });
    document.querySelectorAll('.fs-up').forEach(function (b) {
      b.disabled = LEVELS.indexOf(current) === LEVELS.length - 1;
    });
  }

  // 暴露给全局（设置页等使用）
  window.DDZFont = {
    KEY: KEY,
    LEVELS: LEVELS,
    get: function () { return current; },
    set: setLevel,
    bump: bump,
    buildTopbarCtrl: buildTopbarCtrl
  };

  // 页面加载后尽早应用，避免闪字
  apply(current);
})();
