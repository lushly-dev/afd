/**
 * List Store - SQLite-backed list storage
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { List } from '../commands.js';

export class ListStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        icon TEXT,
        position INTEGER DEFAULT 0,
        isArchived INTEGER DEFAULT 0
      )
    `);

    // Create default Inbox list if not exists
    const inbox = this.db.prepare('SELECT id FROM lists WHERE id = ?').get('inbox');
    if (!inbox) {
      this.db.prepare(`
        INSERT INTO lists (id, name, icon, position)
        VALUES ('inbox', 'Inbox', '📥', 0)
      `).run();
    }
  }

  create(input: {
    name: string;
    color?: string;
    icon?: string;
  }): List {
    const id = randomUUID();
    const position = this.getNextPosition();

    const list: List = {
      id,
      name: input.name,
      color: input.color,
      icon: input.icon,
      position,
      isArchived: false,
    };

    this.db.prepare(`
      INSERT INTO lists (id, name, color, icon, position, isArchived)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      list.id,
      list.name,
      list.color || null,
      list.icon || null,
      list.position,
      0,
    );

    return list;
  }

  list(filters: { includeArchived?: boolean } = {}): List[] {
    let sql = 'SELECT * FROM lists';
    if (!filters.includeArchived) {
      sql += ' WHERE isArchived = 0';
    }
    sql += ' ORDER BY position ASC';

    const rows = this.db.prepare(sql).all() as any[];
    return rows.map(this.rowToList);
  }

  update(id: string, updates: Partial<List>): List {
    const list = this.get(id);
    if (!list) throw new Error(`List ${id} not found`);

    const updatedList = { ...list, ...updates };

    this.db.prepare(`
      UPDATE lists SET
        name = ?, color = ?, icon = ?, position = ?, isArchived = ?
      WHERE id = ?
    `).run(
      updatedList.name,
      updatedList.color || null,
      updatedList.icon || null,
      updatedList.position,
      updatedList.isArchived ? 1 : 0,
      id,
    );

    return updatedList;
  }

  delete(id: string): void {
    if (id === 'inbox') throw new Error('Cannot delete Inbox');
    this.db.prepare('DELETE FROM lists WHERE id = ?').run(id);
  }

  private get(id: string): List | null {
    const row = this.db.prepare('SELECT * FROM lists WHERE id = ?').get(id) as any;
    return row ? this.rowToList(row) : null;
  }

  private getNextPosition(): number {
    const row = this.db.prepare('SELECT MAX(position) as maxPos FROM lists').get() as any;
    return (row?.maxPos || 0) + 1;
  }

  private rowToList(row: any): List {
    return {
      id: row.id,
      name: row.name,
      color: row.color || undefined,
      icon: row.icon || undefined,
      position: row.position,
      isArchived: Boolean(row.isArchived),
    };
  }
}
