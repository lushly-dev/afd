// The components used together, for the review sheet: six screens an AFD
// application would have. The markup is what an application would write.
// Nothing here is styled beyond layout, so what you see is the theme.

const icon = (name) => `<violet-icon decorative icon="system/${name}" label slot="before"></violet-icon>`;
const text = (variant, body, tone = 'default', as = 'span') =>
	`<violet-text as="${as}" tone="${tone}" variant="${variant}">${body}</violet-text>`;

const task = (title, who, state, color, done, checked = false) => `
	<violet-card appearance="outline" padding="medium">
		<div class="spread">
			<violet-checkbox ${checked ? 'checked' : ''} name="done" value="${title}">${title}<span slot="supporting">${done}</span></violet-checkbox>
			<div class="row">
				<violet-badge appearance="subtle" color="${color}" size="sm">${state}</violet-badge>
				<violet-persona label="${who}" size="sm"></violet-persona>
			</div>
		</div>
	</violet-card>`;

export const screens = [
	{
		title: 'A form',
		note: 'Fields, choices and the three weights of button.',
		html: `
			<div class="stack">
				${text('title-sm', 'New command', 'default', 'h3')}
				<violet-text-field label="Name" name="name" value="todo-create" supporting-text="Lower case, a domain and an action."></violet-text-field>
				<violet-text-area label="What it does" name="description" rows="3" placeholder="One sentence an agent can act on"></violet-text-area>
				<violet-text-field label="Owner" name="owner" invalid value="nobody" error-text="Choose someone on the team." supporting-text="Choose someone on the team."></violet-text-field>
				<violet-radio-group label="Who can run it" name="who" orientation="vertical" value="both">
					<violet-radio name="who" value="both" checked>People and agents<span slot="supporting">The same command, from the app or over MCP.</span></violet-radio>
					<violet-radio name="who" value="people">People only</violet-radio>
				</violet-radio-group>
				<violet-switch checked name="ask" value="yes">Ask before it runs<span slot="supporting">An agent waits for a person to approve.</span></violet-switch>
				<violet-checkbox name="undo" value="yes" checked>It can be undone</violet-checkbox>
				<violet-checkbox name="batch" value="yes">It can run in a batch</violet-checkbox>
				<div class="spread">
					<violet-button appearance="danger" type="button">Delete</violet-button>
					<div class="row">
						<violet-button appearance="quiet" type="button">Cancel</violet-button>
						<violet-button appearance="secondary" type="button">Save draft</violet-button>
						<violet-button appearance="primary" type="button">Create command</violet-button>
					</div>
				</div>
			</div>`,
	},
	{
		title: 'A list',
		note: 'A screen of records: where you are, how to filter, the rows, the pages.',
		html: `
			<div class="stack">
				<violet-breadcrumb label="Where you are">
					<violet-breadcrumb-item href="#">Workspace</violet-breadcrumb-item>
					<violet-breadcrumb-item href="#">Launch</violet-breadcrumb-item>
					<violet-breadcrumb-item current>Tasks</violet-breadcrumb-item>
				</violet-breadcrumb>
				<div class="spread">
					${text('title-md', 'Tasks', 'default', 'h3')}
					<div class="row">
						<violet-icon-button appearance="quiet" label="Sort" type="button"><violet-icon decorative icon="system/sort-ascending" label></violet-icon></violet-icon-button>
						<violet-icon-button appearance="secondary" label="Settings" type="button"><violet-icon decorative icon="system/settings" label></violet-icon></violet-icon-button>
						<violet-button appearance="primary" type="button">New task</violet-button>
					</div>
				</div>
				<div class="spread">
					<violet-segmented-control label="Show" name="show" value="open">
						<violet-segment checked value="open">Open</violet-segment>
						<violet-segment value="mine">Mine</violet-segment>
						<violet-segment value="done">Done</violet-segment>
					</violet-segmented-control>
					<violet-text-field class="grow" label="Find" name="find" placeholder="Find a task" type="search">${icon('search')}</violet-text-field>
				</div>
				${task('Write the launch note', 'Mara Okafor', 'In review', 'accent', 'Due Friday')}
				${task('Check the pricing page', 'Agent', 'Waiting on you', 'warning', 'An agent asked for approval')}
				${task('Send the invoices', 'Jon Reyes', 'Done', 'success', 'Finished this morning', true)}
				${task('Renew the domain', 'Mara Okafor', 'Overdue', 'danger', 'Was due Monday')}
				<violet-progress label="This week" max="8" value="5" value-text="5 of 8 done"></violet-progress>
				<violet-pagination boundary-count="1" label="Pages of tasks" page="2" page-count="7" sibling-count="1"></violet-pagination>
			</div>`,
	},
	{
		title: 'An agent at work',
		note: 'A conversation where the agent thinks, calls a command and asks first.',
		html: `
			<div class="stack">
				<violet-conversation-thread class="thread">
					<violet-message message-role="user"><violet-message-text state="done">Move the launch to Thursday and tell the team.</violet-message-text></violet-message>
					<violet-message message-role="assistant">
						<violet-reasoning-block label="Thinking" state="done">Three tasks depend on the launch date. Moving it changes their due dates, so I should show what changes before I do it.</violet-reasoning-block>
						<violet-tool-call-card state="output-available" tool-call-id="call-1" tool-name="task-list"></violet-tool-call-card>
						<violet-tool-result-card expanded state="output-available"><span slot="summary">3 tasks depend on the launch</span><div>Write the launch note, Check the pricing page, Send the invoices</div></violet-tool-result-card>
						<violet-message-text state="done">Three tasks move with it. I need your approval to change them.</violet-message-text>
						<violet-approval-card state="pending"><span slot="summary">Move the launch and 3 tasks to Thursday.</span><span slot="detail">Runs launch-reschedule. It can be undone.</span></violet-approval-card>
						<violet-tool-call-card state="approval-requested" tool-call-id="call-2" tool-name="launch-reschedule"></violet-tool-call-card>
					</violet-message>
				</violet-conversation-thread>
				<violet-source-citation href="#" index="1" source-title="Launch plan, section 2" type="document"></violet-source-citation>
				<violet-chat-suggestions orientation="horizontal">
					<span role="button" tabindex="0">Show what changes</span>
					<span role="button" tabindex="0">Draft the note to the team</span>
				</violet-chat-suggestions>
				<violet-chat-composer label="Message" placeholder="Ask the agent" status="ready"></violet-chat-composer>
			</div>`,
	},
	{
		title: 'What happened',
		note: 'How the application tells you: the four tones, waiting, and nothing yet.',
		html: `
			<div class="stack">
				<violet-alert tone="success"><span slot="title">Launch moved to Thursday</span>Three tasks moved with it.<span slot="actions"><violet-button appearance="secondary" type="button">Undo</violet-button></span></violet-alert>
				<violet-alert tone="warning"><span slot="title">One task is now overdue</span>Renew the domain was due Monday.</violet-alert>
				<violet-alert tone="danger" dismissible><span slot="title">The note was not sent</span>Mail is not connected. Connect it and send again.<span slot="actions"><violet-button appearance="secondary" type="button">Connect mail</violet-button></span></violet-alert>
				<violet-alert tone="default"><span slot="title">An agent is working here</span>It will ask before it changes anything.</violet-alert>
				<div class="row">
					<violet-spinner label="Saving" size="sm"></violet-spinner>${text('body', 'Saving your changes', 'secondary')}
				</div>
				<violet-progress label="Importing tasks" max="100" value="64"></violet-progress>
				<violet-skeleton animated aria-hidden="true" lines="3" shape="text" size="md"></violet-skeleton>
				<violet-empty-state appearance="outline" heading="No tasks yet" message="Create one, or ask an agent to plan the week." orientation="vertical">
					<violet-button appearance="primary" slot="actions" type="button">New task</violet-button>
				</violet-empty-state>
			</div>`,
	},
	{
		title: 'Finding your way',
		note: 'Tabs, sections that open, a tree, and a menu.',
		html: `
			<div class="stack">
				<violet-tabs appearance="open">
					<violet-tab>Overview</violet-tab>
					<violet-tab-panel>${text('body', 'The launch is on Thursday. Three tasks are open and one is overdue.', 'default', 'p')}</violet-tab-panel>
					<violet-tab>Activity</violet-tab>
					<violet-tab-panel>${text('body', 'An agent moved the launch at 10:42.', 'default', 'p')}</violet-tab-panel>
					<violet-tab>Commands</violet-tab>
					<violet-tab-panel>${text('body', 'Twelve commands, each usable by a person or an agent.', 'default', 'p')}</violet-tab-panel>
				</violet-tabs>
				<violet-accordion expand-mode="multi">
					<violet-accordion-item expanded heading-level="4"><span slot="heading">Who can see this</span>Everyone in the workspace, and the agents they have added.</violet-accordion-item>
					<violet-accordion-item heading-level="4"><span slot="heading">What an agent may do</span>Read tasks. Ask before it changes one.</violet-accordion-item>
				</violet-accordion>
				<violet-tree appearance="framed" label="Workspace">
					<violet-tree-item expanded value="launch">Launch
						<violet-tree-item slot="item" value="tasks">Tasks</violet-tree-item>
						<violet-tree-item slot="item" value="notes">Notes</violet-tree-item>
					</violet-tree-item>
					<violet-tree-item value="archive">Archive</violet-tree-item>
				</violet-tree>
				<div class="row">
					<violet-menu label="Task actions">
						<violet-button appearance="secondary" aria-haspopup="menu" slot="trigger" type="button">Actions</violet-button>
						<violet-menu-item>${icon('search')}Find in tasks</violet-menu-item>
						<violet-menu-item>${icon('sort-ascending')}Sort by date</violet-menu-item>
						<hr>
						<violet-menu-item disabled>Archive</violet-menu-item>
					</violet-menu>
					<violet-tooltip content="Runs task-export" positioning="above"><violet-button appearance="quiet" type="button">Export</violet-button></violet-tooltip>
				</div>
			</div>`,
	},
	{
		title: 'Asking first',
		note: 'A dialog, a choice from a list, and a date. Open the dialog to see it over the page.',
		html: `
			<div class="stack">
				<div class="row">
					<violet-button appearance="primary" data-opens="confirm" type="button">Open the dialog</violet-button>
				</div>
				<violet-dialog data-dialog="confirm" padding="medium" type="alert">
					<span slot="title">Move the launch to Thursday?</span>
					<p class="plain">Three tasks move with it. You can undo this.</p>
					<div class="row end" slot="footer">
						<violet-button appearance="secondary" data-closes type="button">Not now</violet-button>
						<violet-button appearance="primary" data-closes type="button">Move it</violet-button>
					</div>
				</violet-dialog>
				<violet-select label="Assign to" name="assignee" placeholder="Choose someone" value="mara">
					<violet-option value="mara" selected>Mara Okafor<span slot="description">Leads the launch</span></violet-option>
					<violet-option value="jon">Jon Reyes<span slot="description">Finance</span></violet-option>
					<violet-option value="agent">An agent<span slot="description">Asks before it changes anything</span></violet-option>
				</violet-select>
				<violet-listbox label="Run it from" value="mcp">
					<violet-option value="app">The app<span slot="description">A person clicks a button.</span></violet-option>
					<violet-option value="mcp" selected>MCP<span slot="description">An agent calls the command.</span></violet-option>
					<violet-option value="cli">The command line<span slot="description">A script, or you.</span></violet-option>
				</violet-listbox>
				<violet-date-picker label="Due" name="due" value="2026-11-19"></violet-date-picker>
				<violet-slider label="How sure the agent must be" max="100" min="0" name="sure" value="80"></violet-slider>
			</div>`,
	},
];
