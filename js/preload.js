/* ==========================================================================
   preload.js — 打开网页就预热牌面图片 + 注册 Service Worker（本地缓存）
   每个页面 <head> 里用 defer 引用，尽早开始加载牌面，进对局页不再等图。
   纯静态可用：
   - GitHub Pages(HTTPS) / localhost：Service Worker 持久缓存，二次访问秒开、可离线
   - 本地双击 file://：SW 不可用，退化为浏览器图片预热（本地读取本来就快）
   ========================================================================== */
(function () {
  'use strict';
  // 推导站点根（与 cards.js computeAssetBase 同思路：从自身 script src 推导）
  var scripts = document.getElementsByTagName('script');
  var root = '';
  for (var i = 0; i < scripts.length; i++) {
    var src = scripts[i].src || '';
    var m = /^(.*\/)js\/preload\.js/.exec(src);
    if (m) { root = m[1]; break; }
  }

  // 1) 预热牌面：55 张本地 PNG（与 assets/cards 一致，一张不落）
  var suits = ['spade', 'heart', 'diamond', 'club'];
  var nums = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];
  var names = ['back.png', 'joker_black.png', 'joker_red.png'];
  suits.forEach(function (s) { nums.forEach(function (n) { names.push(s + '_' + n + '.png'); }); });
  var cardBase = root + 'assets/cards/';
  names.forEach(function (n) {
    var im = new Image();
    im.src = cardBase + n;   // 后台预取，浏览器会自动排队，不阻塞页面
  });

  // 2) 注册 Service Worker（持久缓存；仅 HTTPS 或 localhost 下生效，静默失败无害）
  if ('serviceWorker' in navigator && root) {
    navigator.serviceWorker.register(root + 'sw.js', { scope: root }).catch(function () {});
  }
})();
