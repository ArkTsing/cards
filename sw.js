/* ==========================================================================
   sw.js — Service Worker：把静态资源（牌面/JS/CSS）缓存到本地
   策略（更新友好，避免"更新了用户看到的还是旧版"）：
   - 页面 HTML：一律不缓存，走网络（保证每次都是最新版）
   - 静态资源（assets/cards/ js/ css/）：stale-while-revalidate
     首次访问后缓存，之后秒开；后台会用最新版更新缓存，下次加载新版
   - 图片：Cache-first（牌面不会变，直接缓存优先）
   仅 HTTPS / localhost 可用；本地 file:// 打开时不会注册，无影响。
   ========================================================================== */
'use strict';
var VERSION = 'ddz-cache-v3';
// 匹配任意层级下的 assets/cards/、js/、css/（兼容根目录与子路径部署，如 GitHub Pages 项目页）
function isStatic(pathname) {
  return /(?:^|\/)assets\/cards\//.test(pathname) ||
         /\/(?:js|css)\//.test(pathname);
}
function isCard(pathname) { return /(?:^|\/)assets\/cards\//.test(pathname); }

// 全部静态资源清单：55 张牌面 + 核心 JS/CSS。
// install 时一次性预缓存，首次访问就把牌面全入本地，进对局不再等图。
// 用相对路径（相对 sw.js 所在目录解析），子路径部署也正确。
var PRECACHE = (function () {
  var names = ['back.png', 'joker_black.png', 'joker_red.png'];
  ['spade', 'heart', 'diamond', 'club'].forEach(function (s) {
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'].forEach(function (n) {
      names.push(s + '_' + n + '.png');
    });
  });
  var list = names.map(function (n) { return 'assets/cards/' + n; });
  ['css/base.css', 'css/game.css', 'css/home.css', 'css/learn.css', 'css/sim.css', 'css/history.css',
   'js/cards.js', 'js/ai.js', 'js/game.js', 'js/hint.js', 'js/ui.js', 'js/speak.js',
   'js/storage.js', 'js/theme.js', 'js/learn.js', 'js/sim.js', 'js/data.js', 'js/preload.js']
    .forEach(function (p) { list.push(p); });
  return list;
})();

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      // 逐个预缓存，失败跳过（addAll 要求全部成功，一个失败整组作废）
      return Promise.all(PRECACHE.map(function (p) {
        return fetch(p, { cache: 'no-store' }).then(function (resp) {
          if (resp && resp.ok) return c.put(p, resp);
        }).catch(function () {});
      }));
    }).then(function () { self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
      })
    ])
  );
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  // 仅处理同源 GET；HTML 一律走网络（永远最新）
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate' || url.pathname === '/' || /\.html$/.test(url.pathname)) return;
  if (!isStatic(url.pathname)) return;

  var request = e.request;
  if (isCard(url.pathname)) {
    // 牌面：Cache-first，命中直接返回，绝不重复下载
    e.respondWith(
      caches.match(request).then(function (hit) {
        if (hit) return hit;
        return fetch(request).then(function (resp) {
          if (resp && resp.ok) {
            var copy = resp.clone();
            caches.open(VERSION).then(function (c) { c.put(request, copy); });
          }
          return resp;
        });
      })
    );
  } else {
    // JS / CSS：stale-while-revalidate
    e.respondWith(
      caches.match(request).then(function (hit) {
        var fetchP = fetch(request).then(function (resp) {
          if (resp && resp.ok) {
            var copy = resp.clone();
            caches.open(VERSION).then(function (c) { c.put(request, copy); });
          }
          return resp;
        });
        return hit || fetchP;
      })
    );
  }
});
