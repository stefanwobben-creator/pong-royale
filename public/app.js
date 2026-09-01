/* =====================================================================
   PONG ROYALE - client: networking, screens, input
   ===================================================================== */

const $ = (id) => document.getElementById(id);
const screens = ['home', 'lobby', 'game', 'over'];
function show(name) {
  screens.forEach((s) => $(s).classList.toggle('active', s === name));
  $('fx').style.display = (name === 'home' || name === 'lobby') ? 'block' : 'none';
}

const PALETTE = ['#00e5ff', '#ff2d95', '#7cff4f', '#ffd23f', '#a06bff', '#ff7a29', '#38ffc7', '#ff5c5c'];

const state = {
  ws: null, me: null, code: null, phase: 'lobby',
  lobby: null, setup: null, myColor: '#00e5ff',
  supporting: null, alive: true, lives: 3,
  reconnectTries: 0, sending: false,
  gen: 0, busy: false, weg: false,
};

/* ------------------------------------------------------------ storage */
const namStore = {
  get() { try { return localStorage.getItem('pr_naam') || ''; } catch (_) { return ''; } },
  set(v) { try { localStorage.setItem('pr_naam', v); } catch (_) {} },
};

const store = {
  get(k, d) { try { return sessionStorage.getItem(k) ?? d; } catch (_) { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (_) {} },
  del(k) { try { sessionStorage.removeItem(k); } catch (_) {} },
};

/* ------------------------------------------------------------ status */
let netTimer = null;
function setNet(text, dood) {
  const el = $('netBanner');
  clearTimeout(netTimer);
  if (!text) { el.classList.add('hidden'); return; }
  el.textContent = text;
  el.classList.toggle('dood', !!dood);
  el.classList.remove('hidden');
}

function busy(on, label) {
  state.busy = on;
  ['btnCreate', 'btnJoin'].forEach((id) => { $(id).disabled = on; });
  $('btnJoin').textContent = on && label === 'join' ? 'Verbinden...' : 'Meedoen';
  $('btnCreate').textContent = on && label === 'create' ? 'Verbinden...' : 'Nieuw spel starten';
}

/* ------------------------------------------------------------ socket */
function connect(then, onFail) {
  const gen = ++state.gen;                       // alleen de nieuwste socket telt
  if (state.ws) { try { state.ws.onclose = null; state.ws.close(); } catch (_) {} }

  let ws;
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
  } catch (_) {
    onFail && onFail('Kan geen verbinding maken met de server.');
    return null;
  }
  state.ws = ws;

  const traag = setTimeout(() => {
    if (state.gen === gen && ws.readyState !== 1) {
      setNet('Server wordt wakker, even geduld...');
    }
  }, 2500);

  const opgeven = setTimeout(() => {
    if (state.gen !== gen || ws.readyState === 1) return;
    try { ws.onclose = null; ws.close(); } catch (_) {}
    setNet(null);
    onFail && onFail('Geen verbinding met de server. Probeer het zo nog een keer.');
  }, 20000);

  const opruimen = () => { clearTimeout(traag); clearTimeout(opgeven); };

  ws.onopen = () => {
    opruimen();
    if (state.gen !== gen) { try { ws.close(); } catch (_) {} return; }
    state.reconnectTries = 0;
    setNet(null);
    then && then();
  };

  ws.onmessage = (e) => {
    if (state.gen !== gen) return;               // bericht van een oude socket
    let m; try { m = JSON.parse(e.data); } catch (_) { return; }
    handle(m);
  };

  ws.onerror = () => {};                          // onclose volgt altijd

  ws.onclose = () => {
    opruimen();
    if (state.gen !== gen) return;                // vervangen door een nieuwere

    if (!state.me) {                              // we zaten nog nergens in
      setNet(null);
      onFail && onFail('De verbinding viel weg voordat je binnen was. Probeer opnieuw.');
      return;
    }
    if (state.reconnectTries >= 12) {
      setNet('Verbinding kwijt. Ververs de pagina.', true);
      return;
    }
    state.reconnectTries++;
    setNet('Verbinding kwijt, opnieuw verbinden...');
    setTimeout(() => connect(
      () => send({ t: 'join', code: state.code, token: state.me.token, name: state.me.name }),
      onFail
    ), Math.min(4000, 400 * state.reconnectTries));
  };

  return ws;
}
function send(msg) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(msg));
}

/* ------------------------------------------------------------ handlers */
function handle(m) {
  // na het verlaten van een potje stromen er nog berichten binnen; negeren
  if (state.weg && m.t !== 'joined') return;
  switch (m.t) {
    case 'joined':
      state.me = m.you;
      state.code = m.code;
      state.myColor = m.you.color;
      store.set('pr_token', m.you.token);
      store.set('pr_code', m.code);
      store.set('pr_name', m.you.name);
      store.set('pr_at', String(Date.now()));
      busy(false);
      setNet(null);
      break;

    case 'lobby':
      state.lobby = m;
      state.phase = m.phase;
      if (m.phase === 'lobby') {
        show('lobby'); GFX.stop(); CEREMONY.stop();
        $('gameMenu').classList.add('hidden');
        if (!uitlegGezien()) toonUitleg(0);
      }
      renderLobby(m);
      break;

    case 'setup':
      state.setup = m;
      show('game');            // eerst zichtbaar, anders meet het canvas 0x0
      GFX.setup(m, state.me.id);
      GFX.resize();
      GFX.start();
      $('supportPanel').classList.add('hidden');
      state.supporting = null;
      state.alive = true;
      buildHud();
      break;

    case 'countdown':
      big(m.n > 0 ? String(m.n) : 'GO!', state.myColor);
      SFX.count(m.n);
      break;

    case 'go':
      break;

    case 's':
      onState(m);
      break;

    case 'over':
      showCeremony(m);
      break;

    case 'left':
      vergeetSessie();
      state.weg = true;
      GFX.stop(); CEREMONY.stop();
      $('gameMenu').classList.add('hidden');
      show('home');
      break;

    case 'error':
      busy(false);
      setNet(null);
      $('homeErr').textContent =
        m.msg === 'Die code bestaat niet'
          ? 'Die code bestaat niet. Kijk of je hem goed hebt overgetikt en of de host het spel nog open heeft.'
          : m.msg === 'Dit potje is al bezig'
            ? 'Dit potje is al begonnen. Vraag de host om na dit potje een nieuwe te starten.'
            : m.msg;
      if (!state.me) {
        // a stale rejoin: forget it so we do not loop
        state.code = null;
        store.del('pr_token'); store.del('pr_code');
        show('home');
      }
      break;
  }
}

/* ------------------------------------------------------------ lobby UI */
function renderLobby(m) {
  $('lobbyCode').textContent = m.code;
  const uitleg = $('shareBox');
  if (uitleg) {
    uitleg.innerHTML = 'Laat iedereen naar <b>' + escapeHtml(location.host) +
      '</b> gaan en daar de code <b>' + escapeHtml(m.code) + '</b> intypen.';
  }
  $('playerCount').textContent = `${m.players.length}/${m.maxPlayers}`;
  const list = $('playerList');
  list.innerHTML = '';
  m.players.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'prow';
    row.innerHTML = `
      <span class="dot" style="background:${p.color};box-shadow:0 0 12px ${p.color}"></span>
      <span class="pname">${escapeHtml(p.name)}</span>
      ${p.bot ? '<span class="tag">bot</span>' : ''}
      ${p.host ? '<span class="tag">host</span>' : ''}
      ${p.id === (state.me && state.me.id) ? '<span class="tag you">jij</span>' : ''}
      ${p.connected ? '' : '<span class="tag">weg</span>'}`;
    if (p.bot && state.me && m.hostId === state.me.id) {
      const x = document.createElement('button');
      x.className = 'kick';
      x.textContent = '\u00d7';
      x.title = 'bot weghalen';
      x.onclick = () => send({ t: 'delbot', id: p.id });
      row.appendChild(x);
    }
    list.appendChild(row);
  });

  const iAmHost = state.me && m.hostId === state.me.id;
  const enough = m.players.length >= m.minPlayers;
  $('botRow').classList.toggle('hidden', !iAmHost);
  $('btnStart').style.display = iAmHost ? '' : 'none';
  $('btnStart').disabled = !enough;
  $('startHint').textContent = iAmHost
    ? (enough ? 'Iedereen binnen? Druk op start.' : `Minimaal ${m.minPlayers} spelers. Zet er een oefenbot bij om alleen te testen.`)
    : 'Wachten tot de host start...';

  // colours
  const taken = new Set(m.players.filter((p) => !state.me || p.id !== state.me.id).map((p) => p.color));
  const cp = $('colorPicker');
  cp.innerHTML = '';
  PALETTE.forEach((hex, i) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (hex === (state.me && state.myColor) ? ' on' : '') + (taken.has(hex) ? ' taken' : '');
    b.style.background = hex;
    b.onclick = () => { send({ t: 'color', i }); state.myColor = hex; };
    cp.appendChild(b);
  });
  const meRow = m.players.find((p) => state.me && p.id === state.me.id);
  if (meRow) state.myColor = meRow.color;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------ game HUD */
function buildHud() {
  const me = state.setup.players.find((p) => p.id === state.me.id);
  $('hudName').textContent = me ? me.name : '';
  $('hudName').style.color = me ? me.color : '#fff';
  const lv = $('hudLives');
  lv.style.color = me ? me.color : '#fff';
  lv.innerHTML = '';
  for (let i = 0; i < state.setup.lives; i++) {
    const d = document.createElement('span');
    d.className = 'life';
    lv.appendChild(d);
  }
}

function onState(m) {
  if (!state.me || !state.setup) return;
  state.phase = m.ph;
  GFX.update(m);
  GFX.handleEvents(m.ev);

  const row = m.p.find((r) => r[0] === state.me.id);
  if (!row) return;
  const lives = row[2], hype = row[3], superMs = row[4], alive = !!row[5];

  const pips = $('hudLives').children;
  for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('off', i >= lives);
  $('hypeBar').style.width = (superMs > 0 ? 100 : hype) + '%';
  $('hypeWrap').style.opacity = alive ? 1 : .25;

  if (alive !== state.alive) {
    state.alive = alive;
    if (!alive) enterSupportMode(m);
  }
  if (!alive) refreshSupportList(m);
}

/* ------------------------------------------------------------ support */
function enterSupportMode(m) {
  $('supportPanel').classList.remove('hidden');
  GFX.setSpectator(true);
  toast('Je ligt eruit. Kies een held en juich hem naar de winst.');
}

function refreshSupportList(m) {
  const wrap = $('supportList');
  const aliveIds = m.p.filter((r) => r[5] === 1).map((r) => r[0]);
  const sig = aliveIds.join(',') + '|' + state.supporting;
  if (wrap.dataset.sig === sig) return;
  wrap.dataset.sig = sig;
  wrap.innerHTML = '';
  aliveIds.forEach((id) => {
    const p = state.setup.players.find((x) => x.id === id);
    if (!p) return;
    const b = document.createElement('button');
    b.className = 'pick' + (state.supporting === id ? ' on' : '');
    b.style.color = p.color;
    b.textContent = p.name;
    b.onclick = () => {
      state.supporting = id;
      send({ t: 'support', id });
      GFX.setViewSeat(p.seat);
      $('btnCheer').classList.remove('hidden');
      $('btnCheer').textContent = 'JUICH VOOR ' + p.name.toUpperCase();
      wrap.dataset.sig = '';
      refreshSupportList(m);
    };
    wrap.appendChild(b);
  });
  if (state.supporting && !aliveIds.includes(state.supporting)) {
    state.supporting = null;
    $('btnCheer').classList.add('hidden');
    toast('Je held ligt eruit. Kies een nieuwe.');
  }
}

/* ------------------------------------------------------------ ceremony */
function showCeremony(m) {
  GFX.stop();
  show('over');
  const win = m.podium.find((p) => p.rank === 1);
  const color = win ? win.color : '#00e5ff';
  $('champName').textContent = win ? win.name : 'Niemand';
  $('champName').style.color = color;
  $('champName').style.textShadow = `0 0 30px ${color}, 0 0 70px ${color}`;
  const mins = Math.floor(m.duration / 60), secs = Math.round(m.duration % 60);
  const fans = win && win.fans.length ? ` &middot; aangemoedigd door ${escapeHtml(win.fans.join(', '))}` : '';
  $('champSub').innerHTML = `${win ? win.saves : 0} saves &middot; potje van ${mins ? mins + 'm ' : ''}${secs}s${fans}`;

  const medals = ['&#129351;', '&#129352;', '&#129353;'];
  const st = $('podiumStats');
  st.innerHTML = '';
  m.podium.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'srow';
    row.innerHTML = `
      <span class="srank">${p.rank <= 3 ? medals[p.rank - 1] : p.rank + '.'}</span>
      <span class="dot" style="background:${p.color};box-shadow:0 0 10px ${p.color}"></span>
      <span class="sname">${escapeHtml(p.name)}</span>
      <span class="sval">${p.saves} saves &middot; ${p.supers}&times; super</span>`;
    st.appendChild(row);
  });

  const iAmHost = state.lobby && state.me && state.lobby.hostId === state.me.id;
  $('btnAgain').style.display = iAmHost ? '' : 'none';

  CEREMONY.start($('ceremony'), color, m.podium.map((p) => p.color));
  SFX.fanfare();
}

/* ------------------------------------------------------------ overlays */
let bigTimer = null;
function big(text, color) {
  const el = $('bigText');
  el.textContent = text;
  el.style.color = color || '#fff';
  el.style.textShadow = `0 0 30px ${color || '#0ef'}`;
  el.style.transition = 'none';
  el.style.opacity = '1';
  el.style.transform = 'scale(1.25)';
  requestAnimationFrame(() => {
    el.style.transition = 'opacity .55s ease, transform .55s cubic-bezier(.2,.9,.3,1)';
    el.style.opacity = '0';
    el.style.transform = 'scale(.85)';
  });
  clearTimeout(bigTimer);
  bigTimer = setTimeout(() => { el.style.opacity = '0'; }, 700);
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

GFX.onAnnounce((text, color) => toast(text));

/* ------------------------------------------------------------ input */
function bindInput() {
  const board = $('board');
  let active = false;

  const point = (e) => {
    const r = board.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  };
  const move = (e) => {
    if (!active) return;
    e.preventDefault();
    const { x, y } = point(e);
    GFX.setLocalTarget(GFX.paddleParamFromScreen(x, y));
  };

  board.addEventListener('touchstart', (e) => { active = true; SFX.boot(); move(e); }, { passive: false });
  board.addEventListener('touchmove', move, { passive: false });
  board.addEventListener('touchend', () => { active = false; });
  board.addEventListener('mousedown', (e) => { active = true; SFX.boot(); move(e); });
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', () => { active = false; });

  // keyboard for laptops
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    if (e.key === ' ' && !$('btnCheer').classList.contains('hidden')) doCheer();
  });
  window.addEventListener('keyup', (e) => { keys[e.key] = false; });
  setInterval(() => {
    let d = 0;
    if (keys.ArrowLeft || keys.a || keys.A) d -= 1;
    if (keys.ArrowRight || keys.d || keys.D) d += 1;
    if (d) GFX.nudgeTarget(d, 0.028);
  }, 16);

  // send input at ~30Hz
  let last = -1;
  setInterval(() => {
    const t = GFX.getLocalTarget();
    if (Math.abs(t - last) > 0.0015) { last = t; send({ t: 'in', p: t }); }
  }, 33);
}

function doCheer() {
  send({ t: 'cheer' });
  SFX.cheer();
  const b = $('btnCheer');
  b.style.transform = 'scale(.93)';
  setTimeout(() => { b.style.transform = ''; }, 70);
  if (navigator.vibrate) navigator.vibrate(12);
}

/* ------------------------------------------------------------ uitleg */
const STAPPEN = [
  {
    kop: 'Jij verdedigt een wand',
    tekst: 'Jouw wand ligt altijd <b>onderaan</b> je scherm. Sleep je vinger over het scherm om je peddel heen en weer te bewegen. Op een laptop: pijltjestoetsen of A en D.',
    beeld: '<svg width="150" height="130" viewBox="0 0 150 130" aria-hidden="true">' +
      '<polygon points="75,14 141,116 9,116" fill="rgba(40,80,180,.25)" stroke="rgba(150,205,255,.45)" stroke-width="2"/>' +
      '<line x1="52" y1="116" x2="98" y2="116" stroke="#00e5ff" stroke-width="8" stroke-linecap="round"/>' +
      '<circle cx="80" cy="66" r="7" fill="#fff"/>' +
      '<path d="M52 128 H98" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-dasharray="4 4"/>' +
      '<path d="M46 128 l7 -5 v10 z M104 128 l-7 -5 v10 z" fill="rgba(255,255,255,.5)"/>' +
      '</svg>',
  },
  {
    kop: 'Drie levens, dan supporter',
    tekst: 'Glipt de bal langs je peddel, dan ben je een leven kwijt. Bij <b>nul</b> lig je eruit, kies je een held en juich je hem naar de winst. Wie als laatste overblijft, wint.',
    beeld: '<svg width="150" height="80" viewBox="0 0 150 80" aria-hidden="true">' +
      '<circle cx="42" cy="26" r="9" fill="#00e5ff"/><circle cx="75" cy="26" r="9" fill="#00e5ff"/>' +
      '<circle cx="108" cy="26" r="9" fill="rgba(255,255,255,.16)"/>' +
      '<text x="75" y="66" text-anchor="middle" fill="#ffd23f" font-family="Rajdhani,sans-serif" font-size="17" font-weight="700">JUICH!</text>' +
      '</svg>',
  },
];
let uitlegStap = 0;

function uitlegGezien() {
  try { return localStorage.getItem('pr_uitleg') === '1'; } catch (_) { return true; }
}
function uitlegOnthouden() {
  try { localStorage.setItem('pr_uitleg', '1'); } catch (_) {}
}

function toonUitleg(vanaf) {
  uitlegStap = vanaf || 0;
  tekenUitleg();
  $('uitleg').classList.remove('hidden');
}

function tekenUitleg() {
  const s = STAPPEN[uitlegStap];
  $('uitlegStap').innerHTML =
    '<div class="uitleg-kop">' + s.kop + '</div>' +
    '<div class="uitleg-beeld">' + s.beeld + '</div>' +
    '<div class="uitleg-tekst">' + s.tekst + '</div>';
  $('btnUitlegNext').textContent = uitlegStap === STAPPEN.length - 1 ? 'Duidelijk' : 'Volgende';
  const punten = document.querySelectorAll('.uitleg-punten span');
  punten.forEach((p, i) => p.classList.toggle('on', i === uitlegStap));
}

function sluitUitleg() {
  $('uitleg').classList.add('hidden');
  uitlegOnthouden();
}

/* ------------------------------------------------------------ buttons */
function vergeetSessie() {
  state.weg = false;
  state.me = null;
  state.code = null;
  state.reconnectTries = 0;
  store.del('pr_token'); store.del('pr_code'); store.del('pr_at');
}

function toonFout(msg) {
  busy(false);
  $('homeErr').textContent = msg;
}

function bindUI() {
  const nameEl = $('nameInput');
  nameEl.value = namStore.get() || store.get('pr_name', '') || '';

  $('btnCreate').onclick = () => {
    if (state.busy) return;
    SFX.boot();
    $('homeErr').textContent = '';
    vergeetSessie();
    busy(true, 'create');
    connect(() => send({ t: 'create', name: nameEl.value }), toonFout);
  };

  function doeMee() {
    if (state.busy) return;
    SFX.boot();
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length < 4) {
      $('homeErr').textContent = 'Vul eerst de code van 4 tekens in die de host je gaf.';
      $('codeInput').focus();
      return;
    }
    const naam = nameEl.value.trim();
    if (naam) namStore.set(naam);
    $('homeErr').textContent = '';
    vergeetSessie();
    state.code = code;
    busy(true, 'join');
    connect(() => send({ t: 'join', code, name: naam }), toonFout);
  }

  $('btnJoin').onclick = doeMee;

  // codes bevatten nooit I, O, 0 of 1, dus die filteren we er meteen uit
  const CODE_TEKENS = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;
  let laatsteAuto = '';

  const codeEl = $('codeInput');
  codeEl.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(CODE_TEKENS, '').slice(0, 4);
    $('homeErr').textContent = '';
    if (e.target.value.length === 4 && e.target.value !== laatsteAuto) {
      laatsteAuto = e.target.value;
      codeEl.blur();                      // toetsenbord weg, dan zie je wat er gebeurt
      setTimeout(() => doeMee(), 150);    // vier tekens = meteen naar binnen
    }
  });

  const opEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); doeMee(); } };
  codeEl.addEventListener('keydown', opEnter);
  nameEl.addEventListener('keydown', opEnter);
  nameEl.addEventListener('change', () => namStore.set(nameEl.value.trim()));

  $('btnStart').onclick = () => { SFX.boot(); send({ t: 'start' }); };
  $('btnAddBot').onclick = () => send({ t: 'addbot', level: Number($('botLevel').value) });
  $('btnAgain').onclick = () => { CEREMONY.stop(); send({ t: 'again' }); };
  $('btnHome').onclick = () => { store.del('pr_token'); location.href = location.pathname; };
  $('btnLeave').onclick = () => { send({ t: 'leave' }); vergeetSessie(); state.weg = true; show('home'); };
  $('btnCheer').onclick = doCheer;

  $('btnMenu').onclick = () => {
    const host = state.lobby && state.me && state.lobby.hostId === state.me.id;
    $('btnAbort').classList.toggle('hidden', !host);
    $('gameMenu').classList.remove('hidden');
  };
  $('btnCloseMenu').onclick = () => $('gameMenu').classList.add('hidden');
  $('btnAbort').onclick = () => { $('gameMenu').classList.add('hidden'); send({ t: 'abort' }); };
  $('btnQuit').onclick = () => { $('gameMenu').classList.add('hidden'); send({ t: 'leave' }); };

  $('btnUitleg').onclick = () => toonUitleg(0);
  $('btnUitlegSkip').onclick = sluitUitleg;
  $('btnUitlegNext').onclick = () => {
    if (uitlegStap < STAPPEN.length - 1) { uitlegStap++; tekenUitleg(); } else sluitUitleg();
  };

  $('btnSound').onclick = () => {
    const on = SFX.toggle();
    $('btnSound').classList.toggle('off', !on);
  };

  $('btnShare').onclick = async () => {
    const bericht = uitnodiging();
    try {
      if (navigator.share) await navigator.share({ text: bericht });
      else {
        await navigator.clipboard.writeText(bericht);
        $('startHint').textContent = 'Uitnodiging gekopieerd, plak hem in de groepsapp.';
      }
    } catch (_) {}
  };

  $('btnQR').onclick = () => {
    const wrap = $('qrWrap');
    if (!wrap.classList.contains('hidden')) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    $('qrUrl').textContent = joinUrl();
    if (window.QRCode) return drawQR();
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.onload = drawQR;
    s.onerror = () => { $('qrUrl').textContent = joinUrl() + ' (QR kon niet laden)'; };
    document.head.appendChild(s);
  };
}

function uitnodiging() {
  const site = location.host + (location.pathname === '/' ? '' : location.pathname);
  return [
    'Doe mee met PONG ROYALE',
    '',
    '1. Ga naar ' + site,
    '2. Typ de code: ' + (state.code || ''),
    '',
    'Meer hoef je niet te doen.',
  ].join('\n');
}

function joinUrl() {
  return `${location.origin}${location.pathname}?c=${state.code || ''}`;
}

function drawQR() {
  const box = $('qr');
  box.innerHTML = '';
  new window.QRCode(box, { text: joinUrl(), width: 190, height: 190, correctLevel: window.QRCode.CorrectLevel.M });
}

/* ------------------------------------------------------------ boot */
window.addEventListener('load', () => {
  GFX.initBoard($('board'));
  bindUI();
  bindInput();
  show('home');

  const params = new URLSearchParams(location.search);
  const c = (params.get('c') || '').toUpperCase();
  if (c) $('codeInput').value = c.slice(0, 4);

  // Alleen terugspringen in een potje dat NET nog liep en waar deze link ook over gaat.
  // Anders sleep je een oude room mee en lijkt het alsof meedoen niets doet.
  const token = store.get('pr_token', null);
  const savedCode = store.get('pr_code', null);
  const savedAt = Number(store.get('pr_at', 0)) || 0;
  const vers = Date.now() - savedAt < 10 * 60 * 1000;
  const zelfdeRoom = !c || c === savedCode;

  if (token && savedCode && vers && zelfdeRoom) {
    state.code = savedCode;
    connect(
      () => send({ t: 'join', code: savedCode, token, name: store.get('pr_name', 'Speler') }),
      () => { vergeetSessie(); show('home'); }
    );
  } else if (token) {
    vergeetSessie();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) GFX.resize();
});

window.__handle = handle; // debug/test hook
