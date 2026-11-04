/** `RailBands`' announcement of a change of scope (phase 2 specification, 7.8). */

import type { ScopeChangeV2 } from '@lushly-dev/loam-kernel';
import { describe, expect, it } from 'vitest';
import type { LoamShell } from '../elements/shell.js';
import { RailBands } from './rail-bands.js';

/** A shell with no parts to render into, whose reads answer `project`'s scope and a project-only app. */
function shellAt(project: { id: string; slug: string; name: string } | null) {
	const shell = {
		listsApps: true,
		appCount: 1,
		appList: [],
		announcement: '',
		workspaceName: '',
		projectName: '',
		shadowRoot: null,
		ownerDocument: { title: '', createElement: () => ({ remove() {} }) },
		kernel: {
			call: async () => ({
				success: true,
				data: {
					active: null,
					apps: [
						{
							instance: 'tracker',
							title: 'Tracker',
							order: 30,
							scopeLevels: ['project'],
							rail: true,
							state: 'ready',
							available: project !== null,
						},
					],
				},
			}),
		},
		readState: async () => ({
			scope: project ? { workspace: 'personal', project: project.id } : { workspace: 'personal' },
			workspace: { id: 'personal', name: 'Personal' },
			project,
			section: 'projects',
			path: '',
			active: null,
		}),
	};
	return shell;
}

const change = (extra: Partial<ScopeChangeV2>): ScopeChangeV2 => ({
	from: { workspace: 'personal', project: 'prj_atlas' },
	to: { workspace: 'personal' },
	reason: 'scope-set',
	...extra,
});

describe('RailBands: the live region (7.8)', () => {
	it('announces the place a change lands in, and the app it left', async () => {
		const shell = shellAt(null);
		const rail = new RailBands(shell as unknown as LoamShell);
		await rail.refresh(change({ left: 'tracker' }));
		expect(shell.announcement).toBe('No project. Tracker closed');
	});

	it('keeps the first app left when a second change comes before a read renders (L3)', async () => {
		const shell = shellAt(null);
		const rail = new RailBands(shell as unknown as LoamShell);
		// Both start before either read answers: only the later renders, and it owes the first's "closed".
		const first = rail.refresh(change({ left: 'tracker' }));
		const second = rail.refresh(change({ reason: 'actor' }));
		await Promise.all([first, second]);
		expect(shell.announcement).toBe('No project. Tracker closed');
		// Announced once: the next change says only where it went.
		await rail.refresh(change({}));
		expect(shell.announcement).toBe('No project');
	});
});
