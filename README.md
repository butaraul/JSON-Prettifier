# JSON Prettifier

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Made with JavaScript](https://img.shields.io/badge/Made%20with-JavaScript-F7DF1E.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4.svg)](https://developer.chrome.com/docs/extensions/)
[![GitHub stars](https://img.shields.io/github/stars/butaraul/JSON-Prettifier.svg?style=social)](https://github.com/butaraul/JSON-Prettifier/stargazers)

**Beautiful JSON visualization in your browser.**

JSON Vision turns the raw wall of text your browser shows for a JSON response into a fast, interactive, devtools-inspired tree: collapsible nodes, instant search, keyboard navigation, and a dark mode that doesn't fight your eyes at 2 a.m. — all running 100% locally, with zero network requests.

<!-- Screenshot: full-window light-mode view of a formatted JSON API response,
     showing the toolbar (search bar, expand/collapse buttons, copy, theme
     toggle), line numbers down the left, and a few expanded/collapsed nodes
     with syntax-colored keys/strings/numbers. -->

<!-- Screenshot: the same view in dark mode, ideally showing an active search
     with the match counter (e.g. "3/12 matches") and highlighted matches. -->


<!-- Demo GIF: a short (10–15s) screen recording showing: opening a JSON API
     URL, the page auto-formatting, typing a search query, jumping between
     matches with Enter, expanding/collapsing a node, and toggling dark mode. -->

## Features

-  **Instant search** across every key and value, with a live match counter (`3/12 matches`) and one-keystroke jump between results
-  **Devtools-inspired tree view** with syntax-colored keys, strings, numbers, booleans, and `null`
-  **Virtual scrolling** — smoothly handles arrays and objects with tens of thousands of entries by only rendering what's on screen
-  **One-click copy** — copy the whole document, a single selected node, or just a value's JSON path (double-click any key)
-  **Light / dark / system theme**, remembered across every tab you open
-  **Preferences saved locally** via `chrome.storage` — nothing ever leaves your machine
-  **Full keyboard navigation** — arrow through the tree, expand/collapse, search, and copy without touching the mouse
-  **Line numbers** you can click to select an entire line, with a hover tooltip showing the full JSON path
-  **Expand All / Collapse All** for jumping between a bird's-eye view and a focused one
-  **Zero network requests, zero analytics, zero `eval()`** — see [PRIVACY.md](PRIVACY.md)
-  **Responsive layout** that stays usable on narrow windows and small screens

## Installation

### From the Chrome Web Store

*Coming soon.* JSON Vision hasn't been published yet — for now, install it manually using developer mode (below). This section will be updated with a direct install link once it's live.

### Manual installation (Developer Mode)

You don't need any build tools — JSON Vision is plain HTML/CSS/JS and runs directly from source.

1. **Download the code.**
   - Click the green **Code** button on the [GitHub repository](https://github.com/butaraul/json-vision) → **Download ZIP**, then unzip it somewhere you'll remember (e.g. `~/Downloads/json-vision`).
   - Or, if you have Git installed: `git clone https://github.com/your-username/json-vision.git`
2. **Open Chrome's extensions page.**
   - Type `chrome://extensions` into your address bar and press Enter, or go to Chrome's menu (⋮) → **Extensions** → **Manage Extensions**.
3. **Turn on Developer mode.**
   - In the top-right corner of the Extensions page, toggle **Developer mode** on. Three new buttons will appear: *Load unpacked*, *Pack extension*, and *Update*.
4. **Load the extension.**
   - Click **Load unpacked**.
   - In the file picker, select the `json-vision` folder you downloaded/cloned in step 1 (the one containing `manifest.json` — not a subfolder). Click **Select**.
5. **Confirm it's installed.**
   - JSON Vision should now appear in your extensions list with its icon, and its toolbar icon (a rounded blue square with `{ }`) should appear in Chrome's toolbar (click the puzzle-piece icon to pin it if you don't see it).
6. **Try it out.**
   - Visit any URL that returns raw JSON — for example [`https://jsonplaceholder.typicode.com/users`](https://jsonplaceholder.typicode.com/users) — and the page should instantly render as an interactive tree instead of plain text.

That's it — no `npm install`, no build step. If you edit the source, just click the refresh icon on JSON Vision's card in `chrome://extensions` to reload your changes.

## Usage Guide

1. **Open a JSON URL.** Any page whose response `Content-Type` is `application/json` (or ends in `+json`) — an API endpoint, a `.json` file, etc. — is automatically reformatted.
2. **Browse the tree.** Click the ▶ arrow next to any object or array to expand or collapse it. Collapsed containers show a small summary like `{…} 4 keys` so you know what's inside without opening it.
3. **Search.** Click the search bar (or press `Ctrl+F` / `⌘F`), start typing, and matches highlight as you type (debounced — it waits until you pause). The counter shows where you are (`3/12 matches`); press `Enter` / `Shift+Enter` or the ↑/↓ buttons to jump between them. Ancestors of a match are auto-expanded so you can always see it.
4. **Copy things.**
   - Click 📋 in the toolbar to copy the **entire** JSON document, pretty-printed.
   - Click a line to select it, then press `Ctrl+C` / `⌘C` to copy **just that node** (and everything inside it) as JSON.
   - Double-click any key to copy its **path** (e.g. `data.items[3].name`) to your clipboard — handy for writing `jq` filters or code that reaches into the response.
5. **Line numbers.** Click a line number to select that entire line; hover any row to see its full path in a tooltip.
6. **Switch themes.** Click the moon in the toolbar to toggle light/dark. Your choice is remembered for every JSON page you open afterward (configurable from the extension's popup, too).

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+F` / `⌘F` | Focus the search bar |
| `Escape` | Clear search (press again to unfocus) / deselect the current line |
| `Enter` | Jump to the next search match |
| `Shift+Enter` | Jump to the previous search match |
| `Ctrl+C` / `⌘C` | Copy the selected node (or the whole document, after Select All) |
| `Ctrl+A` / `⌘A` | Select the entire document — press `Ctrl+C` afterward to copy it all |
| `↑` / `↓` | Move the selection up/down one line |
| `→` | Expand the selected node, or move into its first child if already expanded |
| `←` | Collapse the selected node, or jump to its parent if already collapsed/a leaf |

### Tips and tricks

- Searching also matches array indices and object keys, not just values — try searching for a field name you know exists.
- Use **Collapse All** first on a huge response, then expand only the branches you care about — it's much faster to scan.
- The path copied by double-clicking a key is ready to paste into `jq`, JavaScript optional-chaining, or Python's dict access (with light editing).
- If a page *looks* like JSON but JSON Vision doesn't kick in, it's most likely served with the wrong `Content-Type` header (e.g. `text/plain`) — JSON Vision deliberately only activates on documents the browser itself identifies as JSON, to avoid ever touching a page it shouldn't.

## Why I Built This

Every browser already shows you raw JSON when you hit an API endpoint directly, but the built-in viewer is minimal — no real search, no path copying, no persistent dark mode, and it struggles with anything but small responses. I wanted something that felt like a proper devtools panel: fast even on huge payloads, keyboard-driven, and trustworthy enough to point at a raw production response without a second thought (which is why it makes zero network calls and never uses `eval`). JSON Vision is that tool.

## Tech Stack

-  **Chrome Extensions (Manifest V3)** — content script + service worker, no bundler required
-  **Vanilla JavaScript** — no frameworks, no dependencies, no build step
-  **CSS3** — custom properties for theming, flexbox layout, CSS transitions/animations
-  **Chrome Storage API** (`chrome.storage.local`) — local-only preference persistence

## Project Structure

```
json-vision/
├── manifest.json          # Manifest V3 config: permissions, content scripts, icons
├── background.js          # Service worker — seeds default settings on install
├── content/
│   ├── content.js         # Core viewer: JSON parsing, tree model, virtual
│   │                       #   scrolling, search, keyboard nav, theming
│   └── content.css         # Devtools-inspired styles (light/dark, responsive)
├── popup/
│   ├── popup.html         # Toolbar popup UI
│   ├── popup.css          # Popup styles
│   └── popup.js           # Reads/writes preferences via chrome.storage
├── icons/
│   ├── icon.svg            # Vector source for the extension icon
│   ├── icon16.png          # Toolbar icon
│   ├── icon48.png          # Extensions page icon
│   └── icon128.png         # Chrome Web Store / install dialog icon
├── README.md
├── PRIVACY.md
├── LICENSE
└── .gitignore
```

## Contributing

Contributions are very welcome, whether that's a bug fix, a new feature, or a docs improvement.

1. Fork the repository and create a branch off `main`: `git checkout -b my-feature`.
2. Make your changes. Since there's no build step, just reload the unpacked extension in `chrome://extensions` to test them.
3. Keep the project's constraints in mind: no external network requests, no `eval`/`Function`, no new dependencies unless there's a strong reason.
4. Open a pull request describing what changed and why. Screenshots or a short clip are appreciated for anything UI-visible.

**Reporting bugs:** please open a [GitHub issue](https://github.com/your-username/json-vision/issues) with steps to reproduce, what you expected, what happened instead, and your Chrome version. A sample JSON payload (if the bug is data-specific) helps a lot.

**Suggesting features:** open an issue describing the use case, not just the solution — it makes it easier to find the best way to support it.

## License

Released under the [MIT License](LICENSE).

```
MIT License

Copyright (c) 2026 [Your Name]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Support

Found a bug or have a question? Please open an issue on [GitHub Issues](https://github.com/your-username/json-vision/issues) — that's the best way to reach the maintainers and keeps the history searchable for everyone else hitting the same thing.

## Acknowledgments

- Inspired by the built-in JSON viewers in Chrome DevTools and popular extensions like JSONVue and JSON Formatter, with an emphasis on speed and keyboard-first navigation.
- Thanks to everyone who files issues, tests pre-release builds, and contributes fixes — open source only works because people show up for it.
