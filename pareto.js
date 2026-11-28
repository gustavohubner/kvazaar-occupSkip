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
var PX_FIELD = {
  y: 'pixels_global', occupied_y: 'pixels_occupied', empty_y: 'pixels_empty'
};
var REGION_DEFAULT = 'occupied_y';

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
function normFills(D, opts) {
  var all = fillsOf(D);
  var raw = opts.fills && opts.fills.length ? opts.fills :
    (opts.fill ? [opts.fill] : all);
  var fs = raw.filter(function (f) { return all.indexOf(f) >= 0; });
  return fs.length ? fs : all.slice();
}
function pxOf(D, seq, mode, fill, region) {
  var w = D.pixel_weights[seq + '|' + mode + '|' + fill];
  return (w && w[PX_FIELD[region] || PX_FIELD[REGION_DEFAULT]]) || 1;
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
  var fills = normFills(D, opts);
  // Tempo e BD-rate podem usar conjuntos distintos. Na tabela de detalhe,
  // atributo usa um fill por linha; geometria segue os fills marcados.
  // Como bytes/PSNR são idênticos entre fills, agregar curvas de qualidade
  // não muda o BD-rate — só o tempo ganha mais repetições.
  var timeFills = opts.timeFills && opts.timeFills.length ?
    normFills(D, {fills: opts.timeFills}) : fills;
  var speed = opts.speed;
  var mode = opts.mode;
  var region = PX_FIELD[opts.region] ? opts.region : REGION_DEFAULT;
  var B = opts.B || B_DEFAULT;
  var seqs = seqsOf(D), rates = ratesOf(D);
  // Semente fixa por célula. Com um fill (ou geometria com os 4) ela é a
  // mesma da análise publicada, para preservar os ICs já validados.
  var seedFill = fills.length === 1 ? fills[0] :
    (plane === 'geometry' ? fillsOf(D)[0] : fills.join(','));
  var rnd = mulberry32(hash([plane, seedFill, speed, mode, B].join('|')));
  var nCurves = fills.length * seqs.length;

  function arraysFor(cfg) {
    var out = [];
    timeFills.forEach(function (f) {
      seqs.forEach(function (seq) {
        rates.forEach(function (rate) {
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
  fills.forEach(function (f) {
    seqs.forEach(function (seq) {
      rates.forEach(function (rate) {
        var b = get(D, f, speed, mode, plane, seq, rate, 'base');
        if (!b) return;
        baseBytes += b.bytes;
        baseRows.push({px: pxOf(D, seq, mode, f, region),
          psnr: b.psnr_db[region]});
      });
    });
  });
  var basePsnr = energyPsnr(baseRows);

  var configs = [];
  CONFIGS.forEach(function (cfg) {
    if (cfg === 'base') {
      var zeroCurves = [];
      fills.forEach(function (f) {
        seqs.forEach(function (s) {
          zeroCurves.push({seq: s, fill: f,
            label: fills.length > 1 ? s + ' · ' + f : s, bd: 0});
        });
      });
      configs.push({
        config: 'base', timeS: baseTime, tPct: 0, ciLow: 0, ciHigh: 0,
        bdPct: 0, bdLinearPct: 0,
        bdBySeq: zeroCurves, bdLinearBySeq: zeroCurves,
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
    fills.forEach(function (f) {
      seqs.forEach(function (seq) {
        var bp = [], cp = [];
        rates.forEach(function (rate) {
          var bc = get(D, f, speed, mode, plane, seq, rate, 'base');
          var cc = get(D, f, speed, mode, plane, seq, rate, cfg);
          if (!bc || !cc) return;
          bp.push([bc.psnr_db[region], Math.log(bc.bytes)]);
          cp.push([cc.psnr_db[region], Math.log(cc.bytes)]);
          cfgBytes += cc.bytes;
          cfgRows.push({px: pxOf(D, seq, mode, f, region),
            psnr: cc.psnr_db[region]});
        });
        var bd = bdRate(bp, cp);
        var bdLin = bdRateLinear(bp, cp);
        var label = fills.length > 1 ? seq + ' · ' + f : seq;
        widths.push(bd.width);
        if (bd.value === null) bdBySeq.push({seq: seq, fill: f,
          label: label, bd: null});
        else {
          bdLinBySeq.push({seq: seq, fill: f, label: label, bd: bdLin});
          bdBySeq.push({seq: seq, fill: f, label: label, bd: bd.value});
          bdVals.push(bd.value);
          if (bdLin !== null) bdLinVals.push(bdLin);
        }
      });
    });
    var cfgPsnr = energyPsnr(cfgRows);
    configs.push({
      config: cfg,
      timeS: timeS,
      tPct: tPct,
      ciLow: ciLow,
      ciHigh: ciHigh,
      bdPct: bdVals.length === nCurves ? geoMeanPct(bdVals) : null,
      bdLinearPct: bdLinVals.length === nCurves ?
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
    cell: {plane: plane, fill: fills[0], fills: fills.slice(),
      timeFills: timeFills.slice(), speed: speed, mode: mode, region: region},
    base: {timeS: baseTime, bytes: baseBytes, psnr: basePsnr},
    configs: configs,
    front: configs.filter(function (c) { return c.pareto; })
      .map(function (c) { return c.config; })
  };
}

/* ---------------------------- selecao ------------------------------ */
// Escalarizacao linear: E = T% − λ·BD%, com λ declarado na interface.
// BD% > 0 (mais bits) e penalizado; BD% < 0 (menos bits) e bonus.
// O base tem E = 0: e a referencia, entao so se adota quem tiver E > 0.
// Curvas sem BD-rate nao recebem E (nao e possivel comparar).
// T% < 0 (config mais lenta) nunca e elegivel, mesmo com menos bits.
var LAMBDA_DEFAULT = 5;
function efficiencyOf(c, lambda) {
  if (c.bdPct === null) return null;
  if (c.config === 'base') return 0;
  return c.tPct - lambda * c.bdPct;
}
function fmtEfficiency(e) {
  if (e === null || e === undefined) return '—';
  if (!isFinite(e)) return e > 0 ? '∞' : '−∞';
  return e.toFixed(2).replace('.', ',');
}
function select(res, requireCI, lambda) {
  var lam = typeof lambda === 'number' && isFinite(lambda) ?
    lambda : LAMBDA_DEFAULT;
  var configs = res.configs.map(function (c) {
    var eff = efficiencyOf(c, lam);
    // O base participa sempre com E = 0: nada com E negativo o supera.
    var eligible = c.config === 'base' ||
      (eff !== null && c.pareto && c.tPct > 0 &&
        (!requireCI || c.ciLow > 0));
    return Object.assign({}, c, {
      efficiency: eff, eligible: eligible, selected: false
    });
  });
  var eligible = configs.filter(function (c) { return c.eligible; });
  var winner = null;
  if (eligible.length) {
    winner = eligible.reduce(function (a, b) {
      if (b.efficiency > a.efficiency) return b;
      if (b.efficiency === a.efficiency && b.tPct > a.tPct) return b;
      if (b.efficiency === a.efficiency && b.tPct === a.tPct &&
          Math.abs(b.bdPct) < Math.abs(a.bdPct)) return b;
      return a;
    });
    winner.selected = true;
  }
  var bestCandidate = null;
  if (!winner) {
    var cands = configs.filter(function (c) {
      return c.config !== 'base' && c.pareto && c.efficiency !== null;
    });
    if (cands.length) {
      bestCandidate = cands.reduce(function (a, b) {
        return b.efficiency > a.efficiency ? b : a;
      });
    }
  }
  var rule = 'maior E = T% − ' + String(lam).replace('.', ',') +
    '·BD% na frente de Pareto, com T% > 0' +
    (requireCI ? ' e IC95% do tempo > 0' : '') +
    '; base tem E = 0 e so troca se outra tiver E > 0;' +
    ' BD% < 0 aumenta E, BD% > 0 reduz E';
  return {
    cell: res.cell, base: res.base, configs: configs, front: res.front,
    requireCI: requireCI, lambda: lam,
    winner: winner ? winner.config : 'base',
    winnerRow: winner,
    bestCandidate: bestCandidate,
    rule: rule
  };
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
    var geo = c.plane === 'geometry';
    return computeCell(D, {
      plane: c.plane,
      fill: geo ? fillsOf(D)[0] : c.fill,
      timeFills: geo ? fillsOf(D) : [c.fill],
      speed: c.speed, mode: c.mode, region: opts.region, B: opts.B
    });
  });
}

global.PARETO = {
  CONFIGS: CONFIGS,
  computeCell: computeCell,
  computeAll: computeAll,
  cellsOf: cellsOf,
  select: select,
  efficiencyOf: efficiencyOf,
  fmtEfficiency: fmtEfficiency,
  LAMBDA_DEFAULT: LAMBDA_DEFAULT,
  bdRate: bdRate,
  median: median
};
})(typeof window !== 'undefined' ? window : globalThis);
