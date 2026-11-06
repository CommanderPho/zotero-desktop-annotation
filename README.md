# Zotero Desktop Annotation

Desktop refinements for Zotero 7 PDF reader annotations.

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

## Features

### Tool hotkeys

When a reader tab is active and you are not typing in a field:

| Key | Tool |
| --- | --- |
| `t` | Text |
| `b` | Box / area (`image`) |
| `f` | Free-draw (`ink`) |
| `n` | Note |
| `u` | Underline |
| `i` | Highlight |
| `e` | Eraser |

Disable via **Preferences → Desktop Annotation → Enable annotation tool hotkeys**.

### Text style memory

- Remembers last text annotation **font size** and **color**
- Reader toolbar adds size −/＋, numeric input (min **4 pt**), and color swatches
- Stock Zotero slider may still bottom at 6 pt; the plugin size is applied through the reader tool API

### Copy / paste text annotations

With a text annotation selected (not while editing its contents):

- `Ctrl/Cmd+C` copies the annotation
- `Ctrl/Cmd+V` pastes a duplicate offset on the page

### Smaller note icons

Sticky-note markers on the PDF are scaled by **Note icon size percent** (default `50`). Set to `100` for stock size.

## Development

Requires `zotero-plugin-scaffold` `^0.9.3`.

```powershell
cp .env.example .env   # if needed
npm install
npm start              # or .\dev.ps1
npm run build
```

With `npm start`, Scaffold writes Zotero `debug`/`dump` output under `.scaffold/logs/` (paths are printed in the serve console). Browser Console `console.*` / uncaught errors are separate and still need to be copied from DevTools.

See [GOAL.md](./GOAL.md) for the product checklist.

## License

AGPL-3.0-or-later (from the Zotero plugin template).
