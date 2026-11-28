/**
 * @fileoverview The account section's personas tab (phase 3 specification, 5.1, 6.1 to 6.3 and 14), in the `account`
 * chunk with `account.ts`, which alone imports it: the person's personas, `default` first, each with its title, how
 * others see it and whether it is the one in use, in words; "Use" switches to one (`persona-set`), "Edit" changes its
 * title and how others see it (`persona-update`), "Remove" removes it after a native modal dialog says what follows
 * (`persona-remove`); and a form makes a new one (`persona-create`). Every change is a command. A persona is the
 * person's own lens: it changes what is shown first and how they look, never what anyone may do (6.2), and the tab
 * says so.
 */

import type { LoamKernel } from '@lushly-dev/loam-kernel';
import { type Answer, button, confirmIn, el } from './account-parts.js';

/** A persona as `persona-list` returns it (6.1), the fields this tab shows. */
interface PersonaRow {
	id: string;
	title: string;
	presentation: { name?: string; pronouns?: string; avatar?: string };
}

/** What the section gives this part. */
export interface PersonasView {
	kernel: LoamKernel;
	root: ShadowRoot;
	say(text: string): void;
	failed(answer: Answer): string;
	read(): Promise<void>;
}

/** 6.1's limit, `PERSONA_LIMIT` past it; the kernel decides, this only says so in place of the form. */
const PERSONA_LIMIT = 8;

/** How other members see a persona (6.1): its presentation's name, pronouns and avatar, or the person's own name. */
function shownAs(persona: PersonaRow): string {
	const { name, pronouns, avatar } = persona.presentation;
	const parts = [name ?? 'Your own name'];
	if (pronouns) parts.push(`(${pronouns})`);
	if (avatar) parts.push('with an avatar');
	return parts.join(' ');
}

/** The trimmed fields of a persona's form: empty ones left out, so `presentation` holds only what was given. */
function fieldsOf(title: HTMLInputElement, name: HTMLInputElement, pronouns: HTMLInputElement) {
	const presentation: { name?: string; pronouns?: string } = {};
	if (name.value.trim()) presentation.name = name.value.trim();
	if (pronouns.value.trim()) presentation.pronouns = pronouns.value.trim();
	return { title: title.value.trim(), presentation };
}

/**
 * A persona's form, for a new one or to edit `persona`: its title, and the name and pronouns others see. Its submit
 * button is disabled while the command runs, so a second press makes no second persona; a title of spaces alone is
 * refused here, in words. `cancel`, when given, adds a Cancel button.
 */
function personaForm(
	view: PersonasView,
	id: string,
	label: string,
	submit: string,
	persona: PersonaRow | undefined,
	run: (fields: ReturnType<typeof fieldsOf>) => Promise<void>,
	cancel?: () => void
): HTMLFormElement {
	const field = (name: string, text: string, max: string, value = '', required = false) => {
		const input = el('input', {
			id: `${id}-${name}`,
			name,
			autocomplete: 'off',
			maxlength: max,
			...(required ? { required: '' } : {}),
		}) as HTMLInputElement;
		input.value = value;
		return { input, label: el('label', { for: `${id}-${name}` }, text, input) };
	};
	const title = field('title', 'Title', '40', persona?.title, true);
	const name = field('name', 'Name others see (optional)', '80', persona?.presentation.name);
	const pronouns = field('pronouns', 'Pronouns (optional)', '40', persona?.presentation.pronouns);
	const send = el(
		'button',
		{ type: 'submit', class: 'action primary' },
		submit
	) as HTMLButtonElement;
	const controls: Node[] = [send];
	if (cancel) controls.push(button('Cancel', cancel));
	const form = el(
		'form',
		{ 'aria-label': label },
		title.label,
		name.label,
		pronouns.label,
		el('div', { class: 'row' }, ...controls)
	) as HTMLFormElement;
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (send.disabled) return;
		const fields = fieldsOf(title.input, name.input, pronouns.input);
		if (!fields.title) {
			view.say('Give the persona a title.');
			title.input.focus();
			return;
		}
		send.disabled = true;
		try {
			await run(fields);
		} finally {
			send.disabled = false;
		}
	});
	return form;
}

/** Focus a persona's row heading after the table is built again, or the table's caption when the row is gone. */
function focusRow(root: ShadowRoot, persona: string | undefined): void {
	const row =
		persona === undefined
			? null
			: [...root.querySelectorAll<HTMLElement>('th[data-persona]')].find(
					(heading) => heading.dataset.persona === persona
				);
	(row ?? root.querySelector<HTMLElement>('#personas-caption'))?.focus();
}

/** The personas tab: the table, `default` first, then the form for a new one. */
export async function personasPart(view: PersonasView): Promise<Node[]> {
	const { kernel, root } = view;
	const read = (await kernel.call('persona-list')) as Answer<{
		personas: PersonaRow[];
		active: string;
	}>;
	if (!read.success || !read.data) return [el('p', {}, view.failed(read))];
	const { personas, active } = read.data;
	const own = personas.filter((persona) => persona.id !== 'default');
	/** Read the tab again, then put focus back where the change was, since the rebuild removes what held it. */
	const after = async (persona: string | undefined) => {
		await view.read();
		focusRow(root, persona);
	};
	const nodes: Node[] = [
		el(
			'p',
			{},
			'A persona changes what Loam shows you first, your density and theme, and how others see your name. It never changes what you or your agents may do.'
		),
	];
	// The editor of one persona shows below the table while it is open, one at a time. A change heard from elsewhere,
	// such as the account menu's switch, reads the tab again and closes it.
	const editor = el('div', { class: 'editor' });
	const rows = personas.map((persona) => {
		const isDefault = persona.id === 'default';
		const title = isDefault ? 'Default' : persona.title;
		const actions: Node[] = [];
		if (persona.id !== active)
			actions.push(
				button(`Use ${title}`, async () => {
					const answer = (await kernel.call('persona-set', { persona: persona.id })) as Answer;
					// The shell announces the switch ("Persona: <title>"); the status says only a failure.
					view.say(answer.success ? '' : view.failed(answer));
					if (answer.success) await after(persona.id);
				})
			);
		if (!isDefault) {
			const edit = button(`Edit ${title}`, () => {
				editor.replaceChildren(
					personaForm(
						view,
						'persona-edit',
						`Edit ${title}`,
						'Save persona',
						persona,
						async (fields) => {
							const answer = (await kernel.call('persona-update', {
								persona: persona.id,
								title: fields.title,
								// `presentation` is replaced whole: the avatar, which this form does not show, stays. Its
								// defaults and emphasis are not sent, so they stay as they are.
								presentation: {
									...(persona.presentation.avatar ? { avatar: persona.presentation.avatar } : {}),
									...fields.presentation,
								},
							})) as Answer;
							view.say(answer.success ? `${fields.title} is saved.` : view.failed(answer));
							if (answer.success) await after(persona.id);
						},
						() => {
							editor.replaceChildren();
							edit.focus();
						}
					)
				);
				editor.querySelector<HTMLInputElement>('input')?.focus();
			});
			actions.push(
				edit,
				button(`Remove ${title}`, async () => {
					const sure = await confirmIn(
						root,
						`Remove ${title}?`,
						persona.id === active
							? `${title} is removed, and you go back to Default. Your density and theme stay as they are.`
							: `${title} is removed. You can make it again later.`,
						'Remove persona'
					);
					if (!sure) return;
					const answer = (await kernel.call('persona-remove', { persona: persona.id })) as Answer;
					view.say(answer.success ? `${title} is removed.` : view.failed(answer));
					if (answer.success) await after(undefined);
				})
			);
		}
		return el(
			'tr',
			{},
			el('th', { scope: 'row', tabindex: '-1', 'data-persona': persona.id }, title),
			el('td', {}, isDefault ? 'Your own name' : shownAs(persona)),
			// The one in use in words, never by a mark or color alone (14).
			el('td', {}, persona.id === active ? 'In use' : ''),
			el('td', {}, el('div', { class: 'row' }, ...actions))
		);
	});
	nodes.push(
		el(
			'table',
			{},
			el('caption', { id: 'personas-caption', tabindex: '-1' }, 'Your personas'),
			el(
				'thead',
				{},
				el(
					'tr',
					{},
					...['Title', 'Others see', 'State', 'Actions'].map((text) =>
						el('th', { scope: 'col' }, text)
					)
				)
			),
			el('tbody', {}, ...rows)
		),
		editor
	);
	if (own.length >= PERSONA_LIMIT) {
		nodes.push(
			el(
				'p',
				{},
				`You have ${PERSONA_LIMIT} personas, the most there can be. Remove one to make another.`
			)
		);
		return nodes;
	}
	nodes.push(
		personaForm(
			view,
			'persona-new',
			'Make a persona',
			'Make persona',
			undefined,
			async (fields) => {
				const answer = (await kernel.call('persona-create', {
					title: fields.title,
					...(Object.keys(fields.presentation).length > 0
						? { presentation: fields.presentation }
						: {}),
				})) as Answer<{ id: string }>;
				view.say(answer.success ? `${fields.title} is made.` : view.failed(answer));
				if (answer.success) await after(answer.data?.id);
			}
		)
	);
	return nodes;
}
