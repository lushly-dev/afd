import { chromium } from 'playwright';
import { it } from 'vitest';
import { serveDist } from './harness';

it('shots', async () => {
	const site = await serveDist();
	const browser = await chromium.launch();
	const errors: string[] = [];
	for (const [name, width, height, scheme] of [
		['expanded-light', 1280, 800, 'light'],
		['expanded-dark', 1280, 800, 'dark'],
		['compact', 390, 844, 'light'],
	] as const) {
		const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
		const page = await context.newPage();
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
		await page.goto(site.origin);
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		if (name === 'expanded-light') {
			await page.keyboard.press('ControlOrMeta+J');
			await page.keyboard.press('ControlOrMeta+Alt+B');
			await page.waitForTimeout(300);
		}
		await page.screenshot({ path: `/tmp/loam-shots/${name}.png` });
		if (name === 'expanded-light') {
			await page.keyboard.press('ControlOrMeta+K');
			await page.waitForTimeout(500);
			await page.keyboard.type('lay');
			await page.waitForTimeout(300);
			await page.screenshot({ path: `/tmp/loam-shots/palette.png` });
		}
		if (name === 'compact') {
			await page.keyboard.press('ControlOrMeta+B');
			await page.waitForTimeout(400);
			await page.screenshot({ path: `/tmp/loam-shots/compact-drawer.png` });
		}
		await context.close();
	}
	await browser.close();
	await site.close();
	if (errors.length) throw new Error(errors.join('\n'));
});
