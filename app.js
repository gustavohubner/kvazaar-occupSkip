/* Dashboard estático dos resultados de ocupação.
   Dados: window.RD_DATA (data.js). Sem frameworks, sem rede. */
(function () {
'use strict';

var D = window.RD_DATA;
if (!D) { document.body.textContent = 'data.js não carregou.'; return; }
var PARETO = window.PARETO;

var SVG_NS = 'http://www.w3.org/2000/svg';
var SEQS = D.axes.sequences;
var SPEEDS = ['slow', 'fast'];
var MODES = ['ra', 'ai'];
var PLANES = ['geometry', 'attribute'];
var RATES = Object.keys(D.axes.rates);
var REGIONS = [
  ['y', 'Y global'], ['occupied_y', 'Y ocupado'], ['empty_y', 'Y vazio']
];
var REGION_NAME = {};
REGIONS.forEach(function (p) { REGION_NAME[p[0]] = p[1]; });
var CFGS = ['base', 'd0', 'd1', 'd2', 'd3', 'd0qp25', 'd1qp25', 'd2qp25',
            'd3qp25', 'skip'];
var COLORS = {
  base: '#111827', d0: '#2563eb', d1: '#0891b2', d2: '#059669',
  d3: '#65a30d', d0qp25: '#dc2626', d1qp25: '#ea580c', d2qp25: '#d97706',
  d3qp25: '#a16207', skip: '#7c3aed'
};
var GROUPS = [];
SPEEDS.forEach(function (sp) {
  MODES.forEach(function (md) {
    PLANES.forEach(function (pl) {
      GROUPS.push({
        speed: sp, mode: md, plane: pl,
        short: sp + ' ' + md.toUpperCase() + (pl === 'geometry' ? ' G' : ' A')
      });
    });
  });
});
var METRIC_COLS = {
  bits: {key: 'pctBytes', label: 'bits', suffix: '%', psnr: false},
  psnr_occ: {key: 'dbOcc', label: 'PSNR occ', suffix: ' dB', psnr: true},
  psnr_y: {key: 'dbY', label: 'PSNR Y', suffix: ' dB', psnr: true},
  psnr_empty: {key: 'dbEmpty', label: 'PSNR vazio', suffix: ' dB', psnr: true},
  user: {key: 'pctUser', label: 'tempo user', suffix: '%', psnr: false},
  wall: {key: 'pctWall', label: 'tempo wall', suffix: '%', psnr: false}
};

var ALL_CELLS = D.cells;
var FILL_METHODS = (D.axes.fill_methods || ['patchExtension']).slice();
var FILL_SHORT = {patchExtension: 'patchExt', bbpe: 'bbpe',
  pushPull: 'pushPull', none: 'none'};
var MARKERS = ['circle', 'square', 'triangle', 'star'];
function fillLabel(fill) { return FILL_SHORT[fill] || fill; }
var CELLS = [];
var BY_KEY = {};

function cellKey(c) {
  return [c.fill_method, c.speed, c.mode, c.plane, c.seq, c.rate,
    c.config].join('|');
}
function rebuildCells() {
  CELLS = ALL_CELLS.slice();
  BY_KEY = {};
  CELLS.forEach(function (c) { BY_KEY[cellKey(c)] = c; });
}
function getCell(sp, md, pl, seq, rate, cfg, fill) {
  fill = fill || activeFills()[0] || FILL_METHODS[0];
  return BY_KEY[[fill, sp, md, pl, seq, rate, cfg].join('|')];
}
function cfgLabel(cfg) { return D.configs[cfg].label; }
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function cloneSet(a) { var s = {}; a.forEach(function (v) { s[v] = true; }); return s; }

var state = {
  speed: 'slow', mode: 'ra', plane: 'geometry',
  region: 'occupied_y', xmetric: 'bitrate',
  seqs: cloneSet(SEQS), cfgs: cloneSet(CFGS), rates: cloneSet(RATES),
  fills: cloneSet(FILL_METHODS),
  labels: true, hidden: {},
  tab: 'rd', sub: 'agg', heatMetric: 'bits', aggCompare: 'vs_base',
  heatSort: null, aggSort: null, cellSort: {col: 'seq', dir: 1},
  cellPage: 0, cellSearch: '',
  repCfg: 'skip', repSeq: 'longdress', repRate: 'r4',
  repFill: FILL_METHODS[0], repField: 'user',
  timeYMode: 'absolute', timeSeq: 'avg', timeField: 'user',
  paretoFill: FILL_METHODS[0], paretoThreshold: 0, paretoCI: true,
  paretoFullY: false
};
rebuildCells();

/* --------------------------- utilidades --------------------------- */
function el(tag, attrs, parent) {
  var n = document.createElementNS(SVG_NS, tag);
  for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) {
    n.setAttribute(k, attrs[k]);
  }
  if (parent) parent.appendChild(n);
  return n;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function svgText(parent, x, y, str, cls, anchor) {
  var t = el('text', {x: x, y: y, 'class': cls || ''}, parent);
  if (anchor) t.setAttribute('text-anchor', anchor);
  t.textContent = str;
  return t;
}
function markerFor(fill) {
  var i = FILL_METHODS.indexOf(fill);
  return MARKERS[(i < 0 ? 0 : i) % MARKERS.length];
}
function markerNode(shape, cx, cy, r, color, anim, parent) {
  var attrs = {fill: color, stroke: '#fff', 'stroke-width': 1.5};
  if (anim) attrs['data-anim-key'] = anim;
  var pts;
  if (shape === 'square') {
    return el('rect', Object.assign({x: cx - r, y: cy - r, width: 2 * r,
      height: 2 * r, rx: 1}, attrs), parent);
  }
  if (shape === 'triangle') {
    pts = [[cx, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
  } else if (shape === 'diamond') {
    pts = [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]];
  } else if (shape === 'star') {
    pts = [];
    for (var k = 0; k < 10; k++) {
      var ang = -Math.PI / 2 + k * Math.PI / 5;
      var rr = (k % 2) ? r * 0.45 : r;
      pts.push([cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)]);
    }
  } else {
    return el('circle', Object.assign({cx: cx, cy: cy, r: r}, attrs), parent);
  }
  return el('polygon', Object.assign({points: pts.map(function (p) {
    return p[0].toFixed(1) + ',' + p[1].toFixed(1);
  }).join(' ')}, attrs), parent);
}
function fmt(v, nd) {
  if (!isFinite(v)) return '—';
  return Number(v).toLocaleString('pt-BR', {
    minimumFractionDigits: nd, maximumFractionDigits: nd
  });
}

/* -------------------- transições e números animados ---------------- */
var TWEEN_MS = 500;
var REDUCE_MOTION = window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var tweenPrev = {}, tweenRuns = {};
var NUM_RE = /(^|[^A-Za-zÀ-ÿ\d])([-+]?\d{1,3}(?:\.\d{3})+(?:,\d+)?|[-+]?\d+(?:,\d+)?)(?=$|[^A-Za-zÀ-ÿ\d])/;

function parseNum(s) { return Number(s.replace(/\./g, '').replace(',', '.')); }
function tokenParts(text) {
  var re = new RegExp(NUM_RE.source, 'g'), m, out = [];
  while ((m = re.exec(text)) !== null) {
    var v = parseNum(m[2]);
    if (isFinite(v)) {
      out.push({start: m.index + m[1].length, end: re.lastIndex,
        text: m[2], value: v});
    }
  }
  return out;
}
function formatToken(v, sample) {
  var comma = sample.indexOf(',');
  var dec = comma < 0 ? 0 : sample.length - comma - 1;
  var s = fmt(v, dec);
  if (sample.charAt(0) === '+' && v >= 0 && s.charAt(0) !== '+') s = '+' + s;
  return s;
}
function assignTweenKeys(root) {
  Array.prototype.forEach.call(root.querySelectorAll('table.data'), function (t) {
    var tid = t.id || 'table';
    Array.prototype.forEach.call(t.querySelectorAll('thead tr, tbody tr'),
      function (tr, ri) {
        Array.prototype.forEach.call(tr.children, function (td, ci) {
          td.setAttribute('data-tween-key', 't|' + tid + '|' + ri + '|' + ci);
        });
      });
  });
  Array.prototype.forEach.call(root.querySelectorAll('svg'), function (s) {
    var counters = {};
    var sid = s.id || 'svg';
    Array.prototype.forEach.call(s.querySelectorAll('text'), function (tx) {
      var cls = tx.getAttribute('class') || '';
      var prev = tx.previousElementSibling, anchor = null;
      while (prev) {
        var pc = (prev.getAttribute && prev.getAttribute('class')) || '';
        if (pc.indexOf('series-label') >= 0 || pc.indexOf('point-label') >= 0) {
          anchor = pc + ':' + prev.textContent;
          break;
        }
        prev = prev.previousElementSibling;
      }
      var key;
      if (anchor) key = 's|' + sid + '|' + cls + '|' + anchor;
      else {
        counters[cls] = (counters[cls] || 0) + 1;
        key = 's|' + sid + '|' + cls + '|' + counters[cls];
      }
      if (!tx.hasAttribute('data-tween-key')) tx.setAttribute('data-tween-key', key);
    });
  });
}
function captureTween(root) {
  if (REDUCE_MOTION) return;
  assignTweenKeys(root);
  Array.prototype.forEach.call(root.querySelectorAll('[data-tween-key]'),
    function (n) {
      var p = tokenParts(n.textContent);
      if (p.length) {
        tweenPrev[n.getAttribute('data-tween-key')] =
          p.map(function (x) { return x.value; });
      }
    });
}
function applyTween(root) {
  assignTweenKeys(root);
  if (REDUCE_MOTION) return;
  Array.prototype.forEach.call(root.querySelectorAll('[data-tween-key]'),
    function (n) {
      var key = n.getAttribute('data-tween-key');
      var from = tweenPrev[key];
      if (!from) return;
      var parts = tokenParts(n.textContent);
      if (!parts.length || parts.length !== from.length) return;
      var finalText = n.textContent;
      var to = parts.map(function (x) { return x.value; });
      if (from.every(function (v, i) { return Math.abs(v - to[i]) < 1e-9; })) {
        return;
      }
      if (tweenRuns[key]) cancelAnimationFrame(tweenRuns[key]);
      var start = null;
      function frame(ts) {
        if (start === null) start = ts;
        var k = Math.min(1, (ts - start) / TWEEN_MS);
        var e = 1 - Math.pow(1 - k, 3);
        var out = finalText;
        for (var i = parts.length - 1; i >= 0; i--) {
          var p = parts[i];
          var s = formatToken(from[i] + (to[i] - from[i]) * e, p.text);
          out = out.slice(0, p.start) + s + out.slice(p.end);
        }
        n.textContent = out;
        if (k < 1) tweenRuns[key] = requestAnimationFrame(frame);
        else {
          n.textContent = finalText;
          delete tweenRuns[key];
          delete tweenPrev[key];
        }
      }
      tweenRuns[key] = requestAnimationFrame(frame);
    });
}

/* Movimento dos elementos SVG: mesmas chaves, atributos interpolados. */
var ANIM_ATTRS = ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'x1', 'x2', 'y1', 'y2'];
var animPrev = {}, animRuns = {};
function pathNums(d) {
  var re = /-?\d+(?:\.\d+)?/g, m, out = [];
  while ((m = re.exec(d)) !== null) out.push(Number(m[0]));
  return out;
}
function assignAnimKeys(root) {
  Array.prototype.forEach.call(root.querySelectorAll('svg'), function (s) {
    var sid = s.id || 'svg', counters = {};
    Array.prototype.forEach.call(s.querySelectorAll('rect, circle, path'),
      function (n) {
        if (n.hasAttribute('data-anim-key')) return;
        var tag = n.nodeName.toLowerCase();
        counters[tag] = (counters[tag] || 0) + 1;
        n.setAttribute('data-anim-key', sid + '|' + tag + '|' + counters[tag]);
      });
  });
}
function captureAttrs(root) {
  if (REDUCE_MOTION) return;
  assignAnimKeys(root);
  Array.prototype.forEach.call(root.querySelectorAll('[data-anim-key]'),
    function (n) {
      var vals = {};
      ANIM_ATTRS.forEach(function (a) {
        var v = n.getAttribute(a);
        if (v !== null && isFinite(Number(v))) vals[a] = Number(v);
      });
      var d = n.getAttribute('d');
      if (d !== null) vals.d = pathNums(d);
      if (Object.keys(vals).length) {
        animPrev[n.getAttribute('data-anim-key')] = vals;
      }
    });
}
function applyAttrs(root) {
  if (REDUCE_MOTION) return;
  assignAnimKeys(root);
  Array.prototype.forEach.call(root.querySelectorAll('[data-anim-key]'),
    function (n) {
      var key = n.getAttribute('data-anim-key'), from = animPrev[key];
      if (!from) return;
      var to = {};
      ANIM_ATTRS.forEach(function (a) {
        var v = n.getAttribute(a);
        if (v !== null && isFinite(Number(v))) to[a] = Number(v);
      });
      var finalD = n.getAttribute('d');
      if (finalD !== null) to.d = pathNums(finalD);
      var attrs = Object.keys(from).filter(function (a) {
        if (a === 'd') return to.d && to.d.length === from.d.length;
        return a in to;
      });
      var changed = attrs.filter(function (a) {
        if (a === 'd') return from.d.some(function (v, i) {
          return Math.abs(v - to.d[i]) > .05;
        });
        return Math.abs(from[a] - to[a]) > .05;
      });
      if (!changed.length) return;
      if (animRuns[key]) cancelAnimationFrame(animRuns[key]);
      var start = null;
      function frame(ts) {
        if (start === null) start = ts;
        var k = Math.min(1, (ts - start) / TWEEN_MS);
        var e = 1 - Math.pow(1 - k, 3);
        changed.forEach(function (a) {
          if (a === 'd') {
            var i = 0;
            var out = finalD.replace(/-?\d+(?:\.\d+)?/g, function () {
              var v = from.d[i] + (to.d[i] - from.d[i]) * e;
              i++;
              return v.toFixed(1);
            });
            n.setAttribute('d', out);
          } else {
            n.setAttribute(a, from[a] + (to[a] - from[a]) * e);
          }
        });
        if (k < 1) animRuns[key] = requestAnimationFrame(frame);
        else {
          changed.forEach(function (a) {
            n.setAttribute(a, a === 'd' ? finalD : to[a]);
          });
          delete animRuns[key];
          delete animPrev[key];
        }
      }
      animRuns[key] = requestAnimationFrame(frame);
    });
}
function pct(v, ref) { return ref ? 100 * (v - ref) / ref : NaN; }
function mean(a) {
  return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : NaN;
}
function niceTicks(min, max, n) {
  n = n || 6;
  if (!isFinite(min) || !isFinite(max) || max <= min) return [min];
  var raw = (max - min) / n;
  var mag = Math.pow(10, Math.floor(Math.log10(raw)));
  var norm = raw / mag;
  var step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  var out = [];
  for (var v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    out.push(Number(v.toPrecision(12)));
  }
  return out;
}
function domain(vals, padFrac) {
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if (!isFinite(lo)) return [0, 1];
  if (lo === hi) { var d = Math.abs(lo) * 0.05 || 1; return [lo - d, hi + d]; }
  var pad = (hi - lo) * (padFrac === undefined ? 0.07 : padFrac);
  return [lo - pad, hi + pad];
}

var tip = document.getElementById('tooltip');
function showTip(html, ev) {
  tip.innerHTML = html;
  tip.style.display = 'block';
  moveTip(ev);
}
function moveTip(ev) {
  var x = ev.clientX + 14, y = ev.clientY + 14;
  var r = tip.getBoundingClientRect();
  if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - 14;
  tip.style.left = Math.max(4, x) + 'px';
  tip.style.top = Math.max(4, y) + 'px';
}
function hideTip() { tip.style.display = 'none'; }
function bindTip(node, html) {
  node.addEventListener('mouseenter', function (e) { showTip(html, e); });
  node.addEventListener('mousemove', moveTip);
  node.addEventListener('mouseleave', hideTip);
}

/* ------------------------- agregações ----------------------------- */
var PX_FIELD = {
  y: 'pixels_global', occupied_y: 'pixels_occupied', empty_y: 'pixels_empty'
};
function pxOf(c, region) {
  return D.pixel_weights[c.seq + '|' + c.mode + '|' + c.fill_method][PX_FIELD[region]];
}
function aggPSNR(rows, region) {
  if (!rows.length) return NaN;
  var n = 0, sse = 0;
  rows.forEach(function (c) {
    var px = pxOf(c, region);
    n += px;
    sse += 65025 * px / Math.pow(10, c.psnr_db[region] / 10);
  });
  return 10 * Math.log10(65025 * n / sse);
}
function xOf(c) { return state.xmetric === 'bytes' ? c.bytes : c.bitrate_mbps_25fps; }
function meanX(rows) { return mean(rows.map(xOf)); }

function aggregate(cfg, grp, seqs, rates, compare, fills) {
  var ref = (compare === 'vs_same_depth' && cfg.slice(-4) === 'qp25') ?
    'd' + cfg[1] : 'base';
  fills = fills || activeFills();
  var rows = [], brows = [];
  seqs.forEach(function (seq) {
    rates.forEach(function (rate) {
      fills.forEach(function (fill) {
        var c = getCell(grp.speed, grp.mode, grp.plane, seq, rate, cfg, fill);
        var b = getCell(grp.speed, grp.mode, grp.plane, seq, rate, ref, fill);
        if (c && b) { rows.push(c); brows.push(b); }
      });
    });
  });
  if (!rows.length) return null;
  var dbBits = rows.map(function (c, i) { return pct(c.bytes, brows[i].bytes); });
  var dbUser = rows.map(function (c, i) {
    return pct(c.time_s.user.median, brows[i].time_s.user.median);
  });
  var dbWall = rows.map(function (c, i) {
    return pct(c.time_s.wall.median, brows[i].time_s.wall.median);
  });
  return {
    cfg: cfg, ref: ref, n: rows.length,
    bytesMean: mean(rows.map(function (c) { return c.bytes; })),
    bitrateMean: mean(rows.map(function (c) { return c.bitrate_mbps_25fps; })),
    pctBytes: mean(dbBits), pctUser: mean(dbUser), pctWall: mean(dbWall),
    dbY: aggPSNR(rows, 'y') - aggPSNR(brows, 'y'),
    dbOcc: aggPSNR(rows, 'occupied_y') - aggPSNR(brows, 'occupied_y'),
    dbEmpty: aggPSNR(rows, 'empty_y') - aggPSNR(brows, 'empty_y'),
    absY: aggPSNR(rows, 'y'), absOcc: aggPSNR(rows, 'occupied_y'),
    userMedian: mean(rows.map(function (c) { return c.time_s.user.median; })),
    wallMedian: mean(rows.map(function (c) { return c.time_s.wall.median; }))
  };
}
function activeSeqs() { return Object.keys(state.seqs); }
function activeRates() { return RATES.filter(function (r) { return state.rates[r]; }); }
function activeCfgs() { return CFGS.filter(function (c) { return state.cfgs[c]; }); }
function activeFills() {
  return FILL_METHODS.filter(function (f) { return state.fills[f]; });
}
function currentGroup() {
  return {speed: state.speed, mode: state.mode, plane: state.plane};
}

/* --------------------------- controles ---------------------------- */
function makeSeg(id, items, field, labelFn) {
  var box = document.getElementById(id);
  clear(box);
  items.forEach(function (item) {
    var b = document.createElement('button');
    b.textContent = labelFn ? labelFn(item) : item;
    b.setAttribute('data-value', item);
    b.setAttribute('data-field', field);
    b.className = state[field] === item ? 'on' : '';
    b.addEventListener('click', function () {
      state[field] = item;
      syncSeg(id);
      render();
    });
    box.appendChild(b);
  });
}
function syncSeg(id) {
  var f = document.getElementById(id).firstChild.dataset.field;
  Array.prototype.forEach.call(document.getElementById(id).children, function (b) {
    b.classList.toggle('on', state[f] === b.dataset.value);
  });
}
function makeChips(id, items, field, colored) {
  var box = document.getElementById(id);
  clear(box);
  items.forEach(function (v) {
    var b = document.createElement('button');
    b.className = 'chip';
    b.textContent = v;
    b.setAttribute('data-value', v);
    b.addEventListener('click', function () {
      if (state[field][v]) delete state[field][v]; else state[field][v] = true;
      syncChips(id, field, colored);
      fillRepSelects();
      render();
    });
    box.appendChild(b);
  });
  syncChips(id, field, colored);
}
function syncChips(id, field, colored) {
  Array.prototype.forEach.call(document.getElementById(id).children, function (b) {
    var on = !!state[field][b.dataset.value];
    b.classList.toggle('on', on);
    b.style.background = on && colored ? COLORS[b.dataset.value] : '';
  });
  document.getElementById(id.replace('-chips', '-count')).textContent =
    '(' + Object.keys(state[field]).length + '/' +
    document.getElementById(id).children.length + ')';
}
function setAll(id, field, values, colored) {
  values.forEach(function (v) { state[field][v] = true; });
  syncChips(id, field, colored);
  fillRepSelects();
  render();
}
function setOnly(id, field, values, colored) {
  Object.keys(state[field]).forEach(function (v) { delete state[field][v]; });
  values.forEach(function (v) { state[field][v] = true; });
  syncChips(id, field, colored);
  fillRepSelects();
  render();
}
function setNone(id, field, colored) {
  Object.keys(state[field]).forEach(function (v) { delete state[field][v]; });
  syncChips(id, field, colored);
  fillRepSelects();
  render();
}
function fillSelect(sel, values, selected, labelFn) {
  clear(sel);
  values.forEach(function (v) {
    var o = document.createElement('option');
    o.value = v;
    o.textContent = labelFn ? labelFn(v) : v;
    sel.appendChild(o);
  });
  sel.value = selected;
}
function fillRepSelects() {
  var cfgs = activeCfgs().length ? activeCfgs() : CFGS;
  var seqs = activeSeqs().length ? activeSeqs() : SEQS;
  var rates = activeRates().length ? activeRates() : RATES;
  var fills = activeFills().length ? activeFills() : FILL_METHODS;
  if (cfgs.indexOf(state.repCfg) < 0) state.repCfg = cfgs[0];
  if (seqs.indexOf(state.repSeq) < 0) state.repSeq = seqs[0];
  if (rates.indexOf(state.repRate) < 0) state.repRate = rates[0];
  if (fills.indexOf(state.repFill) < 0) state.repFill = fills[0];
  fillSelect(document.getElementById('rep-cfg'), cfgs, state.repCfg, cfgLabel);
  fillSelect(document.getElementById('rep-seq'), seqs, state.repSeq);
  fillSelect(document.getElementById('rep-rate'), rates, state.repRate);
  fillSelect(document.getElementById('rep-fill'), fills, state.repFill,
    fillLabel);
}
function switchTab(tab) {
  state.tab = tab;
  if (location.hash !== '#' + tab) {
    history.replaceState(null, '', '#' + tab);
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) {
    p.classList.toggle('active', p.id === 'panel-' + tab);
  });
  hideTip();
  render();
}
function initControls() {
  makeSeg('seg-speed', SPEEDS, 'speed');
  makeSeg('seg-mode', MODES, 'mode', function (m) { return m.toUpperCase(); });
  makeSeg('seg-plane', PLANES, 'plane', function (p) {
    return p === 'geometry' ? 'geometry' : 'attribute';
  });
  makeSeg('seg-region', ['y', 'occupied_y', 'empty_y'], 'region', function (r) {
    return REGION_NAME[r];
  });
  makeSeg('seg-xmetric', ['bitrate', 'bytes'], 'xmetric', function (x) {
    return x === 'bitrate' ? 'Mb/s' : 'bytes';
  });
  makeSeg('seg-time-ymode', ['absolute', 'delta'], 'timeYMode', function (y) {
    return y === 'absolute' ? 'tempo (s)' : 'Δ% vs base';
  });
  makeSeg('seg-time-field', ['user', 'wall'], 'timeField');
  makeChips('seq-chips', SEQS, 'seqs', false);
  makeChips('cfg-chips', CFGS, 'cfgs', true);
  makeChips('rate-chips', RATES, 'rates', false);

  makeChips('fill-chips', FILL_METHODS, 'fills', false);
  document.getElementById('fill-all').onclick = function () {
    setAll('fill-chips', 'fills', FILL_METHODS, false); };
  document.getElementById('fill-none').onclick = function () {
    setNone('fill-chips', 'fills', false); };

  document.getElementById('seq-all').onclick = function () {
    setAll('seq-chips', 'seqs', SEQS, false); };
  document.getElementById('seq-none').onclick = function () {
    setNone('seq-chips', 'seqs', false); };
  document.getElementById('cfg-all').onclick = function () {
    setAll('cfg-chips', 'cfgs', CFGS, true); };
  document.getElementById('cfg-base-depth').onclick = function () {
    setOnly('cfg-chips', 'cfgs', ['base', 'd0', 'd1', 'd2', 'd3'], true); };
  document.getElementById('cfg-base-qp').onclick = function () {
    setOnly('cfg-chips', 'cfgs', ['base', 'd0qp25', 'd1qp25', 'd2qp25',
                                  'd3qp25'], true); };
  document.getElementById('cfg-base-skip').onclick = function () {
    setOnly('cfg-chips', 'cfgs', ['base', 'skip'], true); };
  document.getElementById('rate-all').onclick = function () {
    setAll('rate-chips', 'rates', RATES, false); };
  document.getElementById('rate-none').onclick = function () {
    setNone('rate-chips', 'rates', false); };
  document.getElementById('reset-all').onclick = function () {
    state.speed = 'slow'; state.mode = 'ra'; state.plane = 'geometry';
    state.region = 'occupied_y'; state.xmetric = 'bitrate';
    state.timeSeq = 'avg'; state.timeYMode = 'absolute'; state.timeField = 'user';
    state.hidden = {}; state.heatMetric = 'bits'; state.aggCompare = 'vs_base';
    state.fills = cloneSet(FILL_METHODS); state.repFill = FILL_METHODS[0];
    state.paretoFill = FILL_METHODS[0];
    state.paretoThreshold = 0; state.paretoCI = true; state.paretoFullY = false;
    rebuildCells();
    state.cellSearch = ''; state.cellPage = 0;
    state.cellSort = {col: 'seq', dir: 1};
    ['seg-speed', 'seg-mode', 'seg-plane', 'seg-region', 'seg-xmetric',
     'seg-time-ymode', 'seg-time-field'].forEach(syncSeg);
    setAll('seq-chips', 'seqs', SEQS, false);
    setAll('cfg-chips', 'cfgs', CFGS, true);
    setAll('rate-chips', 'rates', RATES, false);
    setAll('fill-chips', 'fills', FILL_METHODS, false);
    document.getElementById('time-seq').value = 'avg';
    document.getElementById('heat-metric').value = 'bits';
    document.getElementById('agg-compare').value = 'vs_base';
    document.getElementById('cell-search').value = '';
    document.getElementById('pareto-threshold').value = '0';
    document.getElementById('pareto-ci').checked = true;
    document.getElementById('pareto-full-y').checked = false;
    render();
  };

  fillSelect(document.getElementById('time-seq'), ['avg'].concat(SEQS), 'avg',
    function (v) { return v === 'avg' ? 'média das selecionadas' : v; });
  document.getElementById('time-seq').onchange = function (e) {
    state.timeSeq = e.target.value; render(); };
  document.getElementById('rd-labels').onchange = function (e) {
    state.labels = e.target.checked; render(); };

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.onclick = function () { switchTab(b.dataset.tab); };
  });
  Array.prototype.forEach.call(document.querySelectorAll('.subtab'), function (b) {
    b.onclick = function () {
      state.sub = b.dataset.sub;
      Array.prototype.forEach.call(document.querySelectorAll('.subtab'), function (x) {
        x.classList.toggle('active', x === b);
      });
      document.getElementById('sub-agg').hidden = state.sub !== 'agg';
      document.getElementById('sub-cells').hidden = state.sub !== 'cells';
      render();
    };
  });
  document.getElementById('heat-metric').onchange = function (e) {
    state.heatMetric = e.target.value; render(); };
  document.getElementById('agg-compare').onchange = function (e) {
    state.aggCompare = e.target.value; render(); };

  document.getElementById('cell-search').oninput = function (e) {
    state.cellSearch = e.target.value.toLowerCase(); state.cellPage = 0; render(); };
  document.getElementById('cell-page-size').onchange = function () {
    state.cellPage = 0; render(); };
  document.getElementById('cells-prev').onclick = function () {
    state.cellPage = Math.max(0, state.cellPage - 1); render(); };
  document.getElementById('cells-next').onclick = function () {
    state.cellPage += 1; render(); };
  document.getElementById('cells-export').onclick = exportCellsCSV;
  document.getElementById('agg-export').onclick = exportAggCSV;

  document.getElementById('rep-cfg').onchange = function (e) {
    state.repCfg = e.target.value; render(); };
  document.getElementById('rep-seq').onchange = function (e) {
    state.repSeq = e.target.value; render(); };
  document.getElementById('rep-rate').onchange = function (e) {
    state.repRate = e.target.value; render(); };
  document.getElementById('rep-fill').onchange = function (e) {
    state.repFill = e.target.value; render(); };
  document.getElementById('rep-field').onchange = function (e) {
    state.repField = e.target.value; render(); };

  fillSelect(document.getElementById('pareto-fill'), FILL_METHODS,
    state.paretoFill, fillLabel);
  document.getElementById('pareto-fill').onchange = function (e) {
    state.paretoFill = e.target.value; render(); };
  document.getElementById('pareto-threshold').onchange = function (e) {
    state.paretoThreshold = Number(e.target.value); render(); };
  document.getElementById('pareto-ci').onchange = function (e) {
    state.paretoCI = e.target.checked; render(); };
  document.getElementById('pareto-full-y').onchange = function (e) {
    state.paretoFullY = e.target.checked; render(); };
  document.getElementById('pareto-open-rd').onclick = function () {
    var fill = paretoFillNow();
    state.fills = {}; state.fills[fill] = true;
    syncChips('fill-chips', 'fills', false);
    syncSeg('seg-region');
    switchTab('rd');
  };

  fillRepSelects();
}

/* ------------------------------ RD -------------------------------- */
function rdSeries() {
  var out = [];
  var list = activeCfgs().slice();
  if (list.indexOf('base') < 0) list.unshift('base');
  list.forEach(function (cfg) {
    activeFills().forEach(function (fill) {
      if (state.hidden[cfg + '|*'] || state.hidden['*|' + fill]) return;
      var pts = [];
      activeRates().forEach(function (rate) {
        var rows = CELLS.filter(function (c) {
          return c.config === cfg && c.speed === state.speed &&
            c.mode === state.mode && c.plane === state.plane && c.rate === rate &&
            c.fill_method === fill && state.seqs[c.seq];
        });
        if (rows.length) {
          pts.push({
            rate: rate, x: meanX(rows), y: aggPSNR(rows, state.region),
            rows: rows
          });
        }
      });
      if (pts.length) {
        out.push({cfg: cfg, fill: fill, key: cfg + '|' + fill, pts: pts});
      }
    });
  });
  return out;
}
function rdAggPoint(cfg, rate) {
  var rows = CELLS.filter(function (c) {
    return c.config === cfg && c.speed === state.speed &&
      c.mode === state.mode && c.plane === state.plane && c.rate === rate &&
      state.seqs[c.seq] && state.fills[c.fill_method];
  });
  return rows.length ? {x: meanX(rows), y: aggPSNR(rows, state.region)} : null;
}
function rdBasePoint(fill, rate) {
  var rows = CELLS.filter(function (c) {
    return c.config === 'base' && c.speed === state.speed &&
      c.mode === state.mode && c.plane === state.plane && c.rate === rate &&
      c.fill_method === fill && state.seqs[c.seq];
  });
  return rows.length ? {x: meanX(rows), y: aggPSNR(rows, state.region)} : null;
}
function rdTooltip(cfg, fill, p) {
  var b = cfg === 'base' ? null : rdBasePoint(fill, p.rate);
  var scope = activeSeqs().length + ' seq · ' + fillLabel(fill);
  var s = '<div class="tt-title">' + esc(cfgLabel(cfg)) + '</div>';
  s += 'taxa ' + p.rate.toUpperCase() + ' · ' + scope + '<br>';
  s += 'X: <b>' + fmt(p.x, 3) + '</b> ' +
       (state.xmetric === 'bytes' ? 'bytes' : 'Mb/s') + '<br>';
  s += REGION_NAME[state.region] + ': <b>' + fmt(p.y, 3) + '</b> dB<br>';
  if (b) {
    s += 'Δbits: <b>' + fmt(pct(p.x, b.x), 2) + '%</b> · ' +
         'ΔPSNR: <b>' + fmt(p.y - b.y, 3) + '</b> dB<br>';
  }
  s += 'média ' + fmt(mean(p.rows.map(function (c) {
    return c.time_s.user.median; })), 2) + ' s user';
  return s;
}
function renderSeriesLegend(id) {
  var legend = document.getElementById(id);
  clear(legend);
  var cfgs = activeCfgs().slice();
  if (cfgs.indexOf('base') < 0) cfgs.unshift('base');
  cfgs.forEach(function (cfg) {
    var b = document.createElement('button');
    if (state.hidden[cfg + '|*']) b.className = 'off';
    b.title = cfgLabel(cfg);
    var sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = COLORS[cfg];
    b.appendChild(sw);
    b.appendChild(document.createTextNode(' ' + cfg));
    b.onclick = function () {
      var k = cfg + '|*';
      if (state.hidden[k]) delete state.hidden[k]; else state.hidden[k] = true;
      render();
    };
    legend.appendChild(b);
  });
  activeFills().forEach(function (fill) {
    var b = document.createElement('button');
    if (state.hidden['*|' + fill]) b.className = 'off';
    b.title = fill;
    var svg = el('svg', {width: 16, height: 14, viewBox: '-8 -8 16 16',
      'class': 'shape'}, b);
    markerNode(markerFor(fill), 0, 0, 6, '#111827', null, svg);
    b.appendChild(document.createTextNode(' ' + fillLabel(fill)));
    b.onclick = function () {
      var k = '*|' + fill;
      if (state.hidden[k]) delete state.hidden[k]; else state.hidden[k] = true;
      render();
    };
    legend.appendChild(b);
  });
}
function renderRD() {
  var series = rdSeries();
  var cfgList = activeCfgs().slice();
  if (cfgList.indexOf('base') < 0) cfgList.unshift('base');
  var svg = document.getElementById('rd-svg');
  clear(svg);
  var W = 980, H = 560, m = {l: 74, r: 26, t: 24, b: 62};
  var xs = [], ys = [];
  series.forEach(function (s) {
    s.pts.forEach(function (p) { xs.push(p.x); ys.push(p.y); });
  });
  if (!xs.length) {
    svgText(svg, W / 2, H / 2, 'Sem dados para os filtros atuais.', 'axis-label', 'middle');
    document.getElementById('rd-hint').textContent = 'Ajuste os filtros.';
    clear(document.getElementById('rd-legend'));
    clear(document.getElementById('rd-points-table'));
    clear(document.getElementById('rd-delta-table'));
    return;
  }
  var dx = domain(xs), dy = domain(ys, 0.12);
  var sx = function (v) { return m.l + (v - dx[0]) / (dx[1] - dx[0]) * (W - m.l - m.r); };
  var sy = function (v) { return H - m.b - (v - dy[0]) / (dy[1] - dy[0]) * (H - m.t - m.b); };
  niceTicks(dx[0], dx[1]).forEach(function (v) {
    if (v < dx[0] || v > dx[1]) return;
    var x = sx(v);
    el('line', {x1: x, x2: x, y1: m.t, y2: H - m.b, 'class': 'grid'}, svg);
    svgText(svg, x, H - m.b + 16, fmt(v, v < 10 ? 2 : 0), 'tick-text', 'middle');
  });
  niceTicks(dy[0], dy[1]).forEach(function (v) {
    if (v < dy[0] || v > dy[1]) return;
    var y = sy(v);
    el('line', {x1: m.l, x2: W - m.r, y1: y, y2: y, 'class': 'grid'}, svg);
    svgText(svg, m.l - 8, y + 3, fmt(v, 1), 'tick-text', 'end');
  });
  el('line', {x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, 'class': 'axis'}, svg);
  el('line', {x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, 'class': 'axis'}, svg);
  svgText(svg, (m.l + W - m.r) / 2, H - 18,
    state.xmetric === 'bytes' ? 'Bytes por encode (média)' :
      'Bitrate (Mb/s, 25 fps, média)', 'axis-label', 'middle');
  var yl = svgText(svg, 17, (m.t + H - m.b) / 2,
    REGION_NAME[state.region] + ' (dB)', 'axis-label', 'middle');
  yl.setAttribute('transform', 'rotate(-90 17 ' + ((m.t + H - m.b) / 2) + ')');

  series.forEach(function (s) {
    var path = s.pts.map(function (p, i) {
      return (i ? 'L' : 'M') + sx(p.x).toFixed(1) + ',' + sy(p.y).toFixed(1);
    }).join(' ');
    el('path', {
      d: path, fill: 'none', stroke: COLORS[s.cfg],
      'stroke-width': s.cfg === 'base' ? 2.8 : 2.1,
      'stroke-dasharray': s.cfg === 'base' ? '7 4' : '',
      'stroke-linejoin': 'round',
      'data-anim-key': 'rd|curve|' + s.key
    }, svg);
    s.pts.forEach(function (p) {
      var cx = sx(p.x), cy = sy(p.y);
      var dot = markerNode(markerFor(s.fill), cx, cy,
        s.cfg === 'base' ? 5 : 4.2, COLORS[s.cfg],
        'rd|point|' + s.key + '|' + p.rate, svg);
      dot.style.cursor = 'pointer';
      bindTip(dot, rdTooltip(s.cfg, s.fill, p));
      if (state.labels && s.fill === activeFills()[0]) {
        svgText(svg, cx + 7, cy - 7, p.rate.toUpperCase(), 'point-label');
      }
    });
  });

  renderSeriesLegend('rd-legend');

  var scope = 'média de ' + activeSeqs().length + ' seq';
  document.getElementById('rd-hint').textContent =
    state.speed.toUpperCase() + ' · ' + state.mode.toUpperCase() + ' · ' +
    state.plane + ' · ' + scope + ' · ' + REGION_NAME[state.region] +
    ' · ' + activeFills().length + '/' + FILL_METHODS.length +
    ' preenchimentos (forma = método)';

  var t1 = document.getElementById('rd-points-table');
  clear(t1);
  var h1 = document.createElement('thead');
  var b1 = document.createElement('tbody');
  var head = document.createElement('tr');
  head.innerHTML = '<th>taxa</th>' + cfgList.map(function (c) {
    return '<th>' + esc(c) + '</th>'; }).join('');
  h1.appendChild(head); t1.appendChild(h1); t1.appendChild(b1);
  RATES.forEach(function (rate) {
    if (!state.rates[rate]) return;
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + rate.toUpperCase() + '</td>' +
      cfgList.map(function (cfg) {
        var p = rdAggPoint(cfg, rate);
        return '<td class="num">' +
          (p ? fmt(p.x, 2) + ' / ' + fmt(p.y, 2) : '—') + '</td>';
      }).join('');
    b1.appendChild(tr);
  });

  var t2 = document.getElementById('rd-delta-table');
  clear(t2);
  var other = cfgList.filter(function (c) { return c !== 'base'; });
  var h2 = document.createElement('thead');
  var b2 = document.createElement('tbody');
  var row2 = document.createElement('tr');
  row2.innerHTML = '<th>taxa</th>' + other.map(function (c) {
    return '<th>' + esc(c) + '</th>'; }).join('');
  h2.appendChild(row2); t2.appendChild(h2); t2.appendChild(b2);
  RATES.forEach(function (rate) {
    if (!state.rates[rate]) return;
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + rate.toUpperCase() + '</td>' + other.map(function (cfg) {
      var p = rdAggPoint(cfg, rate);
      var b = rdAggPoint('base', rate);
      if (!p || !b) return '<td class="num">—</td>';
      var d = pct(p.x, b.x), dy = p.y - b.y;
      return '<td class="num ' + (d > 0 ? 'bad' : 'good') + '">' +
        fmt(d, 1) + '% / ' + fmt(dy, 2) + ' dB</td>';
    }).join('');
    b2.appendChild(tr);
  });
}

/* --------------------------- overview ----------------------------- */
function colorCell(v, isPsnr, maxAbs) {
  if (!isFinite(v)) return '';
  var score = isPsnr ? v : -v;
  var a = Math.min(0.72, Math.abs(score) / (maxAbs || 1) * 0.72);
  return 'background:rgba(' + (score >= 0 ? '15,157,88' : '214,69,69') + ',' +
    a.toFixed(3) + ')';
}
function renderOverview() {
  var seqs = activeSeqs(), rates = activeRates(), cfgs = activeCfgs();
  var head = ['base'].concat(cfgs.filter(function (c) { return c !== 'base'; }));
  var metric = METRIC_COLS[state.heatMetric];
  var cache = {};
  var maxAbs = 0;
  head.forEach(function (cfg) {
    GROUPS.forEach(function (g, gi) {
      var a = aggregate(cfg, g, seqs, rates, 'vs_base');
      var v = a ? a[metric.key] : NaN;
      cache[cfg + '|' + gi] = v;
      if (isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
    });
  });
  var table = document.getElementById('heat-table');
  clear(table);
  var thead = document.createElement('thead');
  var tbody = document.createElement('tbody');
  var tr = document.createElement('tr');
  tr.innerHTML = '<th>config</th>' + GROUPS.map(function (g, i) {
    return '<th data-g="' + i + '" title="' + esc(g.speed + '/' + g.mode + '/' + g.plane) +
      '">' + g.short + '</th>'; }).join('');
  thead.appendChild(tr);
  table.appendChild(thead);
  table.appendChild(tbody);
  Array.prototype.forEach.call(tr.querySelectorAll('th[data-g]'), function (th) {
    th.onclick = function () {
      var g = GROUPS[Number(th.dataset.g)];
      state.speed = g.speed; state.mode = g.mode; state.plane = g.plane;
      ['seg-speed', 'seg-mode', 'seg-plane'].forEach(syncSeg);
      switchTab('rd');
    };
  });
  head.forEach(function (cfg) {
    var row = document.createElement('tr');
    row.innerHTML = '<td' + (cfg === 'base' ? ' class="base-row"' : '') + '>' +
      esc(cfg) + '</td>' + GROUPS.map(function (g, i) {
        var v = cache[cfg + '|' + i];
        return '<td class="num" style="' + colorCell(v, metric.psnr, maxAbs) +
          '" title="' + esc(cfgLabel(cfg)) + '">' +
          (isFinite(v) ? fmt(v, metric.psnr ? 2 : 1) : '—') + '</td>';
      }).join('');
    tbody.appendChild(row);
  });

  // Mapa de compensações: Δbits × ΔPSNR(occ); Δtempo vai no rótulo.
  var svg = document.getElementById('scatter-svg');
  clear(svg);
  var W = 980, H = 480, m = {l: 78, r: 34, t: 20, b: 56};
  var pts = [];
  cfgs.forEach(function (cfg) {
    if (cfg === 'base') return;
    var a = aggregate(cfg, currentGroup(), seqs, rates, 'vs_base');
    if (a) pts.push({cfg: cfg, x: a.pctBytes, y: a.dbOcc, t: a.pctUser, a: a});
  });
  if (!pts.length) {
    svgText(svg, W / 2, H / 2, 'Sem dados para os filtros atuais.', 'axis-label', 'middle');
  } else {
    var dx = domain(pts.map(function (p) { return p.x; }).concat([0]));
    var dy = domain(pts.map(function (p) { return p.y; }).concat([0]), 0.15);
    var sx = function (v) { return m.l + (v - dx[0]) / (dx[1] - dx[0]) * (W - m.l - m.r); };
    var sy = function (v) { return H - m.b - (v - dy[0]) / (dy[1] - dy[0]) * (H - m.t - m.b); };
    niceTicks(dx[0], dx[1]).forEach(function (v) {
      var x = sx(v);
      el('line', {x1: x, x2: x, y1: m.t, y2: H - m.b, 'class': 'grid'}, svg);
      svgText(svg, x, H - m.b + 16, fmt(v, 1), 'tick-text', 'middle');
    });
    niceTicks(dy[0], dy[1]).forEach(function (v) {
      var y = sy(v);
      el('line', {x1: m.l, x2: W - m.r, y1: y, y2: y, 'class': 'grid'}, svg);
      svgText(svg, m.l - 8, y + 3, fmt(v, 1), 'tick-text', 'end');
    });
    el('line', {x1: sx(0), x2: sx(0), y1: m.t, y2: H - m.b, 'class': 'zero'}, svg);
    el('line', {x1: m.l, x2: W - m.r, y1: sy(0), y2: sy(0), 'class': 'zero'}, svg);
    svgText(svg, (m.l + W - m.r) / 2, H - 16, 'Δ bits (%)', 'axis-label', 'middle');
    svgText(svg, 16, (m.t + H - m.b) / 2, 'Δ PSNR ocupado (dB)', 'axis-label', 'middle')
      .setAttribute('transform', 'rotate(-90 16 ' + ((m.t + H - m.b) / 2) + ')');
    var placed = [];
    pts.forEach(function (p) {
      var r = 8;
      var c = el('circle', {cx: sx(p.x), cy: sy(p.y), r: r,
        fill: COLORS[p.cfg], 'fill-opacity': .9, stroke: '#fff',
        'stroke-width': 1.5,
        'data-anim-key': 'scatter|' + p.cfg}, svg);
      c.style.cursor = 'pointer';
      bindTip(c, '<div class="tt-title">' + esc(cfgLabel(p.cfg)) + '</div>' +
        'Δbits: <b>' + fmt(p.x, 2) + '%</b><br>' +
        'ΔPSNR occ: <b>' + fmt(p.y, 3) + ' dB</b><br>' +
        'ΔPSNR Y: ' + fmt(p.a.dbY, 3) + ' dB<br>' +
        'ΔPSNR vazio: ' + fmt(p.a.dbEmpty, 3) + ' dB<br>' +
        'Δuser: <b>' + fmt(p.t, 2) + '%</b> · Δwall: ' +
        fmt(p.a.pctWall, 2) + '%');
      // Evita que rótulos de pontos próximos se sobreponham.
      var lx = sx(p.x) + r + 5, ly = sy(p.y) - 2;
      for (var k = 0; k < 5; k++) {
        var clash = placed.some(function (q) {
          return Math.abs(q.x - lx) < 74 && Math.abs(q.y - ly) < 17;
        });
        if (!clash) break;
        ly += 17;
      }
      placed.push({x: lx, y: ly});
      svgText(svg, lx, ly, p.cfg, 'series-label');
      svgText(svg, lx, ly + 11, fmt(p.t, 1) + '% user', 'tick-text');
    });
  }

  var notes = document.getElementById('overview-notes');
  clear(notes);
  var rows = cfgs.filter(function (c) { return c !== 'base'; }).map(function (c) {
    return aggregate(c, currentGroup(), seqs, rates, 'vs_base');
  }).filter(Boolean);
  if (!rows.length) { notes.textContent = 'Sem dados para os filtros atuais.'; }
  else {
    var fastest = rows.slice().sort(function (a, b) { return a.pctUser - b.pctUser; })[0];
    var cheapest = rows.slice().sort(function (a, b) { return a.pctBytes - b.pctBytes; })[0];
    var safest = rows.slice().sort(function (a, b) { return b.dbOcc - a.dbOcc; })[0];
    var emptiest = rows.slice().sort(function (a, b) {
      return b.dbEmpty - a.dbEmpty; })[0];
    [
      ['Menor tempo', fastest.cfg, fmt(fastest.pctUser, 1) + '% user'],
      ['Menos bits', cheapest.cfg, fmt(cheapest.pctBytes, 1) + '% bits'],
      ['Melhor PSNR ocupado', safest.cfg, fmt(safest.dbOcc, 3) + ' dB'],
      ['Melhor PSNR vazio', emptiest.cfg, fmt(emptiest.dbEmpty, 3) + ' dB']
    ].forEach(function (n) {
      var d = document.createElement('div');
      d.innerHTML = n[0] + ': <b>' + esc(n[1]) + '</b> — ' + esc(n[2]) +
        ' <span style="color:#667085">(' + esc(cfgLabel(n[1])) + ')</span>';
      notes.appendChild(d);
    });
  }
}

/* --------------------------- tabelas ------------------------------ */
function sortRows(rows, sort, getters) {
  if (!sort) return rows;
  return rows.slice().sort(function (a, b) {
    var va = getters[sort.col](a), vb = getters[sort.col](b);
    if (typeof va === 'string') return sort.dir * va.localeCompare(vb);
    if (!isFinite(va)) return 1;
    if (!isFinite(vb)) return -1;
    return sort.dir * (va - vb);
  });
}
function makeSortable(table, cols, getters, sort, onSort) {
  var head = document.createElement('thead');
  var tr = document.createElement('tr');
  cols.forEach(function (c) {
    var th = document.createElement('th');
    th.textContent = c.label;
    th.onclick = function () {
      onSort({col: c.key, dir: sort && sort.col === c.key ? -sort.dir : 1});
    };
    tr.appendChild(th);
  });
  head.appendChild(tr);
  table.appendChild(head);
  var body = document.createElement('tbody');
  table.appendChild(body);
  return body;
}
function deltaClass(v, goodPositive) {
  if (!isFinite(v) || Math.abs(v) < 1e-9) return '';
  return ((v > 0) === goodPositive) ? 'good' : 'bad';
}
function aggRows() {
  var grp = currentGroup();
  return activeCfgs().map(function (cfg) {
    return aggregate(cfg, grp, activeSeqs(), activeRates(), state.aggCompare);
  }).filter(Boolean);
}
function renderAggTable() {
  var table = document.getElementById('agg-table');
  clear(table);
  var cols = [
    {key: 'cfg', label: 'config'}, {key: 'ref', label: 'ref'},
    {key: 'n', label: 'n'}, {key: 'bytesMean', label: 'bytes médios'},
    {key: 'bitrateMean', label: 'Mb/s'}, {key: 'pctBytes', label: 'Δbits %'},
    {key: 'dbY', label: 'ΔPSNR Y dB'}, {key: 'dbOcc', label: 'ΔPSNR occ dB'},
    {key: 'dbEmpty', label: 'ΔPSNR vazio dB'},
    {key: 'pctUser', label: 'Δuser %'}, {key: 'pctWall', label: 'Δwall %'}
  ];
  var getters = {
    cfg: function (a) { return a.cfg; }, ref: function (a) { return a.ref; },
    n: function (a) { return a.n; }, bytesMean: function (a) { return a.bytesMean; },
    bitrateMean: function (a) { return a.bitrateMean; },
    pctBytes: function (a) { return a.pctBytes; }, dbY: function (a) { return a.dbY; },
    dbOcc: function (a) { return a.dbOcc; }, dbEmpty: function (a) { return a.dbEmpty; },
    pctUser: function (a) { return a.pctUser; }, pctWall: function (a) { return a.pctWall; }
  };
  var body = makeSortable(table, cols, getters, state.aggSort, function (s) {
    state.aggSort = s; render();
  });
  sortRows(aggRows(), state.aggSort, getters).forEach(function (a) {
    var tr = document.createElement('tr');
    tr.innerHTML = [
      '<td' + (a.cfg === 'base' ? ' class="base-row"' : '') + '>' + esc(a.cfg) + '</td>',
      '<td>' + esc(a.ref) + '</td>',
      '<td class="num">' + a.n + '</td>',
      '<td class="num">' + fmt(a.bytesMean, 0) + '</td>',
      '<td class="num">' + fmt(a.bitrateMean, 3) + '</td>',
      '<td class="num ' + deltaClass(a.pctBytes, false) + '">' + fmt(a.pctBytes, 2) + '</td>',
      '<td class="num ' + deltaClass(a.dbY, true) + '">' + fmt(a.dbY, 3) + '</td>',
      '<td class="num ' + deltaClass(a.dbOcc, true) + '">' + fmt(a.dbOcc, 3) + '</td>',
      '<td class="num ' + deltaClass(a.dbEmpty, true) + '">' + fmt(a.dbEmpty, 3) + '</td>',
      '<td class="num ' + deltaClass(a.pctUser, false) + '">' + fmt(a.pctUser, 2) + '</td>',
      '<td class="num ' + deltaClass(a.pctWall, false) + '">' + fmt(a.pctWall, 2) + '</td>'
    ].join('');
    body.appendChild(tr);
  });
}
function aggregateCells(rows) {
  var a = rows[0];
  return {
    config: a.config, seq: a.seq, rate: a.rate,
    mode: a.mode, plane: a.plane, speed: a.speed,
    bytes: mean(rows.map(function (c) { return c.bytes; })),
    bitrate_mbps_25fps: mean(rows.map(function (c) {
      return c.bitrate_mbps_25fps; })),
    psnr_db: {
      y: aggPSNR(rows, 'y'), occupied_y: aggPSNR(rows, 'occupied_y'),
      empty_y: aggPSNR(rows, 'empty_y')
    },
    time_s: {
      user: {median: mean(rows.map(function (c) {
        return c.time_s.user.median; }))},
      wall: {median: mean(rows.map(function (c) {
        return c.time_s.wall.median; }))}
    }
  };
}
function filteredCells() {
  var q = state.cellSearch;
  var groups = {};
  CELLS.forEach(function (c) {
    if (!(c.speed === state.speed && c.mode === state.mode &&
          c.plane === state.plane && state.seqs[c.seq] && state.rates[c.rate] &&
          state.cfgs[c.config] && state.fills[c.fill_method])) return;
    if (q && (c.seq + ' ' + c.config + ' ' + c.rate)
        .toLowerCase().indexOf(q) < 0) return;
    var k = [c.config, c.seq, c.rate, c.speed, c.mode, c.plane].join('|');
    (groups[k] || (groups[k] = [])).push(c);
  });
  var out = Object.keys(groups).map(function (k) {
    return aggregateCells(groups[k]);
  });
  var bySeq = {};
  out.forEach(function (c) { bySeq[c.config + '|' + c.seq] = c; });
  out.forEach(function (c) {
    var b = bySeq['base|' + c.seq];
    c.deltas = {vs_base: {
      bytes: {percent: b ? pct(c.bytes, b.bytes) : NaN},
      psnr_occupied_y_db: b ?
        c.psnr_db.occupied_y - b.psnr_db.occupied_y : NaN,
      time_user_s: {percent: b ?
        pct(c.time_s.user.median, b.time_s.user.median) : NaN}
    }};
  });
  return out;
}
var CELL_COLS = [
  {key: 'config', label: 'config'}, {key: 'seq', label: 'seq'},
  {key: 'rate', label: 'taxa'}, {key: 'bytes', label: 'bytes'},
  {key: 'bitrate', label: 'Mb/s'}, {key: 'y', label: 'PSNR Y'},
  {key: 'occ', label: 'PSNR occ'}, {key: 'empty', label: 'PSNR vazio'},
  {key: 'user', label: 'med user s'}, {key: 'wall', label: 'med wall s'},
  {key: 'dbits', label: 'Δbits %'}, {key: 'docc', label: 'Δocc dB'},
  {key: 'duser', label: 'Δuser %'}
];
var CELL_GET = {
  config: function (c) { return c.config; }, seq: function (c) { return c.seq; },
  rate: function (c) { return c.rate; }, bytes: function (c) { return c.bytes; },
  bitrate: function (c) { return c.bitrate_mbps_25fps; },
  y: function (c) { return c.psnr_db.y; }, occ: function (c) { return c.psnr_db.occupied_y; },
  empty: function (c) { return c.psnr_db.empty_y; },
  user: function (c) { return c.time_s.user.median; },
  wall: function (c) { return c.time_s.wall.median; },
  dbits: function (c) { return c.deltas.vs_base.bytes.percent; },
  docc: function (c) { return c.deltas.vs_base.psnr_occupied_y_db; },
  duser: function (c) { return c.deltas.vs_base.time_user_s.percent; }
};
function renderCellsTable() {
  var table = document.getElementById('cells-table');
  clear(table);
  var body = makeSortable(table, CELL_COLS, CELL_GET, state.cellSort, function (s) {
    state.cellSort = s; state.cellPage = 0; render();
  });
  var rows = sortRows(filteredCells(), state.cellSort, CELL_GET);
  var size = Number(document.getElementById('cell-page-size').value);
  var pages = Math.max(1, Math.ceil(rows.length / size));
  state.cellPage = Math.min(state.cellPage, pages - 1);
  rows.slice(state.cellPage * size, (state.cellPage + 1) * size).forEach(function (c) {
    var d = c.deltas.vs_base;
    var tr = document.createElement('tr');
    tr.innerHTML = [
      '<td>' + esc(c.config) + '</td>', '<td>' + esc(c.seq) + '</td>',
      '<td>' + c.rate.toUpperCase() + '</td>',
      '<td class="num">' + fmt(c.bytes, 0) + '</td>',
      '<td class="num">' + fmt(c.bitrate_mbps_25fps, 3) + '</td>',
      '<td class="num">' + fmt(c.psnr_db.y, 3) + '</td>',
      '<td class="num">' + fmt(c.psnr_db.occupied_y, 3) + '</td>',
      '<td class="num">' + fmt(c.psnr_db.empty_y, 3) + '</td>',
      '<td class="num">' + fmt(c.time_s.user.median, 2) + '</td>',
      '<td class="num">' + fmt(c.time_s.wall.median, 2) + '</td>',
      '<td class="num ' + (c.config === 'base' ? '' : deltaClass(d.bytes.percent, false)) + '">' +
        (c.config === 'base' ? '—' : fmt(d.bytes.percent, 2)) + '</td>',
      '<td class="num ' + (c.config === 'base' ? '' : deltaClass(d.psnr_occupied_y_db, true)) + '">' +
        (c.config === 'base' ? '—' : fmt(d.psnr_occupied_y_db, 3)) + '</td>',
      '<td class="num ' + (c.config === 'base' ? '' : deltaClass(d.time_user_s.percent, false)) + '">' +
        (c.config === 'base' ? '—' : fmt(d.time_user_s.percent, 2)) + '</td>'
    ].join('');
    body.appendChild(tr);
  });
  document.getElementById('cells-page-info').textContent =
    rows.length + ' linhas · página ' + (state.cellPage + 1) + '/' + pages;
}
function downloadCSV(name, header, rows) {
  var q = function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
  var text = header.map(q).join(',') + '\n' +
    rows.map(function (r) { return r.map(q).join(','); }).join('\n') + '\n';
  var url = URL.createObjectURL(new Blob([text], {type: 'text/csv;charset=utf-8'}));
  var a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
function exportCellsCSV() {
  var rows = sortRows(filteredCells(), state.cellSort, CELL_GET).map(function (c) {
    var d = c.deltas.vs_base;
    return [c.config, c.seq, c.mode, c.plane, c.speed, c.rate,
      c.bytes, c.bitrate_mbps_25fps, c.psnr_db.y, c.psnr_db.occupied_y,
      c.psnr_db.empty_y, c.time_s.wall.median, c.time_s.user.median,
      d.bytes.percent, d.psnr_occupied_y_db, d.time_user_s.percent];
  });
  downloadCSV('celulas.csv', ['config', 'seq', 'mode', 'plane',
    'speed', 'rate', 'bytes', 'mbps25', 'psnr_y', 'psnr_occupied_y',
    'psnr_empty_y',
    'median_wall_s', 'median_user_s', 'delta_bits_pct',
    'delta_occupied_db', 'delta_user_pct'], rows);
}
function exportAggCSV() {
  var rows = aggRows().map(function (a) {
    return [activeFills().join('+'), a.cfg, a.ref, a.n, a.bytesMean,
      a.bitrateMean, a.pctBytes, a.dbY, a.dbOcc, a.dbEmpty, a.pctUser,
      a.pctWall];
  });
  downloadCSV('agregados.csv', ['fill_methods', 'config', 'reference', 'n_cells',
    'bytes_mean',
    'mbps25_mean', 'delta_bits_pct', 'delta_y_db', 'delta_occupied_db',
    'delta_empty_db', 'delta_user_pct', 'delta_wall_pct'], rows);
}

/* ---------------------------- tempos ------------------------------ */
function renderTime() {
  var svg = document.getElementById('time-svg');
  clear(svg);
  var W = 980, H = 420, m = {l: 130, r: 34, t: 36, b: 48};
  var rows = activeCfgs().map(function (cfg) {
    return aggregate(cfg, currentGroup(), activeSeqs(), activeRates(), state.aggCompare);
  }).filter(Boolean);
  if (!rows.length) {
    svgText(svg, W / 2, H / 2, 'Sem dados para os filtros atuais.', 'axis-label', 'middle');
    document.getElementById('time-hint').textContent = '';
  } else {
    // Escala fixa para poder comparar grupos (geometry/attribute, slow/fast).
    var dx = [-50, 25];
    var clampX = function (v) { return Math.max(-50, Math.min(25, v)); };
    var sx = function (v) { return m.l + (v - dx[0]) / (dx[1] - dx[0]) * (W - m.l - m.r); };
    niceTicks(dx[0], dx[1]).forEach(function (v) {
      var x = sx(v);
      el('line', {x1: x, x2: x, y1: m.t, y2: H - m.b, 'class': 'grid'}, svg);
      svgText(svg, x, H - m.b + 16, fmt(v, 0) + '%', 'tick-text', 'middle');
    });
    el('line', {x1: sx(0), x2: sx(0), y1: m.t, y2: H - m.b, 'class': 'zero'}, svg);
    svgText(svg, (m.l + W - m.r) / 2, H - 12, 'Δ tempo contra ' +
      (state.aggCompare === 'vs_same_depth' ? 'o dN (qp25)' : 'base') +
      ' (%)', 'axis-label', 'middle');
    svgText(svg, m.l - 8, m.t - 12, 'user', 'series-label', 'end');
    svgText(svg, m.l + 44, m.t - 12, 'wall', 'series-label', 'end');
    var slot = (H - m.t - m.b) / rows.length;
    rows.forEach(function (a, i) {
      var y0 = m.t + i * slot;
      svgText(svg, m.l - 10, y0 + slot / 2 + 4, a.cfg, 'tick-text', 'end');
      [['pctUser', 0.18, 0.9], ['pctWall', 0.54, 0.4]].forEach(function (b) {
        var v = a[b[0]], y = y0 + slot * b[1], h = slot * 0.28;
        var xc = sx(clampX(v));
        var x0 = Math.min(sx(0), xc);
        var rect = el('rect', {x: x0, y: y, width: Math.max(1, Math.abs(xc - sx(0))),
          height: h, rx: 2, fill: COLORS[a.cfg], 'fill-opacity': b[2],
          'data-anim-key': 'bar|' + a.cfg + '|' + b[0]}, svg);
        rect.style.cursor = 'pointer';
        bindTip(rect, '<div class="tt-title">' + esc(cfgLabel(a.cfg)) + '</div>' +
          b[0] + ': <b>' + fmt(v, 2) + '%</b>' +
          (v < -50 || v > 25 ? ' (fora da escala)' : '') + '<br>' +
          'user med: ' + fmt(a.userMedian, 2) + ' s · wall med: ' + fmt(a.wallMedian, 2) + ' s');
      });
    });
  }
  document.getElementById('time-hint').textContent =
    state.speed.toUpperCase() + ' · ' + state.mode.toUpperCase() + ' · ' +
    state.plane + ' · ' + activeSeqs().length + ' sequências · ' +
    activeRates().length + ' taxas · ' + activeFills().length + '/' +
    FILL_METHODS.length + ' preenchimentos · barras em escala fixa ' +
    '(−50% a +25%)';

  var c = getCell(state.speed, state.mode, state.plane, state.repSeq,
                  state.repRate, state.repCfg, state.repFill);
  var box = document.getElementById('rep-svg');
  clear(box);
  var stats = document.getElementById('rep-stats');
  clear(stats);
  if (!c) { return; }
  var reps = c.time_s.reps;
  var s = c.time_s[state.repField];
  var vals2 = reps.map(function (r) { return r[state.repField]; });
  var d2 = domain(vals2.concat([s.median]), 0.18);
  var W2 = 560, H2 = 280, m2 = {l: 52, r: 22, t: 22, b: 44};
  var sy2 = function (v) { return H2 - m2.b - (v - d2[0]) / (d2[1] - d2[0]) * (H2 - m2.t - m2.b); };
  var sx2 = function (i) { return m2.l + (i + 0.5) / reps.length * (W2 - m2.l - m2.r); };
  niceTicks(d2[0], d2[1]).forEach(function (v) {
    var y = sy2(v);
    el('line', {x1: m2.l, x2: W2 - m2.r, y1: y, y2: y, 'class': 'grid'}, box);
    svgText(box, m2.l - 6, y + 3, fmt(v, 1), 'tick-text', 'end');
  });
  el('line', {x1: m2.l, x2: W2 - m2.r, y1: m2.t, y2: H2 - m2.b, 'class': 'axis'}, box);
  var l1 = el('line', {x1: m2.l, x2: W2 - m2.r, y1: sy2(s.median), y2: sy2(s.median),
    stroke: '#2563eb', 'stroke-width': 2}, box);
  bindTip(l1, 'mediana: <b>' + fmt(s.median, 3) + ' s</b>');
  var l2 = el('line', {x1: m2.l, x2: W2 - m2.r, y1: sy2(s.mean), y2: sy2(s.mean),
    stroke: '#d97706', 'stroke-width': 1.5, 'stroke-dasharray': '5 4'}, box);
  bindTip(l2, 'média: <b>' + fmt(s.mean, 3) + ' s</b>');
  reps.forEach(function (r, i) {
    var dot = el('circle', {cx: sx2(i), cy: sy2(r[state.repField]), r: 5,
      fill: COLORS[c.config], stroke: '#fff', 'stroke-width': 1.3}, box);
    bindTip(dot, 'rep ' + r.rep + ': <b>' + fmt(r[state.repField], 3) +
      ' s</b> (' + state.repField + ')');
  });
  svgText(box, (m2.l + W2 - m2.r) / 2, H2 - 10,
    'repetição (10 encodes byte-idênticos)', 'axis-label', 'middle');
  svgText(box, 8, (m2.t + H2 - m2.b) / 2, state.repField + ' (s)', 'axis-label', 'middle')
    .setAttribute('transform', 'rotate(-90 8 ' + ((m2.t + H2 - m2.b) / 2) + ')');

  [
    ['configuração', cfgLabel(c.config)], ['preenchimento', c.fill_method],
    ['célula', c.seq + ' · ' + c.mode + ' · ' +
      c.plane + ' · ' + c.speed + ' · ' + c.rate.toUpperCase()],
    ['bytes', fmt(c.bytes, 0)], ['mediana', fmt(s.median, 3) + ' s'],
    ['média', fmt(s.mean, 3) + ' s'], ['mín / máx', fmt(s.min, 3) + ' / ' + fmt(s.max, 3) + ' s'],
    ['desvio', fmt(s.stdev, 3) + ' s'], ['CV', fmt(s.cv_pct, 2) + '%']
  ].forEach(function (kv) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + esc(kv[0]) + '</td><td class="num">' + esc(kv[1]) + '</td>';
    stats.appendChild(tr);
  });
}

/* --------------- tempo × qualidade e tempo × bitrate --------------- */
function timeSeries(xmode) {
  var out = [];
  var list = activeCfgs().slice();
  if (list.indexOf('base') < 0) list.unshift('base');
  list.forEach(function (cfg) {
    activeFills().forEach(function (fill) {
      if (state.hidden[cfg + '|*'] || state.hidden['*|' + fill]) return;
      var key = cfg + '|' + fill;
      var pts = [];
      activeRates().forEach(function (rate) {
        function rowsFor(name) {
          return CELLS.filter(function (c) {
            return c.config === name && c.speed === state.speed &&
              c.mode === state.mode && c.plane === state.plane &&
              c.rate === rate && c.fill_method === fill &&
              (state.timeSeq === 'avg' ? state.seqs[c.seq] :
                c.seq === state.timeSeq);
          });
        }
        var rows = rowsFor(cfg);
        if (!rows.length) return;
        var brows = rowsFor('base');
        var t = mean(rows.map(function (c) {
          return c.time_s[state.timeField].median; }));
        var tb = brows.length ?
          mean(brows.map(function (c) {
            return c.time_s[state.timeField].median; })) : NaN;
        var delta = isFinite(tb) ? pct(t, tb) : NaN;
        pts.push({
          rate: rate, x: xmode === 'quality' ? aggPSNR(rows, state.region) :
            mean(rows.map(function (c) { return c.bitrate_mbps_25fps; })),
          psnr: aggPSNR(rows, state.region),
          bitrate: mean(rows.map(function (c) {
            return c.bitrate_mbps_25fps; })),
          t: t, tb: tb, delta: delta,
          y: state.timeYMode === 'delta' ? (isFinite(delta) ? delta : 0) : t,
          bytes: mean(rows.map(function (c) { return c.bytes; }))
        });
      });
      if (pts.length) out.push({cfg: cfg, fill: fill, key: key, pts: pts});
    });
  });
  return out;
}
function timeCurveTip(cfg, fill, p) {
  var scope = (state.timeSeq === 'avg' ?
    activeSeqs().length + ' seq (média)' : state.timeSeq) +
    ' · ' + fillLabel(fill);
  return '<div class="tt-title">' + esc(cfgLabel(cfg)) + '</div>' +
    'taxa ' + p.rate.toUpperCase() + ' · ' + scope + '<br>' +
    'PSNR ' + REGION_NAME[state.region] + ': <b>' + fmt(p.psnr, 3) + '</b> dB<br>' +
    'bitrate: <b>' + fmt(p.bitrate, 3) + '</b> Mb/s<br>' +
    'tempo ' + state.timeField + ': <b>' + fmt(p.t, 3) + '</b> s (base ' +
    fmt(p.tb, 3) + ' s)<br>' +
    'Δtempo: <b>' + fmt(p.delta, 2) + '%</b> · ' + fmt(p.bytes, 0) + ' bytes';
}
function drawTimeCurve(svgId, series, xmode, sharedY) {
  var svg = document.getElementById(svgId);
  clear(svg);
  var W = 620, H = 420, m = {l: 68, r: 20, t: 20, b: 58};
  var xs = [], ys = [];
  series.forEach(function (s) {
    s.pts.forEach(function (p) { xs.push(p.x); ys.push(p.y); });
  });
  if (!xs.length) {
    svgText(svg, W / 2, H / 2, 'Sem dados para os filtros atuais.',
      'axis-label', 'middle');
    return;
  }
  var dx = domain(xs, 0.05), dy = sharedY || domain(ys, 0.12);
  var sx = function (v) { return m.l + (v - dx[0]) / (dx[1] - dx[0]) * (W - m.l - m.r); };
  var sy = function (v) { return H - m.b - (v - dy[0]) / (dy[1] - dy[0]) * (H - m.t - m.b); };
  niceTicks(dx[0], dx[1]).forEach(function (v) {
    if (v < dx[0] || v > dx[1]) return;
    var x = sx(v);
    el('line', {x1: x, x2: x, y1: m.t, y2: H - m.b, 'class': 'grid'}, svg);
    svgText(svg, x, H - m.b + 16, fmt(v, 1), 'tick-text', 'middle');
  });
  niceTicks(dy[0], dy[1]).forEach(function (v) {
    if (v < dy[0] || v > dy[1]) return;
    var y = sy(v);
    el('line', {x1: m.l, x2: W - m.r, y1: y, y2: y, 'class': 'grid'}, svg);
    svgText(svg, m.l - 7, y + 3, fmt(v, state.timeYMode === 'delta' ? 1 : 2),
      'tick-text', 'end');
  });
  if (state.timeYMode === 'delta' && dy[0] <= 0 && dy[1] >= 0) {
    el('line', {x1: m.l, x2: W - m.r, y1: sy(0), y2: sy(0), 'class': 'zero'}, svg);
  }
  el('line', {x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, 'class': 'axis'}, svg);
  el('line', {x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, 'class': 'axis'}, svg);
  svgText(svg, (m.l + W - m.r) / 2, H - 14,
    xmode === 'quality' ?
      'PSNR ' + REGION_NAME[state.region] + ' (dB)' :
      'Bitrate (Mb/s, 25 fps)', 'axis-label', 'middle');
  var yl = svgText(svg, 15, (m.t + H - m.b) / 2,
    state.timeYMode === 'delta' ?
      'Δ tempo ' + state.timeField + ' (%)' :
      'Tempo ' + state.timeField + ' (s)',
    'axis-label', 'middle');
  yl.setAttribute('transform', 'rotate(-90 15 ' + ((m.t + H - m.b) / 2) + ')');

  series.forEach(function (s) {
    var path = s.pts.map(function (p, i) {
      return (i ? 'L' : 'M') + sx(p.x).toFixed(1) + ',' + sy(p.y).toFixed(1);
    }).join(' ');
    el('path', {d: path, fill: 'none', stroke: COLORS[s.cfg],
      'stroke-width': s.cfg === 'base' ? 2.8 : 2,
      'stroke-dasharray': s.cfg === 'base' ? '7 4' : '',
      'stroke-linejoin': 'round',
      'data-anim-key': svgId + '|curve|' + s.key}, svg);
    s.pts.forEach(function (p) {
      var cx = sx(p.x), cy = sy(p.y);
      var dot = markerNode(markerFor(s.fill), cx, cy,
        s.cfg === 'base' ? 5 : 4, COLORS[s.cfg],
        svgId + '|point|' + s.key + '|' + p.rate, svg);
      dot.style.cursor = 'pointer';
      bindTip(dot, timeCurveTip(s.cfg, s.fill, p));
      if (s.cfg === 'base' && s.fill === activeFills()[0]) {
        svgText(svg, cx + 6, cy - 7, p.rate.toUpperCase(), 'point-label');
      }
    });
  });
}
function renderTimeCurves() {
  var sq = timeSeries('quality'), sb = timeSeries('bitrate');
  var allY = [];
  [sq, sb].forEach(function (list) {
    list.forEach(function (s) {
      s.pts.forEach(function (p) { allY.push(p.y); });
    });
  });
  if (state.timeYMode === 'delta') allY.push(0);
  var sharedY = allY.length ? domain(allY, 0.12) : null;
  drawTimeCurve('time-quality-svg', sq, 'quality', sharedY);
  drawTimeCurve('time-bitrate-svg', sb, 'bitrate', sharedY);

  renderSeriesLegend('time-legend');
  document.getElementById('time-curve-hint').textContent =
    state.speed.toUpperCase() + ' · ' + state.mode.toUpperCase() + ' · ' +
    state.plane + ' · ' + (state.timeSeq === 'avg' ?
      'média de ' + activeSeqs().length + ' sequências' : state.timeSeq) +
    ' · ' + activeFills().length + '/' + FILL_METHODS.length +
    ' preenchimentos · tempo ' + state.timeField +
    ' · eixo Y compartilhado entre os dois gráficos (' +
    (state.timeYMode === 'delta' ? 'Δ% contra o base' : 'segundos') + ')';
}

/* ---------------------------- pareto ------------------------------ */
var paretoCellCache = {};
var paretoSummary = {results: [], busy: false, done: false};

function paretoFillNow() {
  return state.plane === 'geometry' ? FILL_METHODS[0] : state.paretoFill;
}
function paretoResult() {
  var fill = paretoFillNow();
  var key = [state.plane, fill, state.speed, state.mode, state.region].join('|');
  if (!paretoCellCache[key]) {
    paretoCellCache[key] = PARETO.computeCell(D, {
      plane: state.plane, fill: fill, speed: state.speed, mode: state.mode,
      region: state.region
    });
  }
  return paretoCellCache[key];
}
function signed(v, nd) {
  if (!isFinite(v)) return '—';
  var s = fmt(v, nd);
  return v > 0 ? '+' + s : s;
}
function ensureParetoSummary() {
  if (paretoSummary.region === state.region &&
      (paretoSummary.done || paretoSummary.busy)) return;
  var summary = {results: [], busy: true, done: false, region: state.region};
  paretoSummary = summary;
  var cells = PARETO.cellsOf(D);
  var i = 0;
  function step() {
    if (paretoSummary !== summary) return; // região mudou: outro loop assumiu
    if (i >= cells.length) {
      summary.busy = false;
      summary.done = true;
      if (state.tab === 'pareto') {
        renderParetoSummary();
        renderParetoMethod();
      }
      return;
    }
    var c = cells[i++];
    var fill = c.fill === '*' ? FILL_METHODS[0] : c.fill;
    var key = [c.plane, fill, c.speed, c.mode, summary.region].join('|');
    var r = paretoCellCache[key];
    try {
      if (!r) {
        r = PARETO.computeCell(D, {
          plane: c.plane, fill: fill, speed: c.speed, mode: c.mode,
          region: summary.region
        });
        paretoCellCache[key] = r;
      }
      summary.results.push(r);
    } catch (err) {
      if (window.console) console.error('pareto', c, err);
    }
    if (state.tab === 'pareto') renderParetoSummary();
    setTimeout(step, 0);
  }
  setTimeout(step, 0);
}
function paretoStatsOf(results) {
  var minOv = Infinity, maxPL = 0, n = 0, valid = 0, bad = 0, badCfgs = 0;
  results.forEach(function (res) {
    res.configs.forEach(function (c) {
      if (c.config === 'base') return;
      n++;
      if (c.bdPct === null) { badCfgs++; return; }
      if (isFinite(c.overlapMin)) minOv = Math.min(minOv, c.overlapMin);
      for (var i = 0; i < c.bdBySeq.length; i++) {
        var a = c.bdBySeq[i].bd;
        var b = c.bdLinearBySeq[i] ? c.bdLinearBySeq[i].bd : null;
        if (a === null) { bad++; continue; }
        valid++;
        if (b !== null) maxPL = Math.max(maxPL, Math.abs(a - b));
      }
    });
  });
  return {minOv: minOv, maxPL: maxPL, n: n, valid: valid, bad: bad,
    badCfgs: badCfgs, curves: n * 5};
}
function paretoSummaryStats() {
  return paretoStatsOf(paretoSummary.results);
}
function renderParetoWarning(res) {
  var box = document.getElementById('pareto-warning');
  if (res.cell.region === 'occupied_y') {
    box.hidden = true;
    clear(box);
    return;
  }
  var global = paretoSummary.done &&
    paretoSummary.region === res.cell.region ? paretoSummaryStats() : null;
  var st = global || paretoStatsOf([res]);
  var escopo = global ? 'nas 20 células' : 'nesta célula';
  box.hidden = false;
  var txt = '<b>Cuidado com ' + esc(REGION_NAME[res.cell.region]) +
    '.</b> Nesta região as curvas RD são ruidosas: ' + escopo + ', ' +
    st.valid + ' de ' + st.curves + ' curvas deram BD-rate' +
    (st.badCfg ? ' e ' + st.badCfg + ' comparações ficaram sem BD-rate' : '') +
    '; a sobreposição mínima de PSNR é ' + fmt(st.minOv, 2) + ' dB e ' +
    'PCHIP × interpolação linear difere em até ' + fmt(st.maxPL, 1) +
    ' pontos percentuais.';
  if (st.maxPL > 10) {
    txt += ' <b>BD-rate instável nesta região</b>: confira as curvas antes de ' +
      'usar a escolha como conclusão.';
  }
  txt += ' O relatório e o padrão desta aba usam Y ocupado, onde a diferença ' +
    'máxima é 1,64 p.p.';
  box.innerHTML = txt;
}
function renderPareto() {
  if (!PARETO) {
    document.getElementById('pareto-hint').textContent = 'pareto.js não carregou.';
    return;
  }
  var fillSel = document.getElementById('pareto-fill');
  fillSel.value = state.paretoFill;
  fillSel.disabled = state.plane === 'geometry';
  fillSel.title = state.plane === 'geometry' ?
    'A geometria é idêntica nos 4 preenchimentos; o tempo é agregado.' : '';
  var res = paretoResult();
  var sel = PARETO.select(res, state.paretoThreshold, state.paretoCI);
  renderParetoWarning(res);
  var cell = sel.cell;
  var geo = cell.plane === 'geometry';
  document.getElementById('pareto-title').textContent =
    (geo ? 'Geometria' : 'Atributo') + ' · ' + cell.speed.toUpperCase() +
    ' · ' + cell.mode.toUpperCase();
  document.getElementById('pareto-subtitle').textContent =
    (geo ? 'tempo agregado nos 4 preenchimentos' :
      'preenchimento ' + fillLabel(cell.fill)) +
    ' · PSNR ' + REGION_NAME[cell.region] +
    ' · 5 sequências × 5 taxas · 10 repetições';
  document.getElementById('pareto-hint').textContent =
    'Célula: ' + (geo ? 'geometria' : 'atributo/' + fillLabel(cell.fill)) +
    ' · ' + cell.speed + '/' + cell.mode + ' · PSNR ' +
    REGION_NAME[cell.region] + ' · referência base · ' +
    (sel.winner === 'base' ? 'decisão: manter o base' :
      'decisão: adotar ' + sel.winner);
  renderParetoChart(sel);
  renderParetoLegend();
  renderParetoTable(sel);
  renderParetoDecision(sel);
  renderParetoSeqTable(sel);
  renderParetoThresholdTable(sel);
  renderParetoMethod();
  ensureParetoSummary();
  renderParetoSummary();
}
function renderParetoChart(sel) {
  var svg = document.getElementById('pareto-svg');
  clear(svg);
  var W = 980, H = 520, m = {l: 78, r: 30, t: 30, b: 62};
  var pts = sel.configs.filter(function (c) { return c.bdPct !== null; });
  if (!pts.length) {
    svgText(svg, W / 2, H / 2, 'Sem dados para esta célula.',
      'axis-label', 'middle');
    return;
  }
  var cap = state.paretoFullY ? Infinity : 8;
  function clamp(v) { return Math.max(-cap, Math.min(cap, v)); }
  var xs = pts.map(function (p) { return p.tPct; }).concat([0]);
  var ys = pts.map(function (p) { return clamp(p.bdPct); }).concat([0]);
  var dx = domain(xs, 0.10), dy = domain(ys, 0.12);
  var sx = function (v) {
    return m.l + (v - dx[0]) / (dx[1] - dx[0]) * (W - m.l - m.r);
  };
  var sy = function (v) {
    return H - m.b - (v - dy[0]) / (dy[1] - dy[0]) * (H - m.t - m.b);
  };

  var zx = sx(0), zy = sy(0);
  if (zx < W - m.r && zy < H - m.b) {
    el('rect', {x: zx, y: zy, width: W - m.r - zx, height: H - m.b - zy,
      fill: '#0f9d58', 'fill-opacity': 0.06}, svg);
  }
  if (zx > m.l && zy > m.t) {
    el('rect', {x: m.l, y: m.t, width: zx - m.l, height: zy - m.t,
      fill: '#d64545', 'fill-opacity': 0.05}, svg);
  }

  niceTicks(dx[0], dx[1]).forEach(function (v) {
    if (v < dx[0] || v > dx[1]) return;
    var x = sx(v);
    el('line', {x1: x, x2: x, y1: m.t, y2: H - m.b, 'class': 'grid'}, svg);
    svgText(svg, x, H - m.b + 16, signed(v, 1) + '%', 'tick-text', 'middle');
  });
  niceTicks(dy[0], dy[1]).forEach(function (v) {
    if (v < dy[0] || v > dy[1]) return;
    var y = sy(v);
    el('line', {x1: m.l, x2: W - m.r, y1: y, y2: y, 'class': 'grid'}, svg);
    svgText(svg, m.l - 8, y + 3, signed(v, 1) + '%', 'tick-text', 'end');
  });
  el('line', {x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b,
    'class': 'axis'}, svg);
  el('line', {x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, 'class': 'axis'}, svg);
  el('line', {x1: zx, x2: zx, y1: m.t, y2: H - m.b, 'class': 'zero'}, svg);
  el('line', {x1: m.l, x2: W - m.r, y1: zy, y2: zy, 'class': 'zero'}, svg);
  svgText(svg, (m.l + W - m.r) / 2, H - 18,
    'Ganho de tempo contra o base (%)', 'axis-label', 'middle');
  var yl = svgText(svg, 17, (m.t + H - m.b) / 2,
    'BD-rate contra o base (%) — negativo = menos bits',
    'axis-label', 'middle');
  yl.setAttribute('transform', 'rotate(-90 17 ' + ((m.t + H - m.b) / 2) + ')');

  var front = pts.filter(function (p) { return p.pareto; })
    .sort(function (a, b) { return a.tPct - b.tPct; });
  if (front.length > 1) {
    var d = front.map(function (p, i) {
      return (i ? 'L' : 'M') + sx(p.tPct).toFixed(1) + ',' +
        sy(clamp(p.bdPct)).toFixed(1);
    }).join(' ');
    el('path', {d: d, fill: 'none', stroke: '#475467', 'stroke-width': 1.8,
      'stroke-dasharray': '6 4', 'stroke-linejoin': 'round',
      'data-anim-key': 'pareto|front'}, svg);
  }

  var labels = [];
  pts.forEach(function (p) {
    var clipped = p.bdPct > cap || p.bdPct < -cap;
    var cx = sx(p.tPct), cy = sy(clamp(p.bdPct));
    if (p.selected) {
      el('circle', {cx: cx, cy: cy, r: 15, fill: 'none',
        stroke: COLORS[p.config], 'stroke-width': 2.2,
        'stroke-dasharray': '5 3', 'data-anim-key': 'pareto|ring'}, svg);
    }
    var dot;
    if (clipped) {
      dot = clippedMarker(cx, cy, 7, COLORS[p.config], p.bdPct > 0, svg);
      dot.setAttribute('data-anim-key', 'pareto|pt|' + p.config);
    } else {
      dot = markerNode('circle', cx, cy, p.selected ? 8.5 : 6.5,
        COLORS[p.config], 'pareto|pt|' + p.config, svg);
    }
    dot.style.cursor = 'pointer';
    bindTip(dot, paretoTip(p));
    var txt = p.config + (clipped ? ' (' + signed(p.bdPct, 1) + '%)' : '');
    if (p.selected) txt = '★ ' + txt;
    labels.push({cx: cx, cy: cy, text: txt, color: COLORS[p.config],
      bold: p.selected});
  });
  placeParetoLabels(svg, labels, m, W, H);
  if (!state.paretoFullY && pts.some(function (p) {
    return p.bdPct > 8 || p.bdPct < -8;
  })) {
    svgText(svg, W - m.r, m.t + 12,
      'triângulos = BD% fora de ±8% (valor real no rótulo)',
      'pareto-note', 'end');
  }
}
function clippedMarker(cx, cy, r, color, up, parent) {
  var pts = up ?
    [[cx, cy - r], [cx + r * 0.9, cy + r * 0.7],
      [cx - r * 0.9, cy + r * 0.7]] :
    [[cx, cy + r], [cx + r * 0.9, cy - r * 0.7],
      [cx - r * 0.9, cy - r * 0.7]];
  return el('polygon', {
    points: pts.map(function (p) {
      return p[0].toFixed(1) + ',' + p[1].toFixed(1);
    }).join(' '),
    fill: color, stroke: '#fff', 'stroke-width': 1.5
  }, parent);
}
function placeParetoLabels(svg, labels, m, W, H) {
  var boxes = [];
  labels.slice().sort(function (a, b) {
    return (b.bold ? 1 : 0) - (a.bold ? 1 : 0);
  }).forEach(function (l) {
    var w = 7.2 * l.text.length + 8, h = 15;
    var cands = [
      [l.cx + 11, l.cy - 8, 'start'],
      [l.cx - 11, l.cy - 8, 'end'],
      [l.cx + 11, l.cy + 16, 'start'],
      [l.cx - 11, l.cy + 16, 'end'],
      [l.cx, l.cy - 13, 'middle'],
      [l.cx, l.cy + 21, 'middle']
    ];
    var best = null;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      var bx = c[2] === 'start' ? c[0] :
        (c[2] === 'end' ? c[0] - w : c[0] - w / 2);
      var by = c[1] - 12;
      if (bx < m.l + 2 || bx + w > W - m.r - 2 ||
          by < m.t + 2 || by + h > H - m.b - 2) continue;
      var hit = boxes.some(function (b) {
        return !(bx + w < b.x || b.x + b.w < bx ||
                 by + h < b.y || b.y + b.h < by);
      });
      if (!hit) {
        best = {x: c[0], y: c[1], anchor: c[2], bx: bx, by: by};
        break;
      }
    }
    if (!best) {
      var c0 = cands[0];
      best = {x: c0[0], y: c0[1], anchor: c0[2],
        bx: c0[0], by: c0[1] - 12};
    }
    boxes.push({x: best.bx, y: best.by, w: w, h: h});
    var t = svgText(svg, best.x, best.y, l.text,
      'pareto-label' + (l.bold ? ' sel' : ''), best.anchor);
    t.setAttribute('fill', l.color);
    if (l.bold) t.setAttribute('font-weight', '700');
  });
}
function paretoTip(p) {
  var s = '<div class="tt-title">' + esc(cfgLabel(p.config)) + '</div>';
  s += 'T%: <b>' + signed(p.tPct, 2) + '%</b> [' +
    fmt(p.ciLow, 2) + '; ' + fmt(p.ciHigh, 2) + ']<br>';
  s += 'BD-rate (' + esc(REGION_NAME[p.region || state.region]) +
    '): <b>' + signed(p.bdPct, 2) + '%</b><br>';
  s += 'ΔQ ocupado: ' + signed(p.dqDb, 3) + ' dB<br>';
  s += 'Δbits: ' + signed(p.bitsPct, 2) + '%<br>';
  s += (p.pareto ? 'na frente de Pareto' : 'dominada') +
    (p.selected ? ' · <b>escolhida</b>' : '');
  return s;
}
function renderParetoLegend() {
  var box = document.getElementById('pareto-legend');
  clear(box);
  CFGS.forEach(function (cfg) {
    var s = document.createElement('span');
    s.className = 'pareto-static';
    var sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = COLORS[cfg];
    s.appendChild(sw);
    s.appendChild(document.createTextNode(cfg));
    box.appendChild(s);
  });
  var f = document.createElement('span');
  f.className = 'pareto-static';
  f.innerHTML = '<span class="dash"></span>frente de Pareto';
  box.appendChild(f);
  var r = document.createElement('span');
  r.className = 'pareto-static';
  r.innerHTML = '<span class="ring"></span>escolhida pela regra';
  box.appendChild(r);
}
function renderParetoTable(sel) {
  var t = document.getElementById('pareto-table');
  clear(t);
  var thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>config</th><th>T%</th><th>IC95% T%</th>' +
    '<th>BD%</th><th>ΔQ dB</th><th>Δbits%</th><th>frente</th>' +
    '<th>regra</th></tr>';
  t.appendChild(thead);
  var tb = document.createElement('tbody');
  t.appendChild(tb);
  sel.configs.slice().sort(function (a, b) { return b.tPct - a.tPct; })
    .forEach(function (c) {
      var tr = document.createElement('tr');
      if (c.config === 'base') tr.className = 'base-row';
      if (c.selected) tr.className += ' selected';
      var tag = '';
      if (c.selected) tag = '<span class="pareto-tag adopt">adotar</span>';
      else if (c.config === 'base' && sel.winner === 'base') {
        tag = '<span class="pareto-tag keep">manter</span>';
      }
      tr.innerHTML =
        '<td>' + esc(c.config) + '</td>' +
        '<td class="num ' +
          (c.tPct > 0 ? 'good' : c.tPct < 0 ? 'bad' : '') + '">' +
          signed(c.tPct, 2) + '</td>' +
        '<td class="num">[' + fmt(c.ciLow, 2) + '; ' +
          fmt(c.ciHigh, 2) + ']</td>' +
        '<td class="num ' +
          (c.bdPct < 0 ? 'good' : c.bdPct > 0 ? 'bad' : '') + '">' +
          signed(c.bdPct, 3) + '</td>' +
        '<td class="num ' +
          (c.dqDb < 0 ? 'good' : c.dqDb > 0 ? 'bad' : '') + '">' +
          signed(c.dqDb, 3) + '</td>' +
        '<td class="num ' +
          (c.bitsPct < 0 ? 'good' : c.bitsPct > 0 ? 'bad' : '') + '">' +
          signed(c.bitsPct, 2) + '</td>' +
        '<td>' + (c.pareto ? '✓' : '') + '</td>' +
        '<td>' + tag + '</td>';
      tr.title = 'BD% negativo = menos bits; ΔQ positivo = perda de PSNR ' +
        'no mesmo QP.';
      tb.appendChild(tr);
    });
  var note = 'T% positivo = mais rápido; BD% negativo = menos bits a ' +
    'qualidade igual. ΔQ usa a PSNR ' + REGION_NAME[sel.cell.region] +
    ' e é descritivo: não entra na decisão, porque o BD-rate já é medido a ' +
    'qualidade constante.';
  var nulls = sel.configs.filter(function (c) {
    return c.config !== 'base' && c.bdPct === null;
  }).length;
  if (nulls) {
    note += ' ' + nulls + ' config(ões) sem BD-rate em ' +
      REGION_NAME[sel.cell.region] + ': curva RD não monotônica em alguma ' +
      'sequência ou sobreposição de PSNR < 0,5 dB. Foram excluídas, ' +
      'sem extrapolação.';
  }
  document.getElementById('pareto-table-note').textContent = note;
}
function renderParetoDecision(sel) {
  var box = document.getElementById('pareto-decision');
  clear(box);
  var w = sel.winnerRow;
  var d = document.createElement('div');
  d.className = 'pareto-decision';
  var k = document.createElement('div');
  k.className = 'decision-kicker';
  k.textContent = 'Regra aplicada';
  d.appendChild(k);
  var main = document.createElement('div');
  main.className = 'decision-main';
  main.innerHTML = w ? 'Adotar <b>' + esc(w.config) + '</b>' :
    'Manter <b>base</b>';
  d.appendChild(main);
  var p = document.createElement('p');
  if (w) {
    p.innerHTML = 'T% = <b>' + signed(w.tPct, 2) + '%</b> (IC95% ' +
      fmt(w.ciLow, 2) + ' a ' + fmt(w.ciHigh, 2) + '), BD% = <b>' +
      signed(w.bdPct, 2) + '%</b>, ΔQ = ' + signed(w.dqDb, 3) + ' dB.';
  } else {
    p.textContent = 'Nenhuma configuração passou em BD% ≤ ' +
      fmt(sel.threshold, 1) + '% com ganho de tempo significativo.';
  }
  d.appendChild(p);
  box.appendChild(d);

  var notes = document.createElement('div');
  notes.className = 'notes';
  function line(html) {
    var n = document.createElement('div');
    n.innerHTML = html;
    notes.appendChild(n);
  }
  line('<b>Regra:</b> ' + esc(sel.rule) + '.');
  line('<b>Base:</b> ' + fmt(sel.base.timeS, 1) + ' s, ' +
    fmt(sel.base.bytes, 0) + ' bytes, ' + fmt(sel.base.psnr, 3) +
    ' dB (PSNR ocupada).');
  if (w) {
    line('<b>Escolhida:</b> ' + fmt(w.timeS, 1) + ' s, ' +
      fmt(sel.base.bytes * (1 + w.bitsPct / 100), 0) + ' bytes, ' +
      fmt(sel.base.psnr - w.dqDb, 3) + ' dB.');
  } else if (sel.bestCandidate) {
    var b = sel.bestCandidate;
    var why = b.bdPct > sel.threshold ?
      'BD% ' + signed(b.bdPct, 2) + '% acima do limite de ' +
        fmt(sel.threshold, 1) + '%' :
      'IC95% do tempo [' + fmt(b.ciLow, 2) + '; ' + fmt(b.ciHigh, 2) +
        '] inclui zero';
    line('<b>Melhor candidato:</b> ' + esc(b.config) + ' — T% ' +
      signed(b.tPct, 2) + '%, BD% ' + signed(b.bdPct, 2) +
      '%, descartado porque ' + why + '.');
  }
  box.appendChild(notes);
}
function renderParetoSeqTable(sel) {
  var t = document.getElementById('pareto-seq-table');
  clear(t);
  var title = document.getElementById('pareto-seq-title');
  var row = sel.winnerRow || sel.bestCandidate;
  if (!row) {
    title.textContent = 'BD-rate por sequência';
    var empty = document.createElement('tbody');
    empty.innerHTML = '<tr><td>—</td></tr>';
    t.appendChild(empty);
    return;
  }
  title.textContent = 'BD-rate por sequência — ' + row.config +
    (sel.winnerRow ? '' : ' (melhor candidato)');
  var thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>sequência</th><th>BD%</th>' +
    '<th>vs média</th></tr>';
  t.appendChild(thead);
  var tb = document.createElement('tbody');
  t.appendChild(tb);
  row.bdBySeq.forEach(function (b) {
    var tr = document.createElement('tr');
    if (b.bd === null) {
      tr.innerHTML = '<td>' + esc(b.seq) + '</td>' +
        '<td class="num">—</td><td></td>';
      tr.title = 'BD-rate indisponível: curva RD não monotônica em ' +
        REGION_NAME[state.region] + ' ou sobreposição de PSNR < 0,5 dB.';
    } else {
      var d = b.bd - row.bdPct;
      tr.innerHTML = '<td>' + esc(b.seq) + '</td>' +
        '<td class="num ' +
          (b.bd < 0 ? 'good' : b.bd > 0 ? 'bad' : '') + '">' +
          signed(b.bd, 2) + '</td>' +
        '<td class="num">' + signed(d, 2) + '</td>';
    }
    tb.appendChild(tr);
  });
}
function renderParetoThresholdTable(sel) {
  var t = document.getElementById('pareto-threshold-table');
  clear(t);
  var thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>limite de BD-rate</th><th>config</th>' +
    '<th>T%</th><th>BD%</th><th>decisão</th></tr>';
  t.appendChild(thead);
  var tb = document.createElement('tbody');
  t.appendChild(tb);
  var res = paretoResult();
  [0, 0.5, 1, 2].forEach(function (thr) {
    var s = PARETO.select(res, thr, state.paretoCI);
    var w = s.winnerRow;
    var tr = document.createElement('tr');
    if (thr === state.paretoThreshold) tr.className = 'selected';
    tr.innerHTML = '<td>' + fmt(thr, 1) + '%</td>' +
      '<td><b>' + esc(s.winner) + '</b></td>' +
      '<td class="num">' + (w ? signed(w.tPct, 2) : '0,00') + '</td>' +
      '<td class="num">' + (w ? signed(w.bdPct, 2) : '0,00') + '</td>' +
      '<td>' + (s.winner === 'base' ?
        '<span class="pareto-tag keep">manter</span>' :
        '<span class="pareto-tag adopt">adotar</span>') + '</td>';
    tb.appendChild(tr);
  });
}
function renderParetoSummary() {
  var t = document.getElementById('pareto-cells-table');
  clear(t);
  var thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>plano</th><th>preench.</th><th>vel.</th>' +
    '<th>modo</th><th>config</th><th>T%</th><th>IC95% T%</th><th>BD%</th>' +
    '<th>ΔQ dB</th><th>decisão</th></tr>';
  t.appendChild(thead);
  var tb = document.createElement('tbody');
  t.appendChild(tb);
  var results = paretoSummary.results;
  results.forEach(function (res) {
    var s = PARETO.select(res, state.paretoThreshold, state.paretoCI);
    var c = res.cell;
    var geo = c.plane === 'geometry';
    var w = s.winnerRow;
    var cur = c.plane === state.plane && c.speed === state.speed &&
      c.mode === state.mode && (geo || c.fill === state.paretoFill);
    var tr = document.createElement('tr');
    tr.className = 'clickable' + (cur ? ' selected' : '');
    var tPct = w ? w.tPct : 0, bd = w ? w.bdPct : 0, dq = w ? w.dqDb : 0;
    var lo = w ? w.ciLow : 0, hi = w ? w.ciHigh : 0;
    tr.innerHTML =
      '<td>' + (geo ? 'geom' : 'atrib') + '</td>' +
      '<td>' + (geo ? '—' : esc(fillLabel(c.fill))) + '</td>' +
      '<td>' + c.speed.toUpperCase() + '</td>' +
      '<td>' + c.mode.toUpperCase() + '</td>' +
      '<td><b>' + esc(s.winner) + '</b></td>' +
      '<td class="num ' +
        (tPct > 0 ? 'good' : tPct < 0 ? 'bad' : '') + '">' +
        signed(tPct, 2) + '</td>' +
      '<td class="num">[' + fmt(lo, 2) + '; ' + fmt(hi, 2) + ']</td>' +
      '<td class="num ' +
        (bd < 0 ? 'good' : bd > 0 ? 'bad' : '') + '">' +
        signed(bd, 2) + '</td>' +
      '<td class="num">' + signed(dq, 3) + '</td>' +
      '<td>' + (s.winner === 'base' ?
        '<span class="pareto-tag keep">manter</span>' :
        '<span class="pareto-tag adopt">adotar</span>') + '</td>';
    if (!w && s.bestCandidate) {
      tr.title = 'Melhor candidato: ' + s.bestCandidate.config +
        ' (T% ' + signed(s.bestCandidate.tPct, 2) + '%, BD% ' +
        signed(s.bestCandidate.bdPct, 2) + '%)';
    }
    tr.onclick = function () {
      state.plane = c.plane;
      state.speed = c.speed;
      state.mode = c.mode;
      if (!geo) state.paretoFill = c.fill;
      syncSeg('seg-speed');
      syncSeg('seg-mode');
      syncSeg('seg-plane');
      render();
      document.getElementById('panel-pareto')
        .scrollIntoView({behavior: 'smooth', block: 'start'});
    };
    tb.appendChild(tr);
  });
  if (!results.length) {
    var tr0 = document.createElement('tr');
    tr0.innerHTML = '<td colspan="10">calculando as 20 células…</td>';
    tb.appendChild(tr0);
  }
  document.getElementById('pareto-cells-status').textContent =
    paretoSummary.busy ? 'calculando… ' + results.length + '/20' :
      (paretoSummary.done ? results.length + '/20 células' : '');
}
function renderParetoMethod() {
  var box = document.getElementById('pareto-method');
  clear(box);
  function line(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    box.appendChild(d);
  }
  line('<b>Referência.</b> base = kvazaar upstream 2.3.1 sem flags de ' +
    'occupancy, na mesma célula (sequência, taxa, modo, velocidade, ' +
    'preenchimento).');
  line('<b>Unidade.</b> 20 células: 4 de geometria (velocidade × modo) e ' +
    '16 de atributo (preenchimento × velocidade × modo). Na geometria, ' +
    'bytes e PSNR são idênticos nos 4 preenchimentos; só o tempo ' +
    'varia entre execuções, então o tempo é agregado nas 4 repetições ' +
    '(40 medições por sequência/taxa). Contar as 16 como independentes ' +
    'transformaria ruído de tempo em efeito de preenchimento.');
  line('<b>T% — ganho de tempo.</b> 100·(ΣT_base − ΣT_cfg)/ΣT_base, com ' +
    'T = mediana das 10 repetições e a soma percorrendo as 25 células de ' +
    'sequência × taxa. O IC95% vem de bootstrap das repetições dentro de ' +
    'cada célula (1.000 reamostragens, semente fixa). Positivo = mais ' +
    'rápido.');
  line('<b>BD% — BD-rate.</b> Região de PSNR: <b>' +
    esc(REGION_NAME[state.region]) + '</b> (selecionada no menu lateral; ' +
    'o padrão é Y ocupado). Por sequência, com os 5 pontos (PSNR dessa ' +
    'região, log(bytes)): interpolação cúbica monotônica (PCHIP), ' +
    'integração no intervalo de PSNR comum às duas curvas e média ' +
    'geométrica das 5 sequências. Negativo = menos bits para a mesma ' +
    'qualidade. Se a curva RD não for monotônica em alguma sequência, ' +
    'o BD-rate é marcado como indisponível — não se inventa valor. ' +
    'A qualidade já está dentro do BD-rate; por isso o ΔPSNR ' +
    'no mesmo QP aparece só como descrição e não entra na decisão.');
  line('<b>Seleção.</b> (1) frente de Pareto em (T%, BD%): A domina B se ' +
    'T_A ≥ T_B e BD_A ≤ BD_B, com pelo menos uma desigualdade estrita; ' +
    '(2) adota uma config só se BD% ≤ limite e o limite inferior do ' +
    'IC95% de T% for > 0; (3) entre as elegíveis, maior T%, com empate ' +
    'abaixo de 0,05 p.p. resolvido pelo menor BD% — a mediana de 10 ' +
    'repetições não distingue menos que isso, e a menor semi-largura de ' +
    'IC95% da suíte é 0,12 p.p.; (4) se nenhuma cumprir, mantém o base.');
  var st = paretoSummary.region === state.region && paretoSummary.done ?
    paretoSummaryStats() : null;
  if (st) {
    var val = '<b>Validação (' + esc(REGION_NAME[state.region]) + ').</b> ' +
      st.valid + ' de ' + st.curves + ' curvas RD válidas';
    if (st.bad) val += ' (' + st.bad + ' descartadas por curva não ' +
      'monotônica ou sobreposição < 0,5 dB)';
    val += '; sobreposição mínima de PSNR ' + fmt(st.minOv, 2) + ' dB. ' +
      'PCHIP × interpolação linear: diferença máxima de ' +
      fmt(st.maxPL, 2) + ' pontos percentuais.';
    if (st.badCfgs) val += ' ' + st.badCfgs + ' comparações de config não ' +
      'geraram BD-rate da célula e ficaram fora da frente.';
    line(val);
  } else {
    line('<b>Validação.</b> calculando sobreposição de PSNR, curvas ' +
      'válidas e diferença PCHIP × linear…');
  }
  line('<b>Limitações.</b> A qualidade é a PSNR da região selecionada ' +
    '(Y global, Y ocupado ou Y vazio); o padrão é Y ocupado, que é a ' +
    'região usada no relatório. Não há D1/D2 nem PSNR de cor. O ' +
    'BD-rate resume 5 QPs e o tempo é parede (wall), mediana de 10 ' +
    'repetições. A generalização vale para as 5 sequências e o workload ' +
    'medidos.');
  line('<b>Reprodutibilidade.</b> Todos os números desta aba são ' +
    'recalculados no navegador a partir das mesmas células do site ' +
    '(data.js), com semente fixa; não são copiados do relatório.');
}

/* ---------------------------- sobre ------------------------------- */
function renderAbout() {
  var box = document.getElementById('about-content');
  clear(box);
  function h3(s) { var e = document.createElement('h3'); e.textContent = s; box.appendChild(e); }
  function p(s) { var e = document.createElement('p'); e.textContent = s; box.appendChild(e); }
  h3('O que é medido');
  p(D.description);
  p('Referência: ' + D.methodology.reference + '. ' + D.methodology.delta_signs +
    '. ' + D.methodology.time.caveat);
  p('Preenchimento: ' + D.methodology.fill_method);
  h3('Configurações (flags reais)');
  var t = document.createElement('table');
  t.className = 'data';
  t.innerHTML = '<thead><tr><th>config</th><th>experimento</th><th>flags do kvazaar</th></tr></thead>';
  var tb = document.createElement('tbody');
  CFGS.forEach(function (cfg) {
    var c = D.configs[cfg];
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + esc(cfg) + '</td><td>' + esc(c.experiment) +
      '</td><td>' + esc(c.kvazaar_flags.join(' ') || '(nenhum)') + '</td>';
    tb.appendChild(tr);
  });
  t.appendChild(tb); box.appendChild(t);
  h3('Como o site agrega');
  var r = D.methodology.site_recipe;
  [['Curvas RD', r.rd_curve], ['PSNR por energia', r.psnr_energy_aggregation],
   ['Deltas de grupo', r.group_deltas], ['Comparações', r.comparisons]]
    .forEach(function (kv) {
      var d = document.createElement('div');
      d.className = 'notes';
      d.innerHTML = '<div><b>' + kv[0] + ':</b> ' + esc(kv[1]) + '</div>';
      box.appendChild(d);
    });
  h3('Escolha por célula (BD-rate × tempo)');
  p('A aba Pareto calcula no navegador, a partir das mesmas células, o ' +
    'BD-rate sobre a PSNR da região selecionada no menu lateral (Y global, ' +
    'Y ocupado ou Y vazio; padrão: Y ocupado) e o ganho de tempo de cada ' +
    'configuração contra o base. A unidade é 20 células: 4 de geometria e ' +
    '16 de atributo. Na geometria, bytes e PSNR são idênticos nos 4 ' +
    'preenchimentos; só o tempo varia, então ele é agregado nas 4 ' +
    'repetições.');
  p('A escolha não usa pesos: frente de Pareto em (T%, BD%), adota só ' +
    'BD% ≤ limite e IC95% do tempo > 0, e mantém o base quando nenhuma ' +
    'configuração passa. O limite é ajustável e a tabela de sensibilidade ' +
    'mostra o efeito de 0 a 2%. O método completo está descrito na própria ' +
    'aba; a implementação é pareto.js.');
  h3('Origem dos dados');
  D.provenance.source_runs.forEach(function (s) {
    var d = document.createElement('div');
    d.className = 'notes';
    d.innerHTML = '<div><b>' + esc(s.path) + '</b> — ' +
      esc((s.configs || []).join(', ')) + (s.speed ? ' · ' + esc(s.speed) : '') +
      (s.note ? ' · ' + esc(s.note) : '') + '</div>';
    box.appendChild(d);
  });
  p('Dados gerados em ' + D.generated_at + '.');
}

/* ---------------------------- render ------------------------------ */
function render() {
  var main = document.querySelector('main');
  captureTween(main);
  captureAttrs(main);
  document.getElementById('subtitle').textContent =
    state.speed.toUpperCase() + ' · ' + state.mode.toUpperCase() + ' · ' +
    state.plane + ' · ' + REGION_NAME[state.region] + ' · ' +
    activeSeqs().length + '/' + SEQS.length + ' sequências · ' +
    activeRates().length + '/' + RATES.length + ' taxas · ' +
    activeFills().length + '/' + FILL_METHODS.length + ' preenchimentos';
  if (state.tab === 'rd') renderRD();
  if (state.tab === 'overview') renderOverview();
  if (state.tab === 'pareto') renderPareto();
  if (state.tab === 'tables') {
    if (state.sub === 'agg') renderAggTable(); else renderCellsTable();
  }
  if (state.tab === 'time') { renderTime(); renderTimeCurves(); }
  applyTween(main);
  applyAttrs(main);
}
function init() {
  document.getElementById('badge-cells').textContent =
    CELLS.length + ' células · ' +
    CELLS.reduce(function (s, c) { return s + c.time_s.reps.length; }, 0) + ' medições';
  document.getElementById('badge-date').textContent =
    String(D.generated_at).slice(0, 10);
  initControls();
  renderAbout();
  var requested = String(location.hash || '').replace('#', '');
  ['rd', 'overview', 'pareto', 'tables', 'time', 'about'].forEach(function (t) {
    if (requested === t) switchTab(t);
  });
  render();
}
init();
})();
