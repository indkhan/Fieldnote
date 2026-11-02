# Project table and optional session properties

Approved for implementation. The feature is implemented in the 0.2.0 source; see `README.md` for use and validation. The notes below record the approved behaviour, and `table-view.prototype.html` remains the design reference.

## Purpose

Make it easy to compare sessions and find people or patterns without opening every interview. The table should help answer practical questions: Who was excited? Who left an email? Which people should I contact again? Which sessions still lack information?

## What the user sees

Each project gets **List** and **Table** tabs showing the same sessions. Table rows are sessions, not people; repeated conversations with one person remain separate sessions. Clicking a session opens the existing form, questionnaire, and recordings.

Start with core session information and an **Add column** button. Offer Email and Excitement as quick-add presets, rather than silently adding those fields to every existing project. The concept shows these example columns already added.

Creating a column adds an optional field to every existing and future session in that project. Existing values start empty. Another project has its own columns. Adding a property does not change the questionnaire, answers, notes, audio, or validity of any old session.

## A useful first set of property types

| Type | Suitable examples | Behaviour |
| --- | --- | --- |
| Text | Company, user segment, source | Short free text |
| Email | Contact email | Optional email with visible validation |
| Number | Excitement score, budget, rating | Numeric sorting; zero is a real value |
| Select | Excitement, follow-up status | User-defined options in a deliberate order |
| Date | Follow-up date | Date picker and chronological sorting |

For Excitement, one sensible setup is Select with Low, Medium, High. A user who prefers a score can create a Number field instead. A Yes/No select covers simple flags initially. All types allow an empty value; no defaults are guessed from the conversation.

## Editing and session forms

- Edit a value directly in a table cell, or in a **Project fields** section near the top of the session form. Both edit the same underlying value.
- Project fields remain separate from questionnaires. Fields describe sessions for comparison; questions collect the detailed interview answers.
- Commit valid cell changes on Enter or leaving the cell. Show save/error status and retain an invalid draft visibly for correction. Do not reorder the row while the user is still typing.
- Add a new column once; it immediately appears as an optional field in all sessions in that project.
- Rename a column while keeping values under its stable field ID. Type is fixed after creation in the first version to avoid accidental conversion of existing data.
- Hide/show columns through **Columns**. Hiding changes the overview, keeps data in session forms, and does not remove data from exports. Permanent deletion and destructive type conversion are outside this first change.

## Sorting and filtering

Sort through column headers or the Sort control. Start with one active sort to keep it understandable. Text uses alphabetical sorting; numbers use numeric order; dates use date order; Select follows the user's declared option order. Empty values stay at the bottom for both directions.

Filters support multiple rules joined with AND. Text/email: contains, is, is not, empty, not empty. Select: is, is not, empty, not empty. Number/date: equal, at least/on or after, at most/on or before, empty, not empty.

Example: **Excitement is High** AND **Email is not empty** gives a useful follow-up shortlist. **Excitement is empty** identifies sessions needing a personal assessment. Empty means unknown/unfilled, rather than a low score or a negative answer.

Remember each project's chosen view, hidden columns, sort, and filters. These are display preferences, not changes to research data. Keep the primary session column visible while scrolling sideways through added columns.

## Selection and exports

Preserve selection by session ID across view switches, sorts, and filters. Show a count of selected sessions outside the current view so hidden selections are explicit.

- With a selection: **Export selected (N)**, including any selected rows outside the view; list the scope in the export preview.
- With an active search/filter and no selection: **Export results (N)**.
- Without selection or filtering: **Export all (N)**.

The header checkbox selects currently visible results. In the eventual paginated app, distinguish displayed rows from all matching results so pagination does not silently change the selection or export scope.

Extend existing Markdown, JSON, and ZIP exports with project field definitions and per-session values. Preserve stable IDs, types, Select option order, and empty values. Include hidden properties as well, and say so in the export preview. This is a display feature, not an anonymization feature.

## How it would be implemented after approval

Keep the current Tauri/Rust/SQLite stack and approved dark design. Use native HTML tables and inputs; a spreadsheet/grid framework is unnecessary for this scope.

Add project field definitions and typed session values in SQLite, with a safe schema migration that preserves current research. Shared project field definitions are read dynamically; existing sessions do not need to be rewritten when a new column is added. Keep questionnaire snapshots unchanged.

Use stable IDs so renaming or hiding a column never detaches its values. Backend validation enforces project ownership and field types. Save only the changed cell rather than sending an entire session, preventing a delayed form save from overwriting newer table edits.

Apply search, sorting, and filters in SQLite before pagination. Fetch only the displayed rows and property values, not audio or every questionnaire answer. Add suitable indexes for project/field/value queries. View preferences can remain lightweight local preferences per project.

Meaningful checks: old data survives migration; added fields are empty and optional; form/table edits agree; zero differs from empty; numbers and Select order sort correctly; filters search the whole dataset across pages; other projects remain isolated; hidden values stay intact; and selected/exported sessions are exact.

## About the concept

`table-view.prototype.html` is a separate, self-contained interactive document using fictional sessions and `.test` email addresses. It demonstrates Table/List switching, inline field editing, per-project fields, adding/renaming/hiding columns, optional fields in a session, sorting, AND filters, selection, and an example JSON export. It does not access the installed app or database. All changes disappear on reset/close.

The table behaviour is inspired by the user's Notion analogy. The existing charcoal/lavender design is preserved. The awesome-design-md references inform restrained dividers, compact controls, rectangular buttons, and property chips; this is not a wholesale Notion reskin.
