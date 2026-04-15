import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('Navigating to https://shakedzy.xyz/gpu-rush/...');
    await page.goto('https://shakedzy.xyz/gpu-rush/', { waitUntil: 'networkidle' });

    console.log('Searching for numeric properties via a more aggressive approach...');

    const mutationResult = await page.evaluate(() => {
      const mutated = [];
      // We iterate over all properties in window
      const keys = Object.keys(window);

      for (const prop of keys) {
        try {
          if (typeof window[prop] === 'number') {
             const lowerProp = prop.toLowerCase();
             // Check if it's a likely game property
             if (lowerProp.includes('score') || lowerProp.includes('gpu') || lowerProp.includes('level') || lowerProp.includes('points') || lowerProp.includes('money') || lowerProp.includes('coins') || lowerProp.includes('count')) {
                window[prop] = 999999;
                mutated.push(prop);
             }
          }
        } catch (e) {}
      }
      return mutated;
    });

    if (mutationResult.length > 0) {
      console.log('Successfully mutated: ' + mutationResult.join(', '));
    } else {
      console.log('No specific game properties found by name. Trying broad numeric search...');
      const broadResults = await page.evaluate(() => {
        const found = [];
        for (const prop in window) {
          try {
            if (typeof window[prop] === 'number' && !['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio'].includes(prop)) {
              window[prop] = 999999;
              found.push(prop);
            }
          } catch (e) {}
        }
        return found;
      });
      console.log('Broad mutation results: ' + broadResults.join(', '));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
})();