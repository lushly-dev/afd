import { useEffect } from 'react';

export interface KeyboardShortcut {
	key: string;
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
	meta?: boolean;
	action: () => void;
	description: string;
	when?: () => boolean;
}

export interface UseKeyboardOptions {
	shortcuts: KeyboardShortcut[];
	enabled?: boolean;
}

export function useKeyboard({ shortcuts, enabled = true }: UseKeyboardOptions): void {
	useEffect(() => {
		if (!enabled) {
			console.log('[useKeyboard] Disabled');
			return;
		}

		console.log('[useKeyboard] Registering', shortcuts.length, 'shortcuts');

		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			console.log('[useKeyboard] Key pressed:', e.key, 'target:', target.tagName, 'shift:', e.shiftKey);
			
			if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
				if (e.key === 'Escape') target.blur();
				console.log('[useKeyboard] Ignoring - in input/textarea');
				return;
			}

			for (const shortcut of shortcuts) {
				const keyMatches = e.key.toLowerCase() === shortcut.key.toLowerCase();
				const ctrlMatches = !!shortcut.ctrl === (e.ctrlKey || e.metaKey);
				// Only check shift if the shortcut explicitly requires it
				// This allows shifted keys like ? to work without requiring shift: true in the shortcut
				const shiftMatches = shortcut.shift ? e.shiftKey : true;
				const altMatches = !!shortcut.alt === e.altKey;

				if (keyMatches && ctrlMatches && shiftMatches && altMatches) {
					if (shortcut.when && !shortcut.when()) {
						console.log('[useKeyboard] Matched', shortcut.key, 'but when() returned false');
						continue;
					}
					console.log('[useKeyboard] Executing shortcut:', shortcut.key, shortcut.description);
					e.preventDefault();
					shortcut.action();
					return;
				}
			}
			console.log('[useKeyboard] No matching shortcut for:', e.key);
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [shortcuts, enabled]);
}

export function formatShortcut(shortcut: KeyboardShortcut): string {
	const parts: string[] = [];
	if (shortcut.ctrl) parts.push('Ctrl');
	if (shortcut.alt) parts.push('Alt');
	if (shortcut.shift) parts.push('Shift');
	if (shortcut.meta) parts.push('Cmd');

	let key = shortcut.key;
	if (key === ' ') key = 'Space';
	if (key === 'ArrowUp') key = '↑';
	if (key === 'ArrowDown') key = '↓';
	if (key === 'Escape') key = 'Esc';
	if (key === 'Backspace') key = '⌫';
	if (key === 'Delete') key = 'Del';
	if (key === 'Enter') key = '↵';

	parts.push(key.toUpperCase());
	return parts.join('+');
}
