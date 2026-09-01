/** Checks that a player who loses connection can rejoin the same seat. */
const WebSocket = require('ws');
const { server } = require('../server.js');
const PORT = 4322;
const log = (ok, l, x = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  -> ' + x : ''}`);

function client(onMsg) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.on('message', (r) => onMsg(JSON.parse(r.toString()), ws));
  return ws;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

server.listen(PORT, async () => {
  let code = null, aId = null, aToken = null, seatBefore = null, seatAfter = null;
  let ok = { setup: false, rejoined: false };

  const a = client((m) => {
    if (m.t === 'joined') { code = m.code; aId = m.you.id; aToken = m.you.token; }
    if (m.t === 'setup') { ok.setup = true; seatBefore = m.players.find((p) => p.id === aId).seat; }
  });
  a.on('open', () => a.send(JSON.stringify({ t: 'create', name: 'Anna' })));
  await wait(400);

  const b = client(() => {});
  b.on('open', () => b.send(JSON.stringify({ t: 'join', code, name: 'Bram' })));
  const c = client(() => {});
  c.on('open', () => c.send(JSON.stringify({ t: 'join', code, name: 'Cas' })));
  await wait(500);

  a.send(JSON.stringify({ t: 'start' }));
  await wait(1500);
  log(ok.setup, 'potje gestart met 3 spelers', 'seat ' + seatBefore);

  a.terminate();               // simulate a phone locking / wifi hiccup
  await wait(900);

  const a2 = client((m) => {
    if (m.t === 'joined') ok.rejoined = m.you.id === aId;
    if (m.t === 'setup') seatAfter = m.players.find((p) => p.id === aId).seat;
  });
  a2.on('open', () => a2.send(JSON.stringify({ t: 'join', code, token: aToken, name: 'Anna' })));
  await wait(1200);

  log(ok.rejoined, 'zelfde speler-id terug na herverbinden');
  log(seatAfter === seatBefore, 'zelfde wand terug', `${seatBefore} -> ${seatAfter}`);

  const failed = [ok.setup, ok.rejoined, seatAfter === seatBefore].filter((x) => !x).length;
  process.exit(failed ? 1 : 0);
});
