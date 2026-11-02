# Local research app: evidence and proposed product

> Scope update: the feature proposal below is historical. [SIMPLE-APP-PLAN.md](SIMPLE-APP-PLAN.md) is the current plan: session list, project questionnaire groups, a session form with audio, and one/many/all session export. Transcription and live agent connections are out of scope.

Researched 2 November 2026. This is a product proposal and an HTML prototype, not an implemented Rust application. Three research subagents covered established products, user needs, and technical feasibility independently.

## 1. Your requirements

- An open-source desktop application using Rust, initially on one computer.
- No account, required server, or sync.
- Multiple projects, with people and repeated sessions for each person.
- Customizable information, questions, notes, and feedback.
- Record and retain audio; import recordings; keep original evidence.
- Connect to Codex or Claude Code, or export the complete research.
- A very simple interface, reviewed in HTML before implementation.

The prototype's people, conversations, spending examples, audio filenames, and transcripts are fictional. They do not describe actual Moneo research or establish what Moneo does.

## 2. Established benchmarks and close alternatives

No independently verified market-share ranking was found. Dovetail, Condens, and Marvin are useful established product benchmarks, not a defensible numbered league table. Prices and product packaging can change.

### Dovetail: broad research and customer intelligence

Its current free plan includes one research project and one feedback channel. Paid enterprise pricing is custom. It offers recordings, transcription, structured fields, tags, search, and broader analysis. MCP connections already exist. Its project archives contain JSONL, so it would be wrong to say Dovetail has no export. A locally running MCP client/server does not turn its hosted research workspace into an offline desktop repository. Sources: [pricing](https://dovetail.com/pricing/), [project export](https://dovetail.com/help/transfer-projects-between-workspaces/), [MCP](https://developers.dovetail.com/docs/mcp).

**Borrow:** linking evidence to findings and useful metadata. **Product implication:** a small local capture workflow must earn its place through ease of use and data control; adding an agent connection is not unique.

### Condens: a direct research-workspace benchmark

Lite is listed at €15/month, or €165/year, for one contributor, with unlimited projects and automated transcription. Business starts at €500/month billed yearly and includes five contributors plus Claude/ChatGPT connections. Enterprise includes API and custom MCP options. Its full export preserves a broad set of session data, files, tagged evidence, and taxonomy; an individual transcript export does not preserve every linked analysis element. Sources: [pricing](https://condens.io/pricing/), [full export](https://condens.io/help/import-and-export/export/full-project-export/), [transcript export](https://condens.io/help/import-and-export/export/exporting-transcripts/).

**Borrow:** people, sessions, and analysis connected in one workspace. **Product implication:** affordability alone is a weak claim against a tool with an individual plan. Complete, routine, independently readable portability is more precise than simply promising an export button.

### Marvin: research for teams

The directly checked pricing page lists Starter, Pro, and Enterprise with sales/demo calls to action. Pro lists read/write MCP and API access. Official export guidance covers media, transcripts, notes, source files, and PDF insights; some exported insight references link back to the hosted workspace. Cached snippets differed from the current pricing page, so no unverified seat price or free-plan limits are repeated here. Sources: [pricing](https://heymarvin.com/pricing), [developer documentation](https://docs.heymarvin.com/), [export guide](https://help.heymarvin.com/en/articles/10130443-how-do-i-export-data-from-marvin).

**Borrow:** keeping people and source material connected. **Product implication:** focus on getting evidence into a founder's actual work, with meaningful local source references.

### Meetily: the closest adjacent desktop competitor

Meetily Community is a free, MIT-licensed Rust-based desktop application with local recording and transcription. Its published Pro plan is $10/user/month billed yearly at $120. Pro lists advanced exports, including Markdown, and MCP/webhook/CLI integrations; its MCP documentation explicitly describes a Pro license requirement. Sources: [open-source edition](https://meetily.ai/open-source), [repository](https://github.com/Zackriya-Solutions/meetily), [pricing](https://meetily.ai/pricing), [MCP](https://docs.meetily.ai/developers/mcp).

**Product implication:** Rust + local audio + agent access already exists. The hypothesis to test is a founder research workflow spanning projects, people, repeat sessions, source evidence, and reviewed findings. If recordings and summaries are all you need, try this existing option before investing in another recorder. Before reusing its code, inspect the actual license boundaries and dependencies of the edition being considered.

### Open-source qualitative research tools

QualCoder offers offline desktop qualitative analysis with audio/video, cases, attributes, memos, and project/codebook exports. Taguette emphasizes document highlighting and tagging and can run locally or on a server; the cited page does not establish built-in recording/transcription. Sources: [QualCoder](https://qualcoder.org/doc/en/), [QualCoder export](https://qualcoder.org/doc/en/6.1.-Imports-and-Exports/), [Taguette](https://www.taguette.org/about.html).

**Product implication:** open source and local storage also have precedents. Simpler terminology and a shorter path from conversation to useful evidence are testable differences.

## 3. What users complain about

The strongest general source is [NN/g's July 2024 study](https://www.nngroup.com/articles/why-repositories-fail/) of over 400 UX/ReOps practitioners plus follow-up interviews. It identifies adoption barriers including complexity, contribution effort, ownership, search/tagging, and pricing/access. This evidence concerns research organizations, not a representative sample of solo founders.

Additional community sources provide specific anecdotes. They should guide interviews, not be treated as prevalence statistics or current product benchmarks.

| Observed concern | Evidence and limitation | Minimal design response |
| --- | --- | --- |
| Too much setup and maintenance | NN/g above; [manual repository discussion, 2023–24](https://www.reddit.com/r/UXDesign/comments/13k512i/best_way_to_organize_research/) | A session is useful with only a title and notes. Optional tags and fields. |
| People do not visit a separate repository | [October 2026 discussion](https://www.reddit.com/r/UXResearch/comments/1x2l9ww/easy_to_navigate_research_repository/), an individual account of moving research into Confluence | Searchable local research plus context delivered into the coding workflow. |
| Export loses useful structure | [January 2026 account](https://www.reddit.com/r/UXResearch/comments/1qqyzmx/observations_from_using_dovetail/) and [mixed migration experiences, November 2024](https://www.reddit.com/r/UXResearch/comments/1gmgekn/has_anyone_here_migrated_their_data_from_dovetail/) | Preserve relationships, stable IDs, timestamps, source files, and custom fields. Test restoration. |
| Transcript accuracy creates correction work | [February 2024 alternatives discussion](https://www.reddit.com/r/UXResearch/comments/1amzfdh/alternatives_to_dovetail/), historical individual experiences | Editable text, speaker-label correction, timestamp playback, and retained original audio. |
| AI interpretations need checking | [2026 database discussion](https://www.reddit.com/r/UXResearch/comments/1q6ugwf/user_research_database/), anecdotes rather than an accuracy evaluation | Separate statements, observations, interpretations, and reviewed findings. |
| Control over what gets shared | Same database discussion; no claim of representative demand | Participant aliases, export preview, optional media inclusion, and a clear sharing boundary. |

**Research hypothesis:** a founder can finish a conversation and give their coding agent reliable, source-linked context with almost no repository maintenance.

**Still unproven:** how often founders conduct interviews, whether they return regularly, whether local models are acceptable, whether an exported folder is enough, and whether anyone would pay for a service around this open-source application.

## 4. The proposed interface

Three destinations: **Sessions**, **People**, **Export & agents**. The project chooser sits above them. No dashboard is necessary.

The normal flow is: choose a project → add a person → start a session → record/import audio and take notes → correct transcript → save source-linked findings → review and export.

- **Sessions:** a searchable list; a session opens to notes and its recording. Secondary tabs contain the transcript and optional fields.
- **People:** a name/alias, background, and all sessions for that person. Names are optional real-world identities, not login accounts.
- **Customization:** start with session/project templates and text, select, and checkbox fields. Avoid a freeform database/page builder. The prototype demonstrates text fields and tags; other field types are proposed implementation scope.
- **Findings:** preserve the quote and source timestamp separately from the researcher's interpretation. A review checkbox controls which findings enter the concise handoff. Reviewed does not automatically mean approved for implementation.
- **Project context:** explain what is being tested and record tested build/version per session, so old feedback is not silently applied to a new design.

## 5. Exports and connections

Provide two distinct outputs:

1. **Coding-agent context:** Markdown entry point, project context, session notes and transcripts, reviewed findings with sources, structured versioned JSON, and optional media. This is a snapshot. The first implementation should let the user choose an output folder and copy an instruction for their existing coding agent.
2. **Complete project archive:** every participant, session, field, recording, attachment, transcript and edit, finding, and relationship, with a consistent database snapshot and restore support. This is a backup/portability feature and should not depend on a vendor link to remain useful.

Later, add a small project-scoped **read-only local MCP server**: list sessions, search evidence, read a session, and retrieve a source passage. Both clients document local stdio servers: [official OpenAI documentation](https://learn.chatgpt.com/docs/extend/mcp), [Claude Code documentation](https://code.claude.com/docs/en/mcp). Live access is a separate feature from exporting a folder; no embedded agent chat or new research-app account is required.

Selected content may be sent to an external agent's model provider. Participant IDs do not automatically redact identifying free text or voices. Research text is evidence, not trusted instructions for an agent. The proposed handoff prompt asks for source citations, separates evidence from interpretation, and requests discussion before implementation.

## 6. How to build it with Rust

**Recommended:** Tauri 2, Rust application logic, SQLite metadata/search, and managed audio/attachment files. Tauri uses the system WebView for an HTML/CSS interface. This meets a Rust-backed desktop requirement; it is not an entirely Rust-written UI. [Tauri architecture](https://v2.tauri.app/concept/architecture/).

Use stable IDs and relative media paths. Store the workspace in an OS-appropriate application data directory, or a folder explicitly chosen by the user. A small data model is sufficient: Project, Person, Session, Recording, TranscriptSegment, Finding, and field definitions/values.

**Recording:** use a Rust audio input layer such as [CPAL](https://docs.rs/cpal/latest/cpal/). Show microphone selection, level, pause, stop, elapsed time, and playback. Write recoverable audio incrementally, preserve existing recordings when adding another, and report device/storage failures. Database transactions do not protect separate audio files automatically.

**Calls:** microphone recording does not guarantee capture of a remote participant. Start with microphone capture and importing an existing call recording. Windows system sound requires separate work such as [WASAPI loopback](https://learn.microsoft.com/en-gb/windows/win32/coreaudio/loopback-recording), with device/echo testing. Do not label microphone-only capture as a full meeting recorder.

**Transcription:** optional [whisper.cpp](https://github.com/ggml-org/whisper.cpp) processing after recording is a reasonable starting point. It requires a model download and hardware/language-specific performance checks. Never block recording retention on transcription success or promise automatic named-speaker identification.

**Backup:** make a consistent SQLite snapshot plus media using the [SQLite backup mechanisms](https://www.sqlite.org/backup.html). Validate archive contents and perform a real export/restore round trip.

## 7. Implementation order and acceptance checks

1. Local notebook: projects, people, sessions, autosave, search, simple fields. Check changes survive restart and projects remain isolated.
2. Recording/import/playback: incremental writes and recovery. Check interruption, unplugged devices, disk errors, long recordings, and multiple audio files per session.
3. Full archive/restore and agent folder: verify relationships and original files round-trip; verify omitted names/media stay omitted where promised.
4. Optional local transcription and source-linked findings: test the actual target computer and interview languages. Preserve original audio and distinguish corrections from source capture.
5. Read-only MCP: scope to the selected project; test both coding clients and retrieval of exact source passages.

For the first public release, decide the open-source license, document local storage/backup, publish reproducible build instructions, and use appropriate installer signing. A distribution decision is separate from validating founder demand.

## 8. What the prototype does and does not do

Open `research-app.prototype.html` directly or use the rendered version in the conversation. It uses no libraries, external assets, backend, or server. Changes stay in memory until closing/resetting the page.

Working interactions: project creation/switching, person creation/editing, sessions, notes, transcript editing, source-linked findings, review flags, tags/text fields, project search, export preview, agent prompt copy, and a valid demo ZIP with Markdown/JSON. A small Node self-check verifies the data interactions and generates a ZIP that was independently checked with Python's ZIP reader.

Simulated/planned: microphone capture, audio playback/import, local transcription, durable storage, complete backup/restore, additional field types, and live MCP. Demo exports contain fictional research and no real audio. Desktop and narrow layouts were visually checked with the HTML preview tool; physical recording and agent integration were not tested.

Design reference: [Linear DESIGN.md](C:/codebases/Personal/.agents/skills/awesome-design-md/design-md/linear.app/DESIGN.md), applied through CSS variables for typography, charcoal surfaces, hairlines, restrained lavender, and compact controls. The app name "Research" is a placeholder.
