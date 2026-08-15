/* ==========================================================================
   speak.js — 语音播报封装（浏览器 speechSynthesis，零依赖、断网可用）
   localStorage key: ddz_voice = 'on' | 'off'（默认 on）
   ========================================================================== */
(function () {
  'use strict';

  var VOICE_KEY = 'ddz_voice';
  var enabled = true;
  var queue = [];
  var speaking = false;

  try {
    enabled = localStorage.getItem(VOICE_KEY) !== 'off';
  } catch (e) {}

  var synth = null;
  try {
    if ('speechSynthesis' in window) synth = window.speechSynthesis;
  } catch (e) {}

  function pickVoice() {
    if (!synth) return null;
    var voices = synth.getVoices();
    if (!voices || !voices.length) return null;
    // 优先中文女声
    var zh = voices.filter(function (v) {
      return /^zh[-_]?(CN|Hans)/i.test(v.lang) || /Chinese/i.test(v.name);
    });
    return zh[0] || voices[0] || null;
  }

  // 朗读一句话。排队逐句播报，前一句没说完不会播下一句。
  // 可选 cb：这一句播报结束后触发（用于游戏节奏：播完再走下一步）。
  function speak(text, cb) {
    if (!enabled || !synth || !text) {
      if (cb) cb();
      return;
    }
    queue.push({ text: String(text), cb: cb || null });
    pump();
  }

  function pump() {
    if (speaking || !queue.length) return;
    var item = queue.shift();
    var text = item.text;
    var cb = item.cb;
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 0.85;   // 稍慢，老人友好
      u.pitch = 1.0;
      var v = pickVoice();
      if (v) u.voice = v;
      var finished = false;
      // 兜底：个别浏览器 onend 不触发，按字数给个上限
      var safety = setTimeout(finish, Math.max(3000, text.length * 260));
      function finish() {
        if (finished) return;
        finished = true;
        clearTimeout(safety);
        speaking = false;
        if (cb) cb();
        pump();
      }
      u.onend = finish;
      u.onerror = finish;
      speaking = true;
      synth.speak(u);
    } catch (e) {
      speaking = false;
      queue = [];
      if (cb) cb();
    }
  }

  function stop() {
    if (synth) { try { synth.cancel(); } catch (e) {} }
    speaking = false;
    queue = [];
  }

  function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem(VOICE_KEY, enabled ? 'on' : 'off'); } catch (e) {}
    if (!enabled) stop();
  }

  function isEnabled() { return enabled; }

  window.DDZSpeak = {
    speak: speak,
    stop: stop,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
    KEY: VOICE_KEY
  };

  // 预加载语音列表（部分浏览器需用户交互后才填充）
  if (synth) {
    synth.onvoiceschanged = function () { try { synth.getVoices(); } catch (e) {} };
  }
})();
