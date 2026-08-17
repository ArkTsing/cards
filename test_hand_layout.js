'use strict';
function fitHand(n, availW, availH, fs) {
  fs = fs || 22;
  var FAN_DESIRED_MAX_ANGLE = 7, FAN_MIN_SLIVER = 6, FAN_MAX_SLIVER = 34;
  var maxW = Math.min(120, Math.max(66, fs * 3.2));
  var minW = Math.max(30, Math.min(52, fs * 1.6));
  var maxH = (availH - fs * 1.6) / 1.35;
  if (maxH < 30) maxH = 30;
  var desiredRad = FAN_DESIRED_MAX_ANGLE * Math.PI / 180;
  // 逐牌宽枚举，选"可见宽度 = min(露边, 牌宽×50%)"最大的方案
  var best = null, bestScore = -1;
  for (var cw = Math.floor(maxW); cw >= minW; cw--) {
    var h = cw * 1.447;
    if (h > maxH) continue;
    var sliver = Math.min(FAN_MAX_SLIVER, (availW - cw) / Math.max(1, n - 1));
    if (sliver < FAN_MIN_SLIVER) sliver = Math.max(2, sliver);
    var base = cw + (n - 1) * sliver;
    if (base > availW) continue;
    var score = Math.min(sliver, cw * 0.5);
    if (score > bestScore) { bestScore = score; best = { w: cw, h: h, sliver: sliver }; }
  }
  if (best) {
    var slack = availW - (best.w + (n - 1) * best.sliver);
    var maxRad = Math.min(desiredRad, Math.max(0, slack / (2.6 * best.h)));
    var stepAngle = n > 1 ? (maxRad * 180 / Math.PI) / ((n - 1) / 2) : 0;
    stepAngle = Math.min(stepAngle, 3.4);
    return { w: Math.round(best.w), h: Math.round(best.h), sliver: best.sliver, stepAngle: stepAngle };
  }
  var cw3 = minW, h3 = minW * 1.447;
  if (h3 > maxH) { h3 = maxH; cw3 = maxH / 1.447; }
  var sliver3 = (availW - cw3 - 2.6 * h3 * Math.sin(2 * Math.PI / 180)) / Math.max(1, n - 1);
  if (sliver3 < 1) sliver3 = 1;
  if (sliver3 > FAN_MIN_SLIVER) sliver3 = FAN_MIN_SLIVER;
  return { w: Math.round(cw3), h: Math.round(h3), sliver: sliver3, stepAngle: 0 };
}
function actualSpan(fit, n) {
  var edgeDeg = fit.stepAngle * (n - 1) / 2;
  return fit.w + (n - 1) * fit.sliver + 2.6 * fit.h * Math.sin(edgeDeg * Math.PI / 180);
}
function actualHandH(fit, fs) { return fit.h * 1.35 + fs * 1.6; }
function estimateFixedH(vh, fs, isPractice) {
  var topbarH = fs * 1.0 + 44;
  var announceH = isPractice ? (fs * 0.92 * 1.5 + fs * 0.92 * 0.55 * 2) : 0;
  var compact = vh <= 640;
  var bodyPad = compact ? fs * 0.92 * 0.25 + fs * 0.92 * 0.45 : fs * 0.92 * 0.4 + fs * 0.92 * 0.6;
  var zonePad = compact ? fs * 0.92 * 0.25 + fs * 0.92 * 0.5 : fs * 0.92 * 0.4 + fs * 0.92 * 0.7;
  var infoRow = compact ? 46 : 56;
  var actionsH = compact ? 48 : 56;
  var gapZone = (fs * 0.92 * (compact ? 0.15 : 0.3)) * 2;
  var handPad = compact ? fs * 0.92 * 0.35 + fs * 0.92 * 0.05 : fs * 0.92 * 0.6 + fs * 0.92 * 0.1;
  return topbarH + announceH + bodyPad + zonePad + infoRow + actionsH + gapZone + handPad;
}

var fail = 0, pass = 0, scrollNeeded = 0;
var widths = [240, 320, 480, 640, 800, 960, 1024, 1280, 1440, 1920];
var heights = [300, 400, 480, 560, 640, 700, 800, 900, 1080];
var fss = [20, 22, 24, 27];
var counts = [1, 5, 10, 14, 17, 20, 34, 40];
var examples = [];
for (var isP = 0; isP < 2; isP++) {
  for (var wi = 0; wi < widths.length; wi++) {
    for (var hi = 0; hi < heights.length; hi++) {
      var vw = widths[wi], vh = heights[hi];
      for (var fi = 0; fi < fss.length; fi++) {
        var fs = fss[fi];
        for (var ci = 0; ci < counts.length; ci++) {
          var n = counts[ci];
          var sidePad = vw <= 480 ? (64+64+12) : (vw <= 960 ? (84+84+8) : (vw - 360));
          var availW = Math.max(120, vw - sidePad);
          var fixedH = estimateFixedH(vh, fs, isP === 1);
          var availH = Math.max(72, vh - fixedH);
          var fit = fitHand(n, availW, availH, fs);
          var handH = actualHandH(fit, fs);
          var totalH = fixedH + handH;
          var span = actualSpan(fit, n);
          var overflowW = span - availW;
          // 判定：
          //  1) 横向永远不溢出（硬性）
          //  2) 正常高度 vh>=400：手牌完整首屏可见
          //  3) 极端矮屏 vh<400：允许纵向滚动（手牌区可达）
          var hardFail = overflowW > 0.5;
          var fitFail = (vh >= 400) && (totalH > vh + 1);
          if (hardFail || fitFail) {
            fail++;
            if (examples.length < 12) examples.push({isP:!!isP, vw:vw, vh:vh, fs:fs, n:n, overflowW:+overflowW.toFixed(1), totalH:Math.round(totalH), vh:vh, kind: hardFail?'W':'H'});
          } else {
            pass++;
            if (vh < 400 && totalH > vh) scrollNeeded++;
          }
        }
      }
    }
  }
}
console.log('pass:', pass, 'fail:', fail, 'scroll-needed(极端矮屏):', scrollNeeded);
if (examples.length) console.log('FAIL:', JSON.stringify(examples, null, 2));
