/** `resourceLinkUrl` (documents specification, 9.1; phase 2 specification, 7.7): a link is navigation by the URL scheme. */

import { describe, expect, it } from 'vitest';
import { type ProjectLookup, resourceLinkUrl } from './resource-link.js';
import { parseRoute } from './router.js';

const BASE = 'https://loam.example/loam/';
const lookup: ProjectLookup = {
	workspace: 'personal',
	slugOf: (id) => (id === 'prj_atlas' ? 'atlas' : undefined),
};
const atlas = { workspace: 'personal', project: 'prj_atlas' };

describe('P2-E9: resourceLinkUrl', () => {
	it('formats an app link and a document link by the scheme, in the project by its slug', () => {
		expect(
			resourceLinkUrl(
				{ kind: 'app', instance: 'plans', route: 'board/one', scope: atlas },
				BASE,
				lookup
			)
		).toBe('https://loam.example/loam/personal/p/atlas/plans/board/one');
		expect(
			resourceLinkUrl(
				{ kind: 'app', instance: 'ledger', scope: { workspace: 'personal' } },
				BASE,
				lookup
			)
		).toBe('https://loam.example/loam/personal/ledger');
		expect(
			resourceLinkUrl({ kind: 'document', document: 'doc_1', scope: atlas }, BASE, lookup)
		).toBe('https://loam.example/loam/personal/p/atlas/~/documents/doc_1');
	});

	it('round-trips through parseRoute, each segment encoded once', () => {
		const url = resourceLinkUrl(
			{ kind: 'app', instance: 'plans', route: 'a b/<c>', scope: atlas },
			BASE,
			lookup
		) as string;
		expect(parseRoute(url, BASE)).toEqual({
			kind: 'app',
			workspace: 'personal',
			project: 'atlas',
			instance: 'plans',
			rest: ['a b', '<c>'],
		});
	});

	it('is undefined where the link cannot open in this page, so it renders as text', () => {
		// Another workspace, and a project the reader does not know, missing or refused alike.
		expect(
			resourceLinkUrl(
				{ kind: 'app', instance: 'plans', scope: { workspace: 'elsewhere' } },
				BASE,
				lookup
			)
		).toBeUndefined();
		expect(
			resourceLinkUrl(
				{ kind: 'app', instance: 'plans', scope: { workspace: 'personal', project: 'prj_hidden' } },
				BASE,
				lookup
			)
		).toBeUndefined();
		// An instance the URL cannot name, and segments that would walk out of the place they name.
		for (const instance of ['p', '~', 'Plans', '../x']) {
			expect(
				resourceLinkUrl({ kind: 'app', instance, scope: atlas }, BASE, lookup),
				instance
			).toBeUndefined();
		}
		for (const route of ['..', 'a/../b', 'a//b', '/a']) {
			expect(
				resourceLinkUrl({ kind: 'app', instance: 'plans', route, scope: atlas }, BASE, lookup),
				route
			).toBeUndefined();
		}
		expect(
			resourceLinkUrl({ kind: 'document', document: '..', scope: atlas }, BASE, lookup)
		).toBeUndefined();
		// A kind it does not know names no command: there is nothing to run.
		expect(
			resourceLinkUrl(
				{ kind: 'command', command: 'project-archive', scope: atlas } as never,
				BASE,
				lookup
			)
		).toBeUndefined();
	});
});
