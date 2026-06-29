/* ═══ Castronegro Frontend App ═══ */
const socket = io();
let myNickname = '';
let myRole = '';
let myId = '';
let currentRoom = null;
let gameState = null;
let activeTab = 'general';
let deadMessages = [];
let selectedTargets = [];
let pendingAction = null;

const ROLES = [
  { id: 'vidente',  label: '🔮 Vidente' },
  { id: 'bruja',    label: '🧪 Bruja' },
  { id: 'cazador',  label: '🏹 Cazador' },
  { id: 'cupido',   label: '💘 Cupido' },
  { id: 'ladron',   label: '🃏 Ladrón' },
  { id: 'nina',     label: '👧 Niña' },
  { id: 'alguacil', label: '🌟 Alguacil' },
  { id: 'salvador', label: '🛡️ Salvador' },
];

const ROLE_LABELS = {
  lobo: '🐺 Hombre Lobo', aldeano: '👨‍🌾 Aldeano',
  vidente: '🔮 Vidente', bruja: '🧪 Bruja', cazador: '🏹 Cazador',
  cupido: '💘 Cupido', ladron: '🃏 Ladrón', nina: '👧 Niña',
  alguacil: '🌟 Alguacil', salvador: '🛡️ Salvador',
};

/* ─── Screen navigation ─────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  const el = document.getElementById('screen-' + id);
  if (el) { el.style.display = 'flex'; el.classList.add('active'); }
}

/* ─── Toast ─────────────────────────────── */
function toast(msg, dur = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

/* ─── App actions ─────────────────────────────── */
const App = {
  confirmNickname() {
    const v = document.getElementById('inp-nickname').value.trim();
    if (!v) { toast('Ingresa tu apodo'); return; }
    myNickname = v;
    document.getElementById('menu-nick').textContent = v;
    showScreen('menu');
  },
  showCreate() { showScreen('create'); },
  showJoin() { showScreen('join'); },
  goMenu() { showScreen('menu'); },
  createRoom() { socket.emit('createRoom', { nickname: myNickname }); },
  joinRoom() {
    const code = document.getElementById('inp-code').value.trim().toUpperCase();
    if (code.length < 4) { toast('Ingresa un código válido'); return; }
    socket.emit('joinRoom', { nickname: myNickname, code });
  },
  copyCode() {
    if (currentRoom) { navigator.clipboard.writeText(currentRoom); toast('Código copiado: ' + currentRoom); }
  },
  startGame() { socket.emit('startGame'); },
  sendChat() {
    const inp = document.getElementById('lobby-chat-input');
    const text = inp.value.trim();
    if (!text) return;
    socket.emit('sendChat', { text });
    inp.value = '';
  },
  sendGameChat() {
    const inp = document.getElementById('game-chat-input');
    const text = inp.value.trim();
    if (!text) return;
    if (activeTab === 'wolf') {
      socket.emit('sendWolfChat', { text });
    } else {
      socket.emit('sendChat', { text });
    }
    inp.value = '';
  },
  switchTab(tab) {
    activeTab = tab;
    ['general','wolf','dead'].forEach(t => {
      const btn = document.getElementById('tab-' + t);
      if (btn) btn.classList.toggle('active', t === tab);
    });
    const box = document.getElementById('game-chat-box');
    box.innerHTML = '';
    const row = document.getElementById('chat-input-row');
    const me = gameState ? gameState.players.find(p => p.id === myId) : null;
    if (tab === 'dead') {
      deadMessages.forEach(m => appendChatMsg(box, m));
      row.style.display = me && !me.alive ? 'flex' : 'none';
    } else {
      if (tab === 'wolf') {
        // wolf messages rendered on wolfChat events
        row.style.display = me && me.alive ? 'flex' : 'none';
      } else {
        row.style.display = me && me.alive ? 'flex' : 'none';
      }
    }
  },
  skipToVote() { socket.emit('skipToVote'); },
  closeModal() { document.getElementById('modal').style.display = 'none'; },
};

/* ─── Socket events ─────────────────────────────── */
socket.on('roomCreated', ({ code }) => {
  currentRoom = code;
  document.getElementById('lobby-code').textContent = code;
  showScreen('lobby');
  buildRolesPanel(true);
});

socket.on('roomJoined', ({ code }) => {
  currentRoom = code;
  document.getElementById('lobby-code').textContent = code;
  showScreen('lobby');
  buildRolesPanel(false);
});

socket.on('error', (msg) => toast('⚠️ ' + msg));

socket.on('state', (state) => {
  gameState = state;
  myRole = state.myRole || myRole;
  myId = state.myId || myId;

  if (state.state === 'lobby') {
    renderLobby(state);
  } else if (['night','day','voting','hunter'].includes(state.state)) {
    renderGame(state);
  } else if (state.state === 'ended') {
    // handled by gameOver
  }
});

socket.on('chat', (msg) => {
  if (document.getElementById('screen-lobby').classList.contains('active')) {
    const box = document.getElementById('lobby-chat');
    appendChatMsg(box, msg);
    return;
  }
  if (activeTab === 'general') {
    const box = document.getElementById('game-chat-box');
    appendChatMsg(box, msg);
  }
});

socket.on('wolfChat', (msg) => {
  if (activeTab === 'wolf') {
    const box = document.getElementById('game-chat-box');
    appendChatMsg(box, msg);
  }
});

socket.on('roleAssigned', ({ role, label }) => {
  myRole = role;
  toast(`Tu carta: ${label}`, 5000);
});

socket.on('videnteResult', ({ targetNickname, label }) => {
  showModal('🔮 Visión', `<b>${targetNickname}</b> es un <b>${label}</b>.`, []);
});

socket.on('youAreLovers', ({ partnerId }) => {
  const partner = gameState ? gameState.players.find(p => p.id === partnerId) : null;
  const name = partner ? partner.nickname : '???';
  showModal('💘 Estás enamorado/a', `Cupido te ha unido con <b>${name}</b>. Si tu enamorado/a muere, morirás también.`, []);
});

socket.on('ninaSpyResult', ({ wolves }) => {
  const names = wolves.map(w => w.nickname).join(', ') || 'Nadie (?)';
  showModal('👧 Espionaje', `Los Hombres Lobo son: <b>${names}</b>`, []);
});

socket.on('wolfVoteUpdate', ({ votes, allVoted }) => {
  if (gameState && gameState.state === 'night') renderGame(gameState);
});

socket.on('voteUpdate', ({ votes }) => {
  if (gameState) { gameState.dayVotes = votes; renderGame(gameState); }
});

socket.on('gameOver', ({ winner, winnerIds, players }) => {
  showScreen('end');
  const icons = { villagers: '🏆', wolves: '🐺', lovers: '💑' };
  const titles = {
    villagers: '¡Los Aldeanos ganan!',
    wolves: '¡Los Hombres Lobo ganan!',
    lovers: '¡Los Enamorados ganan!',
  };
  document.getElementById('end-icon').textContent = icons[winner] || '🎭';
  document.getElementById('end-title').textContent = titles[winner] || 'Fin de partida';

  const rev = document.getElementById('end-reveal');
  rev.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'reveal-card' + (p.role === 'lobo' ? ' wolf' : '');
    div.innerHTML = `<div class="rname">${p.nickname}</div><div class="rrole">${ROLE_LABELS[p.role] || p.role}</div>`;
    rev.appendChild(div);
  });
});

/* ─── Lobby rendering ─────────────────────────────── */
function renderLobby(state) {
  const list = document.getElementById('players-list');
  list.innerHTML = '';
  state.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-item';
    div.innerHTML = (p.isHost ? '<span class="crown">👑</span>' : '<span>👤</span>') + ` ${p.nickname}` + (p.id === myId ? ' <small style="color:var(--muted)">(tú)</small>' : '');
    list.appendChild(div);
  });
  document.getElementById('player-count').textContent = state.players.length;
  document.getElementById('host-controls').style.display = state.hostId === myId ? 'block' : 'none';
}

function buildRolesPanel(isHost) {
  const container = document.getElementById('roles-checkboxes');
  container.innerHTML = '';
  ROLES.forEach(r => {
    const label = document.createElement('label');
    label.className = 'role-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'role-' + r.id;
    cb.disabled = !isHost;
    cb.addEventListener('change', () => {
      const enabled = ROLES.filter(x => document.getElementById('role-' + x.id)?.checked).map(x => x.id);
      socket.emit('setRoles', { roles: enabled });
    });
    label.appendChild(cb);
    label.appendChild(document.createElement('span')).textContent = r.label;
    container.appendChild(label);
  });
  document.getElementById('host-controls').style.display = isHost ? 'block' : 'none';
}

/* ─── Game rendering ─────────────────────────────── */
function renderGame(state) {
  if (!document.getElementById('screen-game').classList.contains('active')) {
    showScreen('game');
  }

  const me = state.players.find(p => p.id === myId);
  if (!me) return;

  // Header
  const phaseEl = document.getElementById('phase-indicator');
  const phaseMap = { night: '🌙 Noche', day: '☀️ Día', voting: '🗳️ Votación', hunter: '🏹 Cazador', ended: '🏁 Fin' };
  phaseEl.textContent = phaseMap[state.state] || state.state;
  phaseEl.className = 'phase-indicator ' + (state.state === 'night' ? 'night' : state.state === 'voting' ? 'voting' : 'day');
  document.getElementById('round-badge').textContent = `Ronda ${state.round}`;
  document.getElementById('my-role-badge').textContent = ROLE_LABELS[myRole] || myRole;

  // Host skip button
  const skipBtn = document.getElementById('host-skip-btn');
  skipBtn.style.display = (state.hostId === myId && state.state === 'day') ? 'block' : 'none';

  // Show wolf tab if wolf
  document.getElementById('tab-wolf').style.display = myRole === 'lobo' ? 'inline-block' : 'none';
  document.getElementById('tab-dead').style.display = !me.alive ? 'inline-block' : 'none';

  // Players list
  const list = document.getElementById('game-players-list');
  list.innerHTML = '';
  state.players.forEach(p => {
    const div = document.createElement('div');
    const isMe = p.id === myId;
    const isWolf = myRole === 'lobo' && p.role === 'lobo';
    div.className = `gplayer${!p.alive ? ' dead' : ''}${isMe ? ' me' : ''}${isWolf ? ' wolf' : ''}`;
    const votes = state.dayVotes ? Object.values(state.dayVotes).filter(v => v === p.id).length : 0;
    div.innerHTML = `<div class="role-dot"></div><span>${p.nickname}${isMe ? ' <small>(tú)</small>' : ''}</span>${p.isAlguacil ? '<span class="badge">🌟</span>' : ''}${votes > 0 ? `<span class="badge">🗳️${votes}</span>` : ''}`;
    list.appendChild(div);
  });

  // Action panel
  renderActionPanel(state, me);
}

function renderActionPanel(state, me) {
  const panel = document.getElementById('action-panel');
  const title = document.getElementById('action-title');
  const desc = document.getElementById('action-desc');
  const targets = document.getElementById('action-targets');
  const extra = document.getElementById('action-extra');
  targets.innerHTML = '';
  extra.innerHTML = '';

  // Night actions
  if (state.state === 'night' && me.alive) {
    const step = state.nightStep;

    if (step === 'cupido' && myRole === 'cupido') {
      panel.style.display = 'block';
      title.textContent = '💘 Cupido — Elige 2 enamorados';
      desc.textContent = `Seleccionados: ${selectedTargets.length}/2`;
      const alive = state.players.filter(p => p.alive);
      alive.forEach(p => {
        const btn = makeTargetBtn(p, selectedTargets.includes(p.id));
        btn.onclick = () => {
          if (selectedTargets.includes(p.id)) {
            selectedTargets = selectedTargets.filter(x => x !== p.id);
          } else if (selectedTargets.length < 2) {
            selectedTargets.push(p.id);
          }
          if (selectedTargets.length === 2) {
            socket.emit('cupidoChoose', { ids: selectedTargets });
            selectedTargets = [];
            panel.style.display = 'none';
          } else {
            renderActionPanel(state, me);
          }
        };
        targets.appendChild(btn);
      });
      return;
    }

    if (step === 'ladron' && myRole === 'ladron') {
      panel.style.display = 'block';
      title.textContent = '🃏 Ladrón — Elige una carta';
      desc.textContent = 'Intercambia tu carta con la de otro jugador';
      state.players.filter(p => p.alive && p.id !== myId).forEach(p => {
        const btn = makeTargetBtn(p);
        btn.onclick = () => { socket.emit('ladronChoose', { targetId: p.id }); panel.style.display = 'none'; };
        targets.appendChild(btn);
      });
      return;
    }

    if (step === 'vidente' && myRole === 'vidente') {
      panel.style.display = 'block';
      title.textContent = '🔮 Vidente — Revela un rol';
      desc.textContent = 'Elige a quién ver su carta';
      state.players.filter(p => p.alive && p.id !== myId).forEach(p => {
        const btn = makeTargetBtn(p);
        btn.onclick = () => { socket.emit('videnteChoose', { targetId: p.id }); panel.style.display = 'none'; };
        targets.appendChild(btn);
      });
      return;
    }

    if (step === 'salvador' && myRole === 'salvador') {
      panel.style.display = 'block';
      title.textContent = '🛡️ Salvador — Protege a alguien';
      desc.textContent = 'Elige a quién proteger esta noche';
      state.players.filter(p => p.alive).forEach(p => {
        const btn = makeTargetBtn(p);
        btn.onclick = () => { socket.emit('salvadorChoose', { targetId: p.id }); panel.style.display = 'none'; };
        targets.appendChild(btn);
      });
      return;
    }

    if (step === 'lobos' && myRole === 'lobo') {
      panel.style.display = 'block';
      title.textContent = '🐺 Hombres Lobo — Elige víctima';
      desc.textContent = 'Coordinen por el chat de lobos. Si no todos votan igual, se elige aleatoriamente.';
      state.players.filter(p => p.alive && p.role !== 'lobo').forEach(p => {
        const btn = makeTargetBtn(p);
        btn.onclick = () => { socket.emit('wolfVote', { targetId: p.id }); btn.style.borderColor = 'var(--gold)'; btn.disabled = true; };
        targets.appendChild(btn);
      });
      // Nina spy button
      if (myRole === 'nina') {
        const spyBtn = document.createElement('button');
        spyBtn.className = 'action-btn';
        spyBtn.textContent = '👀 Espiar a los lobos';
        spyBtn.onclick = () => socket.emit('ninaSpy');
        extra.appendChild(spyBtn);
      }
      return;
    }

    if (step === 'lobos' && myRole === 'nina') {
      panel.style.display = 'block';
      title.textContent = '👧 Niña — Puedes espiar';
      desc.textContent = 'Los lobos están eligiendo víctima. Puedes intentar ver quiénes son.';
      const spyBtn = document.createElement('button');
      spyBtn.className = 'action-btn';
      spyBtn.textContent = '👀 Espiar a los lobos';
      spyBtn.onclick = () => { socket.emit('ninaSpy'); spyBtn.disabled = true; spyBtn.textContent = 'Espiando...'; };
      targets.appendChild(spyBtn);
      return;
    }

    if (step === 'bruja' && myRole === 'bruja') {
      panel.style.display = 'block';
      title.textContent = '🧪 Bruja — Usa tus pociones';
      const nightTarget = state.players.find(p => p.id === state.nightTarget);
      desc.textContent = nightTarget ? `Los lobos van a matar a ${nightTarget.nickname}.` : 'Los lobos no eligieron víctima.';

      if (!state.witchUsedSave && nightTarget) {
        const saveBtn = document.createElement('button');
        saveBtn.className = 'action-btn';
        saveBtn.textContent = `💚 Salvar a ${nightTarget.nickname}`;
        saveBtn.onclick = () => { socket.emit('witchAction', { save: true }); panel.style.display = 'none'; };
        targets.appendChild(saveBtn);
      }
      if (!state.witchUsedKill) {
        const killTitle = document.createElement('p');
        killTitle.style.cssText = 'color:var(--muted);font-size:.8rem;margin-top:10px';
        killTitle.textContent = '☠️ Poción de muerte:';
        targets.appendChild(killTitle);
        state.players.filter(p => p.alive).forEach(p => {
          const btn = makeTargetBtn(p);
          btn.onclick = () => { socket.emit('witchAction', { kill: true, killTargetId: p.id }); panel.style.display = 'none'; };
          targets.appendChild(btn);
        });
      }
      const skipBtn = document.createElement('button');
      skipBtn.className = 'action-btn';
      skipBtn.style.marginTop = '10px';
      skipBtn.textContent = '❌ No usar pociones';
      skipBtn.onclick = () => { socket.emit('skipWitch'); panel.style.display = 'none'; };
      extra.appendChild(skipBtn);
      return;
    }

    // Waiting
    panel.style.display = 'block';
    title.textContent = '⏳ Esperando...';
    const stepNames = { cupido:'Cupido', ladron:'Ladrón', vidente:'Vidente', salvador:'Salvador', lobos:'Los Lobos', bruja:'La Bruja', nina:'La Niña' };
    desc.textContent = step ? `Turno de: ${stepNames[step] || step}` : 'El narrador prepara la noche...';
    targets.innerHTML = '';
    return;
  }

  // Voting
  if (state.state === 'voting' && me.alive) {
    panel.style.display = 'block';
    title.textContent = '🗳️ Votación';
    const myVote = state.dayVotes ? state.dayVotes[myId] : null;
    desc.textContent = myVote ? 'Ya votaste.' : '¿A quién ejecutar?';
    if (!myVote) {
      state.players.filter(p => p.alive && p.id !== myId).forEach(p => {
        const btn = makeTargetBtn(p);
        btn.onclick = () => { socket.emit('dayVote', { targetId: p.id }); panel.style.display = 'none'; };
        targets.appendChild(btn);
      });
    }
    return;
  }

  // Hunter
  if (state.state === 'hunter' && myId === state.hunterId) {
    panel.style.display = 'block';
    title.textContent = '🏹 El Cazador cae — ¿A quién llevas?';
    desc.textContent = '20 segundos para elegir tu víctima.';
    state.players.filter(p => p.alive).forEach(p => {
      const btn = makeTargetBtn(p);
      btn.onclick = () => { socket.emit('hunterShoot', { targetId: p.id }); panel.style.display = 'none'; };
      targets.appendChild(btn);
    });
    return;
  }

  panel.style.display = 'none';
}

function makeTargetBtn(player, selected = false) {
  const btn = document.createElement('button');
  btn.className = 'action-btn';
  btn.style.borderColor = selected ? 'var(--gold)' : '';
  btn.textContent = (selected ? '✓ ' : '') + player.nickname;
  return btn;
}

/* ─── Chat helpers ─────────────────────────────── */
function appendChatMsg(box, msg) {
  const div = document.createElement('div');
  div.className = 'msg ' + (msg.type || 'system');
  if (msg.type === 'narrator') {
    div.innerHTML = msg.text;
  } else if (msg.type === 'player' || msg.type === 'wolf' || msg.type === 'dead') {
    div.innerHTML = `<b>${msg.nickname}:</b> ${escHtml(msg.text)}`;
  } else {
    div.textContent = msg.text || '';
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;

  // Also add to narrator panel if narrator
  if (msg.type === 'narrator') {
    const nm = document.getElementById('narrator-msgs');
    if (nm) {
      const d = document.createElement('div');
      d.className = 'narrator-msg';
      d.innerHTML = msg.text;
      nm.appendChild(d);
      nm.scrollTop = nm.scrollHeight;
    }
  }
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ─── Modal ─────────────────────────────── */
function showModal(title, body, btnsList) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  const tg = document.getElementById('modal-targets');
  tg.innerHTML = '';
  btnsList.forEach(({ label, onClick }) => {
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.textContent = label;
    btn.onclick = onClick;
    tg.appendChild(btn);
  });
  document.getElementById('modal-close').style.display = 'block';
  document.getElementById('modal').style.display = 'flex';
}

/* ─── Keyboard shortcuts ─────────────────────────────── */
document.getElementById('inp-nickname').addEventListener('keydown', e => {
  if (e.key === 'Enter') App.confirmNickname();
});
document.getElementById('inp-code').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
});
document.getElementById('inp-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') App.joinRoom();
});

/* Initial screen */
showScreen('nickname');
