/**
 * Browser demo of the handoff pattern. Served by the realtime server:
 * run `pnpm dev` and open http://localhost:3001.
 *
 * 1. Call the chat-connect command through the MCP server's /rpc route.
 * 2. Open the WebSocket URL from the returned HandoffResult.
 *
 * Nicknames and messages come from other users, so everything is rendered
 * with textContent, never as HTML.
 */

const MCP_PORT = 3100;
const RPC_URL = `${window.location.protocol}//${window.location.hostname}:${MCP_PORT}/rpc`;

const chatBox = document.getElementById('chat');
const statusEl = document.getElementById('status');
const messageInput = document.getElementById('message');
const sendBtn = document.getElementById('sendBtn');
const joinForm = document.getElementById('joinForm');

let ws = null;

function span(className, text) {
	const node = document.createElement('span');
	node.className = className;
	node.textContent = text;
	return node;
}

function addMessage(type, text) {
	const div = document.createElement('div');
	div.className = `message ${type === 'system' ? 'system' : type === 'error' ? 'error' : ''}`;
	const body = document.createElement('div');
	body.className = 'text';
	body.textContent = String(text);
	div.append(span('user', `${type}:`), span('time', new Date().toLocaleTimeString()), body);
	chatBox.appendChild(div);
	chatBox.scrollTop = chatBox.scrollHeight;
}

async function callCommand(method, params) {
	const response = await fetch(RPC_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});
	const data = await response.json();
	if (data.error) throw new Error(data.error.message);
	const result = data.result;
	if (!result.success) {
		const suggestion = result.error?.suggestion ? ` (${result.error.suggestion})` : '';
		throw new Error(`${result.error?.message ?? 'Command failed'}${suggestion}`);
	}
	return result.data;
}

async function connect() {
	const room = document.getElementById('room').value;
	const nickname = document.getElementById('nickname').value || 'anonymous';

	statusEl.className = 'status connecting';
	statusEl.textContent = '🔄 Step 1: Calling chat-connect command...';
	addMessage('system', `Calling chat-connect { roomId: "${room}", nickname: "${nickname}" }`);

	try {
		// Step 1: Call chat-connect to get a handoff token
		const handoff = await callCommand('chat-connect', { roomId: room, nickname });
		const wsUrl = `${handoff.endpoint}?token=${encodeURIComponent(handoff.credentials.token)}`;
		addMessage(
			'system',
			`✓ Received HandoffResult:\n  - protocol: ${handoff.protocol}\n  - endpoint: ${handoff.endpoint}\n  - token: ${handoff.credentials.token.substring(0, 8)}...`
		);

		// Step 2: Connect to the WebSocket from the handoff
		statusEl.textContent = '🔄 Step 2: Connecting to WebSocket...';
		ws = new WebSocket(wsUrl);

		ws.onopen = () => {
			statusEl.className = 'status connected';
			statusEl.textContent = `✓ Connected to ${room} as ${nickname}`;
			addMessage('system', '✓ WebSocket connected! You can now send messages.');

			messageInput.disabled = false;
			sendBtn.disabled = false;
			joinForm.style.display = 'none';
		};

		ws.onclose = (e) => {
			statusEl.className = 'status disconnected';
			statusEl.textContent = `Disconnected (${e.code}: ${e.reason || 'closed'})`;
			messageInput.disabled = true;
			sendBtn.disabled = true;
			joinForm.style.display = 'block';
		};

		ws.onerror = () => {
			addMessage('error', 'WebSocket error');
		};

		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data);
				switch (msg.type) {
					case 'welcome':
						addMessage(
							'system',
							`Welcome to ${msg.roomId}! Participants: ${msg.participants.join(', ')}`
						);
						break;
					case 'message':
						addMessage(msg.sender, msg.text);
						break;
					case 'user_joined':
						addMessage('system', `${msg.nickname} joined the room`);
						break;
					case 'user_left':
						addMessage('system', `${msg.nickname} left the room`);
						break;
					case 'error':
						addMessage('error', msg.message);
						break;
					default:
						addMessage('system', JSON.stringify(msg));
				}
			} catch {
				addMessage('server', event.data);
			}
		};
	} catch (err) {
		statusEl.className = 'status disconnected';
		statusEl.textContent = 'Connection failed';
		addMessage(
			'error',
			`Failed: ${err.message}\n\nMake sure the chat server is running (pnpm dev) and this page is open at http://localhost:3001.`
		);
	}
}

function sendMessage() {
	const text = messageInput.value.trim();
	if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

	ws.send(JSON.stringify({ type: 'message', text }));
	messageInput.value = '';
}

document.getElementById('connectBtn').addEventListener('click', connect);
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (event) => {
	if (event.key === 'Enter') sendMessage();
});
