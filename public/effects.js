export class ArcWordInput {
  /**
   * @param {object} options
   *   app (PIXI.Application) – Pixi-приложение
   *   x, y (number)          – Координаты rootContainer
   *   minArcHeight, maxArcHeight (number) – настройки дуги
   *   letterSpacing (number) – расстояние между буквами
   *   maxLetters (number)    – макс. длина
   *   value (string)         – начальное значение
   *   onValue (function)     – вызывается при каждом обновлении value
   *   onComplete (function)  – когда «отправили» (Enter)
   *   userInput (boolean)    – слушаем ли keydown для ввода
   */
  constructor({
    app,
    x = 200,
    y = 300,
    minArcHeight = 10,
    maxArcHeight = 50,
    letterSpacing = 45,
    charOffsets = {
      A: 10, B: 10, C: 23, D: 10, E: 10, F: 10, G: 24, H: 10, I: -10, J: 0,
      K: 10, L: 10, M: 15, N: 15, O: 30, P: 0, Q: 24, R: 10, S: 10, T: 10,
      U: 25, V: 10, W: 30, X: 10, Y: 30, Z: 10,

      default: 20
    },
    maxLetters = 24,
    baseAmplitude = 2,    // минимальная дрожь
    amplitudeFactor = 0.1,
    letterStyle = new PIXI.TextStyle({
      fontFamily: 'Spelltyper',
      fontSize: 115,
      fill: 0xffffff,
    }),
    value = "",
    userInput = true,
    onValue = () => {},
    onComplete = () => {},
  }) {
    this.app = app;
    this.x = x;
    this.y = y;
    this.minArcHeight = minArcHeight;
    this.maxArcHeight = maxArcHeight;
    this.letterSpacing = letterSpacing;
    this.charOffsets = charOffsets;
    this.maxLetters = maxLetters;
    this.baseAmplitude = baseAmplitude;
    this.amplitudeFactor = amplitudeFactor;

    this.onValue = onValue;
    this.onComplete = onComplete;

    this.userInput = userInput;

    // Храним текущее строковое значение:
    this._value = value;
    this._isAnimated = false;

    // rootContainer – Pixi.Container, где располагаем буквы
    this.rootContainer = new PIXI.Container();
    this.rootContainer.x = this.x;
    this.rootContainer.y = this.y;
    this.app.stage.addChild(this.rootContainer);

    // typedLetters = [{ arcContainer, letterSprite, char }]
    this.typedLetters = [];

    this.letterStyle = letterStyle;

    this._handleKeyDown = this.handleKeyDown.bind(this);
    document.addEventListener('keydown', this._handleKeyDown);
  }

  // getter/setter value (как «псевдо-React controlled component»)
  get value() {
    return this._value;
  }
  set value(newVal) {
    // Можно звать setValue(newVal)
    this.setValue(newVal);
  }

  setCoords({ x, y }) {
    this.x = x || this.x;
    this.y = y || this.y;
    this.rootContainer.x = this.x;
    this.rootContainer.y = this.y;
  }

  // Метод для смены value извне (например, если пришло с сервера)
  setValue(newVal) {
    if (newVal === this._value) return;
    // Ограничим по maxLetters
    if (newVal.length > this.maxLetters) {
      newVal = newVal.slice(0, this.maxLetters);
    }
    this._value = newVal;
    // Перестраиваем буквы
    this._rebuildLetters();
    this._updateArcPositions();
    // Вызываем onValue
    this.onValue(this._value);
  }

  setUserInput(enabled) {
    this.userInput = enabled;
  }

  _rebuildLetters() {
    // Удаляем старые
    for (const obj of this.typedLetters) {
      this.rootContainer.removeChild(obj.arcContainer);
    }
    this.typedLetters = [];

    // Создаём по каждой букве
    for (const ch of this._value) {
      const arcContainer = new PIXI.Container();
      const letterSprite = new PIXI.Text({ text: ch, style: this.letterStyle });
      letterSprite.x = 0; 
      letterSprite.y = 0;
      arcContainer.addChild(letterSprite);

      this.rootContainer.addChild(arcContainer);

      const letterObject = {
        char: ch,
        arcContainer,
        letterSprite
      };

      this.typedLetters.push(letterObject);

      this.doFearTremble(letterObject)
    }
  }

  _correctWord() {
    this._isAnimated = true;
    const durationCollapse = 0.2;
  
    this.typedLetters.forEach((obj, i) => {
      const arcC = obj.arcContainer;
  
      gsap.to(arcC.scale, {
        duration: durationCollapse,
        x: 0,
        ease: 'back.in(1.5)',
        delay: i * 0.08
      });
  
      gsap.to(arcC, {
        duration: durationCollapse,
        alpha: 0,
        x: 0,
        ease: 'power1.out(1)',
        delay: i * 0.08,
        onComplete: () => {
          // Когда последняя буква исчезла
          if (i === this.typedLetters.length - 1) {
            this.clear();
            this._isAnimated = false;
          }
        }
      });
    });
  }

  _wrongWord() {
    this._isAnimated = true;
    const durationCollapse = 0.2;
  
    this.typedLetters.forEach((obj, i) => {
      const arcC = obj.arcContainer;
  
      gsap.to(arcC.scale, {
        duration: durationCollapse,
        y: 2,
        ease: 'back.in(2)',
        delay: i * 0.1
      });
  
      gsap.to(arcC, {
        duration: durationCollapse,
        alpha: 0,
        y: 0,
        ease: 'power1.out(1)',
        delay: i * 0.1,
        onComplete: () => {
          // Когда последняя буква исчезла
          if (i === this.typedLetters.length - 1) {
            this.clear();
            this._isAnimated = false;
          }
        }
      });
    });
  }

  handleKeyDown(e) {
    if (!this.userInput || this._isAnimated) return;

    if (e.key === 'Enter') {
      this.onComplete(this._value, (wordExists) => {
        console.log(wordExists);
        if (wordExists) {
          this._correctWord();
        } else {
          this._wrongWord();
        }
      });
      return;
    }
    if (e.key === 'Backspace') {
      if (this._value.length>0) {
        this.value = this._value.slice(0, -1); 
        // setter value => rebuild => onValue
      }
      return;
    }
    // Фильтр
    if (/^[A-Za-z]$/.test(e.key)) {
      if (this._value.length >= this.maxLetters) return;
      this.value = this._value + e.key;
      // setter => rebuild => onValue
    }
  }

  // === Очистить всё ===
  clear() {
    this.value = "";
  }


  computeTotalWidth() {
    let total = 0;
    const count = this.typedLetters.length;
    for (let i=0; i<count; i++) {
      const ch = this.typedLetters[i].char;
      const w = (this.charOffsets[ch] !== undefined)
                ? this.charOffsets[ch]
                : this.charOffsets.default;
      total += w;
    }
    if (count>0) {
      total += this.letterSpacing*(count-1);
    }
    return total;
  }

  // Раскладываем все буквы по дуге
  _updateArcPositions() {
    const count = this.typedLetters.length;
    if (count === 0) return;

    const ratio = Math.min(count / this.maxLetters, 1);
    const arcHeight = this.minArcHeight + (this.maxArcHeight - this.minArcHeight)*ratio;
    const totalW = this.computeTotalWidth();

    let currentX = - totalW / 2;
    const mid = (count -1)/2;

    
    for (let i=0; i<count; i++) {
      const obj = this.typedLetters[i];
      const arcC = obj.arcContainer;
      const ch = obj.char.toUpperCase();
      const w = (this.charOffsets[ch] !== undefined)
                ? this.charOffsets[ch]
                : this.charOffsets.default;

      // Горизонтальное положение = currentX
      arcC.x = currentX;

      // следующее место
      currentX += w + this.letterSpacing;

      // Вертикальная «арка» как прежде: dist = i-mid
      if (count===1) {
        arcC.y = -arcHeight/2;
      } else {
        const dist = i - mid;
        let a = 0;
        if (mid !==0) {
          a= arcHeight/(mid*mid);
        }
        arcC.y = a*(dist*dist) - arcHeight;
      }
    }
  }

  doFearTremble(letterObj) {
    const sprite = letterObj.letterSprite;

    // amplitude: baseAmplitude + amplitudeFactor*count
    const count = this.typedLetters.length;
    const amplitude = this.baseAmplitude + this.amplitudeFactor * count;

    // random dx,dy
    const dx = (Math.random()-0.5)*2*amplitude;
    const dy = (Math.random()-0.5)*2*amplitude;

    // random duration (быстрота)
    const duration = 0.1 + Math.random()*0.02; // 0.2..0.5

    gsap.killTweensOf(sprite); // убиваем на всякий случай
    gsap.to(sprite, {
      duration,
      x: dx,
      y: dy,
      ease: "sine.inOut",
      onComplete: () => {
        // Когда доходит, если буква всё ещё активна => следующий "прыжок"
        this.doFearTremble(letterObj); 
      }
    });
  }

  // _wrongWord() {
  //   const count = this.typedLetters.length;
  //   if (count===0) return;
  //   this._isAnimated = true;
    
  //   const duration = .15;    // время падения
  //   const delayBetween = 0.1; // задержка между буквами
  //   // Будем делать случайный dx (горизонтальный), и dy "побольше" вниз
  //   this.typedLetters.forEach((obj, i) => {
  //     const arcC = obj.arcContainer;
  //     gsap.killTweensOf(arcC);

  //     // Случайный отскок
  //     const dx = (Math.random()-0.5)*2 * 20;   // ±200 влево/вправо
  //     const dy = 30;       // 300..600 вниз

  //     gsap.to(arcC, {
  //       delay: i*delayBetween,
  //       duration,
  //       x: arcC.x + dx,
  //       y: arcC.y + dy,
  //       alpha: 0,
  //       onComplete: () => {
  //         // Когда последняя буква закончила:
  //         if (i===count-1) {
  //           this.clear();
  //           this._isAnimated = false;
  //         }
  //       }
  //     });
  //   });
  // }

  // Уничтожаем компонент
  destroy() {
    if (this._handleKeyDown) {
      document.removeEventListener('keydown', this._handleKeyDown);
    }
    for (const obj of this.typedLetters) {
      this.rootContainer.removeChild(obj.arcContainer);
    }
    this.typedLetters = [];
    this.app.stage.removeChild(this.rootContainer);
    this._value = "";
  }
}