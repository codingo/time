/* bg.js — animated low-poly triangular background (no deps)  */
(() => {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ===== Simplex noise (public-domain, tiny) =====
  // Stefan Gustavson’s Simplex noise, trimmed for 2D use.
  // Source: https://weber.itn.liu.se/~stegu/simplexnoise/simplexnoise.pdf (public domain)
  class Simplex2D {
    constructor(seed = 0) {
      this.p = new Uint8Array(256);
      for (let i = 0; i < 256; i++) this.p[i] = i;
      // xorshift seed shuffle
      let x = (seed || Date.now()) >>> 0;
      for (let i = 255; i > 0; i--) {
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        const j = x % (i + 1);
        const t = this.p[i]; this.p[i] = this.p[j]; this.p[j] = t;
      }
      this.perm = new Uint8Array(512);
      for (let i = 0; i < 512; i++) this.perm[i] = this.p[i & 255];
    }
    noise(xin, yin) {
      const F2 = 0.5 * (Math.sqrt(3) - 1);
      const G2 = (3 - Math.sqrt(3)) / 6;
      let n0, n1, n2;
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s);
      const j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const X0 = i - t, Y0 = j - t;
      const x0 = xin - X0, y0 = yin - Y0;
      let i1, j1;
      if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      const gi0 = this.perm[ii + this.perm[jj]] % 12;
      const gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % 12;
      const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 12;
      const grad = (h, x, y) => {
        const u = h < 4 ? x : y;
        const v = h < 4 ? y : x;
        return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
      };
      let t0 = 0.5 - x0 * x0 - y0 * y0;
      n0 = t0 < 0 ? 0 : (t0 *= t0, t0 * t0 * grad(gi0, x0, y0));
      let t1 = 0.5 - x1 * x1 - y1 * y1;
      n1 = t1 < 0 ? 0 : (t1 *= t1, t1 * t1 * grad(gi1, x1, y1));
      let t2 = 0.5 - x2 * x2 - y2 * y2;
      n2 = t2 < 0 ? 0 : (t2 *= t2, t2 * t2 * grad(gi2, x2, y2));
      return 35 * (n0 + n1 + n2); // ~[-1, 1]
    }
  }

  // ===== Config =====
  const noise = new Simplex2D();
  const cfg = {
    cols: 22,          // number of columns of points
    rows: 12,          // number of rows of points
    jitter: 0.38,      // max fraction of cell size to offset vertices
    moveAmp: 0.33,     // how much vertices drift (fraction of cell)
    speed: 0.06,       // animation speed
    hueBase: 205,      // base hue (blue/teal)
    hueSwing: 90,      // hue swing around base
    sat: 70,           // saturation %
    light: 14,         // base lightness %
    lightSwing: 22,    // extra lightness from noise
    alpha: 0.85,       // triangle alpha
    fps: 48,           // fps cap for cpu sanity
    dprMax: 2          // clamp devicePixelRatio
  };

  // ===== Setup =====
  const c = document.createElement('canvas');
  c.id = 'bg-canvas';
  c.className = 'bg-canvas';
  document.body.prepend(c);
  const ctx = c.getContext('2d');
  let dpr = Math.min(cfg.dprMax, window.devicePixelRatio || 1);
  let W = 0, H = 0, grid = [], tris = [];

  function resize() {
    dpr = Math.min(cfg.dprMax, window.devicePixelRatio || 1);
    W = Math.floor(window.innerWidth * dpr);
    H = Math.floor(window.innerHeight * dpr);
    c.width = W; c.height = H;
    c.style.width = '100vw'; c.style.height = '100vh';
    buildGrid();
  }

  function buildGrid() {
    grid = [];
    const cw = W / (cfg.cols - 1);
    const ch = H / (cfg.rows - 1);
    for (let r = 0; r < cfg.rows; r++) {
      for (let col = 0; col < cfg.cols; col++) {
        const x = col * cw;
        const y = r * ch;
        const jx = (Math.random() * 2 - 1) * cfg.jitter * cw;
        const jy = (Math.random() * 2 - 1) * cfg.jitter * ch;
        grid.push({ x0: x + jx, y0: y + jy, i: col, j: r });
      }
    }
    tris = [];
    for (let r = 0; r < cfg.rows - 1; r++) {
      for (let col = 0; col < cfg.cols - 1; col++) {
        const idx = (r * cfg.cols) + col;
        const p00 = grid[idx];
        const p10 = grid[idx + 1];
        const p01 = grid[idx + cfg.cols];
        const p11 = grid[idx + cfg.cols + 1];
        const diag = ((r + col) & 1) === 0;
        if (diag) { tris.push([p00, p10, p11]); tris.push([p00, p11, p01]); }
        else { tris.push([p00, p10, p01]); tris.push([p10, p11, p01]); }
      }
    }
  }

  // ===== Draw loop =====
  let last = 0, acc = 0, step = 1000 / cfg.fps;
  function loop(ts) {
    if (prefersReduced) return; // honor user preference
    const dt = ts - last; last = ts; acc += dt;
    if (acc < step) { requestAnimationFrame(loop); return; }
    acc = 0;

    const t = ts * 0.001 * cfg.speed;
    ctx.clearRect(0, 0, W, H);

    // subtle vignette base
    const g = ctx.createRadialGradient(W * 0.55, H * 0.45, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    g.addColorStop(0, 'rgba(5,10,20,0.15)');
    g.addColorStop(1, 'rgba(5,10,20,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    for (const tri of tris) {
      // Move tri’s vertices smoothly with noise
      const pts = tri.map(p => {
        const cw = W / (cfg.cols - 1), ch = H / (cfg.rows - 1);
        const nx = p.x0 + cfg.moveAmp * cw * noise.noise(p.i * 0.22 + t, p.j * 0.18 + t);
        const ny = p.y0 + cfg.moveAmp * ch * noise.noise(p.i * 0.17 - t, p.j * 0.19 - t);
        return { x: nx, y: ny };
      });

      // Color: position + time → hue/lightness shifts
      const cx = (pts[0].x + pts[1].x + pts[2].x) / 3 / W;
      const cy = (pts[0].y + pts[1].y + pts[2].y) / 3 / H;
      const n = noise.noise(cx * 2 + t * 0.6, cy * 2 - t * 0.6);
      const hue = (cfg.hueBase + cfg.hueSwing * n) % 360;
      const light = Math.max(8, Math.min(60, cfg.light + cfg.lightSwing * (n * 0.6 + 0.4)));
      ctx.fillStyle = `hsla(${hue}, ${cfg.sat}%, ${light}%, ${cfg.alpha})`;

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.lineTo(pts[2].x, pts[2].y);
      ctx.closePath();
      ctx.fill();
    }
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', resize, { passive: true });
  resize();
  requestAnimationFrame(loop);
})();
