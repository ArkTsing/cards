/* ==========================================================================
   sim.js — 引导式模拟小游戏逻辑
   场景：电脑出牌，老人选择怎么跟。点对讲解为什么，点错温和提示。
   依赖：data.js, cards.js, speak.js, learn.js
   ========================================================================== */
(function () {
  'use strict';

  var D = window.DDZData;
  var C = window.DDZCards;
  var L = window.DDZLearn;

  var state = null; // { sim, stepIndex, attempts }

  // 入口：启动一个模拟（按 id）
  function start(simId) {
    var sim = null;
    D.SIMS.forEach(function (s) { if (s.id === simId) sim = s; });
    if (!sim) return false;
    state = { sim: sim, stepIndex: 0, attempts: 0 };
    render();
    return true;
  }

  // 渲染当前步骤
  function render() {
    var mount = document.getElementById('simMount');
    if (!mount) return;

    var sim = state.sim;
    var step = sim.steps[state.stepIndex];

    mount.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'sim-stage';

    // 进度
    var progress = document.createElement('div');
    progress.className = 'sim-progress';
    progress.textContent = sim.emoji + ' ' + sim.title + ' · 第 ' + (state.stepIndex + 1) + ' / ' + sim.steps.length + ' 步';
    wrap.appendChild(progress);

    // 桌面情景
    var scene = document.createElement('div');
    scene.className = 'sim-scene';
    scene.innerHTML = '<div class="sim-scene__label">📢 现在的情况</div><div class="sim-scene__text">' + step.scene + '</div>';
    wrap.appendChild(scene);

    // 上家出的牌（last 展示在中央）
    if (step.last && step.last.length) {
      var center = document.createElement('div');
      center.className = 'sim-center';
      center.innerHTML = '<div class="sim-center__tag">上家出了：</div>';
      var row = document.createElement('div');
      row.className = 'card-demo__row';
      D.ranksToCards(step.last).forEach(function (c) { row.appendChild(L.miniCardEl(c)); });
      center.appendChild(row);
      wrap.appendChild(center);
    }

    // 您手里的牌（展示在下方）
    if (step.hand && step.hand.length) {
      var handWrap = document.createElement('div');
      handWrap.className = 'sim-hand';
      handWrap.innerHTML = '<div class="sim-hand__label">🃏 您手里的牌：</div>';
      var handRow = document.createElement('div');
      handRow.className = 'card-demo__row';
      D.ranksToCards(step.hand).forEach(function (c) { handRow.appendChild(L.miniCardEl(c)); });
      handWrap.appendChild(handRow);
      wrap.appendChild(handWrap);
    }

    // 选项（大按钮，老人友好）
    var options = document.createElement('div');
    options.className = 'sim-options';
    step.options.forEach(function (opt, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sim-option';
      b.textContent = opt.label;
      b.addEventListener('click', function () { pick(i, opt, b, options); });
      options.appendChild(b);
    });
    wrap.appendChild(options);

    // 反馈区
    var fb = document.createElement('div');
    fb.className = 'sim-feedback';
    fb.id = 'simFeedback';
    wrap.appendChild(fb);

    mount.appendChild(wrap);

    // 语音播报情景
    if (window.DDZSpeak) {
      var plain = step.scene.replace(/<[^>]+>/g, '');
      window.DDZSpeak.speak(plain + '。想一想，您怎么出？');
    }
  }

  function pick(index, opt, btn, options) {
    var fb = document.getElementById('simFeedback');
    if (!fb) return;
    var btns = options.querySelectorAll('.sim-option');
    if (opt.good) {
      // 答对了
      btns.forEach(function (x) { x.disabled = true; });
      btn.classList.add('sim-option--good');
      fb.innerHTML = '<div class="sim-feedback__good">✅ <b>对！</b>' + opt.why + '</div>';
      if (window.DDZSpeak) window.DDZSpeak.speak('答对啦！' + opt.why);
      // 下一步按钮
      var next = document.createElement('button');
      next.type = 'button';
      next.className = 'btn btn--accent sim-next';
      next.textContent = (state.stepIndex + 1 >= state.sim.steps.length) ? '完成这一课 🎉' : '下一步 ›';
      next.addEventListener('click', function () {
        state.stepIndex++;
        if (state.stepIndex >= state.sim.steps.length) renderDone();
        else render();
      });
      fb.appendChild(next);
    } else {
      // 答错了：温和提示，允许重试
      state.attempts++;
      btn.classList.add('sim-option--wrong');
      btn.disabled = true;
      fb.innerHTML = '<div class="sim-feedback__gentle">💡 <b>再看看：</b>' + opt.why + '<br><span style="font-size:.9em;">没关系，看看别的选项再试一次。</span></div>';
      if (window.DDZSpeak) window.DDZSpeak.speak(opt.why);
    }
  }

  function renderDone() {
    var mount = document.getElementById('simMount');
    if (!mount) return;
    mount.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'sim-done';
    box.innerHTML =
      '<div class="sim-done__emoji">🎉</div>' +
      '<div class="sim-done__title">完成「' + state.sim.title + '」！</div>' +
      '<p style="font-size:1.1em;color:var(--text-soft);">答错 ' + state.attempts + ' 次，已经很棒了！规则要在玩中练，去游戏里试试吧。</p>';
    var play = document.createElement('a');
    play.className = 'btn btn--accent btn--big';
    play.href = '../play/index.html';
    play.textContent = '🎮 去玩一局';
    box.appendChild(play);
    var more = document.createElement('a');
    more.className = 'btn btn--ghost';
    more.href = 'sim.html';
    more.textContent = '‹ 其他模拟课';
    more.style.marginTop = '.8em';
    box.appendChild(more);
    mount.appendChild(box);
  }

  window.DDZSim = {
    start: start,
    render: render
  };
})();
