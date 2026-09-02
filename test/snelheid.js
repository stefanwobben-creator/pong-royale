/**
 * Meet hoe snel je peddel loopt met de pijltjestoetsen, en vergelijkt dat
 * met de maximumsnelheid die de server toestaat. Die twee horen gelijk te zijn.
 */
const { chromium } = require('playwright');
const { server, CFG } = require('../server.js');

const PORT = 4344;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const note = (ok, l, x = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  -> ' + x : ''}`); };

// stand van MIJN peddel volgens de server (niet de voorspelling van de client)
const serverPeddel = () => {
  const s = window.GFX.state();
  const p = window.GFX.players().get(s.meId);
  return p ? p.paddle : null;
};

server.listen(PORT, async () => {
  const kill = setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 150000);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const pg = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  pg.on('pageerror', (e) => console.log('JS ERROR:', e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => { document.getElementById('nameInput').value = 'Stefan'; });
  await pg.evaluate(() => document.getElementById('btnCreate').click());
  await pg.waitForFunction(() => /^[A-Z0-9]{4}$/.test(document.getElementById('lobbyCode').textContent));
  await pg.evaluate(() => document.getElementById('btnAddBot').click());
  await wait(400);
  await pg.evaluate(() => document.getElementById('btnStart').click());
  await wait(5200);

  // eerst netjes in het midden gaan staan
  await pg.evaluate(() => window.GFX.setLocalTarget(0.5));
  await wait(900);

  // hele wand oversteken en de snelheid uit het rechte stuk halen
  const oversteek = async (heen, terug) => {
    await pg.keyboard.down(heen);
    await wait(900);                       // eerst helemaal naar een uiteinde
    await pg.keyboard.up(heen);
    await wait(500);

    const punten = [];
    await pg.keyboard.down(terug);
    const t0 = Date.now();
    for (let i = 0; i < 30; i++) {
      punten.push({ t: (Date.now() - t0) / 1000, p: await pg.evaluate(serverPeddel) });
      await wait(25);
    }
    await pg.keyboard.up(terug);
    await wait(400);

    const start = punten[0].p;
    const eind = punten[punten.length - 1].p;
    const reis = Math.abs(eind - start);
    // alleen het stuk tussen 20% en 80% van de reis telt mee
    const binnen = punten.filter((q) => {
      const d = Math.abs(q.p - start);
      return d > reis * 0.2 && d < reis * 0.8;
    });
    if (binnen.length < 3) return 0;
    const a = binnen[0], b = binnen[binnen.length - 1];
    return Math.abs(b.p - a.p) / (b.t - a.t);
  };

  const naarRechts = await oversteek('ArrowLeft', 'ArrowRight');
  const naarLinks = await oversteek('ArrowRight', 'ArrowLeft');
  const max = CFG.paddleSpeed;
  console.log(`server staat maximaal ${max} wandbreedtes per seconde toe`);
  console.log(`gemeten rechts: ${naarRechts.toFixed(2)}   links: ${naarLinks.toFixed(2)}`);

  note(naarRechts > max * 0.85, 'pijltje rechts haalt bijna de maximumsnelheid',
    `${naarRechts.toFixed(2)} van ${max}`);
  note(naarLinks > max * 0.85, 'pijltje links haalt bijna de maximumsnelheid',
    `${naarLinks.toFixed(2)} van ${max}`);

  // en de bot dan?
  const botSnelheid = await pg.evaluate(() => {
    const s = window.GFX.state();
    let bot = null;
    s.players.forEach((p) => { if (p.id !== s.meId) bot = p; });
    return bot ? bot.paddle : null;
  });
  note(botSnelheid !== null, 'bot bestaat in de arena');

  console.log(`\n${failed ? failed + ' checks gefaald' : 'alles goed'}`);
  clearTimeout(kill);
  await browser.close();
  process.exit(failed ? 1 : 0);
});
