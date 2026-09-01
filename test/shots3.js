/** Screenshots of the supporter panel and the award ceremony (loops frozen first). */
const { chromium } = require('playwright');
const { server } = require('../server.js');
const PORT = 4336;
const URL = `http://127.0.0.1:${PORT}/`;
const phone = { width: 390, height: 844, hasTouch: true, isMobile: true };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PODIUM = [
  { rank: 1, id: 'w', name: 'Stefan', color: '#00e5ff', saves: 24, against: 2, cheers: 61, supers: 3, fans: ['Lotte', 'Tim'] },
  { rank: 2, id: 'b', name: 'Lotte', color: '#ff2d95', saves: 19, against: 3, cheers: 0, supers: 1, fans: [] },
  { rank: 3, id: 'c', name: 'Eelco', color: '#7cff4f', saves: 12, against: 3, cheers: 0, supers: 0, fans: [] },
  { rank: 4, id: 'd', name: 'Marcel', color: '#ffd23f', saves: 7, against: 3, cheers: 0, supers: 0, fans: [] },
  { rank: 5, id: 'e', name: 'Tim', color: '#a06bff', saves: 3, against: 3, cheers: 0, supers: 0, fans: [] },
];

server.listen(PORT, async () => {
  const kill = setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 150000);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: phone, deviceScaleFactor: 2, hasTouch: true });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.log('JS ERROR:', e.message));
  await pg.goto(URL, { waitUntil: 'domcontentloaded' });

  // --- supporter panel -------------------------------------------------
  await pg.evaluate((podium) => {
    const ids = ['me', 'b', 'c', 'd', 'e'];
    const cols = ['#00e5ff', '#ff2d95', '#7cff4f', '#ffd23f', '#a06bff'];
    const names = ['Stefan', 'Lotte', 'Eelco', 'Marcel', 'Tim'];
    const sides = 5, R = 1;
    const edges = [];
    for (let i = 0; i < sides; i++) {
      const phi = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
      const a1 = phi - Math.PI / sides, a2 = phi + Math.PI / sides;
      edges.push({
        i, nx: Math.cos(phi), ny: Math.sin(phi), phi,
        ax: R * Math.cos(a1), ay: R * Math.sin(a1),
        bx: R * Math.cos(a2), by: R * Math.sin(a2), owner: ids[i],
      });
    }
    state.me = { id: 'me', token: 't', name: 'Stefan', color: '#00e5ff' };
    state.lobby = { hostId: 'me' };
    window.__handle({
      t: 'setup',
      arena: { sides, R, apothem: Math.cos(Math.PI / sides), edges },
      lives: 3, paddleHalf: .105, paddleHalfSuper: .165, ballRadius: .03,
      players: ids.map((id, i) => ({ id, name: names[i], color: cols[i], seat: i })),
    });
    window.__handle({
      t: 's', ph: 'playing', rt: 62,
      b: [[.1, -.2, .5, .6, 0]],
      p: [
        ['me', .5, 0, 0, 0, 0, 1, ''],
        ['b', .45, 2, 64, 0, 1, 1, ''],
        ['c', .6, 1, 12, 0, 1, 1, ''],
        ['d', .3, 0, 0, 0, 0, 1, ''],
        ['e', .7, 3, 0, 2400, 1, 1, ''],
      ],
    });
  }, PODIUM);
  await wait(700);
  await pg.evaluate(() => { const b = document.querySelector('.pick'); if (b) b.click(); });
  await wait(500);
  await pg.evaluate(() => window.GFX.stop());
  await wait(400);
  await pg.screenshot({ path: 'shots/5-supporter.png', timeout: 40000 });
  console.log('  .. supporter-scherm');

  // --- ceremony --------------------------------------------------------
  await pg.evaluate((podium) => window.__handle({ t: 'over', winner: 'w', duration: 96.4, podium }), PODIUM);
  await wait(2500);
  await pg.evaluate(() => window.CEREMONY.stop());
  await wait(400);
  await pg.screenshot({ path: 'shots/6-ceremonie.png', timeout: 40000 });
  console.log('  .. ceremonie');

  clearTimeout(kill);
  await browser.close();
  process.exit(0);
});
