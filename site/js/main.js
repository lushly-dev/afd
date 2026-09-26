// AFD landing page — entry point. Every module degrades to a static page.

import { initAgentView } from './agent-view.js';
import { initCommandLayer } from './command-layer.js';
import { initExplorer } from './explorer.js';
import { highlightAll } from './highlight.js';
import { initHero } from './hero.js';
import { initHonesty } from './honesty.js';
import { initRunner } from './runner.js';
import { initSections } from './sections.js';
import { call } from './runtime.js';
import { initTabs } from './util.js';

function initReveal() {
	if (!('IntersectionObserver' in window)) return;
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				entry.target.classList.add('is-visible');
				observer.unobserve(entry.target);
			}
		},
		{ rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
	);
	for (const el of document.querySelectorAll('.reveal')) {
		const rect = el.getBoundingClientRect();
		if (rect.top < window.innerHeight && rect.bottom > 0) el.classList.add('is-visible');
		else observer.observe(el);
	}
	document.documentElement.classList.add('reveal-ready');
}

function initNav() {
	const nav = document.getElementById('site-nav');
	const toggle = nav.querySelector('.nav-toggle');
	const menu = document.getElementById('nav-menu');

	const setOpen = (open) => {
		toggle.setAttribute('aria-expanded', String(open));
		toggle.textContent = open ? 'Close' : 'Menu';
		menu.classList.toggle('is-open', open);
	};
	toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
	menu.addEventListener('click', (event) => {
		if (event.target.closest('a')) setOpen(false);
	});
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && menu.classList.contains('is-open')) {
			setOpen(false);
			toggle.focus();
		}
	});

	const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
	onScroll();
	window.addEventListener('scroll', onScroll, { passive: true });

	// Mark the nav link for the section in view.
	const links = new Map(
		[...menu.querySelectorAll('a[href^="#"]')].map((a) => [a.getAttribute('href').slice(1), a]),
	);
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				for (const link of links.values()) link.removeAttribute('aria-current');
				links.get(entry.target.id)?.setAttribute('aria-current', 'true');
			}
		},
		{ rootMargin: '-45% 0px -50% 0px' },
	);
	for (const id of links.keys()) {
		const section = document.getElementById(id);
		if (section) observer.observe(section);
	}
}

// Any button with data-copy-target copies that element's text.
function initCopyTargets() {
	for (const button of document.querySelectorAll('[data-copy-target]')) {
		button.addEventListener('click', async () => {
			const target = document.getElementById(button.dataset.copyTarget);
			try {
				await navigator.clipboard.writeText(target.textContent.trim());
				button.textContent = 'Copied';
			} catch {
				button.textContent = 'Select & copy';
			}
			setTimeout(() => {
				button.textContent = 'Copy';
			}, 1800);
		});
	}
}

function initInstall() {
	const install = document.querySelector('[data-tabs]');
	if (!install) return;
	initTabs(install.querySelector('[role="tablist"]'));
	const copy = install.querySelector('[data-copy]');
	const LANGUAGE = { 'install-ts': 'typescript', 'install-py': 'python', 'install-rs': 'rust' };
	// Copying is a command too: install-copy, visible in the command log.
	copy.addEventListener('click', async () => {
		const panel = install.querySelector('[role="tabpanel"]:not([hidden])');
		const result = await call('install-copy', { language: LANGUAGE[panel.id] }, { surface: 'ui' });
		copy.textContent = result.success ? 'Copied' : 'Select & copy';
		copy.classList.add('is-done');
		setTimeout(() => {
			copy.textContent = 'Copy';
			copy.classList.remove('is-done');
		}, 1800);
	});
}

// Run every module independently so one failure can't take the page down.
for (const init of [
	highlightAll,
	initNav,
	initInstall,
	initCopyTargets,
	initSections,
	initCommandLayer,
	initHero,
	initHonesty,
	initExplorer,
	initRunner,
	initAgentView,
	initReveal,
]) {
	try {
		init();
	} catch (error) {
		console.error(`[afd.dev] ${init.name} failed`, error);
	}
}
