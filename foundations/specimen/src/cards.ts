import { createHash, randomBytes } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { designCardRecordSchema } from './card-schema.js';
import {
	CARD_ID_LENGTH,
	CARD_ID_PATTERN,
	CARDS_DIR,
	type CardSeverity,
	type CardUnmeasuredEntry,
	type DesignCardListRequest,
	type DesignCardListResult,
	type DesignCardRecord,
	type DesignCardSummary,
} from './card-types.js';
import { parseDesignCardListRequest } from './card-validate.js';
import { compareCodeUnits, typedError } from './decisions-store.js';
import type { SpecimenHostError } from './host.js';
import { assertRealContained, assertRealFileContained, writeFileAtomic } from './sets.js';

export const CARDS_PAGE_FILE = 'cards.html';

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';
const DEFAULT_CARD_LIMIT = 10;
const SEVERITY_RANK: Record<CardSeverity, number> = {
	blocker: 0,
	major: 1,
	minor: 2,
};

export function generateCardId(): string {
	const bytes = randomBytes(CARD_ID_LENGTH);
	let suffix = '';
	for (let i = 0; i < CARD_ID_LENGTH; i++) {
		suffix += CROCKFORD[(bytes[i] ?? 0) & 31];
	}
	return `card-${suffix}`;
}

export function cardNotFoundError(cardId: string): SpecimenHostError {
	return typedError(
		'CARD_NOT_FOUND',
		`Decision card not found: ${cardId}`,
		'Run design-card-list to see current decision card ids.',
		{ card: cardId }
	);
}

export function cardsDir(root: string): string {
	return join(resolve(root), CARDS_DIR);
}

export function cardFilePath(root: string, cardId: string): string {
	return join(cardsDir(root), `${cardId}.json`);
}

export function cardRelativePath(cardId: string): string {
	return `specimens/cards/${cardId}.json`;
}

function stableCanonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((item) => stableCanonicalJson(item)).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => compareCodeUnits(a, b));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableCanonicalJson(v)}`).join(',')}}`;
}

/**
 * Compute a deterministic sha256 digest of a card's reviewed proposal content.
 * Used to bind HumanRelay confirmation to the exact card content shown to the person,
 * failing closed with `STALE_CARD` if the card mutates before confirmation completes.
 */
export function computeCardDigest(card: DesignCardRecord): string {
	const canonical = {
		card: card.card,
		run: card.run ?? null,
		scope: card.scope,
		what: card.what,
		owner: card.owner,
		touches: card.touches,
		severity: card.severity,
		visual: card.visual,
		why: card.why,
		effect: card.effect,
		risk: card.risk,
		changeSignature: card.changeSignature ?? null,
		patternAction: card.patternAction ?? null,
	};
	return `sha256:${createHash('sha256').update(stableCanonicalJson(canonical), 'utf8').digest('hex')}`;
}

/** Persist a validated decision card record under `specimens/cards/<card>.json`. */
export async function writeCardRecord(root: string, record: DesignCardRecord): Promise<string> {
	const parsed = designCardRecordSchema.safeParse(record);
	if (!parsed.success) {
		throw typedError(
			'VALIDATION_ERROR',
			`Invalid decision card record '${record.card}': ${parsed.error.message}`,
			'Provide a card matching designCardRecordSchema.'
		);
	}
	const dir = cardsDir(root);
	await assertRealContained(root, dir, `Cards directory escapes workspace root: ${dir}`);
	await mkdir(dir, { recursive: true });
	const filePath = cardFilePath(root, parsed.data.card);
	await assertRealContained(root, filePath, `Card file escapes workspace root: ${filePath}`);
	await writeFileAtomic(filePath, `${JSON.stringify(parsed.data, null, '\t')}\n`);
	return cardRelativePath(parsed.data.card);
}

/** Read and validate one persisted decision card under `specimens/cards/<card>.json`. */
export async function readCardRecord(root: string, cardId: string): Promise<DesignCardRecord> {
	const trimmed = cardId.trim();
	if (!CARD_ID_PATTERN.test(trimmed)) {
		throw typedError(
			'CARD_NOT_FOUND',
			`Decision card not found: ${trimmed}`,
			'Run design-card-list to see current decision card ids.',
			{ card: trimmed }
		);
	}
	const filePath = cardFilePath(root, trimmed);
	let rawText: string;
	try {
		await assertRealFileContained(root, filePath, `Card file escapes workspace root: ${trimmed}`);
		rawText = await readFile(filePath, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			throw typedError(
				'CARD_NOT_FOUND',
				`Decision card not found: ${trimmed}`,
				'Run design-card-list to see current decision card ids.',
				{ card: trimmed }
			);
		}
		throw error;
	}
	let raw: unknown;
	try {
		raw = JSON.parse(rawText);
	} catch {
		throw typedError(
			'VALIDATION_ERROR',
			`Decision card '${trimmed}' contains invalid JSON.`,
			'Inspect or regenerate the card file under specimens/cards/.'
		);
	}
	const parsed = designCardRecordSchema.safeParse(raw);
	if (!parsed.success) {
		throw typedError(
			'VALIDATION_ERROR',
			`Decision card '${trimmed}' failed schema validation: ${parsed.error.message}`,
			'Inspect or regenerate the card file under specimens/cards/.'
		);
	}
	return parsed.data;
}

/** Read all decision card records under `specimens/cards/` (including confined symlinks). */
export async function readAllCards(root: string): Promise<DesignCardRecord[]> {
	const dir = cardsDir(root);
	let entries: Dirent[];
	try {
		await assertRealContained(root, dir, `Cards directory escapes workspace root: ${dir}`);
		entries = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
	const ids = entries
		.filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.json'))
		.map((e) => e.name.slice(0, -5))
		.filter((id) => CARD_ID_PATTERN.test(id))
		.sort(compareCodeUnits);

	const cards: DesignCardRecord[] = [];
	for (const id of ids) {
		cards.push(await readCardRecord(root, id));
	}
	return cards;
}

function toCardSummary(record: DesignCardRecord): DesignCardSummary {
	return {
		card: record.card,
		...(record.run !== undefined ? { run: record.run } : {}),
		what: record.what,
		owner: record.owner,
		touches: record.touches,
		severity: record.severity,
		visual: record.visual,
		why: record.why,
		effect: record.effect,
		risk: record.risk,
		status: record.status,
	};
}

function defaultCardUnmeasured(): CardUnmeasuredEntry[] {
	return [
		{
			area: 'forced-colors',
			reason: 'Forced-colors (high-contrast OS mode) rendering is not evaluated by card queues.',
			addToMeasure: 'Run specimen-themes or high-contrast Specimen captures before release.',
		},
		{
			area: 'motion',
			reason: 'Reduced-motion transition comfort is not evaluated by card queues.',
			addToMeasure: 'Run Specimen captures with reducedMotion: reduce.',
		},
	];
}

function buildCardsPageUrl(request: DesignCardListRequest): string {
	const params = new URLSearchParams();
	const card = request.card?.trim();
	if (card) {
		params.set('card', card);
	} else {
		params.set('scope', request.scope ?? 'all');
		if (request.status) params.set('status', request.status);
		if (request.severity) params.set('severity', request.severity);
		if (request.includeProvisional) params.set('includeProvisional', 'true');
		if (request.includeDecided) params.set('includeDecided', 'true');
	}
	return `${CARDS_PAGE_FILE}?${params.toString()}`;
}

function compareCards(
	a: { severity: CardSeverity; card: string },
	b: { severity: CardSeverity; card: string }
): number {
	const sevDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
	if (sevDiff !== 0) return sevDiff;
	return compareCodeUnits(a.card, b.card);
}

/**
 * List pre-ship decision cards sorted by severity (`blocker` -> `major` -> `minor`) and id,
 * paged by cursor (`limit`, `after`, `next`), excluding provisional and withdrawn cards by default.
 */
export async function listDesignCards(
	root: string,
	rawRequest: DesignCardListRequest = {}
): Promise<DesignCardListResult> {
	const request = parseDesignCardListRequest(rawRequest);
	const page = buildCardsPageUrl(request);
	const unmeasured = defaultCardUnmeasured();

	if (request.card !== undefined) {
		const single = await readCardRecord(root, request.card.trim());
		return {
			page,
			cards: [toCardSummary(single)],
			total: 1,
			more: 0,
			unmeasured,
		};
	}

	const allCards = await readAllCards(root);
	const scope = request.scope ?? 'all';
	const includeProvisional = request.includeProvisional === true;
	const includeDecided = request.includeDecided === true;
	const limit = request.limit ?? DEFAULT_CARD_LIMIT;

	const filtered = allCards.filter((card) => {
		if (scope !== 'all' && card.scope !== scope) return false;
		if (request.severity && card.severity !== request.severity) return false;

		if (request.status === 'withdrawn') {
			return card.status === 'withdrawn';
		}
		if (request.status === 'deferred') {
			return card.status === 'deferred';
		}
		if (request.status === 'changes-requested') {
			return card.status === 'changes-requested';
		}
		if (request.status === 'open') {
			return card.status === 'open';
		}
		if (request.status === 'all') {
			if (!includeProvisional && card.status === 'provisional') return false;
			return true;
		}
		// Default queue: exclude withdrawn, exclude provisional unless opted in, exclude decided unless opted in
		if (card.status === 'withdrawn') return false;
		if (card.status === 'provisional' && !includeProvisional) return false;
		if ((card.status === 'approved' || card.status === 'rejected') && !includeDecided) {
			return false;
		}
		return true;
	});

	filtered.sort(compareCards);

	const total = filtered.length;
	let startIndex = 0;
	if (request.after !== undefined) {
		const afterId = request.after.trim();
		const afterIdx = filtered.findIndex((c) => c.card === afterId);
		if (afterIdx >= 0) {
			startIndex = afterIdx + 1;
		} else {
			// If the cursor card left the filtered queue (e.g. just decided), position strictly after its sort key.
			const cursorRecord = allCards.find((c) => c.card === afterId);
			if (cursorRecord) {
				const nextIdx = filtered.findIndex((c) => compareCards(c, cursorRecord) > 0);
				startIndex = nextIdx >= 0 ? nextIdx : filtered.length;
			} else {
				startIndex = filtered.length;
			}
		}
	}

	const slice = filtered.slice(startIndex, startIndex + limit);
	const remaining = Math.max(0, total - (startIndex + slice.length));
	const next = remaining > 0 ? slice[slice.length - 1]?.card : undefined;

	return {
		page,
		cards: slice.map(toCardSummary),
		total,
		more: remaining,
		...(next === undefined ? {} : { next }),
		unmeasured,
	};
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/**
 * Render a self-contained HTML pre-ship decision card review page (`cards.html`).
 * When served over HTTP, loads live cards from `/api/cards.json?<query>`; when passed
 * `initialCards`, renders them statically for offline snapshots and unit tests.
 */
export function renderCardsPageHtml(initialCards: readonly DesignCardSummary[] = []): string {
	const items = initialCards
		.map(
			(card) =>
				`<article class="card" data-card="${escapeHtml(card.card)}" data-severity="${escapeHtml(card.severity)}" data-status="${escapeHtml(card.status)}">` +
				`<header><h2>${escapeHtml(card.what)}</h2>` +
				`<span class="badge">${escapeHtml(card.severity)}</span>` +
				`<span class="badge">${escapeHtml(card.status)}</span>` +
				`<code>${escapeHtml(card.card)}</code></header>` +
				`<p>${escapeHtml(card.visual.summary)}</p>` +
				`<p class="meta">Trigger: ${escapeHtml(card.why.trigger)} · Split: ${escapeHtml(card.why.split)} · Regression: ${card.effect.regression ? 'yes' : 'no'}</p>` +
				`</article>`
		)
		.join('\n');
	const initialAttr = initialCards.length > 0 ? ' data-prerendered="true"' : '';
	return [
		'<!doctype html>',
		'<html lang="en">',
		'<head>',
		'<meta charset="utf-8" />',
		'<meta name="viewport" content="width=device-width, initial-scale=1" />',
		'<title>Specimen Decision Cards</title>',
		'<style>',
		':root{color-scheme:light dark;font-family:system-ui,sans-serif}',
		'body{max-width:56rem;margin:0 auto;padding:1.5rem;line-height:1.5}',
		'.card{border:1px solid currentColor;border-radius:8px;padding:1rem;margin-bottom:1rem}',
		'.card header{display:flex;flex-wrap:wrap;gap:.5rem;align-items:baseline}',
		'.badge{font-size:.8rem;padding:.15rem .45rem;border:1px solid currentColor;border-radius:4px}',
		'.meta{font-size:.9rem;opacity:.85}',
		'#error{color:#b91c1c;font-weight:600}',
		'</style>',
		'</head>',
		`<body${initialAttr}>`,
		'<main>',
		'<h1>Design Decision Cards</h1>',
		'<p id="summary"></p>',
		'<p id="error" role="alert" hidden></p>',
		`<section id="cards" aria-label="Decision cards">${items}</section>`,
		'</main>',
		'<script>',
		'(function(){',
		'if(document.body.dataset.prerendered==="true")return;',
		'const qs=window.location.search||"";',
		'fetch("/api/cards.json"+qs).then(r=>r.json().then(d=>({ok:r.ok,d}))).then(({ok,d})=>{',
		'const err=document.getElementById("error");const list=document.getElementById("cards");const sum=document.getElementById("summary");',
		'if(!ok||d.error){err.textContent=(d.error&&d.error.message)||"Could not load decision cards.";err.hidden=false;return;}',
		'sum.textContent=d.total+" card(s) in queue"+(d.more?" ("+d.more+" more)":"")+".";',
		'list.replaceChildren();',
		'for(const c of d.cards||[]){',
		'const el=document.createElement("article");el.className="card";el.dataset.card=c.card;el.dataset.severity=c.severity;el.dataset.status=c.status;',
		'const h=document.createElement("header");const h2=document.createElement("h2");h2.textContent=c.what;h.appendChild(h2);',
		'for(const t of [c.severity,c.status]){const s=document.createElement("span");s.className="badge";s.textContent=t;h.appendChild(s);}',
		'const code=document.createElement("code");code.textContent=c.card;h.appendChild(code);el.appendChild(h);',
		'const p=document.createElement("p");p.textContent=c.visual.summary;el.appendChild(p);',
		'const m=document.createElement("p");m.className="meta";m.textContent="Trigger: "+c.why.trigger+" · Split: "+c.why.split+" · Regression: "+(c.effect.regression?"yes":"no");el.appendChild(m);',
		'list.appendChild(el);',
		'}',
		'}).catch(()=>{const err=document.getElementById("error");err.textContent="Serve Specimen over HTTP to view cards.html.";err.hidden=false;});',
		'})();',
		'</script>',
		'</body>',
		'</html>',
	].join('\n');
}
