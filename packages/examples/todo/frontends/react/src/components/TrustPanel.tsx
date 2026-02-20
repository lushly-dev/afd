import type React from 'react';
import type { CommandResult } from '../types';
import './TrustPanel.css';

interface TrustPanelProps {
	result: CommandResult<unknown> | null;
	commandName: string;
	onClose: () => void;
}

const getSourceIcon = (type?: string) => {
	const icons: Record<string, string> = {
		api: '🔌',
		database: '🗄️',
		file: '📄',
		url: '🔗',
		cache: '💾',
		user: '👤',
		system: '⚙️',
	};
	return icons[type || ''] || '📚';
};

const getPlanStepIcon = (status?: string) => {
	const icons: Record<string, string> = {
		pending: '○',
		'in-progress': '◐',
		complete: '✓',
		failed: '✗',
	};
	return icons[status || ''] || '○';
};

export const TrustPanel: React.FC<TrustPanelProps> = ({ result, commandName, onClose }) => {
	if (!result) return null;

	const hasConfidence = result.confidence !== undefined;
	const hasReasoning = result.reasoning !== undefined;
	const hasSources = result.sources && result.sources.length > 0;
	const hasPlan = result.plan && result.plan.length > 0;

	if (!hasConfidence && !hasReasoning && !hasSources && !hasPlan) {
		return null;
	}

	const confidencePercent = hasConfidence ? Math.round(result.confidence! * 100) : 0;
	const confidenceClass = hasConfidence
		? result.confidence! >= 0.9
			? ''
			: result.confidence! >= 0.7
				? 'medium'
				: 'low'
		: '';
	const confidenceLabel = hasConfidence
		? result.confidence! >= 0.9
			? 'High confidence'
			: result.confidence! >= 0.7
				? 'Moderate confidence'
				: 'Low confidence - verify results'
		: '';

	return (
		<div className="trust-panel">
			<div className="trust-header">
				<span className="trust-title">
					<span>🔍</span>
					<span>Last Operation</span>
					<span className="trust-command">— {commandName}</span>
				</span>
				<button type="button" className="trust-close" onClick={onClose}>
					×
				</button>
			</div>

			<div className="trust-grid">
				{hasConfidence && (
					<div className="trust-section">
						<div className="trust-section-title">Confidence</div>
						<div className="confidence-meter">
							<div className="confidence-bar-large">
								<span
									className={`confidence-fill ${confidenceClass}`}
									style={{ width: `${confidencePercent}%` }}
								/>
							</div>
							<span className="confidence-value">{confidencePercent}%</span>
						</div>
						<div className="confidence-label">{confidenceLabel}</div>
					</div>
				)}

				{hasReasoning && (
					<div className="trust-section">
						<div className="trust-section-title">Reasoning</div>
						<div className="reasoning-text">{result.reasoning}</div>
					</div>
				)}
			</div>

			{hasSources && (
				<div className="trust-section" style={{ marginTop: '1rem' }}>
					<div className="trust-section-title">Sources</div>
					<div className="sources-list">
						{result.sources?.map((source, idx) => (
							<div key={idx} className="source-item">
								<span className="source-icon">{getSourceIcon(source.type)}</span>
								{source.url ? (
									<a
										href={source.url}
										target="_blank"
										rel="noopener noreferrer"
										className="source-link"
									>
										{source.title || source.url}
									</a>
								) : (
									<span>{source.title || 'Unknown source'}</span>
								)}
								{source.relevance && (
									<span className="source-relevance">
										{Math.round(source.relevance * 100)}% relevant
									</span>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{hasPlan && (
				<div className="trust-section" style={{ marginTop: '1rem' }}>
					<div className="trust-section-title">Execution Plan</div>
					<div className="plan-steps">
						{result.plan?.map((step, idx) => (
							<div key={idx} className="plan-step">
								<div className={`plan-step-icon ${step.status || 'pending'}`}>
									{getPlanStepIcon(step.status)}
								</div>
								<div className="plan-step-content">
									<div className="plan-step-name">
										{idx + 1}. {step.name || step.action}
									</div>
									{step.description && <div className="plan-step-desc">{step.description}</div>}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
};
