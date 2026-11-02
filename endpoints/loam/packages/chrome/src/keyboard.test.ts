import { createDefaultLayout, SHELL_KEYBINDINGS_V0 } from '@lushly-dev/loam-kernel';
import { describe, expect, it } from 'vitest';
import {
	type ChordEvent,
	isMacPlatform,
	matchKeybinding,
	nextPart,
	toggleInput,
} from './keyboard.js';

const key = (init: Partial<ChordEvent>): ChordEvent => ({
	key: '',
	code: '',
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...init,
});

describe('reserved chords', () => {
	it('matches Mod as Command on macOS and Control elsewhere', () => {
		expect(matchKeybinding(key({ key: 'k', code: 'KeyK', metaKey: true }), true)?.command).toBe(
			'palette-open'
		);
		expect(matchKeybinding(key({ key: 'k', code: 'KeyK', ctrlKey: true }), false)?.command).toBe(
			'palette-open'
		);
		expect(matchKeybinding(key({ key: 'k', code: 'KeyK', ctrlKey: true }), true)).toBeUndefined();
		expect(
			matchKeybinding(key({ key: 'k', code: 'KeyK', ctrlKey: true, metaKey: true }), false)
		).toBeUndefined();
	});

	it('matches letters by physical key, so Alt does not change them', () => {
		const binding = matchKeybinding(
			key({ key: '∫', code: 'KeyB', metaKey: true, altKey: true }),
			true
		);
		expect(binding).toMatchObject({ chord: 'Mod+Alt+B', toggle: 'inspector' });
		expect(matchKeybinding(key({ key: 'b', code: 'KeyB', ctrlKey: true }), false)?.toggle).toBe(
			'sidebar'
		);
	});

	it('matches F6 and Shift+F6 without a modifier', () => {
		expect(matchKeybinding(key({ key: 'F6' }), false)?.focus).toBe('next');
		expect(matchKeybinding(key({ key: 'F6', shiftKey: true }), false)?.focus).toBe('previous');
		expect(matchKeybinding(key({ key: 'F6', ctrlKey: true }), false)).toBeUndefined();
	});

	it('covers every reserved chord', () => {
		const events: Record<string, ChordEvent> = {
			'Mod+K': key({ code: 'KeyK', ctrlKey: true }),
			'Mod+B': key({ code: 'KeyB', ctrlKey: true }),
			'Mod+Alt+B': key({ code: 'KeyB', ctrlKey: true, altKey: true }),
			'Mod+J': key({ code: 'KeyJ', ctrlKey: true }),
			F6: key({ key: 'F6' }),
			'Shift+F6': key({ key: 'F6', shiftKey: true }),
		};
		for (const binding of SHELL_KEYBINDINGS_V0) {
			expect(matchKeybinding(events[binding.chord] as ChordEvent, false)?.chord).toBe(
				binding.chord
			);
		}
	});

	it('computes toggle inputs per class', () => {
		const layout = createDefaultLayout();
		expect(toggleInput('sidebar', layout, 'expanded')).toEqual({ sidebar: { open: false } });
		expect(toggleInput('inspector', layout, 'medium')).toEqual({ inspector: { open: true } });
		expect(toggleInput('panel', layout, 'expanded')).toEqual({ panel: { open: true } });
		expect(toggleInput('sidebar', layout, 'compact')).toEqual({ compact: { drawer: 'sidebar' } });
		const drawer = { ...layout, compact: { drawer: 'sidebar' as const, sheet: false } };
		expect(toggleInput('sidebar', drawer, 'compact')).toEqual({ compact: { drawer: null } });
		expect(toggleInput('inspector', drawer, 'compact')).toEqual({
			compact: { drawer: 'inspector' },
		});
		expect(toggleInput('panel', drawer, 'compact')).toEqual({ compact: { sheet: true } });
	});

	it('moves focus through the present parts in order, wrapping', () => {
		const present = ['statusbar', 'main', 'titlebar', 'rail', 'sidebar'] as const;
		expect(nextPart(present, undefined, 'next')).toBe('titlebar');
		expect(nextPart(present, undefined, 'previous')).toBe('statusbar');
		expect(nextPart(present, 'rail', 'next')).toBe('sidebar');
		expect(nextPart(present, 'statusbar', 'next')).toBe('titlebar');
		expect(nextPart(present, 'titlebar', 'previous')).toBe('statusbar');
		expect(nextPart(present, 'inspector', 'next')).toBe('titlebar');
		expect(nextPart([], 'main', 'next')).toBeUndefined();
	});

	it('detects the macOS platform', () => {
		expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
		expect(isMacPlatform({ platform: 'Linux x86_64', userAgent: 'X11' })).toBe(false);
		expect(isMacPlatform(undefined)).toBe(false);
	});
});
