use crate::store::Result;
use std::{fs, path::Path};

/// The app identifier before the rename to Fieldnote, which also named its data folder.
pub const LEGACY_IDENTIFIER: &str = "io.moneo.research";
const DATABASE: &str = "research.sqlite";

/// Moves a pre-rename workspace into `root`. Returns whether anything moved.
///
/// The database moves last, so an interrupted move is picked up again on the next launch and a
/// workspace is only ever treated as migrated once it is complete.
pub fn move_legacy_data(legacy: &Path, root: &Path) -> Result<bool> {
    if root.join(DATABASE).exists() || !legacy.join(DATABASE).exists() {
        return Ok(false);
    }
    let failed = |e: std::io::Error| {
        format!("Could not move your data from the old Research app. Close it and reopen Fieldnote. ({e})")
    };
    fs::create_dir_all(root).map_err(failed)?;
    let mut names = fs::read_dir(legacy)
        .map_err(failed)?
        .map(|entry| entry.map(|e| e.file_name()))
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(failed)?;
    names.sort_by_key(|name| name == DATABASE);
    for name in names {
        fs::rename(legacy.join(&name), root.join(&name)).map_err(failed)?;
    }
    let _ = fs::remove_dir(legacy);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_workspace(dir: &Path) -> std::path::PathBuf {
        let legacy = dir.join("old");
        fs::create_dir_all(legacy.join("audio")).unwrap();
        fs::write(legacy.join(DATABASE), "db").unwrap();
        fs::write(legacy.join("research.sqlite-wal"), "wal").unwrap();
        fs::write(legacy.join("audio/take.wav"), "take").unwrap();
        legacy
    }

    #[test]
    fn a_legacy_workspace_moves_completely_and_only_once() {
        let dir = tempfile::tempdir().unwrap();
        let (legacy, root) = (legacy_workspace(dir.path()), dir.path().join("new"));
        assert!(move_legacy_data(&legacy, &root).unwrap());
        assert_eq!(fs::read_to_string(root.join(DATABASE)).unwrap(), "db");
        assert_eq!(
            fs::read_to_string(root.join("research.sqlite-wal")).unwrap(),
            "wal"
        );
        assert_eq!(
            fs::read_to_string(root.join("audio/take.wav")).unwrap(),
            "take"
        );
        assert!(!legacy.exists());
        assert!(!move_legacy_data(&legacy, &root).unwrap());
    }

    #[test]
    fn an_existing_workspace_is_never_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let (legacy, root) = (legacy_workspace(dir.path()), dir.path().join("new"));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(DATABASE), "current").unwrap();
        assert!(!move_legacy_data(&legacy, &root).unwrap());
        assert_eq!(fs::read_to_string(root.join(DATABASE)).unwrap(), "current");
        assert_eq!(fs::read_to_string(legacy.join(DATABASE)).unwrap(), "db");
    }

    #[test]
    fn an_interrupted_move_resumes_on_the_next_launch() {
        let dir = tempfile::tempdir().unwrap();
        let (legacy, root) = (legacy_workspace(dir.path()), dir.path().join("new"));
        fs::create_dir_all(&root).unwrap();
        fs::rename(legacy.join("audio"), root.join("audio")).unwrap();
        assert!(move_legacy_data(&legacy, &root).unwrap());
        assert_eq!(fs::read_to_string(root.join(DATABASE)).unwrap(), "db");
        assert!(root.join("audio/take.wav").exists());
    }

    #[test]
    fn a_fresh_install_has_nothing_to_move() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("new");
        assert!(!move_legacy_data(&dir.path().join("old"), &root).unwrap());
        assert!(!root.exists());
    }
}
