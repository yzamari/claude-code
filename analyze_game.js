import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('Navigating to https://shakedzy.xyz/gpu-rush/...');
    await page.goto('https://shakedzy.xyz/gpu-rush/', { waitUntil: 'networkidle' });

    console.log('Analyzing window object for numeric properties...');
    const propertiesToMutate = await page.evaluate(() => {
      const results = [];
      for (const prop in window) {
        try {
          if (typeof window[prop] === 'number') {
            // Check if the property name suggests it might be a game state variable
            const lowerProp = prop.toLowerCase();
            if (lowerProp.includes('score') || lowerProp.includes('gpu') || lowerProp.includes('level') || lowerProp.includes('count')) {
              results.push(prop);
            }
          }
        } catch (e) {
          // Some properties might throw errors when accessed
        }
      }
      return results;
    });

    if (propertiesToMutate.length === 0) {
      console.log('No suspicious numeric properties found. Trying a broader search...');
      // If nothing matched the keywords, let's just look for ALL numeric properties in window
      // This might be too many, so let's stick to the specific ones first or ask for more context.
      // For now, let's try to find any number that looks like a high score.
      const allNumbers = await page.evaluate(() => {
        const matches = [];
        for (const prop in window) {
           if (typeof window[prop] === 'number' && window[prop] > 0) {
             matches.push(prop);
           }
        }
        return matches;
      });

      if (allNumbers.length > 0) {
        console.log('Found potential candidates: ' + allNumbers.join(', '));
        // We'll proceed with these if they seem relevant
      }
    } else {
      console.log('Found properties to mutate: ' + propertiesToMutate.join(', '));
    }

    // Perform the mutation
    const mutationResult = await page.evaluate((props) => {
      const mutated = [];
      props.forEach(prop => {
        try {
          window[prop] = 999999;
          mutated.push(prop);
        } catch (e) {
          mutated.push(`${prop} (failed: ${e.message})`);
        }
      });
      return mutated;
    }, propertiesToMutate);

    console.log('Mutation results: ' + mutationResult.join(', '));

    // Wait a bit to see if anything changes (optional)
    await page.waitForTimeout(2000);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
})();