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
    this._offsetScale = 1;

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

  _animateLetterFalling(oldLetters) {
    // this._isAnimated = true;
    if (!oldLetters) return;
    const letterObj = oldLetters[oldLetters.length - 1];
    const arcC = letterObj.arcContainer;

    this.rootContainer.addChild(arcC);
  
    // Случайное смещение по X при подлёте
    const dxUp = (Math.random() - 0.5) * 40;  // ±20
    // Насколько поднимется вверх
    const upDistance = 20 + Math.random() * 20; // 40..60
  
    // Случайное смещение при падении
    const dxDown = (Math.random() - 0.5) * 60; // ±30
    // Насколько упадёт вниз
    const downDistance = 120 + Math.random() * 50; // 120..170
  
    // Немного кручения для живости
    const rotAngle = Math.random() - 0.5; // ±90°
  
    const tl = gsap.timeline();
  
    // 1) Подлёт вверх и чуть в сторону
    tl.to(arcC, {
      duration: 0.1,
      x: arcC.x + dxUp,
      y: arcC.y - upDistance, // вверх => вычитаем
      rotation: rotAngle,
      ease: 'power1.out'
    });
  
    // 2) Падение вниз и чуть сильнее в сторону, с fade out
    tl.to(arcC, {
      duration: 0.2,
      x: `+=${dxDown}`,      //  добавляем ещё смещение
      y: `+=${downDistance}`, //  вниз => прибавляем
      alpha: 0,
      ease: 'power2.in'
    });
  }

  // Метод для смены value извне (например, если пришло с сервера)
  setValue(newVal) {
    if (newVal === this._value) return;

    const oldLetters = this.typedLetters.slice();  // копия массива
    const oldLen = this._value.length;
  
    // Ограничим по maxLetters
    if (newVal.length > this.maxLetters) {
      newVal = newVal.slice(0, this.maxLetters);
    }

    const count = newVal.length;
    const ratio = count / this.maxLetters; // 0..1

    const maxSize = 115;
    const minSize = 80;  // можно менять как хочется
    const newFontSize = maxSize - (maxSize - minSize) * ratio;
    this.letterStyle.fontSize = newFontSize;

    const maxSpacing = 45;
    const minSpacing = 35;
    this.letterSpacing = maxSpacing - (maxSpacing - minSpacing) * ratio;
    this._offsetScale = 1 - (0.5 * ratio); 

    this._value = newVal;
    // Перестраиваем буквы
    this._rebuildLetters();
    this._updateArcPositions();

    if (count > oldLen) {
      this._animateNewLetters();
    }

    if (count < oldLen) {
      this._animateLetterFalling(oldLetters);
    }

    // Вызываем onValue
    this.onValue(this._value);
  }

  setUserInput(enabled) {
    this.userInput = enabled;
  }

  _animateNewLetters() {
    // Перебираем индексы новых букв
    const letterObj = this.typedLetters[this.typedLetters.length - 1];
    if (!letterObj) return;
    const arcC = letterObj.arcContainer;
  
    // Анимируем «появление» (scale: 0 -> 1, alpha: 0 -> 1)
    const tl = gsap.timeline();
    tl.set(arcC, {
      rotation: -.1,
      y: -20,
      height: 50,
    });
    tl.to(arcC, {
      y: 0,
      rotation: 0,
      duration: .4,
      height: arcC.height,
      ease: 'back.out(3, .1)',
    });
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

      this.doFearTremble(letterObject);
    }
  }

  _animateRemovedLetters(removedArray) {
    removedArray.forEach((letterObj, i) => {
      const arcC = letterObj.arcContainer;
      if (!arcC) return;
  
      // Случайный угол и «дальность» падения
      // Пусть падают вниз с разбросом ±45° по X
      const angle = (Math.PI / 2) + (Math.random() - 0.5) * (Math.PI / 2);
      const distance = 60 + Math.random() * 50;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
  
      // Случайная длительность
      const duration = 0.4 + Math.random() * 0.3;
  
      gsap.killTweensOf(arcC);
  
      // "Падение" + исчезновение
      gsap.to(arcC, {
        duration,
        x: arcC.x + dx,
        y: arcC.y + dy,
        alpha: 0,
        rotation: Math.random() * 2 * Math.PI,
        ease: 'power2.in',
        onComplete: () => {
          // Убираем этот контейнер из Pixi
          this.rootContainer.removeChild(arcC);
        }
      });
    });
  }

  correctWord() {
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

  wrongWord() {
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
          this.correctWord();
        } else {
          this.wrongWord();
        }
      });
      return;
    }
    if (e.key === 'Backspace') {
      // if (this._isAnimated) return;
      // if (this._value.length>0) {
      //   this.value = this._value.slice(0, -1); 
      //   // setter value => rebuild => onValue
      // }
      if (this._value.length > 0) {
        this.value = this._value.slice(0, -1);
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
      const baseOffset = (this.charOffsets[ch] !== undefined) ? this.charOffsets[ch] : this.charOffsets.default;
      const w = baseOffset * (this._offsetScale || 1);
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
      const baseOffset = (this.charOffsets[ch] !== undefined)
      ? this.charOffsets[ch]
      : this.charOffsets.default;
      const scaledOffset = baseOffset * (this._offsetScale || 1);
      // Горизонтальное положение = currentX
      arcC.x = currentX;

      // следующее место
      currentX += scaledOffset + this.letterSpacing;

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
  
    // Определим «амплитуду» для этой буквы
    const count = this.typedLetters.length;
    const amplitude = this.baseAmplitude + this.amplitudeFactor * count;
  
    // Создаём один-единственный tween
    gsap.to(sprite, {
      duration: 0.12,
      // x, y – функция, которая возвращает случайное смещение
      x: () => (Math.random() - 0.5) * 2 * amplitude,
      y: () => (Math.random() - 0.5) * 2 * amplitude,
      repeat: -1,         // бесконечно
      yoyo: true,
      ease: 'sine.inOut',
      repeatRefresh: true // при каждом повторе заново вызываются функции x() и y()
    });
  }
  

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