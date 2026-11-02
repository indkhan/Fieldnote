# The simple version

> Implementation: the working Tauri/Rust application is now in this folder. See [README.md](README.md) for running, building, storage, completed checks, and remaining acceptance checks. The HTML file remains the design prototype.

This replaces the earlier, broader proposal. Updated after the session-first and questionnaire-group decisions on 2 November 2026.

## What opens

A project chooser and its session list. No account or separate people directory. Each session stores the person's name or alias directly.

List columns: selection checkbox, session title, person, questionnaire name, date, and whether audio is attached. A search box finds sessions by their title, person, questionnaire, notes, questions, or answers.

Buttons: **New session**, **Questionnaires**, and **Export**. Export says **Export all** when nothing is selected, or **Export selected (N)** when one or more sessions are selected. The row checkboxes select one or several sessions. The header checkbox selects visible results; **Select all N** selects the whole project. Selections remain explicit across searches.

## Questionnaire groups

Each project has its own named questionnaires. Example groups are First impressions, Usability test, and Follow-up. The user can create a group, name it, and add or edit its text questions. Keep the first version to text answers.

When a session starts, choose a questionnaire group or **Blank form**. Copy the question IDs and wording into the session, with empty answer fields. A session can have customized questions without changing the reusable group.

Editing a group affects future sessions only. Previous sessions preserve the exact questions that were asked and their answers. Switching to another group after answers have been entered must not discard them; the prototype directs the user to edit the session's questions or start another session. Questions with answers cannot be removed accidentally.

## One session form

- Session title.
- Person's name or alias.
- Date, filled in automatically.
- Audio: record, pause, stop, keep, import, and play back. Another take adds a file; it never overwrites the first.
- Questionnaire selector, followed by its questions and answer boxes.
- Optional additional notes.
- **Edit this session's questions**, **Done**, and **Export**.

In the real app, save notes and answers automatically. Audio must be saved incrementally so a long conversation does not depend on one final save. Keep microphone capture clearly labelled: capturing a remote caller's voice through system audio is separate work. Import an existing call recording initially.

## One export dialog

The dialog lists exactly which sessions are being exported. Use the same dialog for one session, a selected subset, or all sessions in the project.

Three formats:

1. **Markdown:** one readable document containing session metadata, the questionnaire used, every question and answer, and additional notes. Give this written context to Codex or Claude Code.
2. **JSON:** the same selected sessions as structured, versioned data, with stable IDs and original-audio references.
3. **ZIP + audio:** README, Markdown, JSON, and the original audio files for those sessions. Include only the selected sessions and their media.

No transcription or automatic interpretation. Coding agents receive written feedback; audio is preserved as source material. Live connections are outside this version. A selected-session ZIP is a portable session export, not a promise of full application backup/restore or reuse of a project's unselected questionnaire library.

## Small implementation plan

Use a Tauri desktop shell with a simple HTML/CSS interface and Rust for local operations. Store structured data in SQLite and audio as managed files. No hosted backend is needed.

1. Projects, questionnaire groups, session form, autosave, and session list.
2. Explicit selection and Markdown/JSON/ZIP export, including exact question snapshots.
3. Microphone recording, pause/stop, safe incremental saving, interruption recovery, import, and playback.
4. Package and test the desktop application on the initial target computer.

The core data is small: Project, QuestionnaireGroup, TemplateQuestion, Session, SessionQuestion/Answer, and AudioAttachment. A session owns a copy of its questions. Questionnaire groups belong to a project; recordings belong to a session. Use stable IDs and relative media paths.

Meaningful checks: restart preserves answers; editing a template does not rewrite old sessions; one/many/all exports contain the correct sessions; excluded sessions and media do not leak into an export; original audio bytes survive export; a second recording preserves the first; interrupted recording is recoverable.

## This HTML concept

`research-app.prototype.html` demonstrates both screens and the export/questionnaire dialogs. Lists, search, selection, session creation, written answers, questionnaire editing, session customization, and Markdown/JSON/ZIP downloads work in memory. Importing an audio file supports local browser playback and bundles the original bytes into ZIP exports.

Seed sessions and their recording filenames are fictional. Record/pause/stop controls simulate capture and do not activate the microphone. Sample recordings have no real audio and are explicitly excluded from exported media. Actual microphone capture and permanent storage await the Rust implementation. Closing/resetting the page loses prototype changes.

The existing `RESEARCH-AND-PRODUCT.md` remains as background research. Its larger feature proposal has been superseded by this document.
