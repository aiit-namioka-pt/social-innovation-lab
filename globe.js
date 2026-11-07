/* =========================================================
   トップの地球儀（canvas）
   陸地の点データは globe-data.js（GLOBE_DATA）から読み込み、
   設定は <canvas class="globe" data-globe='{...}'> の JSON で受け取る。
   視差効果を減らす設定のときは静止画として1回だけ描画する。
   ========================================================= */
(function () {
  'use strict';

  var RAD = Math.PI / 180;
  var DATA = window.GLOBE_DATA;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var DEFAULTS = {
    lat: 24, lon: 150,           // 初期に正面へ来る緯度・経度
    speed: 5,                    // 自転の速さ（度/秒）
    swing: 0,                    // >0 で自転させず、経度を ±swing 度で往復
    r: 0.40, rw: 0,              // 半径（短辺比）。rw>0 なら横幅比で指定
    cx: 0.5, cy: 0.5, top: null, // 中心位置（キャンバス比）。top 指定時は球の上端位置
    land: '#e08a4f', hi: '#ffd2a8', ink: '#2a1a10', accent: '#ffffff',
    dot: 1.8, alpha: 1,          // 点の大きさ（CSS px）と全体の濃さ
    back: 0,                     // 裏側の点の濃さ（0 で非表示）
    limb: 0.35, glow: 0.3,       // 輪郭線と大気の光
    dots: true, fine: false,     // fine: 日本付近を細かい点で描く
    grid: false, coast: false,
    cities: 'world',             // 'world' | 'japan' | 'none'
    arcs: false, spikes: false, shade: false, orbits: 0, stars: false, network: false
  };

  var WORLD = [
    [35.68, 139.69], [37.57, 126.98], [25.03, 121.56], [1.35, 103.82], [12.97, 77.59],
    [51.51, -0.13], [52.52, 13.40], [60.17, 24.94], [40.71, -74.01], [37.77, -122.42],
    [-33.87, 151.21], [-23.55, -46.63], [19.43, -99.13], [30.04, 31.24], [-1.29, 36.82]
  ];
  var JAPAN = [
    [35.68, 139.69], [43.06, 141.35], [40.82, 140.74], [38.27, 140.87], [37.90, 139.02],
    [36.56, 136.66], [35.18, 136.91], [34.69, 135.50], [34.39, 132.46], [33.56, 133.53],
    [33.59, 130.40], [31.60, 130.56], [26.21, 127.68]
  ];

  function unpack(flat) {
    var n = flat.length / 2, out = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var la = flat[i * 2] / 10 * RAD;
      out[i * 3] = Math.sin(la);
      out[i * 3 + 1] = Math.cos(la);
      out[i * 3 + 2] = flat[i * 2 + 1] / 10 * RAD;
    }
    return out;
  }

  function rgba(hex, a) {
    var v = parseInt(hex.slice(1), 16);
    return 'rgba(' + (v >> 16) + ',' + (v >> 8 & 255) + ',' + (v & 255) + ',' + a.toFixed(3) + ')';
  }

  // 球面上の2点間の大円を t∈[0,1] で補間（単位ベクトル）
  function vec(lat, lon) {
    var a = lat * RAD, b = lon * RAD;
    return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)];
  }
  function slerp(p, q, t) {
    var d = Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
    var s = Math.sin(d) || 1, a = Math.sin((1 - t) * d) / s, b = Math.sin(t * d) / s;
    return [a * p[0] + b * q[0], a * p[1] + b * q[1], a * p[2] + b * q[2]];
  }

  function Globe(canvas) {
    var cfg = {}, k, user = {};
    try { user = JSON.parse(canvas.getAttribute('data-globe') || '{}'); } catch (e) { /* 既定値で描画 */ }
    for (k in DEFAULTS) cfg[k] = k in user ? user[k] : DEFAULTS[k];
    this.cfg = cfg;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dots = unpack(cfg.fine && DATA.fine ? DATA.fine : DATA.dots);
    this.coast = cfg.coast && DATA.coast ? DATA.coast.map(unpack) : [];
    this.cities = cfg.cities === 'japan' ? JAPAN : cfg.cities === 'world' ? WORLD : [];
    this.routes = this.cities.slice(1).map(function (c, i) {
      return { p: vec(this.cities[0][0], this.cities[0][1]), q: vec(c[0], c[1]), off: i * .37 };
    }, this);
    // 棒グラフの柱を立てる地点（都市＋陸地からいくつか）
    this.bars = this.cities.slice();
    for (var i = 0; i < this.dots.length && this.bars.length < 40; i += 97) {
      this.bars.push([Math.asin(this.dots[i * 3]) / RAD, this.dots[i * 3 + 2] / RAD]);
    }
    this.stars = [];
    for (i = 0; i < 140; i++) this.stars.push([Math.random(), Math.random(), Math.random() * 1.2 + .3, Math.random() * 6]);
    this.resize();
  }

  Globe.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), r = this.canvas.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var c = this.cfg;
    this.R = c.rw ? this.w * c.rw : Math.min(this.w, this.h) * c.r;
    this.X = this.w * c.cx;
    this.Y = c.top !== null ? this.h * c.top + this.R : this.h * c.cy;
  };

  // 緯度経度（ラジアンの sin/cos とλ）を画面座標へ。z>0 が手前側
  Globe.prototype.setView = function (t) {
    var c = this.cfg;
    this.lon0 = (c.swing ? c.lon + c.swing * Math.sin(t * .25) : c.lon - c.speed * t) * RAD;
    this.s0 = Math.sin(c.lat * RAD);
    this.c0 = Math.cos(c.lat * RAD);
  };
  Globe.prototype.proj = function (sp, cp, lam, alt) {
    var d = lam - this.lon0, cd = Math.cos(d);
    return [cp * Math.sin(d) * alt, (this.c0 * sp - this.s0 * cp * cd) * alt, (this.s0 * sp + this.c0 * cp * cd) * alt];
  };
  Globe.prototype.projLL = function (lat, lon, alt) {
    var a = lat * RAD;
    return this.proj(Math.sin(a), Math.cos(a), lon * RAD, alt || 1);
  };
  Globe.prototype.projV = function (v, alt) {
    return this.proj(v[2], Math.sqrt(v[0] * v[0] + v[1] * v[1]), Math.atan2(v[1], v[0]), alt);
  };
  Globe.prototype.sx = function (p) { return this.X + p[0] * this.R; };
  Globe.prototype.sy = function (p) { return this.Y - p[1] * this.R; };

  Globe.prototype.light = function (p) {
    // 左上手前からの光
    return Math.max(0, p[0] * -.55 + p[1] * .42 + p[2] * .72);
  };

  Globe.prototype.draw = function (t) {
    var c = this.cfg, ctx = this.ctx, R = this.R, X = this.X, Y = this.Y, i, p, a;
    this.setView(t);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalAlpha = 1;

    if (c.stars) {
      for (i = 0; i < this.stars.length; i++) {
        var s = this.stars[i];
        ctx.fillStyle = rgba(c.hi, (.25 + .35 * Math.sin(t * 1.3 + s[3])) * c.alpha);
        ctx.fillRect(s[0] * this.w, s[1] * this.h, s[2], s[2]);
      }
    }
    if (c.glow) {
      var g = ctx.createRadialGradient(X, Y, R * .9, X, Y, R * 1.22);
      g.addColorStop(0, rgba(c.land, c.glow * c.alpha));
      g.addColorStop(1, rgba(c.land, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(X, Y, R * 1.22, 0, Math.PI * 2); ctx.fill();
    }
    // 海（不透明）と球体のハイライト
    ctx.fillStyle = c.ink;
    ctx.beginPath(); ctx.arc(X, Y, R, 0, Math.PI * 2); ctx.fill();
    var body = ctx.createRadialGradient(X - R * .35, Y - R * .4, 0, X, Y, R);
    body.addColorStop(0, rgba(c.land, .13 * c.alpha));
    body.addColorStop(1, rgba(c.land, 0));
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(X, Y, R, 0, Math.PI * 2); ctx.fill();

    if (c.grid) this.drawGrid();
    if (c.dots) this.drawDots(t);
    if (c.coast) this.drawCoast();
    if (c.limb) {
      ctx.strokeStyle = rgba(c.land, c.limb * c.alpha);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(X, Y, R, 0, Math.PI * 2); ctx.stroke();
    }
    if (c.network) this.drawNetwork(t);
    if (c.arcs) this.drawArcs(t);
    if (c.spikes) this.drawSpikes(t);
    if (this.cities.length) this.drawCities(t);
    if (c.orbits) this.drawOrbits(t);
  };

  Globe.prototype.drawDots = function () {
    var c = this.cfg, ctx = this.ctx, d = this.dots, n = d.length / 3, base = c.dot;
    var front = rgba(c.land, 1), backCol = rgba(c.land, 1);
    for (var i = 0; i < n; i++) {
      var p = this.proj(d[i * 3], d[i * 3 + 1], d[i * 3 + 2], 1), a;
      if (p[2] > 0) {
        a = .35 + .65 * p[2];
        if (c.shade) a *= .12 + .88 * this.light(p);
        ctx.globalAlpha = a * c.alpha;
        ctx.fillStyle = front;
        var rr = base * (.55 + .45 * p[2]);
        ctx.beginPath(); ctx.arc(this.sx(p), this.sy(p), rr, 0, Math.PI * 2); ctx.fill();
      } else if (c.back) {
        ctx.globalAlpha = c.back * c.alpha;
        ctx.fillStyle = backCol;
        ctx.fillRect(this.sx(p) - .6, this.sy(p) - .6, 1.2, 1.2);
      }
    }
    ctx.globalAlpha = 1;
  };

  Globe.prototype.polyline = function (pts) {
    // 手前側だけを結ぶ
    var ctx = this.ctx, on = false;
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p[2] > 0) {
        if (on) ctx.lineTo(this.sx(p), this.sy(p)); else ctx.moveTo(this.sx(p), this.sy(p));
        on = true;
      } else on = false;
    }
    ctx.stroke();
  };

  Globe.prototype.drawGrid = function () {
    var c = this.cfg, ctx = this.ctx, la, lo, pts;
    ctx.strokeStyle = rgba(c.land, .16 * c.alpha);
    ctx.lineWidth = .8;
    for (lo = -180; lo < 180; lo += 20) {
      pts = [];
      for (la = -90; la <= 90; la += 3) pts.push(this.projLL(la, lo));
      this.polyline(pts);
    }
    for (la = -60; la <= 60; la += 20) {
      pts = [];
      for (lo = -180; lo <= 180; lo += 3) pts.push(this.projLL(la, lo));
      this.polyline(pts);
    }
  };

  Globe.prototype.drawCoast = function () {
    var c = this.cfg, ctx = this.ctx;
    ctx.strokeStyle = rgba(c.hi, .85 * c.alpha);
    ctx.lineWidth = 1.1;
    ctx.lineJoin = 'round';
    for (var r = 0; r < this.coast.length; r++) {
      var ring = this.coast[r], pts = [];
      for (var i = 0; i < ring.length / 3; i++) pts.push(this.proj(ring[i * 3], ring[i * 3 + 1], ring[i * 3 + 2], 1));
      this.polyline(pts);
    }
  };

  Globe.prototype.drawCities = function (t) {
    var c = this.cfg, ctx = this.ctx;
    for (var i = 0; i < this.cities.length; i++) {
      var p = this.projLL(this.cities[i][0], this.cities[i][1]);
      if (p[2] <= .05) continue;
      var x = this.sx(p), y = this.sy(p), f = (t * .5 + i * .23) % 1, main = i === 0;
      ctx.strokeStyle = rgba(c.hi, (1 - f) * .9 * p[2] * c.alpha);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, (main ? 5 : 3) + f * (main ? 22 : 12), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = rgba(main ? c.accent : c.hi, p[2] * c.alpha);
      ctx.beginPath(); ctx.arc(x, y, main ? 4 : 2.6, 0, Math.PI * 2); ctx.fill();
    }
  };

  // 東京から各都市へ、宙に浮く大円の弧と、その上を進む光
  Globe.prototype.drawArcs = function (t) {
    var c = this.cfg, ctx = this.ctx;
    for (var r = 0; r < this.routes.length; r++) {
      var ro = this.routes[r], pts = [], N = 48;
      for (var i = 0; i <= N; i++) {
        var u = i / N;
        pts.push(this.projV(slerp(ro.p, ro.q, u), 1 + .22 * Math.sin(Math.PI * u)));
      }
      ctx.strokeStyle = rgba(c.land, .45 * c.alpha);
      ctx.lineWidth = 1;
      this.arcPath(pts, 0, N);
      var head = ((t * .32 + ro.off) % 1.6);
      if (head <= 1) {
        ctx.strokeStyle = rgba(c.hi, c.alpha);
        ctx.lineWidth = 2;
        this.arcPath(pts, Math.max(0, Math.floor((head - .18) * N)), Math.floor(head * N));
      }
    }
  };
  Globe.prototype.arcPath = function (pts, a, b) {
    var ctx = this.ctx, on = false;
    ctx.beginPath();
    for (var i = a; i <= b; i++) {
      var p = pts[i], vis = p[2] > 0 || p[0] * p[0] + p[1] * p[1] > 1;
      if (vis) {
        if (on) ctx.lineTo(this.sx(p), this.sy(p)); else ctx.moveTo(this.sx(p), this.sy(p));
        on = true;
      } else on = false;
    }
    ctx.stroke();
  };

  // 国内の都市同士を結ぶ地域ネットワーク
  Globe.prototype.drawNetwork = function (t) {
    var c = this.cfg, ctx = this.ctx, cs = this.cities;
    for (var i = 1; i < cs.length; i++) {
      var a = this.projLL(cs[i - 1][0], cs[i - 1][1]), b = this.projLL(cs[i][0], cs[i][1]), h = this.projLL(cs[0][0], cs[0][1]);
      if (a[2] <= 0 || b[2] <= 0) continue;
      ctx.strokeStyle = rgba(c.land, .55 * c.alpha);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.sx(a), this.sy(a)); ctx.lineTo(this.sx(b), this.sy(b)); ctx.stroke();
      ctx.strokeStyle = rgba(c.land, .25 * c.alpha);
      ctx.beginPath(); ctx.moveTo(this.sx(h), this.sy(h)); ctx.lineTo(this.sx(b), this.sy(b)); ctx.stroke();
      var f = (t * .4 + i * .19) % 1;
      ctx.fillStyle = rgba(c.hi, c.alpha);
      ctx.beginPath();
      ctx.arc(this.sx(h) + (this.sx(b) - this.sx(h)) * f, this.sy(h) + (this.sy(b) - this.sy(h)) * f, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // 地点ごとに伸び縮みする柱（データの量）
  Globe.prototype.drawSpikes = function (t) {
    var c = this.cfg, ctx = this.ctx;
    for (var i = 0; i < this.bars.length; i++) {
      var b = this.bars[i], base = this.projLL(b[0], b[1]);
      if (base[2] <= .05) continue;
      var h = .06 + .2 * (.5 + .5 * Math.sin(t * .9 + i * 1.7)) * (i < this.cities.length ? 1.4 : .8);
      var tip = this.projLL(b[0], b[1], 1 + h);
      var grad = ctx.createLinearGradient(this.sx(base), this.sy(base), this.sx(tip), this.sy(tip));
      grad.addColorStop(0, rgba(c.land, .2 * c.alpha));
      grad.addColorStop(1, rgba(c.hi, c.alpha));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(this.sx(base), this.sy(base)); ctx.lineTo(this.sx(tip), this.sy(tip)); ctx.stroke();
      ctx.fillStyle = rgba(c.accent, c.alpha);
      ctx.beginPath(); ctx.arc(this.sx(tip), this.sy(tip), 2.2, 0, Math.PI * 2); ctx.fill();
    }
  };

  // 傾いた軌道を周回する衛星。球の裏に回ると隠れる
  Globe.prototype.drawOrbits = function (t) {
    var c = this.cfg, ctx = this.ctx;
    for (var k = 0; k < c.orbits; k++) {
      var inc = (25 + k * 28) * RAD, node = k * 70 * RAD, alt = 1.18 + k * .1, N = 120, pts = [];
      for (var i = 0; i <= N; i++) pts.push(this.orbitPoint(i / N * Math.PI * 2, inc, node, alt));
      ctx.strokeStyle = rgba(c.hi, .28 * c.alpha);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      this.arcPath(pts, 0, N);
      ctx.setLineDash([]);
      for (var s = 0; s < 2; s++) {
        var p = this.orbitPoint(t * (.35 - k * .07) + s * Math.PI, inc, node, alt);
        if (!(p[2] > 0 || p[0] * p[0] + p[1] * p[1] > 1)) continue;
        ctx.fillStyle = rgba(c.accent, c.alpha);
        ctx.beginPath(); ctx.arc(this.sx(p), this.sy(p), 3.4, 0, Math.PI * 2); ctx.fill();
        var g = ctx.createRadialGradient(this.sx(p), this.sy(p), 0, this.sx(p), this.sy(p), 16);
        g.addColorStop(0, rgba(c.hi, .6 * c.alpha)); g.addColorStop(1, rgba(c.hi, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(this.sx(p), this.sy(p), 16, 0, Math.PI * 2); ctx.fill();
      }
    }
  };
  Globe.prototype.orbitPoint = function (a, inc, node, alt) {
    // 画面空間で軌道を定義（地球の自転とは独立）
    var x = Math.cos(a), y = Math.sin(a) * Math.sin(inc), z = Math.sin(a) * Math.cos(inc);
    var cn = Math.cos(node), sn = Math.sin(node);
    return [(x * cn - y * sn) * alt, (x * sn + y * cn) * alt, z * alt];
  };

  function start() {
    if (!DATA) return;
    var canvases = document.querySelectorAll('canvas.globe');
    Array.prototype.forEach.call(canvases, function (cv) {
      var g = new Globe(cv), t0 = performance.now(), running = true, raf = 0;
      cv.classList.add('is-ready');
      function frame(now) {
        g.draw((now - t0) / 1000);
        if (running && !reduce) raf = requestAnimationFrame(frame);
      }
      if ('ResizeObserver' in window) new ResizeObserver(function () { g.resize(); g.draw((performance.now() - t0) / 1000); }).observe(cv);
      if ('IntersectionObserver' in window && !reduce) {
        new IntersectionObserver(function (es) {
          running = es[0].isIntersecting;
          cancelAnimationFrame(raf);
          if (running) raf = requestAnimationFrame(frame);
        }).observe(cv);
      }
      raf = requestAnimationFrame(frame);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
