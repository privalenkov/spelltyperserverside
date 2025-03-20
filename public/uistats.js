export class UIStats {
  /**
   * @param {object} options
   *   x, y (number): координаты размещения UI (px)
   *   parent (HTMLElement): куда вставлять (по умолчанию document.body)
   *   updateInterval (number): как часто (мс) обрабатывать очередь points (по умолчанию 1000)
   */
  constructor({
    x = 0,
    y = 0,
    parent = document.body,
    updateInterval = 1000,
    spawnCounterIsHidden = true
  } = {}) {
    this.spawnCounterIsHidden = spawnCounterIsHidden;
    this.x = x;
    this.y = y;
    this.parent = parent;

    // Внутреннее "отображаемое" значение счёта
    this.displayScore = 0;
    // Очередь прибавляемых очков (старые первыми)
    this.pointsQueue = []; // [{amount, domNode}, ...]

    // Создаём корневой DOM
    this.root = document.createElement('div');
    this.root.classList.add('ui-stats-container');
    this.root.style.position = 'absolute';
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
    parent.appendChild(this.root);

    // 1) spawn-counter-dots-container
    this.spawnContainer = document.createElement('div');
    this.spawnContainer.classList.add('spawn-counter-dots-container');
    if (this.spawnCounterIsHidden) {
      this.spawnContainer.classList.add('hidden')
    } else {
      this.spawnContainer.classList.remove('hidden')
    }
    this.root.insertBefore(this.spawnContainer, this.root.firstChild);

    this.spawnDots = [];
    for (let i = 0; i < 5; i++) {
      const dot = document.createElement('div');
      dot.classList.add('spawn-counter-dots'); 
      // CSS .spawn-counter-dots { width:10px; height:10px; background:gray; ... }
      // Если «активный», добавим класс spawn-active => background: yellow 
      this.spawnContainer.appendChild(dot);
      this.spawnDots.push(dot);
    }

    // 2) score-container
    this.scoreContainer = document.createElement('div');
    this.scoreContainer.classList.add('score-container');
    this.root.appendChild(this.scoreContainer);

    // 2.1) score-text
    this.scoreText = document.createElement('div');
    this.scoreText.classList.add('score-text');
    this.scoreText.textContent = '0'; // начально
    this.scoreContainer.appendChild(this.scoreText);

    // 2.2) score-multiplied (хранит "плюсы" – +5, +10)
    this.scoreMultiplied = document.createElement('div');
    this.scoreMultiplied.classList.add('score-multiplied');
    this.scoreContainer.appendChild(this.scoreMultiplied);

    // Запускаем таймер обработки очереди
    this._timer = setInterval(() => this.processPointsQueue(), updateInterval);
  }

  setCoords({x, y}) {
    this.x = x;
    this.y = y;
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
  }

  setSpawnCounterIsHidden (val) {
    this.spawnCounterIsHidden = val;
    if (val) this.spawnContainer.classList.add('hidden');
    else this.spawnContainer.classList.remove('hidden');
  }

  createSpawnCounter () {
    this.spawnContainer = document.createElement('div');
    this.spawnContainer.classList.add('spawn-counter-dots-container');
    this.root.insertBefore(this.spawnContainer, this.root.firstChild);

    this.spawnDots = [];
    for (let i = 0; i < 5; i++) {
      const dot = document.createElement('div');
      dot.classList.add('spawn-counter-dots'); 
      // CSS .spawn-counter-dots { width:10px; height:10px; background:gray; ... }
      // Если «активный», добавим класс spawn-active => background: yellow 
      this.spawnContainer.appendChild(dot);
      this.spawnDots.push(dot);
    }

    console.log(this.spawnContainer);
  }

  /**
   * Основной метод: userStats.update({ spawnCounters, score, pointsGained, ... })
   * Но здесь "pointsGained" не нужен напрямую – мы берём разницу (score - displayScore).
   * score уже "приплюсован" на сервере, а мы хотим постепенно добавить на экран.
   */
  update(value) {
    const {
      spawnCounters,  // число точек
      score,
      // comboCounters = 0, // (если нужно)
    } = value;

    if (spawnCounters != undefined && this.spawnCounterIsHidden) {
      let activeCount = Math.max(0, Math.min(5, spawnCounters));
  
      // 1) SpawnCounters => перерисовать точки
      for (let i = 0; i < 5; i++) {
        if (i < activeCount) {
          this.spawnDots[i].classList.add('spawn-active');
        } else {
          this.spawnDots[i].classList.remove('spawn-active');
        }
      }
    }

    if (score != undefined) {
      // 2) Score:
      // реальная "итоговая" score на сервере. Но у нас "displayScore" (старое).
      const difference = score - this.displayScore;
      console.log(difference, 'difference');
      if (difference > 0) {
        // Если реально повысился (server has new total),
        // "откатываем" UI: -> keep UI as old (do nothing with .scoreText),
        //  => добавим difference в queue
        this.pushPoints(difference);
      } else if (difference < 0) {
        // Теоретически, если score вдруг уменьшился? 
        // Логика: пусть UI сразу перепрыгнет (или игнорировать)
        // Для примера тут перепрыгнем:
        this.displayScore = score;
        this.scoreText.textContent = String(this.displayScore);
        // Очистим очередь, т.к. уже не актуально
        this.clearPointsQueue();
      }
      // если difference===0 => ничего не делаем
    }


  }

  /**
   * Добавляем разницу (новые очки) в очередь, делаем новый <div> +N.
   * При "сверху старые, снизу новые" — мы хотим,
   * чтобы свежий +N вставлялся в конец, тогда "старые" будут в начале.
   */
  pushPoints(amount) {
    // Создаём div
    const plusDiv = document.createElement('div');
    plusDiv.textContent = `+${amount}`;
    // Вставляем "самые старые - сверху" => appendChild => новые снизу
    this.scoreMultiplied.appendChild(plusDiv);

    // В массив
    this.pointsQueue.push({ amount, domNode: plusDiv });
  }

  /**
   * Каждую секунду (setInterval) берём самый старый (pointsQueue[0]),
   * добавляем к displayScore, удаляем из DOM, убираем из массива.
   * "Сверху старые" => значит shift().
   */
  processPointsQueue() {
    if (this.pointsQueue.length === 0) {
      return; // ничего нет
    }
    // Берём старейший
    const oldest = this.pointsQueue[0];
    // Прибавляем
    this.displayScore += oldest.amount;
    // Обновляем score-text
    this.scoreText.textContent = String(this.displayScore);

    // Удаляем domNode
    if (oldest.domNode.parentNode === this.scoreMultiplied) {
      this.scoreMultiplied.removeChild(oldest.domNode);
    }
    // Убираем из массива
    this.pointsQueue.shift();
  }

  /**
   * Очистить всю очередь
   */
  clearPointsQueue() {
    // Убираем все +N с экрана
    for (const item of this.pointsQueue) {
      if (item.domNode.parentNode === this.scoreMultiplied) {
        this.scoreMultiplied.removeChild(item.domNode);
      }
    }
    this.pointsQueue = [];
  }

  /**
   * Уничтожить UI
   */
  destroy() {
    // Останавливаем таймер
    clearInterval(this._timer);

    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
  }
}