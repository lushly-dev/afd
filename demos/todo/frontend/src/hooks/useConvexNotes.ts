import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

export interface Note {
	_id: Id<'notes'>;
	title: string;
	content: string;
	folderId?: Id<'noteFolders'>;
	userId: Id<'users'>;
	createdAt: number;
	updatedAt: number;
}

export interface NoteFolder {
	_id: Id<'noteFolders'>;
	name: string;
	userId: Id<'users'>;
	createdAt: number;
}

export function useConvexNotes(folderId?: Id<'noteFolders'>) {
	const convexNotes = useQuery(api.notes.list, folderId ? { folderId } : {});
	const convexFolders = useQuery(api.noteFolders.list);

	const createNoteMutation = useMutation(api.notes.create);
	const updateNoteMutation = useMutation(api.notes.update);
	const removeNoteMutation = useMutation(api.notes.remove);

	const createFolderMutation = useMutation(api.noteFolders.create);
	const updateFolderMutation = useMutation(api.noteFolders.update);
	const removeFolderMutation = useMutation(api.noteFolders.remove);

	// Convert Convex types to frontend types
	const notes: Note[] | undefined = convexNotes?.map((note) => ({
		_id: note._id,
		title: note.title,
		content: note.content,
		folderId: note.folderId,
		userId: note.userId,
		createdAt: note.createdAt,
		updatedAt: note.updatedAt,
	}));

	const folders: NoteFolder[] | undefined = convexFolders?.map((folder) => ({
		_id: folder._id,
		name: folder.name,
		userId: folder.userId,
		createdAt: folder.createdAt,
	}));

	return {
		notes,
		folders,
		isLoading: notes === undefined,
		createNote: createNoteMutation,
		updateNote: updateNoteMutation,
		removeNote: removeNoteMutation,
		createFolder: createFolderMutation,
		updateFolder: updateFolderMutation,
		removeFolder: removeFolderMutation,
	};
}
