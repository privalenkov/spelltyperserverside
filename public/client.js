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
await app.init({ width: 800, height: 600 });
document.body.appendChild(app.canvas);

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
    alert('Сначала войдите в лобби!');
    return;
}
const typedWord = wordInput.value.trim();
if (!typedWord) return alert('Введите слово!');
socket.emit('spawnItemByWord', { lobbyId: currentLobbyId, typedWord });
});

// Pixi canvas: движение мыши
app.canvas.addEventListener('mousemove', (e) => {
mouseX = e.offsetX; 
});

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
});

socket.on('joinedLobby', ({ lobbyId, isOwner }) => {
    currentLobbyId = lobbyId;
    infoElem.textContent = `Вы в лобби: ${lobbyId}`;
    if (isOwner) {
        const link = `${window.location.origin}?lobby=${lobbyId}`;
        inviteBox.innerHTML = `<p>Ссылка для друга: <a href="${link}">${link}</a></p>`;
    } else {
        inviteBox.innerHTML = '';
    }
});

socket.on('joinError', (msg) => {
infoElem.textContent = `Ошибка: ${msg}`;
});

socket.on('playerJoined', ({ playerId }) => {
console.log('Другой игрок:', playerId);
});

socket.on('spawnError', ({ message }) => {
alert('spawnError: ' + message);
});

socket.on('itemSpawned', async ({ itemId, word, rarityName, sprite }) => {
console.log('itemSpawned:', itemId, word, sprite);

console.log("itemSpawned: createsprite")
// Загрузка через Pixi.Assets.load(...)
// const texture = await PIXI.Assets.load(sprite);
// const pixiSprite = new PIXI.Sprite(texture);
// pixiSprite.anchor.set(0.5);

// pixiSprite.width = 70;
// pixiSprite.height = 70;

// app.stage.addChild(pixiSprite);

// itemSprites[itemId] = {
//     word, rarityName,
//     spritePath: sprite
// };

currentPreviewItemId = itemId;
localPreviewX = 400;
mouseX = 400;
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

    // Удалить старые
    // if (itemSprites[oldA]) {
    //     app.stage.removeChild(itemSprites[oldA].sprite);
    //     delete itemSprites[oldA];
    // }
    // if (itemSprites[oldB]) {
    //     app.stage.removeChild(itemSprites[oldB].sprite);
    //     delete itemSprites[oldB];
    // }

    // Загрузить новую текстуру
    // const texture = await PIXI.Assets.load(sprite);
    // const pixiSprite = new PIXI.Sprite(texture);
    // pixiSprite.anchor.set(0.5);

    // pixiSprite.width = 70;
    // pixiSprite.height = 70;


    // app.stage.addChild(pixiSprite);
    // itemSprites[newId] = {
    //     sprite: pixiSprite,
    //     word: newWord,
    //     rarityName: newRarity,
    //     spritePath: sprite
    // };
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