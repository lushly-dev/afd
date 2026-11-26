import type { SpecimenContext } from './types.js';

/** String-or-structured context accepted by `specimen-point` (matches both CLI/pointer strings and SpecimenContext). */
export interface PointContextInput {
	viewport?: { width: number; height: number } | string;
	container?: { width: number; height?: number } | string;
	theme?: SpecimenContext['theme'];
	locale?: string;
	reducedMotion?: SpecimenContext['reducedMotion'];
	motion?: SpecimenContext['motion'];
	themeMedia?: SpecimenContext['themeMedia'];
}

export type PointTarget = { selector: string } | { role: string; name?: string };

export type PointRequest =
	| {
			pointer: string;
			timeoutMs?: number;
	  }
	| {
			id: string;
			context?: PointContextInput;
			checkpoint?: string;
			target: PointTarget;
			timeoutMs?: number;
	  };

export type PointMoveDirection = 'parent' | 'child' | 'next' | 'previous' | 'component';

export interface PointMoveRequest {
	id: string;
	to: PointMoveDirection;
	index?: number;
	timeoutMs?: number;
}

export interface PointCheckRequest {
	id: string;
	timeoutMs?: number;
}

export interface PointNodeSummary {
	tag: string;
	role?: string;
	name?: string;
}

export interface Point {
	id: string;
	specimen: string;
	checkpoint?: string;
	context: Record<string, string>;
	element: {
		ref: string;
		tag: string;
		text: string;
		box: { x: number; y: number; width: number; height: number };
	};
	accessible: {
		role?: string;
		name?: string;
		from?: string;
	};
	identity: {
		strongest: 'role-name' | 'component-position' | 'ref';
		roleName?: { role: string; name: string };
		componentPosition?: { tag: string; index: number };
		ref: string;
	};
	component?: {
		tag: string;
		module?: string;
	};
	source: {
		specimen: { module: string; exportName: string };
		component?: { module: string };
		revision?: string;
		digest?: string;
		digests: Record<string, string>;
	};
	ancestors: PointNodeSummary[];
	neighbourhood: {
		pageData: true;
		parent?: PointNodeSummary;
		siblings: PointNodeSummary[];
		children: PointNodeSummary[];
		omitted: { siblings: number; children: number };
	};
	pin: { x: number; y: number };
	check: {
		command: 'specimen-point-check';
		when: 'before editing source for this point';
	};
}

export interface PointResult {
	point: Point;
}

export interface PointCheckResult {
	status: 'current' | 'stale';
	changed: string[];
}
