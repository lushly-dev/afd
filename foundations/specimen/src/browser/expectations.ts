import type {
	A11yExpectation,
	CoverageClaim,
	FocusExpectation,
	FormExpectation,
	LayoutExpectation,
	ScenarioStep,
	StateExpectation,
	ValidityExpectation,
} from '../types.js';
import { fields, optionalText, record, text } from './validate.js';

/** Scenario support: loaded only by a case with an element expectation or a claim. */

export type ElementExpectation =
	| StateExpectation
	| FormExpectation
	| ValidityExpectation
	| (A11yExpectation & { id?: string })
	| (FocusExpectation & { id?: string })
	| (LayoutExpectation & { id?: string });

const POLL_MS = 10;
const DEFAULT_TIMEOUT_MS = 1000;

/** What an expectation found, or a description of why it did not hold. */
type Check = { ok: true; detail: unknown } | { ok: false; message: string };

/** Walk enclosing open shadow hosts to the first `formAssociated` custom element, if any. */
function formAssociatedHost(element: Element): Element | null {
	for (
		let root = element.getRootNode();
		root instanceof ShadowRoot;
		root = root.host.getRootNode()
	) {
		if (
			root.host.localName.includes('-') &&
			(root.host.constructor as { formAssociated?: boolean }).formAssociated === true
		) {
			return root.host;
		}
	}
	return null;
}

/**
 * Host-climb for `validity` (Patterns spec §3.2): walk `el` → enclosing shadow hosts until the
 * first custom element with `formAssociated === true` or a `checkValidity` method; else `el`.
 */
function validityTarget(element: Element): Element {
	let current: Element | null = element;
	while (current) {
		if (
			current.localName.includes('-') &&
			((current.constructor as { formAssociated?: boolean }).formAssociated === true ||
				typeof (current as Element & { checkValidity?: unknown }).checkValidity === 'function')
		) {
			return current;
		}
		const root = current.getRootNode();
		current = root instanceof ShadowRoot ? root.host : null;
	}
	return element;
}

/**
 * Host-climb for `layout` (Patterns spec §3.2): walk `el` → enclosing shadow hosts to the nearest
 * custom element host (tag containing `-`); if `el` is not inside a shadow root, evaluate `el`.
 */
function layoutTarget(element: Element): Element {
	for (
		let root = element.getRootNode();
		root instanceof ShadowRoot;
		root = root.host.getRootNode()
	) {
		if (root.host.localName.includes('-')) return root.host;
	}
	return element;
}

function isElementFocused(element: Element): boolean {
	let current: Element | null = document.activeElement;
	while (current) {
		if (current === element) {
			if (!current.shadowRoot?.activeElement) return true;
			return current.shadowRoot.delegatesFocus === true;
		}
		current = current.shadowRoot?.activeElement ?? null;
	}
	return false;
}

function checkState(element: Element, { target, state }: StateExpectation): Check {
	const { property, attribute, equals } = state;
	const observed = property
		? (Reflect.get(element, property) as unknown)
		: element.getAttribute(attribute as string);
	const label = property ?? `attribute ${attribute}`;
	return observed === equals || (observed !== null && String(observed) === String(equals))
		? { ok: true, detail: { [label]: observed } }
		: {
				ok: false,
				message: `Expected ${label} of '${target}' to be ${String(equals)}; it is ${String(observed)}.`,
			};
}

/** Resolve a form-associated custom element's owning form, including external `form="..."` owners. */
function ownerFormOf(host: Element): HTMLFormElement | null {
	const direct = (host as Element & { form?: HTMLFormElement | null }).form ?? null;
	if (direct instanceof HTMLFormElement) return direct;
	const root = host.getRootNode();
	if (root instanceof Document || root instanceof ShadowRoot) {
		for (const candidate of root.querySelectorAll('form')) {
			if (Array.from(candidate.elements).includes(host)) return candidate;
		}
	}
	return null;
}

/** What a form submitting now would send: real `FormData`, climbing to enclosing `formAssociated` host when needed. */
function checkForm(element: Element, { target, form: { name, value } }: FormExpectation): Check {
	let form = (element as Element & { form?: HTMLFormElement | null }).form ?? null;
	if (!form) {
		const host =
			element.localName.includes('-') &&
			(element.constructor as { formAssociated?: boolean }).formAssociated === true
				? element
				: formAssociatedHost(element);
		form = host ? ownerFormOf(host) : element.closest('form');
	}
	if (!form) return { ok: false, message: `'${target}' is not in a form.` };
	const entry = new FormData(form).get(name);
	return entry === value
		? { ok: true, detail: { [name]: entry } }
		: {
				ok: false,
				message: `Expected form entry '${name}' to be ${String(value)}; it is ${String(entry)}.`,
			};
}

function checkValidity(element: Element, { target, validity }: ValidityExpectation): Check {
	const subject = validityTarget(element);
	const check = (subject as Element & { checkValidity?: () => boolean }).checkValidity;
	if (typeof check !== 'function')
		return { ok: false, message: `'${target}' has no checkValidity().` };
	const valid = check.call(subject);
	return valid === validity.valid
		? { ok: true, detail: { valid } }
		: {
				ok: false,
				message: `Expected '${target}' to be ${validity.valid ? 'valid' : 'invalid'}; it is not.`,
			};
}

function checkFocus(element: Element, { target, focus }: FocusExpectation): Check {
	const focused = isElementFocused(element);
	return focused === focus
		? { ok: true, detail: { focused } }
		: {
				ok: false,
				message: `Expected '${target}' ${focus ? 'to have focus' : 'not to have focus'}; it ${focused ? 'is' : 'is not'} focused.`,
			};
}

function checkLayout(
	element: Element,
	{ target, layout }: LayoutExpectation,
	mountRoot?: Element
): Check {
	const subject = layoutTarget(element);
	const rect = subject.getBoundingClientRect();
	if (layout.minHeight !== undefined && rect.height < layout.minHeight) {
		return {
			ok: false,
			message: `Expected '${target}' height (${rect.height}px) to be at least ${layout.minHeight}px.`,
		};
	}
	if (layout.minWidth !== undefined && rect.width < layout.minWidth) {
		return {
			ok: false,
			message: `Expected '${target}' width (${rect.width}px) to be at least ${layout.minWidth}px.`,
		};
	}
	if (layout.noOverflow !== undefined) {
		const containerRect = mountRoot?.getBoundingClientRect();
		const minLeft = containerRect ? containerRect.left : 0;
		const maxRight = containerRect ? containerRect.right : innerWidth;
		const internalOverflow = subject.scrollWidth > subject.clientWidth + 1;
		const outsideContainer = rect.left < minLeft - 1 || rect.right > maxRight + 1;
		const overflows = internalOverflow || outsideContainer;
		if (layout.noOverflow && overflows) {
			return {
				ok: false,
				message: `Expected '${target}' to fit without horizontal overflow (scrollWidth=${subject.scrollWidth}, clientWidth=${subject.clientWidth}, rect=[${rect.left.toFixed(1)}, ${rect.right.toFixed(1)}], bounds=[${minLeft.toFixed(1)}, ${maxRight.toFixed(1)}]).`,
			};
		}
		if (!layout.noOverflow && !overflows) {
			return {
				ok: false,
				message: `Expected '${target}' to overflow horizontally; it fit within bounds.`,
			};
		}
	}
	if (layout.noOuterMargin !== undefined) {
		const style = getComputedStyle(subject);
		const margins = [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft].map(
			(value) => Number.parseFloat(value) || 0
		);
		const zeroMargins = margins.every((value) => Math.abs(value) === 0);
		if (layout.noOuterMargin && !zeroMargins) {
			return {
				ok: false,
				message: `Expected '${target}' outer margins to be 0; got [${margins.join(', ')}]px.`,
			};
		}
		if (!layout.noOuterMargin && zeroMargins) {
			return {
				ok: false,
				message: `Expected '${target}' to have non-zero outer margin; all margins are 0.`,
			};
		}
	}
	return {
		ok: true,
		detail: {
			width: rect.width,
			height: rect.height,
			scrollWidth: subject.scrollWidth,
			clientWidth: subject.clientWidth,
		},
	};
}

/** Hold an expectation about an element, allowing it the same second an event expectation has. */
export async function expectOf(
	element: Element,
	expectation: Exclude<ElementExpectation, A11yExpectation & { id?: string }>,
	mountRoot?: Element
): Promise<unknown> {
	const check = (): Check =>
		'state' in expectation
			? checkState(element, expectation)
			: 'form' in expectation
				? checkForm(element, expectation)
				: 'validity' in expectation
					? checkValidity(element, expectation)
					: 'focus' in expectation
						? checkFocus(element, expectation)
						: checkLayout(element, expectation, mountRoot);
	const deadline = performance.now() + (expectation.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	for (;;) {
		const result = check();
		if (result.ok) return result.detail;
		if (performance.now() >= deadline) throw new Error(result.message);
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
}

const OBLIGATION =
	/^(?:default|property:.+=.+|slot:.+=(?:filled|empty)|event:.+|command:.+|form:(?:participation|validity)|guide:[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)$/;

const A11Y_FIELDS = new Set([
	'role',
	'name',
	'nameNonEmpty',
	'nameContains',
	'expanded',
	'selected',
	'checked',
	'pressed',
	'disabled',
	'invalid',
	'readonly',
	'required',
	'level',
]);
const LAYOUT_FIELDS = new Set(['minHeight', 'minWidth', 'noOverflow', 'noOuterMargin']);

/** A state, form, validity, a11y, focus or layout expectation, on a declared target. */
export function elementExpectation(
	expectation: Record<string, unknown>,
	availableTargets: Record<string, unknown>,
	path: string
): ElementExpectation {
	fields(
		expectation,
		new Set(['target', 'state', 'form', 'validity', 'a11y', 'focus', 'layout', 'timeoutMs']),
		path
	);
	const target = text(expectation.target, `${path}.target`);
	if (!Object.hasOwn(availableTargets, target))
		throw new Error(`${path}.target refers to undeclared target '${target}'.`);
	const kinds = ['state', 'form', 'validity', 'a11y', 'focus', 'layout'].filter((kind) =>
		Object.hasOwn(expectation, kind)
	);
	if (kinds.length !== 1)
		throw new Error(`${path} needs one of event, state, form, validity, a11y, focus or layout.`);
	const timeoutMs = expectation.timeoutMs;
	if (timeoutMs !== undefined) {
		const portableKind = kinds[0] === 'a11y' || kinds[0] === 'focus' || kinds[0] === 'layout';
		if (portableKind) {
			if (
				typeof timeoutMs !== 'number' ||
				!Number.isInteger(timeoutMs) ||
				timeoutMs < 1 ||
				timeoutMs > 60_000
			)
				throw new Error(`${path}.timeoutMs must be an integer between 1 and 60000.`);
		} else if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
			throw new Error(`${path}.timeoutMs must be a finite number of milliseconds.`);
		}
	}
	const common = { target, ...(timeoutMs === undefined ? {} : { timeoutMs }) };
	if (kinds[0] === 'state') {
		const state = record(expectation.state, `${path}.state`);
		fields(state, new Set(['property', 'attribute', 'equals']), `${path}.state`);
		const property = optionalText(state.property, `${path}.state.property`);
		const attribute = optionalText(state.attribute, `${path}.state.attribute`);
		if ((property === undefined) === (attribute === undefined))
			throw new Error(`${path}.state needs a property or an attribute, not both.`);
		if (!Object.hasOwn(state, 'equals')) throw new Error(`${path}.state needs equals.`);
		return {
			...common,
			state: {
				...(property === undefined ? {} : { property }),
				...(attribute === undefined ? {} : { attribute }),
				equals: state.equals as string | number | boolean | null,
			},
		};
	}
	if (kinds[0] === 'form') {
		const form = record(expectation.form, `${path}.form`);
		fields(form, new Set(['name', 'value']), `${path}.form`);
		if (form.value !== null && typeof form.value !== 'string')
			throw new Error(`${path}.form.value must be a string, or null for no entry.`);
		return { ...common, form: { name: text(form.name, `${path}.form.name`), value: form.value } };
	}
	if (kinds[0] === 'validity') {
		const validity = record(expectation.validity, `${path}.validity`);
		fields(validity, new Set(['valid']), `${path}.validity`);
		if (typeof validity.valid !== 'boolean')
			throw new Error(`${path}.validity.valid must be a boolean.`);
		return { ...common, validity: { valid: validity.valid } };
	}
	if (kinds[0] === 'focus') {
		if (typeof expectation.focus !== 'boolean') throw new Error(`${path}.focus must be a boolean.`);
		return { ...common, focus: expectation.focus };
	}
	if (kinds[0] === 'layout') {
		const layout = record(expectation.layout, `${path}.layout`);
		fields(layout, LAYOUT_FIELDS, `${path}.layout`);
		if (Object.keys(layout).length === 0)
			throw new Error(`${path}.layout must assert at least one property.`);
		for (const key of ['minHeight', 'minWidth'] as const) {
			const value = layout[key];
			if (
				value !== undefined &&
				(typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 8192)
			)
				throw new Error(`${path}.layout.${key} must be a positive number <= 8192.`);
		}
		for (const key of ['noOverflow', 'noOuterMargin'] as const) {
			if (layout[key] !== undefined && typeof layout[key] !== 'boolean')
				throw new Error(`${path}.layout.${key} must be a boolean.`);
		}
		return { ...common, layout: layout as LayoutExpectation['layout'] };
	}
	const a11y = record(expectation.a11y, `${path}.a11y`);
	fields(a11y, A11Y_FIELDS, `${path}.a11y`);
	if (Object.keys(a11y).length === 0)
		throw new Error(`${path}.a11y must assert at least one property.`);
	if (
		a11y.name !== undefined &&
		(a11y.nameNonEmpty !== undefined || a11y.nameContains !== undefined)
	)
		throw new Error(`${path}.a11y.name is mutually exclusive with nameNonEmpty and nameContains.`);
	if (a11y.role !== undefined) {
		if (Array.isArray(a11y.role)) {
			if (a11y.role.length === 0 || a11y.role.length > 8)
				throw new Error(`${path}.a11y.role must list 1 to 8 roles.`);
			for (let i = 0; i < a11y.role.length; i++) text(a11y.role[i], `${path}.a11y.role[${i}]`);
		} else {
			text(a11y.role, `${path}.a11y.role`);
		}
	}
	if (a11y.name !== undefined && typeof a11y.name !== 'string')
		throw new Error(`${path}.a11y.name must be a string.`);
	if (a11y.nameContains !== undefined) text(a11y.nameContains, `${path}.a11y.nameContains`);
	for (const key of [
		'nameNonEmpty',
		'expanded',
		'selected',
		'disabled',
		'readonly',
		'required',
	] as const) {
		if (a11y[key] !== undefined && typeof a11y[key] !== 'boolean')
			throw new Error(`${path}.a11y.${key} must be a boolean.`);
	}
	for (const key of ['checked', 'pressed'] as const) {
		const value = a11y[key];
		if (value !== undefined && typeof value !== 'boolean' && value !== 'mixed')
			throw new Error(`${path}.a11y.${key} must be a boolean or 'mixed'.`);
	}
	if (
		a11y.invalid !== undefined &&
		typeof a11y.invalid !== 'boolean' &&
		a11y.invalid !== 'grammar' &&
		a11y.invalid !== 'spelling'
	)
		throw new Error(`${path}.a11y.invalid must be a boolean, 'grammar', or 'spelling'.`);
	if (
		a11y.level !== undefined &&
		(typeof a11y.level !== 'number' ||
			!Number.isInteger(a11y.level) ||
			a11y.level < 1 ||
			a11y.level > 6)
	)
		throw new Error(`${path}.a11y.level must be an integer between 1 and 6.`);
	return { ...common, a11y: a11y as A11yExpectation['a11y'] };
}

/** A specimen's claims: each must name what it declares, at a point its scenario reaches. */
export function claims(
	value: unknown,
	availableTargets: Record<string, unknown>,
	declared: ScenarioStep[] | undefined
): CoverageClaim[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error('specimen.coverage must be an array of claims.');
	return value.map((item, index) => {
		const path = `specimen.coverage[${index}]`;
		const claim = record(item, path);
		fields(claim, new Set(['target', 'obligation', 'checkpoint', 'expectations']), path);
		const target = text(claim.target, `${path}.target`);
		if (!Object.hasOwn(availableTargets, target))
			throw new Error(`${path}.target refers to undeclared target '${target}'.`);
		const obligation = text(claim.obligation, `${path}.obligation`);
		if (!OBLIGATION.test(obligation))
			throw new Error(`${path}.obligation '${obligation}' is not an obligation a report can name.`);
		const checkpoint = text(claim.checkpoint, `${path}.checkpoint`);
		const steps = declared ?? [];
		const stop = steps.findIndex((step) => 'capture' in step && step.capture === checkpoint);
		if (stop === -1 && checkpoint !== 'after-run')
			throw new Error(`${path}.checkpoint '${checkpoint}' is not a checkpoint of this scenario.`);
		if (!Array.isArray(claim.expectations) || claim.expectations.length === 0)
			throw new Error(`${path}.expectations must name at least one expect step.`);
		const reached = new Set(
			steps
				.slice(0, stop === -1 ? undefined : stop)
				.flatMap((step) => ('expect' in step && step.id ? [step.id] : []))
		);
		const expectations = claim.expectations.map((id, position) => {
			const name = text(id, `${path}.expectations[${position}]`);
			if (!reached.has(name))
				throw new Error(
					`${path}.expectations refers to '${name}', which is no expect step before '${checkpoint}'.`
				);
			return name;
		});
		return { target, obligation, checkpoint, expectations };
	});
}

/** An element's tag, and the hosts it sits inside: `checkValidity` on an inner input counts. */
function tagsOf(element: Element): string[] {
	const tags = [element.localName];
	for (let root = element.getRootNode(); root instanceof ShadowRoot; root = root.host.getRootNode())
		tags.push(root.host.localName);
	return tags;
}

/**
 * Whether anything read `FormData` or checked validity, and of which elements: form evidence is
 * what ran, not what a story's source mentions. These call the real methods and change nothing.
 */
export function observeFormEvidence(): { formData: Set<string>; validity: Set<string> } {
	const formData = new Set<string>();
	const validity = new Set<string>();
	const owners = new WeakMap<object, Element>();
	const original = HTMLElement.prototype.attachInternals;
	HTMLElement.prototype.attachInternals = function (this: HTMLElement) {
		const internals = original.call(this);
		owners.set(internals, this);
		return internals;
	};
	globalThis.FormData = new Proxy(FormData, {
		construct(target, args, newTarget) {
			const form = args[0] as unknown;
			if (form instanceof HTMLFormElement)
				for (const element of form.elements) formData.add(element.localName);
			return Reflect.construct(target, args, newTarget);
		},
	});
	const watch = (prototype: object, of: (self: object) => Element[]) => {
		for (const name of ['checkValidity', 'reportValidity'] as const) {
			const method = Reflect.get(prototype, name) as (() => boolean) | undefined;
			if (!method) continue;
			Object.defineProperty(prototype, name, {
				configurable: true,
				writable: true,
				value(this: object) {
					for (const element of of(this)) for (const tag of tagsOf(element)) validity.add(tag);
					return method.call(this);
				},
			});
		}
	};
	for (const type of [HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement, HTMLButtonElement])
		watch(type.prototype, (self) => [self as Element]);
	watch(HTMLFormElement.prototype, (self) => [...(self as HTMLFormElement).elements]);
	watch(ElementInternals.prototype, (self) => {
		const owner = owners.get(self);
		return owner ? [owner] : [];
	});
	return { formData, validity };
}

/**
 * Attributes set on the given tags as the page runs, as `tag:attribute`: a play may set a state,
 * assert on it and clear it, and then a capture at its end would never see it.
 */
export function observeAttributes(tags: ReadonlySet<string>): Set<string> {
	const seen = new Set<string>();
	const { setAttribute, toggleAttribute } = Element.prototype;
	Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
		if (tags.has(this.localName) && value !== 'false') seen.add(`${this.localName}:${name}`);
		setAttribute.call(this, name, value);
	};
	Element.prototype.toggleAttribute = function (this: Element, name: string, force?: boolean) {
		const on = toggleAttribute.call(this, name, force);
		if (on && tags.has(this.localName)) seen.add(`${this.localName}:${name}`);
		return on;
	};
	return seen;
}
