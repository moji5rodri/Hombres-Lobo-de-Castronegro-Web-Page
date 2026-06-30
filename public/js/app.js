/* ════════════════════════════════════════════════════════════════════════
   CASTRONEGRO — Cliente
   ════════════════════════════════════════════════════════════════════════ */
const socket = io();

/* ── Estado local ──────────────────────────────────────────────────── */
let myNickname = '';
let myId = null;
let myRoomCode = null;
let mySessionToken = null; // token estable de sesión, persiste en sessionStorage
let isHost = false;
let state = null;          // último 'state' recibido del server
let myRole = null;
let myRoleLabel = '';
let lastBroadcastState = null; // para detectar transiciones noche/día
let countdownInterval = null;
let wolfVotesCache = {};
let dayVotesCache = {};
let chatGeneral = [];
let chatWolf = [];
let chatDead = [];
let narratorLines = [];
let activeChatTab = 'general';
let localEnabledRoles = ['vidente','bruja','cazador','cupido'];
let localWolfCount = 1;
let cupidoSelection = [];

/* ── Helpers de sessionStorage ─────────────────────────────────────── */
const SS = {
  get: k => sessionStorage.getItem('cng_' + k),
  set: (k, v) => sessionStorage.setItem('cng_' + k, v),
  del: k => sessionStorage.removeItem('cng_' + k),
  clear: () => ['token','room','nick'].forEach(k => sessionStorage.removeItem('cng_' + k)),
};

/* ── Metadatos de roles ────────────────────────────────────────────── */
const ROLE_META = {
  aldeano:  { label: 'Aldeano',     color: 'var(--parchment-2)', desc: 'Un alma honesta sin poderes especiales. Tu arma es la palabra y la sospecha.' },
  lobo:     { label: 'Hombre Lobo', color: 'var(--blood-bright)', desc: 'Cada noche, junto a tu manada, elige una víctima para devorar.' },
  vidente:  { label: 'Vidente',     color: 'var(--moon-glow)', desc: 'Cada noche puedes espiar el verdadero rol de un jugador.' },
  bruja:    { label: 'Bruja',       color: '#7fae6a', desc: 'Posees dos pociones: una de vida y una de muerte. Úsalas con sabiduría, una sola vez cada una.' },
  cazador:  { label: 'Cazador',     color: 'var(--gold-bright)', desc: 'Si mueres, puedes llevarte a alguien contigo con tu última flecha.' },
  cupido:   { label: 'Cupido',      color: '#d97b9c', desc: 'La primera noche unes a dos almas en un amor que las atará para siempre.' },
  ladron:   { label: 'Ladrón',      color: '#c9a227', desc: 'La primera noche puedes robar el rol de otro jugador.' },
  nina:     { label: 'Niña',        color: '#8fb3d9', desc: 'Puedes espiar en secreto a los lobos durante la noche, sin que se den cuenta.' },
  alguacil: { label: 'Alguacil',    color: 'var(--gold)', desc: 'Tu voto vale doble durante las votaciones del pueblo.' },
  salvador: { label: 'Salvador',    color: '#6a9e7f', desc: 'Cada noche eliges a alguien para protegerlo del ataque de los lobos.' },
};
const OPTIONAL_ROLES = ['vidente','bruja','cazador','cupido','ladron','nina','alguacil','salvador'];

/* ── Helpers DOM ───────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
}
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ════════════════════════════════════════════════════════════════════
   ICONOGRAFÍA SVG — emblemas tipo grabado / xilografía
   ════════════════════════════════════════════════════════════════════ */
function ringFrame(inner, opts={}){
  const stroke = opts.stroke || 'var(--gold)';
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="46" fill="none" stroke="${stroke}" stroke-width="2" opacity=".8"/>
    <circle cx="50" cy="50" r="40" fill="none" stroke="${stroke}" stroke-width="1" opacity=".5"/>
    ${inner}
  </svg>`;
}
const ICONS = {
  moon: (s='var(--gold-bright)') => `<path d="M62 30 A26 26 0 1 0 62 70 A20 20 0 1 1 62 30 Z" fill="${s}"/>`,
  sun: (s='var(--sun-glow)') => `<g stroke="${s}" stroke-width="3" stroke-linecap="round"><circle cx="50" cy="50" r="14" fill="${s}" stroke="none"/>${[0,45,90,135,180,225,270,315].map(a=>`<line x1="50" y1="24" x2="50" y2="34" transform="rotate(${a} 50 50)"/>`).join('')}</g>`,
  wolf: (s='var(--blood-bright)') => `<path d="M30 62 L36 36 L46 46 L50 32 L54 46 L64 36 L70 62 Q70 70 60 72 L56 64 L50 70 L44 64 L40 72 Q30 70 30 62 Z" fill="${s}"/><circle cx="42" cy="50" r="2.4" fill="var(--void)"/><circle cx="58" cy="50" r="2.4" fill="var(--void)"/>`,
  eye: (s='var(--moon-glow)') => `<path d="M26 50 Q50 30 74 50 Q50 70 26 50 Z" fill="none" stroke="${s}" stroke-width="3"/><circle cx="50" cy="50" r="9" fill="${s}"/>`,
  flask: (s='#7fae6a') => `<path d="M44 28 H56 V42 L66 64 Q70 72 60 72 H40 Q30 72 34 64 L44 42 Z" fill="none" stroke="${s}" stroke-width="3" stroke-linejoin="round"/><circle cx="46" cy="60" r="3" fill="${s}"/><circle cx="56" cy="64" r="2" fill="${s}"/>`,
  bow: (s='var(--gold-bright)') => `<path d="M36 26 Q56 50 36 74" fill="none" stroke="${s}" stroke-width="3"/><line x1="36" y1="26" x2="68" y2="64" stroke="${s}" stroke-width="2"/><line x1="36" y1="74" x2="68" y2="64" stroke="${s}" stroke-width="2"/><line x1="30" y1="50" x2="72" y2="50" stroke="${s}" stroke-width="2"/>`,
  heart: (s='#d97b9c') => `<path d="M50 70 Q22 50 30 36 Q38 24 50 38 Q62 24 70 36 Q78 50 50 70 Z" fill="${s}"/><line x1="20" y1="30" x2="80" y2="70" stroke="var(--void)" stroke-width="2.4"/>`,
  mask: (s='#c9a227') => `<path d="M26 44 Q50 28 74 44 Q74 60 60 64 Q50 70 40 64 Q26 60 26 44 Z" fill="none" stroke="${s}" stroke-width="3"/><circle cx="40" cy="46" r="3.5" fill="${s}"/><circle cx="60" cy="46" r="3.5" fill="${s}"/>`,
  girl: (s='#8fb3d9') => `<circle cx="50" cy="40" r="12" fill="none" stroke="${s}" stroke-width="3"/><path d="M34 74 Q50 56 66 74" fill="none" stroke="${s}" stroke-width="3"/>`,
  star: (s='var(--gold)') => `<path d="M50 26 L58 44 L78 46 L62 58 L68 78 L50 66 L32 78 L38 58 L22 46 L42 44 Z" fill="${s}"/>`,
  shield: (s='#6a9e7f') => `<path d="M50 26 L72 34 V52 Q72 70 50 78 Q28 70 28 52 V34 Z" fill="none" stroke="${s}" stroke-width="3"/><path d="M50 38 V64 M40 50 H60" stroke="${s}" stroke-width="2.4"/>`,
  skull: (s='var(--blood-glow)') => `<circle cx="50" cy="44" r="20" fill="${s}"/><rect x="40" y="58" width="20" height="12" rx="2" fill="${s}"/><circle cx="42" cy="42" r="5" fill="var(--void)"/><circle cx="58" cy="42" r="5" fill="var(--void)"/>`,
};
function roleIconSVG(role, size=46){
  const meta = ROLE_META[role] || ROLE_META.aldeano;
  const map = { lobo:'wolf', vidente:'eye', bruja:'flask', cazador:'bow', cupido:'heart', ladron:'mask', nina:'girl', alguacil:'star', salvador:'shield', aldeano:'star' };
  const fn = ICONS[map[role]] || ICONS.star;
  return `<div style="width:${size}px;height:${size}px;">${ringFrame(fn(meta.color), { stroke: meta.color })}</div>`;
}
function moonEmblemSVG(){
  return ringFrame(`${ICONS.moon('var(--gold-bright)')}<path d="M30 70 L38 50 L46 58 L50 46 L54 58 L62 50 L70 70" fill="none" stroke="var(--blood-bright)" stroke-width="2.4" stroke-linejoin="round" opacity=".85"/>`, { stroke:'var(--gold)' });
}
function roleCardFrontSVG(){
  return `<svg viewBox="0 0 220 320" xmlns="http://www.w3.org/2000/svg">
    <rect width="220" height="320" fill="#1c1610"/>
    <rect x="8" y="8" width="204" height="304" fill="none" stroke="var(--gold-dim)" stroke-width="1.5"/>
    <circle cx="110" cy="160" r="46" fill="none" stroke="var(--gold-dim)" stroke-width="1.5"/>
    <path d="M122 134 A26 26 0 1 0 122 186 A20 20 0 1 1 122 134 Z" fill="var(--gold-dim)" opacity=".6"/>
  </svg>`;
}
function roleCardBackSVG(role){
  const meta = ROLE_META[role] || ROLE_META.aldeano;
  const map = { lobo:'wolf', vidente:'eye', bruja:'flask', cazador:'bow', cupido:'heart', ladron:'mask', nina:'girl', alguacil:'star', salvador:'shield', aldeano:'star' };
  const fn = ICONS[map[role]] || ICONS.star;
  return `<svg viewBox="0 0 220 320" xmlns="http://www.w3.org/2000/svg">
    <rect width="220" height="320" fill="var(--parchment)"/>
    <rect x="7" y="7" width="206" height="306" fill="none" stroke="${meta.color}" stroke-width="2"/>
    <rect x="14" y="14" width="192" height="292" fill="none" stroke="var(--iron)" stroke-width="1"/>
    <rect x="0" y="22" width="220" height="30" fill="${meta.color}" opacity=".18"/>
    <text x="110" y="42" text-anchor="middle" font-family="Cinzel,serif" font-size="16" font-weight="700" fill="#2a1f0c">${meta.label.toUpperCase()}</text>
    <circle cx="110" cy="150" r="58" fill="none" stroke="${meta.color}" stroke-width="2"/>
    <circle cx="110" cy="150" r="50" fill="none" stroke="${meta.color}" stroke-width="1" opacity=".5"/>
    <g transform="translate(60 100) scale(1)">${fn(meta.color)}</g>
    <line x1="30" y1="260" x2="190" y2="260" stroke="var(--iron)" stroke-width="1"/>
    <text x="110" y="282" text-anchor="middle" font-family="Cinzel,serif" font-size="11" fill="#5a4a32">CASTRONEGRO</text>
  </svg>`;
}
function starsBackground(n=40){
  let out = '';
  for(let i=0;i<n;i++){
    const x = Math.random()*100, y = Math.random()*100, d = (Math.random()*3).toFixed(2);
    out += `<circle cx="${x}%" cy="${y}%" r="${(Math.random()*1.4+0.3).toFixed(2)}" fill="#fff" opacity="${(Math.random()*.6+.2).toFixed(2)}" style="animation:twinkle ${2+Math.random()*3}s ease-in-out ${d}s infinite;"/>`;
  }
  return `<svg width="100%" height="100%" style="position:absolute;inset:0;">${out}</svg>`;
}

/* ════════════════════════════════════════════════════════════════════
   PANTALLA: NICKNAME
   ════════════════════════════════════════════════════════════════════ */
$('emblem-nickname').innerHTML = moonEmblemSVG();
$('emblem-menu').innerHTML = moonEmblemSVG();
$('emblem-gameover').innerHTML = moonEmblemSVG();

function goToMenuWithNickname(v){
  myNickname = v;
  SS.set('nick', v);
  $('menu-nickname-display').textContent = v;
  $('nickname-error').textContent = '';
  showScreen('screen-menu');
}

$('btn-nickname-continue').addEventListener('click', () => {
  const v = $('nickname-input').value.trim();
  if (!v){ $('nickname-error').textContent = 'Escribe un apodo para continuar.'; return; }
  // Limpiar sesión anterior si el usuario escribe un nombre nuevo manualmente
  SS.clear();
  goToMenuWithNickname(v);
});
$('nickname-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-nickname-continue').click(); });

// Al cargar la página: intentar reconectar si hay sesión guardada, si no, restaurar solo el nick
(function restoreSession(){
  const savedToken = SS.get('token');
  const savedRoom  = SS.get('room');
  const savedNick  = SS.get('nick');

  if (savedToken && savedRoom && savedNick) {
    // Hay sesión activa — intentar reconectar a la sala
    myNickname = savedNick;
    mySessionToken = savedToken;
    $('menu-nickname-display').textContent = savedNick;
    // Mostrar pantalla de nickname vacía temporalmente mientras intentamos reconectar
    // (el usuario verá el spinner/lobby si tiene éxito, o el menú si falla)
    socket.emit('reconnectPlayer', { sessionToken: savedToken, code: savedRoom });
  } else if (savedNick) {
    // Solo tiene nombre guardado, no sesión de sala → ir al menú directamente
    goToMenuWithNickname(savedNick);
  }
  // Si no hay nada guardado, se queda en la pantalla de nickname (comportamiento default)
})();

/* ════════════════════════════════════════════════════════════════════
   PANTALLA: MENÚ
   ════════════════════════════════════════════════════════════════════ */
$('btn-create-room').addEventListener('click', () => {
  socket.emit('createRoom', { nickname: myNickname, sessionToken: mySessionToken });
});
$('btn-show-join').addEventListener('click', () => {
  $('join-fields').classList.remove('hidden');
});
$('btn-join-room').addEventListener('click', () => {
  const code = $('room-code-input').value.trim().toUpperCase();
  if (!code){ $('menu-error').textContent = 'Ingresa un código de sala.'; return; }
  socket.emit('joinRoom', { nickname: myNickname, code, sessionToken: mySessionToken });
});

socket.on('roomCreated', ({ code, sessionToken }) => {
  myRoomCode = code;
  mySessionToken = sessionToken;
  isHost = true;
  SS.set('token', sessionToken);
  SS.set('room', code);
  showScreen('screen-lobby');
});
socket.on('roomJoined', ({ code, sessionToken, nickname }) => {
  myRoomCode = code;
  mySessionToken = sessionToken;
  if (nickname) { myNickname = nickname; SS.set('nick', nickname); } // por si se renombró por duplicado
  isHost = false;
  SS.set('token', sessionToken);
  SS.set('room', code);
  showScreen('screen-lobby');
});

// Reconexión exitosa
socket.on('reconnectOk', ({ code, sessionToken, nickname, isHost: host }) => {
  myRoomCode = code;
  mySessionToken = sessionToken;
  myNickname = nickname;
  isHost = host;
  SS.set('token', sessionToken);
  SS.set('room', code);
  SS.set('nick', nickname);
  // El servidor hará broadcast del estado actual → el handler de 'state' llevará a la pantalla correcta
});

// Reconexión fallida (sala ya no existe, token inválido, etc.)
socket.on('reconnectFailed', () => {
  SS.clear();
  mySessionToken = null;
  // Si tenemos nombre, ir al menú; si no, a la pantalla de nickname
  const savedNick = SS.get('nick') || myNickname;
  if (savedNick) goToMenuWithNickname(savedNick);
  // Si no hay nombre, se queda en la pantalla de nickname (ya visible por defecto)
});

socket.on('error', (msg) => {
  if (!document.getElementById('screen-menu').classList.contains('hidden')) $('menu-error').textContent = msg;
  else if (!document.getElementById('screen-lobby').classList.contains('hidden')) $('lobby-error').textContent = msg;
  else alert(msg);
});

/* ════════════════════════════════════════════════════════════════════
   PANTALLA: LOBBY
   ════════════════════════════════════════════════════════════════════ */
function renderRoleToggles(){
  $('role-toggles').innerHTML = OPTIONAL_ROLES.map(r => {
    const active = localEnabledRoles.includes(r);
    return `<button class="role-toggle ${active?'active':''}" data-role="${r}" ${isHost?'':'disabled'}>${ROLE_META[r].label}</button>`;
  }).join('');
  if (isHost){
    $('role-toggles').querySelectorAll('.role-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = btn.dataset.role;
        if (localEnabledRoles.includes(r)) localEnabledRoles = localEnabledRoles.filter(x => x !== r);
        else localEnabledRoles.push(r);
        socket.emit('setRoles', { roles: localEnabledRoles });
        renderRoleToggles();
      });
    });
  }
}
$('wolf-count-minus').addEventListener('click', () => { if (!isHost) return; localWolfCount = Math.max(1, localWolfCount-1); $('wolf-count-value').textContent = localWolfCount; socket.emit('setWolfCount', { count: localWolfCount }); });
$('wolf-count-plus').addEventListener('click', () => { if (!isHost) return; localWolfCount = Math.min(4, localWolfCount+1); $('wolf-count-value').textContent = localWolfCount; socket.emit('setWolfCount', { count: localWolfCount }); });

$('btn-copy-code').addEventListener('click', () => {
  navigator.clipboard?.writeText(myRoomCode).then(() => { $('btn-copy-code').textContent = '¡Copiado!'; setTimeout(()=>$('btn-copy-code').textContent='Copiar', 1500); });
});

$('btn-start-game').addEventListener('click', () => { socket.emit('startGame'); });

function renderLobby(st){
  $('lobby-room-code').textContent = st.code;
  $('lobby-player-count').textContent = st.players.length;
  $('lobby-player-grid').innerHTML = st.players.map(p => `
    <div class="placard ${p.isHost?'is-host':''}">
      <div class="name">${esc(p.nickname)}</div>
      ${p.isHost?'<div class="tag">Anfitrión</div>':''}
    </div>`).join('');
  if (isHost){
    $('host-settings').classList.remove('hidden');
    $('guest-settings-note').classList.add('hidden');
  } else {
    $('host-settings').classList.add('hidden');
    $('guest-settings-note').classList.remove('hidden');
    localEnabledRoles = st.enabledRoles;
    localWolfCount = st.wolfCount;
  }
  $('wolf-count-value').textContent = st.wolfCount;
  $('btn-start-game').classList.toggle('hidden', !isHost);
  renderRoleToggles();
}

/* ════════════════════════════════════════════════════════════════════
   HUD
   ════════════════════════════════════════════════════════════════════ */
const PHASE_LABELS = {
  lobby: 'Lobby', night: 'Noche', day: 'Día', voting: 'Votación', hunter: 'El Cazador', ended: 'Fin'
};
function renderHUD(st){
  $('hud').classList.remove('hidden');
  $('hud-round-n').textContent = st.round || 1;
  $('hud-phase-label').textContent = PHASE_LABELS[st.state] || st.state;
  const me = st.players.find(p => p.id === myId);
  const badge = $('hud-role-badge');
  badge.classList.toggle('dead', me && !me.alive);
  $('hud-role-name').textContent = myRoleLabel || (me && !me.alive ? 'Caído' : '???');
  updateCountdown(st.deadline);
}
function updateCountdown(deadline){
  clearInterval(countdownInterval);
  const tick = () => {
    if (!deadline){ $('hud-timer').textContent = '--:--'; $('hud-timer').classList.remove('urgent'); return; }
    const remain = Math.max(0, Math.round((deadline - Date.now())/1000));
    const m = String(Math.floor(remain/60)).padStart(2,'0');
    const s = String(remain%60).padStart(2,'0');
    $('hud-timer').textContent = `${m}:${s}`;
    $('hud-timer').classList.toggle('urgent', remain <= 10);
    if (remain <= 0) clearInterval(countdownInterval);
  };
  tick();
  countdownInterval = setInterval(tick, 500);
}

/* ════════════════════════════════════════════════════════════════════
   TRANSICIONES DRAMÁTICAS (overlay noche/día/votación/peligro)
   ════════════════════════════════════════════════════════════════════ */
function showTransition(kind, title, sub, glyphSvg, duration=3500){
  const ov = $('transition-overlay');
  ov.className = 'transition-overlay ' + kind;
  $('transition-title').textContent = title;
  $('transition-sub').textContent = sub || '';
  $('transition-glyph').innerHTML = glyphSvg;
  $('transition-stars').innerHTML = (kind === 'night') ? starsBackground(50) : '';
  requestAnimationFrame(() => ov.classList.add('show'));
  setTimeout(() => ov.classList.remove('show'), duration);
}
function triggerPhaseTransition(st){
  if (st.state === lastBroadcastState && st.round === (window.__lastRound||0)) return;
  if (st.state === 'night' && lastBroadcastState !== 'night'){
    showTransition('night', `Cae la noche`, `Ronda ${st.round} — el pueblo se encierra tras sus puertas`, ringFrame(ICONS.moon('var(--moon-glow)'),{stroke:'var(--moon-glow)'}));
  } else if (st.state === 'day' && lastBroadcastState !== 'day'){
    showTransition('day', 'Amanece', 'El pueblo despierta y debe debatir', ringFrame(ICONS.sun('var(--sun-glow)'),{stroke:'var(--sun-glow)'}));
  } else if (st.state === 'voting' && lastBroadcastState !== 'voting'){
    showTransition('vote', '¡A votar!', 'Decidan quién será ejecutado', ringFrame(ICONS.star('var(--blood-glow)'),{stroke:'var(--blood-glow)'}), 2600);
  } else if (st.state === 'hunter' && lastBroadcastState !== 'hunter'){
    showTransition('danger', 'El Cazador cae', 'Tiene una última flecha', ringFrame(ICONS.bow('var(--blood-glow)'),{stroke:'var(--blood-glow)'}), 3000);
  }
  lastBroadcastState = st.state;
  window.__lastRound = st.round;
}

/* ════════════════════════════════════════════════════════════════════
   REVELACIÓN DE ROL
   ════════════════════════════════════════════════════════════════════ */
socket.on('roleAssigned', ({ role, label }) => {
  myRole = role; myRoleLabel = label;
  const meta = ROLE_META[role] || ROLE_META.aldeano;
  $('role-reveal-panel').classList.remove('hidden');
  $('role-flip-front').innerHTML = roleCardFrontSVG();
  $('role-flip-back').innerHTML = roleCardBackSVG(role);
  $('role-reveal-name').textContent = meta.label;
  $('role-reveal-name').style.color = meta.color;
  $('role-reveal-desc').textContent = meta.desc;
  $('role-flip-card').classList.remove('flipped');
  setTimeout(() => $('role-flip-card').classList.add('flipped'), 600);
  if (state) renderHUD(state);
});
socket.on('youAreLovers', ({ partnerId }) => {
  const p = state && state.players.find(x => x.id === partnerId);
  showModal(`<h2>💘 Estás enamorado/a</h2><p class="subtle" style="margin:10px 0 16px;">Cupido ha unido tu corazón al de <b style="color:var(--gold-bright)">${esc(p?p.nickname:'tu pareja')}</b>. Si uno de los dos muere, el otro morirá de amor. Si quedan solos los dos al final, ganan juntos.</p><button class="btn btn-gold" id="modal-close-btn">Entendido</button>`);
});

/* ════════════════════════════════════════════════════════════════════
   ZONA DE ACCIÓN — cambia según fase
   ════════════════════════════════════════════════════════════════════ */
function choiceGrid(players, onPick, selectedId=null){
  const div = document.createElement('div');
  div.className = 'choice-grid';
  players.forEach(p => {
    const card = document.createElement('div');
    card.className = 'wolf-target' + (selectedId===p.id?' selected':'');
    card.innerHTML = `<div class="name">${esc(p.nickname)}</div>`;
    card.addEventListener('click', () => onPick(p.id));
    div.appendChild(card);
  });
  return div;
}
function setAction(title, sub, iconSvg, bodyEl){
  $('action-panel').classList.remove('hidden');
  $('action-title').textContent = title;
  $('action-sub').textContent = sub;
  $('action-icon').innerHTML = iconSvg;
  const body = $('action-body');
  body.innerHTML = '';
  if (bodyEl) body.appendChild(bodyEl);
}
function hideAction(){ $('action-panel').classList.add('hidden'); }
function waitingMsg(text){
  const p = document.createElement('p');
  p.className = 'subtle';
  p.textContent = text;
  return p;
}

function renderActionPanel(st){
  const me = st.players.find(p => p.id === myId);
  if (st.state === 'night'){
    const step = st.nightStep;
    if (!step){ hideAction(); return; }
    if (step === 'cupido'){
      if (myRole === 'cupido' && me.alive){
        cupidoSelection = cupidoSelection.filter(id => st.players.some(p=>p.id===id));
        const body = document.createElement('div');
        body.appendChild(choiceGrid(st.players, (id) => {
          if (cupidoSelection.includes(id)) cupidoSelection = cupidoSelection.filter(x=>x!==id);
          else if (cupidoSelection.length < 2) cupidoSelection.push(id);
          renderActionPanel(st);
        }));
        setAction('Elige a dos enamorados', `Seleccionados: ${cupidoSelection.length}/2`, roleIconSVG('cupido',46), body);
        body.querySelectorAll('.wolf-target').forEach((el,i) => { if (cupidoSelection.includes(st.players[i].id)) el.classList.add('selected'); });
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary'; btn.style.marginTop='14px'; btn.textContent = 'Confirmar pareja';
        btn.disabled = cupidoSelection.length !== 2;
        btn.addEventListener('click', () => { socket.emit('cupidoChoose', { ids: cupidoSelection }); cupidoSelection=[]; hideAction(); });
        body.appendChild(btn);
      } else {
        setAction('Cupido está despertando', 'Eligiendo a dos almas para unirlas en amor eterno…', roleIconSVG('cupido',46), waitingMsg('El pueblo aguarda en silencio.'));
      }
    } else if (step === 'ladron'){
      if (myRole === 'ladron' && me.alive){
        const body = choiceGrid(st.players.filter(p=>p.id!==myId), (id) => { socket.emit('ladronChoose', { targetId: id }); hideAction(); });
        setAction('El Ladrón actúa', 'Elige con quién intercambiar tu carta', roleIconSVG('ladron',46), body);
      } else setAction('El Ladrón está despierto', 'Está decidiendo si robar una identidad…', roleIconSVG('ladron',46), waitingMsg('El pueblo aguarda en silencio.'));
    } else if (step === 'vidente'){
      if (myRole === 'vidente' && me.alive){
        const body = choiceGrid(st.players.filter(p=>p.id!==myId && p.alive), (id) => { socket.emit('videnteChoose', { targetId: id }); hideAction(); });
        setAction('Consulta tu visión', 'Elige a quién revelar su verdadero rol', roleIconSVG('vidente',46), body);
      } else setAction('La Vidente consulta los astros', 'Está espiando el rol de alguien…', roleIconSVG('vidente',46), waitingMsg('El pueblo aguarda en silencio.'));
    } else if (step === 'salvador'){
      if (myRole === 'salvador' && me.alive){
        const body = choiceGrid(st.players.filter(p=>p.alive), (id) => { socket.emit('salvadorChoose', { targetId: id }); hideAction(); });
        setAction('Protege a alguien', 'Elige quién estará a salvo del ataque esta noche', roleIconSVG('salvador',46), body);
      } else setAction('El Salvador vela por el pueblo', 'Está eligiendo a quién proteger…', roleIconSVG('salvador',46), waitingMsg('El pueblo aguarda en silencio.'));
    } else if (step === 'lobos'){
      if (myRole === 'lobo' && me.alive){
        const realTargets = st.players.filter(p => p.alive && p.role !== 'lobo');
        const body = document.createElement('div');
        const grid = document.createElement('div'); grid.className='choice-grid';
        realTargets.forEach(p => {
          const card = document.createElement('div');
          const mine = wolfVotesCache[myId] === p.id;
          card.className = 'wolf-target' + (mine?' selected':'');
          const voteCount = Object.values(wolfVotesCache).filter(v => v === p.id).length;
          card.innerHTML = `<div class="name">${esc(p.nickname)}</div>${voteCount>0?`<div class="vote-dot">${voteCount}</div>`:''}`;
          card.addEventListener('click', () => socket.emit('wolfVote', { targetId: p.id }));
          grid.appendChild(card);
        });
        body.appendChild(grid);
        setAction('La manada elige', 'Voten en conjunto a su víctima de esta noche', roleIconSVG('lobo',46), body);
      } else if (myRole === 'nina' && me.alive){
        const body = document.createElement('div');
        const btn = document.createElement('button'); btn.className='btn btn-gold'; btn.textContent='Espiar a los lobos';
        btn.addEventListener('click', () => socket.emit('ninaSpy'));
        body.appendChild(btn);
        setAction('Espías en la oscuridad', 'Puedes ver quiénes son los lobos sin que se den cuenta', roleIconSVG('nina',46), body);
      } else setAction('Los lobos despiertan', 'Están eligiendo a su víctima…', roleIconSVG('lobo',46), waitingMsg('Duerme y espera el amanecer.'));
    } else if (step === 'bruja'){
      if (myRole === 'bruja' && me.alive){
        renderWitchPanel(st);
      } else setAction('La Bruja prepara sus pociones', 'Decide si intervenir esta noche…', roleIconSVG('bruja',46), waitingMsg('El pueblo aguarda en silencio.'));
    }
  } else if (st.state === 'day'){
    const body = document.createElement('div');
    body.appendChild(waitingMsg('Debate con los demás jugadores en el chat. La votación comenzará automáticamente.'));
    if (isHost){
      const btn = document.createElement('button'); btn.className='btn btn-ghost'; btn.style.marginTop='12px'; btn.textContent='Saltar al vóto';
      btn.addEventListener('click', () => socket.emit('skipToVote'));
      body.appendChild(btn);
    }
    setAction('Fase de día', 'La aldea debate quién podría ser un lobo', `<div style="width:46px;height:46px;">${ringFrame(ICONS.sun('var(--sun-glow)'),{stroke:'var(--sun-glow)'})}</div>`, body);
  } else if (st.state === 'voting'){
    if (me && me.alive){
      const targets = st.players.filter(p => p.alive);
      const grid = document.createElement('div'); grid.className = 'choice-grid';
      targets.forEach(p => {
        const card = document.createElement('div');
        const mine = dayVotesCache[myId] === p.id;
        card.className = 'wolf-target' + (mine?' selected':'');
        const voteCount = Object.values(dayVotesCache).filter(v => v === p.id).length;
        card.innerHTML = `<div class="name">${esc(p.nickname)}</div>${voteCount>0?`<div class="vote-dot">${voteCount}</div>`:''}`;
        card.addEventListener('click', () => socket.emit('dayVote', { targetId: p.id }));
        grid.appendChild(card);
      });
      setAction('Votación', 'Elige a quién ejecutar', `<div style="width:46px;height:46px;">${ringFrame(ICONS.star('var(--blood-glow)'),{stroke:'var(--blood-glow)'})}</div>`, grid);
    } else {
      hideAction();
    }
  } else if (st.state === 'hunter'){
    if (st.hunterId === myId){
      const body = choiceGrid(st.players.filter(p=>p.alive && p.id!==myId), (id) => { socket.emit('hunterShoot', { targetId: id }); hideAction(); });
      setAction('Tu última flecha', 'Elige a quién te llevarás contigo', roleIconSVG('cazador',46), body);
    } else {
      setAction('El Cazador decide', 'Tiene una última flecha…', roleIconSVG('cazador',46), waitingMsg('El pueblo observa en tensión.'));
    }
  } else {
    hideAction();
  }
}

let witchTargetInfo = null;
socket.on('witchInfo', (info) => { witchTargetInfo = info; if (state) renderActionPanel(state); });

function renderWitchPanel(st){
  const target = witchTargetInfo && witchTargetInfo.targetId ? { nickname: witchTargetInfo.targetNickname, id: witchTargetInfo.targetId } : null;
  const body = document.createElement('div');
  body.className = 'witch-panel';
  if (target){
    body.innerHTML = `<p class="subtle">Esta noche los lobos eligieron a <b style="color:var(--blood-glow)">${esc(target.nickname)}</b>.</p>`;
  } else {
    body.innerHTML = `<p class="subtle">Los lobos aún no han decidido a su víctima.</p>`;
  }
  const row = document.createElement('div'); row.className = 'btn-row'; row.style.flexWrap='wrap'; row.style.marginTop='12px';
  if (!st.witchUsedSave && target){
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-gold'; saveBtn.textContent='Usar poción de vida';
    saveBtn.addEventListener('click', () => { socket.emit('witchAction', { save:true, kill:false }); witchTargetInfo=null; hideAction(); });
    row.appendChild(saveBtn);
  }
  if (!st.witchUsedKill){
    const killBtn = document.createElement('button'); killBtn.className='btn btn-primary'; killBtn.textContent='Usar poción de muerte';
    killBtn.addEventListener('click', () => openKillPicker(st));
    row.appendChild(killBtn);
  }
  const skipBtn = document.createElement('button'); skipBtn.className='btn btn-ghost'; skipBtn.textContent='No usar pociones';
  skipBtn.addEventListener('click', () => { socket.emit('skipWitch'); witchTargetInfo=null; hideAction(); });
  row.appendChild(skipBtn);
  body.appendChild(row);
  setAction('La Bruja decide', 'Tus pociones solo pueden usarse una vez cada una', roleIconSVG('bruja',46), body);
}
function openKillPicker(st){
  const others = st.players.filter(p => p.alive);
  const div = document.createElement('div');
  const h = document.createElement('h2'); h.textContent = 'Elige a tu víctima'; h.style.marginBottom = '10px';
  div.appendChild(h);
  div.appendChild(choiceGrid(others, (id) => { socket.emit('witchAction', { save:false, kill:true, killTargetId:id }); witchTargetInfo=null; closeModal(); hideAction(); }));
  $('modal-box').innerHTML = '';
  $('modal-box').appendChild(div);
  $('modal-backdrop').classList.add('show');
}

/* ════════════════════════════════════════════════════════════════════
   MODALES (vidente, niña, lobby-error genérico)
   ════════════════════════════════════════════════════════════════════ */
function showModal(html){
  $('modal-box').innerHTML = html;
  $('modal-backdrop').classList.add('show');
  const closeBtn = $('modal-box').querySelector('#modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
}
function closeModal(){ $('modal-backdrop').classList.remove('show'); }
$('modal-backdrop').addEventListener('click', e => { if (e.target.id === 'modal-backdrop') closeModal(); });

socket.on('videnteResult', ({ targetNickname, label }) => {
  showModal(`<h2>🔮 Visión revelada</h2><p class="subtle" style="margin:10px 0 16px;"><b style="color:var(--gold-bright)">${esc(targetNickname)}</b> es en realidad: <b style="color:var(--blood-glow)">${esc(label)}</b></p><button class="btn btn-gold" id="modal-close-btn">Cerrar</button>`);
});
socket.on('ninaSpyResult', ({ wolves }) => {
  const names = wolves.map(w => esc(w.nickname)).join(', ') || 'nadie por ahora';
  showModal(`<h2>👁️ Espías en la sombra</h2><p class="subtle" style="margin:10px 0 16px;">Los lobos son: <b style="color:var(--blood-glow)">${names}</b></p><button class="btn btn-gold" id="modal-close-btn">Cerrar</button>`);
});

/* ════════════════════════════════════════════════════════════════════
   TABLERO DE JUGADORES
   ════════════════════════════════════════════════════════════════════ */
function renderPlayersBoard(st){
  $('players-board').innerHTML = st.players.map(p => `
    <div class="placard ${p.isHost?'is-host':''} ${!p.alive?'is-dead':''}">
      <div class="name">${esc(p.nickname)}</div>
      ${p.isAlguacil ? '<div class="tag">Alguacil</div>' : ''}
    </div>`).join('');
}

/* ════════════════════════════════════════════════════════════════════
   NARRADOR Y CHAT
   ════════════════════════════════════════════════════════════════════ */
function renderNarrator(){
  const log = $('narrator-log');
  log.innerHTML = narratorLines.slice(-30).map(n => `<div class="narrator-line">${n}</div>`).join('');
  log.scrollTop = log.scrollHeight;
}
function chatTabsAvailable(){
  const me = state && state.players.find(p=>p.id===myId);
  const tabs = [];
  if (!me || me.alive){
    tabs.push({ key:'general', label:'General' });
    if (myRole === 'lobo') tabs.push({ key:'wolf', label:'Lobos' });
  } else {
    tabs.push({ key:'dead', label:'Muertos' });
  }
  return tabs;
}
function renderChatTabs(){
  const tabs = chatTabsAvailable();
  if (!tabs.find(t=>t.key===activeChatTab)) activeChatTab = tabs[0].key;
  const html = tabs.map(t => `<button class="chat-tab ${t.key===activeChatTab?'active':''}" data-tab="${t.key}">${t.label}</button>`).join('');
  ['chat-tabs','chat-tabs-mobile'].forEach(id => {
    $(id).innerHTML = html;
    $(id).querySelectorAll('.chat-tab').forEach(btn => btn.addEventListener('click', () => { activeChatTab = btn.dataset.tab; renderChatTabs(); renderChatMessages(); }));
  });
}
function renderChatMessages(){
  const data = activeChatTab === 'wolf' ? chatWolf : activeChatTab === 'dead' ? chatDead : chatGeneral;
  const html = data.map(m => `<div class="chat-msg ${m.nickname===myNickname?'mine':''} ${activeChatTab}">
    <span class="who">${esc(m.nickname)}</span>${esc(m.text)}
  </div>`).join('');
  ['chat-messages-desktop','chat-messages-mobile'].forEach(id => { $(id).innerHTML = html; $(id).scrollTop = $(id).scrollHeight; });
  const badge = $('chat-fab-badge');
  if (!$('chat-drawer-mobile').classList.contains('open') && data.length){
    badge.textContent = data.length; badge.classList.remove('hidden');
  }
}
function sendActiveChat(text){
  if (!text.trim()) return;
  if (activeChatTab === 'wolf') socket.emit('sendWolfChat', { text });
  else socket.emit('sendChat', { text });
}
['desktop','mobile'].forEach(scope => {
  $(`chat-send-${scope}`).addEventListener('click', () => { const inp = $(`chat-input-${scope}`); sendActiveChat(inp.value); inp.value=''; });
  $(`chat-input-${scope}`).addEventListener('keydown', e => { if (e.key==='Enter'){ sendActiveChat(e.target.value); e.target.value=''; } });
});
$('chat-fab').addEventListener('click', () => { $('chat-drawer-mobile').classList.add('open'); $('chat-fab-badge').classList.add('hidden'); });
$('chat-drawer-close').addEventListener('click', () => $('chat-drawer-mobile').classList.remove('open'));

socket.on('chat', (msg) => {
  if (msg.type === 'narrator'){
    narratorLines.push(msg.text); renderNarrator();
    if (/murieron|muere de amor|ha ejecutado|se lleva/.test(msg.text)) {
      triggerDeathFlash();
    }
  }
  else if (msg.type === 'player'){ chatGeneral.push(msg); if (activeChatTab==='general') renderChatMessages(); else renderChatTabs(); }
  else if (msg.type === 'dead'){ chatDead.push(msg); if (activeChatTab==='dead') renderChatMessages(); else renderChatTabs(); }
});
function triggerDeathFlash(){
  const app = $('app');
  app.classList.remove('death-flash');
  void app.offsetWidth;
  app.classList.add('death-flash');
  setTimeout(() => app.classList.remove('death-flash'), 650);
}
socket.on('wolfChat', (msg) => { chatWolf.push(msg); if (activeChatTab==='wolf') renderChatMessages(); });
socket.on('wolfVoteUpdate', ({ votes }) => { wolfVotesCache = votes; if (state) renderActionPanel(state); });
socket.on('voteUpdate', ({ votes }) => { dayVotesCache = votes; if (state) renderActionPanel(state); });

/* ════════════════════════════════════════════════════════════════════
   ESTADO PRINCIPAL
   ════════════════════════════════════════════════════════════════════ */
socket.on('state', (st) => {
  myId = st.myId;
  isHost = st.hostId === myId;
  const prevState = state;
  state = st;
  const wasVotingWolves = prevState && prevState.nightStep === 'lobos' && prevState.round === st.round;
  if (st.nightStep !== 'lobos' || !wasVotingWolves) wolfVotesCache = {};
  const wasVotingDay = prevState && prevState.state === 'voting' && prevState.round === st.round;
  if (st.state !== 'voting' || !wasVotingDay) dayVotesCache = {};
  if (st.state === 'lobby'){
    showScreen('screen-lobby');
    $('hud').classList.add('hidden');
    if (lastBroadcastState === 'ended' || lastBroadcastState === 'hunter') {
      // Venimos de una ronda anterior: limpiar restos de esa partida
      myRole = null; myRoleLabel = '';
      narratorLines = []; chatGeneral = []; chatWolf = []; chatDead = [];
      $('role-reveal-panel').classList.add('hidden');
    }
    lastBroadcastState = 'lobby';
    renderLobby(st);
    return;
  }
  showScreen('screen-game');
  $('chat-fab').classList.remove('hidden');
  renderHUD(st);
  triggerPhaseTransition(st);
  renderPlayersBoard(st);
  renderActionPanel(st);
  renderChatTabs();
  renderChatMessages();
});

socket.on('gameOver', ({ winner, winnerIds, players }) => {
  clearInterval(countdownInterval);
  const titles = { villagers: '🏆 Ganan los Aldeanos', wolves: '🐺 Ganan los Hombres Lobo', lovers: '💑 Ganan los Enamorados' };
  $('gameover-title').textContent = titles[winner] || 'Fin de la partida';
  $('gameover-sub').textContent = 'Estos eran los verdaderos roles de cada jugador:';
  $('final-roles').innerHTML = players.map(p => {
    const meta = ROLE_META[p.role] || ROLE_META.aldeano;
    return `<div class="placard ${!p.alive?'is-dead':''}"><div class="name">${esc(p.nickname)}</div><div class="tag" style="color:${meta.color}">${meta.label}</div></div>`;
  }).join('');
  $('btn-play-again').classList.toggle('hidden', !isHost);
  $('gameover-waiting-note').classList.toggle('hidden', isHost);
  showScreen('screen-gameover');
});

$('btn-play-again').addEventListener('click', () => { socket.emit('playAgain'); });

$('btn-back-menu').addEventListener('click', () => {
  socket.disconnect();
  SS.del('room');   // borrar sala pero conservar nick y token para la próxima sala
  myRoomCode = null;
  isHost = false;
  state = null;
  myRole = null;
  myRoleLabel = '';
  narratorLines = [];
  chatGeneral = []; chatWolf = []; chatDead = [];
  showScreen('screen-menu');
  $('join-fields').classList.add('hidden');
  $('menu-error').textContent = '';
  socket.connect();
});

// Si el anfitrión inicia otra ronda, el server emite 'state' con state:'lobby' de nuevo
// y el handler de 'state' ya existente se encarga de mostrar la pantalla de lobby.

/* ════════════════════════════════════════════════════════════════════
   MANUAL DE ROLES
   ════════════════════════════════════════════════════════════════════ */
const ROLE_MANUAL = [
  {
    role: 'aldeano', emoji: '🌾', title: 'Aldeano',
    desc: 'No tiene habilidades especiales. Durante el día vota para linchar al sospechoso. Su objetivo es eliminar a todos los Hombres Lobo.',
    team: 'Aldea',
  },
  {
    role: 'lobo', emoji: '🐺', title: 'Hombre Lobo',
    desc: 'Cada noche, junto a los otros lobos, elige a un aldeano para eliminar. Durante el día finge ser aldeano. Ganan cuando igualan en número a los aldeanos.',
    team: 'Lobos',
  },
  {
    role: 'vidente', emoji: '🔮', title: 'Vidente',
    desc: 'Cada noche puede mirar en secreto la carta de un jugador y descubrir si es Hombre Lobo o no. Aliada de la aldea, debe compartir su información sin revelar su identidad.',
    team: 'Aldea',
  },
  {
    role: 'bruja', emoji: '🧪', title: 'Bruja',
    desc: 'Tiene dos pociones de un solo uso: una de vida (puede salvar a la víctima de los lobos esa noche) y una de muerte (puede envenenar a cualquier jugador). Aliada de la aldea.',
    team: 'Aldea',
  },
  {
    role: 'cazador', emoji: '🏹', title: 'Cazador',
    desc: 'Cuando muere (de noche o linchado), puede disparar y eliminar a otro jugador de su elección. Aliado de la aldea.',
    team: 'Aldea',
  },
  {
    role: 'cupido', emoji: '💘', title: 'Cupido',
    desc: 'La primera noche elige a dos jugadores que quedan enamorados. Si uno de los enamorados muere, el otro muere de pena. Si los enamorados son el último lobo y un aldeano, ganan juntos.',
    team: 'Aldea / Variable',
  },
  {
    role: 'salvador', emoji: '🛡️', title: 'Salvador',
    desc: 'Cada noche puede proteger a un jugador (incluido a sí mismo) de los lobos. No puede proteger a la misma persona dos noches seguidas.',
    team: 'Aldea',
  },
  {
    role: 'ladron', emoji: '🃏', title: 'Ladrón',
    desc: 'La primera noche puede robar el rol de otro jugador. Si lo hace, ese jugador recibe el rol de Aldeano. Si no roba, se queda sin rol especial.',
    team: 'Variable',
  },
  {
    role: 'alguacil', emoji: '⚖️', title: 'Alguacil',
    desc: 'Un cargo elegido entre los jugadores. El Alguacil tiene el doble de peso en la votación del día. Si muere puede designar a su sucesor.',
    team: 'Aldea',
  },
  {
    role: 'nina', emoji: '👧', title: 'La Niña',
    desc: 'Durante la fase nocturna de los lobos puede espiar y ver quiénes son. Si es descubierta espiando, los lobos pueden elegirla a ella como víctima esa misma noche.',
    team: 'Aldea',
  },
];

const TEAM_COLOR = {
  'Aldea': '#e8c468',
  'Lobos': '#c0392b',
  'Aldea / Variable': '#a0c4a0',
  'Variable': '#9b59b6',
};

function renderManual() {
  $('manual-panel').innerHTML = `
    <div style="font-size:12px;color:#8a6c28;margin-bottom:10px;line-height:1.5;">
      <b style="color:#e8c468;">Objetivo general:</b> Los aldeanos deben descubrir y eliminar a todos los Hombres Lobo antes de que estos los igualen en número. Los lobos deben sobrevivir y eliminar aldeanos sin ser descubiertos.<br><br>
      <b style="color:#e8c468;">Flujo de juego:</b> Noche → Los roles especiales actúan en orden. Día → El narrador anuncia las muertes, los jugadores debaten y votan para linchar a un sospechoso.
    </div>
    ${ROLE_MANUAL.map(r => `
      <div style="background:#16121a;border:1px solid #2e1f0a;border-radius:8px;padding:10px 12px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="font-size:20px;">${r.emoji}</span>
          <b style="color:#e8c468;font-family:'Cinzel',serif;font-size:13px;">${r.title}</b>
          <span style="margin-left:auto;font-size:10px;font-weight:600;letter-spacing:.05em;color:${TEAM_COLOR[r.team] || '#e8c468'};">${r.team.toUpperCase()}</span>
        </div>
        <p style="margin:0;font-size:12px;color:#c8b89a;line-height:1.55;">${r.desc}</p>
      </div>
    `).join('')}
  `;
}

$('btn-toggle-manual').addEventListener('click', () => {
  const panel = $('manual-panel');
  const isHidden = panel.classList.contains('hidden');
  if (isHidden) {
    renderManual();
    panel.classList.remove('hidden');
    $('btn-toggle-manual').textContent = '📖 Ocultar instrucciones';
  } else {
    panel.classList.add('hidden');
    $('btn-toggle-manual').textContent = '📖 Ver instrucciones y roles';
  }
});
