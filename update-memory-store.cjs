const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'packages/examples/todo/backends/typescript/src/store/memory.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// Check if note methods already exist
if (content.includes('createNote(')) {
  console.log('Note methods already exist');
  process.exit(0);
}

const noteMethods = `
  // ==================== Note Methods ====================

  createNote(data: { title: string; content: string; folderId?: string }): Note {
    const note: Note = {
      id: generateId('note'),
      title: data.title,
      content: data.content,
      folderId: data.folderId,
      createdAt: now(),
      updatedAt: now(),
    };
    this.notes.set(note.id, note);
    return note;
  }

  getNote(id: string): Note | undefined {
    return this.notes.get(id);
  }

  listNotes(filter: NoteFilter = {}): Note[] {
    let results = Array.from(this.notes.values());
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter((n) => n.title.toLowerCase().includes(search) || n.content.toLowerCase().includes(search));
    }
    if (filter.folderId !== undefined) {
      if (filter.folderId === null) {
        results = results.filter((n) => !n.folderId);
      } else {
        results = results.filter((n) => n.folderId === filter.folderId);
      }
    }
    const sortBy = filter.sortBy ?? 'createdAt';
    const sortOrder = filter.sortOrder ?? 'desc';
    results.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'updatedAt': cmp = a.updatedAt.localeCompare(b.updatedAt); break;
        default: cmp = a.createdAt.localeCompare(b.createdAt);
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return results.slice(offset, offset + limit);
  }

  updateNote(id: string, data: Partial<Pick<Note, 'title' | 'content'>> & { folderId?: string | null }): Note | undefined {
    const note = this.notes.get(id);
    if (!note) return undefined;
    const filtered: Partial<Pick<Note, 'title' | 'content' | 'folderId'>> = {};
    if (data.title !== undefined) filtered.title = data.title;
    if (data.content !== undefined) filtered.content = data.content;
    if (data.folderId !== undefined) filtered.folderId = data.folderId === null ? undefined : data.folderId;
    const updated: Note = { ...note, ...filtered, updatedAt: now() };
    this.notes.set(id, updated);
    return updated;
  }

  deleteNote(id: string): boolean { return this.notes.delete(id); }
  countNotes(): number { return this.notes.size; }
  clearNotes(): void { this.notes.clear(); }
  getNotesInFolder(folderId: string): Note[] {
    return Array.from(this.notes.values()).filter((n) => n.folderId === folderId);
  }

  // ==================== NoteFolder Methods ====================

  createNoteFolder(data: { name: string; description?: string }): NoteFolder {
    const folder: NoteFolder = {
      id: generateId('folder'),
      name: data.name,
      description: data.description,
      createdAt: now(),
      updatedAt: now(),
    };
    this.noteFolders.set(folder.id, folder);
    return folder;
  }

  getNoteFolder(id: string): NoteFolder | undefined { return this.noteFolders.get(id); }

  listNoteFolders(filter: NoteFolderFilter = {}): NoteFolder[] {
    let results = Array.from(this.noteFolders.values());
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter((f) => f.name.toLowerCase().includes(search) || f.description?.toLowerCase().includes(search));
    }
    const sortBy = filter.sortBy ?? 'createdAt';
    const sortOrder = filter.sortOrder ?? 'desc';
    results.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'updatedAt': cmp = a.updatedAt.localeCompare(b.updatedAt); break;
        default: cmp = a.createdAt.localeCompare(b.createdAt);
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return results.slice(offset, offset + limit);
  }

  updateNoteFolder(id: string, data: Partial<Pick<NoteFolder, 'name' | 'description'>>): NoteFolder | undefined {
    const folder = this.noteFolders.get(id);
    if (!folder) return undefined;
    const filtered: Partial<Pick<NoteFolder, 'name' | 'description'>> = {};
    if (data.name !== undefined) filtered.name = data.name;
    if (data.description !== undefined) filtered.description = data.description;
    const updated: NoteFolder = { ...folder, ...filtered, updatedAt: now() };
    this.noteFolders.set(id, updated);
    return updated;
  }

  deleteNoteFolder(id: string): boolean { return this.noteFolders.delete(id); }
  countNoteFolders(): number { return this.noteFolders.size; }
  clearNoteFolders(): void { this.noteFolders.clear(); }
`;

// Insert note methods before the closing brace and memoryStore export
content = content.replace(
  /clearLists\(\): void \{\s*\n?\s*this\.lists\.clear\(\);\s*\n?\s*\}\n\}/,
  `clearLists(): void { this.lists.clear(); }${noteMethods}}`
);

// Update clear() method to include notes and folders
content = content.replace(
  /clear\(\): void \{\s*\n?\s*this\.todos\.clear\(\);\s*\n?\s*this\.lists\.clear\(\);\s*\n?\s*\}/,
  'clear(): void { this.todos.clear(); this.lists.clear(); this.notes.clear(); this.noteFolders.clear(); }'
);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Added note methods to memory.ts');
