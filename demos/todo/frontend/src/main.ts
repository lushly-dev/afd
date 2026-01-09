/**
 * AFD Todo App - Main Entry Point
 */
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { client, type CommandLogEntry } from './client.js';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'completed';
  listId: string;
  dueDate?: string;
  priority: 0 | 1 | 2 | 3;
}

interface List {
  id: string;
  name: string;
  icon?: string;
}

@customElement('todo-app')
export class TodoApp extends LitElement {
  @state() tasks: Task[] = [];
  @state() lists: List[] = [];
  @state() activeView: string = 'inbox';
  @state() newTaskTitle: string = '';
  @state() devMode: boolean = false;
  @state() commandLog: CommandLogEntry[] = [];

  static styles = css`
    :host {
      display: block;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    // Check for dev mode in URL
    this.devMode = new URLSearchParams(window.location.search).has('dev');
    
    // Set up command log callback
    client.setLogCallback((log) => {
      this.commandLog = [...log];
    });

    // Load initial data
    this.loadLists();
    this.loadTasks();
  }

  async loadLists() {
    try {
      const result = await client.execute<List[]>('list-list', {});
      this.lists = result.data;
    } catch (e) {
      console.error('Failed to load lists:', e);
    }
  }

  async loadTasks() {
    try {
      const filters: Record<string, unknown> = {};
      
      if (this.activeView === 'inbox') {
        filters.listId = 'inbox';
        filters.status = 'pending';
      } else if (this.activeView === 'today') {
        filters.dueDate = new Date().toISOString().split('T')[0];
        filters.status = 'pending';
      } else if (this.activeView === 'completed') {
        filters.status = 'completed';
      } else {
        filters.listId = this.activeView;
        filters.status = 'pending';
      }

      const result = await client.execute<Task[]>('task-list', filters);
      this.tasks = result.data;
    } catch (e) {
      console.error('Failed to load tasks:', e);
    }
  }

  async addTask() {
    if (!this.newTaskTitle.trim()) return;

    try {
      await client.execute('task-create', {
        title: this.newTaskTitle,
        listId: this.activeView === 'inbox' ? 'inbox' : this.activeView,
      });
      this.newTaskTitle = '';
      await this.loadTasks();
    } catch (e) {
      console.error('Failed to create task:', e);
    }
  }

  async toggleTask(task: Task) {
    try {
      const command = task.status === 'completed' ? 'task-uncomplete' : 'task-complete';
      await client.execute(command, { id: task.id });
      await this.loadTasks();
    } catch (e) {
      console.error('Failed to toggle task:', e);
    }
  }

  setActiveView(view: string) {
    this.activeView = view;
    this.loadTasks();
  }

  toggleDevDrawer() {
    const drawer = this.renderRoot.querySelector('.dev-drawer');
    drawer?.classList.toggle('open');
  }

  render() {
    return html`
      <link rel="stylesheet" href="/src/styles.css">
      <div class="app">
        <aside class="sidebar">
          <div class="sidebar-header">
            <span style="font-size: 24px;">✅</span>
            <h1>AFD Todo</h1>
          </div>

          <nav class="nav-section">
            <div 
              class="nav-item ${this.activeView === 'inbox' ? 'active' : ''}"
              @click=${() => this.setActiveView('inbox')}>
              <span class="nav-item-icon">📥</span>
              Inbox
            </div>
            <div 
              class="nav-item ${this.activeView === 'today' ? 'active' : ''}"
              @click=${() => this.setActiveView('today')}>
              <span class="nav-item-icon">📅</span>
              Today
            </div>
            <div 
              class="nav-item ${this.activeView === 'completed' ? 'active' : ''}"
              @click=${() => this.setActiveView('completed')}>
              <span class="nav-item-icon">✓</span>
              Completed
            </div>
          </nav>

          <nav class="nav-section">
            <div class="nav-section-title">Lists</div>
            ${this.lists.filter(l => l.id !== 'inbox').map(list => html`
              <div 
                class="nav-item ${this.activeView === list.id ? 'active' : ''}"
                @click=${() => this.setActiveView(list.id)}>
                <span class="nav-item-icon">${list.icon || '📁'}</span>
                ${list.name}
              </div>
            `)}
          </nav>
        </aside>

        <main class="main">
          <header class="main-header">
            <h2 class="main-title">${this.getViewTitle()}</h2>
          </header>

          <div class="task-list">
            ${this.tasks.length === 0 ? html`
              <div class="empty-state">
                <div class="empty-state-icon">🎉</div>
                <div class="empty-state-text">No tasks here!</div>
              </div>
            ` : this.tasks.map(task => html`
              <div class="task-item ${task.status === 'completed' ? 'completed' : ''}">
                <div 
                  class="task-checkbox ${task.status === 'completed' ? 'checked' : ''}"
                  @click=${() => this.toggleTask(task)}>
                </div>
                <div class="task-content">
                  <div class="task-title">${task.title}</div>
                  <div class="task-meta">
                    ${task.dueDate ? html`
                      <span class="task-due">📅 ${task.dueDate}</span>
                    ` : ''}
                    ${task.priority > 0 ? html`
                      <span class="task-priority p${task.priority}"></span>
                    ` : ''}
                  </div>
                </div>
              </div>
            `)}
          </div>

          ${this.activeView !== 'completed' ? html`
            <div class="add-task">
              <input 
                type="text" 
                placeholder="Add a task..."
                .value=${this.newTaskTitle}
                @input=${(e: Event) => this.newTaskTitle = (e.target as HTMLInputElement).value}
                @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this.addTask()}>
              <button @click=${this.addTask}>Add</button>
            </div>
          ` : ''}
        </main>

        ${this.devMode ? html`
          <div class="dev-drawer">
            <div class="dev-drawer-header">
              <span class="dev-drawer-title">🔧 Developer Tools</span>
              <button @click=${this.toggleDevDrawer}>Close</button>
            </div>
            <div class="command-log">
              ${this.commandLog.map(entry => html`
                <div class="command-log-item">
                  <span class="command-name">${entry.command}</span>
                  <span class="latency">${entry.latency}</span>
                  <div class="confidence">
                    Confidence: ${(entry.confidence * 100).toFixed(0)}%
                  </div>
                </div>
              `)}
            </div>
          </div>
          <div class="dev-toggle" @click=${this.toggleDevDrawer}>
            🔧 Dev Mode
          </div>
        ` : ''}
      </div>
    `;
  }

  private getViewTitle(): string {
    if (this.activeView === 'inbox') return 'Inbox';
    if (this.activeView === 'today') return 'Today';
    if (this.activeView === 'completed') return 'Completed';
    const list = this.lists.find(l => l.id === this.activeView);
    return list?.name || 'Tasks';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'todo-app': TodoApp;
  }
}
