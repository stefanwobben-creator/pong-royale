/* =====================================================================
   PONG ROYALE - rendering, effects, sound
   Exposes: window.GFX, window.SFX
   ===================================================================== */

/* ---------------------------------------------------------------- SOUND */
const SFX = (() => {
  let ctx = null, on = true, master = null;

  function boot() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(ctx.destination);
  }

  function blip(freq, dur, type = 'square', vol = 1, slide = 0) {
    if (!on || !ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol = 0.5) {
    if (!on || !ctx) return;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
    const s = ctx.createBufferSource(); s.buffer = buf;
    const g = ctx.createGain(); g.gain.value = vol;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600;
    s.connect(f); f.connect(g); g.connect(master);
    s.start();
  }

  return {
    boot,
    toggle() { on = !on; if (on) boot(); return on; },
    isOn() { return on; },
    hit(speed = 1) { blip(280 + speed * 190, 0.06, 'square', 0.5); },
    wall() { blip(150, 0.05, 'triangle', 0.3); },
    goal() { blip(220, 0.35, 'sawtooth', 0.5, 0.25); noise(0.25, 0.35); },
    elim() { blip(90, 0.7, 'sawtooth', 0.6, 0.3); noise(0.6, 0.5); },
    cheer() { blip(700 + Math.random() * 500, 0.06, 'sine', 0.25); },
    super() {
      [520, 660, 880, 1180].forEach((f, i) => setTimeout(() => blip(f, 0.18, 'square', 0.4), i * 70));
    },
    count(n) { blip(n === 0 ? 880 : 440, n === 0 ? 0.3 : 0.12, 'square', 0.4); },
    fanfare() {
      const notes = [523, 659, 784, 1046, 784, 1046, 1318];
      notes.forEach((f, i) => setTimeout(() => blip(f, 0.35, 'square', 0.45), i * 130));
      setTimeout(() => noise(1.2, 0.4), 900);
    },
  };
})();

/* ---------------------------------------------------------------- GFX */
const GFX = (() => {
  const S = {
    canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
    arena: null, players: new Map(), order: [],
    lives: 3, paddleHalf: .105, paddleHalfSuper: .165, ballRadius: .03,
    snap: null, prev: null, snapAt: 0,
    meId: null, viewSeat: 0,
    localPaddle: .5, localTarget: .5,
    trails: new Map(), parts: [], rings: [], shake: 0, flash: 0, flashColor: '#fff',
    scale: 1, cx: 0, cy: 0, rot: 0,
    running: false, t0: performance.now(), lastFrame: 0,
    lowQ: false, slow: 0, fast: 0, frames: 0, spect: false,
    stars: [],
  };

  /* ---------- setup ---------- */

  function initBoard(canvas) {
    S.canvas = canvas;
    S.ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 200));
    if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(canvas);
  }

  function resize() {
    if (!S.canvas) return;
    const w = S.canvas.clientWidth, h = S.canvas.clientHeight;
    if (w < 2 || h < 2) {
      // scherm staat nog op display:none -> later opnieuw proberen
      if (!S.resizePending) {
        S.resizePending = true;
        requestAnimationFrame(() => { S.resizePending = false; resize(); });
      }
      return;
    }
    S.dpr = S.lowQ ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    S.W = w; S.H = h;
    S.canvas.width = Math.round(S.W * S.dpr);
    S.canvas.height = Math.round(S.H * S.dpr);
    // ruimte reserveren voor de HUD boven en de hype-balk of het supporterpaneel onder,
    // daarna de arena zo groot maken dat naamlabels er nog naast passen
    const top = 56;
    const bottom = S.spect ? Math.min(360, S.H * 0.42) : 64;
    const usable = Math.max(90, S.H - top - bottom);
    S.scale = Math.max(40, Math.min((S.W / 2 - 20) / 1.15, (usable / 2 - 20) / 1.15));
    S.cx = S.W / 2;
    S.cy = top + usable / 2;
    if (S.stars.length === 0) {
      for (let i = 0; i < 70; i++) {
        S.stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + .3, p: Math.random() * 6.28 });
      }
    }
  }

  function setup(msg, meId) {
    S.arena = msg.arena;
    S.lives = msg.lives;
    S.paddleHalf = msg.paddleHalf;
    S.paddleHalfSuper = msg.paddleHalfSuper;
    S.ballRadius = msg.ballRadius;
    S.meId = meId;
    S.players = new Map();
    S.order = [];
    msg.players.forEach((p) => {
      S.players.set(p.id, { ...p, paddle: .5, lives: msg.lives, hype: 0, super: 0, alive: true, supporting: '' });
      S.order.push(p.id);
    });
    const me = S.players.get(meId);
    S.viewSeat = me ? me.seat : 0;
    applyView();
    S.trails.clear(); S.parts.length = 0; S.rings.length = 0;
    S.localPaddle = .5; S.localTarget = .5;
    S.spect = false;
    resize();
  }

  function applyView() {
    const e = S.arena && S.arena.edges.find((x) => x.i === S.viewSeat);
    S.rot = e ? Math.PI / 2 - e.phi : 0;
  }

  function setSpectator(on) { S.spect = !!on; resize(); }

  function setViewSeat(seat) {
    if (seat == null || seat < 0) return;
    S.viewSeat = seat;
    applyView();
  }

  /* ---------- state ---------- */

  function update(msg) {
    if (msg.hf) S.paddleHalf = msg.hf;
    if (msg.hs) S.paddleHalfSuper = msg.hs;
    S.prev = S.snap;
    S.snap = msg;
    S.snapAt = performance.now();
    msg.p.forEach((row) => {
      const p = S.players.get(row[0]);
      if (!p) return;
      p.paddle = row[1]; p.lives = row[2]; p.hype = row[3];
      p.super = row[4]; p.alive = !!row[5]; p.connected = !!row[6];
      p.supporting = row[7];
    });
  }

  function setLocalTarget(t) { S.localTarget = Math.max(0, Math.min(1, t)); }
  function getLocalTarget() { return S.localTarget; }

  /* ---------- coordinate helpers ---------- */

  function worldOfScreen(sx, sy) {
    const dx = (sx - S.cx) / S.scale;
    const dy = (sy - S.cy) / S.scale;
    const c = Math.cos(-S.rot), s = Math.sin(-S.rot);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  /** map a touch/mouse point to a position along my own wall (0..1) */
  function paddleParamFromScreen(sx, sy) {
    if (!S.arena) return .5;
    const e = S.arena.edges.find((x) => x.i === S.viewSeat);
    if (!e) return .5;
    const w = worldOfScreen(sx, sy);
    const ex = e.bx - e.ax, ey = e.by - e.ay;
    const len2 = ex * ex + ey * ey;
    const t = ((w.x - e.ax) * ex + (w.y - e.ay) * ey) / len2;
    return Math.max(0, Math.min(1, t));
  }

  function edgePoint(e, t) {
    return { x: e.ax + (e.bx - e.ax) * t, y: e.ay + (e.by - e.ay) * t };
  }

  /* ---------- effects ---------- */

  function burst(x, y, color, n = 18, power = .55) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.15 + Math.random() * power);
      S.parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, decay: 1.4 + Math.random(), color, size: 1.5 + Math.random() * 3,
      });
    }
  }

  function ring(x, y, color, max = .5, speed = 1.6) {
    S.rings.push({ x, y, r: .02, max, speed, color, life: 1 });
  }

  function riser(x, y, color) {
    S.parts.push({
      x, y, vx: (Math.random() - .5) * .12, vy: -.35 - Math.random() * .25,
      life: 1, decay: .9, color, size: 2 + Math.random() * 2.5, star: true,
    });
  }

  function handleEvents(list, onBig) {
    if (!list) return;
    for (const ev of list) {
      const p = S.players.get(ev.p);
      const col = p ? p.color : '#fff';
      if (ev.k === 'hit') {
        burst(ev.x, ev.y, col, 10, .4);
        ring(ev.x, ev.y, col, .28, 2.2);
        SFX.hit(ev.s || 1);
      } else if (ev.k === 'goal') {
        burst(ev.x, ev.y, col, 34, .9);
        ring(ev.x, ev.y, col, .9, 1.5);
        S.shake = Math.max(S.shake, 14);
        S.flash = .5; S.flashColor = col;
        SFX.goal();
        if (onBig && p) onBig(ev.p === S.meId ? 'GERAAKT!' : p.name + ' verliest een leven', col);
      } else if (ev.k === 'elim') {
        shatterWall(ev.p);
        S.shake = Math.max(S.shake, 22);
        SFX.elim();
        if (onBig && p) onBig(p.name.toUpperCase() + ' LIGT ERUIT', col);
      } else if (ev.k === 'cheer') {
        const e = p && S.arena ? S.arena.edges.find((x) => x.owner === ev.p) : null;
        if (e) { const q = edgePoint(e, .2 + Math.random() * .6); riser(q.x * .82, q.y * .82, col); }
        SFX.cheer();
      } else if (ev.k === 'super') {
        const e = p && S.arena ? S.arena.edges.find((x) => x.owner === ev.p) : null;
        if (e) { const q = edgePoint(e, .5); burst(q.x * .9, q.y * .9, col, 40, 1.0); ring(q.x * .9, q.y * .9, col, 1.4, 1.8); }
        SFX.super();
        if (onBig && p) onBig(p.name.toUpperCase() + ' IS SUPERCHARGED', col);
      } else if (ev.k === 'newball') {
        ring(0, 0, '#ffffff', 1.2, 2.4);
      }
    }
  }

  function shatterWall(pid) {
    const e = S.arena && S.arena.edges.find((x) => x.owner === pid);
    const p = S.players.get(pid);
    if (!e || !p) return;
    for (let i = 0; i <= 22; i++) {
      const q = edgePoint(e, i / 22);
      S.parts.push({
        x: q.x, y: q.y,
        vx: e.nx * (.2 + Math.random() * .5) + (Math.random() - .5) * .2,
        vy: e.ny * (.2 + Math.random() * .5) + (Math.random() - .5) * .2,
        life: 1, decay: .55, color: p.color, size: 3 + Math.random() * 3,
      });
    }
    ring((e.ax + e.bx) / 2, (e.ay + e.by) / 2, p.color, 1.3, 1.3);
  }

  function stepEffects(dt) {
    for (let i = S.parts.length - 1; i >= 0; i--) {
      const q = S.parts[i];
      q.x += q.vx * dt; q.y += q.vy * dt;
      if (!q.star) { q.vx *= .985; q.vy *= .985; }
      q.life -= q.decay * dt;
      if (q.life <= 0) S.parts.splice(i, 1);
    }
    for (let i = S.rings.length - 1; i >= 0; i--) {
      const r = S.rings[i];
      r.r += r.speed * dt;
      r.life = 1 - r.r / r.max;
      if (r.life <= 0) S.rings.splice(i, 1);
    }
    S.shake *= Math.pow(.0025, dt);
    S.flash = Math.max(0, S.flash - dt * 1.8);
  }

  /* ---------- drawing ---------- */

  function drawBackground(ctx, time) {
    const g = ctx.createRadialGradient(S.cx, S.cy, 0, S.cx, S.cy, Math.max(S.W, S.H) * .75);
    g.addColorStop(0, '#0d1230');
    g.addColorStop(.55, '#070a1a');
    g.addColorStop(1, '#03040c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S.W, S.H);

    ctx.save();
    for (const st of S.stars) {
      const a = .25 + .55 * (0.5 + 0.5 * Math.sin(time * .0016 + st.p));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#9fd8ff';
      ctx.beginPath();
      ctx.arc(st.x * S.W, st.y * S.H, st.r, 0, 6.284);
      ctx.fill();
    }
    ctx.restore();
  }

  function polygonPath(ctx, r) {
    const es = S.arena.edges;
    ctx.beginPath();
    es.forEach((e, i) => {
      const x = e.ax * r, y = e.ay * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }

  function drawFloor(ctx, time) {
    ctx.save();
    polygonPath(ctx, 1);
    ctx.clip();

    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.1);
    g.addColorStop(0, 'rgba(40,80,180,.45)');
    g.addColorStop(.7, 'rgba(16,26,66,.55)');
    g.addColorStop(1, 'rgba(6,10,30,.7)');
    ctx.fillStyle = g;
    ctx.fillRect(-1.5, -1.5, 3, 3);

    ctx.lineWidth = .004;
    ctx.strokeStyle = 'rgba(120,180,255,.20)';
    if (S.lowQ) { ctx.restore(); return; }
    const step = .18;
    const off = ((time * .00004) % step);
    for (let v = -1.6; v <= 1.6; v += step) {
      ctx.beginPath(); ctx.moveTo(v + off, -1.6); ctx.lineTo(v + off, 1.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-1.6, v + off); ctx.lineTo(1.6, v + off); ctx.stroke();
    }

    // slow rotating sweep
    ctx.save();
    ctx.rotate(time * .00018);
    const sg = ctx.createLinearGradient(0, 0, 1.4, 0);
    sg.addColorStop(0, 'rgba(0,229,255,.10)');
    sg.addColorStop(1, 'rgba(0,229,255,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 1.5, -.35, .35); ctx.closePath(); ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  function drawWalls(ctx, time) {
    const now = performance.now();
    for (const e of S.arena.edges) {
      const owner = e.owner ? S.players.get(e.owner) : null;
      const live = owner && owner.alive;

      ctx.lineCap = 'round';
      if (!live) {
        // solid wall
        ctx.strokeStyle = owner ? 'rgba(120,130,160,.55)' : 'rgba(150,165,200,.45)';
        ctx.lineWidth = .038;
        ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.moveTo(e.ax, e.ay); ctx.lineTo(e.bx, e.by); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.10)';
        ctx.lineWidth = .012;
        ctx.beginPath(); ctx.moveTo(e.ax, e.ay); ctx.lineTo(e.bx, e.by); ctx.stroke();
        continue;
      }

      // open goal line: faint, in the owner colour
      ctx.strokeStyle = hexA(owner.color, .18);
      ctx.lineWidth = .012;
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.moveTo(e.ax, e.ay); ctx.lineTo(e.bx, e.by); ctx.stroke();

      // paddle
      const isMe = owner.id === S.meId;
      const superOn = owner.super > 0;
      const half = superOn ? S.paddleHalfSuper : S.paddleHalf;
      const pos = isMe ? S.localPaddle : owner.paddle;
      const a = edgePoint(e, Math.max(0, pos - half));
      const b = edgePoint(e, Math.min(1, pos + half));

      const pulse = superOn ? 1 + .18 * Math.sin(time * .018) : 1;
      // layered strokes fake the glow far cheaper than shadowBlur
      ctx.globalCompositeOperation = 'lighter';
      const w = (superOn ? .052 : .034) * pulse;
      const layers = superOn ? [[4.2, .12], [2.6, .18], [1.6, .3]] : [[3.2, .10], [2.0, .16]];
      for (const [k, alpha] of layers) {
        ctx.strokeStyle = hexA(owner.color, alpha);
        ctx.lineWidth = w * k;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = owner.color;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = .010;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

      if (isMe) {
        ctx.strokeStyle = hexA('#ffffff', .35);
        ctx.lineWidth = .006;
        const m = edgePoint(e, pos);
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - e.nx * .10, m.y - e.ny * .10);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
  }

  function drawLabels(ctx) {
    for (const e of S.arena.edges) {
      const owner = e.owner ? S.players.get(e.owner) : null;
      if (!owner) continue;
      const mid = edgePoint(e, .5);
      const px = mid.x + e.nx * .13, py = mid.y + e.ny * .13;

      let ang = Math.atan2(e.by - e.ay, e.bx - e.ax) + S.rot;
      ang = Math.atan2(Math.sin(ang), Math.cos(ang));
      let flip = 0;
      if (Math.abs(ang) > Math.PI / 2) flip = Math.PI;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.atan2(e.by - e.ay, e.bx - e.ax) + flip);
      ctx.scale(1 / S.scale, 1 / S.scale);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const dead = !owner.alive;
      ctx.globalAlpha = dead ? .35 : 1;
      ctx.font = '700 13px Rajdhani, sans-serif';
      ctx.fillStyle = owner.id === S.meId ? '#ffffff' : owner.color;
      ctx.fillText(owner.name + (owner.id === S.meId ? ' (jij)' : ''), 0, -9);

      // lives pips
      const n = S.lives, r = 3.2, gap = 10;
      const startX = -((n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc(startX + i * gap, 7, r, 0, 6.284);
        ctx.fillStyle = i < owner.lives ? owner.color : 'rgba(255,255,255,.15)';
        ctx.fill();
      }

      // hype meter
      if (!dead && owner.hype > 0) {
        ctx.fillStyle = 'rgba(255,255,255,.14)';
        ctx.fillRect(-22, 14, 44, 3);
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(-22, 14, 44 * (owner.hype / 100), 3);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  function ballPositions(now) {
    if (!S.snap) return [];
    const dt = Math.min(.16, (now - S.snapAt) / 1000);
    return S.snap.b.map((b) => ({
      x: b[0] + b[2] * dt,
      y: b[1] + b[3] * dt,
      vx: b[2], vy: b[3],
      dead: b[4] === 1,
    }));
  }

  function drawBalls(ctx, now) {
    const balls = ballPositions(now);
    balls.forEach((b, idx) => {
      let tr = S.trails.get(idx);
      if (!tr) { tr = []; S.trails.set(idx, tr); }
      tr.push({ x: b.x, y: b.y });
      if (tr.length > (S.lowQ ? 8 : 16)) tr.shift();

      for (let i = 0; i < tr.length; i++) {
        const a = (i / tr.length) ** 2 * (b.dead ? .25 : .55);
        ctx.beginPath();
        ctx.arc(tr[i].x, tr[i].y, S.ballRadius * (.35 + .65 * i / tr.length), 0, 6.284);
        ctx.fillStyle = `rgba(140,230,255,${a})`;
        ctx.fill();
      }

      ctx.save();
      ctx.globalAlpha = b.dead ? .4 : 1;
      // halo out of stacked circles instead of an expensive blur
      ctx.globalCompositeOperation = 'lighter';
      for (const [k, alpha] of [[3.4, .09], [2.2, .14], [1.5, .22]]) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, S.ballRadius * k, 0, 6.284);
        ctx.fillStyle = `rgba(120,220,255,${alpha})`;
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.arc(b.x, b.y, S.ballRadius, 0, 6.284);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(b.x - S.ballRadius * .3, b.y - S.ballRadius * .3, S.ballRadius * .35, 0, 6.284);
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.fill();
      ctx.restore();
    });
    for (const k of [...S.trails.keys()]) if (k >= balls.length) S.trails.delete(k);
  }

  function drawParticles(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    for (const q of S.parts) {
      ctx.globalAlpha = Math.max(0, q.life);
      ctx.fillStyle = q.color;
      const s = q.size / S.scale;
      if (q.star) {
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + i * 2.513;
          ctx.lineTo(q.x + Math.cos(a) * s * 1.6, q.y + Math.sin(a) * s * 1.6);
          ctx.lineTo(q.x + Math.cos(a + 1.256) * s * .7, q.y + Math.sin(a + 1.256) * s * .7);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    for (const r of S.rings) {
      ctx.globalAlpha = Math.max(0, r.life) * .7;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = .012;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 6.284); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /* ---------- main loop ---------- */

  let bigCb = null;
  function onAnnounce(cb) { bigCb = cb; }

  function frame(now) {
    if (!S.running) return;
    requestAnimationFrame(frame);
    S.frames++;
    const dt = Math.min(.05, (now - (S.lastFrame || now)) / 1000);
    S.lastFrame = now;

    // adaptive quality
    if (!S.lowQ) {
      if (dt > .028) S.slow++; else S.slow = Math.max(0, S.slow - 1);
      if (S.slow > 45) { S.lowQ = true; S.slow = 0; resize(); }
    }

    const ctx = S.ctx;
    if (!ctx) return;
    if (S.frames % 30 === 0 &&
        (S.W !== S.canvas.clientWidth || S.H !== S.canvas.clientHeight)) resize();
    if (S.W < 2 || S.H < 2) return;
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    drawBackground(ctx, now);
    if (!S.arena) return;

    // local paddle prediction
    const me = S.players.get(S.meId);
    const superOn = me && me.super > 0;
    const half = superOn ? S.paddleHalfSuper : S.paddleHalf;
    const spd = superOn ? 2.4 : 1.7;
    const tgt = Math.max(half, Math.min(1 - half, S.localTarget));
    const d = tgt - S.localPaddle;
    const step = spd * dt;
    S.localPaddle += Math.abs(d) <= step ? d : Math.sign(d) * step;
    if (me && !me.alive) S.localPaddle = me.paddle;

    stepEffects(dt);

    const sh = S.shake;
    ctx.save();
    if (sh > .3) ctx.translate((Math.random() - .5) * sh, (Math.random() - .5) * sh);
    ctx.translate(S.cx, S.cy);
    ctx.rotate(S.rot);
    ctx.scale(S.scale, S.scale);

    drawFloor(ctx, now);

    // arena rim
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(70,130,220,.16)';
    ctx.lineWidth = .028;
    polygonPath(ctx, 1);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(150,205,255,.40)';
    ctx.lineWidth = .008;
    polygonPath(ctx, 1);
    ctx.stroke();
    ctx.restore();

    drawWalls(ctx, now);
    drawBalls(ctx, now);
    drawParticles(ctx);
    drawLabels(ctx);

    ctx.restore();

    if (S.flash > 0) {
      ctx.fillStyle = hexA(S.flashColor, S.flash * .35);
      ctx.fillRect(0, 0, S.W, S.H);
    }

    // vignette
    const vg = ctx.createRadialGradient(S.cx, S.cy, Math.min(S.W, S.H) * .3, S.cx, S.cy, Math.max(S.W, S.H) * .75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.6)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, S.W, S.H);
  }

  function start() { if (S.running) return; S.running = true; S.lastFrame = performance.now(); requestAnimationFrame(frame); }
  function stop() { S.running = false; }

  return {
    initBoard, setup, update, start, stop, resize,
    setLocalTarget, getLocalTarget, paddleParamFromScreen, setSpectator,
    handleEvents: (l) => handleEvents(l, bigCb), onAnnounce,
    setViewSeat,
    players: () => S.players,
    state: () => S,
    hexA,
  };
})();

/* ------------------------------------------------- MENU BACKGROUND FX */
(() => {
  const cv = document.getElementById('fx');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const dots = [];

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  size();
  window.addEventListener('resize', size);

  for (let i = 0; i < 44; i++) {
    dots.push({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - .5) * .00006, vy: (Math.random() - .5) * .00006,
      r: Math.random() * 2 + .6,
      c: Math.random() < .5 ? '0,229,255' : '255,45,149',
    });
  }

  function loop(t) {
    requestAnimationFrame(loop);
    // never burn frames while the menu background is hidden (during play)
    if (cv.style.display === 'none' || document.hidden) return;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const d of dots) {
      d.x += d.vx * 16; d.y += d.vy * 16;
      if (d.x < 0) d.x = 1; if (d.x > 1) d.x = 0;
      if (d.y < 0) d.y = 1; if (d.y > 1) d.y = 0;
      const a = .18 + .15 * Math.sin(t * .001 + d.x * 10);
      ctx.beginPath();
      ctx.arc(d.x * W, d.y * H, d.r, 0, 6.284);
      ctx.fillStyle = `rgba(${d.c},${a})`;
      ctx.fill();
      ctx.globalAlpha = a * .25;
      ctx.beginPath();
      ctx.arc(d.x * W, d.y * H, d.r * 4, 0, 6.284);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
  }
  requestAnimationFrame(loop);
})();

/* ------------------------------------------------------ CEREMONY VIEW */
const CEREMONY = (() => {
  let cv, ctx, W, H, dpr, running = false, t0 = 0;
  let confetti = [], sparks = [], color = '#00e5ff', colors = ['#00e5ff'];

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawnConfetti(n) {
    for (let i = 0; i < n; i++) {
      confetti.push({
        x: Math.random() * W, y: -20 - Math.random() * H * .6,
        vx: (Math.random() - .5) * 60, vy: 90 + Math.random() * 190,
        w: 5 + Math.random() * 7, h: 8 + Math.random() * 12,
        rot: Math.random() * 6.28, vr: (Math.random() - .5) * 8,
        c: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  function start(canvas, winnerColor, palette) {
    cv = canvas; ctx = cv.getContext('2d');
    color = winnerColor || '#00e5ff';
    colors = (palette && palette.length ? palette : ['#00e5ff', '#ff2d95', '#ffd23f', '#7cff4f']).concat(['#ffffff']);
    size();
    window.addEventListener('resize', size);
    confetti = []; sparks = [];
    spawnConfetti(160);
    running = true; t0 = performance.now();
    requestAnimationFrame(loop);
  }
  function stop() { running = false; }

  function crown(cx, cy, s, t) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.rotate(Math.sin(t * .0011) * .06);
    ctx.beginPath();
    ctx.moveTo(-30, 14);
    ctx.lineTo(-36, -18);
    ctx.lineTo(-15, -2);
    ctx.lineTo(0, -26);
    ctx.lineTo(15, -2);
    ctx.lineTo(36, -18);
    ctx.lineTo(30, 14);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -26, 0, 16);
    g.addColorStop(0, '#fff3b0');
    g.addColorStop(.5, '#ffd23f');
    g.addColorStop(1, '#ff9f1c');
    ctx.fillStyle = g;
    ctx.shadowColor = '#ffd23f';
    ctx.shadowBlur = 30;
    ctx.fill();
    ctx.restore();
  }

  function loop(now) {
    if (!running) return;
    requestAnimationFrame(loop);
    const t = now - t0;
    const dt = 1 / 60;

    const oy = H * .12;                       // rays come from above the title
    const g = ctx.createRadialGradient(W / 2, oy, 0, W / 2, oy, Math.max(W, H) * .9);
    g.addColorStop(0, GFX.hexA(color, .22));
    g.addColorStop(.45, 'rgba(8,10,26,.96)');
    g.addColorStop(1, '#03040c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // rotating light rays
    ctx.save();
    ctx.translate(W / 2, oy);
    ctx.rotate(t * .00022);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI * 2 / 12);
      const rg = ctx.createLinearGradient(0, 0, Math.max(W, H), 0);
      rg.addColorStop(0, GFX.hexA(color, .10));
      rg.addColorStop(1, GFX.hexA(color, 0));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, Math.max(W, H), -.05, .05);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';

    crown(W / 2, H * .135, Math.min(W, H) / 520 + .45, t);

    // confetti
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt;
      c.vx *= .995;
      if (c.y > H + 40) { confetti.splice(i, 1); continue; }
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.c;
      ctx.globalAlpha = .9;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h * (0.4 + 0.6 * Math.abs(Math.cos(c.rot))));
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (confetti.length < 90 && t < 20000) spawnConfetti(28);

    // sparkles
    if (Math.random() < .35) {
      sparks.push({ x: Math.random() * W, y: H * (.15 + Math.random() * .5), life: 1, s: 2 + Math.random() * 3 });
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt * 1.1;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = s.life;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.s * s.life, 0, 6.284); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }

  return { start, stop };
})();

window.GFX = GFX;
window.SFX = SFX;
window.CEREMONY = CEREMONY;
