'use strict';
// 验证「整体让开」layoutCards（用真实 fitHand 计算基础布局）：
//  1) 选中牌左侧所有牌整体左移 gap，右侧整体右移 gap，间距不变
//  2) 选中牌自身 gap=0
//  3) 多张连续选中：minSel 左侧整体左移，maxSel 右侧整体右移
//  4) 溢出保护：总宽不超容器

function fitHand(n, availW, availH, fs) {
  fs = fs || 22;
  var FAN_DESIRED_MAX_ANGLE = 7, FAN_MIN_SLIVER = 6, FAN_MAX_SLIVER = 28;
  var maxW = Math.min(96, Math.max(66, fs * 3.0));
  var minW = Math.max(30, Math.min(52, fs * 1.6));
  var maxH = (availH - fs * 1.6) / 1.35;
  if (maxH < 30) maxH = 30;
  var desiredRad = FAN_DESIRED_MAX_ANGLE * Math.PI / 180;
  for (var cw = Math.floor(maxW); cw >= minW; cw--) {
    var h = cw * 1.447;
    if (h > maxH) continue;
    var sliver = Math.min(FAN_MAX_SLIVER, (availW - cw) / Math.max(1, n - 1));
    if (sliver < FAN_MIN_SLIVER) sliver = Math.max(2, sliver);
    var rotateExtra = 2.6 * h * Math.sin(desiredRad);
    var span = cw + (n - 1) * sliver + rotateExtra;
    if (span <= availW && sliver >= 2) {
      var slack = availW - (cw + (n - 1) * sliver);
      var maxRad = Math.min(desiredRad, Math.max(0, slack / (2.6 * h)));
      var stepAngle = n > 1 ? (maxRad * 180 / Math.PI) / ((n - 1) / 2) : 0;
      stepAngle = Math.min(stepAngle, 3.4);
      return { w: Math.round(cw), h: Math.round(h), sliver: sliver, stepAngle: stepAngle };
    }
  }
  var cw2 = minW, h2 = minW * 1.447;
  if (h2 > maxH) { h2 = maxH; cw2 = maxH / 1.447; }
  var sliver2 = Math.max(2, (availW - cw2 - 2.6 * h2 * Math.sin(2 * Math.PI / 180)) / Math.max(1, n - 1));
  return { w: Math.round(cw2), h: Math.round(h2), sliver: sliver2, stepAngle: 0 };
}

function layout(fit, n, availW, handTotal, selSet) {
  var gaps = new Array(n).fill(0);
  var selIdxs = selSet.slice().sort(function(a,b){return a-b;});
  var minSel = selIdxs[0], maxSel = selIdxs[selIdxs.length-1];
  var gap = Math.round(fit.w * 0.15);
  for (var i = 0; i < n; i++) {
    if (i < minSel) gaps[i] = -gap;
    else if (i > maxSel) gaps[i] = gap;
  }
  var slack = Math.max(0, availW - handTotal);
  var extra = gap * 2;
  if (extra > slack) {
    var scale = slack / extra;
    if (scale > 0 && scale < 1) {
      gap = Math.round(gap * scale);
      for (var j = 0; j < n; j++) {
        if (j < minSel) gaps[j] = -gap;
        else if (j > maxSel) gaps[j] = gap;
      }
    } else if (scale <= 0) {
      gaps = new Array(n).fill(0);
      gap = 0;
    }
  }
  var minG = Math.min.apply(null, gaps), maxG = Math.max.apply(null, gaps);
  var actualTotal = handTotal + (maxG - minG);
  return { gaps: gaps, gap: gap, actualTotal: actualTotal };
}

var fail = 0, pass = 0, totalChecks = 0;
var widths = [320, 480, 640, 800, 960, 1024, 1280, 1440, 1920];
var fss = [20, 22, 24, 27];
var counts = [5, 10, 14, 17, 20];
var ex = [];
for (var wi = 0; wi < widths.length; wi++) {
  for (var fi = 0; fi < fss.length; fi++) {
    var fs = fss[fi];
    for (var ci = 0; ci < counts.length; ci++) {
      var n = counts[ci];
      var vw = widths[wi];
      var sidePad = vw <= 480 ? (64+64+12) : (vw <= 960 ? (84+84+8) : (vw - 360));
      var availW = Math.max(120, vw - sidePad);
      var fit = fitHand(n, availW, 300, fs);
      var edgeDeg = fit.stepAngle * (n - 1) / 2;
      var handTotal = fit.w + (n - 1) * fit.sliver + 2.6 * fit.h * Math.sin(edgeDeg * Math.PI / 180);

      var selSets = [[Math.floor(n/2)], [0], [n-1], [0,1,2], [Math.floor(n/2)-1, Math.floor(n/2), Math.floor(n/2)+1]];
      selSets.forEach(function (selSet) {
        totalChecks++;
        var r = layout(fit, n, availW, handTotal, selSet);
        if (r.actualTotal > availW + 1) {
          fail++;
          if (ex.length < 8) ex.push({kind:'over', vw:vw, fs:fs, n:n, sel:selSet, actual:Math.round(r.actualTotal), avail:Math.round(availW), handTotal:Math.round(handTotal)});
          return;
        }
        var minSel = Math.min.apply(null, selSet), maxSel = Math.max.apply(null, selSet);
        for (var i = 0; i < n; i++) {
          var expect;
          if (i < minSel) expect = -r.gap;
          else if (i > maxSel) expect = r.gap;
          else expect = 0;
          if (r.gaps[i] !== expect) {
            fail++;
            if (ex.length < 8) ex.push({kind:'expect', vw:vw, n:n, sel:selSet, i:i, got:r.gaps[i], expect:expect, gap:r.gap});
          }
        }
      });
    }
  }
}
var pass = totalChecks - fail;
console.log('totalChecks:', totalChecks, 'pass:', pass, 'fail:', fail);
if (ex.length) console.log('FAIL:', JSON.stringify(ex, null, 2));
