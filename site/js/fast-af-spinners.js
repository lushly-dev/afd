// Ideas for the loading mark, to choose from. The ring the components draw
// today is first, for reference. Each idea is plain CSS (fast-af-spinners.css),
// drawn at the three sizes the spinner has and beside a line of text, on
// paper and on ink. Trace was chosen, and the refined candidate's patch draws it
// in violet-spinner.

const repeat = (count, html) => Array.from({ length: count }, () => html).join('');

const ideas = [
	{
		name: 'Ring',
		why: 'What the components draw today. Every product has it.',
		html: (size) => `<span class="sp sp--ring" data-size="${size}"></span>`,
	},
	{
		name: 'Slash',
		why: 'The command line’s spinner, | / – \\, and the slash in /AFD. It steps, it does not glide.',
		html: (size) => `<span class="sp sp--slash" data-size="${size}"></span>`,
	},
	{
		name: 'Trace',
		chosen: true,
		why: 'A run travels the edge of a square: the ring, redrawn in the shape of an AFD control.',
		html: (size) =>
			`<svg class="sp sp--trace" data-size="${size}" viewBox="0 0 24 24" aria-hidden="true"><rect class="sp-rest" x="3" y="3" width="18" height="18" rx="3" pathLength="100"/><rect class="sp-run" x="3" y="3" width="18" height="18" rx="3" pathLength="100"/></svg>`,
	},
	{
		name: 'Matrix',
		why: 'One lit cell chases round a three by three grid, like a terminal’s braille spinner.',
		html: (size) => `<span class="sp sp--matrix" data-size="${size}">${repeat(9, '<i></i>')}</span>`,
	},
	{
		name: 'Steps',
		why: 'Four cells fill in order and start again. Wider than it is tall, so it sits well in a line of text.',
		html: (size) => `<span class="sp sp--steps" data-size="${size}">${repeat(4, '<i></i>')}</span>`,
	},
	{
		name: 'Marks',
		why: 'The site’s crop marks, lit one corner at a time.',
		html: (size) =>
			`<svg class="sp sp--marks" data-size="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9V3h6"/><path d="M15 3h6v6"/><path d="M21 15v6h-6"/><path d="M9 21H3v-6"/></svg>`,
	},
	{
		name: 'Handoff',
		why: 'A person and an agent trade places: red and mint, the site’s two actors. The only idea that uses colour.',
		html: (size) => `<span class="sp sp--handoff" data-size="${size}"><i></i><i></i></span>`,
	},
];

const row = (idea, tone) => `
	<div class="sp-demo sp-demo--${tone}">
		<div class="sp-sizes">${[16, 24, 32].map((size) => idea.html(size)).join('')}</div>
		<p class="sp-context">${idea.html(16)}<span>Saving your changes</span></p>
	</div>`;

document.querySelector('[data-ideas]').innerHTML = ideas
	.map(
		(idea, index) => `
		<section class="sp-card" data-idea="${idea.name}">
			<header>
				<span class="mono">${index === 0 ? 'Today' : `Idea ${index}`}${idea.chosen ? ' · chosen' : ''}</span>
				<h2>${idea.name}</h2>
				<p>${idea.why}</p>
			</header>
			${row(idea, 'light')}${row(idea, 'dark')}
		</section>`
	)
	.join('');
