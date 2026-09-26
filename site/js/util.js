// Shared helpers for the page modules.

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Run `onEnter` each time `el` scrolls into view and `onLeave` when it leaves,
// so animations only spend cycles while someone can see them.
export function whileVisible(el, onEnter, onLeave = () => {}, threshold = 0.25) {
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) onEnter();
				else onLeave();
			}
		},
		{ threshold },
	);
	observer.observe(el);
	return observer;
}

// Generic ARIA tabs: [role=tablist] with [role=tab][aria-controls].
export function initTabs(tablist, onChange) {
	const tabs = [...tablist.querySelectorAll('[role="tab"]')];
	const select = (tab, focus) => {
		for (const t of tabs) {
			const selected = t === tab;
			t.setAttribute('aria-selected', String(selected));
			t.tabIndex = selected ? 0 : -1;
			document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
		}
		if (focus) tab.focus();
		onChange?.(tab);
	};
	tablist.addEventListener('click', (event) => {
		const tab = event.target.closest('[role="tab"]');
		if (tab) select(tab, false);
	});
	tablist.addEventListener('keydown', (event) => {
		const index = tabs.indexOf(document.activeElement);
		if (index < 0) return;
		const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
		if (!step) return;
		event.preventDefault();
		select(tabs[(index + step + tabs.length) % tabs.length], true);
	});
}
