/** The header's breadcrumbs (phase 2 specification, 7.4). */

import { describe, expect, it } from 'vitest';
import { crumbsOf } from './crumbs.js';

const base = 'https://loam.example/loam/';

describe('crumbsOf', () => {
	it('links each ancestor by the URL scheme, in a project, with the route as text', () => {
		expect(
			crumbsOf(
				{
					scope: { project: 'prj_atlas' },
					workspace: { id: 'personal', name: 'Personal' },
					project: { slug: 'atlas', name: 'Atlas' },
					section: null,
					path: 'items/a b',
					active: 'hello',
				},
				'hello',
				'Hello',
				base
			)
		).toEqual([
			{ label: 'Personal', href: `${base}personal` },
			{ label: 'Atlas', href: `${base}personal/p/atlas` },
			{ label: 'Hello', href: `${base}personal/p/atlas/hello` },
			{ label: 'items', href: `${base}personal/p/atlas/hello/items` },
			{ label: 'a b' },
		]);
	});

	it('names the app last at the workspace, and has nothing to say before a state', () => {
		expect(
			crumbsOf(
				{
					scope: {},
					workspace: { id: 'personal', name: 'Personal' },
					project: null,
					section: null,
					path: '',
					active: 'hello',
				},
				'hello',
				'Hello',
				base
			)
		).toEqual([{ label: 'Personal', href: `${base}personal` }, { label: 'Hello' }]);
		expect(crumbsOf(null, 'hello', 'Hello', base)).toEqual([]);
	});
});
