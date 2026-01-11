import { useEffect } from 'react';
import type { KeyboardShortcut } from '../hooks/useKeyboard';
import { formatShortcut } from '../hooks/useKeyboard';
import './KeyboardHelp.css';

interface KeyboardHelpProps {
	isOpen: boolean;
	onClose: () => void;
	shortcuts: KeyboardShortcut[];
}

function categorizeShortcuts(shortcuts: KeyboardShortcut[]) {
	const global: KeyboardShortcut[] = [];
	const navigation: KeyboardShortcut[] = [];
	const actions: KeyboardShortcut[] = [];

	for (const shortcut of shortcuts) {
		const desc = shortcut.description.toLowerCase();
		if (desc.includes('navigate') || desc.includes('focus')) {
			navigation.push(shortcut);
		} else if (desc.includes('toggle') || desc.includes('delete') || desc.includes('edit') || desc.includes('clear')) {
			actions.push(shortcut);
		} else {
			global.push(shortcut);
		}
	}

	const categories = [];
	if (global.length > 0) categories.push({ name: 'Global', shortcuts: global });
	if (navigation.length > 0) categories.push({ name: 'Navigation', shortcuts: navigation });
	if (actions.length > 0) categories.push({ name: 'Actions', shortcuts: actions });
	return categories;
}

export const KeyboardHelp: React.FC<KeyboardHelpProps> = ({ isOpen, onClose, shortcuts }) => {
	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				onClose();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [isOpen, onClose]);

	if (!isOpen) return null;

	const categories = categorizeShortcuts(shortcuts);

	return (
		<div className="keyboard-help-overlay" onClick={onClose}>
			<div className="keyboard-help-modal" onClick={(e) => e.stopPropagation()}>
				<div className="keyboard-help-header">
					<h2>Keyboard Shortcuts</h2>
					<button type="button" className="keyboard-help-close" onClick={onClose}>×</button>
				</div>
				{categories.map((category) => (
					<div key={category.name} className="keyboard-help-section">
						<h3>{category.name}</h3>
						<div className="keyboard-help-list">
							{category.shortcuts.map((shortcut) => (
								<div key={shortcut.key + shortcut.description} className="keyboard-help-item">
									<span className="keyboard-help-description">{shortcut.description}</span>
									<kbd className="keyboard-key">{formatShortcut(shortcut)}</kbd>
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
};
