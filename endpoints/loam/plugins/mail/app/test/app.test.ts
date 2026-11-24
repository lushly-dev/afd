/** The app's manifest: what it may call, and that `loam app check` takes it. */

import { fileURLToPath } from 'node:url';
import { appCheck, readAppManifest } from '@lushly-dev/loam-cli';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('mailapp', () => {
	it('passes app check', async () => {
		const report = await appCheck({ dir: ROOT });
		expect(report.refusals).toEqual([]);
	});

	it("calls only the slice's five commands of the mounted instance `mail`, and has none of its own", async () => {
		const manifest = await readAppManifest(ROOT);
		expect(manifest.plugin).toMatchObject({ id: 'mailapp', title: 'Mail', kind: 'native' });
		expect(manifest.grants?.map(({ name }) => name)).toEqual(['calls']);
		expect(manifest.calls).toEqual([
			{
				app: 'mail',
				commands: [
					'mail-thread-open',
					'mail-draft-create',
					'mail-draft-update',
					'mail-draft-show',
					'mail-draft-send',
				],
			},
		]);
		// No command of its own, so no agent reads mail through it unlabelled (the kernel's P5-A4).
		expect(manifest.commands ?? []).toEqual([]);
	});
});
