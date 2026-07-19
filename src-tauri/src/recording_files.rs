use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Manager, State};

const MAX_CHUNK_BYTES: usize = 16 * 1024 * 1024;
const MAX_RECORDING_BYTES: u64 = 16 * 1024 * 1024 * 1024 * 1024;
const STALE_PART_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const PART_PREFIX: &str = ".asmr-recorder-";
const PART_SUFFIX: &str = ".part";

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecordingContainer {
    Mp4,
    Webm,
}

impl RecordingContainer {
    fn extension(self) -> &'static str {
        match self {
            Self::Mp4 => "mp4",
            Self::Webm => "webm",
        }
    }

    fn mime_type(self) -> &'static str {
        match self {
            Self::Mp4 => "video/mp4",
            Self::Webm => "video/webm",
        }
    }

    fn has_valid_header(self, header: &[u8]) -> bool {
        match self {
            Self::Mp4 => header.get(4..8) == Some(&b"ftyp"[..]),
            Self::Webm => header.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecordingPurpose {
    Capture,
    Trim,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingFileSession {
    session_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingArtifact {
    pub path: String,
    pub file_name: String,
    pub mime_type: String,
    pub byte_size: u64,
}

struct SessionFile {
    file: Option<File>,
    max_end: u64,
}

struct RecordingSession {
    container: RecordingContainer,
    part_path: PathBuf,
    final_path: PathBuf,
    file: Mutex<SessionFile>,
}

pub struct RecordingFileStore {
    output_dir: PathBuf,
    sessions: Mutex<HashMap<String, Arc<RecordingSession>>>,
}

impl RecordingFileStore {
    pub fn load() -> Result<Arc<Self>, String> {
        let output_dir = recording_output_dir()?;
        Self::at(output_dir).map(Arc::new)
    }

    fn at(output_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&output_dir)
            .map_err(|error| format!("Could not create recording directory: {error}"))?;
        remove_stale_parts(&output_dir);
        Ok(Self {
            output_dir,
            sessions: Mutex::new(HashMap::new()),
        })
    }

    fn begin(
        &self,
        container: RecordingContainer,
        purpose: RecordingPurpose,
    ) -> Result<RecordingFileSession, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let short_id = id.split('-').next().unwrap_or("recording");
        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let suffix = match purpose {
            RecordingPurpose::Capture => "",
            RecordingPurpose::Trim => "_trimmed",
        };
        let file_name = format!(
            "recording_{timestamp}_{short_id}{suffix}.{}",
            container.extension()
        );
        let part_path = self
            .output_dir
            .join(format!("{PART_PREFIX}{id}{PART_SUFFIX}"));
        let final_path = self.output_dir.join(file_name);
        let file = open_private_file(&part_path)
            .map_err(|error| format!("Could not create recording file: {error}"))?;

        self.sessions.lock().insert(
            id.clone(),
            Arc::new(RecordingSession {
                container,
                part_path,
                final_path,
                file: Mutex::new(SessionFile {
                    file: Some(file),
                    max_end: 0,
                }),
            }),
        );
        Ok(RecordingFileSession { session_id: id })
    }

    fn session(&self, session_id: &str) -> Result<Arc<RecordingSession>, String> {
        self.sessions
            .lock()
            .get(session_id)
            .cloned()
            .ok_or_else(|| "Unknown or closed recording session".to_string())
    }

    fn write(&self, session_id: &str, position: u64, bytes: &[u8]) -> Result<(), String> {
        validate_write(position, bytes.len())?;
        let session = self.session(session_id)?;
        let mut state = session.file.lock();
        let file = state
            .file
            .as_mut()
            .ok_or_else(|| "Recording session is already closed".to_string())?;
        file.seek(SeekFrom::Start(position))
            .and_then(|_| file.write_all(bytes))
            .map_err(|error| format!("Could not write recording chunk: {error}"))?;
        state.max_end = state.max_end.max(position + bytes.len() as u64);
        Ok(())
    }

    fn finalize(&self, session_id: &str) -> Result<RecordingArtifact, String> {
        let session = self
            .sessions
            .lock()
            .remove(session_id)
            .ok_or_else(|| "Unknown or closed recording session".to_string())?;

        let result = finalize_session(&session);
        if result.is_err() {
            session.file.lock().file.take();
            let _ = fs::remove_file(&session.part_path);
        }
        result
    }

    fn abort(&self, session_id: &str) -> Result<(), String> {
        let Some(session) = self.sessions.lock().remove(session_id) else {
            return Ok(());
        };
        session.file.lock().file.take();
        match fs::remove_file(&session.part_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Could not remove partial recording: {error}")),
        }
    }

    pub fn abort_all(&self) {
        let ids = self.sessions.lock().keys().cloned().collect::<Vec<_>>();
        for id in ids {
            if let Err(error) = self.abort(&id) {
                eprintln!("[RecordingFiles] {error}");
            }
        }
    }
}

fn finalize_session(session: &RecordingSession) -> Result<RecordingArtifact, String> {
    let mut state = session.file.lock();
    if state.max_end == 0 {
        state.file.take();
        return Err("Cannot finalize an empty recording".into());
    }
    let max_end = state.max_end;
    let file = state
        .file
        .as_mut()
        .ok_or_else(|| "Recording session is already closed".to_string())?;
    file.set_len(max_end)
        .and_then(|_| file.flush())
        .and_then(|_| file.seek(SeekFrom::Start(0)).map(|_| ()))
        .map_err(|error| format!("Could not prepare recording file: {error}"))?;

    let mut header = [0_u8; 12];
    let read = file
        .read(&mut header)
        .map_err(|error| format!("Could not validate recording file: {error}"))?;
    if !session.container.has_valid_header(&header[..read]) {
        state.file.take();
        return Err(format!(
            "Recording is not a valid {} file",
            session.container.extension().to_uppercase()
        ));
    }
    file.sync_all()
        .map_err(|error| format!("Could not flush recording file: {error}"))?;
    state.file.take();
    drop(state);

    fs::rename(&session.part_path, &session.final_path)
        .map_err(|error| format!("Could not finalize recording file: {error}"))?;
    let file_name = session
        .final_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("recording")
        .to_string();
    Ok(RecordingArtifact {
        path: session.final_path.to_string_lossy().into_owned(),
        file_name,
        mime_type: session.container.mime_type().to_string(),
        byte_size: max_end,
    })
}

fn validate_write(position: u64, byte_size: usize) -> Result<(), String> {
    if byte_size == 0 || byte_size > MAX_CHUNK_BYTES {
        return Err("Recording chunks must be between 1 byte and 16 MB".into());
    }
    let end = position
        .checked_add(byte_size as u64)
        .ok_or_else(|| "Recording position overflow".to_string())?;
    if end > MAX_RECORDING_BYTES {
        return Err("Recording exceeds the 16 TB safety limit".into());
    }
    Ok(())
}

fn open_private_file(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.create_new(true).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn remove_stale_parts(output_dir: &Path) {
    let Ok(entries) = fs::read_dir(output_dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(PART_PREFIX) || !name.ends_with(PART_SUFFIX) {
            continue;
        }
        let is_stale = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age >= STALE_PART_AGE);
        if is_stale {
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[cfg(debug_assertions)]
fn recording_output_dir() -> Result<PathBuf, String> {
    Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test-results"))
}

#[cfg(not(debug_assertions))]
fn recording_output_dir() -> Result<PathBuf, String> {
    dirs::video_dir().ok_or_else(|| "Could not find videos directory".to_string())
}

fn header<'a>(request: &'a tauri::ipc::Request<'_>, name: &str) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .ok_or_else(|| format!("Missing {name} header"))?
        .to_str()
        .map_err(|_| format!("Invalid {name} header"))
}

#[tauri::command]
pub async fn begin_recording_file(
    container: RecordingContainer,
    purpose: RecordingPurpose,
    state: State<'_, Arc<RecordingFileStore>>,
) -> Result<RecordingFileSession, String> {
    state.begin(container, purpose)
}

#[tauri::command]
pub async fn write_recording_file(
    request: tauri::ipc::Request<'_>,
    state: State<'_, Arc<RecordingFileStore>>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("write_recording_file expects a raw byte body".into());
    };
    validate_write(0, bytes.len())?;
    let session_id = header(&request, "x-recording-session-id")?.to_string();
    let position = header(&request, "x-recording-position")?
        .parse::<u64>()
        .map_err(|_| "Invalid recording position".to_string())?;
    validate_write(position, bytes.len())?;
    let bytes = bytes.clone();
    let store = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || store.write(&session_id, position, &bytes))
        .await
        .map_err(|error| format!("Recording writer stopped unexpectedly: {error}"))?
}

#[tauri::command]
pub async fn finalize_recording_file(
    session_id: String,
    state: State<'_, Arc<RecordingFileStore>>,
    app: AppHandle,
) -> Result<RecordingArtifact, String> {
    let store = Arc::clone(&state);
    let artifact = tauri::async_runtime::spawn_blocking(move || store.finalize(&session_id))
        .await
        .map_err(|error| format!("Recording finalizer stopped unexpectedly: {error}"))??;
    app.asset_protocol_scope()
        .allow_file(&artifact.path)
        .map_err(|error| format!("Could not authorize recording preview: {error}"))?;
    Ok(artifact)
}

#[tauri::command]
pub async fn abort_recording_file(
    session_id: String,
    state: State<'_, Arc<RecordingFileStore>>,
) -> Result<(), String> {
    let store = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || store.abort(&session_id))
        .await
        .map_err(|error| format!("Recording cleanup stopped unexpectedly: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mp4_bytes() -> Vec<u8> {
        vec![0, 0, 0, 12, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm']
    }

    #[test]
    fn writes_out_of_order_and_finalizes_exact_length() {
        let directory = tempfile::tempdir().unwrap();
        let store = RecordingFileStore::at(directory.path().to_path_buf()).unwrap();
        let session = store
            .begin(RecordingContainer::Mp4, RecordingPurpose::Capture)
            .unwrap();
        let bytes = mp4_bytes();
        store.write(&session.session_id, 8, &bytes[8..]).unwrap();
        store.write(&session.session_id, 0, &bytes[..8]).unwrap();

        let artifact = store.finalize(&session.session_id).unwrap();
        assert_eq!(artifact.byte_size, bytes.len() as u64);
        assert_eq!(fs::read(artifact.path).unwrap(), bytes);
    }

    #[cfg(unix)]
    #[test]
    fn partial_files_are_user_only() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let store = RecordingFileStore::at(directory.path().to_path_buf()).unwrap();
        let session = store
            .begin(RecordingContainer::Mp4, RecordingPurpose::Capture)
            .unwrap();
        let part_path = store
            .session(&session.session_id)
            .unwrap()
            .part_path
            .clone();

        let mode = fs::metadata(part_path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn rejects_invalid_container_and_removes_partial_file() {
        let directory = tempfile::tempdir().unwrap();
        let store = RecordingFileStore::at(directory.path().to_path_buf()).unwrap();
        let session = store
            .begin(RecordingContainer::Mp4, RecordingPurpose::Capture)
            .unwrap();
        store.write(&session.session_id, 0, b"not an mp4").unwrap();

        assert!(store.finalize(&session.session_id).is_err());
        assert!(fs::read_dir(directory.path()).unwrap().next().is_none());
    }

    #[test]
    fn abort_is_idempotent_and_removes_partial_file() {
        let directory = tempfile::tempdir().unwrap();
        let store = RecordingFileStore::at(directory.path().to_path_buf()).unwrap();
        let session = store
            .begin(RecordingContainer::Webm, RecordingPurpose::Capture)
            .unwrap();
        store
            .write(&session.session_id, 0, &[0x1a, 0x45, 0xdf, 0xa3])
            .unwrap();

        store.abort(&session.session_id).unwrap();
        store.abort(&session.session_id).unwrap();
        assert!(fs::read_dir(directory.path()).unwrap().next().is_none());
    }

    #[test]
    fn validates_chunk_bounds() {
        assert!(validate_write(0, 0).is_err());
        assert!(validate_write(0, MAX_CHUNK_BYTES + 1).is_err());
        assert!(validate_write(MAX_RECORDING_BYTES, 1).is_err());
    }
}
