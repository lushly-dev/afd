// Alfred: the agent's mark, and sometimes its face.
//
// At rest it is a compass: one bar in a ring, leaning like the wordmark slash,
// turning slowly toward the pointer. When someone comes close, clicks, or the
// page hands it work, the needle swings home, draws in to one block and divides
// into two eyes. Everything the face does is one of two moves: a bar slides
// along its axis, or changes length. Nothing rotates, bends or grows a mouth.

import { reducedMotion } from './util.js';

const LEAN = 20; // degrees from vertical: the wordmark slash
const BAR = 13; // bar width, in a 100-unit box
const X = { l: 38, r: 62 };
const EYE = { cy: 45, len: 24, dx: 0 };
// Two bars side by side, overlapping a little, read as one needle.
const NEEDLE = { l: { cy: 50, len: 200, dx: 6.25 }, r: { cy: 50, len: 200, dx: -6.25 } };

// A heavy needle in thick oil: slow to answer, and it never wobbles past.
const SPEED = 3.1;
const DAMPING = 1.15;
const STIFFNESS = SPEED * SPEED;

const ease = {
	out: (t) => 1 - (1 - t) ** 3,
	in: (t) => t ** 3,
	inOut: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
	back: (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2,
};
const calm = () => reducedMotion.matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, calm() ? 0 : ms));
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
// Shortest turn between two headings of a bar, which looks the same every 180 degrees.
const turn = (delta) => ((((delta + 90) % 180) + 180) % 180) - 90;

const pointer = { x: 0, y: 0, active: false };
const actors = new Set();
let running = false;
let last = 0;
let count = 0;

function frame(now) {
	const dt = Math.min(0.033, (now - last) / 1000);
	last = now;
	let visible = false;
	for (const actor of actors) {
		if (!actor.visible) continue;
		visible = true;
		actor.step(dt, now);
	}
	// Nothing on screen: stop, and start again when one scrolls into view.
	if (visible) requestAnimationFrame(frame);
	else running = false;
}
function start() {
	if (running) return;
	running = true;
	last = performance.now();
	requestAnimationFrame(frame);
}
function listen() {
	addEventListener('pointermove', (event) => {
		pointer.x = event.clientX;
		pointer.y = event.clientY;
		pointer.active = event.pointerType !== 'touch';
	});
	document.documentElement.addEventListener('pointerleave', () => {
		pointer.active = false;
	});
}

class Alfred {
	constructor(svg) {
		this.svg = svg;
		this.state = 'compass';
		this.angle = 0; // degrees away from home
		this.spin = 0;
		this.look = { x: 0, y: 0 };
		this.model = { l: { ...NEEDLE.l }, r: { ...NEEDLE.r } };
		this.queue = Promise.resolve();
		this.pending = 0;
		this.engaged = false; // set by the page to keep it awake
		this.working = false;
		this.visible = false;
		this.waiters = [];
		this.farSince = null;
		this.nearSince = null;
		this.nextBlink = 0;

		const windowId = `alfred-window-${count++}`;
		svg.setAttribute('viewBox', '0 0 100 100');
		svg.innerHTML = `
			<defs><clipPath id="${windowId}"><circle cx="50" cy="50" r="39" /></clipPath></defs>
			<circle class="alfred__disc" cx="50" cy="50" r="50" />
			<g clip-path="url(#${windowId})">
				<g data-turn>
					<g transform="translate(50 50) skewX(-${LEAN}) translate(-50 -50)">
						<rect class="alfred__bar" data-bar="l" width="${BAR}" />
						<rect class="alfred__bar" data-bar="r" width="${BAR}" />
					</g>
				</g>
			</g>`;
		this.parts = {
			turn: svg.querySelector('[data-turn]'),
			l: svg.querySelector('[data-bar="l"]'),
			r: svg.querySelector('[data-bar="r"]'),
		};
		this.render();

		svg.addEventListener('click', () => {
			if (this.state === 'awake') this.express('surprise');
			else this.wake();
		});
		new IntersectionObserver((entries) => {
			this.visible = entries.at(-1).isIntersecting;
			if (this.visible) start();
		}).observe(svg);
	}

	render() {
		this.parts.turn.setAttribute('transform', `rotate(${this.angle.toFixed(2)} 50 50)`);
		for (const side of ['l', 'r']) {
			const bar = this.model[side];
			const len = Math.max(0.5, bar.len);
			this.parts[side].setAttribute('x', X[side] + bar.dx + this.look.x - BAR / 2);
			this.parts[side].setAttribute('y', bar.cy + this.look.y - len / 2);
			this.parts[side].setAttribute('height', len);
		}
	}

	tween(side, target, ms, easing = ease.out) {
		const bar = this.model[side];
		const from = { ...bar };
		const began = performance.now();
		const duration = calm() ? 0 : ms;
		return new Promise((resolve) => {
			const tick = (now) => {
				const t = duration ? Math.min(1, (now - began) / duration) : 1;
				const k = easing(t);
				for (const key in target) bar[key] = from[key] + (target[key] - from[key]) * k;
				this.render();
				if (t < 1) requestAnimationFrame(tick);
				else resolve();
			};
			requestAnimationFrame(tick);
		});
	}
	each(left, right, ms, easing) {
		return Promise.all([this.tween('l', left, ms, easing), this.tween('r', right, ms, easing)]);
	}
	both(target, ms, easing) {
		return this.each(target, target, ms, easing);
	}
	// One thing at a time: wakes, expressions and rests wait their turn.
	enqueue(task) {
		this.pending++;
		this.queue = this.queue
			.then(task)
			.catch((error) => console.error('[alfred]', error))
			.finally(() => {
				this.pending--;
			});
		return this.queue;
	}

	// Every frame while on screen: the needle's physics, or the eyes' glance.
	step(dt, now) {
		const box = this.svg.getBoundingClientRect();
		const radius = box.width / 2;
		if (!radius) return;
		const dx = pointer.x - (box.left + radius);
		const dy = pointer.y - (box.top + radius);
		const distance = Math.hypot(dx, dy);
		const near = pointer.active && distance < Math.max(radius * 1.45, 46);
		const far = !pointer.active || distance > Math.max(radius * 2.5, 130);

		if (this.state === 'compass') {
			if (!calm()) {
				// The pull grows as you come closer. With nobody near, it drifts home.
				const reach = Math.max(radius * 6, 320);
				const pull = pointer.active
					? clamp(1 - (distance - radius) / (reach - radius), 0, 1) ** 1.5
					: 0;
				const toward = (Math.atan2(dx, -dy) * 180) / Math.PI - LEAN;
				const sway = pointer.active ? 0 : Math.sin(now / 1700) * 2.5;
				const home = 0.012 + 0.058 * (1 - pull);
				const force =
					STIFFNESS * pull * turn(toward - this.angle) +
					STIFFNESS * home * turn(sway - this.angle) -
					2 * DAMPING * SPEED * this.spin;
				this.spin += force * dt;
				this.angle += this.spin * dt;
			}
			// Passing over it on the way elsewhere should not wake it: linger a moment.
			if (near) {
				this.nearSince ??= now;
				if (now - this.nearSince > 180) this.wake();
			} else {
				this.nearSince = null;
			}
		} else if (this.state === 'homing') {
			// Always swing home first, so the eyes open on the slash's own lean.
			const off = turn(-this.angle);
			this.spin += (170 * off - 18 * this.spin) * dt;
			this.angle += this.spin * dt;
			const settled = Math.abs(off) < 0.5 && Math.abs(this.spin) < 6;
			if (settled || now - this.homingSince > 900) this.homed();
		} else if (this.state === 'awake') {
			if (far && !this.pending && !this.engaged) {
				this.farSince ??= now;
				if (now - this.farSince > 1600) this.rest();
			} else {
				this.farSince = null;
			}
			if (!this.pending && !calm() && now > this.nextBlink) {
				if (this.nextBlink) this.enqueue(() => this.blink());
				this.nextBlink = now + 2600 + Math.random() * 2600;
			}
		}

		// Awake, the eyes keep following you a little.
		const glance = this.state === 'awake' && pointer.active && !this.pending && !calm();
		const lookX = glance ? clamp(dx / (radius * 3), -1, 1) * 5 : 0;
		const lookY = glance ? clamp(dy / (radius * 3), -1, 1) * 3 : 0;
		this.look.x += (lookX - this.look.x) * Math.min(1, dt * 9);
		this.look.y += (lookY - this.look.y) * Math.min(1, dt * 9);
		this.render();
	}

	/** Wake up. Resolves once the eyes are open. */
	wake() {
		if (this.state === 'compass') {
			this.state = 'homing';
			this.homingSince = performance.now();
			// Off screen or in reduced motion there is no swing to watch.
			if (calm() || !this.visible) this.homed();
		}
		if (this.state === 'awake') return Promise.resolve();
		return new Promise((resolve) => this.waiters.push(resolve));
	}
	homed() {
		this.angle = 0;
		this.spin = 0;
		this.state = 'waking';
		this.enqueue(async () => {
			// One block draws in, holds a beat, then divides into eyes.
			await this.both({ len: EYE.len, cy: EYE.cy }, 420, ease.inOut);
			await wait(130);
			await this.both({ dx: 0 }, 380, ease.back);
			this.state = 'awake';
			this.farSince = null;
			this.nextBlink = 0;
			for (const resolve of this.waiters.splice(0)) resolve();
			await wait(140);
			await this.blink();
		});
	}
	/** Go back to the compass. */
	rest() {
		return this.enqueue(async () => {
			if (this.state !== 'awake') return;
			this.state = 'resting';
			await this.each(
				{ dx: NEEDLE.l.dx, cy: EYE.cy, len: EYE.len },
				{ dx: NEEDLE.r.dx, cy: EYE.cy, len: EYE.len },
				300,
				ease.inOut
			);
			await wait(80);
			await this.each(NEEDLE.l, NEEDLE.r, 520, ease.inOut);
			this.state = 'compass';
			// Someone asked for it while it was settling down.
			if (this.waiters.length) this.wake();
		});
	}

	/** Play one expression: 'pass', 'warn', 'fail' or 'surprise'. Wakes first. */
	async express(name) {
		await this.wake();
		return this.enqueue(async () => {
			if (this.state !== 'awake') return;
			await this[name]();
			await this.both(EYE, 240, ease.inOut);
		});
	}
	/** Stream the bars through the window until the returned function is called. */
	work() {
		this.working = true;
		this.enqueue(async () => {
			const stream = async (side, delay) => {
				await wait(delay);
				while (this.working && this.state === 'awake' && !calm()) {
					await this.tween(side, { cy: -40, len: 40 }, 380, ease.in);
					this.model[side].cy = 140;
					await this.tween(side, { cy: EYE.cy, len: EYE.len }, 420, ease.out);
					await wait(90);
				}
			};
			await Promise.all([stream('l', 0), stream('r', 170)]);
			await this.both(EYE, 200, ease.inOut);
		});
		return () => {
			this.working = false;
			return this.queue;
		};
	}

	async blink() {
		if (this.state !== 'awake') return;
		await this.both({ len: 2 }, 90, ease.in);
		await this.both({ len: EYE.len }, 160, ease.out);
	}
	async surprise() {
		await this.both({ len: 40, cy: 44 }, 180, ease.back);
		await wait(600);
	}
	// A nod, then wide eyes.
	async pass() {
		for (let i = 0; i < 2; i++) {
			await this.both({ cy: 53, len: 20 }, 130, ease.inOut);
			await this.both({ cy: EYE.cy, len: EYE.len }, 170, ease.out);
		}
		await this.both({ len: 32, cy: 43 }, 200, ease.back);
		await wait(500);
	}
	// One eye narrows, the other lifts: not sure about this.
	async warn() {
		await Promise.all([
			this.tween('l', { len: 8, cy: 47 }, 240, ease.inOut),
			this.tween('r', { len: 34, cy: 41 }, 240, ease.back),
		]);
		await wait(900);
	}
	// Eyes shut, a shake of the head, then a droop.
	async fail() {
		await this.both({ len: 7 }, 140, ease.in);
		for (let i = 0; i < 3; i++) {
			await this.both({ dx: -5 }, 80, ease.inOut);
			await this.both({ dx: 5 }, 80, ease.inOut);
		}
		await this.both({ dx: 0, cy: 52 }, 200, ease.out);
		await wait(600);
	}
}

/**
 * Turn an empty <svg> into a live Alfred.
 * @param {SVGSVGElement} svg
 */
export function createAlfred(svg) {
	if (!actors.size) listen();
	const actor = new Alfred(svg);
	actors.add(actor);
	return actor;
}
