import assert from 'node:assert/strict';

const source = `
import { Updates } from '@microsoft/fast-element';
import './packages/violet-elements/src/button/violet-button';
import './packages/violet-elements/src/text-field/violet-text-field';
import './packages/violet-elements/src/alert/violet-alert';
import './packages/violet-elements/src/theme/violet-theme';

function mount(markup: string, afterReady?: (root: HTMLElement) => void) {
  const root = document.createElement('section');
  root.innerHTML = markup;
  root.style.cssText = 'padding:24px;max-width:800px;font:14px sans-serif';
  // Bridge the native bench context explicitly; the consumer does not know its attribute.
  const preset = document.documentElement.dataset.specimenTheme === 'dark' ? 'dark' : 'light';
  root.querySelector('violet-theme')?.setAttribute('preset', preset);
  const ready = new Promise<void>((resolve, reject) => {
    // render returns before connection; the bench appends root before this task runs.
    setTimeout(async () => {
      try {
        if (!root.isConnected) throw new Error('Fixture must be connected before FAST readiness');
        await Updates.next();
        await Updates.next();
        afterReady?.(root);
        await Updates.next();
        resolve();
      } catch (error) { reject(error); }
    }, 0);
  });
  return { element: root, ready };
}

export const SlottedButton = {
  render: () => mount('<violet-theme><violet-button><span slot="before" aria-hidden="true">+</span><span>Add plant</span></violet-button></violet-theme>'),
};

export const RequiredField = {
  render: () => mount('<violet-theme><form data-proof="form"><violet-text-field label="Plant name" name="plant" required supporting-text="Required for your garden record"></violet-text-field></form></violet-theme>', root => {
    const form = root.querySelector('form')!;
    const field = root.querySelector('violet-text-field')! as HTMLElement & { value: string; validity: ValidityState; form: HTMLFormElement };
    const proof = () => {
      form.setAttribute('data-submitted-value', String(new FormData(form).get('plant')));
      form.setAttribute('data-form-valid', String(form.checkValidity()));
      form.setAttribute('data-value-missing', String(field.validity.valueMissing));
      form.setAttribute('data-associated', String(field.form === form));
      form.setAttribute('data-host-value', field.value);
    };
    field.addEventListener('input', () => { void Updates.next().then(proof); });
    proof();
  }),
  targets: { field: { selector: 'violet-text-field input' } },
  scenario: [
    { capture: 'empty' },
    { action: { fill: 'field', value: 'Lavender' } },
    { capture: 'filled' },
  ],
};

export const ScopedTheme = {
  render: () => mount('<violet-theme><div data-theme-panel style="padding:20px;background:var(--color-surface-page);color:var(--color-text-primary)"><violet-button appearance="secondary">Scoped action</violet-button><violet-text-field label="Scoped field" value="Violet"></violet-text-field></div></violet-theme>'),
};

export const ResponsiveAlert = {
  render: () => mount('<violet-theme><violet-alert tone="warning" announcement="polite" dismissible><span slot="title">Watering paused</span><p>Your next watering is delayed until tomorrow because rain is expected.</p><violet-button slot="actions" appearance="secondary">Review schedule</violet-button></violet-alert></violet-theme>', root => {
    const alert = root.querySelector('violet-alert')!;
    alert.addEventListener('dismiss', () => root.setAttribute('data-dismissed', 'true'));
  }),
  targets: { dismiss: { selector: 'violet-alert violet-icon-button button' } },
  scenario: [
    { capture: 'visible' },
    { action: { click: 'dismiss' } },
    { capture: 'dismissed' },
  ],
};
`;

const specimens = [
	['fast-button', 'SlottedButton', 'FAST button with slotted label and icon'],
	['fast-field', 'RequiredField', 'FAST required form-associated field'],
	['fast-theme', 'ScopedTheme', 'FAST scoped runtime theme'],
	['fast-alert', 'ResponsiveAlert', 'FAST responsive dismissible alert'],
].map(([id, exportName, title]) => ({ id, title, exportName, module: './probe.ts' }));

const captures = [
	{ key: 'button', request: { id: 'fast-button' } },
	{ key: 'buttonRepeat', request: { id: 'fast-button' } },
	{ key: 'fieldEmpty', request: { id: 'fast-field', checkpoint: 'empty' } },
	{ key: 'fieldFilled', request: { id: 'fast-field', checkpoint: 'filled' } },
	{ key: 'themeLight', request: { id: 'fast-theme', context: { theme: 'light' } } },
	{ key: 'themeDark', request: { id: 'fast-theme', context: { theme: 'dark' } } },
	{
		key: 'alertDesktop',
		request: {
			id: 'fast-alert',
			checkpoint: 'visible',
			context: { viewport: { width: 1000, height: 700 } },
		},
	},
	{
		key: 'alertMobile',
		request: {
			id: 'fast-alert',
			checkpoint: 'visible',
			context: { viewport: { width: 390, height: 700 } },
		},
	},
	{ key: 'alertDismissed', request: { id: 'fast-alert', checkpoint: 'dismissed' } },
];

function element(observation, predicate, message) {
	const match = observation.channels.elements.find(predicate);
	assert.ok(match, message);
	return match;
}

function verify(captures) {
	for (const [name, observation] of Object.entries(captures)) {
		assert.match(observation.channels.dom.raw, /shadowrootmode="open"/, `${name}: real shadow DOM`);
		assert.equal(observation.channels.console.errors.length, 0, `${name}: console errors`);
	}
	const button = element(captures.button, (item) => item.tag === 'button', 'native button');
	assert.ok(button.box.width > 30, 'button has measured geometry');
	assert.match(captures.button.channels.dom.raw, /slot="before"/);
	assert.match(captures.button.channels.dom.raw, /Add plant/);
	for (const [key, value, valid] of [
		['fieldEmpty', '', false],
		['fieldFilled', 'Lavender', true],
	]) {
		const input = element(captures[key], (item) => item.tag === 'input', `${key}: native input`);
		assert.equal(input.state.value, value);
		assert.equal(input.state.valid, valid);
		assert.ok(Object.hasOwn(input.attributes, 'required'), `${key}: native required`);
		const proof = element(captures[key], (item) => item.tag === 'form', `${key}: form`);
		assert.equal(proof.attributes['data-submitted-value'], value, 'real FormData value');
		assert.equal(proof.attributes['data-host-value'], value, 'FAST host live value');
		assert.equal(proof.attributes['data-form-valid'], String(valid), 'ElementInternals validity');
		assert.equal(proof.attributes['data-value-missing'], String(!valid));
		assert.equal(proof.attributes['data-associated'], 'true', 'real form association');
	}
	const panel = (key) =>
		element(
			captures[key],
			(item) => Object.hasOwn(item.attributes, 'data-theme-panel'),
			'scoped panel'
		);
	assert.equal(panel('themeLight').styles['background-color'], 'rgb(255, 254, 250)');
	assert.equal(panel('themeDark').styles['background-color'], 'rgb(22, 23, 19)');
	assert.equal(panel('themeDark').styles.color, 'rgb(245, 239, 227)');
	const themedButton = element(
		captures.themeDark,
		(item) => item.tag === 'button',
		'dark scoped button'
	);
	assert.equal(themedButton.styles['background-color'], 'rgb(43, 45, 39)');
	const grid = (key) =>
		element(captures[key], (item) => item.attributes.part === 'layout', 'alert shadow grid');
	const desktopColumns = grid('alertDesktop').styles['grid-template-columns'];
	const mobileColumns = grid('alertMobile').styles['grid-template-columns'];
	assert.equal(desktopColumns.split(' ').length, 3, 'desktop uses three columns');
	assert.equal(mobileColumns.split(' ').length, 2, 'mobile media query uses two columns');
	assert.notEqual(desktopColumns, mobileColumns);
	assert.equal(captures.alertMobile.manifest.context.viewport.width, 390);
	element(
		captures.alertDismissed,
		(item) => item.attributes['data-dismissed'] === 'true',
		'consumer dismiss event'
	);
	return [
		'FAST custom elements expose real open shadow DOM and native slotted button content.',
		'Empty and filled checkpoints prove live input, required validity, ElementInternals and FormData.',
		'Explicit scoped theme bridge changes actual panel and shadow-button colors.',
		'Real mobile viewport activates alert media query: three columns become two; dismiss event fires.',
	];
}

export default {
	name: 'fast-af',
	paths: [
		'packages/violet-elements/src',
		'packages/violet-elements/package.json',
		'packages/violet-elements/tsconfig.lib.json',
		'tsconfig.base.wc.json',
	],
	dependencyLinks: [
		{ from: 'packages/element/packages/fast-element', to: 'node_modules/@microsoft/fast-element' },
		{ from: 'packages/element/packages/fast-element', to: 'node_modules/@lushly-dev/fast-element' },
	],
	tsconfig: {
		compilerOptions: {
			experimentalDecorators: true,
			useDefineForClassFields: false,
			target: 'ES2022',
		},
	},
	specimens,
	captures,
	source,
	verify,
};
