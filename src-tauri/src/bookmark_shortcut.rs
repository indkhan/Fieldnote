use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Default)]
pub struct BookmarkShortcut {
    ready: AtomicBool,
    #[cfg(target_os = "linux")]
    portal_started: AtomicBool,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Bookmark {
    session_id: String,
    audio_id: String,
    duration_secs: f64,
}

impl BookmarkShortcut {
    pub fn ready(&self) -> bool {
        self.ready.load(Ordering::Relaxed)
    }
}

pub fn install(app: &AppHandle) {
    app.manage(BookmarkShortcut::default());
    #[cfg(target_os = "linux")]
    if is_wayland() {
        return;
    }
    if let Err(error) = app.plugin(tauri_plugin_global_shortcut::Builder::new().build()) {
        eprintln!("Global bookmark shortcut unavailable: {error}");
    }
}

fn shortcut() -> Shortcut {
    let primary = if cfg!(target_os = "macos") {
        Modifiers::SUPER
    } else {
        Modifiers::CONTROL
    };
    Shortcut::new(Some(primary | Modifiers::SHIFT), Code::KeyM)
}

pub fn enable(app: &AppHandle) {
    let state = app.state::<BookmarkShortcut>();
    #[cfg(target_os = "linux")]
    if is_wayland() {
        if !state.portal_started.swap(true, Ordering::Relaxed) {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = run_portal(&app).await {
                    eprintln!("Global bookmark shortcut unavailable: {error}");
                }
                app.state::<BookmarkShortcut>()
                    .ready
                    .store(false, Ordering::Relaxed);
            });
        }
        return;
    }
    let Some(manager) = app.try_state::<tauri_plugin_global_shortcut::GlobalShortcut<tauri::Wry>>()
    else {
        return;
    };
    let result = manager.on_shortcut(shortcut(), |app, _, event| {
        if event.state == ShortcutState::Pressed {
            capture(app);
        }
    });
    state.ready.store(result.is_ok(), Ordering::Relaxed);
    if let Err(error) = result {
        eprintln!("Global bookmark shortcut unavailable: {error}");
    }
}

pub fn disable(app: &AppHandle) {
    #[cfg(target_os = "linux")]
    if is_wayland() {
        // The portal binds once per application session. Capture ignores idle presses.
        return;
    }
    let state = app.state::<BookmarkShortcut>();
    if state.ready.swap(false, Ordering::Relaxed) {
        if let Err(error) = app.global_shortcut().unregister(shortcut()) {
            eprintln!("Could not release global bookmark shortcut: {error}");
        }
    }
}

fn capture(app: &AppHandle) {
    let core = app.state::<std::sync::Arc<super::Core>>();
    let Ok(recorder) = core.recorder.lock() else {
        return;
    };
    let status = recorder.status();
    drop(recorder);
    if status.active && !status.finished {
        if let (Some(session_id), Some(audio_id)) = (status.session_id, status.audio_id) {
            let _ = app.emit_to(
                "main",
                "recording-bookmark",
                Bookmark {
                    session_id,
                    audio_id,
                    duration_secs: status.duration_secs,
                },
            );
        }
    } else if app
        .get_webview_window("main")
        .is_some_and(|window| window.is_focused().unwrap_or(false))
    {
        let _ = app.emit_to("main", "recording-bookmark", Option::<Bookmark>::None);
    }
}

#[cfg(target_os = "linux")]
fn is_wayland() -> bool {
    std::env::var_os("WAYLAND_DISPLAY").is_some()
        || std::env::var("XDG_SESSION_TYPE").is_ok_and(|value| value == "wayland")
}

#[cfg(target_os = "linux")]
async fn run_portal(app: &AppHandle) -> Result<(), ashpd::Error> {
    use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
    use futures_util::{pin_mut, StreamExt};

    const ID: &str = "fieldnote-recording-bookmark";
    let portal = GlobalShortcuts::new().await?;
    let session = portal.create_session(Default::default()).await?;
    let activated = portal.receive_activated().await?;
    let request = portal
        .bind_shortcuts(
            &session,
            &[NewShortcut::new(ID, "Bookmark the current recording")
                .preferred_trigger("CTRL+SHIFT+m")],
            None,
            Default::default(),
        )
        .await?;
    let response = request.response()?;
    if !response
        .shortcuts()
        .iter()
        .any(|shortcut| shortcut.id() == ID)
    {
        return Ok(());
    }
    app.state::<BookmarkShortcut>()
        .ready
        .store(true, Ordering::Relaxed);
    let session_handle = serde_json::to_value(&session).ok();
    pin_mut!(activated);
    while let Some(event) = activated.next().await {
        if event.shortcut_id() == ID
            && session_handle.as_ref().and_then(|value| value.as_str())
                == Some(event.session_handle().as_str())
        {
            capture(app);
        }
    }
    Ok(())
}
