import type {
	CoverageClaim,
	FormExpectation,
	ScenarioStep,
	StateExpectation,
	ValidityExpectation,
} from '../types.js';
import { fields, optionalText, record, text } from './validate.js';

/** Scenario support: loaded only by a case with an element expectation or a claim. */

const POLL_MS = 10;
const DEFAULT_TIMEOUT_MS = 1000;

/** What an expectation found, or a description of why it did not hold. */
type Check = { ok: true; detail: unknown } | { ok: false; message: string };

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

/** What a form submitting now would send: real `FormData`, not what the element says of itself. */
function checkForm(element: Element, { target, form: { name, value } }: FormExpectation): Check {
	const form =
		(element as Element & { form?: HTMLFormElement | null }).form ?? element.closest('form');
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
	const check = (element as Element & { checkValidity?: () => boolean }).checkValidity;
	if (typeof check !== 'function')
		return { ok: false, message: `'${target}' has no checkValidity().` };
	const valid = check.call(element);
	return valid === validity.valid
		? { ok: true, detail: { valid } }
		: {
				ok: false,
				message: `Expected '${target}' to be ${validity.valid ? 'valid' : 'invalid'}; it is not.`,
			};
}

/** Hold an expectation about an element, allowing it the same second an event expectation has. */
export async function expectOf(
	element: Element,
	expectation: StateExpectation | FormExpectation | ValidityExpectation
): Promise<unknown> {
	const check = (): Check =>
		'state' in expectation
			? checkState(element, expectation)
			: 'form' in expectation
				? checkForm(element, expectation)
				: checkValidity(element, expectation);
	const deadline = performance.now() + (expectation.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	for (;;) {
		const result = check();
		if (result.ok) return result.detail;
		if (performance.now() >= deadline) throw new Error(result.message);
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
}

const OBLIGATION =
	/^(?:default|property:.+=.+|slot:.+=(?:filled|empty)|event:.+|command:.+|form:(?:participation|validity))$/;

/** A state, form or validity expectation, on a declared target. */
export function elementExpectation(
	expectation: Record<string, unknown>,
	availableTargets: Record<string, unknown>,
	path: string
): StateExpectation | FormExpectation | ValidityExpectation {
	fields(expectation, new Set(['target', 'state', 'form', 'validity', 'timeoutMs']), path);
	const target = text(expectation.target, `${path}.target`);
	if (!Object.hasOwn(availableTargets, target))
		throw new Error(`${path}.target refers to undeclared target '${target}'.`);
	const timeoutMs = expectation.timeoutMs;
	if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || timeoutMs < 0))
		throw new Error(`${path}.timeoutMs must be a number of milliseconds.`);
	const common = { target, ...(timeoutMs === undefined ? {} : { timeoutMs }) };
	const kinds = ['state', 'form', 'validity'].filter((kind) => Object.hasOwn(expectation, kind));
	if (kinds.length !== 1) throw new Error(`${path} needs one of event, state, form or validity.`);
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
	const validity = record(expectation.validity, `${path}.validity`);
	fields(validity, new Set(['valid']), `${path}.validity`);
	if (typeof validity.valid !== 'boolean')
		throw new Error(`${path}.validity.valid must be a boolean.`);
	return { ...common, validity: { valid: validity.valid } };
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
