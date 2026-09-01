/** One real browser page + 4 headless bot players -> screenshots of a 5-way arena. */
const { chromium } = require('playwright');
const WebSocket = require('ws');
const { server } = require('../server.js');

const PORT = 4335;
const URL = `http://127.0.0.1:${PORT}/`;
const phone = { width: 390, height: 844, hasTouch: true, isMobile: true };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (s) => console.log('  ..', s);
async function snap(pg, path) {
  const d = await pg.evaluate(() => document.getElementById('board').toDataURL('image/png'));
  require('fs').writeFileSync(path, Buffer.from(d.split(',')[1], 'base64'));
}
async function fps(pg) {
  const a = await pg.evaluate(() => window.GFX.state().frames);
  await wait(3000);
  const b = await pg.evaluate(() => window.GFX.state().frames);
  return ((b - a) / 3).toFixed(1);
}

class Bot {
  constructor(name, code) {
    this.name = name;
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    this.ws.on('open', () => this.tx({ t: 'join', code, name }));
    this.ws.on('message', (r) => this.rx(JSON.parse(r.toString())));
  }
  tx(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  rx(m) {
    if (m.t === 'joined') this.id = m.you.id;
    if (m.t === 'setup') { this.arena = m.arena; this.edge = m.arena.edges.find((e) => e.owner === this.id); }
    if (m.t !== 's' || !this.edge) return;
    const row = m.p.find((r) => r[0] === this.id);
    if (row && row[5] === 0) {
      const hero = m.p.find((r) => r[5] === 1);
      if (hero && !this.hero) { this.hero = hero[0]; this.tx({ t: 'support', id: hero[0] }); }
      if (this.hero && Math.random() < .6) this.tx({ t: 'cheer' });
      return;
    }
    const e = this.edge;
    let best = null, bd = 1e9;
    for (const b of m.b) {
      if (b[4] === 1) continue;
      const d = Math.abs(b[0] * e.nx + b[1] * e.ny - this.arena.apothem);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return;
    const ex = e.bx - e.ax, ey = e.by - e.ay, l2 = ex * ex + ey * ey;
    let t = ((best[0] - e.ax) * ex + (best[1] - e.ay) * ey) / l2;
    this.tx({ t: 'in', p: Math.max(0, Math.min(1, 0.5 + (t - 0.5) * 0.8)) });
  }
}

server.listen(PORT, async () => {
  const kill = setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 165000);
  let browser;
  try {
    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ viewport: phone, deviceScaleFactor: 2, hasTouch: true });
    const pg = await ctx.newPage();
    pg.setDefaultTimeout(20000);
    pg.on('pageerror', (e) => console.log('JS ERROR:', e.message));
    pg.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
    await pg.goto(URL, { waitUntil: 'domcontentloaded' });
    await pg.evaluate(() => { document.getElementById('nameInput').value = 'Stefan'; });
    await pg.screenshot({ path: 'shots/1-home.png' });
    step('home');

    await pg.evaluate(() => document.getElementById('btnCreate').click());
    await pg.waitForFunction(() => /^[A-Z0-9]{4}$/.test(document.getElementById('lobbyCode').textContent));
    const code = (await pg.textContent('#lobbyCode')).trim();
    step('room ' + code);

    ['Lotte', 'Eelco', 'Marcel', 'Tim'].forEach((n) => new Bot(n, code));
    await wait(1200);
    await pg.screenshot({ path: 'shots/2-lobby.png' });
    step('lobby');

    await pg.evaluate(() => document.getElementById('btnStart').click());
    await wait(6500);
    await snap(pg, 'shots/3-game.png');
    console.log('  .. fps in deze container:', await fps(pg));
    step('speelscherm');

    // play a while, wiggling the human paddle
    for (let i = 0; i < 40; i++) {
      await pg.evaluate((v) => window.GFX.setLocalTarget(v), 0.3 + 0.4 * Math.random());
      await wait(450);
      const dead = await pg.evaluate(() => !document.getElementById('supportPanel').classList.contains('hidden'));
      if (dead) break;
    }
    await snap(pg, 'shots/4-game-later.png');
    step('later in het potje');

    const dead = await pg.evaluate(() => !document.getElementById('supportPanel').classList.contains('hidden'));
    if (dead) {
      await pg.evaluate(() => { const b = document.querySelector('.pick'); if (b) b.click(); });
      await wait(800);
      await snap(pg, 'shots/5-supporter.png');
      step('supporter-scherm');
    } else {
      step('speler leefde nog, geen supporter-shot');
    }

    await pg.evaluate(() => {
      window.__handle({
        t: 'over', winner: 'w', duration: 96.4,
        podium: [
          { rank: 1, id: 'w', name: 'Stefan', color: '#00e5ff', saves: 24, against: 2, cheers: 61, supers: 3, fans: ['Lotte', 'Tim'] },
          { rank: 2, id: 'b', name: 'Lotte', color: '#ff2d95', saves: 19, against: 3, cheers: 0, supers: 1, fans: [] },
          { rank: 3, id: 'c', name: 'Eelco', color: '#7cff4f', saves: 12, against: 3, cheers: 0, supers: 0, fans: [] },
          { rank: 4, id: 'd', name: 'Marcel', color: '#ffd23f', saves: 7, against: 3, cheers: 0, supers: 0, fans: [] },
          { rank: 5, id: 'e', name: 'Tim', color: '#a06bff', saves: 3, against: 3, cheers: 0, supers: 0, fans: [] },
        ],
      });
    });
    await wait(2000);
    await pg.screenshot({ path: 'shots/6-ceremonie.png' });
    step('ceremonie');

    clearTimeout(kill);
    await browser.close();
    process.exit(0);
  } catch (e) {
    console.log('SCRIPT ERROR:', e.message);
    if (browser) await browser.close().catch(() => {});
    process.exit(1);
  }
});
