# Repository Instructions

Before committing changes:

1. Run `npm run format`.
2. Run `npm run check`.
3. Do not commit if formatting or tests fail.

During iterative development, do not run `npm run format` after every code change. Run it once before committing, or when the user explicitly asks for formatting.

Use the existing vanilla JavaScript structure. Keep schedule generation logic in `src/generator.js`, shared constants in `src/config.js`, browser UI code in `src/ui.js`, time helpers in `src/time.js`, and share-link serialization in `src/share-state.js`.
