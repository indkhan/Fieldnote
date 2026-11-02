# Fieldnote

A local desktop notebook for conversations and interviews. Projects, reusable questionnaire groups, sessions, written answers, microphone recordings, and one/many/all session export. No account or hosted service.

**Website:** https://indkhan.github.io/Fieldnote/

## Download

Get the latest version from **[Releases](https://github.com/indkhan/Fieldnote/releases/latest)**:

| System | File | Notes |
| --- | --- | --- |
| Windows 10/11 | `Fieldnote_*_x64-setup.exe` | Installs for your Windows account. Needs Microsoft Edge WebView2 Runtime (already present on most machines). |
| macOS (Apple Silicon) | `Fieldnote_*_aarch64.dmg` | Drag Fieldnote to Applications. |
| macOS (Intel) | `Fieldnote_*_x64.dmg` | Drag Fieldnote to Applications. |
| Linux | `Fieldnote_*_amd64.AppImage` or `fieldnote_*_amd64.deb` | For AppImage, run `chmod +x` first. Needs WebKitGTK 4.1. |

The macOS builds are not notarized yet. If macOS blocks the first launch, open System Settings → Privacy & Security and choose **Open Anyway**.

### Updates

Fieldnote checks for a new release when it starts. Click **Check for updates** in the footer at any time. When a newer version is available, click **Install** in the footer; the update downloads, installs, and restarts the app. Your data is kept. You cannot install while a recording is in progress or while changes are unsaved.

Versions before 0.3.0 do not include the updater. Install 0.3.0 manually once; later updates happen in the app.

This app was previously called Research. On first launch, Fieldnote moves an existing Research workspace into its own data folder. Close the old app first. The old Research app stays installed until you uninstall it.

### Publishing a release (maintainers)

1. Bump `version` in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Commit, then tag and push: `git tag v0.3.0 && git push origin v0.3.0`.
3. The `Release` workflow builds Windows, macOS (both architectures), and Linux, signs the update files, and attaches them to the release.

The updater signing key is kept outside the repository. Its public half is in `tauri.conf.json`; the private half is the `TAURI_SIGNING_PRIVATE_KEY` repository secret. Losing it means installed copies can no longer be updated in place.

## Project overview in 0.2.0

Switch between **List** and **Table** under Sessions. Both show the same project data, and each project remembers its view, sort, filters, and hidden columns.

Use **+ Column** to add an optional Text, Email, Number, Select, or Date field. Every existing and future session in that project gets the field; old values start empty. Fields belong to the project and remain separate from interview questionnaires. Nothing is automatically filled or inferred.

Edit in a table cell or the session's **Details** section. Press Enter or leave the cell to save. Invalid values remain visible for correction. Valid cell changes are saved independently from questionnaire autosaves, so one cannot overwrite the other. Saving errors retain pending edits for retry.

Sort with a column header or **Sort**. Numbers sort numerically, Select follows its option order, dates sort chronologically, and empty values stay last. **Filter** supports multiple AND rules, including empty/not-empty. Filtering and sorting happen across the whole project before 100-row pagination.

Use **Columns** to rename or hide fields. Hiding keeps the values in session forms and exports. Types/options remain fixed after creation in this version. A project supports up to 100 custom fields and 20 filter rules.

Selection stays attached to session IDs across sorting, filters, and view changes. The header checkbox selects displayed rows; **Select all N results** includes every matching page. The footer shows selected rows outside the current filter. With no selection, export uses the filtered results, or all sessions if no filter/search is active. The preview states the scope. Markdown, JSON, and ZIP exports include all project field definitions and values, including hidden columns; JSON exports now use schema version 2 and preserve empty values explicitly as null.

The SQLite upgrade from workspace schema 1 to 2 is an additive transaction: it creates property tables and indexes without rewriting sessions, questionnaires, or media. Existing workspaces do not receive automatic columns. Installing the update uses the same application data directory.

The app opens by asking which project you are working on. Your first project starts with three editable questionnaire groups; the app contains no fictional interviews.

## Run and build

Requirements: Rust stable with the Windows MSVC build tools, Node.js 22.12+, and Microsoft Edge WebView2 Runtime. The system WebView is shared rather than bundling Chromium with the app.

```sh
npm ci
npm run desktop
```

Create a local release build for the current system (Windows installer on Windows; macOS and Linux bundles must be built on those systems or by the release workflow):

```sh
npm run desktop:build
```

Outputs: `src-tauri/target/release/bundle/`. Update artifacts are produced only when `TAURI_SIGNING_PRIVATE_KEY` is set; the release workflow sets it from the repository secret.

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

## What is implemented

- Project chooser and persistent session list, literal text search, 100-row pages, and explicit selection across search results.
- Named questionnaire groups per project. New sessions copy the questions. Old session questions and answers stay unchanged when a reusable questionnaire changes.
- Title, person/alias, local date, text answers, and notes. Autosave debounces writes and serializes them so older requests cannot overwrite newer edits. Failed writes retain the draft and offer retry; navigating/closing waits for saves.
- Native microphone selection, input level, record/pause/stop, separate takes, and playback. Input is downmixed to mono PCM16 WAV at the device's default sample rate for speech recording. Imported recordings are retained unchanged.
- Incremental recording through a bounded queue and disk writer. Audio callbacks do not perform disk I/O. WAV headers and file contents are checkpointed about once per second. On restart, interrupted app-created WAVs are repaired from their actual file length. A sudden process/power failure may still lose the most recent buffered audio. Device/disk errors are surfaced rather than silently ignored. A WAV take is limited to approximately 4 GB; start another take at the limit.
- **For Claude Code or Codex:** choose your project folder and Fieldnote writes `fieldnote/` into it (`START-HERE.md`, `sessions/`, `audio/`, `sessions.json`, and a `.gitignore` that keeps it out of git), then gives you one message to paste. Export covers every session by default, or tick a few in the list. Each time, Fieldnote compares your sessions with the folder, and the message names only what is new or edited. Transcripts the tool saved are kept. Fieldnote has no AI of its own and never runs or contacts these tools; they do any transcription.
- Markdown, JSON, and streaming ZIP export for one, several, or all sessions. ZIP includes original media bytes under stable paths. Exports are written to a temporary sibling file and committed after success, preserving an existing export if copying fails.
- Single-instance desktop behaviour and native open/save dialogs. Ctrl+S saves immediately; Ctrl+F focuses session search.

## Storage and sharing

The data folder is `%APPDATA%\io.github.indkhan.fieldnote\` on Windows, `~/Library/Application Support/io.github.indkhan.fieldnote/` on macOS, and `~/.local/share/io.github.indkhan.fieldnote/` on Linux:

For isolated development/acceptance checks, the `FIELDNOTE_DATA_DIR` environment variable can override this directory before launching the process. Normal launches require no configuration.

```text
research.sqlite       projects, questionnaires, sessions, answers, media metadata
research.sqlite-wal   SQLite's live transaction journal, when present
audio/                original imports and microphone WAV recordings
```

Click **On this computer** to see the exact location. Audio is served to the WebView only from the app's managed audio directory. No audio or notes are uploaded. Local files are not encrypted by this application; their protection follows the Windows account and disk settings.

Export all sessions as ZIP to keep a portable copy somewhere separate. A session export is not a full database backup/restore feature and does not contain reusable questionnaires that have never been used in an exported session. Back up the complete app-data folder while the app is closed if you need a full workspace backup.

Markdown and JSON contain participant names/aliases exactly as entered, written responses, and notes. An external coding agent may send the exported material to its own model provider. Recordings have no transcription. Microphone capture alone does not capture both sides of an online call; import an existing call recording initially.

## Small stack

Tauri 2, plain TypeScript/CSS, Rust, SQLite/rusqlite, CPAL, and Rust ZIP/file operations. Frontend assets are bundled locally. Idle screens do not poll the database; recording status is polled only during capture. Recordings are not loaded into JavaScript memory for exports or playback. ZIP stores media without compression to avoid spending CPU recompressing interviews. Rust work and file operations run off the GUI thread.

App-created WAV recordings prioritize low CPU use and recoverability. At 48 kHz, mono PCM16 audio takes about 5.8 MB per minute. Imported compressed audio keeps its existing format and size.

## Scope and verification

Built-in AI or transcription, live coding-agent connections, cloud sync, accounts, and collaboration are outside this version. Hardware recording, permission/device changes, long interviews, installer behaviour, and final release signing require target-machine validation. Development builds and the initial locally generated installer are unsigned.

Core checks cover questionnaire snapshot persistence after reopening SQLite, protection of answered questions, literal search, export isolation and original binary audio, stale WAV header recovery, corrupt-file preservation, and serialized/retryable autosaves. See the final implementation status below for the checks actually completed in this workspace.

## Implementation status

- Production TypeScript build and Windows release/NSIS installer generated successfully.
- Ten Rust checks and six frontend checks cover persistence, snapshots, literal search, exact export scope/audio bytes, interrupted recording recovery, failed capture export, preservation of an existing export on missing-media errors, additive schema upgrades, project isolation, typed sorting and filtering across pages, and save ordering/retry across multiple cells.
- The packaged Windows UI was exercised with the Computer Use skill: initial screen and session form, answer autosave on close verified against SQLite, physical microphone enumeration, synthetic audio import, local playback, native file dialogs, and a real ZIP export independently opened with Python. The exported recording matched the source byte for byte.
- The 0.2.0 packaged table was checked against an isolated copy of a real version-1 test workspace. The additive upgrade preserved the old session bodies exactly; optional columns, table/form edits, persisted values, a select-column filter, and the one-result export preview were exercised through the native UI.
- Test interviews and synthetic media were kept under `artifacts/`; the normal app workspace is clear of acceptance-test sessions.
- Final packaged relaunch after the small pointer-refresh fix was blocked by the automatic command approval policy. The final build and automated checks passed; the native table checks above were on the preceding 0.2.0 build.
- Actual microphone capture, long-recording stress tests, device unplug/reconnect, installer execution, and release signing have not been validated. The native recorder is implemented; these remain release acceptance checks rather than simulated features.

License: MIT. Dependencies retain their own licenses.
