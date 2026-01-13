import React, { useState } from 'react';
import type { CommandResult } from '../types';
import type { LogEntry } from './CommandLog';
import './DevModeDrawer.css';

interface DevModeDrawerProps {
	isOpen: boolean;
	onClose: () => void;
	lastResult: CommandResult<unknown> | null;
	lastCommandName: string;
	logEntries: LogEntry[];
	// Connection status
	isConvexReady: boolean;
	isBackendReady: boolean;
	isChatReady: boolean;
	pendingOperations: number;
	// Command log visibility
	showCommandLog: boolean;
	onToggleCommandLog: () => void;
}

type TabType = 'trust' | 'latency' | 'json' | 'log';

const getConfidenceColor = (confidence: number): string => {
	if (confidence >= 0.8) return 'var(--success)';
	if (confidence >= 0.5) return 'var(--warning)';
	return 'var(--error)';
};

const formatTime = (ms: number): string => {
	if (ms < 1) return '<1ms';
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(2)}s`;
};

export const DevModeDrawer: React.FC<DevModeDrawerProps> = ({
	isOpen,
	onClose,
	lastResult,
	lastCommandName,
	logEntries,
	isConvexReady,
	isBackendReady,
	isChatReady,
	pendingOperations,
	showCommandLog,
	onToggleCommandLog,
}) => {
	const [activeTab, setActiveTab] = useState<TabType>('trust');

	const tabs: { id: TabType; label: string }[] = [
		{ id: 'trust', label: 'Trust' },
		{ id: 'latency', label: 'Latency' },
		{ id: 'json', label: 'JSON' },
		{ id: 'log', label: 'Log' },
	];

	const renderTrustTab = () => {
		if (!lastResult) {
			return <div className="dev-empty">No command results yet</div>;
		}
		const confidence = lastResult.confidence ?? 1;
		return (
			<div className="dev-trust-content">
				<div className="dev-section">
					<div className="dev-section-header">Confidence</div>
					<div className="dev-confidence-row">
						<div className="dev-confidence-meter">
							<div className="dev-confidence-fill" style={{ width: `${confidence * 100}%`, backgroundColor: getConfidenceColor(confidence) }} />
						</div>
						<span className="dev-confidence-value">{Math.round(confidence * 100)}%</span>
					</div>
				</div>
				{lastResult.reasoning && (
					<div className="dev-section">
						<div className="dev-section-header">Reasoning</div>
						<div className="dev-reasoning-text">{lastResult.reasoning}</div>
					</div>
				)}
				{lastResult.sources && lastResult.sources.length > 0 && (
					<div className="dev-section">
						<div className="dev-section-header">Sources ({lastResult.sources.length})</div>
						<ul className="dev-sources-list">
							{lastResult.sources.map((source, i) => (
								<li key={i} className="dev-source-item">
									<span className="dev-source-type">{source.type || 'unknown'}</span>
									{source.title && <span className="dev-source-title">{source.title}</span>}
									{source.relevance !== undefined && <span className="dev-source-relevance">{Math.round(source.relevance * 100)}%</span>}
								</li>
							))}
						</ul>
					</div>
				)}
				{lastResult.plan && lastResult.plan.length > 0 && (
					<div className="dev-section">
						<div className="dev-section-header">Execution Plan</div>
						<ol className="dev-plan-list">
							{lastResult.plan.map((step, i) => (
								<li key={i} className={`dev-plan-step ${step.status || ''}`}>
									<span className="dev-step-name">{step.name || step.action || `Step ${i + 1}`}</span>
									{step.description && <span className="dev-step-desc">{step.description}</span>}
									{step.status && <span className={`dev-step-status ${step.status}`}>{step.status}</span>}
								</li>
							))}
						</ol>
					</div>
				)}
				{lastResult.warnings && lastResult.warnings.length > 0 && (
					<div className="dev-section">
						<div className="dev-section-header">Warnings ({lastResult.warnings.length})</div>
						<ul className="dev-warnings-list">
							{lastResult.warnings.map((warning, i) => (
								<li key={i} className={`dev-warning-item ${warning.severity || ''}`}>
									<span className="dev-warning-code">{warning.code}</span>
									<span className="dev-warning-msg">{warning.message}</span>
								</li>
							))}
						</ul>
					</div>
				)}
			</div>
		);
	};

	const renderLatencyTab = () => {
		if (!lastResult) {
			return <div className="dev-empty">No command results yet</div>;
		}
		const execTime = lastResult.metadata?.executionTimeMs;
		return (
			<div className="dev-latency-content">
				<div className="dev-section">
					<div className="dev-section-header">Last Command</div>
					<div className="dev-command-name">{lastCommandName || 'unknown'}</div>
				</div>
				<div className="dev-section">
					<div className="dev-section-header">Execution Time</div>
					<div className="dev-latency-display">
						{execTime !== undefined ? (
							<>
								<span className="dev-latency-value">{formatTime(execTime)}</span>
								<div className="dev-latency-bar">
									<div className="dev-latency-fill" style={{ width: `${Math.min((execTime / 1000) * 100, 100)}%`, backgroundColor: execTime < 100 ? 'var(--success)' : execTime < 500 ? 'var(--warning)' : 'var(--error)' }} />
								</div>
							</>
						) : (
							<span className="dev-latency-na">N/A</span>
						)}
					</div>
				</div>
				<div className="dev-section">
					<div className="dev-section-header">Status</div>
					<div className={`dev-status-badge ${lastResult.success ? 'success' : 'error'}`}>
						{lastResult.success ? 'Success' : 'Failed'}
					</div>
				</div>
			</div>
		);
	};

	const renderJsonTab = () => {
		if (!lastResult) {
			return <div className="dev-empty">No command results yet</div>;
		}
		return (
			<div className="dev-json-content">
				<div className="dev-json-header">
					<span className="dev-json-command">{lastCommandName}</span>
				</div>
				<pre className="dev-json-viewer">{JSON.stringify(lastResult, null, 2)}</pre>
			</div>
		);
	};

	const renderLogTab = () => {
		if (logEntries.length === 0) {
			return <div className="dev-empty">No log entries yet</div>;
		}
		return (
			<div className="dev-log-content">
				{logEntries.map((entry) => (
					<div key={entry.id} className={`dev-log-entry ${entry.type}`}>
						<span className="dev-log-time">{entry.timestamp.toLocaleTimeString()}</span>
						<span className="dev-log-msg">{entry.message}</span>
					</div>
				))}
			</div>
		);
	};

	const renderTabContent = () => {
		switch (activeTab) {
			case 'trust': return renderTrustTab();
			case 'latency': return renderLatencyTab();
			case 'json': return renderJsonTab();
			case 'log': return renderLogTab();
		}
	};

	return (
		<>
			<div className={`dev-drawer-overlay ${isOpen ? 'visible' : ''}`} onClick={onClose} />
			<div className={`dev-drawer ${isOpen ? 'open' : ''}`}>
				<div className="dev-drawer-header">
					<h2 className="dev-drawer-title">Dev Mode</h2>
					<button type="button" className="dev-drawer-close" onClick={onClose}>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</button>
				</div>
				<div className="dev-status-row">
					<div className="dev-status-badges">
						<span className={`dev-connection-badge ${isBackendReady ? 'connected' : 'disconnected'}`}>
							<span className="dev-status-dot" />
							Backend
						</span>
						<span className={`dev-connection-badge ${isChatReady ? 'connected' : 'disconnected'}`}>
							<span className="dev-status-dot" />
							Chat
						</span>
						<span className={`dev-connection-badge ${isConvexReady ? 'connected' : 'disconnected'}`}>
							<span className="dev-status-dot" />
							Convex
						</span>
						{pendingOperations > 0 && (
							<span className="dev-pending-badge">
								{pendingOperations} pending
							</span>
						)}
					</div>
					<label className="dev-toggle-label">
						<input
							type="checkbox"
							checked={showCommandLog}
							onChange={onToggleCommandLog}
							className="dev-toggle-checkbox"
						/>
						Show Log
					</label>
				</div>
				<div className="dev-tabs">
					{tabs.map((tab) => (
						<button key={tab.id} type="button" className={`dev-tab ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
							{tab.label}
						</button>
					))}
				</div>
				<div className="dev-tab-content">{renderTabContent()}</div>
			</div>
		</>
	);
};
