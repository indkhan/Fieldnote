use crate::{database, store::Result, AppState};
use std::{fs, io, io::Write, path::PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};
use uuid::Uuid;

const MAX_DOCUMENT_BYTES: usize = 32 * 1024 * 1024;

#[derive(serde::Serialize)]
pub struct ConsentDocument {
    id: String,
}

#[tauri::command]
pub async fn save_consent_document(
    core: AppState<'_>,
    request: Request<'_>,
) -> Result<ConsentDocument> {
    let extension = request
        .headers()
        .get("x-consent-extension")
        .and_then(|value| value.to_str().ok())
        .ok_or("A consent document type is required.")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("A consent document must contain file data.".into());
    };
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err("Consent documents must be 32 MB or smaller.".into());
    }
    let expected_header: &[u8] = match extension {
        "pdf" => b"%PDF-",
        "docx" => b"PK\x03\x04",
        _ => return Err("Choose a PDF or DOCX consent document.".into()),
    };
    if !bytes.starts_with(expected_header) {
        return Err("The file does not match the selected document type.".into());
    }
    let id = format!("{}.{extension}", Uuid::new_v4());
    let bytes = bytes.clone();
    database(&core, move |store| {
        let directory = store.root.join("consent");
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let mut temp = tempfile::NamedTempFile::new_in(&directory).map_err(|e| e.to_string())?;
        temp.write_all(&bytes).map_err(|e| e.to_string())?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist_noclobber(directory.join(&id))
            .map_err(|e| e.to_string())?;
        Ok(ConsentDocument { id })
    })
    .await
}

#[tauri::command]
pub async fn read_consent_document(core: AppState<'_>, id: String) -> Result<Response> {
    validate_id(&id)?;
    database(&core, move |store| {
        fs::read(store.root.join("consent").join(id))
            .map(Response::new)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn save_consent_copy(core: AppState<'_>, id: String, path: PathBuf) -> Result<()> {
    validate_id(&id)?;
    database(&core, move |store| {
        let mut source =
            fs::File::open(store.root.join("consent").join(id)).map_err(|e| e.to_string())?;
        let directory = path.parent().ok_or("Invalid destination.")?;
        let mut temp = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
        io::copy(&mut source, &mut temp).map_err(|e| e.to_string())?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(path).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

fn validate_id(id: &str) -> Result<()> {
    let (uuid, extension) = id.split_once('.').ok_or("Invalid consent document ID.")?;
    if Uuid::parse_str(uuid).is_err() || !matches!(extension, "pdf" | "docx") {
        return Err("Invalid consent document ID.".into());
    }
    Ok(())
}
