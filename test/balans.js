/**
 * Zet een nagebootste mens (reactietijd 0.28s, redelijk maar niet perfect mikken)
 * 1-tegen-1 tegen elk botniveau, en kijkt wie er wint en hoe lang het duurt.
 * Zo zie je of de niveaus een vloeiende trap vormen.
 */
const WebSocket = require('ws');
const { server, CFG } = require('../server.js');

const PORT = 4345;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** een speler die ongeveer beweegt zoals iemand met pijltjestoetsen */
class Mens {
  constructor(code, klaar) {
    this.reactie = 0.28; this.gain = 0.78; this.fout = 0.06;
    this.timer = 0; this.laatst = Date.now();
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    this.ws.on('open', () => this.tx({ t: 'join', code, name: 'Mens' }));
    this.ws.on('message', (r) => this.rx(JSON.parse(r.toString()), klaar));
  }
  tx(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  rx(m, klaar) {
    if (m.t === 'joined') { this.id = m.you.id; klaar && klaar(this); }
    if (m.t === 'setup') { this.arena = m.arena; this.edge = m.arena.edges.find((e) => e.owner === this.id); }
    if (m.t === 'over') this.uitslag = m;
    if (m.t !== 's' || !this.edge) return;

    const nu = Date.now();
    const dt = (nu - this.laatst) / 1000; this.laatst = nu;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.reactie;

    const e = this.edge, A = this.arena;
    let best = null, bestT = Infinity;
    for (const b of m.b) {
      if (b[4] === 1) continue;
      const vn = b[2] * e.nx + b[3] * e.ny;
      if (vn <= 0.001) continue;
      const t = -(b[0] * e.nx + b[1] * e.ny - A.apothem) / vn;
      if (t > 0 && t < bestT) { bestT = t; best = b; }
    }
    if (!best) return;
    const ix = best[0] + best[2] * bestT, iy = best[1] + best[3] * bestT;
    const ex = e.bx - e.ax, ey = e.by - e.ay, l2 = ex * ex + ey * ey;
    let hit = ((ix - e.ax) * ex + (iy - e.ay) * ey) / l2;
    hit = Math.max(0, Math.min(1, hit)) + (Math.random() * 2 - 1) * this.fout;
    this.tx({ t: 'in', p: Math.max(0, Math.min(1, 0.5 + (hit - 0.5) * this.gain)) });
  }
}

/** de host; maakt de room en zet er een bot van het gevraagde niveau in */
class Host {
  constructor(klaar) {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    this.ws.on('open', () => this.tx({ t: 'create', name: 'Host' }));
    this.ws.on('message', (r) => {
      const m = JSON.parse(r.toString());
      if (m.t === 'joined') { this.code = m.code; this.id = m.you.id; klaar(this); }
      if (m.t === 'over') this.uitslag = m;
      if (m.t === 's') this.tx({ t: 'in', p: 0.5 });   // host doet niet mee, staat stil
    });
  }
  tx(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
}

async function potje(niveau) {
  const host = await new Promise((res) => new Host(res));
  const mens = await new Promise((res) => new Mens(host.code, res));
  await wait(300);
  host.tx({ t: 'addbot', level: niveau });
  await wait(400);
  // de host stapt eruit zodat het echt 1 tegen 1 is
  host.tx({ t: 'start' });

  const t0 = Date.now();
  while (!mens.uitslag && Date.now() - t0 < 150000) await wait(300);
  const uit = mens.uitslag;
  mens.ws.close(); host.ws.close();
  if (!uit) return { niveau, winnaar: '(geen einde)', duur: 150 };
  return {
    niveau,
    winnaar: uit.podium[0].name,
    plek: uit.podium.map((p) => p.name).join(' > '),
    duur: uit.duration,
  };
}

server.listen(PORT, async () => {
  console.log('mens: reactie 0.28s, mikt op 78% van de wand, 6% mikfout\n');
  for (let n = 0; n < CFG.botLevels.length; n++) {
    const r = await potje(n);
    const lvl = CFG.botLevels[n];
    console.log(
      `${lvl.name.padEnd(10)} (reactie ${lvl.reaction}s, gain ${lvl.gain})  ` +
      `-> ${String(Math.round(r.duur)).padStart(3)}s   ${r.plek || r.winnaar}`
    );
  }
  process.exit(0);
});
