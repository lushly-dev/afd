import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

export interface List {
	_id: Id<'lists'>;
	name: string;
	color?: string;
	todoIds: Id<'todos'>[];
	userId: Id<'users'>;
	createdAt: number;
	updatedAt: number;
}

export function useConvexLists() {
	const convexLists = useQuery(api.lists.list);

	const createMutation = useMutation(api.lists.create);
	const updateMutation = useMutation(api.lists.update);
	const removeMutation = useMutation(api.lists.remove);

	// Convert Convex types to frontend types
	const lists: List[] | undefined = convexLists?.map((list) => ({
		_id: list._id,
		name: list.name,
		color: list.color,
		todoIds: list.todoIds,
		userId: list.userId,
		createdAt: list.createdAt,
		updatedAt: list.updatedAt,
	}));

	return {
		lists,
		isLoading: lists === undefined,
		create: createMutation,
		update: updateMutation,
		remove: removeMutation,
	};
}
