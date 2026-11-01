/** A theme module shaped as `@lushly-dev/violet-elements`' theme exports are. */
export const presets = ['light', 'dark'] as const;

export function install(): void {
	if (document.getElementById('fixture-theme')) return;
	const style = document.createElement('style');
	style.id = 'fixture-theme';
	style.textContent = ':root[data-fixture-theme="dark"] { --fixture-ink: rgb(255, 255, 255); }';
	document.head.append(style);
}

export function apply(target: Document | HTMLElement, preset: string): void {
	const element = target instanceof Document ? target.documentElement : target;
	element.setAttribute('data-fixture-theme', preset);
}
