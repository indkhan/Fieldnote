use crate::{
    model::{id, Audio},
    store::{Result, Store},
};
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    FromSample, Sample, SampleFormat, SizedSample,
};
use serde::Serialize;
use std::{
    fs::{File, OpenOptions},
    io::{BufWriter, Read, Seek, SeekFrom, Write},
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

#[derive(Serialize)]
pub struct InputDevice {
    pub id: String,
    pub name: String,
}

pub fn input_devices() -> Result<Vec<InputDevice>> {
    let host = cpal::default_host();
    Ok(host
        .input_devices()
        .map_err(|e| e.to_string())?
        .filter_map(|d| {
            Some(InputDevice {
                id: d.id().ok()?.to_string(),
                name: d.description().ok()?.name().to_string(),
            })
        })
        .collect())
}

#[derive(Default)]
struct Shared {
    paused: AtomicBool,
    stop: AtomicBool,
    finished: AtomicBool,
    samples: AtomicU64,
    rate: AtomicU32,
    level: AtomicU32,
    error: Mutex<Option<String>>,
}
impl Shared {
    fn fail(&self, error: String) {
        if let Ok(mut e) = self.error.lock() {
            if e.is_none() {
                *e = Some(error)
            }
        }
        self.stop.store(true, Ordering::Relaxed);
    }
    fn raise_level(&self, peak: f32) {
        let _ = self
            .level
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                Some(f32::from_bits(current).max(peak).to_bits())
            });
    }
    /// Loudest peak since the previous reading, so short sounds between polls still reach the meter.
    fn take_level(&self) -> f32 {
        f32::from_bits(self.level.swap(0, Ordering::Relaxed))
    }
}

struct Active {
    audio: Audio,
    shared: Arc<Shared>,
    worker: JoinHandle<Result<()>>,
}
#[derive(Default)]
pub struct Recorder {
    active: Option<Active>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub active: bool,
    pub finished: bool,
    pub paused: bool,
    pub session_id: Option<String>,
    pub duration_secs: f64,
    pub level: f32,
    pub error: Option<String>,
}

impl Recorder {
    pub fn start(
        &mut self,
        store: &Store,
        session_id: &str,
        device_id: Option<String>,
    ) -> Result<Status> {
        if self.active.is_some() {
            return Err("Finish the current recording first.".into());
        }
        store.session(session_id)?;
        let audio_id = id();
        let audio = Audio {
            id: audio_id.clone(),
            session_id: session_id.into(),
            name: format!("Recording-{}.wav", &audio_id[..8]),
            relative_path: format!("audio/{audio_id}.wav"),
            byte_length: 0,
            duration_secs: None,
            status: "recording".into(),
        };
        let path = store.managed_path(&audio.relative_path)?;
        store.save_audio(&audio)?;
        let shared = Arc::new(Shared::default());
        let worker_shared = shared.clone();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let worker = thread::spawn(move || {
            let result = capture(&path, device_id, worker_shared.clone(), ready_tx.clone());
            if let Err(e) = &result {
                worker_shared.fail(e.clone());
                let _ = ready_tx.try_send(Err(e.clone()));
            }
            worker_shared.finished.store(true, Ordering::Release);
            result
        });
        self.active = Some(Active {
            audio,
            shared,
            worker,
        });
        match ready_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(())) => Ok(self.status()),
            Ok(Err(e)) => {
                let _ = self.stop(store);
                Err(e)
            }
            Err(_) => {
                if let Some(a) = &self.active {
                    a.shared.stop.store(true, Ordering::Relaxed)
                }
                Err("The microphone did not respond. Stop recording and check Windows microphone access.".into())
            }
        }
    }

    pub fn status(&self) -> Status {
        let Some(a) = &self.active else {
            return Status::default();
        };
        let rate = a.shared.rate.load(Ordering::Relaxed).max(1);
        Status {
            active: true,
            finished: a.shared.finished.load(Ordering::Acquire),
            paused: a.shared.paused.load(Ordering::Relaxed),
            session_id: Some(a.audio.session_id.clone()),
            duration_secs: a.shared.samples.load(Ordering::Relaxed) as f64 / rate as f64,
            level: a.shared.take_level(),
            error: a.shared.error.lock().ok().and_then(|e| e.clone()),
        }
    }

    pub fn pause(&self, paused: bool) -> Result<Status> {
        let a = self.active.as_ref().ok_or("No recording is active.")?;
        a.shared.paused.store(paused, Ordering::Relaxed);
        if paused {
            a.shared.level.store(0, Ordering::Relaxed)
        }
        Ok(self.status())
    }

    pub fn stop(&mut self, store: &Store) -> Result<Option<Audio>> {
        let Some(mut a) = self.active.take() else {
            return Ok(None);
        };
        a.shared.stop.store(true, Ordering::Relaxed);
        let worker_result = a
            .worker
            .join()
            .unwrap_or_else(|_| Err("The audio worker stopped unexpectedly.".into()));
        let path = store.managed_path(&a.audio.relative_path)?;
        match repair_wav(&path) {
            Ok((bytes, seconds)) => {
                a.audio.byte_length = bytes;
                a.audio.duration_secs = Some(seconds);
                a.audio.status = if worker_result.is_ok() {
                    "ready"
                } else {
                    "recovered"
                }
                .into()
            }
            Err(_) => {
                a.audio.status = "failed".into();
                a.audio.byte_length = path.metadata().map_or(0, |m| m.len())
            }
        }
        store.save_audio(&a.audio)?;
        if let Err(error) = worker_result {
            return Err(format!(
                "Recording stopped: {error}. Any saved audio was retained in this session."
            ));
        }
        Ok(Some(a.audio))
    }
}

/// An xrun only means a few samples were glitched or dropped; the stream keeps delivering audio.
/// WASAPI commonly reports one as soon as a capture stream starts.
fn stops_recording(error: &cpal::Error) -> bool {
    error.kind() != cpal::ErrorKind::Xrun
}

fn build_stream<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    tx: SyncSender<Vec<i16>>,
    shared: Arc<Shared>,
) -> Result<cpal::Stream>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    let error_shared = shared.clone();
    device
        .build_input_stream(
            config,
            move |input: &[T], _| {
                if shared.paused.load(Ordering::Relaxed) || shared.stop.load(Ordering::Relaxed) {
                    return;
                }
                let mut peak = 0.0f32;
                let mut mono = Vec::with_capacity(input.len() / channels);
                for frame in input.chunks_exact(channels) {
                    let sample =
                        frame.iter().map(|s| f32::from_sample(*s)).sum::<f32>() / channels as f32;
                    let sample = if sample.is_finite() {
                        sample.clamp(-1.0, 1.0)
                    } else {
                        0.0
                    };
                    peak = peak.max(sample.abs());
                    mono.push((sample * i16::MAX as f32) as i16)
                }
                shared.raise_level(peak);
                if tx.try_send(mono).is_err() {
                    shared.fail(
                        "Audio could not be saved fast enough. Check available disk space.".into(),
                    )
                }
            },
            move |e| {
                if stops_recording(&e) {
                    error_shared.fail(format!("Microphone error: {e}"))
                }
            },
            Some(Duration::from_secs(5)),
        )
        .map_err(|e| format!("Cannot open microphone: {e}"))
}

fn capture(
    path: &Path,
    device_id: Option<String>,
    shared: Arc<Shared>,
    ready: SyncSender<Result<()>>,
) -> Result<()> {
    let host = cpal::default_host();
    let device = if let Some(id) = device_id {
        let parsed = id.parse().map_err(|_| "Invalid microphone ID.")?;
        host.device_by_id(&parsed)
    } else {
        host.default_input_device()
    }
    .ok_or("No microphone is available. Connect one or import an audio file.")?;
    let supported = device
        .default_input_config()
        .map_err(|e| format!("Cannot read microphone settings: {e}"))?;
    let rate = supported.sample_rate();
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    if config.channels == 0 || rate == 0 {
        return Err("Invalid microphone configuration.".into());
    }
    shared.rate.store(rate, Ordering::Relaxed);
    let mut writer = WavWriter::create(path, rate)?;
    let (tx, rx) = mpsc::sync_channel(64);
    let stream = match format {
        SampleFormat::F32 => build_stream::<f32>(&device, config, tx, shared.clone()),
        SampleFormat::F64 => build_stream::<f64>(&device, config, tx, shared.clone()),
        SampleFormat::I16 => build_stream::<i16>(&device, config, tx, shared.clone()),
        SampleFormat::I32 => build_stream::<i32>(&device, config, tx, shared.clone()),
        SampleFormat::U16 => build_stream::<u16>(&device, config, tx, shared.clone()),
        _ => {
            return Err(format!(
                "Microphone format {format} is not supported. Try another microphone."
            ))
        }
    }?;
    stream
        .play()
        .map_err(|e| format!("Cannot start microphone: {e}"))?;
    let _ = ready.send(Ok(()));
    let mut checkpoint = Instant::now();
    let mut outcome = Ok(());
    while !shared.stop.load(Ordering::Relaxed) {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(samples) => {
                if let Err(e) = writer.append(&samples) {
                    outcome = Err(e);
                    break;
                }
                shared.samples.store(writer.samples, Ordering::Relaxed)
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => break,
        }
        if checkpoint.elapsed() >= Duration::from_secs(1) {
            if let Err(e) = writer.checkpoint() {
                outcome = Err(e);
                break;
            }
            checkpoint = Instant::now()
        }
    }
    shared.stop.store(true, Ordering::Relaxed);
    drop(stream);
    if outcome.is_ok() {
        for samples in rx.try_iter() {
            if let Err(e) = writer.append(&samples) {
                outcome = Err(e);
                break;
            }
        }
    }
    shared.samples.store(writer.samples, Ordering::Relaxed);
    let finalize = writer.checkpoint();
    outcome?;
    finalize?;
    if let Some(e) = shared
        .error
        .lock()
        .map_err(|_| "Audio state unavailable.")?
        .clone()
    {
        return Err(e);
    }
    Ok(())
}

struct WavWriter {
    file: BufWriter<File>,
    rate: u32,
    samples: u64,
    bytes: Vec<u8>,
}
fn header(rate: u32, bytes: u32) -> [u8; 44] {
    let mut h = [0u8; 44];
    h[..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + bytes).to_le_bytes());
    h[8..12].copy_from_slice(b"WAVE");
    h[12..16].copy_from_slice(b"fmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes());
    h[22..24].copy_from_slice(&1u16.to_le_bytes());
    h[24..28].copy_from_slice(&rate.to_le_bytes());
    h[28..32].copy_from_slice(&(rate * 2).to_le_bytes());
    h[32..34].copy_from_slice(&2u16.to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&bytes.to_le_bytes());
    h
}
impl WavWriter {
    fn create(path: &Path, rate: u32) -> Result<Self> {
        let mut file = BufWriter::with_capacity(
            65536,
            OpenOptions::new()
                .write(true)
                .read(true)
                .create_new(true)
                .open(path)
                .map_err(|e| e.to_string())?,
        );
        file.write_all(&header(rate, 0))
            .map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
        Ok(Self {
            file,
            rate,
            samples: 0,
            bytes: Vec::new(),
        })
    }
    fn append(&mut self, samples: &[i16]) -> Result<()> {
        if (self.samples + samples.len() as u64) * 2 > (u32::MAX - 36) as u64 {
            return Err(
                "This recording reached the WAV file size limit. Start another take.".into(),
            );
        }
        self.bytes.clear();
        for s in samples {
            self.bytes.extend_from_slice(&s.to_le_bytes())
        }
        self.file
            .write_all(&self.bytes)
            .map_err(|e| e.to_string())?;
        self.samples += samples.len() as u64;
        Ok(())
    }
    fn checkpoint(&mut self) -> Result<()> {
        self.file
            .seek(SeekFrom::Start(0))
            .map_err(|e| e.to_string())?;
        self.file
            .write_all(&header(self.rate, (self.samples * 2) as u32))
            .map_err(|e| e.to_string())?;
        self.file.flush().map_err(|e| e.to_string())?;
        self.file.get_ref().sync_data().map_err(|e| e.to_string())?;
        self.file
            .seek(SeekFrom::End(0))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub fn repair_wav(path: &Path) -> Result<(u64, f64)> {
    let mut f = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    let mut h = [0u8; 44];
    f.read_exact(&mut h).map_err(|e| e.to_string())?;
    if &h[..4] != b"RIFF"
        || &h[8..12] != b"WAVE"
        || &h[36..40] != b"data"
        || u16::from_le_bytes([h[22], h[23]]) != 1
        || u16::from_le_bytes([h[34], h[35]]) != 16
    {
        return Err("Unexpected recording format; original file left unchanged.".into());
    }
    let rate = u32::from_le_bytes(h[24..28].try_into().unwrap());
    let length = f.metadata().map_err(|e| e.to_string())?.len();
    let bytes = length.saturating_sub(44) / 2 * 2;
    if rate == 0 || bytes > (u32::MAX - 36) as u64 {
        return Err("Cannot safely recover this WAV file.".into());
    }
    f.set_len(bytes + 44).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    f.write_all(&header(rate, bytes as u32))
        .map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    Ok((bytes + 44, bytes as f64 / (rate as f64 * 2.0)))
}

pub fn recover(store: &Store) -> Result<usize> {
    let mut count = 0;
    for mut a in store.unfinished_audio()? {
        let path = store.managed_path(&a.relative_path)?;
        match repair_wav(&path) {
            Ok((size, seconds)) => {
                a.status = "recovered".into();
                a.byte_length = size;
                a.duration_secs = Some(seconds);
                count += 1
            }
            Err(_) => a.status = "failed".into(),
        }
        store.save_audio(&a)?
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Needs a real microphone: `cargo test --lib live_ -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_microphone_writes_samples() {
        for d in input_devices().unwrap() {
            println!("device: {} | {}", d.name, d.id);
        }
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let project = store.create_project("Test").unwrap();
        let session = store
            .create_session(&project.id, None, "2026-11-02")
            .unwrap();
        let mut recorder = Recorder::default();
        recorder.start(&store, &session.id, None).unwrap();
        thread::sleep(Duration::from_secs(3));
        let status = recorder.status();
        println!(
            "after 3s: duration={} level={} finished={} error={:?}",
            status.duration_secs, status.level, status.finished, status.error
        );
        let audio = recorder.stop(&store).unwrap().unwrap();
        println!(
            "saved: {} bytes, {:?}s",
            audio.byte_length, audio.duration_secs
        );
        let wav = std::fs::read(store.managed_path(&audio.relative_path).unwrap()).unwrap();
        let peak = wav[44..]
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]).unsigned_abs())
            .max();
        println!("peak sample: {peak:?} of 32767");
        assert!(audio.byte_length > 44, "only the WAV header was written");
        assert!(audio.duration_secs.unwrap() > 2.0);
    }

    #[test]
    fn level_reports_the_loudest_peak_since_the_last_reading() {
        let shared = Shared::default();
        shared.raise_level(0.4);
        shared.raise_level(0.1);
        assert_eq!(shared.take_level(), 0.4);
        assert_eq!(shared.take_level(), 0.0);
    }

    #[test]
    fn xruns_do_not_stop_a_recording_but_lost_devices_do() {
        assert!(!stops_recording(&cpal::ErrorKind::Xrun.into()));
        assert!(stops_recording(&cpal::ErrorKind::DeviceNotAvailable.into()));
    }

    #[test]
    fn interrupted_audio_is_recovered_from_actual_file_length() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("take.wav");
        {
            let mut w = WavWriter::create(&path, 48000).unwrap();
            w.append(&[0, 1, -1, 32767]).unwrap();
            w.file.flush().unwrap();
        }
        let mut f = OpenOptions::new().append(true).open(&path).unwrap();
        f.write_all(&[255]).unwrap();
        drop(f);
        let (size, seconds) = repair_wav(&path).unwrap();
        assert_eq!(size, 52);
        assert_eq!(seconds, 4.0 / 48000.0);
        let bytes = std::fs::read(path).unwrap();
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 8);
    }
    #[test]
    fn corrupt_headers_are_not_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("bad.wav");
        let original = [7u8; 50];
        std::fs::write(&p, original).unwrap();
        assert!(repair_wav(&p).is_err());
        assert_eq!(std::fs::read(p).unwrap(), original);
    }

    #[test]
    fn startup_recovery_reattaches_interrupted_audio_to_its_session() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let project = store.create_project("Test").unwrap();
        let session = store
            .create_session(&project.id, None, "2026-11-02")
            .unwrap();
        let audio = Audio {
            id: id(),
            session_id: session.id.clone(),
            name: "Interrupted.wav".into(),
            relative_path: "audio/interrupted.wav".into(),
            byte_length: 0,
            duration_secs: None,
            status: "recording".into(),
        };
        store.save_audio(&audio).unwrap();
        {
            let mut writer =
                WavWriter::create(&store.managed_path(&audio.relative_path).unwrap(), 48000)
                    .unwrap();
            writer.append(&[0; 480]).unwrap();
            writer.file.flush().unwrap();
        }
        drop(store);
        let reopened = Store::open(dir.path()).unwrap();
        assert_eq!(recover(&reopened).unwrap(), 1);
        let recovered = reopened.audio(&session.id).unwrap().remove(0);
        assert_eq!(recovered.status, "recovered");
        assert_eq!(recovered.byte_length, 1004);
        assert_eq!(recovered.duration_secs, Some(0.01));
    }
}
