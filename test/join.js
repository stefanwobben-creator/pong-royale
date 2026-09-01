/**
 * Speelt Ilona's stap na, plus de twee situaties waarin het misging:
 * een oude sessie in het geheugen, en een server die niet antwoordt.
 */
const { chromium } = require('playwright');
const { server } = require('../server.js');

const PORT = 4340;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const note = (ok, l, x = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  -> ' + x : ''}`); };
const phone = { width: 390, height: 844, hasTouch: true, isMobile: true };

const scherm = () => ({
  actief: [...document.querySelectorAll('.screen.active')].map((x) => x.id).join(','),
  fout: document.getElementById('homeErr').textContent,
  banner: document.getElementById('netBanner').classList.contains('hidden')
    ? '' : document.getElementById('netBanner').textContent,
  spelers: [...document.querySelectorAll('.prow .pname')].map((x) => x.textContent),
  lobbycode: document.getElementById('lobbyCode').textContent,
  code: document.getElementById('codeInput').value,
});

server.listen(PORT, async () => {
  const kill = setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 160000);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

  const mk = async (naam, ctx) => {
    const c = ctx || await browser.newContext({ viewport: phone, hasTouch: true });
    const pg = await c.newPage();
    pg.on('pageerror', (e) => console.log(`JS ERROR (${naam}):`, e.message));
    return pg;
  };
  const maakRoom = async (naam) => {
    const pg = await mk(naam);
    await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await pg.evaluate((n) => { document.getElementById('nameInput').value = n; }, naam);
    await pg.evaluate(() => document.getElementById('btnCreate').click());
    await pg.waitForFunction(() => /^[A-Z0-9]{4}$/.test(document.getElementById('lobbyCode').textContent));
    return { pg, code: (await pg.textContent('#lobbyCode')).trim() };
  };

  /* ---------- 1. gewoon meedoen via de gedeelde link ---------- */
  const stefan = await maakRoom('Stefan');
  console.log('room van Stefan:', stefan.code, '\n');

  const ilona = await mk('Ilona');
  await ilona.goto(`http://127.0.0.1:${PORT}/?c=${stefan.code}`, { waitUntil: 'domcontentloaded' });
  await wait(600);
  note((await ilona.evaluate(scherm)).code === stefan.code, 'code uit de link staat vooringevuld');

  await ilona.evaluate(() => { document.getElementById('nameInput').value = 'Ilona'; });
  await ilona.evaluate(() => document.getElementById('btnJoin').click());
  await wait(1500);
  let na = await ilona.evaluate(scherm);
  note(na.actief === 'lobby', 'Ilona komt in de lobby', `scherm=${na.actief} fout="${na.fout}"`);
  note(na.spelers.join(',') === 'Stefan,Ilona', 'ze ziet beide spelers', JSON.stringify(na.spelers));
  note((await stefan.pg.evaluate(scherm)).spelers.length === 2, 'Stefan ziet haar er ook bij');

  /* ---------- 2. oude sessie in het geheugen, nieuwe link ---------- */
  const oud = await maakRoom('OudeRoom');
  const her = await mk('Hergebruik');
  await her.goto(`http://127.0.0.1:${PORT}/?c=${oud.code}`, { waitUntil: 'domcontentloaded' });
  await her.evaluate(() => { document.getElementById('nameInput').value = 'Elise'; });
  await her.evaluate(() => document.getElementById('btnJoin').click());
  await wait(1200);
  note((await her.evaluate(scherm)).lobbycode === oud.code, 'eerst in de oude room beland');

  // zelfde tab, nieuwe link van Stefan (dit ging eerder mis)
  await her.goto(`http://127.0.0.1:${PORT}/?c=${stefan.code}`, { waitUntil: 'domcontentloaded' });
  await wait(900);
  await her.evaluate(() => { document.getElementById('nameInput').value = 'Elise'; });
  await her.evaluate(() => document.getElementById('btnJoin').click());
  await wait(1800);
  na = await her.evaluate(scherm);
  note(na.actief === 'lobby' && na.lobbycode === stefan.code,
    'met een oude sessie in het geheugen kom je toch in de NIEUWE room',
    `scherm=${na.actief} code=${na.lobbycode} verwacht=${stefan.code}`);
  note(na.spelers.length === 3, 'de nieuwe room heeft nu drie spelers', JSON.stringify(na.spelers));

  /* ---------- 3. server antwoordt niet ---------- */
  const dood = await mk('Offline');
  await dood.goto(`http://127.0.0.1:${PORT}/?c=${stefan.code}`, { waitUntil: 'domcontentloaded' });
  await dood.evaluate(() => {
    const Echt = window.WebSocket;
    window.WebSocket = function () {
      const nep = { readyState: 0, close() { this.readyState = 3; }, send() {} };
      setTimeout(() => { nep.readyState = 3; if (nep.onerror) nep.onerror({}); if (nep.onclose) nep.onclose({}); }, 400);
      return nep;
    };
    window.WebSocket.OPEN = Echt.OPEN;
  });
  await dood.evaluate(() => document.getElementById('btnJoin').click());
  await wait(2500);
  na = await dood.evaluate(scherm);
  note(!!na.fout, 'dode verbinding geeft een zichtbare melding', `"${na.fout}"`);
  note(!(await dood.evaluate(() => document.getElementById('btnJoin').disabled)),
    'de knop is daarna weer bruikbaar');

  console.log(`\n${failed ? failed + ' checks gefaald' : 'alles goed'}`);
  clearTimeout(kill);
  await browser.close();
  process.exit(failed ? 1 : 0);
});
