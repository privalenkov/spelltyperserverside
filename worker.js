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
    { id: 1, username: "player1", score: 50, achieved_at: 1741793762539 },
    { id: 2, username: "player2", score: 40, achieved_at: 1741793762539 },
    { id: 3, username: "player3", score: 30, achieved_at: 1741793762539 },
    { id: 4, username: "player4", score: 20, achieved_at: 1741793762539 },
    { id: 5, username: "player5", score: 10, achieved_at: 1741793762539 }
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

  // ~30 FPS
  const tickMs = 1000 / 30;
  const intervalId = setInterval(() => {
    Matter.Engine.update(engine, tickMs);
    checkOutOfBox(lobbyId);
    sendLobbyState(lobbyId);
  }, tickMs);

  lobbies[lobbyId] = {
    engine,
    intervalId,
    players: new Set(),
    nextBodyId: 1,
    bodyMap: new Map(),
    itemDataMap: new Map(), // для хранения guid, rarityName и т.д.
    simWidth: 800,
    simHeight: 600,
    boxSingleWalls: null,
    boxLeftWalls: null,
    boxRightWalls: null,
    owner: null,
    winnerId: null,
    finalScore: 0,
    gameOver: false,
  };

  // Подписка на столкновения
  Matter.Events.on(engine, 'collisionStart', (evt) => {
    handleCollisions(lobbyId, evt);
  });

  return lobbyId;
}

// Функция проверяет все предметы
function checkOutOfBox(lobbyId) {
  const lobby = lobbies[lobbyId];
  if (!lobby || lobby.gameOver) return; 

  if (lobby.players.size === 1 && lobby.boxSingleWalls) {
    checkOutOfBoxSingle(lobbyId);
  } else if (lobby.players.size === 2 && lobby.boxLeftWalls && lobby.boxRightWalls) {
    checkOutOfBoxDouble(lobbyId);
  }
}

function checkOutOfBoxSingle(lobbyId) {
  const lobby = lobbies[lobbyId];
  const [floor, leftWall, rightWall] = lobby.boxSingleWalls;
  // Высота стен = 100 => half=50
  const wallCenterY = leftWall.position.y;  // (или rightWall, они одинаковые)
  const topOfBox    = wallCenterY - 50;     // верх стен

  // Толщина стены=20 => halfWall=10
  const halfWallThick = 10;
  const leftX  = leftWall.position.x  + halfWallThick;
  const rightX = rightWall.position.x - halfWallThick;

  for (const [id, body] of lobby.bodyMap.entries()) {
    if (body===floor || body===leftWall || body===rightWall) continue;
    if (body.isStatic) continue; // Не брошен => не проверяем

    const minX = body.bounds.min.x;
    const maxX = body.bounds.max.x;
    const minY = body.bounds.min.y;

    // A) Предмет «ниже» верха коробки? => minY> topOfBox
    const belowTop = (minY > topOfBox);

    // B) Полностью вышел за левую: maxX < leftX
    //    или за правую: minX > rightX
    const outLeft  = (maxX < leftX);
    const outRight = (minX > rightX);

    if (belowTop && (outLeft || outRight)) {
      lobby.gameOver = true;
      const playerId = [...lobby.players][0];
      endGameSingle(lobbyId, playerId);
      return;
    }
  }
}

function checkOutOfBoxDouble(lobbyId) {
  const lobby = lobbies[lobbyId];
  // Извлекаем тела левой коробки
  const [lfloor, lwall1, lwall2] = lobby.boxLeftWalls;
  // Высота пола = 20 => верх = y - 10
  const leftFloorHeight = 20;
  const topOfLeftFloor  = lfloor.position.y - (leftFloorHeight/2);

  // Стенки левой коробки толщина=20 => half=10
  const halfWallThick = 10;
  const leftBoxLeftX  = lwall1.position.x + halfWallThick; // внутренняя граница
  const leftBoxRightX = lwall2.position.x - halfWallThick;

  // То же для правой
  const [rfloor, rwall1, rwall2] = lobby.boxRightWalls;
  const rightFloorHeight = 20;
  const topOfRightFloor  = rfloor.position.y - (rightFloorHeight/2);

  const rightBoxLeftX  = rwall1.position.x + halfWallThick;
  const rightBoxRightX = rwall2.position.x - halfWallThick;

  // Теперь обходим все тела
  for (const [id, body] of lobby.bodyMap.entries()) {
    // Пропускаем сами стены
    if (
      body === lfloor || body===lwall1 || body===lwall2 ||
      body === rfloor || body===rwall1 || body===rwall2
    ) continue;
    // Пропускаем статик (неброшенные)
    if (body.isStatic) continue;

    const minX = body.bounds.min.x;
    const maxX = body.bounds.max.x;
    const minY = body.bounds.min.y;

    // Определим, «левая» это коробка или «правая»
    // Простейший способ: если center.x < (lobby.simWidth/2) => предмет "левой" коробки,
    // иначе — правой.
    const centerX = (minX + maxX) / 2;
    const halfWidth = (lobby.simWidth / 2);

    if (centerX < halfWidth) {
      // ЛЕВАЯ коробка
      // А) Ниже верха левого пола?
      const belowLeftFloorTop = (minY > topOfLeftFloor);
      // Б) Полностью вышел за левую: (maxX < leftBoxLeftX) 
      //    или за правую: (minX > leftBoxRightX)
      const outLeft  = (maxX < leftBoxLeftX);
      const outRight = (minX > leftBoxRightX);

      if (belowLeftFloorTop && (outLeft || outRight)) {
        // Левый игрок (owner) проиграл
        lobby.gameOver = true;
        endGameMultiplayer(lobbyId, 'left');
        return;
      }

    } else {
      // ПРАВАЯ коробка
      const belowRightFloorTop = (minY > topOfRightFloor);
      const outLeft  = (maxX < rightBoxLeftX);
      const outRight = (minX > rightBoxRightX);

      if (belowRightFloorTop && (outLeft || outRight)) {
        // Правый игрок проиграл
        lobby.gameOver = true;
        endGameMultiplayer(lobbyId, 'right');
        return;
      }
    }
  }
}


function endGameSingle(lobbyId, playerId) {
  console.log(lobbyId, playerId)
  const lobby = lobbies[lobbyId];
  if (!lobby) return;
  
  // Допустим, выводим очки
  const finalScore = lobby.scores[playerId] || 0;

  lobby.winnerId = lobby.owner;
  lobby.finalScore = finalScore;
  
  io.to(lobbyId).emit('gameOver', {
    winnerId: lobby.owner,
    finalScore,
    message: `Игра окончена. Ваши очки: ${finalScore}`,
  });

  // Можем разорвать лобби/очистить
  // ...
}

function endGameMultiplayer(lobbyId, sideLost) {
  const lobby = lobbies[lobbyId];
  console.log(sideLost);
  if (!lobby) return;

  // Определяем: если sideLost==='left' => owner проиграл. Иначе выиграл.
  let winnerId;
  if (sideLost==='left') {
    winnerId= [...lobby.players].find(id=> id!==lobby.owner);
  } else {
    winnerId= lobby.owner;
  }

  const finalScore= lobby.scores[winnerId] || 0;

  lobby.winnerId = winnerId;
  lobby.finalScore = finalScore;

  io.to(lobbyId).emit('gameOver', {
    winnerId,
    finalScore,
    message: `Игрок ${winnerId} победил! (${finalScore} очков)`
  });

  // Скажем, дальше можно удалить лобби
  // ...
}


function placeBoxSingle(lobby) {
  const world = lobby.engine.world;

  // Удаляем, если были "двойные" ящики
  if (lobby.boxLeftWalls) {
    // значит у нас double-box
    for (const body of lobby.boxLeftWalls) {
      Matter.World.remove(world, body);
    }
    lobby.boxLeftWalls = null;
  }
  if (lobby.boxRightWalls) {
    for (const body of lobby.boxRightWalls) {
      Matter.World.remove(world, body);
    }
    lobby.boxRightWalls = null;
  }

  // Если ещё нет boxSingle
  if (!lobby.boxSingleWalls) {
    // Допустим ширина = 400, невысокие стенки (100px)
    // И floor стоит на Y = simHeight - 25
    const floorY = lobby.simHeight - 25;
    const centerX = lobby.simWidth / 2;
    const halfWidth = 400 / 2; // =200

    // Пол
    const floor = Matter.Bodies.rectangle(
      centerX,
      floorY,
      400, // width
      20,  // толщина
      { isStatic: true }
    );
    // Левая стенка
    const leftWall = Matter.Bodies.rectangle(
      centerX - halfWidth, // X = left edge
      floorY - 50,         // небольшая высота, половина 100
      20, // толщину стенки
      100, // высота
      { isStatic: true }
    );
    // Правая стенка
    const rightWall = Matter.Bodies.rectangle(
      centerX + halfWidth,
      floorY - 50,
      20,
      100,
      { isStatic: true }
    );

    Matter.World.add(world, [floor, leftWall, rightWall]);

    // Сохраняем их в массив, чтобы потом удобно удалять при reset
    lobby.boxSingleWalls = [floor, leftWall, rightWall];
  }
}

function placeBoxDouble(lobby) {
  const world = lobby.engine.world;

  // Удаляем single
  if (lobby.boxSingleWalls) {
    for (const body of lobby.boxSingleWalls) {
      Matter.World.remove(world, body);
    }
    lobby.boxSingleWalls = null;
  }

  // Если ещё нет leftWalls/rightWalls
  if (!lobby.boxLeftWalls && !lobby.boxRightWalls) {
    // Левая "коробка" (floor + 2 стенки)
    // Допустим ширина = 400, floorY = simHeight - 25
    const floorY = lobby.simHeight - 25;
    const leftCenterX = lobby.simWidth / 4;   // (width/4)
    const halfWidth = 200; // (400/2)

    const leftFloor = Matter.Bodies.rectangle(
      leftCenterX,
      floorY,
      400, 20,
      { isStatic: true }
    );
    const leftWall = Matter.Bodies.rectangle(
      leftCenterX - halfWidth,
      floorY - 50,
      20, 100,
      { isStatic: true }
    );
    const rightWall = Matter.Bodies.rectangle(
      leftCenterX + halfWidth,
      floorY - 50,
      20, 100,
      { isStatic: true }
    );
    const leftBox = [leftFloor, leftWall, rightWall];
    Matter.World.add(world, leftBox);

    // Правая "коробка"
    const rightCenterX = (3 * lobby.simWidth) / 4;
    const rightFloor = Matter.Bodies.rectangle(
      rightCenterX,
      floorY,
      400, 20,
      { isStatic: true }
    );
    const rightWallL = Matter.Bodies.rectangle(
      rightCenterX - halfWidth,
      floorY - 50,
      20, 100,
      { isStatic: true }
    );
    const rightWallR = Matter.Bodies.rectangle(
      rightCenterX + halfWidth,
      floorY - 50,
      20, 100,
      { isStatic: true }
    );
    const rightBox = [rightFloor, rightWallL, rightWallR];
    Matter.World.add(world, rightBox);

    lobby.boxLeftWalls = leftBox;
    lobby.boxRightWalls= rightBox;
  }
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
      rarityName: data?.rarityName, // <-- при желании
      angle: body.angle
    });
  }
  io.to(lobbyId).emit('stateUpdate', objects);
}

// Функция сброса игры: удаляем все тела кроме пола и оповещаем игроков
function resetGame(lobbyId) {
  const lobby = lobbies[lobbyId];
  if (!lobby) return;

  // Сбрасываем флаг gameOver, 
  // чтобы снова можно было проверять падения
  lobby.gameOver = false;

  // Удаляем все тела, кроме пола(ов) / стен(ок)
  const world = lobby.engine.world;
  const toRemove = [];

  // Допустим, если вы используете "boxSingleWalls" или "boxLeftWalls"/"boxRightWalls"
  // — в любом случае, не удаляйте их
  if (lobby.boxSingleWalls) {
    for (const [id, body] of lobby.bodyMap.entries()) {
      if (!lobby.boxSingleWalls.includes(body)) {
        toRemove.push(id);
      }
    }
  } else if (lobby.boxLeftWalls && lobby.boxRightWalls) {
    for (const [id, body] of lobby.bodyMap.entries()) {
      if (
        !lobby.boxLeftWalls.includes(body) &&
        !lobby.boxRightWalls.includes(body)
      ) {
        toRemove.push(id);
      }
    }
  }

  // Убираем тела из мира и чистим из bodyMap/itemDataMap
  for (const id of toRemove) {
    const body = lobby.bodyMap.get(id);
    Matter.World.remove(world, body);
    lobby.bodyMap.delete(id);
    lobby.itemDataMap.delete(id);
  }

  // (Опционально) сбрасываем счёт
  if (lobby.scores) {
    for (const pid of lobby.players) {
      lobby.scores[pid] = 0;
    }
  }

  // Отправляем новое состояние
  sendLobbyState(lobbyId);
  io.to(lobbyId).emit('gameRestarted', { message: 'Игра началась заново!' });
}


// Проверяем комбинации при столкновении
function handleCollisions(lobbyId, event) {
  const lobby = lobbies[lobbyId];
  if (!lobby || lobby.gameOver) return;

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

          // ========== Подсчёт очков ==========
          // Найдём rarity для itemA, itemB
          const rarityA = mockDatabase.rarity_points.find(r => r.id === itemA.rarityId);
          const rarityB = mockDatabase.rarity_points.find(r => r.id === itemB.rarityId);

          const pointsA = rarityA?.value || 0;
          const pointsB = rarityB?.value || 0;
          const totalPoints = pointsA + pointsB;

          // Определяем, кому засчитывать
          let scoringSocketId;
          if (lobby.players.size === 1) {
            // одиночная игра => единственному игроку
            // (у нас lobby.scores с одним ключом)
            scoringSocketId = [...lobby.players][0]; // берем единственного игрока
          } else if (lobby.players.size === 2) {
            // два игрока => смотрим, где центр столкновения
            // пусть centerX = (bodyA.x + bodyB.x)/2
            const centerX = (bodyA.position.x + bodyB.position.x)/2;
            if (centerX < (lobby.simWidth / 2)) {
              // левая половина => owner
              scoringSocketId = lobby.owner;
            } else {
              // правая половина => другой игрок
              scoringSocketId = [...lobby.players].find(id => id !== lobby.owner);
            }
          }

          // Прибавляем очки
          if (scoringSocketId && lobby.scores[scoringSocketId] != null) {
            lobby.scores[scoringSocketId] += totalPoints;
          }

          // Теперь сообщаем всем в лобби о новых очках
          // Чтобы каждый видел и свои, и чужие
          // Сделаем объект scoresForAll: { socketId1: number, socketId2: number }
          const scoresForAll = {};
          for (const pid of lobby.players) {
            scoresForAll[pid] = lobby.scores[pid] || 0;
          }

          io.to(lobbyId).emit('scoreUpdated', {
            scoringPlayer: scoringSocketId || null,
            pointsGained: totalPoints,
            scores: scoresForAll  // все очки
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updateLeaderboard(nickname, newScore) {
  // 1) Чистим старые записи
  cleanupLeaderboard();

  // 2) Ищем запись с таким ником
  let existing = mockDatabase.leaderboard.find(e => e.username === nickname);

  if (existing) {
    // Если новый score > имеющегося
    if (newScore > existing.score) {
      existing.score = newScore;
      existing.achieved_at = Date.now();
    } else {
      // Если рекорд не побит - ничего не делаем
      return;
    }
  } else {
    // Ник не найден
    // Если в таблице меньше 5
    if (mockDatabase.leaderboard.length < 5) {
      // Просто добавляем
      mockDatabase.leaderboard.push({
        id: Date.now(), // или любой id
        username: nickname,
        score: newScore,
        achieved_at: Date.now()
      });
    } else {
      // Уже 5 записей => проверим, не лучше ли newScore минимума
      mockDatabase.leaderboard.sort((a,b) => b.score - a.score); // по убыванию
      const last = mockDatabase.leaderboard[mockDatabase.leaderboard.length - 1];
      if (newScore > last.score) {
        // Удаляем последний
        mockDatabase.leaderboard.pop();
        // Добавляем нового
        mockDatabase.leaderboard.push({
          id: Date.now(),
          username: nickname,
          score: newScore,
          achieved_at: Date.now()
        });
      } else {
        // не вошли в топ-5
        return;
      }
    }
  }

  // 3) Снова сортируем
  mockDatabase.leaderboard.sort((a,b) => b.score - a.score);
  // 4) Оставляем только 5
  if (mockDatabase.leaderboard.length > 5) {
    mockDatabase.leaderboard.length = 5;
  }
}

function getTop5() {
  // scoreboard уже отсортирован (но на всякий случай можно пересортировать):
  mockDatabase.leaderboard.sort((a,b) => b.score - a.score);
  // создаём "плоский" массив
  return mockDatabase.leaderboard.map(e => ({
    id: e.id,
    username: e.username,
    score: e.score
  }));
}

function cleanupLeaderboard() {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  mockDatabase.leaderboard = mockDatabase.leaderboard.filter(e => 
    (e.achieved_at + weekMs) >= now
  );
}

function broadcastLeaderboardToSoloPlayers() {
  const top5 = getTop5();
  // Перебираем все лобби
  for (const [lobbyId, lobby] of Object.entries(lobbies)) {
    if (lobby.players.size === 1) {
      // Шлём именно в это лобби
      io.to(lobbyId).emit('leaderboardUpdated', { leaderboard: top5 });
    }
  }
}


/** === События Socket.IO === */
io.on('connection', (socket) => {
  console.log(`[Worker ${process.pid}] Connection: ${socket.id}`);

  // Если нет ?lobby=..., создаём (isOwner=true)
  socket.on('autoCreateLobby', () => {
    const lobbyId = createLobby();
    const lobby = lobbies[lobbyId];
    lobby.owner = socket.id;
    lobby.players.add(socket.id);
    lobby.scores = {};            // <-- инициализируем
    lobby.scores[socket.id] = 0;
    socket.join(lobbyId);
    socket.emit('lobbyCreated', { lobbyId, isOwner: true });

    // Ставим boxSingleWalls (один игрок пока)
    placeBoxSingle(lobby);

    // Отправляем сразу таблицу рекордов
    socket.emit('leaderboardUpdated', { leaderboard: getTop5() });

    resetGame(lobbyId);
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
    if (!lobby.scores) {
      lobby.scores = {};
      lobby.scores[lobby.owner] = 0;
    }
    lobby.scores[socket.id] = 0;

    socket.join(lobbyId);
    socket.emit('joinedLobby', { lobbyId, isOwner: false });
    io.to(lobbyId).emit('playerJoined', { playerId: socket.id });

    // Отправляем сразу таблицу рекордов
    socket.emit('leaderboardUpdated', { leaderboard: getTop5() });

    // Теперь у нас 2 игрока => два пола
    placeBoxDouble(lobby);

    resetGame(lobbyId);
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

    const isOwner = (socket.id === lobby.owner);

    // Вычисляем X в зависимости от числа игроков и кто мы
    let spawnX = lobby.simWidth / 2; // по умолчанию (один игрок)
    if (lobby.players.size === 2) {
      if (isOwner) {
        // владелец → левая половина
        spawnX = lobby.simWidth / 4;
      } else {
        // второй игрок → правая половина
        spawnX = (3 * lobby.simWidth) / 4;
      }
    }

    const spawnY = 100;

    // Создаем статический body (превью)
    const body = Matter.Bodies.circle(spawnX, spawnY, 20, {
      label: found.word || 'unnamed'
    });
    Matter.Body.setStatic(body, true);
    const newId = lobby.nextBodyId++;
    lobby.bodyMap.set(newId, body);
    Matter.World.add(lobby.engine.world, body);

    lobby.itemDataMap.set(newId, {
      guid: found.guid,
      word: found.word,
      rarityId: found.rarityId,
      rarityName: rarity?.name || 'unknown',
      sprite: found.sprite,
      combinationGuids: found.combinationGuids
    });

    socket.emit('itemSpawned', {
      itemId: newId,
      word: found.word,
      rarityName: rarity?.name,
      sprite: found.sprite,
      owner: isOwner,
      playerCount: lobby.players.size,
    });
  });

  // Движение предмета по X
  socket.on('moveItem', ({ lobbyId, itemId, x }) => {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;
    const body = lobby.bodyMap.get(itemId);
    if (!body) return;
    
    const isOwner = (socket.id === lobby.owner);
    const itemSide = (body.position.x < (lobby.simWidth / 2)) ? 'left' : 'right';
    // Сторона игрока, пытающегося двигать:
    const playerSide = isOwner ? 'left' : 'right';
  
    if (lobby.players.size === 2) {
      // Если 2 игрока, не разрешаем двигать, если стороны не совпадают
      if (itemSide !== playerSide) {
        // Игнорируем (не даём двигать)
        return;
      }
    }

    if (lobby.players.size === 1) {
      if (lobby.boxSingleWalls) {
        const [floor, leftW, rightW] = lobby.boxSingleWalls;
        const floorCenterX = floor.position.x;
        const floorWidth = 400; // ваш размер пола
        const halfWidth = floorWidth / 2;
        
        const leftBound = floorCenterX - halfWidth;
        const rightBound = floorCenterX + halfWidth;
  
        x = clamp(x, leftBound, rightBound);
      }
    
    } else if (lobby.players.size === 2) {
      // ДВА ПОЛА: lobby.floorLeft, lobby.floorRight
      // Нужно определить, какой из половин предмет движется:
      // Например, если «левый» игрок => floorLeft, если «правый» => floorRight
      // Или определяете side по x-текущему
      const isOwner = (socket.id === lobby.owner);
      if (isOwner) {
        // «Left floor»
        const [floor, leftW, rightW] = lobby.boxLeftWalls;
        const floorCenterX = floor.position.x;
        const floorWidth = 400;
        const halfWidth = floorWidth / 2;
  
        const leftBound = floorCenterX - halfWidth;
        const rightBound = floorCenterX + halfWidth;
        x = clamp(x, leftBound, rightBound);
  
      } else {
        // «Right floor»
        const [floor, leftW, rightW] = lobby.boxRightWalls;
        const floorCenterX = floor.position.x;
        const floorWidth = 400;
        const halfWidth = floorWidth / 2;
  
        const leftBound = floorCenterX - halfWidth;
        const rightBound = floorCenterX + halfWidth;
        x = clamp(x, leftBound, rightBound);
      }
    }

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

  // Новый обработчик: получение новых размеров симуляции
  socket.on('resize', ({ lobbyId, width, height }) => {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;
  
    lobby.simWidth = width;
    lobby.simHeight = height;
  
    // Смотрим, сколько игроков
    const playerCount = lobby.players.size;
  
    if (playerCount === 1) {
      // Один игрок
      placeBoxSingle(lobby);
      // Обновляем координаты boxSingleWalls
      if (lobby.boxSingleWalls) {
        const [floor, leftW, rightW] = lobby.boxSingleWalls;
        Matter.Body.setPosition(floor, { x: width/2, y: height - 25 });
        Matter.Body.setPosition(leftW, {  x: width/2 - 200, y: height - 25 - 50 });
        Matter.Body.setPosition(rightW, { x: width/2 + 200, y: height - 25 - 50 });
      }
    } else if (playerCount === 2) {
      // Два игрока => placeFloorDouble
      placeBoxDouble(lobby);
      // Обновляем координаты для leftFloor, rightFloor
      if (lobby.boxLeftWalls && lobby.boxRightWalls) {
        const floorY = height - 25;
        const leftCenterX  = width / 4;
        // leftBox = [floorL, wallL1, wallL2]
        const [lfloor, lwall1, lwall2] = lobby.boxLeftWalls;
        Matter.Body.setPosition(lfloor,  { x: leftCenterX, y: floorY });
        Matter.Body.setPosition(lwall1,  { x: leftCenterX - 200, y: floorY - 50 });
        Matter.Body.setPosition(lwall2,  { x: leftCenterX + 200, y: floorY - 50 });
        // right box
        const rightCenterX = (3*width)/4;
        const [rfloor, rwall1, rwall2] = lobby.boxRightWalls;
        Matter.Body.setPosition(rfloor,  { x: rightCenterX, y: floorY });
        Matter.Body.setPosition(rwall1,  { x: rightCenterX - 200, y: floorY - 50 });
        Matter.Body.setPosition(rwall2,  { x: rightCenterX + 200, y: floorY - 50 });
      }
    }
  });

  socket.on('submitNickname', ({ lobbyId, nickname }) => {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;
  
    // Очки игрока
    const score = (lobby.scores && lobby.scores[socket.id]) || 0;

    // Проверяем, режим одиночный или двое
    console.log(lobby.winnerId, socket.id, lobby.players.size);
    if (lobby.players.size === 2) {
      if (lobby.winnerId !== socket.id) return;
    }

    console.log(nickname, score);
  
    // Вызываем функцию, которая пытается вставить/обновить в leaderboard
    updateLeaderboard(nickname, score);
    
    // После обновления – рассылаем всем новый топ-5
    broadcastLeaderboardToSoloPlayers();
  });

  // Отключение
  socket.on('disconnect', () => {
    console.log(`[Worker ${process.pid}] Disconnected: ${socket.id}`);
    for (const [id, lobby] of Object.entries(lobbies)) {
      if (lobby.players.has(socket.id)) {
        resetGame(id);
        if (lobby.owner === socket.id) {
          io.to(id).emit('lobbyClosed', { message: 'Владелец покинул лобби. Лобби закрыто.' });
          clearInterval(lobby.intervalId);
          delete lobbies[id];
          console.log(`[Worker ${process.pid}] Removed lobby (owner left): ${id}`);
        } else {
          lobby.players.delete(socket.id);
          if (lobby.players.size === 1) {
            placeBoxSingle(lobby);
            resetGame(id);
          } else if (lobby.players.size === 0) {
            clearInterval(lobby.intervalId);
            delete lobbies[id];
            console.log(`[Worker ${process.pid}] Removed lobby: ${id}`);
          }
        }
      }
    }
  });
});