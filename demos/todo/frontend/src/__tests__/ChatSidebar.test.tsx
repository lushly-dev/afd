import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import { ChatSidebar } from '../components/ChatSidebar';

// Mock fetch for all tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock scrollIntoView which is not available in jsdom
const mockScrollIntoView = vi.fn();
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
	value: mockScrollIntoView,
	writable: true,
});

describe('ChatSidebar', () => {
	const defaultProps = {
		isOpen: true,
		onToggle: vi.fn(),
		onTodosChanged: vi.fn(),
		chatServerUrl: 'http://localhost:3101',
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockScrollIntoView.mockClear();
		// Default mock for health check
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ geminiConfigured: true }),
		});
	});

	it('renders the chat sidebar when open', () => {
		render(<ChatSidebar {...defaultProps} />);

		expect(screen.getByText('AI Copilot')).toBeInTheDocument();
		expect(screen.getByPlaceholderText('Ask AI to help with todos...')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
		// Check that the sidebar contains the header icon (there might be multiple robot emojis)
		expect(document.querySelector('.chat-sidebar-header-icon')).toBeInTheDocument();
	});

	it('displays welcome message on initial load', () => {
		render(<ChatSidebar {...defaultProps} />);

		expect(
			screen.getByText(
				'Ask me to help manage your todos! Try: "Create 3 high-priority tasks" or "Show my stats"'
			)
		).toBeInTheDocument();
	});

	it('shows connection status', async () => {
		render(<ChatSidebar {...defaultProps} />);

		// Should show "Connecting..." initially, then "Ready"
		await waitFor(() => {
			expect(screen.getByText('Ready')).toBeInTheDocument();
		});
	});

	it('handles input text changes', () => {
		render(<ChatSidebar {...defaultProps} />);

		const input = screen.getByPlaceholderText('Ask AI to help with todos...');
		fireEvent.change(input, { target: { value: 'Test message' } });

		expect(input).toHaveValue('Test message');
	});

	it('sends message when Send button is clicked', async () => {
		// Mock successful chat response
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ geminiConfigured: true }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						message: 'Hello! I can help you with todos.',
						toolExecutions: [],
						totalToolLatencyMs: 0,
						modelLatencyMs: 150,
					}),
			});

		render(<ChatSidebar {...defaultProps} />);

		const input = screen.getByPlaceholderText('Ask AI to help with todos...');
		const sendButton = screen.getByRole('button', { name: 'Send' });

		fireEvent.change(input, { target: { value: 'Hello AI' } });
		fireEvent.click(sendButton);

		// User message should appear
		expect(screen.getByText('Hello AI')).toBeInTheDocument();

		// Input should be cleared
		expect(input).toHaveValue('');

		// Chat API should be called
		await waitFor(() => {
			expect(mockFetch).toHaveBeenCalledWith('http://localhost:3101/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: 'Hello AI' }),
			});
		});
	});

	it('sends message when Enter key is pressed', async () => {
		// Mock successful chat response
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ geminiConfigured: true }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						message: 'Hello! I can help you with todos.',
						toolExecutions: [],
						totalToolLatencyMs: 0,
						modelLatencyMs: 150,
					}),
			});

		render(<ChatSidebar {...defaultProps} />);

		const input = screen.getByPlaceholderText('Ask AI to help with todos...');

		fireEvent.change(input, { target: { value: 'Hello AI' } });
		fireEvent.keyPress(input, { key: 'Enter', code: 'Enter' });

		// Chat API should be called (eventually)
		await waitFor(
			() => {
				expect(mockFetch).toHaveBeenCalledWith('http://localhost:3101/chat', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ message: 'Hello AI' }),
				});
			},
			{ timeout: 2000 }
		);
	});

	it('does not send empty messages', () => {
		render(<ChatSidebar {...defaultProps} />);

		const sendButton = screen.getByRole('button', { name: 'Send' });

		// Try to send empty message
		fireEvent.click(sendButton);

		// Should not call chat API for empty message
		expect(mockFetch).toHaveBeenCalledTimes(1); // Only health check
	});

	it('displays error state when connection fails', async () => {
		// Mock failed health check
		mockFetch.mockRejectedValue(new Error('Network error'));

		render(<ChatSidebar {...defaultProps} />);

		await waitFor(() => {
			expect(screen.getByText('Offline')).toBeInTheDocument();
		});

		// Input and send button should be disabled
		const input = screen.getByPlaceholderText('Ask AI to help with todos...');
		const sendButton = screen.getByRole('button', { name: 'Send' });

		expect(input).toBeDisabled();
		expect(sendButton).toBeDisabled();
	});

	it('shows typing indicator during message processing', async () => {
		// Mock delayed chat response
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ geminiConfigured: true }),
			})
			.mockImplementationOnce(
				() =>
					new Promise((resolve) =>
						setTimeout(
							() =>
								resolve({
									ok: true,
									json: () =>
										Promise.resolve({
											message: 'Response',
											toolExecutions: [],
											totalToolLatencyMs: 0,
											modelLatencyMs: 150,
										}),
								}),
							100
						)
					)
			);

		render(<ChatSidebar {...defaultProps} />);

		const input = screen.getByPlaceholderText('Ask AI to help with todos...');
		const sendButton = screen.getByRole('button', { name: 'Send' });

		fireEvent.change(input, { target: { value: 'Test message' } });
		fireEvent.click(sendButton);

		// Should show typing indicator
		expect(screen.getByText('Gemini thinking...')).toBeInTheDocument();

		// Wait for response
		await waitFor(() => {
			expect(screen.getByText('Response')).toBeInTheDocument();
		});

		// Typing indicator should be gone
		expect(screen.queryByText('Gemini thinking...')).not.toBeInTheDocument();
	});

	it('calls onTodosChanged when tools are executed', async () => {
		const onTodosChanged = vi.fn();

		// Mock successful chat response with tool execution
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ geminiConfigured: true }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						message: 'Created a new todo!',
						toolExecutions: [
							{
								name: 'todo-create',
								args: { title: 'Test Todo' },
								result: { id: 1 },
								latencyMs: 5.2,
							},
						],
						totalToolLatencyMs: 5.2,
						modelLatencyMs: 150,
					}),
			});

		render(<ChatSidebar {...defaultProps} onTodosChanged={onTodosChanged} />);

		const input = screen.getByPlaceholderText('Ask AI to help with todos...');
		const sendButton = screen.getByRole('button', { name: 'Send' });

		fireEvent.change(input, { target: { value: 'Create a todo' } });
		fireEvent.click(sendButton);

		await waitFor(() => {
			expect(screen.getByText('Created a new todo!')).toBeInTheDocument();
		});

		// Should call onTodosChanged when tools were executed
		expect(onTodosChanged).toHaveBeenCalledTimes(1);
	});

	it('renders toggle button when closed on mobile', () => {
		render(<ChatSidebar {...defaultProps} isOpen={false} />);

		const toggleButton = screen.getByTitle('Open AI Copilot');
		expect(toggleButton).toBeInTheDocument();
		expect(toggleButton).toHaveTextContent('🤖');
	});

	it('calls onToggle when toggle button is clicked', () => {
		const onToggle = vi.fn();

		render(<ChatSidebar {...defaultProps} isOpen={false} onToggle={onToggle} />);

		const toggleButton = screen.getByTitle('Open AI Copilot');
		fireEvent.click(toggleButton);

		expect(onToggle).toHaveBeenCalledTimes(1);
	});
});
