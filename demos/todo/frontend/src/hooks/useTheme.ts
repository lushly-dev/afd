import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

export function useTheme() {
	const [theme, setTheme] = useState<Theme>(() => {
		const stored = localStorage.getItem('afd-todo-theme');
		return (stored as Theme) || 'dark';
	});

	useEffect(() => {
		localStorage.setItem('afd-todo-theme', theme);
		if (theme === 'light') {
			document.documentElement.setAttribute('data-theme', 'light');
		} else {
			document.documentElement.removeAttribute('data-theme');
		}
	}, [theme]);

	const toggleTheme = useCallback(() => {
		setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
	}, []);

	return { theme, toggleTheme };
}
