export function createArcWordInput({
    app,
    startX = 200,
    startY = 300,
    minArcHeight = 10,  // минимальная высота дуги
    maxArcHeight = 50, // максимальная высота дуги
    letterSpacing = 35,
    maxLetters = 20,
    baseAmplitude = 2,    // минимальная дрожь
    amplitudeFactor = 0.1,
    onComplete = () => {}
  }) {
    // Контейнер для всех букв
    const rootContainer = new PIXI.Container();
    rootContainer.x = startX;
    rootContainer.y = startY;
    app.stage.addChild(rootContainer);
  
    let typedLetters = []; // [{ letter, arcContainer, letterSprite }]
    let currentWord = "";
  
    // Подписываемся на keydown для ввод/удаление
    document.addEventListener('keydown', handleKeyDown);
  
    function handleKeyDown(e) {
      if (e.key === "Enter") {
        onComplete(currentWord);
        return;
      }
      if (e.key === "Backspace") {
        if (typedLetters.length > 0) {
          const removed = typedLetters.pop();
          rootContainer.removeChild(removed.arcContainer);
          currentWord = currentWord.slice(0, -1);
          updateArcPositions();
        }
        return;
      }
  
      // Пропускаем только буквы/цифры (пример)
      if (/^[a-zA-Z0-9а-яА-ЯёЁ]$/.test(e.key)) {
        if (typedLetters.length >= maxLetters) return;
        addLetter(e.key);
      }
    }
  
    // Добавить новую букву
    function addLetter(letter) {
      currentWord += letter;
  
      // Создаём контейнер для арки
      const arcContainer = new PIXI.Container();
  
      // Создаём текст
      const letterSprite = new PIXI.Text(letter, {
        fontFamily: 'Arial',
        fontSize: 24,
        fill: 0xffffff
      });
  
      arcContainer.addChild(letterSprite);
      rootContainer.addChild(arcContainer);

      const letterObj = {
        letter,
        arcContainer,
        letterSprite,
        isActive: true
      };
  
      typedLetters.push(letterObj);
  
      doFearTremble(letterObj);
      updateArcPositions();
    }
  
    // Пересчитать позиции всех букв по «большей» арке
    function updateArcPositions() {
      const count = typedLetters.length;
      if (count === 0) return;
  
      // Вычисляем фактическую высоту дуги: 
      //   при 1 букве ~ minArcHeight, при maxLetters ~ maxArcHeight
      // Линейная интерполяция:
      const ratio = Math.min(count / maxLetters, 1.0); 
      // например, если count=10, maxLetters=20 => ratio=0.5
      // => arcHeight= minArc + 0.5*(maxArc - minArc)
      const arcHeight = minArcHeight + (maxArcHeight - minArcHeight) * ratio;
  
      // Края => y=0, центр => y=-arcHeight
      // formula: y = a*(dist^2) - arcHeight
      // где dist = i-mid, mid=(count-1)/2
      const mid = (count - 1) / 2;
  
      typedLetters.forEach((obj, i) => {
        const arcC = obj.arcContainer;
        gsap.killTweensOf(arcC);
  
        const xTarget = (i - mid) * letterSpacing;
  
        // Если всего 1 буква, пусть будет слегка приподнята
        if (count === 1) {
          gsap.to(arcC, { duration: 0.3, x: xTarget, y: -arcHeight/2 });
          return;
        }
  
        const dist = i - mid;
        // a*(mid^2) - arcHeight = 0 => a=arcHeight/(mid^2)
        // y= a*(dist^2) - arcHeight
        let a = 0;
        if (mid !== 0) {
          a = arcHeight / (mid*mid);
        } else {
          // count=1 => mid=0, но мы уже обработали
          a = 0; 
        }
        const yTarget = a*(dist*dist) - arcHeight;
  
        gsap.to(arcC, {
          duration: 0.3,
          x: xTarget,
          y: yTarget
        });
      });
    }
  
    // "Shake": чем больше букв, тем сильнее
    function doFearTremble(letterObj) {
        if (!letterObj.isActive) return;
    
        const sprite = letterObj.letterSprite;
    
        // amplitude: baseAmplitude + amplitudeFactor*count
        const count = typedLetters.length;
        const amplitude = baseAmplitude + amplitudeFactor * count;
    
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
            if (letterObj.isActive) {
              doFearTremble(letterObj); 
            }
          }
        });
      }
  
    // Уничтожить компонент
    function destroy() {
      document.removeEventListener('keydown', handleKeyDown);
      app.stage.removeChild(rootContainer);
    }
  
    function getWord() {
      return currentWord;
    }
  
    return {
      container: rootContainer,
      destroy,
      getWord
    };
  }
  