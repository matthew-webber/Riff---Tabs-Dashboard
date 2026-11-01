# Riff

A small macOS app for saving and finding guitar tabs, organized by tuning.

Riff is a bookmark manager built for guitarists. Save a tab from your browser in one click, then come back later, pick your tuning, find the song, and open it.

```
riff-app/
├── src/                React + TypeScript UI (Tailwind v4, Radix primitives)
├── src-tauri/          Tauri 2 backend (Rust, SQLite via rusqlite)
│   └── src/
│       ├── db.rs       library storage, upserts, tags
│       ├── tuning.rs   tuning normalization ("dadgbe" → "Drop D")
│       ├── urls.rs     URL cleanup + duplicate keys
│       ├── server.rs   loopback API for the browser extension
│       └── lib.rs      commands, riff:// deep links, window behavior
├── extension/          Browser extension (Manifest V3, no build step)
└── assets/             Icon sources
```

## Running it

Prerequisites: Rust (stable), Node 20+, Xcode command-line tools.

```sh
npm install
npm run app        # tauri dev: native window with hot reload
npm run dev        # UI only, in a browser, with an in-memory mock backend
npm test           # Rust unit tests (tuning, URL dedupe, library)
npm run bundle     # build Riff.app + .dmg into src-tauri/target/release/bundle
```

The library lives at `~/Library/Application Support/app.riff.desktop/riff.sqlite`.

## Browser extension

1. Open `chrome://extensions` (Chrome, Arc, Brave and Edge all work the same way) and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder.
3. Pin the Riff button. The keyboard shortcut is **⌥⇧R**; you can change it at `chrome://extensions/shortcuts`.

On a tab page, click the button. The popup fills in title, artist and tuning when it can work them out (the tuning uses Riff's name for it, so `EADGBe` shows as **Standard**; a new tab with no tuning on the page defaults to Standard), and saves **when it closes**: click away, press Esc or press ↩. To skip saving, press **Discard**. If the URL is already in your library, the popup shows the saved entry and saves any edits you make. It also shows a **Remove from Riff** button, which deletes the entry and closes the popup. Riff then shows a toast with **Undo**, in case it was a misclick.

### How the extension talks to the app

| Riff state | Transport | Behavior |
| --- | --- | --- |
| Running (window open or closed) | `POST` / `DELETE http://127.0.0.1:47813/api/tabs` | Silent. The badge shows ✓ and the app shows a toast. |
| Not running | `riff://add?url=…&title=…` | macOS launches Riff, which saves the tab. Chrome asks once whether to open Riff links. |

The plan called for the `riff:` URI scheme only. I added the loopback API as the main channel because the URI scheme alone can't:

- check for duplicates before saving,
- suggest your existing tags,
- save without a browser prompt or a focus change.

The URI scheme is still the fallback.

The API accepts requests only from browser-extension origins and only with an `X-Riff-Client` header. Web pages can't send that header cross-origin without a preflight, and Riff refuses preflights from web origins. It also checks the `Host` header to block DNS rebinding.

On macOS, closing the window keeps Riff running so the extension can keep saving silently. Quit with ⌘Q.

> **Note:** macOS registers `riff://` links only for a bundled app. Build once with `npm run bundle` and open `Riff.app` so the fallback works. In `tauri dev` the loopback API works but deep links don't.

### Supported sites

- **Ultimate Guitar:** title, artist and tuning (from page JSON-LD and the tuner link).
- **Songsterr:** title, artist and tuning (read from the score's open-string notes).
- **Anything else:** JSON-LD, Open Graph, and "Song by Artist" / "Artist - Song" page titles, plus any "Tuning: …" label on the page. Fields the extension can't extract are left blank for you to fill in.

To add a site, add a branch to `extractTabInfo` in `extension/extract.js`.

## Keyboard

| Key | Action |
| --- | --- |
| Type anything / ⌘F / `/` | Search (within the current sidebar view) |
| ↑ ↓ | Move selection (↓ from search jumps into the list) |
| ↩ / double-click | Open in browser (↩ in search opens the top result) |
| ⌘↩ / ⌘E | Edit details |
| ⌘D | Toggle favorite |
| ⌘⌫ | Delete (⌘Z or the toast's Undo restores it) |
| ⌘N | Add tab (or paste a URL anywhere with ⌘V) |
| ⌘1–4 | All / Recently Added / Recently Opened / Favorites |
| ⌘I | Show or hide the details panel |
| ← → | Move between sidebar and list |

## Tunings

Riff stores tunings in canonical form. All of these become **Eb Standard**:

- `Eb Ab Db Gb Bb Eb`
- `D# G# C# F# A# D#`
- `half step down`
- `E♭ standard`

Pickers list the common tunings first, then less common ones (Drop Bb, Double Drop D, Open A, 7-String Drop A…) alphabetically, then any custom tunings in your library.

Note sequences are compared by pitch class, so enharmonic spellings match. A sequence that matches no preset is kept as a custom tuning (`C G C G G C`). An unknown name (`Nashville`) is kept as you typed it. To add presets, edit `PRESETS` in `src-tauri/src/tuning.rs`.

## Deliberate non-goals

Riff doesn't do playback, tab rendering, practice tracking, accounts or sync. See the original brief for the full list.
