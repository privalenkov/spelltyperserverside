// Всё в async-коде, т.к. Pixi 8 позволяет await app.init()

// DOM элементы
const infoElem = document.getElementById('info');
const inviteBox = document.getElementById('inviteBox');
const wordInput = document.getElementById('wordInput');
const spawnBtn = document.getElementById('spawnBtn');

// Лобби
let currentLobbyId = null;
let isLobbyOwner = false;

// Подключение Socket.IO
const socket = window.io(); // глобальный io, т.к. < src="/socket.io/socket.io.js">

// Pixi (v8) — создаём, инициализируем
const app = new PIXI.Application();
// В newer Pixi 8, требуется await app.init(...):
await app.init({ width: window.innerWidth, height: window.innerHeight });
document.getElementById('pixi-container').appendChild(app.canvas);

// const initialWidth = window.innerWidth;
// const initialHeight = window.innerHeight;
// app.renderer.resize(initialWidth, initialHeight);
// Отправляем размеры на сервер (для позиционирования пола)
// socket.emit('resize', { lobbyId: currentLobbyId, width: initialWidth, height: initialHeight });

// Хранилище Pixi-спрайтов: itemId -> { sprite, spritePath, etc. }
const itemSprites = {};

// Механика "preview"
let currentPreviewItemId = null;
let mouseX = 400;
let localPreviewX = 400;
let mouseMoveActive = false;

// Обработчик кнопки "спавн"
spawnBtn.addEventListener('click', () => {
  if (!currentLobbyId) {
    alert('Вы не в лобби');
    return;
  }
  const typedWord = wordInput.value.trim();
  if (!typedWord) return alert('Введите слово!');
  socket.emit('spawnItemByWord', { lobbyId: currentLobbyId, typedWord });
});

// Pixi canvas: движение мыши
app.canvas.addEventListener('mousemove', (e) => { mouseX = e.offsetX; });

// Клик => drop
app.canvas.addEventListener('mousedown', () => {
  if (currentPreviewItemId) {
    socket.emit('dropItem', { lobbyId: currentLobbyId, itemId: currentPreviewItemId });
    stopMouseFollow();
  }
});

// Смотрим ?lobby=...
const urlParams = new URLSearchParams(window.location.search);
const paramLobbyId = urlParams.get('lobby');

if (paramLobbyId) {
  isLobbyOwner = false;
  socket.emit('joinLobby', { lobbyId: paramLobbyId });
  infoElem.textContent = `Подключаемся к лобби: ${paramLobbyId}...`;
} else {
  isLobbyOwner = true;
  socket.emit('autoCreateLobby');
  infoElem.textContent = 'Создаём новое лобби...';
}

// === Socket.IO ===

socket.on('lobbyCreated', ({ lobbyId, isOwner }) => {
  currentLobbyId = lobbyId;
  infoElem.textContent = `Лобби создано: ${lobbyId}`;
  if (isOwner) {
    const link = `${window.location.origin}?lobby=${lobbyId}`;
    inviteBox.innerHTML = `<p>Ссылка для друга: <a href="${link}">${link}</a></p>`;
  }

  mouseX = window.innerWidth / 2;
  localPreviewX = window.innerWidth / 2;

  setTimeout(() => {
    socket.emit('resize', { lobbyId, width: window.innerWidth, height: window.innerHeight });
  }, 100);
});

socket.on('joinedLobby', ({ lobbyId, isOwner }) => {
  currentLobbyId = lobbyId;
  infoElem.textContent = `Вы в лобби: ${lobbyId}`;
  if (isOwner) {
    const link = `${window.location.origin}?lobby=${lobbyId}`;
    inviteBox.innerHTML = `<p>Ссылка для приглашения: <a href="${link}">${link}</a></p>`;
    document.getElementById('gameUI').classList.add('leftSide');
    mouseX = window.innerWidth / 4;
    localPreviewX = window.innerWidth / 4;
  } else {
    inviteBox.innerHTML = '';
    document.getElementById('gameUI').classList.add('rightSide');
    mouseX = (3 * window.innerWidth) / 4;
    localPreviewX = (3 * window.innerWidth) / 4;
  }
});

socket.on('lobbyClosed', ({ message }) => {
  alert(message);
  window.location.href = '/';
});

socket.on('joinError', (msg) => { infoElem.textContent = `Ошибка: ${msg}`; });

socket.on('playerJoined', ({ playerId }) => { console.log('Другой игрок:', playerId); });

socket.on('spawnError', ({ message }) => { alert('spawnError: ' + message); });

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
  // Собираем ID, которые пришли в этом "кадре"
  const existingIds = new Set();
  
  for (const obj of objects) {
    existingIds.add(obj.id);

    // 1) Проверяем, нет ли уже записи в itemSprites
    if (!itemSprites[obj.id]) {
      // => создаём «placeholder»
      itemSprites[obj.id] = { loading: true, sprite: null, spritePath: obj.sprite };
      
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
      // Если уже есть запись, проверяем, есть ли sprite
      const record = itemSprites[obj.id];

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

  // Отрисуйте/обновите UI, например:
  // updateScoreUI(scores, scoringPlayer, pointsGained);
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