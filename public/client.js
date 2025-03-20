import { ArcWordInput } from './effects.js';
import { UIStats } from './uistats.js';
// Всё в async-коде, т.к. Pixi 8 позволяет await app.init()


let gameOverHappened = false;
// DOM элементы
const infoElem = document.getElementById('info');
const inviteBox = document.getElementById('inviteBox');
const spawnBtn = document.getElementById('spawnBtn');

// Лобби
let currentLobbyId = null;
let isLobbyOwner = false;
let joinedPlayerId = null;

let leaderboardData = [];
// Подключение Socket.IO
const socket = window.io(); // глобальный io, т.к. < src="/socket.io/socket.io.js">

// Pixi (v8) — создаём, инициализируем
const app = new PIXI.Application();
// В newer Pixi 8, требуется await app.init(...):
await app.init({ width: window.innerWidth, height: window.innerHeight });
await PIXI.Assets.load('fonts/Spelltyper.ttf');

let wordInputEnemy = null;
const wordInputPlayer = new ArcWordInput({
  app,
  x: 100,
  y: 100,
  onValue: (val) => {
    // console.log("Value changed:", val);
    if (!currentLobbyId) return;
    socket.emit('typingWord', {
      lobbyId: currentLobbyId,
      word: val,
    });
  },
  onComplete: (val) => {
    console.log("User pressed Enter with word:", val);
    // arcInput1.destroy();
    if (!currentLobbyId) {
      alert('Вы не в лобби');
      return;
    }
    const typedWord = val.trim();
    if (!typedWord) return alert('Введите слово!');
    socket.emit('spawnItemByWord', { lobbyId: currentLobbyId, typedWord });
    wordInputPlayer.setUserInput(false);
  }
});


let uiStatsEnemy = null;
const uiStatsPlayer = new UIStats({
  x: window.innerWidth / 2,
  y: 200,
})

// setInterval(() => {
//   arcInput1.value += "X"
// }, 1000);
document.getElementById('pixi-container').appendChild(app.canvas);

// const initialWidth = window.innerWidth;
// const initialHeight = window.innerHeight;
// app.renderer.resize(initialWidth, initialHeight);
// Отправляем размеры на сервер (для позиционирования пола)
// socket.emit('resize', { lobbyId: currentLobbyId, width: initialWidth, height: initialHeight });

// Хранилище Pixi-спрайтов: itemId -> { sprite, spritePath, etc. }
const itemSprites = {};

let combinationCounters = {};

// Механика "preview"
let currentPreviewItemId = null;
let mouseX = 400;
let localPreviewX = 400;
let mouseMoveActive = false;

// Чтобы вычислять dt
let lastUpdateTime = performance.now();

// Обработчик кнопки "спавн"
// spawnBtn.addEventListener('click', () => {
//   if (!currentLobbyId) {
//     alert('Вы не в лобби');
//     return;
//   }
//   const typedWord = wordInputPlayer.value.trim();
//   if (!typedWord) return alert('Введите слово!');
//   socket.emit('spawnItemByWord', { lobbyId: currentLobbyId, typedWord });
// });

// let typingTimeout;

socket.on('opponentTyping', ({ opponentId, word }) => {
  if (!wordInputEnemy) return;
  // clearTimeout(typingTimeout);
  wordInputEnemy.value = word

  // typingTimeout = setTimeout(() => {
  //   wordInputEnemy.value = ''
  // }, 1000);
}); 

// Pixi canvas: движение мыши
app.canvas.addEventListener('mousemove', (e) => { mouseX = e.offsetX; });

// Клик => drop
app.canvas.addEventListener('mousedown', () => {
  if (currentPreviewItemId) {
    socket.emit('dropItem', { lobbyId: currentLobbyId, itemId: currentPreviewItemId });
    wordInputPlayer.setUserInput(true);
    stopMouseFollow();
  }
});

// Смотрим ?r=...
const urlParams = new URLSearchParams(window.location.search);
const paramLobbyId = urlParams.get('r');

if (paramLobbyId) {
  console.log('test3');
  isLobbyOwner = false;
  socket.emit('joinLobby', { lobbyId: paramLobbyId });
  infoElem.textContent = `Connecting...: ${paramLobbyId}...`;
  wordInputPlayer.setCoords({ x: (3 * window.innerWidth) / 4 });
  uiStatsPlayer.setSpawnCounterIsHidden(false);
  uiStatsPlayer.setCoords({ x: (3 * window.innerWidth) / 4 });
} else {
  console.log('test2');
  isLobbyOwner = true;
  wordInputPlayer.setCoords({ x: window.innerWidth / 2 });
  uiStatsPlayer.setCoords({ x: window.innerWidth / 2 });
  socket.emit('autoCreateLobby');
  infoElem.textContent = 'Creating room...';
}

// === Socket.IO ===

socket.on('lobbyCreated', ({ lobbyId }) => {
  currentLobbyId = lobbyId;
  infoElem.textContent = `Room created`;
  const link = `${window.location.origin}?r=${lobbyId}`;
  inviteBox.innerHTML = `<p>Invite link: <a href="${link}">${link}</a></p>`;

  mouseX = window.innerWidth / 2;
  localPreviewX = window.innerWidth / 2;

  setTimeout(() => {
    socket.emit('resize', { lobbyId, width: window.innerWidth, height: window.innerHeight });
  }, 100);
});

socket.on('joinedLobby', ({ lobbyId }) => {
  console.log('joined');
  currentLobbyId = lobbyId;
  infoElem.textContent = `You are in room: ${lobbyId}`;
 
  inviteBox.innerHTML = '';
  document.getElementById('gameUI').classList.add('rightSide');
  mouseX = (3 * window.innerWidth) / 4;
  localPreviewX = (3 * window.innerWidth) / 4;
  wordInputPlayer.setCoords({ x: (3 * window.innerWidth) / 4 });
  createWordInputEnemy(true);
  createUIStatsEnemy(true);
});

socket.on('lobbyClosed', ({ message }) => {
  alert(message);
  window.location.href = '/';
});

socket.on('joinError', (msg) => { infoElem.textContent = `Ошибка: ${msg}`; });

socket.on('playerJoined', ({ playerId }) => {
  wordInputPlayer.value = '';
  wordInputPlayer.setCoords({ x: window.innerWidth / 4 });
  uiStatsPlayer.setSpawnCounterIsHidden(false);
  uiStatsPlayer.setCoords({
    x: window.innerWidth / 4,
  });
  console.log('Другой игрок:', playerId);
  joinedPlayerId = playerId;
  createWordInputEnemy(false);
  createUIStatsEnemy(false);
});

socket.on('playerLeaved', (msg) => {
  wordInputPlayer.setCoords({ x: window.innerWidth / 2 });
  uiStatsPlayer.setCoords({
    x: window.innerWidth / 2,
  });
  uiStatsPlayer.setSpawnCounterIsHidden(true);
  console.log('Игрок вышел:');
  joinedPlayerId = null;
  wordInputEnemy.destroy();
  uiStatsEnemy.destroy();
});

socket.on('spawnError', ({ message }) => {
  wordInputPlayer.setUserInput(true);
});

socket.on('itemSpawned', async ({ itemId, word, rarityName, sprite, owner, playerCount }) => {
  console.log('itemSpawned:', itemId, word, sprite);
  currentPreviewItemId = itemId;

  mouseX = window.innerWidth / 2;
  localPreviewX = window.innerWidth / 2; // по умолчанию (один игрок)
  if (playerCount === 2) {
    if (owner) {
      mouseX = window.innerWidth / 4;
      localPreviewX = window.innerWidth / 4;
    } else {
      mouseX = (3 * window.innerWidth) / 4;
      localPreviewX = (3 * window.innerWidth) / 4;
    }
  }
  startMouseFollow();
});

// Предположим, у нас есть:
//   const itemSprites = {}; // хранит информацию: { [id]: { loading, sprite, spritePath } }
//   const app = new PIXI.Application(); // Pixi-приложение
//   app.stage - наша контейнер-сцена

socket.on('stateUpdate', async (objects) => {
  if (gameOverHappened) {
    // Если игра окончена, мы игнорируем новые координаты (для slow motion)
    return;
  }

  const now = performance.now();
  const dtSec = (now - lastUpdateTime) / 1000;
  lastUpdateTime = now;

  // Собираем ID, которые пришли в этом "кадре"
  const existingIds = new Set();
  
  for (const obj of objects) {
    existingIds.add(obj.id);

    // 1) Проверяем, нет ли уже записи в itemSprites
    if (!itemSprites[obj.id]) {
      // => создаём «placeholder»
      itemSprites[obj.id] = { loading: true, sprite: null, spritePath: obj.sprite,
        lastX: obj.x,
        lastY: obj.y,
        velocityX: 0,
        velocityY: 0
       };
      
      // Запускаем асинхронную загрузку в IIFE
      (async () => {
        try {
          // 2) Ждём загрузки текстуры, если spritePath не пуст
          let texture = null;
          if (obj.sprite) {
            // Pixi 8 (с Assets.load):
            texture = await PIXI.Assets.load(obj.sprite);
          } else {
            // если sprite нет, можно сделать пустую текстуру
            texture = PIXI.Texture.EMPTY; 
          }
          // 3) Создаём Pixi.Sprite
          const sp = new PIXI.Sprite(texture);
          sp.anchor.set(0.5);
          sp.width = 70;
          sp.height = 70;

          // Сразу ставим координаты (на всякий случай)
          sp.x = obj.x;
          sp.y = obj.y;
          sp.rotation = obj.angle || 0;

          // Добавляем на сцену
          app.stage.addChild(sp);

          // 4) Записываем в itemSprites
          itemSprites[obj.id] = {
            loading: false,
            sprite: sp,
            spritePath: obj.sprite
          };
        } catch (err) {
          console.error('Error loading sprite for id=', obj.id, err);
        }
      })();
    } else {
      const record = itemSprites[obj.id];
      const dx = obj.x - record.lastX;
      const dy = obj.y - record.lastY;

      if (dtSec > 0) {
        record.velocityX = dx / dtSec;
        record.velocityY = dy / dtSec;
      }
      
      record.lastX = obj.x;
      record.lastY = obj.y;
      // Если уже есть запись, проверяем, есть ли sprite

      // 5) Если sprite уже создан, обновляем координаты
      if (!record.loading && record.sprite) {
        record.sprite.x = obj.x;
        record.sprite.y = obj.y;
        record.sprite.rotation = obj.angle || 0
      }
      // Если loading=true, значит мы ещё грузимся,
      // тогда пока ничего не делаем — спрайт появится, когда загрузка завершится
    }
  }
  
  // 6) Удаляем те, которых нет в objects
  for (const [idStr, record] of Object.entries(itemSprites)) {
    const idNum = parseInt(idStr, 10);
    if (!existingIds.has(idNum)) {
      // Удаляем с экрана
      if (record.sprite) {
        app.stage.removeChild(record.sprite);
      }
      delete itemSprites[idStr];
    }
  }
});

socket.on('itemCombined', async ({ oldA, oldB, newId, newWord, newRarity, sprite }) => {
    console.log('itemCombined:', oldA, oldB, '->', newId, newWord, sprite);
});

socket.on('scoreUpdated', ({ scoringPlayer, pointsGained, scores }) => {
  // "scores" содержит очки всех игроков
  // "scoringPlayer" — кто получил pointsGained
  console.log('scoreUpdated:', scoringPlayer, pointsGained, scores);
  uiStatsPlayer.update({
    score: scores[socket.id],
    pointsGained: pointsGained[socket.id],
  });
  console.log(scores);
  if (uiStatsEnemy) {
    const opponentId = Object.keys(scores).find(id => id !== socket.id);
    uiStatsEnemy.update({
      score: scores[opponentId],
      pointsGained: pointsGained[opponentId]
    })
  }
  // Отрисуйте/обновите UI, например:
  // updateScoreUI(scores, scoringPlayer, pointsGained);
});

socket.on('gameOver', (data) => {
  console.log(data);
  gameOverHappened = true;
  startLocalSlowMotion(() => {
    removeItemsOneByOne(() => {
      if (data?.winnerId === socket.id) {
        if (isTopFive(data.finalScore)) {
          const nickname = prompt('Поздравляю, вы установили новый рекорд! Введите ваш ник, чтобы сохранить его на доске почета');
          if (nickname && nickname.trim() !== '') {
            // Отправляем на сервер
            console.log('to server', nickname, currentLobbyId)
            socket.emit('submitNickname', { lobbyId: currentLobbyId, nickname });
            window.location.href = '/';
          }
        }
      };
      window.location.href = '/';
    });
  });
});

socket.on('spawnCounters', (counters) => {
  console.log('spawnCounters:', socket.id, counters);
  combinationCounters = counters;
  uiStatsPlayer.update({
    spawnCounters: counters[socket.id]
  });
  if (uiStatsEnemy) {
    const opponentId = Object.keys(counters).find(id => id !== socket.id);
    uiStatsEnemy.update({
      spawnCounters: counters[opponentId]
    })
  }
  // updateCombinationUI();
});

socket.on('comboCounters', (counters) => {
  const myCombo = counters[socket.id] || 0;
  const opponentId = Object.keys(counters).find(id => id !== socket.id);
  const opponentCombo = counters[opponentId] || 0;

  console.log(myCombo, opponentCombo);
});

socket.on('comboApplied', ({ socketId, multiplier, newScore }) => {
  if (socketId === socket.id) {
    console.log(`Ваше комбо ×${multiplier}! Новый счёт: ${newScore}`);
  } else {
    console.log(`Комбо противника ×${multiplier}! Его новый счёт: ${newScore}`);
  }
});

socket.on('gameRestarted', (data) => {
  gameOverHappened = false;
  console.log('gameRestarted');
  uiStatsPlayer.update({
    score: 0,
    spawnCounters: 0
  });
  if (uiStatsEnemy) {
    uiStatsEnemy.update({
      score: 0,
      spawnCounters: 0
    });
  }
});

socket.on('leaderboardUpdated', ({ leaderboard }) => {
  console.log('New Top 5:', leaderboard);
  leaderboardData = [...leaderboard]
  // Пример: обновить DOM-элемент 
  // updateLeaderboardUI(leaderboard);
});

// === Плавное движение (preview) ===
function startMouseFollow() {
  mouseMoveActive = true;
  requestAnimationFrame(animatePreview);
}

function stopMouseFollow() {
  mouseMoveActive = false;
  currentPreviewItemId = null;
}

function createWordInputEnemy(isOwner) {
  if (!wordInputEnemy) {
    wordInputEnemy = new ArcWordInput({
      app,
      x: isOwner ? window.innerWidth / 4 : (3 * window.innerWidth) / 4,
      y: 100,
      userInput: false,
    });
  }
}

function createUIStatsEnemy(isOwner) {
  if (!uiStatsEnemy) {
    uiStatsEnemy = new UIStats({
      x: isOwner ? window.innerWidth / 4 : (3 * window.innerWidth) / 4,
      y: 200,
      spawnCounterIsHidden: false
    });
  }
}

function startLocalSlowMotion(onDone) {
  const duration = 2000; // 2 секунды
  let startTime = 0;     // будет заполнен при первом кадре
  let animFrameId = null;

  const factorStart = 0.2;
  const factorEnd   = 0.0;
  const factorRange = factorStart - factorEnd; // 0.5

  function animateSlowMotion(timestamp) {
    if (startTime === 0) {
      // Начало анимации
      startTime = timestamp;
    }
    // Сколько прошло?
    const elapsed = timestamp - startTime;     // в миллисекундах
    const progress = Math.min(1, elapsed / duration);  // 0..1
    const factor = factorStart - factorRange * progress; 

    // Обходим все предметы и уменьшаем скорость
    for (const [id, record] of Object.entries(itemSprites)) {
      if (!record.sprite) continue;
      // Экспоненциальное затухание: velocity *= factor
      record.velocityX *= factor;
      record.velocityY *= factor;

      // Передвигаем предмет
      // Для dt – возьмём ~1/60 секунды (упрощённо),
      // или можно привязаться к (elapsedTime с прошлого кадра)
      const dt = 1/60;
      record.sprite.x += record.velocityX * dt;
      record.sprite.y += record.velocityY * dt;
    }

    if (progress < 1) {
      // Ещё не закончили → следующий кадр
      animFrameId = requestAnimationFrame(animateSlowMotion);
    } else {
      // Закончили анимацию
      if (onDone) onDone();
    }
  }

  // Запуск анимации
  animFrameId = requestAnimationFrame(animateSlowMotion);
}

function removeItemsOneByOne(onComplete) {
  // Получаем массив itemIds
  const itemIds = Object.keys(itemSprites);
  let index = 0;

  function removeNext() {
    if (index >= itemIds.length) {
      // Все удалены
      if (onComplete) onComplete();
      return;
    }
    const id = itemIds[index++];
    const record = itemSprites[id];
    // Удаляем спрайт из сцены
    if (record && record.sprite) {
      app.stage.removeChild(record.sprite);
    }
    // Удаляем саму запись
    delete itemSprites[id];

    // Подождём 300 мс и уберём следующий
    setTimeout(removeNext, 500);
  }
  
  // Стартуем первый
  removeNext();
}

function isTopFive(score) {
  if (leaderboardData.some((data) => data.score < score)) {
    return true;
  } else {
    return false;
  }
}


function animatePreview() {
  if (!mouseMoveActive) return;

  let lerpFactor = 0.1;
  localPreviewX += (mouseX - localPreviewX) * lerpFactor;

  if (currentPreviewItemId) {
    socket.emit('moveItem', {
      lobbyId: currentLobbyId,
      itemId: currentPreviewItemId,
      x: localPreviewX
    });
  }

  requestAnimationFrame(animatePreview);
}