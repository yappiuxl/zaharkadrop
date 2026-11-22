'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const SAVE_INTERVAL = 5000;
const START_BALANCE = 100;
const HOUSE_EDGE = 1.0;
const MAX_HISTORY = 12;
const GOLD_CHANCE = 0.4;
const GOLD_SIZE = 0.10;
const GOLD_MULT = 2.0;
const GOLD_MIN_RATIO = 0.8;
const CHANCE_MIN = 0.0001;
const CHANCE_MAX = 0.99;

const RARITIES = {
  kaka:   { name: 'Кака',         color: '#6b6b6b' },
  norm:   { name: 'Норм',         color: '#4a9e5c' },
  rare:   { name: 'Редкий',       color: '#3b82f6' },
  epic:   { name: 'Эпический',    color: '#a855f7' },
  legend: { name: 'Легендарный',  color: '#f59e0b' },
  true:   { name: 'true Zaharka', color: '#ff2d6f' }
};
const RARITY_ORDER = ['kaka', 'norm', 'rare', 'epic', 'legend', 'true'];

const ITEMS = {
  kaka: [
    { icon: '??',  name: 'Зевок',                price: 1   },
    { icon: '❌',  name: 'Упущенная возможность', price: 10  },
    { icon: '?',   name: 'Ошибка',               price: 50  },
    { icon: '!?',  name: 'Неточность',           price: 100 }
  ],
  norm: [
    { icon: '➡️', name: 'Вынужденный',           price: 500  },
    { icon: '📖', name: 'Теоретический',         price: 1000 }
  ],
  rare: [
    { icon: '👍', name: 'Хороший',               price: 2000 },
    { icon: '✔️', name: 'Отличный',              price: 3000 }
  ],
  epic: [
    { icon: '⭐️', name: 'Лучший',                price: 5000 }
  ],
  legend: [
    { icon: '!',  name: 'Замечательный',         price: 10000 }
  ],
  true: [
    { icon: '!!', name: 'БРИЛЛИАНТ',             price: 25000 }
  ]
};

const AVG = {};
RARITY_ORDER.forEach(r => {
  const arr = ITEMS[r];
  AVG[r] = arr.reduce((s, i) => s + i.price, 0) / arr.length;
});

const BASE_SHAPE = { kaka: 40, norm: 35, rare: 18 };
const TAIL = ['epic', 'legend', 'true'];

function computeWeights(targetPrice) {
  const solve = (k) => {
    const w = {};
    for (const r in BASE_SHAPE) w[r] = BASE_SHAPE[r];
    for (const r of TAIL) w[r] = k;
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    let ev = 0;
    for (const r in w) ev += (w[r] / total) * AVG[r];
    return ev;
  };
  let lo = 1e-9, hi = 1e9;
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi);
    if (solve(mid) < targetPrice) lo = mid; else hi = mid;
  }
  const k = Math.sqrt(lo * hi);
  const w = {};
  for (const r in BASE_SHAPE) w[r] = BASE_SHAPE[r];
  for (const r of TAIL) w[r] = k;
  return w;
}

const CASES = [
  { id: 'starter', name: 'Стартовый',    icon: '📦', price: 100,   desc: 'Шанс на что-то норм' },
  { id: 'middle',  name: 'Средний',      icon: '🎁', price: 500,   desc: 'Больше шансов на редкое' },
  { id: 'pro',     name: 'Про',          icon: '🧰', price: 2000,  desc: 'Только серьёзные вещи' },
  { id: 'zaharka', name: 'Захарка-кейс', icon: '👁️', price: 10000, desc: 'Шанс на БРИЛЛИАНТ' }
];
CASES.forEach(c => { c.weights = computeWeights(c.price); });

const state = {
  players: {},
  battles: {}
};

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (raw.players) state.players = raw.players;
    if (raw.battles) state.battles = raw.battles;
  } catch (e) {}
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ players: state.players, battles: state.battles }));
  } catch (e) {}
}

setInterval(saveData, SAVE_INTERVAL);

function rollRarity(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [rar, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return rar;
  }
  return Object.keys(weights)[0];
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function makeItem(rarity) {
  const base = pick(ITEMS[rarity]);
  return { ...base, rarity, uid: Date.now() + Math.random() };
}

function calcChance(source, target) {
  if (!source || !target) return null;
  const mult = target.price / source.price;
  let chance = (1 / mult) * HOUSE_EDGE;
  if (chance < CHANCE_MIN) return 0;
  return Math.min(CHANCE_MAX, chance);
}

function getGoldItem(target) {
  const wanted = target.price * GOLD_MULT;
  let best = null;
  let bestDiff = Infinity;
  RARITY_ORDER.forEach(rar => {
    ITEMS[rar].forEach((it, index) => {
      if (it.price < wanted) return;
      const diff = it.price - wanted;
      if (diff < bestDiff) {
        bestDiff = diff;
        best = { rarity: rar, index, ...it };
      }
    });
  });
  if (!best) {
    const lastRar = RARITY_ORDER[RARITY_ORDER.length - 1];
    const lastArr = ITEMS[lastRar];
    best = { rarity: lastRar, index: lastArr.length - 1, ...lastArr[lastArr.length - 1] };
  }
  return best;
}

function getPlayer(pid) { return state.players[pid] || null; }
function publicPlayer(p) { return { nick: p.nick, balance: p.balance, inventory: p.inventory, history: p.history }; }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/import') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.players) state.players = data.players;
        if (data.battles) state.battles = data.battles;
        saveData();
        res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'bad json' })); }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/api/export') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="zaharkadrop-save1.json"' });
    res.end(JSON.stringify({ players: state.players, battles: state.battles }, null, 2));
    return;
  }

  let filePath = req.url.split('?')[0];
  if (filePath === '/' || filePath === '') filePath = '/index.html';
  const safe = path.normalize(path.join(__dirname, 'public', filePath));
  if (!safe.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); res.end('forbidden'); return; }
  
  fs.readFile(safe, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(safe).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const clients = new Map();

function broadcastAll(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(msg);
}
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function broadcastBattles() {
  const list = Object.values(state.battles)
    .filter(b => b.status === 'waiting')
    .map(b => ({ id: b.id, creatorNick: b.creatorNick, caseIds: b.caseIds, cases: b.caseIds.map(id => CASES.find(c => c.id === id)).filter(Boolean), price: b.price, createdAt: b.createdAt }));
  broadcastAll({ type: 'battles', battles: list });
}

function sendStateTo(ws, pid) {
  const p = getPlayer(pid);
  if (p) send(ws, { type: 'state', player: publicPlayer(p) });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'hello') {
      const pid = String(msg.playerId || '').trim();
      const nick = String(msg.nick || '').trim().slice(0, 24);
      if (!pid || !nick) return send(ws, { type: 'error', msg: 'need playerId and nick' });
      
      let p = getPlayer(pid);
      if (!p) {
        p = { nick, balance: START_BALANCE, inventory: [], history: [] };
        state.players[pid] = p;
      } else p.nick = nick;
      
      clients.set(ws, { playerId: pid, nick });
      send(ws, { type: 'hello_ok', playerId: pid, player: publicPlayer(p), cases: CASES.map(c => ({ id: c.id, name: c.name, icon: c.icon, price: c.price, desc: c.desc })) });
      sendStateTo(ws, pid);
      broadcastBattles();
      return;
    }

    const c = clients.get(ws);
    if (!c) return;
    const p = getPlayer(c.playerId);
    if (!p) return;

    if (msg.type === 'get_state') { sendStateTo(ws, c.playerId); return; }
    if (msg.type === 'earn_money') { p.balance += 0.1; sendStateTo(ws, c.playerId); saveData(); return; }

    if (msg.type === 'open_case') {
      const caseObj = CASES.find(x => x.id === msg.caseId);
      if (!caseObj) return;
      if (p.balance < caseObj.price) return send(ws, { type: 'error', msg: 'no money' });
      p.balance -= caseObj.price;
      const rarity = rollRarity(caseObj.weights);
      const item = makeItem(rarity);
      p.inventory.push(item);
      sendStateTo(ws, c.playerId);
      send(ws, { type: 'case_opened', caseId: caseObj.id, item });
      saveData();
      return;
    }

    if (msg.type === 'sell_item') {
      const idx = p.inventory.findIndex(i => i.uid === msg.uid);
      if (idx !== -1) {
        p.balance += p.inventory[idx].price;
        p.inventory.splice(idx, 1);
        sendStateTo(ws, c.playerId);
        saveData();
      }
      return;
    }
    if (msg.type === 'sell_all') {
      p.balance += p.inventory.reduce((s, i) => s + i.price, 0);
      p.inventory = [];
      sendStateTo(ws, c.playerId);
      saveData();
      return;
    }

    if (msg.type === 'upgrade') {
      const srcIdx = p.inventory.findIndex(i => i.uid === msg.sourceUid);
      if (srcIdx === -1) return;
      const source = p.inventory[srcIdx];
      const target = msg.target;
      if (!target) return;
      const chance = calcChance(source, target);
      if (!chance) return;

      const goldActive = Math.random() < GOLD_CHANCE;
      const winDeg = chance * 360;
      let goldDeg = 0;
      if (goldActive && winDeg > 0) {
        if (winDeg <= GOLD_SIZE * 360) goldDeg = winDeg * GOLD_MIN_RATIO;
        else goldDeg = GOLD_SIZE * 360;
        goldDeg = Math.min(goldDeg, winDeg);
      }
      const goldStart = (winDeg - goldDeg) / 2;
      const goldEnd = goldStart + goldDeg;
      const roll = Math.random() * 360;
      let result;
      if (roll < goldStart) result = 'win';
      else if (roll < goldEnd) result = 'gold';
      else if (roll < winDeg) result = 'win';
      else result = 'lose';

      p.inventory.splice(srcIdx, 1);
      let wonItem = null;
      if (result === 'win' || result === 'gold') {
        wonItem = result === 'gold' ? getGoldItem(target) : target;
        p.inventory.push({ ...wonItem, uid: Date.now() + Math.random() });
      }
      p.history.unshift({ result, fromIcon: source.icon, fromName: source.name, toIcon: wonItem ? wonItem.icon : target.icon, toName: wonItem ? wonItem.name : target.name, chance: (chance * 100).toFixed(2) + '%', gain: wonItem ? wonItem.price - source.price : 0, loss: result === 'lose' ? source.price : 0 });
      if (p.history.length > MAX_HISTORY) p.history.length = MAX_HISTORY;
      
      sendStateTo(ws, c.playerId);
      send(ws, { type: 'upgrade_result', result, wonItem, chance, goldActive, target, source });
      saveData();
      return;
    }

    if (msg.type === 'battle_create') {
      const caseIds = (msg.caseIds || []).filter(id => CASES.some(c => c.id === id)).slice(0, 20);
      if (caseIds.length === 0) return send(ws, { type: 'error', msg: 'no cases' });
      const price = caseIds.reduce((s, id) => s + CASES.find(c => c.id === id).price, 0);
      if (p.balance < price) return send(ws, { type: 'error', msg: 'no money' });
      p.balance -= price;
      const id = crypto.randomUUID();
      state.battles[id] = { id, creatorId: c.playerId, creatorNick: p.nick, caseIds, price, status: 'waiting', joinerId: null, joinerNick: null, drops: {}, createdAt: Date.now() };
      sendStateTo(ws, c.playerId);
      broadcastBattles();
      saveData();
      return;
    }

    if (msg.type === 'battle_cancel') {
      const b = state.battles[msg.battleId];
      if (!b || b.status !== 'waiting' || b.creatorId !== c.playerId) return;
      p.balance += b.price;
      delete state.battles[b.id];
      sendStateTo(ws, c.playerId);
      broadcastBattles();
      saveData();
      return;
    }

    if (msg.type === 'battle_join') {
      const b = state.battles[msg.battleId];
      if (!b || b.status !== 'waiting') return send(ws, { type: 'error', msg: 'battle not available' });
      if (b.creatorId === c.playerId) return send(ws, { type: 'error', msg: 'cannot join own battle' });
      if (p.balance < b.price) return send(ws, { type: 'error', msg: 'no money' });
      
      p.balance -= b.price;
      b.joinerId = c.playerId;
      b.joinerNick = p.nick;
      b.status = 'playing';
      b.drops = { [b.creatorId]: null, [b.joinerId]: null };

      const participants = [b.creatorId, b.joinerId];
      participants.forEach(pid => {
        for (const [w, info] of clients) {
          if (info.playerId === pid) {
            send(w, { type: 'battle_start', battle: { id: b.id, caseIds: b.caseIds, cases: b.caseIds.map(id => CASES.find(c => c.id === id)), creatorId: b.creatorId, creatorNick: b.creatorNick, joinerId: b.joinerId, joinerNick: b.joinerNick, price: b.price } });
            sendStateTo(w, pid);
          }
        }
      });
      broadcastBattles();
      saveData();
      return;
    }

    if (msg.type === 'battle_roll') {
      const b = state.battles[msg.battleId];
      if (!b || b.status !== 'playing') return;
      if (b.creatorId !== c.playerId && b.joinerId !== c.playerId) return;
      if (b.drops[c.playerId]) return; // Уже крутил

      const drops = [];
      for (const caseId of b.caseIds) {
        const caseObj = CASES.find(x => x.id === caseId);
        const rarity = rollRarity(caseObj.weights);
        drops.push(makeItem(rarity));
      }
      b.drops[c.playerId] = drops;

      const participants = [b.creatorId, b.joinerId];
      participants.forEach(pid => {
        for (const [w, info] of clients) {
          if (info.playerId === pid) {
            send(w, { type: 'battle_progress', battleId: b.id, playerId: c.playerId, drops });
          }
        }
      });

      if (b.drops[b.creatorId] && b.drops[b.joinerId]) {
        finishBattle(b);
      }
      saveData();
      return;
    }
  });

  ws.on('close', () => { clients.delete(ws); });
});

function finishBattle(b) {
  const cSum = b.drops[b.creatorId].reduce((s, i) => s + i.price, 0);
  const jSum = b.drops[b.joinerId].reduce((s, i) => s + i.price, 0);
  const winnerId = cSum >= jSum ? b.creatorId : b.joinerId;

  const allItems = [...b.drops[b.creatorId], ...b.drops[b.joinerId]];
  const winner = getPlayer(winnerId);
  if (winner) allItems.forEach(it => winner.inventory.push({ ...it, uid: Date.now() + Math.random() }));

  b.status = 'finished';
  
  const participants = [b.creatorId, b.joinerId];
  participants.forEach(pid => {
    for (const [w, info] of clients) {
      if (info.playerId === pid) {
        send(w, {
          type: 'battle_finish', battleId: b.id, winnerId,
          cSum, jSum, creatorId: b.creatorId, joinerId: b.joinerId, drops: b.drops
        });
        sendStateTo(w, pid);
      }
    }
  });
  broadcastBattles();
  saveData();
}

setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

loadData();
server.listen(PORT, () => console.log('Zaharka Drop server on', PORT));
