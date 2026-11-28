/* Frente de Pareto BD-rate x tempo, calculada a partir de window.RD_DATA.
   Sem dependencias. Exposto como window.PARETO para o site e para testes. */
(function (global) {
'use strict';

var CONFIGS = ['base', 'd0', 'd1', 'd2', 'd3', 'd0qp25', 'd1qp25',
               'd2qp25', 'd3qp25', 'skip'];
var SEQS = ['longdress', 'loot', 'redandblack', 'soldier', 'queen'];
var RATES = ['r1', 'r2', 'r3', 'r4', 'r5'];
var FILLS = ['patchExtension', 'bbpe', 'pushPull', 'none'];
var SPEEDS = ['slow', 'fast'];
var MODES = ['ra', 'ai'];
var B_DEFAULT = 1000;
var MIN_OVERLAP_DB = 0.5;
var MAX_U8 = 255;
// Diferenca de T% abaixo disto e empate: decide o menor BD%. A menor
// semi-largura de IC95% da suite e 0,12 p.p., entao 0,05 p.p. e ruido.
var TIE_TOL_PCT = 0.05;

/* ------------------------------ dados ------------------------------ */
function idx(D) {
  if (D.__paretoIdx) return D.__paretoIdx;
  var by = {};
  D.cells.forEach(function (c) {
    by[[c.fill_method, c.speed, c.mode, c.plane, c.seq, c.rate,
        c.config].join('|')] = c;
  });
  D.__paretoIdx = by;
  return by;
}
function get(D, fill, speed, mode, plane, seq, rate, cfg) {
  return idx(D)[[fill, speed, mode, plane, seq, rate, cfg].join('|')];
}
function seqsOf(D) { return (D.axes && D.axes.sequences) || SEQS; }
function ratesOf(D) { return (D.axes && D.axes.rates) ? Object.keys(D.axes.rates) : RATES; }
function fillsOf(D) {
  var f = (D.axes && D.axes.fill_methods) || FILLS;
  return f.length ? f : FILLS;
}
function repsWall(cell) {
  return cell.time_s.reps.map(function (r) { return r.wall; });
}
function pxOf(D, seq, mode, fill) {
  var w = D.pixel_weights[seq + '|' + mode + '|' + fill];
  return (w && w.pixels_occupied) || 1;
}

/* --------------------------- estatistica --------------------------- */
function median(a) {
  var b = Array.prototype.slice.call(a).sort(function (x, y) { return x - y; });
  var n = b.length;
  return n % 2 ? b[(n - 1) >> 1] : 0.5 * (b[n / 2 - 1] + b[n / 2]);
}
function sumMedians(arrays) {
  var s = 0;
  for (var i = 0; i < arrays.length; i++) s += median(arrays[i]);
  return s;
}
function hash(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function bootSums(arrays, B, rnd) {
  var out = new Float64Array(B);
  for (var a = 0; a < arrays.length; a++) {
    var arr = arrays[a], n = arr.length, buf = new Float64Array(n);
    for (var b = 0; b < B; b++) {
      for (var i = 0; i < n; i++) buf[i] = arr[(rnd() * n) | 0];
      buf.sort();
      out[b] += n % 2 ? buf[(n - 1) >> 1] :
        0.5 * (buf[n / 2 - 1] + buf[n / 2]);
    }
  }
  return out;
}
function quantile(sorted, p) {
  var idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function geoMeanPct(vals) {
  var s = 0;
  for (var i = 0; i < vals.length; i++) s += Math.log1p(vals[i] / 100);
  return 100 * (Math.exp(s / vals.length) - 1);
}
function energyPsnr(rows) {
  var n = 0, sse = 0;
  rows.forEach(function (r) {
    n += r.px;
    sse += 65025 * r.px / Math.pow(10, r.psnr / 10);
  });
  return 10 * Math.log10(65025 * n / sse);
}

/* ----------------------------- BD-rate ----------------------------- */
function pchipEdge(h0, h1, d0, d1) {
  var d = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if ((d > 0) !== (d0 > 0)) d = 0;
  else if ((d0 > 0) !== (d1 > 0) && Math.abs(d) > Math.abs(3 * d0)) d = 3 * d0;
  return d;
}
function pchipSlopes(x, y) {
  var n = x.length, h = [], delta = [], d = [], i;
  for (i = 0; i < n - 1; i++) {
    h[i] = x[i + 1] - x[i];
    delta[i] = (y[i + 1] - y[i]) / h[i];
  }
  d[0] = pchipEdge(h[0], h[1], delta[0], delta[1]);
  d[n - 1] = pchipEdge(h[n - 2], h[n - 3], delta[n - 2], delta[n - 3]);
  for (i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) d[i] = 0;
    else {
      var w1 = 2 * h[i] + h[i - 1];
      var w2 = h[i] + 2 * h[i - 1];
      d[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }
  return {h: h, d: d};
}
function pchipEval(x, y, s, xv) {
  var i = 0;
  while (i < x.length - 2 && xv > x[i + 1]) i++;
  var h = x[i + 1] - x[i], t = (xv - x[i]) / h;
  var t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y[i] +
    (t3 - 2 * t2 + t) * h * s.d[i] +
    (-2 * t3 + 3 * t2) * y[i + 1] +
    (t3 - t2) * h * s.d[i + 1];
}
function bdRate(basePts, cfgPts) {
  var bp = basePts.slice().sort(function (a, b) { return a[0] - b[0]; });
  var cp = cfgPts.slice().sort(function (a, b) { return a[0] - b[0]; });
  var lo = Math.max(bp[0][0], cp[0][0]);
  var hi = Math.min(bp[bp.length - 1][0], cp[cp.length - 1][0]);
  var width = hi - lo;
  if (!(width >= MIN_OVERLAP_DB)) return {value: null, width: width};
  var bx = bp.map(function (p) { return p[0]; });
  var by = bp.map(function (p) { return p[1]; });
  var cx = cp.map(function (p) { return p[0]; });
  var cy = cp.map(function (p) { return p[1]; });
  for (var i = 0; i < bx.length - 1; i++) {
    if (!(bx[i + 1] > bx[i])) return {value: null, width: width};
    if (!(cx[i + 1] > cx[i])) return {value: null, width: width};
  }
  var sb = pchipSlopes(bx, by), sc = pchipSlopes(cx, cy);
  var N = 200, sum = 0;
  for (var k = 0; k <= N; k++) {
    var p = lo + (hi - lo) * k / N;
    sum += pchipEval(cx, cy, sc, p) - pchipEval(bx, by, sb, p);
  }
  return {value: 100 * (Math.exp(sum / (N + 1)) - 1), width: width};
}
function interpLinear(pts, p) {
  if (p <= pts[0][0]) return pts[0][1];
  if (p >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (var i = 0; i < pts.length - 1; i++) {
    if (pts[i][0] <= p && p <= pts[i + 1][0]) {
      var t = (p - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
      return pts[i][1] + t * (pts[i + 1][1] - pts[i][1]);
    }
  }
  return pts[pts.length - 1][1];
}
function bdRateLinear(basePts, cfgPts) {
  var bp = basePts.slice().sort(function (a, b) { return a[0] - b[0]; });
  var cp = cfgPts.slice().sort(function (a, b) { return a[0] - b[0]; });
  var lo = Math.max(bp[0][0], cp[0][0]);
  var hi = Math.min(bp[bp.length - 1][0], cp[cp.length - 1][0]);
  if (!(hi - lo >= MIN_OVERLAP_DB)) return null;
  var N = 100, sum = 0;
  for (var k = 0; k <= N; k++) {
    var p = lo + (hi - lo) * k / N;
    sum += interpLinear(cp, p) - interpLinear(bp, p);
  }
  return 100 * (Math.exp(sum / (N + 1)) - 1);
}

/* --------------------------- uma celula ---------------------------- */
function computeCell(D, opts) {
  var plane = opts.plane;
  var fill = opts.fill || fillsOf(D)[0];
  var speed = opts.speed;
  var mode = opts.mode;
  var B = opts.B || B_DEFAULT;
  var seqs = seqsOf(D), rates = ratesOf(D), fills = fillsOf(D);
  var timeFills = plane === 'geometry' ? fills : [fill];
  var rnd = mulberry32(hash([plane, fill, speed, mode, B].join('|')));

  function arraysFor(cfg) {
    var out = [];
    seqs.forEach(function (seq) {
      rates.forEach(function (rate) {
        timeFills.forEach(function (f) {
          var c = get(D, f, speed, mode, plane, seq, rate, cfg);
          if (c) out.push(repsWall(c));
        });
      });
    });
    return out;
  }

  var baseArrays = arraysFor('base');
  var baseTime = sumMedians(baseArrays);
  var baseBoot = bootSums(baseArrays, B, rnd);
  var baseBytes = 0, baseRows = [];
  seqs.forEach(function (seq) {
    rates.forEach(function (rate) {
      var b = get(D, fill, speed, mode, plane, seq, rate, 'base');
      if (!b) return;
      baseBytes += b.bytes;
      baseRows.push({px: pxOf(D, seq, mode, fill),
        psnr: b.psnr_db.occupied_y});
    });
  });
  var basePsnr = energyPsnr(baseRows);

  var configs = [];
  CONFIGS.forEach(function (cfg) {
    if (cfg === 'base') {
      configs.push({
        config: 'base', timeS: baseTime, tPct: 0, ciLow: 0, ciHigh: 0,
        bdPct: 0, bdLinearPct: 0,
        bdBySeq: seqs.map(function (s) { return {seq: s, bd: 0}; }),
        bdLinearBySeq: seqs.map(function (s) { return {seq: s, bd: 0}; }),
        overlapMin: 0, dqDb: 0, bitsPct: 0, pareto: false
      });
      return;
    }
    var arrays = arraysFor(cfg);
    var timeS = sumMedians(arrays);
    var cfgBoot = bootSums(arrays, B, rnd);
    var tPct = 100 * (baseTime - timeS) / baseTime;
    var tDist = new Float64Array(B);
    for (var b = 0; b < B; b++) {
      tDist[b] = 100 * (baseBoot[b] - cfgBoot[b]) / baseBoot[b];
    }
    tDist.sort();
    var ciLow = quantile(tDist, 0.025);
    var ciHigh = quantile(tDist, 0.975);

    var bdBySeq = [], bdVals = [], bdLinVals = [], bdLinBySeq = [], widths = [];
    var cfgBytes = 0, cfgRows = [];
    seqs.forEach(function (seq) {
      var bp = [], cp = [];
      rates.forEach(function (rate) {
        var bc = get(D, fill, speed, mode, plane, seq, rate, 'base');
        var cc = get(D, fill, speed, mode, plane, seq, rate, cfg);
        if (!bc || !cc) return;
        bp.push([bc.psnr_db.occupied_y, Math.log(bc.bytes)]);
        cp.push([cc.psnr_db.occupied_y, Math.log(cc.bytes)]);
        cfgBytes += cc.bytes;
        cfgRows.push({px: pxOf(D, seq, mode, fill),
          psnr: cc.psnr_db.occupied_y});
      });
      var bd = bdRate(bp, cp);
      var bdLin = bdRateLinear(bp, cp);
      widths.push(bd.width);
      if (bd.value === null) bdBySeq.push({seq: seq, bd: null});
      else {
        bdLinBySeq.push({seq: seq, bd: bdLin});
        bdBySeq.push({seq: seq, bd: bd.value});
        bdVals.push(bd.value);
        if (bdLin !== null) bdLinVals.push(bdLin);
      }
    });
    var cfgPsnr = energyPsnr(cfgRows);
    configs.push({
      config: cfg,
      timeS: timeS,
      tPct: tPct,
      ciLow: ciLow,
      ciHigh: ciHigh,
      bdPct: bdVals.length === seqs.length ? geoMeanPct(bdVals) : null,
      bdLinearPct: bdLinVals.length === seqs.length ?
        geoMeanPct(bdLinVals) : null,
      bdBySeq: bdBySeq,
      bdLinearBySeq: bdLinBySeq,
      overlapMin: widths.length ? Math.min.apply(null, widths) : 0,
      dqDb: basePsnr - cfgPsnr,
      bitsPct: 100 * (cfgBytes - baseBytes) / baseBytes,
      pareto: false
    });
  });

  var valid = configs.filter(function (c) { return c.bdPct !== null; });
  valid.forEach(function (a) {
    a.pareto = !valid.some(function (b) {
      return b !== a && b.tPct >= a.tPct && b.bdPct <= a.bdPct &&
        (b.tPct > a.tPct || b.bdPct < a.bdPct);
    });
  });

  return {
    cell: {plane: plane, fill: fill, speed: speed, mode: mode},
    base: {timeS: baseTime, bytes: baseBytes, psnr: basePsnr},
    configs: configs,
    front: configs.filter(function (c) { return c.pareto; })
      .map(function (c) { return c.config; })
  };
}

/* ---------------------------- selecao ------------------------------ */
function select(res, threshold, requireCI) {
  var configs = res.configs.map(function (c) {
    var eligible = c.config !== 'base' && c.bdPct !== null && c.pareto &&
      c.bdPct <= threshold + 1e-12 && (!requireCI || c.ciLow > 0);
    return Object.assign({}, c, {eligible: eligible, selected: false});
  });
  var eligible = configs.filter(function (c) { return c.eligible; });
  var winner = null;
  if (eligible.length) {
    var top = eligible.reduce(function (m, c) {
      return c.tPct > m ? c.tPct : m;
    }, -Infinity);
    var tied = eligible.filter(function (c) {
      return top - c.tPct <= TIE_TOL_PCT;
    });
    winner = tied.reduce(function (a, b) {
      if (b.bdPct < a.bdPct) return b;
      if (b.bdPct === a.bdPct && b.tPct > a.tPct) return b;
      return a;
    });
    winner.selected = true;
  }
  var bestCandidate = null;
  if (!winner) {
    var cands = configs.filter(function (c) {
      return c.config !== 'base' && c.pareto;
    });
    if (cands.length) {
      bestCandidate = cands.reduce(function (a, b) {
        return b.tPct > a.tPct ? b : a;
      });
    }
  }
  var rule;
  if (winner) {
    rule = 'BD% <= ' + fmtThreshold(threshold) +
      (requireCI ? ' e IC95% do tempo > 0' : '') +
      '; maior T% (empate < ' + String(TIE_TOL_PCT).replace('.', ',') +
      ' p.p.: menor BD%)';
  } else {
    rule = 'nenhuma config com BD% <= ' + fmtThreshold(threshold) +
      (requireCI ? ' e IC95% do tempo > 0' : '') + '; mantem base';
  }
  return {
    cell: res.cell, base: res.base, configs: configs, front: res.front,
    threshold: threshold, requireCI: requireCI,
    winner: winner ? winner.config : 'base',
    winnerRow: winner,
    bestCandidate: bestCandidate,
    rule: rule
  };
}
function fmtThreshold(v) {
  return String(v).replace('.', ',') + '%';
}

/* ---------------------------- 20 celulas --------------------------- */
function cellsOf(D) {
  var out = [];
  SPEEDS.forEach(function (s) {
    MODES.forEach(function (m) {
      out.push({plane: 'geometry', fill: '*', speed: s, mode: m});
    });
  });
  fillsOf(D).forEach(function (f) {
    SPEEDS.forEach(function (s) {
      MODES.forEach(function (m) {
        out.push({plane: 'attribute', fill: f, speed: s, mode: m});
      });
    });
  });
  return out;
}
function computeAll(D, opts) {
  opts = opts || {};
  return cellsOf(D).map(function (c) {
    return computeCell(D, {
      plane: c.plane,
      fill: c.fill === '*' ? fillsOf(D)[0] : c.fill,
      speed: c.speed, mode: c.mode, B: opts.B
    });
  });
}

global.PARETO = {
  CONFIGS: CONFIGS,
  computeCell: computeCell,
  computeAll: computeAll,
  cellsOf: cellsOf,
  select: select,
  bdRate: bdRate,
  median: median
};
})(typeof window !== 'undefined' ? window : globalThis);
