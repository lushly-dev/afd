import React from 'react';
import ReactMarkdown from 'react-markdown';

interface MarkdownMessageProps {
	content: string;
	className?: string;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content, className = '' }) => {
	return (
		<div className={`markdown-message ${className}`}>
			<ReactMarkdown
				components={{
					code({ className, children, ...props }) {
						const match = /language-(\w+)/.exec(className || '');
						const language = match ? match[1] : '';

						// Check if this is a code block (has language) vs inline code
						const isCodeBlock = language && typeof children === 'string' && children.includes('\n');

						return isCodeBlock ? (
							<pre className="markdown-code-block">
								<code className={`language-${language}`} {...props}>
									{String(children).replace(/\n$/, '')}
								</code>
							</pre>
						) : (
							<code className={`inline-code ${className || ''}`} {...props}>
								{children}
							</code>
						);
					},
					h1({ children }) {
						return <h1 className="markdown-h1">{children}</h1>;
					},
					h2({ children }) {
						return <h2 className="markdown-h2">{children}</h2>;
					},
					h3({ children }) {
						return <h3 className="markdown-h3">{children}</h3>;
					},
					h4({ children }) {
						return <h4 className="markdown-h4">{children}</h4>;
					},
					h5({ children }) {
						return <h5 className="markdown-h5">{children}</h5>;
					},
					h6({ children }) {
						return <h6 className="markdown-h6">{children}</h6>;
					},
					p({ children }) {
						return <p className="markdown-p">{children}</p>;
					},
					ul({ children }) {
						return <ul className="markdown-ul">{children}</ul>;
					},
					ol({ children }) {
						return <ol className="markdown-ol">{children}</ol>;
					},
					li({ children }) {
						return <li className="markdown-li">{children}</li>;
					},
					blockquote({ children }) {
						return <blockquote className="markdown-blockquote">{children}</blockquote>;
					},
					strong({ children }) {
						return <strong className="markdown-strong">{children}</strong>;
					},
					em({ children }) {
						return <em className="markdown-em">{children}</em>;
					},
					a({ href, children }) {
						return (
							<a
								href={href}
								className="markdown-link"
								target="_blank"
								rel="noopener noreferrer"
							>
								{children}
							</a>
						);
					},
					hr() {
						return <hr className="markdown-hr" />;
					},
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
};

export default MarkdownMessage;