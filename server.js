/**
 * PONG ROYALE - authoritative game server
 *
 * - HTTP serves ./public
 * - WebSocket handles rooms, lobby and the game simulation
 * - All physics run here at 60Hz; clients only render + send paddle input
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

const CFG = {
  minPlayers: 2,
  maxPlayers: 8,
  lives: 3,
  tickHz: 60,
  netHz: 30,
  ballRadius: 0.030,
  ballSpeed: 0.95,        // world units / sec (arena circumradius = 1)
  ballSpeedMax: 2.8,
  ballSpeedGain: 1.045,   // per paddle hit
  paddleHalf: 0.105,      // fraction of the wall, each side of centre
  paddleHalfSuper: 0.165,
  paddleHalfMin: 0.042,    // paddles shrink late in a round so nothing stalls
  shrinkStart: 40,         // sec
  shrinkPerSec: 0.0007,
  paddleSpeed: 1.7,       // wall-fractions per second
  paddleSpeedSuper: 2.4,
  respawnDelay: 0.8,      // sec after a goal before a new ball appears
  maxBalls: 3,
  extraBallAt: 25,        // sec into the round
  hypePerCheer: 4,
  hypeDecay: 9,           // per second
  superDuration: 5.0,
  superCooldown: 12000,   // ms before the same player can be supercharged again
  rampStart: 20,          // sec, after this the ball floor speed creeps up
  rampPerSec: 0.018,
  cheerCooldown: 350,     // ms per supporter
  countdown: 3,
  roomTTL: 30 * 60 * 1000,
};

const COLORS = [
  { hex: '#00e5ff', name: 'Cyaan' },
  { hex: '#ff2d95', name: 'Magenta' },
  { hex: '#7cff4f', name: 'Lime' },
  { hex: '#ffd23f', name: 'Goud' },
  { hex: '#a06bff', name: 'Violet' },
  { hex: '#ff7a29', name: 'Oranje' },
  { hex: '#38ffc7', name: 'Mint' },
  { hex: '#ff5c5c', name: 'Rood' },
];

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const rid = (n = 8) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');

const r3 = (v) => Math.round(v * 1000) / 1000;

function cleanName(raw) {
  let s = String(raw == null ? '' : raw)
    .replace(new RegExp(String.fromCharCode(60)+'|'+String.fromCharCode(62),'g'), '')
    .replace(/[^\p{L}\p{N}\p{Emoji_Presentation} _.!?-]/gu, '')
    .trim()
    .slice(0, 12);
  if (!s) s = 'Speler';
  return s;
}

function newCode(rooms) {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

/* ------------------------------------------------------------------ */
/* Room                                                                */
/* ------------------------------------------------------------------ */

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();   // id -> player
    this.order = [];            // join order of ids
    this.hostId = null;
    this.phase = 'lobby';       // lobby | countdown | playing | over
    this.arena = null;
    this.balls = [];
    this.eliminationOrder = [];
    this.roundTime = 0;
    this.countdownLeft = 0;
    this.respawnTimer = 0;
    this.extraBallDone = false;
    this.timer = null;
    this.lastTick = 0;
    this.netAcc = 0;
    this.events = [];
    this.result = null;
    this.touched = Date.now();
  }

  /* ---------------- players ---------------- */

  addPlayer(ws, name) {
    if (this.players.size >= CFG.maxPlayers) return null;
    const used = new Set([...this.players.values()].map((p) => p.colorIdx));
    let colorIdx = 0;
    while (used.has(colorIdx) && colorIdx < COLORS.length - 1) colorIdx++;
    const p = {
      id: rid(6),
      token: rid(16),
      name: cleanName(name),
      colorIdx,
      ws,
      connected: true,
      ready: false,
      seat: -1,
      lives: CFG.lives,
      alive: false,
      paddle: 0.5,
      target: 0.5,
      hype: 0,
      superUntil: 0,
      supporting: null,
      lastCheer: 0,
      stats: { saves: 0, against: 0, cheers: 0, supers: 0, topSpeed: 0 },
    };
    this.players.set(p.id, p);
    this.order.push(p.id);
    if (!this.hostId) this.hostId = p.id;
    return p;
  }

  removePlayer(id) {
    this.players.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (this.hostId === id) this.hostId = this.order[0] || null;
  }

  list() {
    return this.order
      .map((id) => this.players.get(id))
      .filter(Boolean);
  }

  alivePlayers() {
    return this.list().filter((p) => p.alive);
  }

  /* ---------------- messaging ---------------- */

  send(p, msg) {
    if (p.ws && p.ws.readyState === 1) {
      try { p.ws.send(JSON.stringify(msg)); } catch (_) {}
    }
  }

  broadcast(msg) {
    const raw = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.ws && p.ws.readyState === 1) {
        try { p.ws.send(raw); } catch (_) {}
      }
    }
  }

  lobbyPayload() {
    return {
      t: 'lobby',
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      minPlayers: CFG.minPlayers,
      maxPlayers: CFG.maxPlayers,
      players: this.list().map((p) => ({
        id: p.id,
        name: p.name,
        color: COLORS[p.colorIdx].hex,
        connected: p.connected,
        host: p.id === this.hostId,
      })),
    };
  }

  pushLobby() {
    this.broadcast(this.lobbyPayload());
  }

  /* ---------------- arena ---------------- */

  buildArena() {
    const players = this.list().filter((p) => p.connected);
    const n = players.length;
    const sides = n === 2 ? 4 : n;
    const R = 1;
    const apothem = R * Math.cos(Math.PI / sides);
    const edgeLen = 2 * R * Math.sin(Math.PI / sides);
    const edges = [];

    for (let i = 0; i < sides; i++) {
      const phi = -Math.PI / 2 + (i * 2 * Math.PI) / sides; // outward normal angle
      const nx = Math.cos(phi), ny = Math.sin(phi);
      const a1 = phi - Math.PI / sides;
      const a2 = phi + Math.PI / sides;
      const ax = R * Math.cos(a1), ay = R * Math.sin(a1);
      const bx = R * Math.cos(a2), by = R * Math.sin(a2);
      edges.push({
        i, nx, ny, ax, ay, bx, by,
        dx: (bx - ax) / edgeLen,
        dy: (by - ay) / edgeLen,
        len: edgeLen,
        phi,
        owner: null,
      });
    }

    // seat players on edges, spread evenly around the polygon
    const seatIdx = n === 2 ? [0, 2] : players.map((_, i) => i);
    players.forEach((p, i) => {
      p.seat = seatIdx[i];
      edges[p.seat].owner = p.id;
      p.lives = CFG.lives;
      p.alive = true;
      p.paddle = 0.5;
      p.target = 0.5;
      p.hype = 0;
      p.superUntil = 0;
      p.lastSuper = 0;
      p.supporting = null;
      p.stats = { saves: 0, against: 0, cheers: 0, supers: 0, topSpeed: 0 };
    });

    this.arena = { sides, R, apothem, edgeLen, edges };
  }

  arenaPayload() {
    return {
      t: 'setup',
      arena: {
        sides: this.arena.sides,
        R: this.arena.R,
        apothem: r3(this.arena.apothem),
        edges: this.arena.edges.map((e) => ({
          i: e.i,
          ax: r3(e.ax), ay: r3(e.ay),
          bx: r3(e.bx), by: r3(e.by),
          nx: r3(e.nx), ny: r3(e.ny),
          phi: r3(e.phi),
          owner: e.owner,
        })),
      },
      lives: CFG.lives,
      paddleHalf: CFG.paddleHalf,
      paddleHalfSuper: CFG.paddleHalfSuper,
      ballRadius: CFG.ballRadius,
      players: this.list().map((p) => ({
        id: p.id,
        name: p.name,
        color: COLORS[p.colorIdx].hex,
        seat: p.seat,
      })),
    };
  }

  /* ---------------- game flow ---------------- */

  start() {
    const ready = this.list().filter((p) => p.connected);
    if (ready.length < CFG.minPlayers) return;
    this.buildArena();
    this.balls = [];
    this.eliminationOrder = [];
    this.roundTime = 0;
    this.respawnTimer = 0;
    this.extraBallDone = false;
    this.result = null;
    this.phase = 'countdown';
    this.countdownLeft = CFG.countdown;
    this.broadcast(this.arenaPayload());
    this.broadcast({ t: 'countdown', n: Math.ceil(this.countdownLeft) });
    this.spawnBall();
    this.startLoop();
  }

  backToLobby() {
    this.stopLoop();
    this.phase = 'lobby';
    this.balls = [];
    this.result = null;
    for (const p of this.players.values()) {
      p.alive = false;
      p.lives = CFG.lives;
      p.supporting = null;
      p.hype = 0;
      p.superUntil = 0;
      p.seat = -1;
    }
    this.pushLobby();
  }

  spawnBall() {
    if (this.balls.filter((b) => !b.dead).length >= CFG.maxBalls) return;
    const ang = Math.random() * Math.PI * 2;
    this.balls.push({
      id: rid(4),
      x: 0, y: 0,
      vx: Math.cos(ang) * CFG.ballSpeed,
      vy: Math.sin(ang) * CFG.ballSpeed,
      speed: CFG.ballSpeed,
      dead: false,
      ttl: 0,
      lastHit: null,
    });
  }

  startLoop() {
    this.stopLoop();
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), 1000 / CFG.tickHz);
  }

  stopLoop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    const now = Date.now();
    let dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (dt > 0.1) dt = 0.1;
    this.touched = now;

    if (this.phase === 'countdown') {
      const before = Math.ceil(this.countdownLeft);
      this.countdownLeft -= dt;
      const after = Math.ceil(this.countdownLeft);
      if (after !== before) {
        this.broadcast({ t: 'countdown', n: Math.max(0, after) });
      }
      if (this.countdownLeft <= 0) {
        this.phase = 'playing';
        this.broadcast({ t: 'go' });
      }
      this.pushState(dt);
      return;
    }

    if (this.phase !== 'playing') return;

    this.roundTime += dt;
    this.stepPaddles(dt);
    this.stepHype(dt);
    this.stepBalls(dt);

    if (!this.extraBallDone && this.roundTime > CFG.extraBallAt && this.balls.length < 2) {
      this.extraBallDone = true;
      this.spawnBall();
      this.events.push({ k: 'newball' });
    }

    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0 && this.balls.filter((b) => !b.dead).length === 0) {
        this.spawnBall();
      }
    }

    this.pushState(dt);
  }

  /** current half-length of a paddle: base, super bonus, minus the late-round shrink */
  halfOf(p, now) {
    const base = p.superUntil > now ? CFG.paddleHalfSuper : CFG.paddleHalf;
    const shrink = Math.max(0, this.roundTime - CFG.shrinkStart) * CFG.shrinkPerSec;
    return Math.max(CFG.paddleHalfMin, base - shrink);
  }

  stepPaddles(dt) {
    const now = Date.now();
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const sup = p.superUntil > now;
      const half = this.halfOf(p, now);
      const spd = sup ? CFG.paddleSpeedSuper : CFG.paddleSpeed;
      const lo = half, hi = 1 - half;
      const target = Math.max(lo, Math.min(hi, p.target));
      const diff = target - p.paddle;
      const step = spd * dt;
      p.paddle += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
      p.paddle = Math.max(lo, Math.min(hi, p.paddle));
    }
  }

  stepHype(dt) {
    const now = Date.now();
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.superUntil > now) continue;
      if (p.hype > 0) p.hype = Math.max(0, p.hype - CFG.hypeDecay * dt);
    }
  }

  stepBalls(dt) {
    const A = this.arena;
    if (!A) return;
    const now = Date.now();
    const floor = Math.min(
      CFG.ballSpeedMax,
      CFG.ballSpeed * (1 + CFG.rampPerSec * Math.max(0, this.roundTime - CFG.rampStart))
    );

    for (const b of this.balls) {
      if (b.dead) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.ttl -= dt;
        continue;
      }

      if (b.speed < floor) {
        const k = floor / b.speed;
        b.speed = floor; b.vx *= k; b.vy *= k;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      for (const e of A.edges) {
        const s = b.x * e.nx + b.y * e.ny - A.apothem; // >0 means outside the wall plane
        const approaching = b.vx * e.nx + b.vy * e.ny > 0;
        if (s < -CFG.ballRadius || !approaching) continue;

        // where along the wall did we cross?
        const t = ((b.x - e.ax) * e.dx + (b.y - e.ay) * e.dy) / e.len;
        const owner = e.owner ? this.players.get(e.owner) : null;
        const live = owner && owner.alive;

        if (live) {
          const half = this.halfOf(owner, now) + CFG.ballRadius / e.len;
          const off = (t - owner.paddle) / half; // -1 .. 1 across the paddle
          if (Math.abs(off) <= 1) {
            this.bounce(b, e, off);
            owner.stats.saves++;
            b.lastHit = owner.id;
            this.events.push({ k: 'hit', p: owner.id, x: r3(b.x), y: r3(b.y), s: r3(b.speed) });
            owner.stats.topSpeed = Math.max(owner.stats.topSpeed, b.speed);
            break;
          }
          // missed -> goal against the owner
          this.goal(b, owner);
          break;
        }

        // solid wall (empty seat or eliminated player)
        this.bounce(b, e, 0, true);
        break;
      }
    }

    this.balls = this.balls.filter((b) => !b.dead || b.ttl > 0);
    if (this.balls.filter((x) => !x.dead).length === 0 && this.respawnTimer <= 0 && this.phase === 'playing') {
      this.respawnTimer = CFG.respawnDelay;
    }
  }

  bounce(b, e, off, solid = false) {
    // reflect around the wall normal
    const dot = b.vx * e.nx + b.vy * e.ny;
    let vx = b.vx - 2 * dot * e.nx;
    let vy = b.vy - 2 * dot * e.ny;

    if (!solid) {
      // add spin based on where the paddle was hit
      vx += e.dx * off * 0.75 * b.speed;
      vy += e.dy * off * 0.75 * b.speed;
      b.speed = Math.min(CFG.ballSpeedMax, b.speed * CFG.ballSpeedGain);
    }

    const m = Math.hypot(vx, vy) || 1;
    b.vx = (vx / m) * b.speed;
    b.vy = (vy / m) * b.speed;

    // never let it graze along the wall forever
    const along = Math.abs(b.vx * e.dx + b.vy * e.dy) / b.speed;
    if (along > 0.985) {
      b.vx -= e.nx * 0.18 * b.speed;
      b.vy -= e.ny * 0.18 * b.speed;
      const m2 = Math.hypot(b.vx, b.vy) || 1;
      b.vx = (b.vx / m2) * b.speed;
      b.vy = (b.vy / m2) * b.speed;
    }

    // push back inside the wall plane
    const s = b.x * e.nx + b.y * e.ny - this.arena.apothem;
    const push = s + CFG.ballRadius;
    if (push > 0) {
      b.x -= e.nx * push;
      b.y -= e.ny * push;
    }
  }

  goal(b, victim) {
    b.dead = true;
    b.ttl = 0.7;
    victim.lives = Math.max(0, victim.lives - 1);
    victim.stats.against++;
    victim.hype = 0;
    const scorerId = b.lastHit && b.lastHit !== victim.id ? b.lastHit : null;
    this.events.push({
      k: 'goal', p: victim.id, by: scorerId,
      x: r3(b.x), y: r3(b.y), lives: victim.lives,
    });

    if (victim.lives <= 0) {
      victim.alive = false;
      victim.superUntil = 0;
      this.eliminationOrder.push(victim.id);
      this.events.push({ k: 'elim', p: victim.id });
      // one extra ball to speed up the endgame
      if (this.alivePlayers().length > 1) this.spawnBall();
      this.checkWin();
    }
    this.respawnTimer = CFG.respawnDelay;
  }

  checkWin() {
    const alive = this.alivePlayers();
    if (alive.length > 1) return;
    const winner = alive[0] || null;
    this.phase = 'over';
    this.stopLoop();

    const ranking = [];
    if (winner) ranking.push(winner.id);
    for (let i = this.eliminationOrder.length - 1; i >= 0; i--) {
      ranking.push(this.eliminationOrder[i]);
    }

    const supportersOf = {};
    for (const p of this.players.values()) {
      if (p.supporting) {
        (supportersOf[p.supporting] = supportersOf[p.supporting] || []).push(p.name);
      }
    }

    this.result = {
      t: 'over',
      winner: winner ? winner.id : null,
      duration: r3(this.roundTime),
      podium: ranking.map((id, idx) => {
        const p = this.players.get(id);
        return {
          rank: idx + 1,
          id,
          name: p ? p.name : '???',
          color: p ? COLORS[p.colorIdx].hex : '#888',
          saves: p ? p.stats.saves : 0,
          against: p ? p.stats.against : 0,
          cheers: p ? p.stats.cheers : 0,
          supers: p ? p.stats.supers : 0,
          topSpeed: p ? r3(p.stats.topSpeed) : 0,
          fans: supportersOf[id] || [],
        };
      }),
    };
    this.broadcast(this.result);
  }

  /* ---------------- support / cheering ---------------- */

  cheer(p) {
    if (this.phase !== 'playing') return;
    if (p.alive) return;
    if (!p.supporting) return;
    const now = Date.now();
    if (now - p.lastCheer < CFG.cheerCooldown) return;
    p.lastCheer = now;

    const hero = this.players.get(p.supporting);
    if (!hero || !hero.alive) return;
    hero.stats.cheers++;
    if (hero.superUntil > now) return;

    hero.hype = Math.min(100, hero.hype + CFG.hypePerCheer);
    this.events.push({ k: 'cheer', p: hero.id, from: p.name });

    if (hero.hype >= 100) {
      if (now - (hero.lastSuper || 0) < CFG.superCooldown) { hero.hype = 99; return; }
      hero.lastSuper = now;
      hero.hype = 0;
      hero.superUntil = now + CFG.superDuration * 1000;
      hero.stats.supers++;
      this.events.push({ k: 'super', p: hero.id });
    }
  }

  /* ---------------- network state ---------------- */

  pushState(dt) {
    this.netAcc += dt;
    if (this.netAcc < 1 / CFG.netHz && this.events.length === 0) return;
    this.netAcc = 0;
    const now = Date.now();

    const msg = {
      t: 's',
      ph: this.phase,
      rt: r3(this.roundTime),
      hf: r3(Math.max(CFG.paddleHalfMin, CFG.paddleHalf - Math.max(0, this.roundTime - CFG.shrinkStart) * CFG.shrinkPerSec)),
      hs: r3(Math.max(CFG.paddleHalfMin, CFG.paddleHalfSuper - Math.max(0, this.roundTime - CFG.shrinkStart) * CFG.shrinkPerSec)),
      b: this.balls.map((b) => [r3(b.x), r3(b.y), r3(b.vx), r3(b.vy), b.dead ? 1 : 0]),
      p: this.list().map((p) => [
        p.id,
        r3(p.paddle),
        p.lives,
        Math.round(p.hype),
        p.superUntil > now ? Math.round(p.superUntil - now) : 0,
        p.alive ? 1 : 0,
        p.connected ? 1 : 0,
        p.supporting || '',
      ]),
    };
    if (this.events.length) {
      msg.ev = this.events;
      this.events = [];
    }
    this.broadcast(msg);
  }
}

/* ------------------------------------------------------------------ */
/* Server plumbing                                                     */
/* ------------------------------------------------------------------ */

const rooms = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (_) {
    urlPath = '/';
  }
  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('nope');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

function fail(ws, msg) {
  try { ws.send(JSON.stringify({ t: 'error', msg })); } catch (_) {}
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let room = null;
  let me = null;

  const bindPlayer = (r, p) => {
    room = r; me = p;
    ws.roomCode = r.code; ws.playerId = p.id;
    r.send(p, {
      t: 'joined',
      you: { id: p.id, token: p.token, name: p.name, color: COLORS[p.colorIdx].hex },
      code: r.code,
    });
    r.pushLobby();
    if (r.phase !== 'lobby' && r.arena) {
      r.send(p, r.arenaPayload());
      if (r.phase === 'over' && r.result) r.send(p, r.result);
    }
  };

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString().slice(0, 4000)); } catch (_) { return; }
    if (!m || typeof m.t !== 'string') return;

    switch (m.t) {
      case 'create': {
        if (room) return;
        const code = newCode(rooms);
        const r = new Room(code);
        rooms.set(code, r);
        const p = r.addPlayer(ws, m.name);
        bindPlayer(r, p);
        break;
      }

      case 'join': {
        if (room) return;
        const code = String(m.code || '').toUpperCase().trim();
        const r = rooms.get(code);
        if (!r) return fail(ws, 'Die code bestaat niet');

        // reclaim a seat after a reload / dropped connection
        if (m.token) {
          const old = [...r.players.values()].find((p) => p.token === m.token);
          if (old) {
            if (old.ws && old.ws !== ws && old.ws.readyState === 1) {
              try { old.ws.close(); } catch (_) {}
            }
            old.ws = ws;
            old.connected = true;
            if (m.name) old.name = cleanName(m.name);
            bindPlayer(r, old);
            return;
          }
        }

        if (r.phase !== 'lobby') return fail(ws, 'Dit potje is al bezig');
        if (r.players.size >= CFG.maxPlayers) return fail(ws, 'Deze room zit vol');
        const p = r.addPlayer(ws, m.name);
        if (!p) return fail(ws, 'Deze room zit vol');
        bindPlayer(r, p);
        break;
      }

      case 'name': {
        if (!room || !me) return;
        me.name = cleanName(m.name);
        room.pushLobby();
        break;
      }

      case 'color': {
        if (!room || !me || room.phase !== 'lobby') return;
        const idx = Number(m.i);
        if (!Number.isInteger(idx) || idx < 0 || idx >= COLORS.length) return;
        const taken = [...room.players.values()].some((p) => p !== me && p.colorIdx === idx);
        if (taken) return;
        me.colorIdx = idx;
        room.pushLobby();
        break;
      }

      case 'start': {
        if (!room || !me || me.id !== room.hostId) return;
        if (room.phase !== 'lobby') return;
        room.start();
        break;
      }

      case 'again': {
        if (!room || !me || me.id !== room.hostId) return;
        if (room.phase !== 'over') return;
        room.backToLobby();
        break;
      }

      case 'in': {
        if (!room || !me) return;
        const v = Number(m.p);
        if (!Number.isFinite(v)) return;
        me.target = Math.max(0, Math.min(1, v));
        break;
      }

      case 'support': {
        if (!room || !me) return;
        const target = room.players.get(String(m.id || ''));
        if (!target || !target.alive || me.alive) return;
        me.supporting = target.id;
        break;
      }

      case 'cheer': {
        if (!room || !me) return;
        room.cheer(me);
        break;
      }

      case 'ping': {
        try { ws.send(JSON.stringify({ t: 'pong', ts: m.ts })); } catch (_) {}
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!room || !me) return;
    if (me.ws === ws) {
      me.connected = false;
      me.ws = null;
    }
    if (room.phase === 'lobby') {
      room.removePlayer(me.id);
    } else if (me.alive) {
      // a dropped player stops moving; if nobody is left the round ends
      const stillHere = room.alivePlayers().filter((p) => p.connected);
      if (stillHere.length === 0) room.backToLobby();
    }
    if (room.hostId === me.id && !me.connected) {
      const next = room.list().find((p) => p.connected);
      room.hostId = next ? next.id : room.hostId;
    }
    room.pushLobby();
    const anyone = room.list().some((p) => p.connected);
    if (!anyone) {
      room.stopLoop();
      room.touched = Date.now();
    }
  });
});

// keepalive + room cleanup
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  });
  const now = Date.now();
  for (const [code, r] of rooms) {
    const anyone = r.list().some((p) => p.connected);
    if (!anyone && now - r.touched > CFG.roomTTL) {
      r.stopLoop();
      rooms.delete(code);
    }
    if (anyone) r.touched = now;
  }
}, 30000);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`PONG ROYALE draait op http://localhost:${PORT}`);
  });
}

module.exports = { server, rooms, CFG };
