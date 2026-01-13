import React from "react";
import type { List } from "../hooks/useConvexLists";
import "./Sidebar.css";

export type ViewType = "inbox" | "today" | "list" | "notes";

export interface SidebarProps {
	activeView: ViewType;
	activeListId: string | null;
	lists: List[];
	onViewChange: (view: ViewType, listId?: string) => void;
	onCreateList: () => void;
	todayCount: number;
	inboxCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
	activeView,
	activeListId,
	lists,
	onViewChange,
	onCreateList,
	todayCount,
	inboxCount,
}) => {
	return (
		<aside className="sidebar">
			<nav className="sidebar-nav">
				{/* Main navigation */}
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

				{/* Lists section */}
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
						{/* All Lists - always visible */}
						<button
							type="button"
							className={`sidebar-item ${activeView === "list" && !activeListId ? "active" : ""}`}
							onClick={() => onViewChange("list")}
						>
							<span className="sidebar-icon">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
									<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
								</svg>
							</span>
							<span className="sidebar-label">All Lists</span>
						</button>
						{/* User-created lists */}
						{lists.map((list) => (
							<button
								type="button"
								key={list._id}
								className={`sidebar-item ${activeView === "list" && activeListId === list._id ? "active" : ""}`}
								onClick={() => onViewChange("list", list._id)}
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
						))}
					</div>
				</div>

				{/* Notes section */}
				<div className="sidebar-section">
					<div className="sidebar-section-header">
						<span>Notes</span>
						<button type="button" className="sidebar-add-btn" title="Create new note">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<line x1="12" y1="5" x2="12" y2="19" />
								<line x1="5" y1="12" x2="19" y2="12" />
							</svg>
						</button>
					</div>
					<div className="sidebar-lists">
						<button
							type="button"
							className={`sidebar-item ${activeView === "notes" ? "active" : ""}`}
							onClick={() => onViewChange("notes")}
						>
							<span className="sidebar-icon">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
									<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
									<polyline points="14 2 14 8 20 8" />
								</svg>
							</span>
							<span className="sidebar-label">All Notes</span>
						</button>
					</div>
				</div>
			</nav>
		</aside>
	);
};
