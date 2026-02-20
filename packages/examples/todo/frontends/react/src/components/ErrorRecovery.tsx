import type React from 'react';
import './ErrorRecovery.css';

interface ErrorRecoveryProps {
	isVisible: boolean;
	commandName: string;
	errorMessage: string;
	suggestion?: string;
	onRetry: () => void;
	onDismiss: () => void;
}

export const ErrorRecovery: React.FC<ErrorRecoveryProps> = ({
	isVisible,
	commandName,
	errorMessage,
	suggestion,
	onRetry,
	onDismiss,
}) => {
	if (!isVisible) return null;

	return (
		<div className="error-recovery">
			<div className="error-recovery-header">
				<span>⚠️</span>
				<span>Operation Failed</span>
			</div>
			<div className="error-recovery-message">
				{commandName} failed: {errorMessage}
			</div>
			{suggestion && (
				<div className="error-recovery-suggestion">
					<strong>💡 Suggestion:</strong> {suggestion}
				</div>
			)}
			<div className="error-recovery-actions">
				<button type="button" className="retry-btn" onClick={onRetry}>
					🔄 Retry
				</button>
				<button type="button" className="dismiss-btn" onClick={onDismiss}>
					Dismiss
				</button>
			</div>
		</div>
	);
};
