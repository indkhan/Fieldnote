mod export;
mod handoff;
mod migrate;
mod model;
mod properties;
#[cfg(test)]
mod properties_tests;
mod recorder;
mod store;

use model::*;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use store::{Result, SessionPage, Store};
use tauri::{Manager, State};

struct Core {
    store: Mutex<Store>,
    recorder: Mutex<recorder::Recorder>,
    recovered: usize,
}
type AppState<'a> = State<'a, Arc<Core>>;

async fn database<T, F>(core: &Arc<Core>, operation: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&Store) -> Result<T> + Send + 'static,
{
    let core = core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let store = core
            .store
            .lock()
            .map_err(|_| "Local storage is unavailable.")?;
        operation(&store)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    data_directory: String,
    recovered_recordings: usize,
}

#[tauri::command]
async fn app_info(core: AppState<'_>) -> Result<AppInfo> {
    let recovered = core.recovered;
    database(&core, move |s| {
        Ok(AppInfo {
            data_directory: s.root.to_string_lossy().into(),
            recovered_recordings: recovered,
        })
    })
    .await
}
#[tauri::command]
async fn projects(core: AppState<'_>) -> Result<Vec<Project>> {
    database(&core, |s| s.projects()).await
}
#[tauri::command]
async fn create_project(core: AppState<'_>, name: String) -> Result<Project> {
    database(&core, move |s| s.create_project(&name)).await
}
#[tauri::command]
async fn questionnaires(core: AppState<'_>, project_id: String) -> Result<Vec<Questionnaire>> {
    database(&core, move |s| s.questionnaires(&project_id)).await
}
#[tauri::command]
async fn save_questionnaire(
    core: AppState<'_>,
    questionnaire: Questionnaire,
) -> Result<Questionnaire> {
    database(&core, move |s| s.save_questionnaire(questionnaire)).await
}
#[tauri::command]
async fn session_list(
    core: AppState<'_>,
    project_id: String,
    query: String,
    offset: u32,
) -> Result<SessionPage> {
    database(&core, move |s| s.list(&project_id, &query, offset)).await
}
#[tauri::command]
async fn session_ids(core: AppState<'_>, project_id: String) -> Result<Vec<String>> {
    database(&core, move |s| s.session_ids(&project_id)).await
}
#[tauri::command]
async fn project_fields(core: AppState<'_>, project_id: String) -> Result<Vec<ProjectField>> {
    database(&core, move |s| s.fields(&project_id)).await
}
#[tauri::command]
async fn save_project_field(core: AppState<'_>, field: ProjectField) -> Result<ProjectField> {
    database(&core, move |s| s.save_field(field)).await
}
#[tauri::command]
async fn property_values(core: AppState<'_>, session_id: String) -> Result<PropertyValues> {
    database(&core, move |s| s.property_values(&session_id)).await
}
#[tauri::command]
async fn set_property(
    core: AppState<'_>,
    project_id: String,
    session_id: String,
    field_id: String,
    value: serde_json::Value,
) -> Result<serde_json::Value> {
    database(&core, move |s| {
        s.set_property(&project_id, &session_id, &field_id, value)
    })
    .await
}
#[tauri::command]
async fn overview(core: AppState<'_>, query: OverviewQuery) -> Result<SessionPage> {
    database(&core, move |s| s.overview(&query)).await
}
#[tauri::command]
async fn overview_ids(core: AppState<'_>, query: OverviewQuery) -> Result<Vec<String>> {
    database(&core, move |s| s.overview_ids(&query)).await
}
#[tauri::command]
async fn create_session(
    core: AppState<'_>,
    project_id: String,
    questionnaire_id: Option<String>,
    date: String,
) -> Result<Session> {
    database(&core, move |s| {
        s.create_session(&project_id, questionnaire_id.as_deref(), &date)
    })
    .await
}
#[tauri::command]
async fn get_session(core: AppState<'_>, session_id: String) -> Result<Session> {
    database(&core, move |s| s.session(&session_id)).await
}
#[tauri::command]
async fn save_session(core: AppState<'_>, session: Session) -> Result<Session> {
    database(&core, move |s| s.save_session(session)).await
}

#[derive(serde::Serialize)]
struct AudioFile {
    #[serde(flatten)]
    audio: Audio,
    path: String,
}
#[tauri::command]
async fn session_audio(core: AppState<'_>, session_id: String) -> Result<Vec<AudioFile>> {
    database(&core, move |s| {
        s.audio(&session_id)?
            .into_iter()
            .map(|audio| {
                let path = s
                    .managed_path(&audio.relative_path)?
                    .to_string_lossy()
                    .into();
                Ok(AudioFile { audio, path })
            })
            .collect()
    })
    .await
}
#[tauri::command]
async fn import_audio(
    core: AppState<'_>,
    session_id: String,
    paths: Vec<String>,
) -> Result<Vec<Audio>> {
    database(&core, move |s| export::import_audio(s, &session_id, &paths)).await
}
#[tauri::command]
async fn export_sessions(
    core: AppState<'_>,
    project_id: String,
    session_ids: Vec<String>,
    format: String,
    destination: String,
) -> Result<export::ExportResult> {
    database(&core, move |s| {
        export::export(
            s,
            &project_id,
            &session_ids,
            &format,
            &PathBuf::from(destination),
        )
    })
    .await
}

#[tauri::command]
async fn prepare_for_agent(
    core: AppState<'_>,
    project_id: String,
    session_ids: Vec<String>,
    folder: String,
) -> Result<handoff::Handoff> {
    database(&core, move |s| {
        handoff::prepare(s, &project_id, &session_ids, &PathBuf::from(folder))
    })
    .await
}

#[tauri::command]
async fn input_devices() -> Result<Vec<recorder::InputDevice>> {
    tauri::async_runtime::spawn_blocking(recorder::input_devices)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn start_recording(
    core: AppState<'_>,
    session_id: String,
    device_id: Option<String>,
) -> Result<recorder::Status> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut r = core.recorder.lock().map_err(|_| "Recorder unavailable.")?;
        let s = core
            .store
            .lock()
            .map_err(|_| "Local storage unavailable.")?;
        r.start(&s, &session_id, device_id)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn recording_status(core: AppState<'_>) -> Result<recorder::Status> {
    Ok(core
        .recorder
        .lock()
        .map_err(|_| "Recorder unavailable.")?
        .status())
}
#[tauri::command]
fn pause_recording(core: AppState<'_>, paused: bool) -> Result<recorder::Status> {
    core.recorder
        .lock()
        .map_err(|_| "Recorder unavailable.")?
        .pause(paused)
}
#[tauri::command]
async fn stop_recording(core: AppState<'_>) -> Result<Option<Audio>> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut r = core.recorder.lock().map_err(|_| "Recorder unavailable.")?;
        let s = core
            .store
            .lock()
            .map_err(|_| "Local storage unavailable.")?;
        r.stop(&s)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let root = match std::env::var_os("FIELDNOTE_DATA_DIR") {
                Some(dir) => PathBuf::from(dir),
                None => {
                    let root = app.path().app_data_dir()?;
                    if let Some(parent) = root.parent() {
                        let legacy = parent.join(migrate::LEGACY_IDENTIFIER);
                        migrate::move_legacy_data(&legacy, &root).map_err(std::io::Error::other)?;
                    }
                    root
                }
            };
            let store = Store::open(&root).map_err(std::io::Error::other)?;
            let recovered = recorder::recover(&store).map_err(std::io::Error::other)?;
            app.asset_protocol_scope()
                .allow_directory(root.join("audio"), true)?;
            app.manage(Arc::new(Core {
                store: Mutex::new(store),
                recorder: Mutex::new(recorder::Recorder::default()),
                recovered,
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            projects,
            create_project,
            questionnaires,
            save_questionnaire,
            session_list,
            session_ids,
            project_fields,
            save_project_field,
            property_values,
            set_property,
            overview,
            overview_ids,
            create_session,
            get_session,
            save_session,
            session_audio,
            import_audio,
            export_sessions,
            prepare_for_agent,
            input_devices,
            start_recording,
            recording_status,
            pause_recording,
            stop_recording
        ])
        .run(tauri::generate_context!())
        .expect("Fieldnote could not start. Your data has not been deleted.");
}
