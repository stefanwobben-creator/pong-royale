/** Reproduceert de weergave in een breed desktopvenster (zoals Stefans scherm). */
const { chromium } = require('playwright');
const WebSocket = require('ws');
const { server } = require('../server.js');

const PORT = 4337;
const URL = `http://127.0.0.1:${PORT}/`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class Bot {
  constructor(name, code) {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    this.ws.on('open', () => this.tx({ t: 'join', code, name }));
    this.ws.on('message', (r) => this.rx(JSON.parse(r.toString())));
  }
  tx(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  rx(m) {
    if (m.t === 'joined') this.id = m.you.id;
    if (m.t === 'setup') { this.arena = m.arena; this.edge = m.arena.edges.find((e) => e.owner === this.id); }
    if (m.t !== 's' || !this.edge) return;
    const e = this.edge;
    let best = null, bd = 1e9;
    for (const b of m.b) {
      if (b[4] === 1) continue;
      const d = Math.abs(b[0] * e.nx + b[1] * e.ny - this.arena.apothem);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return;
    const ex = e.bx - e.ax, ey = e.by - e.ay, l2 = ex * ex + ey * ey;
    const t = ((best[0] - e.ax) * ex + (best[1] - e.ay) * ey) / l2;
    this.tx({ t: 'in', p: Math.max(0, Math.min(1, 0.5 + (t - 0.5) * 0.8)) });
  }
}

server.listen(PORT, async () => {
  const kill = setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 150000);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1830, height: 870 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.log('JS ERROR:', e.message));
  await pg.goto(URL, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => { document.getElementById('nameInput').value = 'Stefan'; });
  await pg.evaluate(() => document.getElementById('btnCreate').click());
  await pg.waitForFunction(() => /^[A-Z0-9]{4}$/.test(document.getElementById('lobbyCode').textContent));
  const code = (await pg.textContent('#lobbyCode')).trim();
  ['Lotte', 'Eelco', 'Marcel'].forEach((n) => new Bot(n, code));
  await wait(1200);
  await pg.evaluate(() => document.getElementById('btnStart').click());

  for (const sec of [4, 10, 20, 35]) {
    await wait(sec * 1000 - (sec === 4 ? 0 : 0));
    const info = await pg.evaluate(() => {
      const s = window.GFX.state();
      const c = document.getElementById('board');
      const g = c.getContext('2d');
      const px = g.getImageData(4, 4, 1, 1).data;                 // hoek
      const mid = g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
      return {
        W: s.W, H: s.H, dpr: s.dpr, scale: Math.round(s.scale), cy: Math.round(s.cy),
        arena: !!s.arena, frames: s.frames, lowQ: s.lowQ,
        composite: g.globalCompositeOperation, alpha: g.globalAlpha,
        hoek: [...px], midden: [...mid],
      };
    });
    console.log(JSON.stringify(info));
    const d = await pg.evaluate(() => document.getElementById('board').toDataURL('image/png'));
    require('fs').writeFileSync(`shots/desk-${sec}s.png`, Buffer.from(d.split(',')[1], 'base64'));
  }

  clearTimeout(kill);
  await browser.close();
  process.exit(0);
});
