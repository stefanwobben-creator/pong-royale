/** Test het solo-oefenen: 1 mens + 3 serverbots via de knop in de lobby. */
const { chromium } = require('playwright');
const { server } = require('../server.js');

const PORT = 4338;
const URL = `http://127.0.0.1:${PORT}/`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

server.listen(PORT, async () => {
  const kill = setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 165000);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1830, height: 870 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.log('JS ERROR:', e.message));
  await pg.goto(URL, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => { document.getElementById('nameInput').value = 'Stefan'; });
  await pg.evaluate(() => document.getElementById('btnCreate').click());
  await pg.waitForFunction(() => /^[A-Z0-9]{4}$/.test(document.getElementById('lobbyCode').textContent));

  // drie bots erbij: makkelijk, normaal, sterk
  for (const lvl of ['0', '1', '2']) {
    await pg.evaluate((v) => {
      document.getElementById('botLevel').value = v;
      document.getElementById('btnAddBot').click();
    }, lvl);
    await wait(250);
  }
  await wait(500);
  const namen = await pg.evaluate(() =>
    [...document.querySelectorAll('.prow')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
  console.log('lobby:', JSON.stringify(namen, null, 0));
  const kickKnoppen = await pg.evaluate(() => document.querySelectorAll('.kick').length);
  console.log('verwijderknoppen zichtbaar:', kickKnoppen);
  await pg.screenshot({ path: 'shots/solo-lobby.png' });

  await pg.evaluate(() => document.getElementById('btnStart').click());
  await wait(6000);

  // de mens beweegt willekeurig, de bots spelen zelf
  let over = false;
  for (let i = 0; i < 180; i++) {
    await pg.evaluate((v) => window.GFX.setLocalTarget(v), 0.3 + 0.4 * Math.random());
    await wait(700);
    over = await pg.evaluate(() => document.getElementById('over').classList.contains('active'));
    if (i === 8) {
      const d = await pg.evaluate(() => document.getElementById('board').toDataURL('image/png'));
      require('fs').writeFileSync('shots/solo-game.png', Buffer.from(d.split(',')[1], 'base64'));
      console.log('speelscherm vastgelegd');
    }
    if (over) break;
  }

  const uitslag = await pg.evaluate(() => ({
    over: document.getElementById('over').classList.contains('active'),
    kampioen: document.getElementById('champName').textContent,
    rijen: [...document.querySelectorAll('.srow')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
  }));
  console.log('uitslag:', JSON.stringify(uitslag, null, 1));

  clearTimeout(kill);
  await browser.close();
  process.exit(uitslag.over ? 0 : 1);
});
