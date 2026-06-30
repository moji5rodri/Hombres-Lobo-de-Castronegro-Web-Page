const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ─── State ───────────────────────────────────────────────────────────────────
const rooms = {}; // roomCode -> room object
const socketToToken = {}; // socket.id actual -> sessionToken estable del jugador

function genToken() {
  return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function tokenOf(socketId) {
  return socketToToken[socketId] || null;
}

function makeRoom(code, hostToken) {
  return {
    code,
    hostId: hostToken,
    players: [],       // { id: sessionToken, socketId, nickname, role, alive, protected, poisoned, connected }
    state: 'lobby',    // lobby | night | day | voting | hunter | ended
    phase: 0,
    round: 0,
    enabledRoles: [],
    wolfCount: 1,
    deadline: null,    // timestamp (ms) when current timed phase ends, for client countdown
    nightStep: null,   // current night role acting
    nightVotes: {},    // wolfId -> targetId
    dayVotes: {},      // playerId -> targetId
    witchUsedSave: false,
    witchUsedKill: false,
    nightTarget: null, // who wolves chose
    loversIds: [],
    alguacilId: null,
    hunterId: null,
    chat: [],
    wolfChat: [],
    timers: {},
    createdAt: Date.now(),
  };
}

// getRoomOf ahora recibe el sessionToken estable del jugador (no el socket.id volátil)
function getRoomOf(token) {
  if (!token) return null;
  for (const code in rooms) {
    const r = rooms[code];
    if (r.players.find(p => p.id === token)) return r;
  }
  return null;
}

function getPlayer(room, id) {
  return room.players.find(p => p.id === id);
}

function broadcast(room) {
  const pub = publicState(room);
  room.players.forEach(p => {
    if (!p.socketId) return; // jugador desconectado temporalmente, no hay a quién emitirle
    const sock = io.sockets.sockets.get(p.socketId);
    if (!sock) return;
    sock.emit('state', { ...pub, myRole: p.role, myId: p.id, loversIds: room.loversIds });
  });
}

function publicState(room) {
  return {
    code: room.code,
    state: room.state,
    phase: room.phase,
    round: room.round,
    nightStep: room.nightStep,
    players: room.players.map(p => ({
      id: p.id,
      nickname: p.nickname,
      alive: p.alive,
      isHost: p.id === room.hostId,
      isAlguacil: p.id === room.alguacilId,
      role: p.role, // clients decide what to show
    })),
    enabledRoles: room.enabledRoles,
    wolfCount: room.wolfCount,
    deadline: room.deadline,
    witchUsedSave: room.witchUsedSave,
    witchUsedKill: room.witchUsedKill,
    hostId: room.hostId,
    alguacilId: room.alguacilId,
    hunterId: room.hunterId || null,
  };
}

function pushChat(room, msg) {
  room.chat.push(msg);
  io.to(room.code).emit('chat', msg);
}

function narrator(room, text) {
  pushChat(room, { type: 'narrator', text, ts: Date.now() });
}

// ─── Role sets & counts ───────────────────────────────────────────────────────
const ROLE_ORDER_NIGHT = ['cupido', 'ladron', 'vidente', 'salvador', 'lobos', 'bruja', 'nina'];

function assignRoles(room) {
  const n = room.players.length;
  const enabled = room.enabledRoles;
  const roles = [];

  // Special roles (one each if enabled)
  const specials = ['cupido', 'ladron', 'vidente', 'bruja', 'cazador', 'nina', 'alguacil', 'salvador'];
  for (const r of specials) {
    if (enabled.includes(r)) roles.push(r);
  }

  // Wolves: cantidad fijada por el host (1-4), recortada para no exceder lo razonable
  const wolfCount = Math.max(1, Math.min(4, room.wolfCount || 1, n - 1));
  room.wolfCount = wolfCount;
  for (let i = 0; i < wolfCount; i++) roles.push('lobo');

  // Fill rest with aldeanos
  while (roles.length < n) roles.push('aldeano');

  // Shuffle
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  room.players.forEach((p, i) => {
    p.role = roles[i];
    p.alive = true;
    p.protected = false;
    p.poisoned = false;
  });

  // Find alguacil if enabled
  if (enabled.includes('alguacil')) {
    const alg = room.players.find(p => p.role === 'alguacil');
    if (alg) room.alguacilId = alg.id;
  }
}

function clearTimer(room, key) {
  if (room.timers[key]) { clearTimeout(room.timers[key]); delete room.timers[key]; }
}

// ─── Night flow ───────────────────────────────────────────────────────────────
function startNight(room) {
  room.state = 'night';
  room.round++;
  room.nightTarget = null;
  room.nightVotes = {};
  room.phase = 0;
  room.deadline = null;
  narrator(room, `🌙 Noche ${room.round} — El pueblo duerme...`);
  broadcast(room);
  setTimeout(() => nextNightStep(room), 2000);
}

function nextNightStep(room) {
  const steps = ROLE_ORDER_NIGHT.filter(s => {
    if (s === 'cupido') return room.round === 1 && room.enabledRoles.includes('cupido');
    if (s === 'ladron') return room.round === 1 && room.enabledRoles.includes('ladron');
    if (s === 'vidente') return room.enabledRoles.includes('vidente') && room.players.some(p => p.role === 'vidente' && p.alive);
    if (s === 'salvador') return room.enabledRoles.includes('salvador') && room.players.some(p => p.role === 'salvador' && p.alive);
    if (s === 'lobos') return true;
    if (s === 'bruja') return room.enabledRoles.includes('bruja') && room.players.some(p => p.role === 'bruja' && p.alive);
    if (s === 'nina') return false; // passive, no turn
    return false;
  });

  room.phase++;
  if (room.phase > steps.length) {
    resolveNight(room);
    return;
  }
  const step = steps[room.phase - 1];
  room.nightStep = step;
  broadcast(room);

  const msgs = {
    cupido: '💘 Cupido despierta — elige a tus dos enamorados.',
    ladron: '🃏 El Ladrón despierta — elige una de las cartas sobrantes.',
    vidente: '🔮 La Vidente despierta — elige a quién revelar su rol.',
    salvador: '🛡️ El Salvador despierta — elige a quién proteger esta noche.',
    lobos: '🐺 Los Hombres Lobo despiertan — elijan a su víctima.',
    bruja: '🧪 La Bruja despierta — decide si usar tus pociones.',
  };
  narrator(room, msgs[step] || '');

  if (step === 'bruja') {
    const witch = room.players.find(p => p.role === 'bruja' && p.alive);
    if (witch) {
      const sock = io.sockets.sockets.get(witch.id);
      const target = room.nightTarget ? getPlayer(room, room.nightTarget) : null;
      if (sock) sock.emit('witchInfo', { targetId: room.nightTarget, targetNickname: target ? target.nickname : null });
    }
  }

  // Auto-advance if no one with that role is alive (safety)
  const hasRole = room.players.some(p => p.role === step.replace('lobos', 'lobo') && p.alive);
  if (step !== 'lobos' && !hasRole) {
    setTimeout(() => { if (room.nightStep === step) nightStepDone(room, step); }, 1500);
    return;
  }

  // Timeout for each step
  const timeout = step === 'lobos' ? 90000 : 45000;
  room.deadline = Date.now() + timeout;
  broadcast(room);
  clearTimer(room, 'nightStep');
  room.timers.nightStep = setTimeout(() => {
    if (room.nightStep === step) {
      if (step === 'lobos') autoWolfVote(room);
      else nightStepDone(room, step);
    }
  }, timeout);
}

function autoWolfVote(room) {
  const wolves = room.players.filter(p => p.role === 'lobo' && p.alive);
  const targets = room.players.filter(p => p.role !== 'lobo' && p.alive);
  if (targets.length === 0) { nightStepDone(room, 'lobos'); return; }
  const pick = targets[Math.floor(Math.random() * targets.length)];
  wolves.forEach(w => { room.nightVotes[w.id] = pick.id; });
  resolveWolfVote(room);
}

function resolveWolfVote(room) {
  const votes = Object.values(room.nightVotes);
  const count = {};
  votes.forEach(v => { count[v] = (count[v] || 0) + 1; });
  const max = Math.max(...Object.values(count));
  const candidates = Object.keys(count).filter(id => count[id] === max);
  room.nightTarget = candidates[Math.floor(Math.random() * candidates.length)];
  nightStepDone(room, 'lobos');
}

function nightStepDone(room, step) {
  clearTimer(room, 'nightStep');
  room.nightStep = null;
  nextNightStep(room);
}

function resolveNight(room) {
  room.nightStep = null;
  room.deadline = null;
  let killed = [];

  if (room.nightTarget) {
    const target = getPlayer(room, room.nightTarget);
    if (target && target.alive && !target.protected) {
      target.alive = false;
      killed.push(target);
    }
  }

  // Witch poison
  room.players.filter(p => p.poisoned && p.alive).forEach(p => {
    p.alive = false;
    p.poisoned = false;
    killed.push(p);
  });

  broadcast(room);

  if (killed.length === 0) {
    narrator(room, '🌅 Amanece... ¡Esta noche el pueblo estuvo protegido! Nadie murió.');
  } else {
    const names = killed.map(p => `<b>${p.nickname}</b>`).join(', ');
    narrator(room, `🌅 Amanece... Esta noche murieron: ${names}.`);
    // Check hunter
    const hunter = killed.find(p => p.role === 'cazador');
    if (hunter) {
      triggerHunter(room, hunter.id);
      return;
    }
  }

  // Check lovers death
  checkLoversDeath(room, killed);
  if (checkWinner(room)) return;
  startDay(room);
}

function checkLoversDeath(room, killed) {
  if (room.loversIds.length !== 2) return;
  const [a, b] = room.loversIds;
  killed.forEach(p => {
    if (p.id === a) {
      const partner = getPlayer(room, b);
      if (partner && partner.alive) { partner.alive = false; narrator(room, `💔 <b>${partner.nickname}</b> muere de amor.`); }
    }
    if (p.id === b) {
      const partner = getPlayer(room, a);
      if (partner && partner.alive) { partner.alive = false; narrator(room, `💔 <b>${partner.nickname}</b> muere de amor.`); }
    }
  });
}

function triggerHunter(room, hunterId) {
  room.state = 'hunter';
  room.hunterId = hunterId;
  room.deadline = Date.now() + 20000;
  narrator(room, `🏹 El Cazador ha caído — tiene 20 segundos para llevarse a alguien con él.`);
  broadcast(room);
  clearTimer(room, 'hunter');
  room.timers.hunter = setTimeout(() => {
    if (room.state === 'hunter') {
      room.deadline = null;
      narrator(room, '🏹 El Cazador no eligió a nadie.');
      room.state = 'night'; // dummy to reset
      checkLoversDeath(room, []);
      if (!checkWinner(room)) startDay(room);
    }
  }, 20000);
}

// ─── Day flow ─────────────────────────────────────────────────────────────────
function startDay(room) {
  room.state = 'day';
  room.dayVotes = {};
  room.deadline = Date.now() + 90000;
  narrator(room, `☀️ Fase de día — Debatan y acusen. La votación comenzará en 90 segundos.`);
  broadcast(room);
  clearTimer(room, 'day');
  room.timers.day = setTimeout(() => {
    if (room.state === 'day') startVoting(room);
  }, 90000);
}

function startVoting(room) {
  room.state = 'voting';
  room.dayVotes = {};
  room.deadline = Date.now() + 30000;
  narrator(room, `🗳️ ¡Votación! Tienen 30 segundos para votar a quién ejecutar.`);
  broadcast(room);
  clearTimer(room, 'voting');
  room.timers.voting = setTimeout(() => {
    if (room.state === 'voting') resolveVoting(room);
  }, 30000);
}

function resolveVoting(room) {
  clearTimer(room, 'voting');
  room.deadline = null;
  const votes = Object.values(room.dayVotes);
  if (votes.length === 0) {
    narrator(room, '🗳️ Nadie votó. El pueblo no ejecuta a nadie hoy.');
    if (!checkWinner(room)) startNight(room);
    return;
  }
  const count = {};
  const alivePlayers = room.players.filter(p => p.alive);
  votes.forEach(v => { count[v] = (count[v] || 0) + 1; });

  // Alguacil double vote
  if (room.alguacilId && room.dayVotes[room.alguacilId]) {
    const alg = getPlayer(room, room.alguacilId);
    if (alg && alg.alive) {
      count[room.dayVotes[room.alguacilId]] = (count[room.dayVotes[room.alguacilId]] || 0) + 1;
    }
  }

  const max = Math.max(...Object.values(count));
  const candidates = Object.keys(count).filter(id => count[id] === max);
  const executed = getPlayer(room, candidates[Math.floor(Math.random() * candidates.length)]);
  if (!executed) { if (!checkWinner(room)) startNight(room); return; }

  executed.alive = false;
  narrator(room, `⚰️ El pueblo ha ejecutado a <b>${executed.nickname}</b> (${roleLabel(executed.role)}).`);
  broadcast(room);

  const killed = [executed];
  checkLoversDeath(room, killed);

  if (executed.role === 'cazador') {
    triggerHunter(room, executed.id);
    return;
  }
  if (!checkWinner(room)) startNight(room);
}

// ─── Win check ────────────────────────────────────────────────────────────────
function checkWinner(room) {
  const alive = room.players.filter(p => p.alive);
  const wolves = alive.filter(p => p.role === 'lobo');
  const others = alive.filter(p => p.role !== 'lobo');

  // Lovers win
  if (room.loversIds.length === 2) {
    const [a, b] = room.loversIds;
    const pa = getPlayer(room, a), pb = getPlayer(room, b);
    if (pa && pb && pa.alive && pb.alive && alive.length === 2) {
      endGame(room, 'lovers', [a, b]);
      return true;
    }
  }

  if (wolves.length === 0) { endGame(room, 'villagers'); return true; }
  if (wolves.length >= others.length) { endGame(room, 'wolves'); return true; }
  return false;
}

function endGame(room, winner, winnerIds) {
  room.state = 'ended';
  room.deadline = null;
  room.lastWinner = winner;
  room.lastWinnerIds = winnerIds || [];
  const msgs = {
    villagers: '🏆 ¡Los Aldeanos ganan! Todos los Hombres Lobo han sido eliminados.',
    wolves: '🐺 ¡Los Hombres Lobo ganan! Han igualado en número a los aldeanos.',
    lovers: '💑 ¡Los Enamorados ganan! Son los últimos en pie.',
  };
  narrator(room, msgs[winner]);
  broadcast(room);
  io.to(room.code).emit('gameOver', { winner, winnerIds: winnerIds || [], players: room.players });
}

function roleLabel(role) {
  const labels = { lobo: 'Hombre Lobo', aldeano: 'Aldeano', vidente: 'Vidente', bruja: 'Bruja', cazador: 'Cazador', cupido: 'Cupido', ladron: 'Ladrón', nina: 'Niña', alguacil: 'Alguacil', salvador: 'Salvador' };
  return labels[role] || role;
}

// ─── Socket events ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // Helper interno: resuelve el token estable del jugador a partir del socket actual
  function myToken() { return socketToToken[socket.id] || null; }

  socket.on('createRoom', ({ nickname, sessionToken }) => {
    const token = sessionToken || genToken();
    socketToToken[socket.id] = token;

    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    // Evitar colisión de código (remotísima probabilidad, pero por si acaso)
    while (rooms[code]) code = Math.random().toString(36).substring(2, 7).toUpperCase();

    rooms[code] = makeRoom(code, token);
    rooms[code].players.push({
      id: token, socketId: socket.id,
      nickname, role: null, alive: true, protected: false, poisoned: false, connected: true
    });
    socket.join(code);
    socket.emit('roomCreated', { code, sessionToken: token });
    broadcast(rooms[code]);
  });

  socket.on('joinRoom', ({ nickname, code, sessionToken }) => {
    const room = rooms[code];
    if (!room) { socket.emit('error', 'Sala no encontrada.'); return; }
    if (room.state !== 'lobby') { socket.emit('error', 'La partida ya comenzó.'); return; }
    if (room.players.length >= 24) { socket.emit('error', 'Sala llena (máximo 24).'); return; }

    const token = sessionToken || genToken();
    socketToToken[socket.id] = token;

    // Nombres duplicados: agregar sufijo numérico si ya existe
    let finalNickname = nickname;
    const existing = room.players.map(p => p.nickname);
    if (existing.includes(finalNickname)) {
      let n = 1;
      while (existing.includes(`${nickname}(${n})`)) n++;
      finalNickname = `${nickname}(${n})`;
    }

    room.players.push({
      id: token, socketId: socket.id,
      nickname: finalNickname, role: null, alive: true, protected: false, poisoned: false, connected: true
    });
    socket.join(code);
    socket.emit('roomJoined', { code, sessionToken: token, nickname: finalNickname });
    broadcast(room);
    narrator(room, `👤 <b>${finalNickname}</b> se unió a la sala.`);
  });

  // Reconexión: el cliente envía su token guardado en sessionStorage
  socket.on('reconnectPlayer', ({ sessionToken, code }) => {
    if (!sessionToken || !code) { socket.emit('reconnectFailed'); return; }
    const room = rooms[code];
    if (!room) { socket.emit('reconnectFailed'); return; }

    const player = room.players.find(p => p.id === sessionToken);
    if (!player) { socket.emit('reconnectFailed'); return; }

    // Actualizar el socket actual del jugador en ambos mapas
    // Limpiar el mapeo viejo si existía
    const oldSocketId = Object.keys(socketToToken).find(sid => socketToToken[sid] === sessionToken);
    if (oldSocketId && oldSocketId !== socket.id) delete socketToToken[oldSocketId];

    socketToToken[socket.id] = sessionToken;
    player.socketId = socket.id;
    player.connected = true;

    socket.join(code);
    socket.emit('reconnectOk', {
      code,
      sessionToken,
      nickname: player.nickname,
      isHost: room.hostId === sessionToken,
    });
    narrator(room, `👤 <b>${player.nickname}</b> reconectó.`);
    broadcast(room);

    // Si había una partida activa con estado de fin, reenviar gameOver para que la UI lo muestre
    if (room.state === 'ended') {
      socket.emit('gameOver', {
        winner: room.lastWinner,
        winnerIds: room.lastWinnerIds || [],
        players: room.players
      });
    }
  });

  socket.on('setRoles', ({ roles }) => {
    const room = getRoomOf(myToken());
    if (!room || room.hostId !== myToken()) return;
    room.enabledRoles = roles;
    broadcast(room);
  });

  socket.on('setWolfCount', ({ count }) => {
    const room = getRoomOf(myToken());
    if (!room || room.hostId !== myToken()) return;
    const n = Math.max(1, Math.min(4, Math.round(count)));
    room.wolfCount = n;
    broadcast(room);
  });

  socket.on('startGame', () => {
    const room = getRoomOf(myToken());
    if (!room || room.hostId !== myToken()) return;
    if (room.players.length < 4) { socket.emit('error', 'Mínimo 4 jugadores para empezar.'); return; }
    assignRoles(room);
    // Send each player their role privately
    room.players.forEach(p => {
      const sock = io.sockets.sockets.get(p.socketId);
      if (sock) sock.emit('roleAssigned', { role: p.role, label: roleLabel(p.role) });
    });
    narrator(room, '🃏 Las cartas han sido repartidas. ¡Que comience la partida!');
    setTimeout(() => startNight(room), 3000);
  });

  // Night actions
  socket.on('cupidoChoose', ({ ids }) => {
    const room = getRoomOf(myToken());
    if (!room || room.nightStep !== 'cupido') return;
    const p = getPlayer(room, myToken());
    if (!p || p.role !== 'cupido') return;
    room.loversIds = ids.slice(0, 2);
    ids.forEach(id => {
      const lover = getPlayer(room, id);
      if (!lover) return;
      const s = io.sockets.sockets.get(lover.socketId);
      if (s) s.emit('youAreLovers', { partnerId: ids.find(x => x !== id) });
    });
    narrator(room, '💘 Cupido ha unido a dos almas.');
    nightStepDone(room, 'cupido');
  });

  socket.on('ladronChoose', ({ targetId }) => {
    const room = getRoomOf(myToken());
    if (!room || room.nightStep !== 'ladron') return;
    const p = getPlayer(room, myToken());
    if (!p || p.role !== 'ladron') return;
    const target = getPlayer(room, targetId);
    if (!target) return;
    [p.role, target.role] = [target.role, p.role];
    socket.emit('roleAssigned', { role: p.role, label: roleLabel(p.role) });
    const ts = io.sockets.sockets.get(target.socketId);
    if (ts) ts.emit('roleAssigned', { role: target.role, label: roleLabel(target.role) });
    narrator(room, '🃏 El Ladrón ha actuado.');
    nightStepDone(room, 'ladron');
  });

  socket.on('videnteChoose', ({ targetId }) => {
    const room = getRoomOf(myToken());
    if (!room || room.nightStep !== 'vidente') return;
    const p = getPlayer(room, myToken());
    if (!p || p.role !== 'vidente') return;
    const target = getPlayer(room, targetId);
    if (!target) return;
    socket.emit('videnteResult', { targetId, targetNickname: target.nickname, role: target.role, label: roleLabel(target.role) });
    narrator(room, '🔮 La Vidente ha consultado los astros.');
    nightStepDone(room, 'vidente');
  });

  socket.on('salvadorChoose', ({ targetId }) => {
    const room = getRoomOf(myToken());
    if (!room || room.nightStep !== 'salvador') return;
    const p = getPlayer(room, myToken());
    if (!p || p.role !== 'salvador') return;
    const target = getPlayer(room, targetId);
    if (!target) return;
    // Reset previous protection
    room.players.forEach(pl => pl.protected = false);
    target.protected = true;
    narrator(room, '🛡️ El Salvador ha protegido a alguien.');
    nightStepDone(room, 'salvador');
  });

  socket.on('wolfVote', ({ targetId }) => {
    const room = getRoomOf(myToken());
    if (!room || room.nightStep !== 'lobos') return;
    const p = getPlayer(room, myToken());
    if (!p || p.role !== 'lobo' || !p.alive) return;
    room.nightVotes[myToken()] = targetId;
    // Broadcast to wolves only that someone voted
    const wolves = room.players.filter(pl => pl.role === 'lobo' && pl.alive);
    const allVoted = wolves.every(w => room.nightVotes[w.id]);
    io.to(room.code).emit('wolfVoteUpdate', { votes: room.nightVotes, allVoted });
    if (allVoted) {
      clearTimer(room, 'nightStep');
      resolveWolfVote(room);
    }
  });

  socket.on('witchAction', ({ save, kill, killTargetId }) => {
    const room = getRoomOf(myToken());
    if (!room || room.nightStep !== 'bruja') return;
    const p = getPlayer(room, myToken());
    if (!p || p.role !== 'bruja') return;

    if (save && !room.witchUsedSave && room.nightTarget) {
      const target = getPlayer(room, room.nightTarget);
      if (target) target.protected = true;
      room.witchUsedSave = true;
      narrator(room, '🧪 La Bruja usó la poción de salvación.');
    }
    if (kill && killTargetId && !room.witchUsedKill) {
      const target = getPlayer(room, killTargetId);
      if (target) target.poisoned = true;
      room.witchUsedKill = true;
      narrator(room, '🧪 La Bruja usó la poción de muerte.');
    }
    nightStepDone(room, 'bruja');
  });

  socket.on('skipWitch', () => {
    const room = getRoomOf(myToken());
    if (!room || room.nightStep !== 'bruja') return;
    const p = getPlayer(room, myToken());
    if (!p || p.role !== 'bruja') return;
    nightStepDone(room, 'bruja');
  });

  socket.on('hunterShoot', ({ targetId }) => {
    const room = getRoomOf(myToken());
    if (!room || room.state !== 'hunter') return;
    if (room.hunterId !== myToken()) return;
    clearTimer(room, 'hunter');
    const target = getPlayer(room, targetId);
    if (target && target.alive) {
      target.alive = false;
      narrator(room, `🏹 El Cazador se lleva a <b>${target.nickname}</b> con él.`);
      checkLoversDeath(room, [target]);
    }
    if (!checkWinner(room)) startDay(room);
  });

  // Day actions
  socket.on('skipToVote', () => {
    const room = getRoomOf(myToken());
    if (!room || room.state !== 'day' || room.hostId !== myToken()) return;
    clearTimer(room, 'day');
    startVoting(room);
  });

  socket.on('dayVote', ({ targetId }) => {
    const room = getRoomOf(myToken());
    if (!room || room.state !== 'voting') return;
    const p = getPlayer(room, myToken());
    if (!p || !p.alive) return;
    room.dayVotes[myToken()] = targetId;
    io.to(room.code).emit('voteUpdate', { votes: room.dayVotes });
    const alivePlayers = room.players.filter(pl => pl.alive);
    if (Object.keys(room.dayVotes).length >= alivePlayers.length) {
      clearTimer(room, 'voting');
      resolveVoting(room);
    }
  });

  // Chat
  socket.on('sendChat', ({ text }) => {
    const room = getRoomOf(myToken());
    if (!room) return;
    const p = getPlayer(room, myToken());
    if (!p) return;
    if (!p.alive) {
      // Dead can only send to dead chat
      const msg = { type: 'dead', nickname: p.nickname, text, ts: Date.now() };
      // Send only to dead players
      room.players.filter(pl => !pl.alive).forEach(pl => {
        const s = io.sockets.sockets.get(pl.id);
        if (s) s.emit('chat', msg);
      });
      return;
    }
    pushChat(room, { type: 'player', nickname: p.nickname, text, ts: Date.now() });
  });

  socket.on('sendWolfChat', ({ text }) => {
    const room = getRoomOf(myToken());
    if (!room) return;
    const p = getPlayer(room, myToken());
    if (!p || p.role !== 'lobo' || !p.alive) return;
    const msg = { type: 'wolf', nickname: p.nickname, text, ts: Date.now() };
    room.wolfChat.push(msg);
    room.players.filter(pl => pl.role === 'lobo').forEach(pl => {
      const s = io.sockets.sockets.get(pl.id);
      if (s) s.emit('wolfChat', msg);
    });
  });

  socket.on('ninaSpy', () => {
    const room = getRoomOf(myToken());
    if (!room || room.nightStep !== 'lobos') return;
    const p = getPlayer(room, myToken());
    if (!p || p.role !== 'nina') return;
    const wolves = room.players.filter(pl => pl.role === 'lobo').map(pl => ({ id: pl.id, nickname: pl.nickname }));
    socket.emit('ninaSpyResult', { wolves });
  });

  socket.on('playAgain', () => {
    const room = getRoomOf(myToken());
    if (!room || room.hostId !== myToken()) return;
    if (room.state !== 'ended') return;

    // Reset de la sala manteniendo a los mismos jugadores conectados
    room.state = 'lobby';
    room.phase = 0;
    room.round = 0;
    room.nightStep = null;
    room.nightVotes = {};
    room.dayVotes = {};
    room.witchUsedSave = false;
    room.witchUsedKill = false;
    room.nightTarget = null;
    room.loversIds = [];
    room.alguacilId = null;
    room.hunterId = null;
    room.deadline = null;
    room.chat = [];
    room.wolfChat = [];
    Object.keys(room.timers).forEach(k => clearTimer(room, k));

    room.players.forEach(p => {
      p.role = null;
      p.alive = true;
      p.protected = false;
      p.poisoned = false;
    });

    broadcast(room);
    narrator(room, '🔄 El anfitrión ha iniciado una nueva ronda. ¡Bienvenidos de vuelta a la aldea!');
  });

  socket.on('disconnect', () => {
    const token = myToken();
    delete socketToToken[socket.id]; // limpiar el mapa de socket->token

    if (!token) return;
    const room = getRoomOf(token);
    if (!room) return;
    const p = getPlayer(room, token);
    if (!p) return;

    p.connected = false;
    p.socketId = null;

    if (room.state === 'lobby' || room.state === 'ended') {
      // En lobby o fin de partida: eliminar inmediatamente, no tiene sentido esperar
      room.players = room.players.filter(pl => pl.id !== token);
      if (room.players.length === 0) { delete rooms[room.code]; return; }
      if (room.hostId === token && room.players.length > 0) {
        // Pasar host al primer jugador conectado
        const nextHost = room.players.find(pl => pl.connected) || room.players[0];
        room.hostId = nextHost.id;
        narrator(room, `👑 <b>${nextHost.nickname}</b> es el nuevo anfitrión.`);
      }
      narrator(room, `👤 <b>${p.nickname}</b> salió de la sala.`);
      broadcast(room);
    } else {
      // Durante partida activa: dar 45s de gracia para reconectar
      narrator(room, `📡 <b>${p.nickname}</b> perdió conexión. Tiene 45s para reconectar.`);
      broadcast(room); // actualizar UI con estado de desconectado

      clearTimer(room, `dc_${token}`); // limpiar timer previo si existía (señal inestable)
      room.timers[`dc_${token}`] = setTimeout(() => {
        // Si pasaron los 45s y no reconectó, eliminarlo definitivamente
        const stillDisconnected = room.players.find(pl => pl.id === token && !pl.connected);
        if (!stillDisconnected) return; // ya reconectó, no hacer nada

        room.players = room.players.filter(pl => pl.id !== token);
        if (room.players.length === 0) { delete rooms[room.code]; return; }
        if (room.hostId === token && room.players.length > 0) {
          const nextHost = room.players.find(pl => pl.connected) || room.players[0];
          room.hostId = nextHost.id;
          narrator(room, `👑 <b>${nextHost.nickname}</b> es el nuevo anfitrión.`);
        }
        narrator(room, `👤 <b>${p.nickname}</b> fue eliminado por desconexión.`);
        broadcast(room);
        // Si era un jugador clave y la partida sigue, dejar que el flujo natural de juego lo maneje
      }, 45000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🐺 Castronegro corriendo en puerto ${PORT}`));
