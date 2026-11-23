import { describe, expect, it } from 'vitest';
import {
	type ClimbNode,
	climbObservation,
	climbSelection,
	isMeaningfulNode,
	observationClimbTree,
} from './climb.js';
import {
	DEFAULT_PIN,
	formatPointer,
	isValidElementRef,
	MAX_POINTER_TEXT_LENGTH,
	POINTER_INVALID,
	PointerError,
	parsePointer,
} from './pointer.js';
import type { ElementObservation } from './types.js';

function expectPointerInvalid(fn: () => unknown): PointerError {
	let caught: unknown;
	try {
		fn();
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(PointerError);
	const pointerError = caught as PointerError;
	expect(pointerError.code).toBe(POINTER_INVALID);
	expect(pointerError.suggestion).toContain('Copy the pointer again from the review page');
	return pointerError;
}

function makeObservation(
	ref: string,
	tag: string,
	options: {
		attributes?: Record<string, string>;
		accessibility?: { role: string; name: string };
	} = {}
): ElementObservation {
	return {
		ref,
		tag,
		attributes: options.attributes ?? {},
		box: { x: 0, y: 0, width: 100, height: 32 },
		scroll: { width: 100, height: 32, clientWidth: 100, clientHeight: 32 },
		styles: {},
		state: { focused: false },
		...(options.accessibility ? { accessibility: options.accessibility } : {}),
	};
}

describe('pointer URI parser and formatter (§4.2)', () => {
	it('parses a full pointer with context, ref, text, depth and pin', () => {
		const uri =
			'specimen:example-toolbar?theme=dark&viewport=1280x800&checkpoint=after-run#ref=root/example-toolbar:1/shadow/example-button:1&text=Share%20item&depth=deepest&pin=0.42,0.58';
		const parsed = parsePointer(uri);
		expect(parsed).toEqual({
			specimen: 'example-toolbar',
			context: { theme: 'dark', viewport: '1280x800' },
			checkpoint: 'after-run',
			ref: 'root/example-toolbar:1/shadow/example-button:1',
			text: 'Share item',
			depth: 'deepest',
			pin: { x: 0.42, y: 0.58 },
		});
	});

	it('defaults pin to { x: 0.5, y: 0.5 } and allows omitted query parameters', () => {
		const parsed = parsePointer('specimen:example-toolbar#ref=root/example-toolbar:1');
		expect(parsed).toEqual({
			specimen: 'example-toolbar',
			context: {},
			ref: 'root/example-toolbar:1',
			pin: DEFAULT_PIN,
		});
		expect(parsed.pin).not.toBe(DEFAULT_PIN);
	});

	it('accepts boundary pin coordinates 0,0 and 1,1', () => {
		expect(parsePointer('specimen:btn#ref=root/button:1&pin=0,0').pin).toEqual({ x: 0, y: 0 });
		expect(parsePointer('specimen:btn#ref=root/button:1&pin=1,1').pin).toEqual({ x: 1, y: 1 });
		expect(parsePointer('specimen:btn#ref=root/button:1&pin=.25,.75').pin).toEqual({
			x: 0.25,
			y: 0.75,
		});
	});

	it('caps decoded text hints at 200 characters without splitting surrogate pairs', () => {
		const longText = `${'a'.repeat(199)}🎯extra`;
		const uri = `specimen:btn#ref=root/button:1&text=${encodeURIComponent(longText)}`;
		const parsed = parsePointer(uri);
		expect(Array.from(parsed.text ?? '')).toHaveLength(MAX_POINTER_TEXT_LENGTH);
		expect(parsed.text).toBe(`${'a'.repeat(199)}🎯`);
	});

	it('formats and round-trips pointers losslessly', () => {
		const formatted = formatPointer({
			specimen: 'example-toolbar',
			context: { theme: 'dark', viewport: '1280x800' },
			checkpoint: 'after-run',
			ref: 'root/example-toolbar:1/shadow/example-button:1',
			text: 'Share now',
			depth: 'deepest',
			pin: { x: 0.424, y: 0.576 },
		});
		expect(formatted).toBe(
			'specimen:example-toolbar?theme=dark&viewport=1280x800&checkpoint=after-run#ref=root/example-toolbar:1/shadow/example-button:1&text=Share%20now&depth=deepest&pin=0.42,0.58'
		);
		expect(parsePointer(formatted)).toEqual({
			specimen: 'example-toolbar',
			context: { theme: 'dark', viewport: '1280x800' },
			checkpoint: 'after-run',
			ref: 'root/example-toolbar:1/shadow/example-button:1',
			text: 'Share now',
			depth: 'deepest',
			pin: { x: 0.42, y: 0.58 },
		});
	});

	it('omits optional query, text, depth and pin when absent in formatPointer', () => {
		const formatted = formatPointer({
			specimen: 'fixtures-cases--precedence',
			ref: 'root/div:1',
		});
		expect(formatted).toBe('specimen:fixtures-cases--precedence#ref=root/div:1');
	});

	it('supports Unicode and emoji story IDs emitted by Specimen CSF indexing', () => {
		for (const id of ['ünïcode-ñame--primary', 'emoji-😀-title--default']) {
			const formatted = formatPointer({
				specimen: id,
				context: { theme: 'light' },
				ref: 'root/div:1',
			});
			const parsed = parsePointer(formatted);
			expect(parsed.specimen).toBe(id);
			expect(parsed.context).toEqual({ theme: 'light' });
		}
	});

	it('deduplicates matching context.checkpoint and rejects conflicting or empty checkpoints', () => {
		const deduped = formatPointer({
			specimen: 'example-toolbar',
			context: { theme: 'dark', checkpoint: 'after-run' },
			checkpoint: 'after-run',
			ref: 'root/div:1',
		});
		expect(deduped).toBe('specimen:example-toolbar?theme=dark&checkpoint=after-run#ref=root/div:1');
		expect(parsePointer(deduped).checkpoint).toBe('after-run');

		expectPointerInvalid(() =>
			formatPointer({
				specimen: 'example-toolbar',
				context: { checkpoint: 'mount' },
				checkpoint: 'after-run',
				ref: 'root/div:1',
			})
		);
		expectPointerInvalid(() =>
			formatPointer({
				specimen: 'example-toolbar',
				checkpoint: '',
				ref: 'root/div:1',
			})
		);
		expectPointerInvalid(() =>
			formatPointer({
				specimen: 'example-toolbar',
				context: { checkpoint: '' },
				ref: 'root/div:1',
			})
		);
	});

	it('validates positional element refs', () => {
		expect(isValidElementRef('root/example-toolbar:1')).toBe(true);
		expect(isValidElementRef('root/shadow/example-button:1/shadow/button:2/svg:1')).toBe(true);
		expect(isValidElementRef('root')).toBe(false);
		expect(isValidElementRef('example-toolbar:1')).toBe(false);
		expect(isValidElementRef('root/div:0')).toBe(false);
		expect(isValidElementRef('root/shadow')).toBe(false);
		expect(isValidElementRef('root/shadow/shadow/div:1')).toBe(false);
	});

	it('rejects malformed pointers with POINTER_INVALID', () => {
		const badInputs = [
			'',
			'http://example.com#ref=root/div:1',
			'SPECIMEN:foo#ref=root/div:1',
			'specimen:foo\n#ref=root/div:1',
			'specimen:bad%00id#ref=root/div:1',
			'specimen:#ref=root/div:1',
			'specimen:bad id#ref=root/div:1',
			'specimen:foo?theme=dark',
			'specimen:foo#',
			'specimen:foo#text=Share',
			'specimen:foo#ref=root',
			'specimen:foo#ref=div:1',
			'specimen:foo#ref=root/div:0',
			'specimen:foo#ref=root/div:-1',
			'specimen:foo#ref=root/div:abc',
			'specimen:foo#ref=root/shadow',
			'specimen:foo#ref=root/div:1&depth=shallow',
			'specimen:foo#ref=root/div:1&depth=',
			'specimen:foo#ref=root/div:1&pin=-0.1,0.5',
			'specimen:foo#ref=root/div:1&pin=1.01,0.5',
			'specimen:foo#ref=root/div:1&pin=0.5,NaN',
			'specimen:foo#ref=root/div:1&pin=Infinity,0.5',
			'specimen:foo#ref=root/div:1&pin=0.5',
			'specimen:foo#ref=root/div:1&pin=0.5,0.5,0.5',
			'specimen:foo#ref=root/div:1&pin=,0.5',
			'specimen:foo#ref=root/div:1&pin=abc,def',
			'specimen:foo#ref=root/div:1&unknown=1',
			'specimen:foo#ref=root/div:1&ref=root/div:2',
			'specimen:foo?theme=dark&theme=light#ref=root/div:1',
			'specimen:foo?badpair#ref=root/div:1',
			'specimen:foo?checkpoint=#ref=root/div:1',
			'specimen:foo?__proto__=polluted#ref=root/div:1',
			'specimen:foo?constructor=bad#ref=root/div:1',
			'specimen:foo?prototype=bad#ref=root/div:1',
			'specimen:foo#ref=root/div:1&text=%ZZ',
			'specimen:foo#ref=root/div:1&&text=ok',
		];
		for (const uri of badInputs) {
			expectPointerInvalid(() => parsePointer(uri));
		}
	});

	it('rejects invalid inputs to formatPointer with POINTER_INVALID', () => {
		expectPointerInvalid(() => formatPointer({ specimen: '', ref: 'root/div:1' }));
		expectPointerInvalid(() => formatPointer({ specimen: 'bad\x00id', ref: 'root/div:1' }));
		expectPointerInvalid(() => formatPointer({ specimen: 'ok', ref: 'root' }));
		expectPointerInvalid(() =>
			formatPointer({ specimen: 'ok', context: { constructor: 'bad' }, ref: 'root/div:1' })
		);
		expectPointerInvalid(() =>
			formatPointer({ specimen: 'ok', ref: 'root/div:1', depth: 'shallow' as 'deepest' })
		);
		expectPointerInvalid(() =>
			formatPointer({ specimen: 'ok', ref: 'root/div:1', pin: { x: -0.1, y: 0.5 } })
		);
		expectPointerInvalid(() =>
			formatPointer({ specimen: 'ok', ref: 'root/div:1', pin: { x: 0.5, y: Number.NaN } })
		);
	});
});

describe('shared two-step meaningful-element climb (§4.1)', () => {
	// Shared toolbar fixture matching scenarios 01 & 02:
	// example-toolbar (role=toolbar)
	//   #shadow-root
	//     input (role=searchbox, name=Search)
	//     example-button:1
	//       #shadow-root
	//         div.wrapper
	//           button (role=button, name=Share)
	//             violet-icon (aria-hidden=true)
	//               #shadow-root
	//                 svg > path
	//             span ("Share")
	//     example-button:2
	//       #shadow-root
	//         button (role=button, name=Export)
	const toolbarElements: ElementObservation[] = [
		makeObservation('root', 'main'),
		makeObservation('root/example-toolbar:1', 'example-toolbar', {
			accessibility: { role: 'toolbar', name: '' },
		}),
		makeObservation('root/example-toolbar:1/shadow/input:1', 'input', {
			attributes: { type: 'search', 'aria-label': 'Search' },
			accessibility: { role: 'searchbox', name: 'Search' },
		}),
		makeObservation('root/example-toolbar:1/shadow/example-button:1', 'example-button'),
		makeObservation('root/example-toolbar:1/shadow/example-button:1/shadow/div:1', 'div'),
		makeObservation(
			'root/example-toolbar:1/shadow/example-button:1/shadow/div:1/button:1',
			'button',
			{
				accessibility: { role: 'button', name: 'Share' },
			}
		),
		makeObservation(
			'root/example-toolbar:1/shadow/example-button:1/shadow/div:1/button:1/violet-icon:1',
			'violet-icon',
			{ attributes: { 'aria-hidden': 'true' } }
		),
		makeObservation(
			'root/example-toolbar:1/shadow/example-button:1/shadow/div:1/button:1/violet-icon:1/shadow/svg:1',
			'svg'
		),
		makeObservation(
			'root/example-toolbar:1/shadow/example-button:1/shadow/div:1/button:1/violet-icon:1/shadow/svg:1/path:1',
			'path'
		),
		makeObservation(
			'root/example-toolbar:1/shadow/example-button:1/shadow/div:1/button:1/span:1',
			'span'
		),
		makeObservation('root/example-toolbar:1/shadow/example-button:2', 'example-button'),
		makeObservation('root/example-toolbar:1/shadow/example-button:2/shadow/button:1', 'button', {
			accessibility: { role: 'button', name: 'Export' },
		}),
	];

	it('climbs from nested SVG, decorative icon, span, or inner button to the same custom element', () => {
		const buttonRef = 'root/example-toolbar:1/shadow/example-button:1/shadow/div:1/button:1';
		const hits = [
			`${buttonRef}/violet-icon:1/shadow/svg:1/path:1`,
			`${buttonRef}/violet-icon:1/shadow/svg:1`,
			`${buttonRef}/violet-icon:1`,
			`${buttonRef}/span:1`,
			buttonRef,
			'root/example-toolbar:1/shadow/example-button:1',
		];

		for (const ref of hits) {
			const result = climbObservation(toolbarElements, ref);
			expect(result, ref).not.toBeNull();
			expect(result?.element.ref, ref).toBe('root/example-toolbar:1/shadow/example-button:1');
			expect(result?.accessible?.role, ref).toBe('button');
			expect(result?.accessible?.name, ref).toBe('Share');
			expect(result?.accessible?.from.ref, ref).toBe(buttonRef);
		}
	});

	it('excludes decorative custom icons inside interactive roles even without aria-hidden', () => {
		const elements: ElementObservation[] = [
			makeObservation('root/example-button:1', 'example-button'),
			makeObservation('root/example-button:1/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Save' },
			}),
			makeObservation('root/example-button:1/shadow/button:1/violet-icon:1', 'violet-icon'),
			makeObservation('root/example-button:1/shadow/button:1/violet-icon:1/svg:1', 'svg'),
		];
		const tree = observationClimbTree(elements);
		const iconNode = tree.get('root/example-button:1/shadow/button:1/violet-icon:1');
		expect(iconNode).toBeDefined();
		expect(isMeaningfulNode(iconNode as ClimbNode<ElementObservation>)).toBe(false);

		const climbed = climbObservation(
			elements,
			'root/example-button:1/shadow/button:1/violet-icon:1/svg:1'
		);
		expect(climbed?.element.ref).toBe('root/example-button:1');
		expect(climbed?.accessible?.name).toBe('Save');
	});

	it('keeps standalone custom icon elements meaningful outside an interactive role', () => {
		const elements: ElementObservation[] = [
			makeObservation('root/div:1', 'div'),
			makeObservation('root/div:1/violet-icon:1', 'violet-icon'),
			makeObservation('root/div:1/violet-icon:1/shadow/svg:1', 'svg'),
		];
		const climbed = climbObservation(elements, 'root/div:1/violet-icon:1/shadow/svg:1');
		expect(climbed?.element.ref).toBe('root/div:1/violet-icon:1');
	});

	it('skips both climb steps when depth=deepest', () => {
		const svgRef =
			'root/example-toolbar:1/shadow/example-button:1/shadow/div:1/button:1/violet-icon:1/shadow/svg:1';
		const result = climbObservation(toolbarElements, svgRef, { depth: 'deepest' });
		expect(result?.element.ref).toBe(svgRef);
		expect(result?.accessible).toBeUndefined();

		const buttonRef = 'root/example-toolbar:1/shadow/example-button:1/shadow/div:1/button:1';
		const buttonResult = climbObservation(toolbarElements, buttonRef, { depth: 'deepest' });
		expect(buttonResult?.element.ref).toBe(buttonRef);
		expect(buttonResult?.accessible?.role).toBe('button');
		expect(buttonResult?.accessible?.name).toBe('Share');
	});

	it('climbs through nested single-purpose custom elements and stops at multi-control shadow hosts', () => {
		const elements: ElementObservation[] = [
			makeObservation('root/app-bar:1', 'app-bar'),
			makeObservation('root/app-bar:1/shadow/app-share:1', 'app-share'),
			makeObservation(
				'root/app-bar:1/shadow/app-share:1/shadow/example-button:1',
				'example-button'
			),
			makeObservation(
				'root/app-bar:1/shadow/app-share:1/shadow/example-button:1/shadow/button:1',
				'button',
				{ accessibility: { role: 'button', name: 'Share' } }
			),
			makeObservation('root/app-bar:1/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Help' },
			}),
		];
		const climbed = climbObservation(
			elements,
			'root/app-bar:1/shadow/app-share:1/shadow/example-button:1/shadow/button:1'
		);
		expect(climbed?.element.ref).toBe('root/app-bar:1/shadow/app-share:1');
	});

	it('does not climb from a light-DOM child into its parent custom element', () => {
		const elements: ElementObservation[] = [
			makeObservation('root/example-card:1', 'example-card'),
			makeObservation('root/example-card:1/shadow/slot:1', 'slot'),
			makeObservation('root/example-card:1/button:1', 'button', {
				accessibility: { role: 'button', name: 'Confirm' },
			}),
		];
		const climbed = climbObservation(elements, 'root/example-card:1/button:1');
		expect(climbed?.element.ref).toBe('root/example-card:1/button:1');
	});

	it('returns null when ref is unknown and falls back to hit when no ancestor is meaningful', () => {
		expect(climbObservation(toolbarElements, 'root/missing:1')).toBeNull();

		const plain: ElementObservation[] = [
			makeObservation('root/div:1', 'div'),
			makeObservation('root/div:1/span:1', 'span'),
		];
		const result = climbObservation(plain, 'root/div:1/span:1');
		expect(result?.element.ref).toBe('root/div:1/span:1');
	});

	it('follows composedParent in Step 1 so slotted content reaches its shadow interactive ancestor', () => {
		const primaryBtn: ClimbNode<string> = {
			value: 'primary-button',
			tag: 'button',
			role: 'button',
			name: 'Primary',
			parent: () => host,
			shadowHost: () => host,
			shadowChildren: () => [],
			children: () => [],
		};
		const secondaryBtn: ClimbNode<string> = {
			value: 'secondary-button',
			tag: 'button',
			role: 'button',
			name: 'Secondary',
			parent: () => host,
			shadowHost: () => host,
			shadowChildren: () => [],
			children: () => [],
		};
		const host: ClimbNode<string> = {
			value: 'x-split',
			tag: 'x-split',
			parent: () => null,
			shadowHost: () => null,
			shadowChildren: () => [primaryBtn, secondaryBtn],
			children: () => [slottedSpan],
		};
		const slottedSpan: ClimbNode<string> = {
			value: 'slotted-span',
			tag: 'span',
			// DOM parent is the host, while composed parent is the shadow button via <slot>.
			parent: () => host,
			composedParent: () => primaryBtn,
			shadowHost: () => null,
			shadowChildren: () => [],
			children: () => [],
		};
		// Clicking the slotted span must select primary-button (not x-split), agreeing with { role, name }.
		expect(climbSelection(slottedSpan).selected.value).toBe('primary-button');
		expect(climbSelection(primaryBtn).selected.value).toBe('primary-button');
	});

	it('propagates aria-hidden through composedParent and resolves soleAccessibleInShadow across presentation wrappers', () => {
		const hiddenWrapper: ClimbNode<string> = {
			value: 'hidden-span',
			tag: 'span',
			ariaHidden: true,
			parent: () => null,
			shadowHost: () => null,
			shadowChildren: () => [],
			children: () => [],
		};
		const slottedBadge: ClimbNode<string> = {
			value: 'slotted-badge',
			tag: 'span',
			role: 'status',
			name: 'New',
			parent: () => null,
			composedParent: () => hiddenWrapper,
			shadowHost: () => null,
			shadowChildren: () => [],
			children: () => [],
		};
		expect(isMeaningfulNode(slottedBadge)).toBe(false);

		// role="presentation" wrapper inside a custom element does not hide its child button.
		const elements: ElementObservation[] = [
			makeObservation('root/x-wrap:1', 'x-wrap'),
			makeObservation('root/x-wrap:1/shadow/div:1', 'div', {
				attributes: { role: 'presentation' },
			}),
			makeObservation('root/x-wrap:1/shadow/div:1/button:1', 'button', {
				accessibility: { role: 'button', name: 'Share' },
			}),
		];
		const directHost = climbObservation(elements, 'root/x-wrap:1');
		expect(directHost?.accessible?.role).toBe('button');
		expect(directHost?.accessible?.name).toBe('Share');

		// Multi-button nested custom element + sibling button must not pick the sibling as sole accessible.
		const multi: ElementObservation[] = [
			makeObservation('root/x-outer:1', 'x-outer'),
			makeObservation('root/x-outer:1/shadow/x-pair:1', 'x-pair'),
			makeObservation('root/x-outer:1/shadow/x-pair:1/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'One' },
			}),
			makeObservation('root/x-outer:1/shadow/x-pair:1/shadow/button:2', 'button', {
				accessibility: { role: 'button', name: 'Two' },
			}),
			makeObservation('root/x-outer:1/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Help' },
			}),
		];
		expect(climbObservation(multi, 'root/x-outer:1')?.accessible).toBeUndefined();
	});
});
