import hljs from 'highlight.js';
import { marked } from 'marked';
import type React from 'react';
import { useMemo } from 'react';
import 'highlight.js/styles/github-dark.css';
import './MarkdownMessage.css';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface MarkdownMessageProps {
	content: string;
	className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content, className = '' }) => {
	const renderedHtml = useMemo(() => {
		// Configure marked with security and highlighting
		const renderer = new marked.Renderer();

		// Custom code block renderer with syntax highlighting
		renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
			let highlightedCode = text;

			if (lang && hljs.getLanguage(lang)) {
				try {
					highlightedCode = hljs.highlight(text, { language: lang }).value;
				} catch {
					// Fallback to plain text if highlighting fails
					highlightedCode = hljs.highlightAuto(text).value;
				}
			} else {
				// Auto-detect language if none specified
				try {
					highlightedCode = hljs.highlightAuto(text).value;
				} catch {
					// Final fallback - escape HTML but keep plain text
					highlightedCode = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
				}
			}

			return `<pre><code class="hljs${lang ? ` language-${lang}` : ''}">${highlightedCode}</code></pre>`;
		};

		// Custom inline code renderer
		renderer.codespan = ({ text }: { text: string }) => {
			const escapedCode = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
			return `<code class="inline-code">${escapedCode}</code>`;
		};

		// Custom link renderer with security (external links in new tab)
		renderer.link = ({
			href,
			title,
			tokens,
		}: {
			href: string;
			title?: string | null;
			tokens: Array<{ text?: string; raw: string }>;
		}) => {
			const text = tokens.map((token) => token.text || token.raw).join('');
			const titleAttr = title ? ` title="${title}"` : '';
			const isExternal = href.startsWith('http://') || href.startsWith('https://');
			const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';

			return `<a href="${href}"${titleAttr}${targetAttr}>${text}</a>`;
		};

		// Configure marked options
		marked.setOptions({
			renderer,
			breaks: true, // Convert line breaks to <br>
			gfm: true, // GitHub Flavored Markdown
		});

		try {
			return marked.parse(content);
		} catch (error) {
			// Fallback to plain text if markdown parsing fails
			console.warn('Markdown parsing failed:', error);
			return content.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
		}
	}, [content]);

	return (
		<div
			className={`markdown-message ${className}`}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: intentional - renders parsed markdown HTML
			dangerouslySetInnerHTML={{ __html: renderedHtml }}
		/>
	);
};

export default MarkdownMessage;
