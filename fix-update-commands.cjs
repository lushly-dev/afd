const fs = require('fs');
const path = require('path');

// Fix note-update.ts
const noteUpdatePath = path.join(__dirname, 'packages/examples/todo/backends/typescript/src/commands/note-update.ts');
let noteUpdateContent = fs.readFileSync(noteUpdatePath, 'utf-8');

// Replace the return statement to use non-null assertion
noteUpdateContent = noteUpdateContent.replace(
  /const note = store\.updateNote\(input\.id, \{ title: input\.title, content: input\.content, folderId: input\.folderId \}\);/,
  `const note = store.updateNote(input.id, { title: input.title, content: input.content, folderId: input.folderId })!;`
);

noteUpdateContent = noteUpdateContent.replace(
  /return success\(note, \{ reasoning: 'Updated note "' \+ note\.title \+ '"', confidence: 1\.0 \}\);/,
  `return success(note, { reasoning: 'Updated note "' + note.title + '"', confidence: 1.0 });`
);

fs.writeFileSync(noteUpdatePath, noteUpdateContent, 'utf-8');
console.log('Fixed note-update.ts');

// Fix notefolder-update.ts
const folderUpdatePath = path.join(__dirname, 'packages/examples/todo/backends/typescript/src/commands/notefolder-update.ts');
let folderUpdateContent = fs.readFileSync(folderUpdatePath, 'utf-8');

// Replace the return statement to use non-null assertion
folderUpdateContent = folderUpdateContent.replace(
  /const folder = store\.updateNoteFolder\(input\.id, \{ name: input\.name, description: input\.description \}\);/,
  `const folder = store.updateNoteFolder(input.id, { name: input.name, description: input.description })!;`
);

fs.writeFileSync(folderUpdatePath, folderUpdateContent, 'utf-8');
console.log('Fixed notefolder-update.ts');
