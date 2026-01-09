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
		if (!enabled) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
				if (e.key === 'Escape') target.blur();
				return;
			}

			for (const shortcut of shortcuts) {
				const keyMatches = e.key.toLowerCase() === shortcut.key.toLowerCase();
				const ctrlMatches = !!shortcut.ctrl === (e.ctrlKey || e.metaKey);
				const shiftMatches = !!shortcut.shift === e.shiftKey;
				const altMatches = !!shortcut.alt === e.altKey;

				if (keyMatches && ctrlMatches && shiftMatches && altMatches) {
					if (shortcut.when && !shortcut.when()) continue;
					e.preventDefault();
					shortcut.action();
					return;
				}
			}
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
