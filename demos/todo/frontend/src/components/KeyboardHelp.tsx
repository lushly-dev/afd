import { useEffect } from 'react';
import type { KeyboardShortcut } from '../hooks/useKeyboard';
import { formatShortcut } from '../hooks/useKeyboard';
import type { Theme } from '../hooks/useTheme';
import './KeyboardHelp.css';

interface KeyboardHelpProps {
	isOpen: boolean;
	onClose: () => void;
	shortcuts: KeyboardShortcut[];
	theme: Theme;
	onToggleTheme: () => void;
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

export const KeyboardHelp: React.FC<KeyboardHelpProps> = ({ isOpen, onClose, shortcuts, theme, onToggleTheme }) => {
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
					<h2>Settings</h2>
					<button type="button" className="keyboard-help-close" onClick={onClose}>×</button>
				</div>
				
				{/* Theme Toggle Section */}
				<div className="keyboard-help-section">
					<h3>Appearance</h3>
					<div className="settings-row">
						<span>Theme</span>
						<button 
							type="button" 
							className="theme-toggle-btn"
							onClick={onToggleTheme}
						>
							{theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
						</button>
					</div>
				</div>

				{/* Keyboard Shortcuts Section */}
				<div className="keyboard-help-section">
					<h3>Keyboard Shortcuts</h3>
				</div>
				{categories.map((category) => (
					<div key={category.name} className="keyboard-help-section">
						<h4>{category.name}</h4>
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
