# Session and project management review

[Watch the desktop screen recording](session-management.mp4) (70 seconds, 2x speed, no audio).

Recorded against a Windows desktop build with disposable demo data. The recording shows the only project already open after a fresh launch, creating a destination, moving two selected sessions, bulk deletion in table view, deleting an empty project, checking notes in a moved session, deleting an individual session, and deleting the final project with its remaining session.

Each deletion requires confirmation. Moves preserve session contents and media; populated custom fields are copied into compatible destination columns, or distinct columns when types conflict. Project deletion removes its sessions, questionnaires, fields, and media. Files that cannot be removed are reported as cleanup warnings after the UI refreshes.

Verified with `npm run build`, `npm test` (15 passing), and `cargo test --manifest-path src-tauri/Cargo.toml --lib` (29 passing; existing live-microphone test ignored). A Windows desktop build and the recorded UI flows were also checked. macOS and Linux were not run.
