/**
 * Controleert dat pijltje-links de peddel ook echt naar links op het scherm beweegt,
 * en pijltje-rechts naar rechts. Doet dit vanaf elke wand in de veelhoek, want het
 * beeld draait mee en daar ging het eerder mis.
 */
const { chromium } = require('playwright');
const { server } = require('../server.js');

const PORT = 4339;
const URL = `http://127.0.0.1:${PORT}/`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const note = (ok, l, x = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  -> ' + x : ''}`);
};

/** x-positie van het midden van je eigen peddel, in schermpixels */
const paddleScreenX = () => {
  const s = window.GFX.state();
  const e = s.arena.edges.find((x) => x.i === s.viewSeat);
  const t = s.localPaddle;
  const wx = e.ax + (e.bx - e.ax) * t;
  const wy = e.ay + (e.by - e.ay) * t;
  const c = Math.cos(s.rot), si = Math.sin(s.rot);
  return s.cx + (wx * c - wy * si) * s.scale;
};

server.listen(PORT, async () => {
  const kill = setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 160000);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.log('JS ERROR:', e.message));
  await pg.goto(URL, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => { document.getElementById('nameInput').value = 'Stefan'; });
  await pg.evaluate(() => document.getElementById('btnCreate').click());
  await pg.waitForFunction(() => /^[A-Z0-9]{4}$/.test(document.getElementById('lobbyCode').textContent));
  for (let i = 0; i < 4; i++) {
    await pg.evaluate(() => document.getElementById('btnAddBot').click());
    await wait(180);
  }
  await pg.evaluate(() => document.getElementById('btnStart').click());
  await wait(5000);

  const seats = await pg.evaluate(() => window.GFX.state().arena.edges.length);
  console.log(`arena met ${seats} wanden\n`);

  for (let seat = 0; seat < seats; seat++) {
    // doe alsof we op deze wand zitten: zelfde code als de supporterweergave gebruikt
    await pg.evaluate((s) => { window.GFX.setViewSeat(s); window.GFX.setLocalTarget(0.5); }, seat);
    await wait(400);

    const start = await pg.evaluate(paddleScreenX);
    await pg.keyboard.down('ArrowLeft');
    await wait(600);
    await pg.keyboard.up('ArrowLeft');
    await wait(200);
    const naLinks = await pg.evaluate(paddleScreenX);

    await pg.keyboard.down('ArrowRight');
    await wait(900);
    await pg.keyboard.up('ArrowRight');
    await wait(200);
    const naRechts = await pg.evaluate(paddleScreenX);

    note(naLinks < start - 5, `wand ${seat}: pijltje links beweegt naar links`,
      `${start.toFixed(0)}px -> ${naLinks.toFixed(0)}px`);
    note(naRechts > naLinks + 5, `wand ${seat}: pijltje rechts beweegt naar rechts`,
      `${naLinks.toFixed(0)}px -> ${naRechts.toFixed(0)}px`);
  }

  console.log(`\n${failed ? failed + ' checks gefaald' : 'alle richtingen kloppen'}`);
  clearTimeout(kill);
  await browser.close();
  process.exit(failed ? 1 : 0);
});
