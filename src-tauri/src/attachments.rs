use crate::{
    model::{id, Attachment},
    store::{Result, Store},
};
use std::{
    fs,
    io::{self, Write},
    path::Path,
};
impl Store {
    pub fn attachments(&self, session_id: &str) -> Result<Vec<Attachment>> {
        self.session(session_id)?;
        let mut stmt = self
            .conn
            .prepare("SELECT data FROM attachments WHERE session_id=?1 ORDER BY rowid")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([session_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
        })
        .collect()
    }
    pub fn add_attachment(
        &self,
        session_id: &str,
        name: &str,
        input: &mut dyn io::Read,
    ) -> Result<()> {
        self.session(session_id)?;
        let name = Path::new(name)
            .file_name()
            .and_then(|v| v.to_str())
            .filter(|v| !v.is_empty())
            .ok_or("Invalid filename.")?;
        let attachment_id = id();
        let ext = Path::new(name)
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("");
        let safe_ext: String = ext
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .take(16)
            .collect();
        let relative_path = format!("attachments/{attachment_id}.{safe_ext}");
        let mut temp = tempfile::NamedTempFile::new_in(self.root.join("attachments"))
            .map_err(|e| e.to_string())?;
        let byte_length = io::copy(input, &mut temp).map_err(|e| e.to_string())?;
        temp.flush().map_err(|e| e.to_string())?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        let target = self.managed_path(&relative_path)?;
        temp.persist_noclobber(&target).map_err(|e| e.to_string())?;
        let a = Attachment {
            id: attachment_id,
            session_id: session_id.into(),
            name: name.into(),
            relative_path,
            byte_length,
            caption: String::new(),
        };
        let result = self
            .conn
            .execute(
                "INSERT INTO attachments(id,session_id,data) VALUES(?1,?2,?3)",
                rusqlite::params![
                    a.id,
                    a.session_id,
                    serde_json::to_string(&a).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string());
        if let Err(e) = result {
            let _ = fs::remove_file(target);
            return Err(e);
        }
        Ok(())
    }
    pub fn edit_attachment(
        &self,
        session_id: &str,
        attachment_id: &str,
        caption: Option<String>,
    ) -> Result<()> {
        let mut a = self
            .attachments(session_id)?
            .into_iter()
            .find(|a| a.id == attachment_id)
            .ok_or("Attachment not found.")?;
        if let Some(caption) = caption {
            if caption.len() > 100_000 {
                return Err("Caption is too long.".into());
            }
            a.caption = caption;
            self.conn
                .execute(
                    "UPDATE attachments SET data=?1 WHERE id=?2",
                    rusqlite::params![serde_json::to_string(&a).map_err(|e| e.to_string())?, a.id],
                )
                .map_err(|e| e.to_string())?;
        } else {
            self.conn
                .execute("DELETE FROM attachments WHERE id=?1", [&a.id])
                .map_err(|e| e.to_string())?;
            let _ = fs::remove_file(self.managed_path(&a.relative_path)?);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{export, handoff, model::Audio};
    use std::io::Read;
    #[test]
    fn attachments_survive_restart_and_export_with_optional_captions_without_changing_recordings() {
        let data = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        let store = Store::open(data.path()).unwrap();
        let project = store.create_project("Test").unwrap();
        let session = store
            .create_session(&project.id, None, "2026-11-02")
            .unwrap();
        let other = store
            .create_session(&project.id, None, "2026-11-02")
            .unwrap();
        let recording = Audio {
            id: id(),
            session_id: session.id.clone(),
            name: "live.wav".into(),
            relative_path: "audio/live.wav".into(),
            byte_length: 0,
            duration_secs: None,
            status: "recording".into(),
        };
        store.save_audio(&recording).unwrap();
        for name in [
            "Screenshot.png",
            "Screen recording.mp4",
            "document.pdf",
            "unknown.xyz",
        ] {
            store
                .add_attachment(&session.id, name, &mut [0u8, 1, 255].as_slice())
                .unwrap();
        }
        let files = store.attachments(&session.id).unwrap();
        assert_eq!(files.len(), 4);
        assert!(files[0].caption.is_empty());
        assert_eq!(store.audio(&session.id).unwrap()[0].status, "recording");
        assert!(store
            .edit_attachment(&other.id, &files[0].id, None)
            .is_err());
        store
            .edit_attachment(
                &session.id,
                &files[0].id,
                Some("Button is hard to find".into()),
            )
            .unwrap();
        store
            .edit_attachment(&session.id, &files[3].id, None)
            .unwrap();
        assert!(!store
            .managed_path(&files[3].relative_path)
            .unwrap()
            .exists());
        let mut recording = recording;
        recording.status = "failed".into();
        store.save_audio(&recording).unwrap();
        drop(store);
        let store = Store::open(data.path()).unwrap();
        assert_eq!(store.attachments(&session.id).unwrap().len(), 3);
        let target = out.path().join("test.zip");
        export::export(&store, &project.id, &[session.id.clone()], "zip", &target).unwrap();
        let mut zip = zip::ZipArchive::new(fs::File::open(&target).unwrap()).unwrap();
        for file in files.iter().take(3) {
            let mut bytes = vec![];
            zip.by_name(&file.relative_path)
                .unwrap()
                .read_to_end(&mut bytes)
                .unwrap();
            assert_eq!(bytes, [0, 1, 255]);
        }
        let result =
            handoff::prepare(&store, &project.id, &[session.id.clone()], out.path()).unwrap();
        for file in files.iter().take(3) {
            assert_eq!(
                fs::read(Path::new(&result.folder).join(&file.relative_path)).unwrap(),
                [0, 1, 255]
            );
        }
        let json = fs::read_to_string(Path::new(&result.folder).join("sessions.json")).unwrap();
        assert!(json.contains("Button is hard to find"));
        fs::remove_file(store.managed_path(&files[0].relative_path).unwrap()).unwrap();
        fs::write(&target, b"previous export").unwrap();
        assert!(
            export::export(&store, &project.id, &[session.id.clone()], "zip", &target).is_err()
        );
        assert_eq!(fs::read(target).unwrap(), b"previous export");
        assert!(handoff::prepare(&store, &project.id, &[session.id], out.path()).is_err());
    }
}
