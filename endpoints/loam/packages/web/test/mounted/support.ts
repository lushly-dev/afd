/** What the mounted suites share. */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appPack } from '@lushly-dev/loam-cli';
import type { Page } from 'playwright';
import { kernelCall } from '../browser/harness';
import type { UmbelInstance } from './umbel-fixture';

const UMBEL_APP = fileURLToPath(new URL('./apps/umbel', import.meta.url));

/** `loam app pack` on the fixture's headless `umbel` manifest (7.2). */
export async function packUmbel(): Promise<string> {
	const out = join(await mkdtemp(join(tmpdir(), 'loam-pack-umbel-')), 'package');
	const result = await appPack({ dir: UMBEL_APP, out });
	if (!result.out) throw new Error(JSON.stringify(result.report.refusals));
	return out;
}

/** A deployment file's table for an instance served by `umbel`. */
export function instanceEntry(
	instance: string,
	app: string,
	packageDirectory: string,
	umbel: Pick<UmbelInstance, 'url' | 'tokenFile'>,
	extra: Record<string, string> = {}
): string {
	return [
		`[apps.${instance}]`,
		`app = ${JSON.stringify(app)}`,
		`package = ${JSON.stringify(packageDirectory)}`,
		'transport = "http"',
		`url = ${JSON.stringify(umbel.url)}`,
		`bearer_file = ${JSON.stringify(umbel.tokenFile)}`,
		...Object.entries(extra).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
	].join('\n');
}

interface InstanceRow {
	instance: string;
	state: string;
	error?: { code?: string };
}

/** `app-instance-list`'s row, once it has the state. Journaled, like any other read. */
export async function untilInstance(
	page: Page,
	instance: string,
	state: string,
	timeoutMs = 20_000
): Promise<InstanceRow> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const listed = (await kernelCall(page, 'app-instance-list')) as {
			data?: { instances: InstanceRow[] };
		};
		const row = listed.data?.instances.find((candidate) => candidate.instance === instance);
		if (row?.state === state) return row;
		if (Date.now() > deadline) {
			throw new Error(`${instance} stayed ${row?.state} (${row?.error?.code}), not ${state}`);
		}
		await page.waitForTimeout(100);
	}
}

/** Press Run on the console's selected command, and read what it shows. */
export async function runFromConsole(page: Page): Promise<{ result: string; labels: string[] }> {
	await page.locator('loam-console violet-button.run').click();
	await page.waitForFunction(() => {
		const status = document
			.querySelector('loam-shell')
			?.shadowRoot?.querySelector('loam-main loam-mount')
			?.shadowRoot?.querySelector('loam-console')
			?.shadowRoot?.querySelector('.result-status')?.textContent;
		return Boolean(status) && !status?.startsWith('Running');
	});
	return {
		result: (await page.locator('loam-console .output').textContent()) ?? '',
		labels: await page.locator('loam-console .labels li').allTextContents(),
	};
}
