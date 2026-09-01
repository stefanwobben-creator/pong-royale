/**
 * Test de uitweg uit een potje, het vangnet voor een verdwenen bal,
 * en de uitleg voor nieuwe spelers.
 */
const { chromium } = require('playwright');
const { server, rooms } = require('../server.js');

const PORT = 4342;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const note = (ok, l, x = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  -> ' + x : ''}`); };
const phone = { width: 390, height: 844, hasTouch: true, isMobile: true };

const scherm = () => ({
  actief: [...document.querySelectorAll('.screen.active')].map((x) => x.id).join(','),
  uitleg: !document.getElementById('uitleg').classList.contains('hidden'),
  uitlegKop: (document.querySelector('.uitleg-kop') || {}).textContent || '',
  menu: !document.getElementById('gameMenu').classList.contains('hidden'),
  spelers: [...document.querySelectorAll('.prow .pname')].map((x) => x.textContent),
});

server.listen(PORT, async () => {
  const kill = setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 165000);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

  const maakPagina = async (ctx) => {
    const pg = await (ctx || await browser.newContext({ viewport: phone, hasTouch: true })).newPage();
    pg.on('pageerror', (e) => console.log('JS ERROR:', e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    return pg;
  };

  /* ---------- uitleg bij de eerste keer ---------- */
  const ctx = await browser.newContext({ viewport: phone, hasTouch: true });
  const pg = await maakPagina(ctx);
  await pg.evaluate(() => { document.getElementById('nameInput').value = 'Stefan'; });
  await pg.evaluate(() => document.getElementById('btnCreate').click());
  await pg.waitForFunction(() => /^[A-Z0-9]{4}$/.test(document.getElementById('lobbyCode').textContent));
  await wait(700);

  let na = await pg.evaluate(scherm);
  note(na.uitleg, 'nieuwe speler krijgt uitleg', na.uitlegKop);
  await pg.evaluate(() => document.getElementById('btnUitlegNext').click());
  await wait(300);
  na = await pg.evaluate(scherm);
  note(/levens/i.test(na.uitlegKop), 'tweede uitlegscherm', na.uitlegKop);
  await pg.evaluate(() => document.getElementById('btnUitlegNext').click());
  await wait(300);
  note(!(await pg.evaluate(scherm)).uitleg, 'uitleg sluit na de laatste stap');

  const code = (await pg.textContent('#lobbyCode')).trim();
  const roomVan = () => rooms.get(code);

  /* ---------- lobby past op het scherm ---------- */
  for (let i = 0; i < 3; i++) { await pg.evaluate(() => document.getElementById('btnAddBot').click()); await wait(200); }
  await wait(400);
  const zicht = await pg.evaluate(() => {
    const rijen = [...document.querySelectorAll('.prow')];
    const h = window.innerHeight;
    return {
      aantal: rijen.length,
      zichtbaar: rijen.filter((r) => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= h; }).length,
    };
  });
  note(zicht.zichtbaar === zicht.aantal, 'alle spelers staan zonder scrollen in beeld',
    `${zicht.zichtbaar}/${zicht.aantal}`);
  await pg.screenshot({ path: 'shots/nieuw-lobby.png' });

  /* ---------- tweede bezoek: geen uitleg meer ---------- */
  const tweede = await maakPagina(ctx);          // zelfde browserprofiel
  await tweede.evaluate((c) => {
    document.getElementById('nameInput').value = 'Stefan2';
    const el = document.getElementById('codeInput');
    el.value = c; el.dispatchEvent(new Event('input'));
  }, code);
  await wait(1600);
  note(!(await tweede.evaluate(scherm)).uitleg, 'wie het al eens zag krijgt geen uitleg meer');
  await tweede.evaluate(() => document.getElementById('btnLeave').click());
  await wait(500);

  /* ---------- vangnet: bal weghalen tijdens het potje ---------- */
  await pg.evaluate(() => document.getElementById('btnStart').click());
  await wait(6000);
  const r = roomVan();
  r.balls.length = 0;                            // simuleer de vastloper
  note(r.balls.length === 0, 'bal met opzet verwijderd');
  await wait(4500);
  note(r.balls.filter((b) => !b.dead).length > 0, 'vangnet zet binnen 3 seconden een nieuwe bal in',
    `${r.balls.length} ballen`);

  /* ---------- menu en zelf stoppen ---------- */
  await pg.evaluate(() => document.getElementById('btnMenu').click());
  await wait(300);
  note((await pg.evaluate(scherm)).menu, 'menuknop opent het potjesmenu');
  const afbreekZichtbaar = await pg.evaluate(() =>
    !document.getElementById('btnAbort').classList.contains('hidden'));
  note(afbreekZichtbaar, 'host ziet ook de afbreekknop');

  await pg.evaluate(() => document.getElementById('btnQuit').click());
  await wait(1200);
  na = await pg.evaluate(scherm);
  note(na.actief === 'home', 'stoppen brengt je terug naar het beginscherm', `scherm=${na.actief}`);

  await wait(1500);
  na = await pg.evaluate(scherm);
  note(na.actief === 'home', 'je blijft op het beginscherm, ook al draait het potje door',
    `scherm=${na.actief}`);

  console.log(`\n${failed ? failed + ' checks gefaald' : 'alles goed'}`);
  clearTimeout(kill);
  await browser.close();
  process.exit(failed ? 1 : 0);
});
