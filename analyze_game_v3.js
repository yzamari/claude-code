import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('Navigating to https://shakedzy.xyz/gpu-rush/...');
    await page.goto('https://shakedzy.xyz/gpu-rush/', { waitUntil: 'networkidle' });

    console.log('Performing deep search for game properties...');

    const mutationResult = await page.evaluate(() => {
      const mutated = [];
      const targetKeywords = ['score', 'gpu', 'level', 'count', 'points', 'money'];

      const traverse = (obj, path = 'window') => {
        try {
          if (obj === null || typeof obj !== 'object') return;

          for (const key in obj) {
            const currentPath = `${path}.${key}`;
            try {
              const val = obj[key];
              if (typeof val === 'number') {
                const lowerKey = key.toLowerCase();
                if (targetKeywords.some(k => lowerKey.includes(k))) {
                  obj[key] = 999999;
                  mutated.push(currentPath);
                }
              } else if (typeof val === 'object' && val !== null) {
                // Limit depth to prevent infinite loops or excessive recursion
                if (path.split('.').length < 5) {
                  traverse(val, currentPath);
                }
              }
            } catch (e) {}
          }
        } catch (e) {}
      };

      traverse(window);
      return mutated;
    });

    if (mutationResult.length > 0) {
      console.log('Successfully mutated: ' + mutationResult.join(', '));
    } else {
      console.log('Deep search found nothing. Trying one last broad search on top-level window properties again, but being more careful.');
      const lastDitch = await page.evaluate(() => {
        const found = [];
        for (const prop in window) {
          try {
            if (typeof window[prop] === 'number') {
              const lower = prop.toLowerCase();
              if (['score', 'gpu', 'level'].some(k => lower.includes(k))) {
                window[prop] = 999999;
                found.push(prop);
              }
            }
          } catch (e) {}
        }
        return found;
      });
      console.log('Last ditch mutation results: ' + lastDitch.join(', '));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
})();