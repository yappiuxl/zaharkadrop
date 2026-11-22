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
const MAX_HISTORY = 12;
const GOLD_CHANCE = 0.4;
const GOLD_SIZE = 0.10;
const GOLD_MULT = 2.0;
const GOLD_MIN_RATIO = 0.8;
const CHANCE_MIN = 0.0001;
const CHANCE_MAX = 0.99;
const BATTLE_TIMEOUT = 8000;

// БАЗА ПРЕДМЕТОВ (БЕЗ РЕДКОСТЕЙ)
const ITEMS = [
  { icon: '??',  name: 'Зевок',                price: 1   },
  { icon: '♟️', name: 'Пешка',                 price: 5   },
  { icon: '❌',  name: 'Упущенная возможность', price: 10  },
  { icon: '♞', name: 'Конь',                  price: 15  },
  { icon: '♝', name: 'Слон',                  price: 15  },
  { icon: '♚', name: 'Король',                price: 20  },
  { icon: '♜', name: 'Ладья',                 price: 25  },
  { icon: '❤️', name: 'Сердце',                price: 30  },
  { icon: '🧸', name: 'Мишка',                 price: 30  },
  { icon: '♛', name: 'Ферзь',                 price: 45  },
  { icon: '?',   name: 'Ошибка',               price: 50  },
  { icon: '🎁', name: 'Подарок',               price: 50  },
  { icon: '🌹', name: 'Роза',                  price: 50  },
  { icon: '🎂', name: 'Торт',                  price: 100 },
  { icon: '💐', name: 'Букет',                 price: 100 },
  { icon: '🚀', name: 'Ракета',                price: 100 },
  { icon: '🍾', name: 'Шампанское',            price: 100 },
  { icon: '!?',  name: 'Неточность',           price: 100 },
  { icon: '🏆', name: 'Кубок',                 price: 200 },
  { icon: '💎', name: 'Алмаз',                 price: 200 },
  { icon: '💍', name: 'Кольцо',                price: 200 },
  { icon: '➡️', name: 'Вынужденный',           price: 500  },
  { icon: '🔥', name: 'Факел',                 price: 800 },
  { icon: '📖', name: 'Теоретический',         price: 1000 },
  { icon: '📅', name: 'Календарь',             price: 1000 },
  { icon: '👍', name: 'Хороший',               price: 2000 },
  { icon: '✔️', name: 'Отличный',              price: 3000 },
  { icon: '⭐️', name: 'Лучший',                price: 5000 },
  { icon: '!',  name: 'Замечательный',         price: 10000 },
  { icon: '!!', name: 'БРИЛЛИАНТ',             price: 25000 },
  { icon: '🐸', name: 'Пепе',                  price: 1000000 }
];

// КЕЙСЫ
const CASES = [
  { 
    id: 'free', 
    name: 'Бесплатный', 
    icon: '🎁', 
    price: 0, 
    desc: '99.9% на Ничего',
    isFree: true
  },
  { 
    id: 'hody', 
    name: 'Ходы', 
    icon: '♟️', 
    price: 4242, 
    desc: 'Шанс на БРИЛЛИАНТ',
    items: ITEMS.filter(i => ['Зевок', 'Упущенная возможность', 'Ошибка', 'Неточность', 'Хороший', 'Отличный', 'Лучший', 'Замечательный', 'БРИЛЛИАНТ'].includes(i.name))
  },
  { 
    id: 'figury', 
    name: 'Фигуры', 
    icon: '♞', 
    price: 20, 
    desc: 'Шахматные фигуры',
    items: ITEMS.filter(i => ['Пешка', 'Слон', 'Конь', 'Король', 'Ладья', 'Ферзь'].includes(i.name))
  },
  { 
    id: 'podarki', 
    name: 'Подарки', 
    icon: '🎁', 
    price: 100, 
    desc: 'Подарки и любовь',
    items: ITEMS.filter(i => ['Сердце', 'Мишка', 'Подарок', 'Роза', 'Торт', 'Букет', 'Ракета', 'Шампанское', 'Кубок', 'Алмаз', 'Кольцо'].includes(i.name))
  },
  { 
    id: 'nft', 
    name: 'Нфт', 
    icon: '🐸', 
    price: 300000, 
    desc: 'Шанс на Пепе',
    items: ITEMS.filter(i => ['Факел', 'Календарь', 'Пепе'].includes(i.name))
  },
  { 
    id: 'telegram', 
    name: 'Телеграм', 
    icon: '✈️', 
    price: 50000, 
    desc: 'Подарки и Нфт',
    items: ITEMS.filter(i => ['Сердце', 'Мишка', 'Подарок', 'Роза', 'Торт', 'Букет', 'Ракета', 'Шампанское', 'Кубок', 'Алмаз', 'Кольцо', 'Факел', 'Календарь', 'Пепе'].includes(i.name))
  },
  { 
    id: 'shahmaty', 
    name: 'Шахматы', 
    icon: '♟️', 
    price: 2500, 
    desc: 'Ходы и Фигуры',
    items: ITEMS.filter(i => ['Зевок', 'Упущенная возможность', 'Ошибка', 'Неточность', 'Хороший', 'Отличный', 'Лучший', 'Замечательный', 'БРИЛЛИАНТ', 'Пешка', 'Слон', 'Конь', 'Король', 'Ладья', 'Ферзь'].includes(i.name))
  },
  { 
    id: 'all', 
    name: 'ВСЁ', 
    icon: '🌌', 
    price: 33367, 
    desc: 'Все предметы',
    items: ITEMS
  }
];

const state = { players: {}, battles: {} };

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

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function rollCase(caseObj) {
  if (caseObj.isFree) {
    if (Math.random() < 0.001) { // 0.1% шанс
      const item = pick(ITEMS);
      return { ...item, uid: Date.now() + Math.random() };
    } else {
      return { icon: '🕳️', name: 'Ничего', price: 0, uid: Date.now() + Math.random() };
    }
  } else {
    const base = pick(caseObj.items);
    return { ...base, uid: Date.now() + Math.random() };
  }
}

function calcChance(source, target) {
  if (!source || !target) return null;
  const mult = target.price / source.price;
  let chance = (1 / mult);
  if (chance < CHANCE_MIN) return 0;
  return Math.min(CHANCE_MAX, chance);
}

function getGoldItem(target) {
  const wanted = target.price * GOLD_MULT;
  let best = null;
  let bestDiff = Infinity;
  ITEMS.forEach(it => {
    if (it.price < wanted) return;
    const diff = it.price - wanted;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = it;
    }
  });
  if (!best) best = ITEMS[ITEMS.length - 1];
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
        p = { nick, balance: START_BALANCE, inventory: [], history: [], freeLastOpened: 0, freeCountToday: 0 };
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

    // ===== ЗАДАНИЯ =====
    if (msg.type === 'claim_task') {
      const taskId = msg.taskId;
      let itemName, itemPrice, itemIcon;
      
      if (taskId === '10m') { itemName = 'Упущенная возможность'; itemPrice = 10; itemIcon = '❌'; }
      else if (taskId === '30m') { itemName = 'Неточность'; itemPrice = 100; itemIcon = '!?'; }
      else if (taskId === '60m') { itemName = 'Вынужденный'; itemPrice = 500; itemIcon = '➡️'; }
      else if (taskId === 'daily') { itemName = 'Зевок'; itemPrice = 1; itemIcon = '??'; }
      else return;

      if (!p.taskClaims) p.taskClaims = {};
      const now = Date.now();
      const cooldown = 86400000;
      
      if (p.taskClaims[taskId] && now - p.taskClaims[taskId] < cooldown) {
        return send(ws, { type: 'error', msg: 'Уже получено' });
      }
      
      p.taskClaims[taskId] = now;
      const newItem = { icon: itemIcon, name: itemName, price: itemPrice, uid: now + Math.random() };
      p.inventory.push(newItem);
      
      sendStateTo(ws, c.playerId);
      send(ws, { type: 'task_reward', item: newItem });
      saveData();
      return;
    }

    if (msg.type === 'open_case') {
      const caseIds = Array.isArray(msg.caseIds) ? msg.caseIds : [msg.caseId];
      
      // Проверка бесплатного кейса
      const freeCase = caseIds.find(id => id === 'free');
      if (freeCase) {
        const today = new Date().toDateString();
        if (p.freeDate !== today) {
          p.freeDate = today;
          p.freeCountToday = 0;
        }
        if (p.freeCountToday >= 5) {
          return send(ws, { type: 'error', msg: 'Лимит бесплатных кейсов: 5 в день' });
        }
        p.freeCountToday++;
      }

      const items = [];
      let totalCost = 0;
      
      for (const cid of caseIds) {
        const caseObj = CASES.find(x => x.id === cid);
        if (!caseObj) continue;
        if (p.balance < caseObj.price + totalCost) break;
        totalCost += caseObj.price;
      }
      if (totalCost > 0 && p.balance < totalCost) return send(ws, { type: 'error', msg: 'no money' });

      p.balance -= totalCost;
      for (const cid of caseIds.slice(0, 6)) {
        const caseObj = CASES.find(x => x.id === cid);
        if (!caseObj) continue;
        const item = rollCase(caseObj);
        p.inventory.push(item);
        items.push(item);
      }
      
      sendStateTo(ws, c.playerId);
      send(ws, { type: 'case_opened', items });
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
    if (msg.type === 'sell_many') {
      const uids = msg.uids || [];
      let sum = 0;
      uids.forEach(uid => {
        const idx = p.inventory.findIndex(i => i.uid === uid);
        if (idx !== -1) {
          sum += p.inventory[idx].price;
          p.inventory.splice(idx, 1);
        }
      });
      p.balance += sum;
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

    // БАТЛЫ (без изменений, просто чтобы не падало)
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

      setTimeout(() => {
        const curB = state.battles[b.id];
        if (!curB || curB.status !== 'playing') return;
        
        let changed = false;
        const participants2 = [curB.creatorId, curB.joinerId];
        participants2.forEach(pid => {
          if (!curB.drops[pid]) {
            const drops = [];
            for (const caseId of curB.caseIds) {
              const caseObj = CASES.find(x => x.id === caseId);
              drops.push(rollCase(caseObj));
            }
            curB.drops[pid] = drops;
            changed = true;
            
            participants2.forEach(p2 => {
              for (const [w, info] of clients) {
                if (info.playerId === p2) send(w, { type: 'battle_progress', battleId: curB.id, playerId: pid, drops });
              }
            });
          }
        });
        if (changed && curB.drops[curB.creatorId] && curB.drops[curB.joinerId]) {
          finishBattle(curB);
        }
      }, BATTLE_TIMEOUT);

      return;
    }

    if (msg.type === 'battle_roll') {
      const b = state.battles[msg.battleId];
      if (!b || b.status !== 'playing') return;
      if (b.creatorId !== c.playerId && b.joinerId !== c.playerId) return;
      if (b.drops[c.playerId]) return;

      const drops = [];
      for (const caseId of b.caseIds) {
        const caseObj = CASES.find(x => x.id === caseId);
        drops.push(rollCase(caseObj));
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
        send(w, { type: 'battle_finish', battleId: b.id, winnerId, cSum, jSum, creatorId: b.creatorId, joinerId: b.joinerId, drops: b.drops });
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
