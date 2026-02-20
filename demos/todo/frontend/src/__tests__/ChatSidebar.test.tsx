import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import { ChatSidebar } from '../components/ChatSidebar';

// Mock fetch for all tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock scrollIntoView which is not available in jsdom 27+
if (!HTMLElement.prototype.scrollIntoView) {
	HTMLElement.prototype.scrollIntoView = vi.fn();
}

const PLACEHOLDER = 'Type / for commands, @ for todos...';

describe('ChatSidebar', () => {
	const defaultProps = {
		isOpen: true,
		onToggle: vi.fn(),
		onTodosChanged: vi.fn(),
		chatServerUrl: 'http://localhost:3101',
	};

	beforeEach(() => {
		vi.clearAllMocks();
		// Default mock for health check
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ geminiConfigured: true }),
		});
	});

	afterEach(() => {
		cleanup();
	});

	it('renders the chat sidebar when open', () => {
		render(<ChatSidebar {...defaultProps} />);

		expect(screen.getByText('Myoso')).toBeInTheDocument();
		expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
	});

	it('displays welcome message on initial load', () => {
		render(<ChatSidebar {...defaultProps} />);

		expect(
			screen.getByText(
				'Ask me to help manage your todos! Try: "Create 3 high-priority tasks" or "Show my stats"'
			)
		).toBeInTheDocument();
	});

	it('handles input text changes', () => {
		render(<ChatSidebar {...defaultProps} />);

		const input = screen.getByPlaceholderText(PLACEHOLDER);
		fireEvent.change(input, { target: { value: 'Test message' } });

		expect(input).toHaveValue('Test message');
	});

	it('sends message when Send button is clicked', async () => {
		// Mock: health check, then streaming attempt (fail), then legacy response
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ geminiConfigured: true }),
			})
			.mockResolvedValueOnce({
				ok: false, // streaming endpoint returns 404 → falls back to legacy
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

		const input = screen.getByPlaceholderText(PLACEHOLDER);
		const sendButton = screen.getByRole('button', { name: 'Send' });

		fireEvent.change(input, { target: { value: 'Hello AI' } });
		fireEvent.click(sendButton);

		// User message should appear
		expect(screen.getByText('Hello AI')).toBeInTheDocument();

		// Input should be cleared
		expect(input).toHaveValue('');

		// Legacy chat API should be called after streaming fails
		await waitFor(() => {
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3101/chat',
				expect.objectContaining({
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
				})
			);
		});
	});

	it('sends message when Enter key is pressed', async () => {
		// Mock: health check, streaming fail, legacy response
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ geminiConfigured: true }),
			})
			.mockResolvedValueOnce({
				ok: false,
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

		const input = screen.getByPlaceholderText(PLACEHOLDER);

		fireEvent.change(input, { target: { value: 'Hello AI' } });
		fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

		await waitFor(
			() => {
				expect(mockFetch).toHaveBeenCalledWith(
					'http://localhost:3101/chat',
					expect.objectContaining({
						method: 'POST',
					})
				);
			},
			{ timeout: 2000 }
		);
	});

	it('does not send empty messages', () => {
		render(<ChatSidebar {...defaultProps} />);

		const sendButton = screen.getByRole('button', { name: 'Send' });

		// Send button should be disabled for empty input
		expect(sendButton).toBeDisabled();

		// Try to click anyway
		fireEvent.click(sendButton);

		// Should not call chat API for empty message
		expect(mockFetch).toHaveBeenCalledTimes(1); // Only health check
	});

	it('displays error state when connection fails', async () => {
		// Mock failed health check
		mockFetch.mockRejectedValue(new Error('Network error'));

		render(<ChatSidebar {...defaultProps} />);

		// Input should be disabled when connection fails
		await waitFor(() => {
			const input = screen.getByPlaceholderText(PLACEHOLDER);
			expect(input).toBeDisabled();
		});
	});

	it('shows typing indicator during message processing', async () => {
		// Mock: health check, streaming fail, delayed legacy response
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ geminiConfigured: true }),
			})
			.mockResolvedValueOnce({
				ok: false,
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

		const input = screen.getByPlaceholderText(PLACEHOLDER);
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

		// Mock: health check, streaming fail, legacy response with tool execution
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ geminiConfigured: true }),
			})
			.mockResolvedValueOnce({
				ok: false,
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

		const input = screen.getByPlaceholderText(PLACEHOLDER);
		const sendButton = screen.getByRole('button', { name: 'Send' });

		fireEvent.change(input, { target: { value: 'Create a todo' } });
		fireEvent.click(sendButton);

		await waitFor(() => {
			expect(screen.getByText('Created a new todo!')).toBeInTheDocument();
		});

		// Should call onTodosChanged when tools were executed
		expect(onTodosChanged).toHaveBeenCalledTimes(1);
	});

	it('renders toggle button when closed', () => {
		render(<ChatSidebar {...defaultProps} isOpen={false} />);

		const toggleButton = screen.getByTitle('Open Myoso');
		expect(toggleButton).toBeInTheDocument();
		expect(toggleButton).toHaveTextContent('💬');
	});

	it('calls onToggle when toggle button is clicked', () => {
		const onToggle = vi.fn();

		render(<ChatSidebar {...defaultProps} isOpen={false} onToggle={onToggle} />);

		const toggleButton = screen.getByTitle('Open Myoso');
		fireEvent.click(toggleButton);

		expect(onToggle).toHaveBeenCalledTimes(1);
	});
});
