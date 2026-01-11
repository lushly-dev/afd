import type React from 'react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import './MarkdownEditor.css';

interface MarkdownEditorProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	readOnly?: boolean;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
	value,
	onChange,
	placeholder = 'Write your notes in markdown...',
	readOnly = false,
}) => {
	const [isPreview, setIsPreview] = useState(false);

	return (
		<div className="markdown-editor">
			<div className="markdown-toolbar">
				<button
					type="button"
					className={`toolbar-btn ${!isPreview ? 'active' : ''}`}
					onClick={() => setIsPreview(false)}
					disabled={readOnly}
				>
					Edit
				</button>
				<button
					type="button"
					className={`toolbar-btn ${isPreview ? 'active' : ''}`}
					onClick={() => setIsPreview(true)}
				>
					Preview
				</button>
			</div>
			{isPreview ? (
				<div className="markdown-preview">
					{value ? (
						<Markdown>{value}</Markdown>
					) : (
						<p className="preview-empty">Nothing to preview</p>
					)}
				</div>
			) : (
				<textarea
					className="markdown-textarea"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					disabled={readOnly}
				/>
			)}
		</div>
	);
};
