import React from "react";
import type { List } from "../types";
import type { Theme } from "../hooks/useTheme";
import { ThemeToggle } from "./ThemeToggle";
import "./Sidebar.css";

export type ViewType = "inbox" | "today" | "list";

export interface SidebarProps {
	activeView: ViewType;
	activeListId: string | null;
	lists: List[];
	onViewChange: (view: ViewType, listId?: string) => void;
	onCreateList: () => void;
	todayCount: number;
	inboxCount: number;
	theme?: Theme;
	onThemeToggle?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
	activeView,
	activeListId,
	lists,
	onViewChange,
	onCreateList,
	todayCount,
	inboxCount,
	theme,
	onThemeToggle,
}) => {
	return (
		<aside className="sidebar">
			<nav className="sidebar-nav">
				<div className="sidebar-section">
					<button
						type="button"
						className={`sidebar-item ${activeView === "inbox" && !activeListId ? "active" : ""}`}
						onClick={() => onViewChange("inbox")}
					>
						<span className="sidebar-icon">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<polyline points="22,12 16,12 14,15 10,15 8,12 2,12" />
								<path d="M5.45,5.11L2,12V18a2,2,0,0,0,2,2H20a2,2,0,0,0,2-2V12L18.55,5.11A2,2,0,0,0,16.76,4H7.24A2,2,0,0,0,5.45,5.11Z" />
							</svg>
						</span>
						<span className="sidebar-label">Inbox</span>
						{inboxCount > 0 && <span className="sidebar-count">{inboxCount}</span>}
					</button>
					<button
						type="button"
						className={`sidebar-item ${activeView === "today" ? "active" : ""}`}
						onClick={() => onViewChange("today")}
					>
						<span className="sidebar-icon">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<circle cx="12" cy="12" r="10" />
								<polyline points="12,6 12,12 16,14" />
							</svg>
						</span>
						<span className="sidebar-label">Today</span>
						{todayCount > 0 && <span className="sidebar-count">{todayCount}</span>}
					</button>
				</div>

				<div className="sidebar-section">
					<div className="sidebar-section-header">
						<span>Lists</span>
						<button type="button" className="sidebar-add-btn" onClick={onCreateList} title="Create new list">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<line x1="12" y1="5" x2="12" y2="19" />
								<line x1="5" y1="12" x2="19" y2="12" />
							</svg>
						</button>
					</div>
					<div className="sidebar-lists">
						{lists.length === 0 ? (
							<p className="sidebar-empty">No lists yet</p>
						) : (
							lists.map((list) => (
								<button
									type="button"
									key={list.id}
									className={`sidebar-item ${activeView === "list" && activeListId === list.id ? "active" : ""}`}
									onClick={() => onViewChange("list", list.id)}
								>
									<span className="sidebar-icon">
										<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
											<line x1="8" y1="6" x2="21" y2="6" />
											<line x1="8" y1="12" x2="21" y2="12" />
											<line x1="8" y1="18" x2="21" y2="18" />
											<line x1="3" y1="6" x2="3.01" y2="6" />
											<line x1="3" y1="12" x2="3.01" y2="12" />
											<line x1="3" y1="18" x2="3.01" y2="18" />
										</svg>
									</span>
									<span className="sidebar-label">{list.name}</span>
									{list.todoIds.length > 0 && (
										<span className="sidebar-count">{list.todoIds.length}</span>
									)}
								</button>
							))
						)}
					</div>
				</div>
			</nav>
			{theme && onThemeToggle && (
				<div className="sidebar-footer">
					<ThemeToggle theme={theme} onToggle={onThemeToggle} />
				</div>
			)}
		</aside>
	);
};
