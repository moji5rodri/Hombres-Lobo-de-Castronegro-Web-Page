/* ════════════════════════════════════════════════════════════════════════
   CASTRONEGRO — Cliente v4
   ════════════════════════════════════════════════════════════════════════ */
const socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: 20 });

/* ── Estado local ──────────────────────────────────────────────────── */
let myNickname = '';
let myId = null;
let myRoomCode = null;
let mySessionToken = null;
let isHost = false;
let state = null;
let myRole = null;
let myRoleLabel = '';
let lastBroadcastState = null;
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
let localTimings = { dayChat:90, voting:30, hunter:20, nightStep:45, wolves:90 };
let cupidoSelection = [];

/* ── sessionStorage ─────────────────────────────────────────────────── */
const SS = {
  get: k => sessionStorage.getItem('cng_' + k),
  set: (k, v) => sessionStorage.setItem('cng_' + k, v),
  del: k => sessionStorage.removeItem('cng_' + k),
  clear: () => ['token','room','nick'].forEach(k => sessionStorage.removeItem('cng_' + k)),
};

/* ── Metadatos de roles (sin niña) ─────────────────────────────────── */
const ROLE_META = {
  aldeano:  { label:'Aldeano',     color:'var(--parchment-2)', desc:'Un alma honesta sin poderes especiales. Tu arma es la palabra y la sospecha.' },
  lobo:     { label:'Hombre Lobo', color:'var(--blood-bright)', desc:'Cada noche, junto a tu manada, elige una víctima para devorar.' },
  vidente:  { label:'Vidente',     color:'var(--moon-glow)', desc:'Cada noche puedes espiar el verdadero rol de un jugador.' },
  bruja:    { label:'Bruja',       color:'#7fae6a', desc:'Posees dos pociones: una de vida y una de muerte. Úsalas con sabiduría.' },
  cazador:  { label:'Cazador',     color:'var(--gold-bright)', desc:'Si mueres, puedes llevarte a alguien contigo con tu última flecha.' },
  cupido:   { label:'Cupido',      color:'#d97b9c', desc:'La primera noche unes a dos almas en un amor que las atará para siempre.' },
  ladron:   { label:'Ladrón',      color:'#c9a227', desc:'La primera noche puedes robar el rol de otro jugador.' },
  alguacil: { label:'Alguacil',    color:'var(--gold)', desc:'Tu voto vale doble durante las votaciones del pueblo.' },
  salvador: { label:'Salvador',    color:'#6a9e7f', desc:'Cada noche eliges a alguien para protegerlo del ataque de los lobos.' },
};
const OPTIONAL_ROLES = ['vidente','bruja','cazador','cupido','ladron','alguacil','salvador'];

/* ── DOM helpers ───────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
}
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ════════════════════════════════════════════════════════════════════
   AUDIO
   ════════════════════════════════════════════════════════════════════ */
let volMusic = 0.4, volSfx = 0.7, muted = false;
const audioCtx = typeof AudioContext !== 'undefined' ? new AudioContext() : null;

function playTone(freq, type, duration, volumeScale=1){
  if (!audioCtx || muted) return;
  try {
    const gain = audioCtx.createGain();
    const osc  = audioCtx.createOscillator();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(volSfx * volumeScale, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + duration);
  } catch(e){}
}

const SFX = {
  night()  { playTone(110,'sine',.6,.5); setTimeout(()=>playTone(90,'sine',.8,.4),300); },
  day()    { playTone(440,'triangle',.25,.6); setTimeout(()=>playTone(554,'triangle',.25,.6),180); setTimeout(()=>playTone(659,'triangle',.4,.5),360); },
  vote()   { playTone(220,'sawtooth',.15,.5); setTimeout(()=>playTone(196,'sawtooth',.2,.5),200); },
  death()  { playTone(130,'sawtooth',.5,.6); setTimeout(()=>playTone(100,'sawtooth',.8,.4),200); },
  hunter() { playTone(165,'sawtooth',.12,.6); setTimeout(()=>playTone(147,'sawtooth',.12,.5),120); setTimeout(()=>playTone(131,'sawtooth',.35,.6),240); },
  click()  { playTone(880,'sine',.06,.25); },
  urgent() { playTone(660,'square',.08,.3); },
};

function resumeAudio(){
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
document.addEventListener('click', resumeAudio, { once:true });
document.addEventListener('keydown', resumeAudio, { once:true });

/* ════════════════════════════════════════════════════════════════════
   ICONOGRAFÍA SVG
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
  moon: s => `<path d="M62 30 A26 26 0 1 0 62 70 A20 20 0 1 1 62 30 Z" fill="${s||'var(--gold-bright)'}"/>`,
  sun:  s => `<g stroke="${s||'var(--sun-glow)'}" stroke-width="3" stroke-linecap="round"><circle cx="50" cy="50" r="14" fill="${s||'var(--sun-glow)'}" stroke="none"/>${[0,45,90,135,180,225,270,315].map(a=>`<line x1="50" y1="24" x2="50" y2="34" transform="rotate(${a} 50 50)"/>`).join('')}</g>`,
  wolf: s => `<path d="M30 62 L36 36 L46 46 L50 32 L54 46 L64 36 L70 62 Q70 70 60 72 L56 64 L50 70 L44 64 L40 72 Q30 70 30 62 Z" fill="${s||'var(--blood-bright)'}"/><circle cx="42" cy="50" r="2.4" fill="var(--void)"/><circle cx="58" cy="50" r="2.4" fill="var(--void)"/>`,
  eye:  s => `<path d="M26 50 Q50 30 74 50 Q50 70 26 50 Z" fill="none" stroke="${s||'var(--moon-glow)'}" stroke-width="3"/><circle cx="50" cy="50" r="9" fill="${s||'var(--moon-glow)'}"/>`,
  flask:s => `<path d="M44 28 H56 V42 L66 64 Q70 72 60 72 H40 Q30 72 34 64 L44 42 Z" fill="none" stroke="${s||'#7fae6a'}" stroke-width="3" stroke-linejoin="round"/><circle cx="46" cy="60" r="3" fill="${s||'#7fae6a'}"/><circle cx="56" cy="64" r="2" fill="${s||'#7fae6a'}"/>`,
  bow:  s => `<path d="M36 26 Q56 50 36 74" fill="none" stroke="${s||'var(--gold-bright)'}" stroke-width="3"/><line x1="36" y1="26" x2="68" y2="64" stroke="${s||'var(--gold-bright)'}" stroke-width="2"/><line x1="36" y1="74" x2="68" y2="64" stroke="${s||'var(--gold-bright)'}" stroke-width="2"/><line x1="30" y1="50" x2="72" y2="50" stroke="${s||'var(--gold-bright)'}" stroke-width="2"/>`,
  heart:s => `<path d="M50 70 Q22 50 30 36 Q38 24 50 38 Q62 24 70 36 Q78 50 50 70 Z" fill="${s||'#d97b9c'}"/>`,
  mask: s => `<path d="M26 44 Q50 28 74 44 Q74 60 60 64 Q50 70 40 64 Q26 60 26 44 Z" fill="none" stroke="${s||'#c9a227'}" stroke-width="3"/><circle cx="40" cy="46" r="3.5" fill="${s||'#c9a227'}"/><circle cx="60" cy="46" r="3.5" fill="${s||'#c9a227'}"/>`,
  star: s => `<path d="M50 26 L58 44 L78 46 L62 58 L68 78 L50 66 L32 78 L38 58 L22 46 L42 44 Z" fill="${s||'var(--gold)'}"/>`,
  shield:s => `<path d="M50 26 L72 34 V52 Q72 70 50 78 Q28 70 28 52 V34 Z" fill="none" stroke="${s||'#6a9e7f'}" stroke-width="3"/><path d="M50 38 V64 M40 50 H60" stroke="${s||'#6a9e7f'}" stroke-width="2.4"/>`,
  skull: s => `<circle cx="50" cy="44" r="20" fill="${s||'var(--blood-glow)'}"/><rect x="40" y="58" width="20" height="12" rx="2" fill="${s||'var(--blood-glow)'}"/><circle cx="42" cy="42" r="5" fill="var(--void)"/><circle cx="58" cy="42" r="5" fill="var(--void)"/>`,
  person:s => `<circle cx="50" cy="32" r="12" fill="none" stroke="${s||'var(--parchment-2)'}" stroke-width="3"/><path d="M30 74 Q30 54 50 52 Q70 54 70 74" fill="none" stroke="${s||'var(--parchment-2)'}" stroke-width="3" stroke-linecap="round"/>`,
};
const ROLE_ICON_MAP = { lobo:'wolf', vidente:'eye', bruja:'flask', cazador:'bow', cupido:'heart', ladron:'mask', alguacil:'star', salvador:'shield', aldeano:'person' };

function roleIconSVG(role, size=46){
  const meta = ROLE_META[role] || ROLE_META.aldeano;
  const fn = ICONS[ROLE_ICON_MAP[role]] || ICONS.person;
  return `<div style="width:${size}px;height:${size}px;">${ringFrame(fn(meta.color), { stroke:meta.color })}</div>`;
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
  const fn = ICONS[ROLE_ICON_MAP[role]] || ICONS.person;
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
  let out='';
  for(let i=0;i<n;i++){
    const x=Math.random()*100, y=Math.random()*100, d=(Math.random()*3).toFixed(2);
    out+=`<circle cx="${x}%" cy="${y}%" r="${(Math.random()*1.4+0.3).toFixed(2)}" fill="#fff" opacity="${(Math.random()*.6+.2).toFixed(2)}" style="animation:twinkle ${2+Math.random()*3}s ease-in-out ${d}s infinite;"/>`;
  }
  return `<svg width="100%" height="100%" style="position:absolute;inset:0;">${out}</svg>`;
}

/* ════════════════════════════════════════════════════════════════════
   ESCENA DE FOGATA — avatares en círculo/elipse con perspectiva
   ════════════════════════════════════════════════════════════════════ */
let sparkInterval = null;

function startSparks(){
  if (sparkInterval) return;
  const sparksEl = $('sparks');
  if (!sparksEl) return;
  sparkInterval = setInterval(() => {
    if (document.body.classList.contains('reduce-motion')) return;
    const spark = document.createElementNS('http://www.w3.org/2000/svg','circle');
    const sx = (Math.random()*40 - 20).toFixed(1);
    spark.setAttribute('cx', (50 + (Math.random()*20-10)).toFixed(1));
    spark.setAttribute('cy', '65');
    spark.setAttribute('r', (Math.random()*2+0.8).toFixed(1));
    spark.setAttribute('fill', Math.random() > 0.5 ? '#ffcc00' : '#ff9500');
    spark.style.animation = `spark-rise ${0.8+Math.random()*0.8}s ease-out forwards`;
    spark.style.setProperty('--sx', sx + 'px');
    sparksEl.appendChild(spark);
    setTimeout(() => spark.remove(), 1600);
  }, 280);
}

function stopSparks(){
  if (sparkInterval) { clearInterval(sparkInterval); sparkInterval = null; }
}

function playerSilhouetteSVG(role, alive, isMe){
  const c = !alive ? '#5a3030' : isMe ? 'var(--gold-bright)' : 'var(--parchment-2)';
  return ICONS.person(c);
}

function renderCampfireScene(st){
  const circle = $('players-circle');
  if (!circle) return;

  const players = st.players;
  const n = players.length;
  if (n === 0){ circle.innerHTML = ''; return; }

  // Calcular el centro y radios de la elipse (perspectiva)
  const sceneEl = $('campfire-scene');
  const W = sceneEl ? sceneEl.offsetWidth : 500;
  const H = sceneEl ? sceneEl.offsetHeight : 400;
  const cx = W / 2;
  const cy = H / 2;
  // Elipse más ancha que alta para dar perspectiva de "vista desde arriba-frente"
  const rx = Math.min(W * 0.38, 200);
  const ry = Math.min(H * 0.32, 150);

  // Semilla de jitter determinista por partida (mismo para todos)
  const seed = st.code ? st.code.charCodeAt(0) : 42;

  let html = '';
  players.forEach((p, i) => {
    // Distribuir en la elipse; empezar desde arriba (ángulo -π/2)
    const baseAngle = (2 * Math.PI * i / n) - Math.PI / 2;
    // Jitter pequeño y determinista en ángulo y radio
    const jitterAngle = ((seed * (i + 1) * 137) % 100) / 100 * 0.18 - 0.09;
    const jitterR = ((seed * (i + 3) * 71) % 100) / 100 * 0.08 + 0.96;
    const angle = baseAngle + jitterAngle;
    const px = cx + rx * jitterR * Math.cos(angle);
    const py = cy + ry * jitterR * Math.sin(angle);

    // Escala: jugadores "atrás" (parte superior) ligeramente más pequeños
    const depthScale = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(angle + Math.PI / 2));

    const isMe = p.id === myId;
    const alive = p.alive;
    const isActing = st.nightStep && (
      (st.nightStep === 'lobos' && p.role === 'lobo' && alive) ||
      (st.nightStep === p.role && alive)
    );
    const disconnected = !p.connected;

    // Dirección de la iluminación desde el fuego (centro) hacia el avatar
    const toFireX = (cx - px);
    const toFireY = (cy - py);
    const len = Math.sqrt(toFireX*toFireX + toFireY*toFireY) || 1;
    const fireDx = (50 + (toFireX/len)*30).toFixed(0);
    const fireDy = (50 + (toFireY/len)*30).toFixed(0);

    const bodyClass = [
      'avatar-body',
      alive ? 'alive' : 'dead',
      isMe ? 'me' : '',
      isActing ? 'acting' : '',
      disconnected ? 'disconnected' : '',
    ].filter(Boolean).join(' ');

    const labelClass = ['avatar-label', isMe?'me':'', !alive?'dead':''].filter(Boolean).join(' ');

    // Ícono del rol: revelar solo si está muerto (o si eres tú)
    const roleIcon = (!alive || isMe) && p.role
      ? `<svg class="avatar-silhouette" viewBox="0 0 100 100">${(ICONS[ROLE_ICON_MAP[p.role]] || ICONS.person)(alive ? (isMe?'var(--gold-bright)':'var(--parchment-2)') : '#8a4040')}</svg>`
      : `<svg class="avatar-silhouette" viewBox="0 0 100 100">${ICONS.person(isMe?'var(--gold-bright)':'var(--parchment-2)')}</svg>`;

    html += `<div class="player-avatar" style="left:${px.toFixed(1)}px;top:${py.toFixed(1)}px;transform:translate(-50%,-50%) scale(${depthScale.toFixed(3)});">
      <div class="${bodyClass}" style="--fire-dx:${fireDx}%;--fire-dy:${fireDy}%;">
        ${roleIcon}
        ${isMe ? '<div class="avatar-me-ring"></div>' : ''}
        ${!alive ? '<div class="death-fx"></div>' : ''}
      </div>
      <div class="${labelClass}">${esc(p.nickname)}${p.isAlguacil?' ⚖':''}${p.isHost?' 👑':''}</div>
    </div>`;
  });

  circle.innerHTML = html;
  startSparks();
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
  SS.clear();
  SFX.click();
  goToMenuWithNickname(v);
});
$('nickname-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-nickname-continue').click(); });

(function restoreSession(){
  const savedToken = SS.get('token');
  const savedRoom  = SS.get('room');
  const savedNick  = SS.get('nick');
  if (savedToken && savedRoom && savedNick) {
    myNickname = savedNick;
    mySessionToken = savedToken;
    $('menu-nickname-display').textContent = savedNick;
    socket.emit('reconnectPlayer', { sessionToken: savedToken, code: savedRoom });
  } else if (savedNick) {
    goToMenuWithNickname(savedNick);
  }
})();

/* ════════════════════════════════════════════════════════════════════
   RECONEXIÓN AUTOMÁTICA (Socket.io nativo)
   ════════════════════════════════════════════════════════════════════ */
socket.on('reconnect', () => {
  // Socket.io reconectó el transporte; ahora re-autenticamos con nuestro token
  const savedToken = SS.get('token');
  const savedRoom  = SS.get('room');
  if (savedToken && savedRoom) {
    socket.emit('reconnectPlayer', { sessionToken: savedToken, code: savedRoom });
  }
});

socket.on('reconnectOk', ({ code, sessionToken, nickname, isHost: host }) => {
  myRoomCode = code;
  mySessionToken = sessionToken;
  myNickname = nickname;
  isHost = host;
  SS.set('token', sessionToken);
  SS.set('room', code);
  SS.set('nick', nickname);
});

socket.on('reconnectFailed', () => {
  SS.clear();
  mySessionToken = null;
  const savedNick = myNickname;
  if (savedNick) goToMenuWithNickname(savedNick);
});

/* ════════════════════════════════════════════════════════════════════
   PANTALLA: MENÚ
   ════════════════════════════════════════════════════════════════════ */
$('btn-create-room').addEventListener('click', () => {
  SFX.click();
  socket.emit('createRoom', { nickname: myNickname, sessionToken: mySessionToken });
});
$('btn-show-join').addEventListener('click', () => {
  SFX.click();
  $('join-fields').classList.remove('hidden');
});
$('btn-join-room').addEventListener('click', () => {
  SFX.click();
  const code = $('room-code-input').value.trim().toUpperCase();
  if (!code){ $('menu-error').textContent = 'Ingresa un código de sala.'; return; }
  socket.emit('joinRoom', { nickname: myNickname, code, sessionToken: mySessionToken });
});

socket.on('roomCreated', ({ code, sessionToken }) => {
  myRoomCode = code; mySessionToken = sessionToken; isHost = true;
  SS.set('token', sessionToken); SS.set('room', code);
  showScreen('screen-lobby');
});
socket.on('roomJoined', ({ code, sessionToken, nickname }) => {
  myRoomCode = code; mySessionToken = sessionToken;
  if (nickname){ myNickname = nickname; SS.set('nick', nickname); }
  isHost = false;
  SS.set('token', sessionToken); SS.set('room', code);
  showScreen('screen-lobby');
});
socket.on('error', (msg) => {
  if (!$('screen-menu').classList.contains('hidden')) $('menu-error').textContent = msg;
  else if (!$('screen-lobby').classList.contains('hidden')) $('lobby-error').textContent = msg;
  else alert(msg);
});

/* ════════════════════════════════════════════════════════════════════
   PANTALLA: LOBBY
   ════════════════════════════════════════════════════════════════════ */
function renderRoleToggles(){
  $('role-toggles').innerHTML = OPTIONAL_ROLES.map(r => {
    const active = localEnabledRoles.includes(r);
    return `<button class="role-toggle ${active?'on':''}" data-role="${r}" ${isHost?'':'disabled'}>${ROLE_META[r].label}</button>`;
  }).join('');
  if (isHost){
    $('role-toggles').querySelectorAll('.role-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        SFX.click();
        const r = btn.dataset.role;
        if (localEnabledRoles.includes(r)) localEnabledRoles = localEnabledRoles.filter(x=>x!==r);
        else localEnabledRoles.push(r);
        socket.emit('setRoles', { roles: localEnabledRoles });
        renderRoleToggles();
      });
    });
  }
}

function renderTimings(){
  if (!isHost) return;
  Object.keys(localTimings).forEach(key => {
    const el = $('timing-' + key);
    if (el) el.textContent = localTimings[key] + 's';
  });
}

// Botones de configuración de tiempos
document.querySelectorAll('.timing-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!isHost) return;
    SFX.click();
    const key = btn.dataset.key;
    const delta = parseInt(btn.dataset.delta);
    const limits = { dayChat:[15,300], voting:[10,120], hunter:[10,60], nightStep:[15,120], wolves:[20,180] };
    const [min, max] = limits[key] || [10, 300];
    localTimings[key] = Math.max(min, Math.min(max, (localTimings[key]||60) + delta));
    renderTimings();
    socket.emit('setTimings', { timings: localTimings });
  });
});

$('wolf-count-minus').addEventListener('click', () => {
  if (!isHost) return; SFX.click();
  localWolfCount = Math.max(1, localWolfCount-1);
  $('wolf-count-value').textContent = localWolfCount;
  socket.emit('setWolfCount', { count: localWolfCount });
});
$('wolf-count-plus').addEventListener('click', () => {
  if (!isHost) return; SFX.click();
  localWolfCount = Math.min(4, localWolfCount+1);
  $('wolf-count-value').textContent = localWolfCount;
  socket.emit('setWolfCount', { count: localWolfCount });
});

$('btn-copy-code').addEventListener('click', () => {
  navigator.clipboard?.writeText(myRoomCode).then(() => {
    $('btn-copy-code').textContent = '¡Copiado!';
    setTimeout(() => $('btn-copy-code').textContent = 'Copiar', 1500);
  });
});

$('btn-start-game').addEventListener('click', () => { SFX.click(); socket.emit('startGame'); });

$('btn-back-lobby').addEventListener('click', () => {
  SFX.click();
  socket.disconnect();
  SS.del('room');
  myRoomCode = null; isHost = false; state = null;
  showScreen('screen-menu');
  $('join-fields').classList.add('hidden');
  $('menu-error').textContent = '';
  socket.connect();
});

function renderLobby(st){
  $('lobby-room-code').textContent = st.code;
  $('lobby-player-count').textContent = st.players.length;
  $('lobby-player-grid').innerHTML = st.players.map(p => `
    <div class="player-chip ${p.id === myId ? 'me' : ''}">
      ${p.isHost ? '👑 ' : ''}${esc(p.nickname)}
    </div>`).join('');
  if (isHost){
    $('host-settings').classList.remove('hidden');
    $('guest-settings-note').classList.add('hidden');
    if (st.timings) { localTimings = { ...localTimings, ...st.timings }; renderTimings(); }
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
  lobby:'Lobby', night:'Noche', day:'Día', voting:'Votación', hunter:'El Cazador', ended:'Fin'
};
const PHASE_ICONS = {
  night:'🌙', day:'☀️', voting:'⚖️', hunter:'🏹', ended:'💀'
};
function renderHUD(st){
  $('hud').classList.remove('hidden');
  $('hud-round-n').textContent = st.round || 1;
  const phaseLabel = PHASE_LABELS[st.state] || st.state;
  $('hud-phase-label').textContent = phaseLabel;
  const me = st.players.find(p => p.id === myId);
  $('hud-role-badge').classList.toggle('dead', me && !me.alive);
  $('hud-role-name').textContent = myRoleLabel || (me && !me.alive ? 'Caído' : '???');
  // Actualizar icono y fase en el narrador
  const phaseIcon = PHASE_ICONS[st.state] || '📜';
  if ($('narrator-phase-icon')) $('narrator-phase-icon').textContent = phaseIcon;
  if ($('narrator-phase-txt')) $('narrator-phase-txt').textContent = phaseLabel;
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
    const isUrgent = remain <= 10;
    const wasUrgent = $('hud-timer').classList.contains('urgent');
    $('hud-timer').classList.toggle('urgent', isUrgent);
    if (isUrgent && !wasUrgent) SFX.urgent();
    if (remain <= 0) clearInterval(countdownInterval);
  };
  tick();
  countdownInterval = setInterval(tick, 500);
}

/* ════════════════════════════════════════════════════════════════════
   TRANSICIONES DRAMÁTICAS
   ════════════════════════════════════════════════════════════════════ */
function showTransition(kind, title, sub, glyphSvg, duration=3500){
  const ov = $('transition-overlay');
  ov.className = 'transition-overlay ' + kind;
  $('transition-title').textContent = title;
  $('transition-sub').textContent = sub || '';
  $('transition-glyph').innerHTML = glyphSvg;
  $('transition-stars').innerHTML = kind === 'night' ? starsBackground(50) : '';
  requestAnimationFrame(() => ov.classList.add('show'));
  setTimeout(() => ov.classList.remove('show'), duration);
}
function triggerPhaseTransition(st){
  if (st.state === lastBroadcastState && st.round === (window.__lastRound||0)) return;
  if (st.state === 'night' && lastBroadcastState !== 'night'){
    SFX.night();
    showTransition('night', 'Cae la noche', `Ronda ${st.round} — el pueblo se encierra`, ringFrame(ICONS.moon('var(--moon-glow)'),{stroke:'var(--moon-glow)'}));
  } else if (st.state === 'day' && lastBroadcastState !== 'day'){
    SFX.day();
    showTransition('day', 'Amanece', 'El pueblo despierta y debe debatir', ringFrame(ICONS.sun('var(--sun-glow)'),{stroke:'var(--sun-glow)'}));
  } else if (st.state === 'voting' && lastBroadcastState !== 'voting'){
    SFX.vote();
    showTransition('vote', '¡A votar!', 'Decidan quién será ejecutado', ringFrame(ICONS.star('var(--blood-glow)'),{stroke:'var(--blood-glow)'}), 2600);
  } else if (st.state === 'hunter' && lastBroadcastState !== 'hunter'){
    SFX.hunter();
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
  setTimeout(() => { $('role-flip-card').classList.add('flipped'); SFX.click(); }, 600);
  if (state) renderHUD(state);
});
socket.on('youAreLovers', ({ partnerId }) => {
  const p = state && state.players.find(x => x.id === partnerId);
  showModal(`<h2>💘 Estás enamorado/a</h2><p class="subtle" style="margin:10px 0 16px;">Cupido ha unido tu corazón al de <b style="color:var(--gold-bright)">${esc(p?p.nickname:'tu pareja')}</b>. Si uno de los dos muere, el otro morirá de amor. Si quedan solos los dos al final, ¡ganan juntos!</p><button class="btn btn-gold" id="modal-close-btn">Entendido</button>`);
});

/* ════════════════════════════════════════════════════════════════════
   ZONA DE ACCIÓN
   ════════════════════════════════════════════════════════════════════ */
function choiceGrid(players, onPick, selectedId=null){
  const div = document.createElement('div');
  div.className = 'choice-grid';
  players.forEach(p => {
    const card = document.createElement('div');
    card.className = 'wolf-target' + (selectedId===p.id?' selected':'');
    card.innerHTML = `<div class="name">${esc(p.nickname)}</div>`;
    card.addEventListener('click', () => { SFX.click(); onPick(p.id); });
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
  p.className = 'subtle'; p.textContent = text;
  return p;
}
function renderActionPanel(st){
  const me = st.players.find(p => p.id === myId);
  if (st.state === 'night'){
    const step = st.nightStep;
    if (!step){ hideAction(); return; }
    if (step === 'cupido'){
      if (myRole === 'cupido' && me && me.alive){
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
        btn.className='btn btn-primary'; btn.style.marginTop='12px'; btn.textContent='Confirmar pareja';
        btn.disabled = cupidoSelection.length !== 2;
        btn.addEventListener('click', () => { socket.emit('cupidoChoose', { ids: cupidoSelection }); cupidoSelection=[]; hideAction(); });
        body.appendChild(btn);
      } else setAction('Cupido está despertando','Eligiendo a dos almas para unirlas…',roleIconSVG('cupido',46),waitingMsg('El pueblo aguarda en silencio.'));
    } else if (step === 'ladron'){
      if (myRole === 'ladron' && me && me.alive){
        const body = choiceGrid(st.players.filter(p=>p.id!==myId), (id) => { socket.emit('ladronChoose', { targetId:id }); hideAction(); });
        setAction('El Ladrón actúa','Elige con quién intercambiar tu carta',roleIconSVG('ladron',46),body);
      } else setAction('El Ladrón está despierto','Decidiendo si robar una identidad…',roleIconSVG('ladron',46),waitingMsg('El pueblo aguarda en silencio.'));
    } else if (step === 'vidente'){
      if (myRole === 'vidente' && me && me.alive){
        const body = choiceGrid(st.players.filter(p=>p.id!==myId&&p.alive), (id) => { socket.emit('videnteChoose', { targetId:id }); hideAction(); });
        setAction('Consulta tu visión','Elige a quién revelar su verdadero rol',roleIconSVG('vidente',46),body);
      } else setAction('La Vidente consulta los astros','Está espiando el rol de alguien…',roleIconSVG('vidente',46),waitingMsg('El pueblo aguarda en silencio.'));
    } else if (step === 'salvador'){
      if (myRole === 'salvador' && me && me.alive){
        const body = choiceGrid(st.players.filter(p=>p.alive), (id) => { socket.emit('salvadorChoose', { targetId:id }); hideAction(); });
        setAction('Protege a alguien','Elige quién estará a salvo esta noche',roleIconSVG('salvador',46),body);
      } else setAction('El Salvador vela por el pueblo','Está eligiendo a quién proteger…',roleIconSVG('salvador',46),waitingMsg('El pueblo aguarda en silencio.'));
    } else if (step === 'lobos'){
      if (myRole === 'lobo' && me && me.alive){
        const targets = st.players.filter(p=>p.alive&&p.role!=='lobo');
        const body = document.createElement('div');
        const grid = document.createElement('div'); grid.className='choice-grid';
        targets.forEach(p => {
          const card = document.createElement('div');
          const mine = wolfVotesCache[myId] === p.id;
          card.className = 'wolf-target' + (mine?' selected':'');
          const vc = Object.values(wolfVotesCache).filter(v=>v===p.id).length;
          card.innerHTML = `<div class="name">${esc(p.nickname)}</div>${vc>0?`<div style="font-size:10px;color:var(--blood-glow);margin-top:3px;">${vc}🐾</div>`:''}`;
          card.addEventListener('click', () => { SFX.click(); socket.emit('wolfVote', { targetId:p.id }); });
          grid.appendChild(card);
        });
        body.appendChild(grid);
        setAction('La manada elige','Voten en conjunto a su víctima de esta noche',roleIconSVG('lobo',46),body);
      } else setAction('Los lobos despiertan','Están eligiendo a su víctima…',roleIconSVG('lobo',46),waitingMsg('Duerme y espera el amanecer.'));
    } else if (step === 'bruja'){
      if (myRole === 'bruja' && me && me.alive) renderWitchPanel(st);
      else setAction('La Bruja prepara sus pociones','Decide si intervenir esta noche…',roleIconSVG('bruja',46),waitingMsg('El pueblo aguarda en silencio.'));
    }
  } else if (st.state === 'day'){
    const body = document.createElement('div');
    body.appendChild(waitingMsg('Debate en el chat. La votación comenzará pronto.'));
    if (isHost){
      const btn = document.createElement('button'); btn.className='btn btn-ghost'; btn.style.marginTop='12px'; btn.textContent='Saltar al voto';
      btn.addEventListener('click', () => socket.emit('skipToVote'));
      body.appendChild(btn);
    }
    setAction('Fase de día','La aldea debate quién podría ser un lobo',`<div style="width:46px;height:46px;">${ringFrame(ICONS.sun('var(--sun-glow)'),{stroke:'var(--sun-glow)'})}</div>`,body);
  } else if (st.state === 'voting'){
    if (me && me.alive){
      const targets = st.players.filter(p=>p.alive);
      const grid = document.createElement('div'); grid.className='choice-grid';
      targets.forEach(p => {
        const card = document.createElement('div');
        const mine = dayVotesCache[myId] === p.id;
        card.className = 'wolf-target' + (mine?' selected':'');
        const vc = Object.values(dayVotesCache).filter(v=>v===p.id).length;
        card.innerHTML = `<div class="name">${esc(p.nickname)}</div>${vc>0?`<div style="font-size:10px;color:var(--blood-glow);margin-top:3px;">${vc}🗳</div>`:''}`;
        card.addEventListener('click', () => { SFX.click(); socket.emit('dayVote', { targetId:p.id }); });
        grid.appendChild(card);
      });
      setAction('Votación','Elige a quién ejecutar',`<div style="width:46px;height:46px;">${ringFrame(ICONS.star('var(--blood-glow)'),{stroke:'var(--blood-glow)'})}</div>`,grid);
    } else hideAction();
  } else if (st.state === 'hunter'){
    if (st.hunterId === myId){
      const body = choiceGrid(st.players.filter(p=>p.alive&&p.id!==myId), (id) => { socket.emit('hunterShoot', { targetId:id }); hideAction(); });
      setAction('Tu última flecha','Elige a quién te llevarás contigo',roleIconSVG('cazador',46),body);
    } else {
      setAction('El Cazador decide','Tiene una última flecha…',roleIconSVG('cazador',46),waitingMsg('El pueblo observa en tensión.'));
    }
  } else {
    hideAction();
  }
}

let witchTargetInfo = null;
socket.on('witchInfo', (info) => { witchTargetInfo = info; if (state) renderActionPanel(state); });

function renderWitchPanel(st){
  const target = witchTargetInfo && witchTargetInfo.targetId ? { nickname:witchTargetInfo.targetNickname, id:witchTargetInfo.targetId } : null;
  const body = document.createElement('div');
  body.className='witch-panel';
  body.innerHTML = target
    ? `<p class="subtle">Los lobos eligieron a <b style="color:var(--blood-glow)">${esc(target.nickname)}</b>.</p>`
    : `<p class="subtle">Los lobos aún no han decidido a su víctima.</p>`;
  const row = document.createElement('div'); row.className='btn-row'; row.style.flexWrap='wrap'; row.style.marginTop='12px';
  if (!st.witchUsedSave && target){
    const btn = document.createElement('button'); btn.className='btn btn-gold'; btn.textContent='Poción de vida';
    btn.addEventListener('click', () => { socket.emit('witchAction',{save:true,kill:false}); witchTargetInfo=null; hideAction(); });
    row.appendChild(btn);
  }
  if (!st.witchUsedKill){
    const btn = document.createElement('button'); btn.className='btn btn-primary'; btn.textContent='Poción de muerte';
    btn.addEventListener('click', () => openKillPicker(st));
    row.appendChild(btn);
  }
  const skip = document.createElement('button'); skip.className='btn btn-ghost'; skip.textContent='No usar pociones';
  skip.addEventListener('click', () => { socket.emit('skipWitch'); witchTargetInfo=null; hideAction(); });
  row.appendChild(skip);
  body.appendChild(row);
  setAction('La Bruja decide','Tus pociones solo pueden usarse una vez',roleIconSVG('bruja',46),body);
}
function openKillPicker(st){
  const others = st.players.filter(p=>p.alive);
  const div = document.createElement('div');
  const h = document.createElement('h2'); h.textContent='Elige a tu víctima'; h.style.marginBottom='10px';
  div.appendChild(h);
  div.appendChild(choiceGrid(others, (id) => { socket.emit('witchAction',{save:false,kill:true,killTargetId:id}); witchTargetInfo=null; closeModal(); hideAction(); }));
  $('modal-box').innerHTML=''; $('modal-box').appendChild(div);
  $('modal-backdrop').classList.add('show');
}

/* ════════════════════════════════════════════════════════════════════
   MODALES
   ════════════════════════════════════════════════════════════════════ */
function showModal(html){
  $('modal-box').innerHTML = html;
  $('modal-backdrop').classList.add('show');
  const closeBtn = $('modal-box').querySelector('#modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
}
function closeModal(){ $('modal-backdrop').classList.remove('show'); }
$('modal-backdrop').addEventListener('click', e => { if (e.target.id==='modal-backdrop') closeModal(); });
socket.on('videnteResult', ({ targetNickname, label }) => {
  showModal(`<h2>🔮 Visión revelada</h2><p class="subtle" style="margin:10px 0 16px;"><b style="color:var(--gold-bright)">${esc(targetNickname)}</b> es en realidad: <b style="color:var(--blood-glow)">${esc(label)}</b></p><button class="btn btn-gold" id="modal-close-btn">Cerrar</button>`);
});

/* ════════════════════════════════════════════════════════════════════
   NARRADOR Y CHAT
   ════════════════════════════════════════════════════════════════════ */
function renderNarrator(){
  const log = $('narrator-log');
  if (!log) return;
  log.innerHTML = narratorLines.slice(-40).map(n => {
    const isPhase = /🌙|☀️|🗳️|🏹|🔄/.test(n);
    return `<div class="narrator-line ${isPhase?'phase-change':''}">${n}</div>`;
  }).join('');
  log.scrollTop = log.scrollHeight;
}
function chatTabsAvailable(){
  const me = state && state.players.find(p=>p.id===myId);
  if (!me || me.alive){
    const tabs = [{ key:'general', label:'General' }];
    if (myRole === 'lobo') tabs.push({ key:'wolf', label:'Lobos 🐺' });
    return tabs;
  }
  return [{ key:'dead', label:'Muertos 💀' }];
}
function renderChatTabs(){
  const tabs = chatTabsAvailable();
  if (!tabs.find(t=>t.key===activeChatTab)) activeChatTab = tabs[0].key;
  const html = tabs.map(t => `<button class="chat-tab ${t.key===activeChatTab?'active':''}" data-tab="${t.key}">${t.label}</button>`).join('');
  ['chat-tabs','chat-tabs-mobile'].forEach(id => {
    $(id).innerHTML = html;
    $(id).querySelectorAll('.chat-tab').forEach(btn => btn.addEventListener('click', () => {
      activeChatTab = btn.dataset.tab; renderChatTabs(); renderChatMessages();
    }));
  });
}
function renderChatMessages(){
  const data = activeChatTab==='wolf' ? chatWolf : activeChatTab==='dead' ? chatDead : chatGeneral;
  const html = data.map(m => `<div class="chat-msg ${m.nickname===myNickname?'mine':''} ${activeChatTab}">
    <span class="who">${esc(m.nickname)}</span>${esc(m.text)}</div>`).join('');
  ['chat-messages-desktop','chat-messages-mobile'].forEach(id => {
    $(id).innerHTML = html; $(id).scrollTop = $(id).scrollHeight;
  });
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
  $(`chat-send-${scope}`).addEventListener('click', () => {
    const inp = $(`chat-input-${scope}`); sendActiveChat(inp.value); inp.value='';
  });
  $(`chat-input-${scope}`).addEventListener('keydown', e => {
    if (e.key==='Enter'){ sendActiveChat(e.target.value); e.target.value=''; }
  });
});
$('chat-fab').addEventListener('click', () => { $('chat-drawer-mobile').classList.add('open'); $('chat-fab-badge').classList.add('hidden'); });
$('chat-drawer-close').addEventListener('click', () => $('chat-drawer-mobile').classList.remove('open'));

socket.on('chat', (msg) => {
  if (msg.type === 'narrator'){
    narratorLines.push(msg.text); renderNarrator();
    if (/murieron|muere de amor|ha ejecutado|se lleva/.test(msg.text)){ SFX.death(); triggerDeathFlash(); }
  } else if (msg.type === 'player'){ chatGeneral.push(msg); if (activeChatTab==='general') renderChatMessages(); else renderChatTabs(); }
  else if (msg.type === 'dead'){ chatDead.push(msg); if (activeChatTab==='dead') renderChatMessages(); else renderChatTabs(); }
});
function triggerDeathFlash(){
  const el = $('campfire-scene') || $('app');
  el.classList.remove('death-flash'); void el.offsetWidth; el.classList.add('death-flash');
  setTimeout(()=>el.classList.remove('death-flash'), 650);
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
  const prev = state;
  state = st;
  if (st.nightStep !== 'lobos') wolfVotesCache = {};
  if (st.state !== 'voting') dayVotesCache = {};

  if (st.state === 'lobby'){
    showScreen('screen-lobby');
    $('hud').classList.add('hidden');
    stopSparks();
    if (lastBroadcastState === 'ended' || lastBroadcastState === 'hunter'){
      myRole=null; myRoleLabel='';
      narratorLines=[]; chatGeneral=[]; chatWolf=[]; chatDead=[];
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
  renderCampfireScene(st);
  renderActionPanel(st);
  renderNarrator();
  renderChatTabs();
  renderChatMessages();
});

/* ════════════════════════════════════════════════════════════════════
   FIN DE PARTIDA
   ════════════════════════════════════════════════════════════════════ */
socket.on('gameOver', ({ winner, winnerIds, players }) => {
  clearInterval(countdownInterval);
  stopSparks();
  const titles = { villagers:'🏆 Ganan los Aldeanos', wolves:'🐺 Ganan los Hombres Lobo', lovers:'💑 Ganan los Enamorados' };
  $('gameover-title').textContent = titles[winner] || 'Fin de la partida';
  $('gameover-sub').textContent = 'Estos eran los verdaderos roles:';
  $('final-roles').innerHTML = players.map(p => {
    const meta = ROLE_META[p.role] || ROLE_META.aldeano;
    return `<div class="placard ${!p.alive?'is-dead':''}"><div class="name">${esc(p.nickname)}</div><div class="tag" style="color:${meta.color}">${meta.label}</div></div>`;
  }).join('');
  $('btn-play-again').classList.toggle('hidden', !isHost);
  $('gameover-waiting-note').classList.toggle('hidden', isHost);
  showScreen('screen-gameover');
});

$('btn-play-again').addEventListener('click', () => { SFX.click(); socket.emit('playAgain'); });

$('btn-back-menu').addEventListener('click', () => {
  SFX.click();
  socket.disconnect();
  SS.del('room');
  myRoomCode=null; isHost=false; state=null; myRole=null; myRoleLabel='';
  narratorLines=[]; chatGeneral=[]; chatWolf=[]; chatDead=[];
  showScreen('screen-menu');
  $('join-fields').classList.add('hidden');
  $('menu-error').textContent='';
  socket.connect();
});

/* ════════════════════════════════════════════════════════════════════
   PANEL DE CONFIGURACIÓN (engranaje)
   ════════════════════════════════════════════════════════════════════ */
$('settings-fab').addEventListener('click', () => {
  $('settings-panel').classList.toggle('hidden');
});
$('vol-music').addEventListener('input', e => { volMusic = parseFloat(e.target.value); });
$('vol-sfx').addEventListener('input', e => { volSfx = parseFloat(e.target.value); SFX.click(); });
$('btn-mute').addEventListener('click', () => {
  muted = !muted;
  $('btn-mute').textContent = muted ? '🔇 Silenciado' : '🔊 Activo';
  $('btn-mute').classList.toggle('on', !muted);
});
$('btn-reduce-motion').addEventListener('click', () => {
  document.body.classList.toggle('reduce-motion');
  const active = document.body.classList.contains('reduce-motion');
  $('btn-reduce-motion').textContent = active ? '🚫 Sin efectos' : '✨ Normal';
  $('btn-reduce-motion').classList.toggle('on', !active);
});

/* ════════════════════════════════════════════════════════════════════
   MANUAL DE ROLES
   ════════════════════════════════════════════════════════════════════ */
const ROLE_MANUAL = [
  { emoji:'🌾', title:'Aldeano', team:'Aldea', color:'#e8c468', desc:'No tiene habilidades especiales. Su arma es la palabra y la sospecha. Debe descubrir y eliminar a todos los Hombres Lobo.' },
  { emoji:'🐺', title:'Hombre Lobo', team:'Lobos', color:'#c0392b', desc:'Cada noche elige con su manada a un aldeano para eliminar. Finge ser aldeano durante el día. Gana cuando los lobos igualan en número a los aldeanos.' },
  { emoji:'🔮', title:'Vidente', team:'Aldea', color:'var(--moon-glow)', desc:'Cada noche puede espiar el verdadero rol de un jugador. Aliada de la aldea; debe compartir su información con cuidado.' },
  { emoji:'🧪', title:'Bruja', team:'Aldea', color:'#7fae6a', desc:'Tiene una poción de vida (salva a la víctima de los lobos) y una de muerte (envenena a cualquier jugador). Cada una se usa una sola vez.' },
  { emoji:'🏹', title:'Cazador', team:'Aldea', color:'var(--gold-bright)', desc:'Si muere (de noche o linchado), puede disparar y eliminar a otro jugador antes de caer.' },
  { emoji:'💘', title:'Cupido', team:'Variable', color:'#d97b9c', desc:'La primera noche une a dos almas. Si uno muere, el otro muere de amor. Si los enamorados son los últimos dos en pie, ganan juntos.' },
  { emoji:'🛡️', title:'Salvador', team:'Aldea', color:'#6a9e7f', desc:'Cada noche protege a un jugador del ataque de los lobos. No puede proteger a la misma persona dos noches seguidas.' },
  { emoji:'🃏', title:'Ladrón', team:'Variable', color:'#c9a227', desc:'La primera noche puede robar el rol de otro jugador. El robado recibe el rol de Aldeano.' },
  { emoji:'⚖️', title:'Alguacil', team:'Aldea', color:'var(--gold)', desc:'Su voto vale doble durante las votaciones del pueblo. Si muere puede designar a su sucesor.' },
];
function renderManual(){
  $('manual-panel').innerHTML = `
    <div style="font-size:12px;color:var(--gold-dim);margin-bottom:10px;line-height:1.6;">
      <b style="color:var(--gold-bright);">Objetivo:</b> Los aldeanos deben descubrir y eliminar a todos los Hombres Lobo. Los lobos deben sobrevivir y eliminar aldeanos sin ser descubiertos.<br><br>
      <b style="color:var(--gold-bright);">Flujo:</b> <b>Noche</b> → Roles especiales actúan en secreto. <b>Día</b> → El narrador anuncia las muertes, el pueblo debate y vota para ejecutar a un sospechoso.
    </div>
    ${ROLE_MANUAL.map(r => `
      <div style="background:rgba(0,0,0,.3);border:1px solid var(--iron);border-radius:8px;padding:10px 12px;margin-bottom:7px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="font-size:18px;">${r.emoji}</span>
          <b style="color:${r.color};font-family:'Cinzel',serif;font-size:12px;">${r.title}</b>
          <span style="margin-left:auto;font-size:10px;font-weight:600;letter-spacing:.05em;color:${r.color};opacity:.7;">${r.team.toUpperCase()}</span>
        </div>
        <p style="margin:0;font-size:12px;color:var(--parchment-2);line-height:1.55;">${r.desc}</p>
      </div>`).join('')}`;
}
$('btn-toggle-manual').addEventListener('click', () => {
  const panel = $('manual-panel');
  const hidden = panel.classList.contains('hidden');
  if (hidden){ renderManual(); panel.classList.remove('hidden'); $('btn-toggle-manual').textContent='📖 Ocultar instrucciones'; }
  else { panel.classList.add('hidden'); $('btn-toggle-manual').textContent='📖 Ver instrucciones y roles'; }
});
