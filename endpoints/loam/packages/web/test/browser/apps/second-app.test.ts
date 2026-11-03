/**
 * E5 (phase 1 specification, section 14): tally lands from a deployment entry alone. What is requested
 * before first paint is the same with and without it, but for `deployment.json`: from phase 2 no
 * manifest is read before the first frame (phase 2 specification, 2.2 and E1).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	focused,
	measureFirstPaint,
	openApp,
	openShell,
	packApp,
	serveDeployment,
	serveDist,
} from '../harness';

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
});

const PACKAGES = fileURLToPath(new URL('../../../../', import.meta.url));

function sources(directory: string): string[] {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		if (name === 'node_modules' || name === 'dist' || name === 'coverage') return [];
		return statSync(path).isDirectory() ? sources(path) : [path];
	});
}

describe('E5: a second app lands with no shell change', () => {
	it('names no second app in the kernel, the chrome or the host', () => {
		const offenders = [
			...sources(join(PACKAGES, 'kernel/src')),
			...sources(join(PACKAGES, 'chrome')),
			...sources(join(PACKAGES, 'web/src')),
		].filter((file) => /tally/i.test(readFileSync(file, 'utf8')));
		expect(offenders).toEqual([]);
	});

	it('appears, works and renders its panel and status item', async () => {
		const site = await serveDeployment({
			config: deploymentFile(deploymentEntry('tally', await packApp('tally'))),
		});
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'tally');
		await page.locator('tally-main violet-button.add').click();
		await expect.poll(() => page.locator('tally-main .total').textContent()).toBe('1');
		await expect
			.poll(() => page.locator('loam-statusbar [data-status-item="total"]').textContent())
			.toBe('1');
		expect(await page.locator('loam-panel loam-mount h3').textContent()).toBe('History');
		await page.locator('tally-history').waitFor();

		// The status item has a command, so it is a button that runs it, and it keeps focus.
		await page.locator('loam-status-action button').focus();
		await page.keyboard.press('Enter');
		await expect
			.poll(() => page.locator('loam-statusbar [data-status-item="total"]').textContent())
			.toBe('2');
		expect((await focused(page)).hosts).toContain('loam-status-action');
		await page.keyboard.press('Enter');
		await expect
			.poll(() => page.locator('loam-statusbar [data-status-item="total"]').textContent())
			.toBe('3');
		expect(opened.errors).toEqual([]);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
		await site.close();
	});

	it('requests the same bytes before first paint with and without it', async () => {
		const hello = await packApp('hello');
		const firstPaintBytes = async (site: DeploymentSite) => {
			const opened = await openShell(browser, site.origin);
			const paths = await measureFirstPaint(opened.page);
			expect(opened.errors).toEqual([]);
			await opened.context.close();
			return Object.fromEntries(
				site.log
					// The palette loads when the page is idle, which on a busy machine can fall before the first
					// contentful paint in either deployment, and no app decides it.
					.filter(({ path }) => !/^\/assets\/(?:palette|resize-handle)-/.test(path))
					.filter(({ path }) => paths.includes(path === '/' ? '/' : path))
					.map(({ path, bytes }) => [path, bytes])
			);
		};
		const without = await serveDeployment({
			config: deploymentFile(deploymentEntry('hello', hello)),
		});
		const withTally = await serveDeployment({
			config: deploymentFile(
				deploymentEntry('hello', hello),
				deploymentEntry('tally', await packApp('tally'))
			),
		});
		const a = await firstPaintBytes(without);
		const b = await firstPaintBytes(withTally);
		const { '/deployment.json': _a, ...restA } = a;
		const { '/deployment.json': _b, ...restB } = b;
		expect(_a).toBeGreaterThan(0);
		expect(_b).toBeGreaterThan(_a as number);
		// Phase 2's one first paint: no manifest is read before the frame (2.2, E1).
		expect(Object.keys(restB).some((path) => path.endsWith('app-manifest.json'))).toBe(false);
		expect(restB).toEqual(restA);
		expect(Object.keys(restA).some((path) => /dist\/native/.test(path))).toBe(false);
		await without.close();
		await withTally.close();
	});

	it('keeps the empty shell free of what apps load', async () => {
		const site = await serveDist();
		const opened = await openShell(browser, site.origin);
		const paths = await measureFirstPaint(opened.page);
		expect(
			paths.filter((path) => /surfaces-|\/apps-|validate\.generated-|deployment-|late-/.test(path))
		).toEqual([]);
		expect(
			site.log.filter(({ path }) => /surfaces-|\/apps-|validate\.generated-|deployment-/.test(path))
		).toEqual([]);
		await opened.context.close();
		await site.close();
	});
});
