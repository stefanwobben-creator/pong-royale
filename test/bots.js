/**
 * Headless test: spins up the server, connects N bot players,
 * plays a full round and checks the whole flow.
 *
 *   node test/bots.js [numPlayers]
 */

const WebSocket = require('ws');
const { server } = require('../server.js');

const N = Number(process.argv[2] || 5);
const PORT = 4321;
const checks = [];
const note = (ok, label, extra = '') => {
  checks.push({ ok, label, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  -> ' + extra : ''}`);
};

let maxRadius = 0;
let goals = 0, hits = 0, elims = 0, supers = 0, cheersSent = 0;
let sawCountdown = false, over = null;

class Bot {
  constructor(i) {
    this.i = i;
    this.name = 'Bot' + (i + 1);
    this.skill = 0.55 + Math.random() * 0.4; // deliberately imperfect
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    this.ready = new Promise((res) => { this.resolve = res; });
    this.ws.on('open', () => {
      if (i === 0) this.sendMsg({ t: 'create', name: this.name });
      else this.sendMsg({ t: 'join', code: Bot.code, name: this.name });
    });
    this.ws.on('message', (raw) => this.onMsg(JSON.parse(raw.toString())));
  }

  sendMsg(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  onMsg(m) {
    if (m.t === 'joined') {
      this.id = m.you.id;
      if (this.i === 0) Bot.code = m.code;
      this.resolve();
    }
    if (m.t === 'error') console.log('  server error for', this.name, ':', m.msg);
    if (m.t === 'countdown') sawCountdown = true;
    if (m.t === 'setup') {
      this.arena = m.arena;
      this.setup = m;
      this.edge = m.arena.edges.find((e) => e.owner === this.id);
      this.alive = true;
    }
    if (m.t === 's') this.think(m);
    if (m.t === 'over') { over = m; }
  }

  think(m) {
    // physics sanity: no live ball should escape the arena
    for (const b of m.b) {
      if (b[4] === 1) continue;
      maxRadius = Math.max(maxRadius, Math.hypot(b[0], b[1]));
    }
    if (this.i === 0) for (const ev of m.ev || []) {
      if (ev.k === 'goal') goals++;
      if (ev.k === 'hit') hits++;
      if (ev.k === 'elim') elims++;
      if (ev.k === 'super') supers++;
    }

    const row = m.p.find((r) => r[0] === this.id);
    if (!row) return;
    const wasAlive = this.alive;
    this.alive = row[5] === 1;

    if (!this.alive) {
      if (wasAlive) {
        const hero = m.p.find((r) => r[5] === 1);
        if (hero) { this.hero = hero[0]; this.sendMsg({ t: 'support', id: hero[0] }); }
      }
      if (this.hero && Math.random() < 0.5) { this.sendMsg({ t: 'cheer' }); cheersSent++; }
      return;
    }

    if (!this.edge || !m.b.length) return;
    // track the nearest live ball along my wall
    const e = this.edge;
    let best = null, bestD = 1e9;
    for (const b of m.b) {
      if (b[4] === 1) continue;
      const d = Math.abs(b[0] * e.nx + b[1] * e.ny - this.arena.apothem);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best) return;
    const ex = e.bx - e.ax, ey = e.by - e.ay;
    const len2 = ex * ex + ey * ey;
    let t = ((best[0] - e.ax) * ex + (best[1] - e.ay) * ey) / len2;
    t = Math.max(0, Math.min(1, t));
    const target = 0.5 + (t - 0.5) * this.skill;
    this.sendMsg({ t: 'in', p: target });
  }
}

(async () => {
  server.listen(PORT, async () => {
    const bots = [];
    bots.push(new Bot(0));
    await bots[0].ready;
    note(!!Bot.code && Bot.code.length === 4, 'host maakt een room met 4-teken code', Bot.code);

    for (let i = 1; i < N; i++) {
      bots.push(new Bot(i));
      await bots[i].ready;
    }
    note(bots.every((b) => b.id), `${N} spelers zitten in de room`);

    bots[0].sendMsg({ t: 'start' });

    const t0 = Date.now();
    await new Promise((res) => {
      let last = 0;
      const iv = setInterval(() => {
        const el = Date.now() - t0;
        if (el - last > 5000) {
          last = el;
          console.log(`  t=${(el / 1000) | 0}s hits=${hits} goals=${goals} elims=${elims} supers=${supers} maxR=${maxRadius.toFixed(3)}`);
        }
        if (over || el > Number(process.env.TEST_MAX || 90000)) { clearInterval(iv); res(); }
      }, 250);
    });

    note(sawCountdown, 'aftellen verstuurd voor de start');
    note(bots.every((b) => b.edge), 'iedere speler kreeg een eigen wand toegewezen');
    note(hits > 10, 'peddels raken de bal', hits + ' saves');
    note(goals > 0, 'er wordt gescoord', goals + ' goals');
    note(elims === N - 1, 'precies N-1 spelers uitgeschakeld', elims + '/' + (N - 1));
    note(cheersSent > 0, 'supporters juichen na eliminatie', cheersSent + ' cheers');
    note(supers > 0, 'juichen levert een SUPERCHARGE op', supers + 'x');
    note(!!over && !!over.winner, 'er is een winnaar');
    note(!!over && over.podium.length === N, 'podium bevat alle spelers', over ? over.podium.length : 0);
    note(!!over && over.podium[0].rank === 1 && over.podium[0].id === over.winner, 'winnaar staat op plek 1');
    note(maxRadius < 1.08, 'bal blijft binnen de arena', 'max straal ' + maxRadius.toFixed(3));

    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nPotje duurde ${dur}s. Winnaar: ${over ? over.podium[0].name : '-'}`);
    console.log(over ? over.podium.map((p) => `${p.rank}. ${p.name} (${p.saves} saves, ${p.supers}x super, fans: ${p.fans.join(', ') || '-'})`).join('\n') : '');

    const failed = checks.filter((c) => !c.ok).length;
    console.log(`\n${checks.length - failed}/${checks.length} checks geslaagd`);
    process.exit(failed ? 1 : 0);
  });
})();
