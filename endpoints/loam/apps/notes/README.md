# Notes

Loam's first document type, native: a note is text a person writes in the editor area, at workspace
level or in a project. It has no rail entry, sidebar or main: its documents open in the editor area,
from the command palette or an agent's `document-open`, and `notes-editor` holds a draft until it
saves, every two seconds after an edit, on Mod+S and when its tab closes. `notes-content-get`,
`notes-content-set` (undoable), `notes-export` and `notes-import` are its instance commands, so the
shell checks each note's scope and type first. It lands with no shell change: no file of the kernel,
the chrome or the web host names it. A link in its text is `[[<document id>|<title>]]`, which `Insert
link` writes; `Embed` shows another document under the text, read-only. After each save the editor
brings the shell's links to what the note links and embeds; `notes-inspector` lists its links and
backlinks within its own scope, and `notes-embed` is a note as another document embeds it.

Trusted, not sandboxed. Native apps share the shell's page, so this app's grants are a contract, not a
boundary. Ship untrusted code as a view.
