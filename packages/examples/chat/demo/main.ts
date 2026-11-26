/**
 * Browser demo of the handoff pattern, built with Vite into dist/demo and served by the realtime
 * server: run `pnpm dev` and open http://localhost:3001.
 *
 * 1. Call the chat-connect command through the MCP server's /rpc route.
 * 2. Open the WebSocket address from the returned HandoffResult.
 *
 * Nicknames and messages come from other users, so everything is rendered with textContent,
 * never as HTML.
 */
import './elements';
import './styles.css';
import { applyTheme } from './theme';

const MCP_PORT = 3100;
const RPC_URL = `${window.location.protocol}//${window.location.hostname}:${MCP_PORT}/rpc`;

interface HandoffResult {
	protocol: string;
	endpoint: string;
	credentials: { token: string };
}

type ServerMessage =
	| { type: 'welcome'; roomId: string; participants: string[] }
	| { type: 'message'; sender: string; text: string }
	| { type: 'user_joined' | 'user_left'; nickname: string }
	| { type: 'error'; message: string }
	| { type: 'typing'; nickname: string }
	| { type: 'pong' };

function element<T extends HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (!found) throw new Error(`The demo page has no #${id}`);
	return found as T;
}

/** violet-select, violet-text-field and violet-chat-composer each expose `value` and `disabled`. */
type ValueElement = HTMLElement & { value: string; disabled: boolean };
type StatusElement = HTMLElement & { status: string };

const join = element<HTMLElement>('join');
const connectButton = element<HTMLElement>('connect');
const room = element<ValueElement>('room');
const nickname = element<ValueElement>('nickname');
const statusRow = element<StatusElement>('status');
const thread = element<HTMLElement & { empty: boolean }>('thread');
const composer = element<ValueElement>('composer');

let ws: WebSocket | null = null;
/** True from the click until the socket opens or the attempt fails, so one click makes one session. */
let connecting = false;
let me = '';

/** Shows a connection step or failure between the form and the thread. */
function setStatus(status: 'submitted' | 'error', text: string): void {
	statusRow.status = status;
	statusRow.textContent = text;
	statusRow.hidden = false;
}

function clearStatus(): void {
	statusRow.hidden = true;
	statusRow.textContent = '';
}

/** A notice from the page or the server: centred, without an author. */
function addNotice(text: string, tone: 'default' | 'error' = 'default'): void {
	const message = document.createElement('violet-message');
	message.setAttribute('message-role', 'system');
	if (tone !== 'default') message.setAttribute('tone', tone);
	const part = document.createElement('violet-message-text');
	part.textContent = text;
	message.append(part);
	show(message);
}

/** A chat message: your own on the user side, everyone else's on the other. */
function addChat(sender: string, text: string): void {
	const message = document.createElement('violet-message');
	message.setAttribute('message-role', sender === me ? 'user' : 'assistant');
	const meta = document.createElement('span');
	meta.slot = 'meta';
	const name = document.createElement('span');
	name.className = 'sender';
	name.textContent = sender;
	meta.append(name, ` · ${new Date().toLocaleTimeString()}`);
	const part = document.createElement('violet-message-text');
	part.textContent = text;
	message.append(meta, part);
	show(message);
}

function show(message: HTMLElement): void {
	thread.empty = false;
	thread.append(message);
}

async function callCommand<T>(method: string, params: unknown): Promise<T> {
	const response = await fetch(RPC_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});
	const data = await response.json();
	if (data.error) throw new Error(data.error.message);
	const result = data.result;
	if (!result.success) {
		const suggestion = result.error?.suggestion ? ` ${result.error.suggestion}` : '';
		throw new Error(`${result.error?.message ?? 'Command failed.'}${suggestion}`);
	}
	return result.data as T;
}

function setConnected(connected: boolean): void {
	join.hidden = connected;
	composer.disabled = !connected;
	composer.setAttribute('placeholder', connected ? 'Send a message…' : 'Connect to a room first');
}

function onServerMessage(event: MessageEvent): void {
	let msg: ServerMessage;
	try {
		msg = JSON.parse(String(event.data));
	} catch {
		addNotice(String(event.data));
		return;
	}
	switch (msg.type) {
		case 'welcome':
			addNotice(`Welcome to ${msg.roomId}. Here now: ${msg.participants.join(', ')}.`);
			break;
		case 'message':
			addChat(msg.sender, msg.text);
			break;
		case 'user_joined':
			addNotice(`${msg.nickname} joined.`);
			break;
		case 'user_left':
			addNotice(`${msg.nickname} left.`);
			break;
		case 'error':
			addNotice(msg.message, 'error');
			break;
		case 'typing':
		case 'pong':
			break; // the demo shows neither
		default:
			addNotice(JSON.stringify(msg));
	}
}

async function connect(): Promise<void> {
	if (connecting || ws?.readyState === WebSocket.OPEN) return;
	connecting = true;
	connectButton.setAttribute('disabled', '');
	const roomId = room.value || 'general';
	me = nickname.value.trim() || 'anonymous';

	setStatus('submitted', 'Step 1 of 2: calling chat-connect…');
	addNotice(`chat-connect { roomId: "${roomId}", nickname: "${me}" }`);

	try {
		const handoff = await callCommand<HandoffResult>('chat-connect', { roomId, nickname: me });
		addNotice(
			`HandoffResult: ${handoff.protocol} at ${handoff.endpoint}, token ${handoff.credentials.token.slice(0, 8)}…`
		);

		setStatus('submitted', 'Step 2 of 2: opening the WebSocket…');
		const socket = new WebSocket(
			`${handoff.endpoint}?token=${encodeURIComponent(handoff.credentials.token)}`
		);
		ws = socket;
		socket.onopen = () => {
			connecting = false;
			clearStatus();
			addNotice(`Connected to ${roomId} as ${me}.`);
			setConnected(true);
		};
		socket.onclose = (e) => {
			if (ws === socket) ws = null;
			connecting = false;
			connectButton.removeAttribute('disabled');
			setStatus('error', `Disconnected (${e.code}: ${e.reason || 'closed'}).`);
			setConnected(false);
		};
		socket.onerror = () => addNotice('The WebSocket reported an error.', 'error');
		socket.onmessage = onServerMessage;
	} catch (err) {
		connecting = false;
		connectButton.removeAttribute('disabled');
		setStatus('error', 'Could not connect.');
		addNotice(
			`${err instanceof Error ? err.message : String(err)} Make sure the chat servers are running (pnpm dev) and this page is open at http://localhost:3001.`,
			'error'
		);
	}
}

await applyTheme();

connectButton.addEventListener('click', () => void connect());
nickname.addEventListener('keydown', (event) => {
	if (event.key === 'Enter' && !event.isComposing) void connect();
});
composer.addEventListener('submit', (event) => {
	const { text } = (event as unknown as CustomEvent<{ text: string }>).detail;
	if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'message', text }));
});
document.documentElement.dataset.ready = 'true';
