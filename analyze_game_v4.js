import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('Navigating to https://shakedzy.xyz/gpu-rush/...');
    await page.goto('https://shakedzy.xyz/gpu-rush/', { waitUntil: 'networkidle' });

    console.log('Attempting targeted game state search...');

    const mutationResult = await page.evaluate(() => {
      const mutated = [];
      const keywords = ['score', 'gpu', 'level'];

      // 1. Direct check on window
      for (const key in window) {
        try {
          if (typeof window[key] === 'number') {
            if (keywords.some(k => key.toLowerCase().includes(k))) {
              window[key] = 999999;
              mutated.push(`window.${key}`);
            }
          }
        } catch (e) {}
      }

      // 2. Check common game state objects
      const gameObjects = ['game', 'state', 'gameState', 'app', 'store', 'data', 'engine', 'world'];
      gameObjects.forEach(objName => {
        try {
          const obj = window[objName];
          if (obj && typeof obj === 'object') {
            for (const key in obj) {
              if (typeof obj[key] === 'number') {
                if (keywords.some(k => key.toLowerCase().includes(k))) {
                  obj[key] = 999999;
                  mutated.push(`${objName}.${key}`);
                }
              }
            }
          }
        } catch (e) {}
      });

      // 3. If still nothing, look for ANY object that has one of our keywords in its keys
      // and then mutate that key if it's a number.
      if (mutated.length === 0) {
        for (const key in window) {
          try {
            if (window[key] && typeof window[key] === 'object') {
              const subObj = window[key];
              for (const subKey in subObj) {
                if (typeof subObj[subKey] === 'number') {
                  if (keywords.some(k => subKey.toLowerCase().includes(k))) {
                    subObj[subKey] = 999999;
                    mutated.push(`${key}.${subKey}`);
                  }
                }
              }
            }
          } catch (e) {}
        }
      }

      return mutated;
    });

    if (mutationResult.length > 0) {
      console.log('SUCCESS! Mutated properties: ' + mutationResult.join(', '));
    } else {
      console.log('Failed to find game properties via targeted search.');

      // Final attempt: Log all top-level property names to see if we can spot something
      const allKeys = await page.evaluate(() => Object.keys(window).filter(k => !k.startsWith('_')));
      console.log('Top-level window keys found (subset): ' + allKeys.slice(0, 100).join(', '));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
})();