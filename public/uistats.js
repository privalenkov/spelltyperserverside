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
    this.pointsQueue = []; // [{amount, domNode}, ...]
    this.previousSpawnCounters = 0;

    this._colors = ['#E6B925', '#654cff', '#8DC5F2'];

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
    this.spawnContainer.classList.toggle('hidden', spawnCounterIsHidden);
    this.root.insertBefore(this.spawnContainer, this.root.firstChild);

    this.spawnDots = Array.from({ length: 5 }, () => {
      const dot = document.createElement('div');
      dot.classList.add('spawn-counter-dots');
      dot.style.opacity = '0.5';
      dot.style.backgroundColor = 'white';
      this.spawnContainer.appendChild(dot);
      return dot;
    });

    // 2) score-container
    this.scoreContainer = document.createElement('div');
    this.scoreContainer.classList.add('score-container');
    this.root.appendChild(this.scoreContainer);


    // 2.3) Текст «Комбо»
    this.comboText = document.createElement('div');
    this.comboText.classList.add('combo-text');
    this.comboText.style.opacity = '0';
    this.comboText.style.position = 'relative';
    this.comboText.textContent = '';
    this.scoreContainer.appendChild(this.comboText);

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
    this._requestAnimationFrameId = null;
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
    this.spawnContainer.classList.toggle('hidden', val);
  }

  update({spawnCounters, score, combo}) {

    if (spawnCounters != undefined && !this.spawnCounterIsHidden) {
      console.log(spawnCounters, this.previousSpawnCounters)
      if (spawnCounters === 0 && this.previousSpawnCounters === 4) {
        this.triggerSpawnDotsResetAnimation();
      } else {
        this.spawnDots.forEach((dot, i) => {
          const isActive = i < spawnCounters;
          gsap.to(dot, {
            opacity: isActive ? 1 : 0.5,
            scale: isActive ? 1.3 : 1,
            backgroundColor: isActive ? '#E6B925' : 'white',
            duration: 0.5,
            ease: 'elastic.out(1, 0.4)'
          });
        });
      }



      this.previousSpawnCounters = spawnCounters;
    }

    if (score?.gained != undefined && score?.gained !== 0) {
      this.pushPoints(score.gained);
    }

    if (combo !== undefined) {
      this.comboText.textContent = `*${combo}`;
      gsap.fromTo(this.comboText, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.3 });
      gsap.fromTo(this.comboText, { scale: 1.5 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.3)' });

      this._spawnComboEffect();
    }
  }

  _spawnComboEffect() {
    const splash = document.createElement('div');
    splash.style.position = 'absolute';
    splash.style.left = `0px`;
    splash.style.top = `0px`;
    splash.style.width = `150px`; // подгони под размер изображения
    splash.style.height = `150px`;
    splash.style.left = '2px';
    splash.style.top = '-55px';
    splash.style.transform = 'rotate(30deg)';
    splash.style.backgroundImage = `url('images/combo_splash.png')`;
    splash.style.backgroundSize = 'contain';
    splash.style.backgroundRepeat = 'no-repeat';
    splash.style.pointerEvents = 'none';
    this.comboText.appendChild(splash);
  
    // Анимация появления и исчезновения
    const tl = gsap.timeline();
    tl.set(splash, {
      opacity: 0,
    });
    tl.to(splash, {
      opacity: 1,
      scale: 1.2,
      duration: .5,
    });
    tl.to(splash, {
      opacity: 0,
      duration: .5,
      ease: 'back.out(1)'
    });
  }

  triggerSpawnDotsResetAnimation() {
    const tl = gsap.timeline();
    tl.set(this.spawnDots, { backgroundColor: '#E6B925', scale: 1.3, opacity: 1 });
    tl.to(this.spawnDots, {
      scale: 2,
      duration: 0.5,
      ease: 'elastic.in(1, 0.5)',
      yoyo: true,
      repeat: 1,
      repeatDelay: 0,
    });
    this.spawnDots.slice().reverse().forEach((dot) => {
      tl.to(dot, {
        opacity: 0.5,
        scale: 1,
        backgroundColor: 'white',
        duration: 0.3,
        ease: 'elastic.in(1, 0.3)'
      }, `>-0.2`);
    });
  }

  handleComboApplied({ newScore, multiplier }) {
    const preComboScore = newScore / multiplier;
    this.pendingCombo = { 
      newScore, 
      multiplier, 
      preComboScore
    };
  }

  updatePointsQueueOpacity() {
    const totalPoints = this.pointsQueue.length;
    this.pointsQueue.forEach((point, index) => {
      const opacityValue = 1 - (index / totalPoints) * 0.7;
      gsap.to(point.domNode, { opacity: opacityValue, duration: 0.3 });
    });
  }

  repositionPointsQueue() {
    this.pointsQueue.forEach((item, index) => {
      gsap.to(item.domNode, { 
        top: `${index * 20}px`, // плавно смещаем по вертикали
        duration: 0.3, 
        ease: 'power1.out' 
      });
    });
  }

  _spawnParticles(x, y, amount = 2, color = '#fff') {
    const particleContainer = document.createElement('div');
    particleContainer.style.position = 'absolute';
    particleContainer.style.left = `${x}px`;
    particleContainer.style.top = `${y}px`;
    particleContainer.style.pointerEvents = 'none';
    this.root.appendChild(particleContainer);
  
    const offset = 20; // расстояние от центра для старта партиклов
  
    for (let side of [-1, 1]) { // -1 слева, 1 справа
      for (let i = 0; i < amount / 2; i++) {
        const particle = document.createElement('div');
        particle.style.position = 'absolute';
        particle.style.width = '10px';
        particle.style.height = '40px';
        particle.style.backgroundColor = color;
        particle.style.borderRadius = '100px';
        particleContainer.appendChild(particle);
  
        // Угол: ±45° от горизонтали
        const angle = side === -1
          ? Math.PI + (Math.random() - 0.5) * (Math.PI / 4)
          : (Math.random() - 0.5) * (Math.PI / 4);
  
        const distance = 50 + Math.random() * 60;
  
        const targetX = Math.cos(angle) * distance;
        const targetY = Math.sin(angle) * distance;
  
        const rotationAngle = angle * (180 / Math.PI) + 90;
        gsap.set(particle, { rotation: rotationAngle });
  
        gsap.fromTo(particle,
          { x: side * offset, y: 0, scale: 1, opacity: 1 },
          {
            x: targetX + side * offset,
            y: targetY,
            scale: 0.5,
            duration: 0.7,
            ease: 'expo.out',
            onStart: () => {
              gsap.to(particle, {opacity: 0, duration: 0.4, onComplete: () => particle.remove()});
            }
          }
        );
      }
    }
  
    setTimeout(() => particleContainer.remove(), 1500);
  }

  pushPoints(gained) {
    const randomColor = this._colors[Math.floor(Math.random() * this._colors.length)];
    const plusDiv = document.createElement('div');
    plusDiv.textContent = `+${gained}`;
    plusDiv.style.opacity = '0';
    plusDiv.style.color = randomColor;
    plusDiv.style.position = 'absolute';
    plusDiv.style.top = `${this.pointsQueue.length * 35}px`;
    this.scoreMultiplied.appendChild(plusDiv);
    this.pointsQueue.push({ gained, domNode: plusDiv });
    this.updatePointsQueueOpacity();

    gsap.to(plusDiv, { opacity: 1, x: +10, duration: 0.4, ease: 'back.out(1.7)' });
  }

  clear() {
    this.displayScore = 0;
    this.scoreText.textContent = '0';
    this.comboText.textContent = '';
    this.pointsQueue.forEach(({ domNode }) => domNode.remove());
    this.pointsQueue = [];
  }

  animateScoreIncrement(targetScore) {
    gsap.to(this, {
      displayScore: targetScore,  // плавно меняем значение displayScore до targetScore
      duration: 0.5,
      ease: 'power1.out',         // плавность
      roundProps: 'displayScore', // автоматически округляет число
      onUpdate: () => {
        this.scoreText.textContent = String(this.displayScore);
        gsap.fromTo(this.scoreText, { scale: 1.3 }, { scale: 1, duration: 0.3, ease: 'elastic.out(1, 0.3)' });
      },
      onStart: () => {
        gsap.fromTo(this.scoreText, { scale: 1.3 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.5)' });
      }
    });
  }

  processPointsQueue() {
    if (this.pendingCombo && this.displayScore === this.pendingCombo.preComboScore) {
      this.displayScore = this.pendingCombo.newScore;
      gsap.fromTo(this.scoreText, { scale: 1.5 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.3)' });
      this.scoreText.textContent = String(this.displayScore);
      this.pendingCombo = null;
      
      gsap.to(this.comboText, { opacity: 0, duration: 0.5, delay: 0.3 });

      const rect = this.scoreText.getBoundingClientRect();
      const rootRect = this.root.getBoundingClientRect();

      const x = rect.left - rootRect.left + rect.width / 2;
      const y = rect.top - rootRect.top + rect.height / 2 - 20;
      this._spawnParticles(x, y, 3, '#9BB7FF');
    }

    if (this.pointsQueue.length > 0) {
      // Берём и прибавляем очередной элемент
      const oldest = this.pointsQueue.shift();
      oldest.domNode && gsap.to(oldest.domNode, {
        opacity: 0, y: -20, duration: 0.3, onComplete: () => {
          oldest.domNode.remove();
          this.repositionPointsQueue();
        }
      });
      const targetScore = this.displayScore + oldest.gained;
      this.animateScoreIncrement(targetScore);
      this.updatePointsQueueOpacity();

      // 👇 запускаем партиклы при добавлении очков
      const rect = this.scoreText.getBoundingClientRect();
      const rootRect = this.root.getBoundingClientRect();

      const x = rect.left - rootRect.left + rect.width / 2;
      const y = rect.top - rootRect.top;
      this._spawnParticles(x, y);
    }
  }

  /**
   * Уничтожить UI
   */
  destroy() {
    cancelAnimationFrame(this._requestAnimationFrameId);
    clearInterval(this._timer);
    this.root.remove();
  }
}