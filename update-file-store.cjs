const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'packages/examples/todo/backends/typescript/src/store/file.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// Check if note methods already exist
if (content.includes('createNote(')) {
  console.log('Note methods already exist');
  process.exit(0);
}

// Update import
content = content.replace(
  /import type \{ Todo, TodoFilter, TodoStats, Priority, List, ListFilter \} from "\.\.\/types\.js";/,
  'import type { Todo, TodoFilter, TodoStats, Priority, List, ListFilter, Note, NoteFolder, NoteFilter, NoteFolderFilter } from "../types.js";'
);

// Add file paths for notes and folders
content = content.replace(
  'private filePath: string;\n  private listsFilePath: string;',
  `private filePath: string;
  private listsFilePath: string;
  private notesFilePath: string;
  private noteFoldersFilePath: string;`
);

// Add initialization for notesFilePath and noteFoldersFilePath in constructor
content = content.replace(
  /this\.listsFilePath = filePath\s*\n\s*\? filePath\.replace\(\/\\\.json\$\/, '-lists\.json'\)\s*\n\s*: resolve\(__dirname, "\.\.".+?"data", "lists\.json"\);/,
  `this.listsFilePath = filePath
      ? filePath.replace(/\\.json$/, '-lists.json')
      : resolve(__dirname, "..", "..", "..", "..", "data", "lists.json");
    this.notesFilePath = filePath
      ? filePath.replace(/\\.json$/, '-notes.json')
      : resolve(__dirname, "..", "..", "..", "..", "data", "notes.json");
    this.noteFoldersFilePath = filePath
      ? filePath.replace(/\\.json$/, '-notefolders.json')
      : resolve(__dirname, "..", "..", "..", "..", "data", "notefolders.json");`
);

// Add file initialization for notes and notefolders
content = content.replace(
  /if \(!existsSync\(this\.listsFilePath\)\) \{\s*\n\s*this\.saveLists\(new Map\(\)\);\s*\n\s*\}/,
  `if (!existsSync(this.listsFilePath)) {
      this.saveLists(new Map());
    }
    if (!existsSync(this.notesFilePath)) {
      this.saveNotes(new Map());
    }
    if (!existsSync(this.noteFoldersFilePath)) {
      this.saveNoteFolders(new Map());
    }`
);

// Update clear() method
content = content.replace(
  /clear\(\): void \{\s*\n\s*this\.saveTodos\(new Map\(\)\);\s*\n\s*this\.saveLists\(new Map\(\)\);\s*\n\s*\}/,
  `clear(): void {
    this.saveTodos(new Map());
    this.saveLists(new Map());
    this.saveNotes(new Map());
    this.saveNoteFolders(new Map());
  }`
);

const noteMethods = `

  // ==================== Note Methods ====================

  private loadNotes(): Map<string, Note> {
    try {
      const data = readFileSync(this.notesFilePath, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        const map = new Map<string, Note>();
        for (const note of parsed) { map.set(note.id, note); }
        return map;
      }
      return new Map(Object.entries(parsed));
    } catch { return new Map(); }
  }

  private saveNotes(notes: Map<string, Note>): void {
    const data = Array.from(notes.values());
    writeFileSync(this.notesFilePath, JSON.stringify(data, null, 2), "utf-8");
  }

  createNote(data: { title: string; content: string; folderId?: string }): Note {
    const notes = this.loadNotes();
    const note: Note = {
      id: generateId('note'),
      title: data.title,
      content: data.content,
      folderId: data.folderId,
      createdAt: now(),
      updatedAt: now(),
    };
    notes.set(note.id, note);
    this.saveNotes(notes);
    return note;
  }

  getNote(id: string): Note | undefined {
    return this.loadNotes().get(id);
  }

  listNotes(filter: NoteFilter = {}): Note[] {
    const notes = this.loadNotes();
    let results = Array.from(notes.values());
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter((n) => n.title.toLowerCase().includes(search) || n.content.toLowerCase().includes(search));
    }
    if (filter.folderId !== undefined) {
      if (filter.folderId === null) { results = results.filter((n) => !n.folderId); }
      else { results = results.filter((n) => n.folderId === filter.folderId); }
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
    const notes = this.loadNotes();
    const note = notes.get(id);
    if (!note) return undefined;
    const filtered: Partial<Pick<Note, 'title' | 'content' | 'folderId'>> = {};
    if (data.title !== undefined) filtered.title = data.title;
    if (data.content !== undefined) filtered.content = data.content;
    if (data.folderId !== undefined) filtered.folderId = data.folderId === null ? undefined : data.folderId;
    const updated: Note = { ...note, ...filtered, updatedAt: now() };
    notes.set(id, updated);
    this.saveNotes(notes);
    return updated;
  }

  deleteNote(id: string): boolean {
    const notes = this.loadNotes();
    const existed = notes.delete(id);
    if (existed) this.saveNotes(notes);
    return existed;
  }

  countNotes(): number { return this.loadNotes().size; }
  clearNotes(): void { this.saveNotes(new Map()); }
  getNotesInFolder(folderId: string): Note[] {
    return Array.from(this.loadNotes().values()).filter((n) => n.folderId === folderId);
  }

  // ==================== NoteFolder Methods ====================

  private loadNoteFolders(): Map<string, NoteFolder> {
    try {
      const data = readFileSync(this.noteFoldersFilePath, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        const map = new Map<string, NoteFolder>();
        for (const folder of parsed) { map.set(folder.id, folder); }
        return map;
      }
      return new Map(Object.entries(parsed));
    } catch { return new Map(); }
  }

  private saveNoteFolders(folders: Map<string, NoteFolder>): void {
    const data = Array.from(folders.values());
    writeFileSync(this.noteFoldersFilePath, JSON.stringify(data, null, 2), "utf-8");
  }

  createNoteFolder(data: { name: string; description?: string }): NoteFolder {
    const folders = this.loadNoteFolders();
    const folder: NoteFolder = {
      id: generateId('folder'),
      name: data.name,
      description: data.description,
      createdAt: now(),
      updatedAt: now(),
    };
    folders.set(folder.id, folder);
    this.saveNoteFolders(folders);
    return folder;
  }

  getNoteFolder(id: string): NoteFolder | undefined { return this.loadNoteFolders().get(id); }

  listNoteFolders(filter: NoteFolderFilter = {}): NoteFolder[] {
    const folders = this.loadNoteFolders();
    let results = Array.from(folders.values());
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
    const folders = this.loadNoteFolders();
    const folder = folders.get(id);
    if (!folder) return undefined;
    const filtered: Partial<Pick<NoteFolder, 'name' | 'description'>> = {};
    if (data.name !== undefined) filtered.name = data.name;
    if (data.description !== undefined) filtered.description = data.description;
    const updated: NoteFolder = { ...folder, ...filtered, updatedAt: now() };
    folders.set(id, updated);
    this.saveNoteFolders(folders);
    return updated;
  }

  deleteNoteFolder(id: string): boolean {
    const folders = this.loadNoteFolders();
    const existed = folders.delete(id);
    if (existed) this.saveNoteFolders(folders);
    return existed;
  }

  countNoteFolders(): number { return this.loadNoteFolders().size; }
  clearNoteFolders(): void { this.saveNoteFolders(new Map()); }
`;

// Add note methods before closing brace of class
content = content.replace(/\n\}(\n*)$/, noteMethods + '}\n');

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Added note methods to file.ts');
