/* ==========================================================================
   storage.js — 本地存储工具（统一前缀 ddz_，兼容 localStorage 不可用）
   ========================================================================== */
(function () {
  'use strict';

  var PREFIX = 'ddz_';
  var available = true;
  try {
    var testKey = PREFIX + '_t';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
  } catch (e) {
    available = false;
  }

  var mem = {}; // localStorage 不可用时的内存回退

  function get(key, fallback) {
    var full = PREFIX + key;
    try {
      if (available) {
        var raw = localStorage.getItem(full);
        if (raw === null) return fallback;
        return JSON.parse(raw);
      }
    } catch (e) {}
    return full in mem ? mem[full] : fallback;
  }

  function set(key, value) {
    var full = PREFIX + key;
    try {
      if (available) {
        localStorage.setItem(full, JSON.stringify(value));
        return;
      }
    } catch (e) {}
    mem[full] = value;
  }

  function remove(key) {
    var full = PREFIX + key;
    try {
      if (available) {
        localStorage.removeItem(full);
        return;
      }
    } catch (e) {}
    delete mem[full];
  }

  window.DDZStorage = { get: get, set: set, remove: remove };
})();
