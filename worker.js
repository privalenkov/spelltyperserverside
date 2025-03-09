/**
 * worker.js — код воркера:
 * 1) Поднимает Express + Socket.IO + Matter.js (физика).
 * 2) Работает с mockDatabase (words, combinations) и раздаёт статику из public/.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Matter = require('matter-js');
const process = require('process');

// === MOCK DATABASE ===
let mockDatabase = {
  leaderboard: [
    { id: 1, username: "player1", score: 5000, achieved_at: 1741449751564 },
    { id: 2, username: "player2", score: 4000, achieved_at: 1741449751564 },
    { id: 3, username: "player3", score: 3000, achieved_at: 1741449751564 },
    { id: 4, username: "player4", score: 2000, achieved_at: 1741449751564 },
    { id: 5, username: "player5", score: 1000, achieved_at: 1741449751564 }
  ],
  rarity_points: [
    { id: 1, name: "common", value: 10 },
    { id: 2, name: "epic", value: 50 },
    { id: 3, name: "legendary", value: 100 },
  ],
  words: [
    { id: 1, guid: '1111-1111', word: "apple", rarityId: 1, sprite: "images/apple.png", combinationGuids: ['2222-2222'] },
    { id: 2, guid: '2222-2222', word: "water", rarityId: 1, sprite: "images/water.png", combinationGuids: ['1111-1111'] },
    { id: 3, guid: '3333-3333', word: "fire", rarityId: 2, sprite: "images/fire.png", combinationGuids: ['10101010-10101010'] },
    { id: 10, guid: '10101010-10101010', word: null, rarityId: 2, sprite: "images/juice.png", combinationGuids: ['3333-3333'] },
    { id: 20, guid: '4444-4444', word: null, rarityId: 3, sprite: "images/flame.png", combinationGuids: [] }
  ],
  combinations: [
    { ingredient_guids: ['1111-1111', '2222-2222'], result_id: 10 },
    { ingredient_guids: ['10101010-10101010', '3333-3333'], result_id: 20 }
  ],
};

const app = express();
app.use(express.static('public')); // Раздаём index.html, client.js, images/*

const server = http.createServer(app);
const io = new Server(server);

// Запускаем сервер на порту 0 (виртуально), sticky sessions перенаправят
server.listen(0, () => {
  console.log(`[Worker ${process.pid}] listening on port=0`);
});

// Ловим события от master (sticky-session)
process.on('message', (msg, connection) => {
  if (msg === 'sticky-session:connection') {
    connection.resume();
    server.emit('connection', connection);
  }
});

// === Хранилище лобби ===
// lobbies[lobbyId] = {
//   engine, intervalId, players: Set(socketId),
//   nextBodyId, bodyMap, itemDataMap
// }
const lobbies = {};

function createLobby() {
  const lobbyId = Math.random().toString(36).slice(2, 7);

  // Matter.js
  const engine = Matter.Engine.create();
  engine.world.gravity.y = 1;

  // Пол
  const floor = Matter.Bodies.rectangle(400, 600, 800, 50, { isStatic: true });
  Matter.World.add(engine.world, [floor]);

  // ~30 FPS
  const tickMs = 1000 / 30;
  const intervalId = setInterval(() => {
    Matter.Engine.update(engine, tickMs);
    sendLobbyState(lobbyId);
  }, tickMs);

  lobbies[lobbyId] = {
    engine,
    intervalId,
    players: new Set(),
    nextBodyId: 1,
    bodyMap: new Map(),
    itemDataMap: new Map(), // для хранения guid, rarityName и т.д.
  };

  // Подписка на столкновения
  Matter.Events.on(engine, 'collisionStart', (evt) => {
    handleCollisions(lobbyId, evt);
  });

  return lobbyId;
}

// Отправляем текущее состояние (координаты) всем в лобби
function sendLobbyState(lobbyId) {
  const lobby = lobbies[lobbyId];
  if (!lobby) return;

  const objects = [];
  for (const [id, body] of lobby.bodyMap.entries()) {
    // достаём доп. инфу о спрайте из itemDataMap
    const data = lobby.itemDataMap.get(id); // guid, word, sprite, rarityName, ...

    objects.push({
      id,
      x: body.position.x,
      y: body.position.y,
      radius: body.circleRadius,
      label: body.label || '',
      sprite: data?.sprite,        // <-- Добавляем
      word: data?.word,           // <-- при желании
      rarityName: data?.rarityName // <-- при желании
    });
  }
  io.to(lobbyId).emit('stateUpdate', objects);
}

// Проверяем комбинации при столкновении
function handleCollisions(lobbyId, event) {
  const lobby = lobbies[lobbyId];
  if (!lobby) return;

  for (const pair of event.pairs) {
    const bodyA = pair.bodyA;
    const bodyB = pair.bodyB;
    const aId = getBodyId(lobby, bodyA);
    const bId = getBodyId(lobby, bodyB);
    if (!aId || !bId) continue;

    const itemA = lobby.itemDataMap.get(aId);
    const itemB = lobby.itemDataMap.get(bId);
    if (!itemA || !itemB) continue;

    // Проверяем guids
    const canCombineAB = itemA.combinationGuids?.includes(itemB.guid);
    const canCombineBA = itemB.combinationGuids?.includes(itemA.guid);

    if (canCombineAB || canCombineBA) {
      // Ищем в mockDatabase.combinations
      const combo = mockDatabase.combinations.find((c) => {
        return c.ingredient_guids.includes(itemA.guid)
            && c.ingredient_guids.includes(itemB.guid);
      });
      if (combo) {
        // Удаляем оба
        Matter.World.remove(lobby.engine.world, bodyA);
        Matter.World.remove(lobby.engine.world, bodyB);
        lobby.bodyMap.delete(aId);
        lobby.bodyMap.delete(bId);
        lobby.itemDataMap.delete(aId);
        lobby.itemDataMap.delete(bId);

        // Создаем результат
        const resultWord = mockDatabase.words.find(w => w.id === combo.result_id);
        if (resultWord) {
          const newBody = Matter.Bodies.circle(
            (bodyA.position.x + bodyB.position.x) / 2,
            (bodyA.position.y + bodyB.position.y) / 2,
            25,
            { label: 'combined' }
          );
          const newId = lobby.nextBodyId++;
          lobby.bodyMap.set(newId, newBody);
          Matter.World.add(lobby.engine.world, newBody);

          const rarity = mockDatabase.rarity_points.find(r => r.id === resultWord.rarityId);
          lobby.itemDataMap.set(newId, {
            guid: resultWord.guid,
            word: resultWord.word,
            rarityName: rarity?.name || 'unknown',
            sprite: resultWord.sprite,
            combinationGuids: resultWord.combinationGuids,
          });

          io.to(lobbyId).emit('itemCombined', {
            oldA: aId,
            oldB: bId,
            newId,
            newWord: resultWord.word,
            newRarity: rarity?.name,
            sprite: resultWord.sprite
          });
        }
      }
    }
  }
}

function getBodyId(lobby, body) {
  for (const [id, b] of lobby.bodyMap.entries()) {
    if (b === body) return id;
  }
  return null;
}

/** === События Socket.IO === */
io.on('connection', (socket) => {
  console.log(`[Worker ${process.pid}] Connection: ${socket.id}`);

  // Если нет ?lobby=..., создаём (isOwner=true)
  socket.on('autoCreateLobby', () => {
    const lobbyId = createLobby();
    lobbies[lobbyId].players.add(socket.id);
    socket.join(lobbyId);
    socket.emit('lobbyCreated', { lobbyId, isOwner: true });
  });

  // Если ?lobby=..., join
  socket.on('joinLobby', ({ lobbyId }) => {
    const lobby = lobbies[lobbyId];
    if (!lobby) {
      socket.emit('joinError', 'Лобби не существует');
      return;
    }
    if (lobby.players.size >= 2) {
      socket.emit('joinError', 'Лобби заполнено');
      return;
    }
    lobby.players.add(socket.id);
    socket.join(lobbyId);
    socket.emit('joinedLobby', { lobbyId, isOwner: false });
    io.to(lobbyId).emit('playerJoined', { playerId: socket.id });
  });

  // Игрок вводит слово -> spawnItem
  socket.on('spawnItemByWord', ({ lobbyId, typedWord }) => {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;

    const found = mockDatabase.words.find(w => w.word === typedWord);
    if (!found) {
      socket.emit('spawnError', { message: 'Слово не найдено' });
      return;
    }
    const rarity = mockDatabase.rarity_points.find(r => r.id === found.rarityId);

    // Создаем статический body (превью)
    const body = Matter.Bodies.circle(400, 100, 20, {
      label: found.word || 'unnamed'
    });
    Matter.Body.setStatic(body, true);
    const newId = lobby.nextBodyId++;
    lobby.bodyMap.set(newId, body);
    Matter.World.add(lobby.engine.world, body);

    lobby.itemDataMap.set(newId, {
      guid: found.guid,
      word: found.word,
      rarityName: rarity?.name || 'unknown',
      sprite: found.sprite,
      combinationGuids: found.combinationGuids
    });

    socket.emit('itemSpawned', {
      itemId: newId,
      word: found.word,
      rarityName: rarity?.name,
      sprite: found.sprite
    });
  });

  // Движение предмета по X
  socket.on('moveItem', ({ lobbyId, itemId, x }) => {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;
    const body = lobby.bodyMap.get(itemId);
    if (!body) return;
    Matter.Body.setPosition(body, { x, y: body.position.y });
  });

  // «Бросить» (static=false)
  socket.on('dropItem', ({ lobbyId, itemId }) => {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;
    const body = lobby.bodyMap.get(itemId);
    if (!body) return;
    Matter.Body.setStatic(body, false);
  });

  // Отключение
  socket.on('disconnect', () => {
    console.log(`[Worker ${process.pid}] Disconnected: ${socket.id}`);
    for (const [id, lobby] of Object.entries(lobbies)) {
      if (lobby.players.has(socket.id)) {
        lobby.players.delete(socket.id);
        if (lobby.players.size === 0) {
          clearInterval(lobby.intervalId);
          delete lobbies[id];
          console.log(`[Worker ${process.pid}] Removed lobby: ${id}`);
        }
      }
    }
  });
});