import type React from 'react';
import { useEffect } from 'react';
import type { KeyboardShortcut } from '../hooks/useKeyboard';
import { formatShortcut } from '../hooks/useKeyboard';
import type { Theme } from '../hooks/useTheme';
import { ThemeToggle } from './ThemeToggle';
import './SettingsModal.css';

interface SettingsModalProps {
	isOpen: boolean;
	onClose: () => void;
	shortcuts: KeyboardShortcut[];
	theme: Theme;
	onThemeToggle: () => void;
}

function categorizeShortcuts(shortcuts: KeyboardShortcut[]) {
	const global: KeyboardShortcut[] = [];
	const navigation: KeyboardShortcut[] = [];
	const actions: KeyboardShortcut[] = [];

	for (const shortcut of shortcuts) {
		const desc = shortcut.description.toLowerCase();
		if (desc.includes('navigate') || desc.includes('focus')) {
			navigation.push(shortcut);
		} else if (
			desc.includes('toggle') ||
			desc.includes('delete') ||
			desc.includes('edit') ||
			desc.includes('clear')
		) {
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

export const SettingsModal: React.FC<SettingsModalProps> = ({
	isOpen,
	onClose,
	shortcuts,
	theme,
	onThemeToggle,
}) => {
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
		// biome-ignore lint/a11y/noStaticElementInteractions: Overlay div for click-outside-to-close pattern
		<div
			className="settings-overlay"
			role="presentation"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === 'Escape') onClose();
			}}
		>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation on modal content prevents overlay close */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation on modal content prevents overlay close */}
			<div className="settings-modal" onClick={(e) => e.stopPropagation()}>
				<div className="settings-header">
					<h2>Settings</h2>
					<button type="button" className="settings-close" onClick={onClose}>
						×
					</button>
				</div>

				<div className="settings-section">
					<h3>Appearance</h3>
					<div className="settings-theme-row">
						<span>Theme</span>
						<ThemeToggle theme={theme} onToggle={onThemeToggle} />
					</div>
				</div>

				<div className="settings-divider" />

				<div className="settings-section">
					<h3>Keyboard Shortcuts</h3>
					<div className="settings-shortcuts-container">
						{categories.map((category) => (
							<div key={category.name} className="settings-shortcut-category">
								<h4>{category.name}</h4>
								<div className="settings-shortcut-list">
									{category.shortcuts.map((shortcut) => (
										<div
											key={shortcut.key + shortcut.description}
											className="settings-shortcut-item"
										>
											<span className="settings-shortcut-description">{shortcut.description}</span>
											<kbd className="settings-key">{formatShortcut(shortcut)}</kbd>
										</div>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
};
