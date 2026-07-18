use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Mutex,
};

const PROTOCOL_VERSION: u8 = 1;
const MAX_BRIDGE_BODY: usize = 16 * 1024;
const MAX_SOUNDBITE_BYTES: usize = 25 * 1024 * 1024;
const MAX_SOUNDBITE_DURATION: f64 = 30.0;
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(12);
const DISCOVERY_FILE: &str = "build-sound-bridge.json";
const STATE_FILE: &str = "build-sounds.json";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuildSoundSettings {
    pub enabled: bool,
    pub monitored_url: String,
    pub monitored_port: u16,
    pub selection_mode: SelectionMode,
    pub volume: u8,
    pub ordered_soundbite_ids: Vec<String>,
}

impl Default for BuildSoundSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            monitored_url: "http://localhost:5174".into(),
            monitored_port: 5174,
            selection_mode: SelectionMode::Sequential,
            volume: 70,
            ordered_soundbite_ids: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SelectionMode {
    Sequential,
    Shuffle,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SoundbiteMetadata {
    pub id: String,
    pub display_name: String,
    pub mime_type: String,
    pub byte_size: u64,
    pub duration: f64,
    pub created_at: u64,
    pub available: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedBuildSounds {
    settings: BuildSoundSettings,
    soundbites: Vec<SoundbiteMetadata>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuildBridgeStatus {
    pub state: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub actual_port: Option<u16>,
    pub last_heartbeat: Option<u64>,
    pub last_event: Option<u64>,
}

impl Default for BuildBridgeStatus {
    fn default() -> Self {
        Self {
            state: "waiting".into(),
            project_id: None,
            project_name: None,
            actual_port: None,
            last_heartbeat: None,
            last_event: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSoundStateResponse {
    pub settings: BuildSoundSettings,
    pub soundbites: Vec<SoundbiteMetadata>,
    pub bridge_status: BuildBridgeStatus,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeMessage {
    protocol_version: u8,
    project_id: String,
    project_name: String,
    port: u16,
    #[serde(default)]
    event_id: Option<String>,
    #[serde(default)]
    event_type: Option<String>,
    #[serde(default)]
    timestamp: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildSuccessPayload {
    project_id: String,
    project_name: String,
    actual_port: u16,
    event_id: String,
    event_type: String,
    timestamp: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryDocument<'a> {
    protocol_version: u8,
    port: u16,
    token: &'a str,
}

#[derive(Default)]
struct BridgeRuntime {
    status: BuildBridgeStatus,
    last_heartbeat_received: Option<Instant>,
    seen_events: HashMap<(String, String), Instant>,
}

enum BridgeAcceptance {
    Ignored,
    Duplicate,
    Heartbeat(BuildBridgeStatus),
    Event(BuildSuccessPayload, BuildBridgeStatus),
}

fn expire_heartbeat(bridge: &mut BridgeRuntime, now: Instant) -> bool {
    let timed_out = bridge
        .last_heartbeat_received
        .is_some_and(|received| now.saturating_duration_since(received) >= HEARTBEAT_TIMEOUT);
    if timed_out && bridge.status.state != "waiting" {
        bridge.status = BuildBridgeStatus::default();
        bridge.last_heartbeat_received = None;
        true
    } else {
        false
    }
}

pub struct BuildSoundsState {
    root: PathBuf,
    audio_dir: PathBuf,
    persisted: Mutex<PersistedBuildSounds>,
    bridge: Mutex<BridgeRuntime>,
}

impl BuildSoundsState {
    pub fn load(app: &AppHandle) -> Result<Arc<Self>, String> {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Could not resolve app data directory: {e}"))?;
        let audio_dir = root.join("build-sounds");
        fs::create_dir_all(&audio_dir)
            .map_err(|e| format!("Could not create build-sound directory: {e}"))?;

        let state_path = root.join(STATE_FILE);
        let mut persisted = match fs::read(&state_path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                PersistedBuildSounds::default()
            }
            Err(error) => return Err(format!("Could not read build-sound settings: {error}")),
        };
        normalize_persisted(&audio_dir, &mut persisted);
        let normalized = serde_json::to_vec_pretty(&persisted)
            .map_err(|e| format!("Could not serialize build-sound state: {e}"))?;
        atomic_write(&state_path, &normalized, true)
            .map_err(|e| format!("Could not normalize build-sound settings: {e}"))?;

        Ok(Arc::new(Self {
            root,
            audio_dir,
            persisted: Mutex::new(persisted),
            bridge: Mutex::new(BridgeRuntime::default()),
        }))
    }

    fn discovery_path(&self) -> PathBuf {
        self.root.join(DISCOVERY_FILE)
    }

    pub fn clean_discovery(&self) {
        match fs::remove_file(self.discovery_path()) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => eprintln!("[BuildSounds] Failed to remove discovery file: {error}"),
        }
    }

    async fn persist(&self, value: &PersistedBuildSounds) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(value)
            .map_err(|e| format!("Could not serialize build-sound state: {e}"))?;
        atomic_write(&self.root.join(STATE_FILE), &bytes, true)
            .map_err(|e| format!("Could not save build-sound state: {e}"))
    }
}

fn normalize_persisted(audio_dir: &Path, persisted: &mut PersistedBuildSounds) {
    let known: HashSet<_> = persisted
        .soundbites
        .iter()
        .map(|item| item.id.clone())
        .collect();
    let mut seen = HashSet::new();
    persisted
        .settings
        .ordered_soundbite_ids
        .retain(|id| known.contains(id) && seen.insert(id.clone()));
    for item in &mut persisted.soundbites {
        item.available = audio_dir.join(&item.id).exists();
        if !persisted.settings.ordered_soundbite_ids.contains(&item.id) {
            persisted
                .settings
                .ordered_soundbite_ids
                .push(item.id.clone());
        }
    }
    persisted.settings.volume = persisted.settings.volume.min(100);
    if !persisted.soundbites.iter().any(|item| item.available) {
        persisted.settings.enabled = false;
    }
}

fn atomic_write(path: &Path, bytes: &[u8], private: bool) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    fs::create_dir_all(parent)?;
    let mut file = tempfile::Builder::new()
        .prefix(".asmr-recorder-")
        .tempfile_in(parent)?;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    #[cfg(unix)]
    if private {
        use std::os::unix::fs::PermissionsExt;
        file.as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    let _ = private;
    file.persist(path).map_err(|error| error.error)?;
    Ok(())
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn sanitize_filename(raw: &str) -> String {
    let decoded = percent_decode(raw);
    let basename = decoded
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("soundbite")
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>();
    let trimmed = basename.trim().trim_matches('.').trim();
    let limited: String = trimmed.chars().take(180).collect();
    if limited.is_empty() {
        "soundbite".into()
    } else {
        limited
    }
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
            {
                output.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[tauri::command]
pub async fn get_build_sound_state(
    state: State<'_, Arc<BuildSoundsState>>,
) -> Result<BuildSoundStateResponse, String> {
    let persisted = state.persisted.lock().await.clone();
    let bridge_status = state.bridge.lock().await.status.clone();
    Ok(BuildSoundStateResponse {
        settings: persisted.settings,
        soundbites: persisted.soundbites,
        bridge_status,
    })
}

#[tauri::command]
pub async fn update_build_sound_settings(
    settings: BuildSoundSettings,
    state: State<'_, Arc<BuildSoundsState>>,
    app: AppHandle,
) -> Result<BuildSoundSettings, String> {
    if settings.volume > 100 {
        return Err("Volume must be between 0 and 100".into());
    }
    validate_loopback_url(&settings.monitored_url, settings.monitored_port)?;

    let mut persisted = state.persisted.lock().await;
    let known: HashSet<_> = persisted
        .soundbites
        .iter()
        .map(|item| item.id.as_str())
        .collect();
    let ordered: HashSet<_> = settings
        .ordered_soundbite_ids
        .iter()
        .map(String::as_str)
        .collect();
    if ordered != known || ordered.len() != settings.ordered_soundbite_ids.len() {
        return Err("Soundbite order must contain every catalog item exactly once".into());
    }
    let mut settings = settings;
    if !persisted.soundbites.iter().any(|item| item.available) {
        settings.enabled = false;
    }
    persisted.settings = settings.clone();
    state.persist(&persisted).await?;
    drop(persisted);

    let reset_status = {
        let mut bridge = state.bridge.lock().await;
        let no_longer_matches = bridge
            .status
            .actual_port
            .is_some_and(|actual| actual != settings.monitored_port);
        if no_longer_matches && bridge.status.state == "connected" {
            bridge.status = BuildBridgeStatus::default();
            bridge.last_heartbeat_received = None;
            Some(bridge.status.clone())
        } else {
            None
        }
    };
    if let Some(status) = reset_status {
        let _ = app.emit("build-sound://bridge-status", status);
    }
    Ok(settings)
}

fn validate_loopback_url(url: &str, port: u16) -> Result<(), String> {
    if port == 0 {
        return Err("The monitored port must be between 1 and 65535".into());
    }
    let lower = url.trim().to_ascii_lowercase();
    let authority = lower
        .strip_prefix("http://")
        .and_then(|value| value.split(['/', '?', '#']).next())
        .ok_or_else(|| "Only loopback HTTP URLs can be monitored".to_string())?;
    let port_text = authority
        .strip_prefix("localhost:")
        .or_else(|| authority.strip_prefix("127.0.0.1:"))
        .or_else(|| authority.strip_prefix("[::1]:"))
        .ok_or_else(|| "Only loopback HTTP URLs can be monitored".to_string())?;
    let url_port = port_text
        .parse::<u16>()
        .map_err(|_| "The monitored URL must include a valid explicit port".to_string())?;
    if url_port != port {
        return Err("The monitored URL and port must match".into());
    }
    if authority.contains('@') {
        return Err("Only loopback HTTP URLs can be monitored".into());
    }
    Ok(())
}

fn header<'a>(request: &'a tauri::ipc::Request<'_>, name: &str) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .ok_or_else(|| format!("Missing {name} header"))?
        .to_str()
        .map_err(|_| format!("Invalid {name} header"))
}

fn validate_soundbite_upload(
    byte_size: usize,
    raw_name: &str,
    raw_mime: &str,
    duration: f64,
) -> Result<(String, String), String> {
    if byte_size == 0 || byte_size > MAX_SOUNDBITE_BYTES {
        return Err("Soundbites must be between 1 byte and 25 MB".into());
    }
    let display_name = sanitize_filename(raw_name);
    let mime_type = raw_mime.trim().to_ascii_lowercase();
    if !mime_type.starts_with("audio/") || mime_type.len() > 128 {
        return Err("Soundbite MIME type must be audio/*".into());
    }
    if !duration.is_finite() || duration <= 0.0 || duration > MAX_SOUNDBITE_DURATION {
        return Err("Soundbites must be no longer than 30 seconds".into());
    }
    Ok((display_name, mime_type))
}

#[tauri::command]
pub async fn import_soundbite(
    request: tauri::ipc::Request<'_>,
    state: State<'_, Arc<BuildSoundsState>>,
) -> Result<SoundbiteMetadata, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("import_soundbite expects a raw byte body".into());
    };
    let raw_name = header(&request, "x-soundbite-name")?;
    let raw_mime = header(&request, "x-soundbite-mime")?;
    let duration: f64 = header(&request, "x-soundbite-duration")?
        .parse()
        .map_err(|_| "Invalid soundbite duration".to_string())?;
    let (display_name, mime_type) =
        validate_soundbite_upload(bytes.len(), raw_name, raw_mime, duration)?;

    let id = uuid::Uuid::new_v4().to_string();
    atomic_write(&state.audio_dir.join(&id), bytes, true)
        .map_err(|e| format!("Could not store soundbite: {e}"))?;
    let metadata = SoundbiteMetadata {
        id: id.clone(),
        display_name,
        mime_type,
        byte_size: bytes.len() as u64,
        duration,
        created_at: unix_millis(),
        available: true,
    };

    let mut persisted = state.persisted.lock().await;
    persisted.soundbites.push(metadata.clone());
    persisted.settings.ordered_soundbite_ids.push(id);
    if let Err(error) = state.persist(&persisted).await {
        let _ = fs::remove_file(state.audio_dir.join(&metadata.id));
        persisted.soundbites.retain(|item| item.id != metadata.id);
        persisted
            .settings
            .ordered_soundbite_ids
            .retain(|item| item != &metadata.id);
        return Err(error);
    }
    Ok(metadata)
}

#[tauri::command]
pub async fn read_soundbite(
    id: String,
    state: State<'_, Arc<BuildSoundsState>>,
) -> Result<tauri::ipc::Response, String> {
    let persisted = state.persisted.lock().await;
    if !persisted.soundbites.iter().any(|item| item.id == id) {
        return Err("Unknown soundbite".into());
    }
    drop(persisted);
    let bytes = fs::read(state.audio_dir.join(&id))
        .map_err(|e| format!("Could not read soundbite: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn set_soundbite_availability(
    id: String,
    available: bool,
    state: State<'_, Arc<BuildSoundsState>>,
) -> Result<(), String> {
    let mut persisted = state.persisted.lock().await;
    let item = persisted
        .soundbites
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or_else(|| "Unknown soundbite".to_string())?;
    item.available = available && state.audio_dir.join(&id).exists();
    if !persisted.soundbites.iter().any(|item| item.available) {
        persisted.settings.enabled = false;
    }
    state.persist(&persisted).await
}

#[tauri::command]
pub async fn delete_soundbite(
    id: String,
    state: State<'_, Arc<BuildSoundsState>>,
) -> Result<(), String> {
    let mut persisted = state.persisted.lock().await;
    if !persisted.soundbites.iter().any(|item| item.id == id) {
        return Err("Unknown soundbite".into());
    }
    let path = state.audio_dir.join(&id);
    match fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Could not delete soundbite: {error}")),
    }
    persisted.soundbites.retain(|item| item.id != id);
    persisted
        .settings
        .ordered_soundbite_ids
        .retain(|item| item != &id);
    if !persisted.soundbites.iter().any(|item| item.available) {
        persisted.settings.enabled = false;
    }
    state.persist(&persisted).await
}

pub fn start_bridge(app: AppHandle, state: Arc<BuildSoundsState>) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_bridge(app, state).await {
            eprintln!("[BuildSounds] Bridge stopped: {error}");
        }
    });
}

async fn run_bridge(app: AppHandle, state: Arc<BuildSoundsState>) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| format!("Could not bind bridge: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Could not read bridge address: {e}"))?
        .port();
    let mut token_bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut token_bytes);
    let token = token_bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let document = DiscoveryDocument {
        protocol_version: PROTOCOL_VERSION,
        port,
        token: &token,
    };
    let bytes = serde_json::to_vec(&document).map_err(|e| e.to_string())?;
    atomic_write(&state.discovery_path(), &bytes, true)
        .map_err(|e| format!("Could not write discovery file: {e}"))?;
    println!("[BuildSounds] Bridge listening on 127.0.0.1:{port}");

    let timeout_app = app.clone();
    let timeout_state = state.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let changed = {
                let mut bridge = timeout_state.bridge.lock().await;
                expire_heartbeat(&mut bridge, Instant::now())
            };
            if changed {
                let status = timeout_state.bridge.lock().await.status.clone();
                let _ = timeout_app.emit("build-sound://bridge-status", status);
            }
        }
    });

    loop {
        let (stream, _) = listener
            .accept()
            .await
            .map_err(|e| format!("Bridge accept failed: {e}"))?;
        let app = app.clone();
        let state = state.clone();
        let token = token.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = handle_connection(stream, app, state, &token).await {
                eprintln!("[BuildSounds] Request failed: {error}");
            }
        });
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    app: AppHandle,
    state: Arc<BuildSoundsState>,
    token: &str,
) -> Result<(), String> {
    let response = match read_http_request(&mut stream).await {
        Ok(request) => process_bridge_request(request, &app, &state, token).await,
        Err(HttpReadError::Oversized) => http_response(413, "request too large"),
        Err(HttpReadError::Malformed(message)) => http_response(400, &message),
    };
    stream
        .write_all(&response)
        .await
        .map_err(|e| format!("Could not write response: {e}"))?;
    let _ = stream.shutdown().await;
    Ok(())
}

struct HttpRequest {
    method: String,
    path: String,
    authorization: Option<String>,
    body: Vec<u8>,
}

#[derive(Debug)]
enum HttpReadError {
    Oversized,
    Malformed(String),
}

async fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, HttpReadError> {
    let mut buffer = Vec::with_capacity(2048);
    let header_end;
    loop {
        let mut chunk = [0_u8; 2048];
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|e| HttpReadError::Malformed(e.to_string()))?;
        if read == 0 {
            return Err(HttpReadError::Malformed("incomplete request".into()));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_BRIDGE_BODY + 8192 {
            return Err(HttpReadError::Oversized);
        }
        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            header_end = index + 4;
            break;
        }
    }
    let headers = std::str::from_utf8(&buffer[..header_end])
        .map_err(|_| HttpReadError::Malformed("headers must be UTF-8".into()))?;
    let mut lines = headers.split("\r\n");
    let mut request_line = lines
        .next()
        .ok_or_else(|| HttpReadError::Malformed("missing request line".into()))?
        .split_whitespace();
    let method = request_line.next().unwrap_or_default().to_string();
    let path = request_line.next().unwrap_or_default().to_string();
    if method.is_empty() || path.is_empty() {
        return Err(HttpReadError::Malformed("invalid request line".into()));
    }
    let mut content_length = None;
    let mut authorization = None;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => {
                content_length = Some(
                    value
                        .trim()
                        .parse::<usize>()
                        .map_err(|_| HttpReadError::Malformed("invalid content length".into()))?,
                )
            }
            "authorization" => authorization = Some(value.trim().to_string()),
            _ => {}
        }
    }
    let content_length = content_length
        .ok_or_else(|| HttpReadError::Malformed("content length is required".into()))?;
    if content_length > MAX_BRIDGE_BODY {
        return Err(HttpReadError::Oversized);
    }
    while buffer.len() - header_end < content_length {
        let mut chunk = [0_u8; 2048];
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|e| HttpReadError::Malformed(e.to_string()))?;
        if read == 0 {
            return Err(HttpReadError::Malformed("incomplete body".into()));
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    Ok(HttpRequest {
        method,
        path,
        authorization,
        body: buffer[header_end..header_end + content_length].to_vec(),
    })
}

async fn process_bridge_request(
    request: HttpRequest,
    app: &AppHandle,
    state: &Arc<BuildSoundsState>,
    token: &str,
) -> Vec<u8> {
    if request.method != "POST" {
        return http_response(405, "method not allowed");
    }
    if !is_authorized(request.authorization.as_deref(), token) {
        return http_response(401, "unauthorized");
    }
    if request.path != "/v1/heartbeat" && request.path != "/v1/events" {
        return http_response(404, "not found");
    }
    let message: BridgeMessage = match serde_json::from_slice(&request.body) {
        Ok(message) => message,
        Err(_) => return http_response(400, "malformed JSON"),
    };
    if message.protocol_version != PROTOCOL_VERSION
        || message.project_id.is_empty()
        || message.project_name.is_empty()
    {
        return http_response(400, "invalid protocol payload");
    }
    let settings = state.persisted.lock().await.settings.clone();
    let accepted = {
        let mut bridge = state.bridge.lock().await;
        accept_bridge_message(
            &request.path,
            &settings,
            message,
            &mut bridge,
            Instant::now(),
        )
    };
    match accepted {
        Ok(BridgeAcceptance::Ignored) => http_response(202, "ignored"),
        Ok(BridgeAcceptance::Duplicate) => http_response(202, "duplicate"),
        Ok(BridgeAcceptance::Heartbeat(status)) => {
            let _ = app.emit("build-sound://bridge-status", status);
            http_response(204, "")
        }
        Ok(BridgeAcceptance::Event(payload, status)) => {
            let _ = app.emit("build-sound://build-success", payload);
            let _ = app.emit("build-sound://bridge-status", status);
            http_response(204, "")
        }
        Err(message) => http_response(400, message),
    }
}

fn is_authorized(authorization: Option<&str>, token: &str) -> bool {
    authorization == Some(&format!("Bearer {token}"))
}

fn accept_bridge_message(
    path: &str,
    settings: &BuildSoundSettings,
    message: BridgeMessage,
    bridge: &mut BridgeRuntime,
    now: Instant,
) -> Result<BridgeAcceptance, &'static str> {
    if message.port != settings.monitored_port {
        return Ok(BridgeAcceptance::Ignored);
    }
    if path == "/v1/heartbeat" {
        bridge.last_heartbeat_received = Some(now);
        bridge.status.state = "connected".into();
        bridge.status.project_id = Some(message.project_id);
        bridge.status.project_name = Some(message.project_name);
        bridge.status.actual_port = Some(message.port);
        bridge.status.last_heartbeat = Some(message.timestamp.unwrap_or_else(unix_millis));
        return Ok(BridgeAcceptance::Heartbeat(bridge.status.clone()));
    }
    if !settings.enabled {
        return Ok(BridgeAcceptance::Ignored);
    }

    let (Some(event_id), Some(event_type)) = (message.event_id, message.event_type) else {
        return Err("event ID and type are required");
    };
    if !matches!(event_type.as_str(), "hmr" | "full-reload") {
        return Err("unsupported event type");
    }
    bridge
        .seen_events
        .retain(|_, seen| now.saturating_duration_since(*seen) < Duration::from_secs(300));
    let key = (message.project_id.clone(), event_id.clone());
    if bridge.seen_events.contains_key(&key) {
        return Ok(BridgeAcceptance::Duplicate);
    }
    bridge.seen_events.insert(key, now);
    let timestamp = message.timestamp.unwrap_or_else(unix_millis);
    bridge.status.last_event = Some(timestamp);
    let payload = BuildSuccessPayload {
        project_id: message.project_id,
        project_name: message.project_name,
        actual_port: message.port,
        event_id,
        event_type,
        timestamp,
    };
    Ok(BridgeAcceptance::Event(payload, bridge.status.clone()))
}

fn http_response(code: u16, body: &str) -> Vec<u8> {
    let reason = match code {
        204 => "No Content",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        _ => "OK",
    };
    format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Length: {}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bridge_message(port: u16) -> BridgeMessage {
        BridgeMessage {
            protocol_version: PROTOCOL_VERSION,
            project_id: "project-1".into(),
            project_name: "Fixture".into(),
            port,
            event_id: Some("event-1".into()),
            event_type: Some("hmr".into()),
            timestamp: Some(1234),
        }
    }

    #[test]
    fn sanitizes_paths_controls_and_encoded_names() {
        assert_eq!(
            sanitize_filename("..%2Ffolder%2Fbell%20one.wav"),
            "bell one.wav"
        );
        assert_eq!(sanitize_filename("C%3A%5Ctemp%5Ctap%00.mp3"), "tap.mp3");
        assert_eq!(sanitize_filename("...."), "soundbite");
    }

    #[test]
    fn validates_import_headers_size_and_duration() {
        let valid = validate_soundbite_upload(12, "folder%2Ftap.wav", "Audio/WAV", 2.5)
            .expect("valid soundbite");
        assert_eq!(valid, ("tap.wav".into(), "audio/wav".into()));
        assert!(validate_soundbite_upload(0, "tap.wav", "audio/wav", 1.0).is_err());
        assert!(
            validate_soundbite_upload(MAX_SOUNDBITE_BYTES + 1, "tap.wav", "audio/wav", 1.0,)
                .is_err()
        );
        assert!(validate_soundbite_upload(12, "tap.wav", "text/plain", 1.0).is_err());
        assert!(validate_soundbite_upload(12, "tap.wav", "audio/wav", 30.01).is_err());
        assert!(validate_soundbite_upload(12, "tap.wav", "audio/wav", f64::NAN).is_err());
    }

    #[test]
    fn stored_audio_round_trips_and_deletes() {
        let root = std::env::temp_dir().join(format!("asmr-audio-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join(uuid::Uuid::new_v4().to_string());
        let expected = b"raw audio bytes";
        atomic_write(&path, expected, true).unwrap();
        assert_eq!(fs::read(&path).unwrap(), expected);
        atomic_write(&path, b"replacement", true).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"replacement");
        fs::remove_file(&path).unwrap();
        assert!(!path.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn validates_only_loopback_urls() {
        assert!(validate_loopback_url("http://localhost:5174", 5174).is_ok());
        assert!(validate_loopback_url("http://127.0.0.1:5174", 5174).is_ok());
        assert!(validate_loopback_url("http://localhost:5175", 5174).is_err());
        assert!(validate_loopback_url("https://example.com:5174", 5174).is_err());
        assert!(validate_loopback_url("http://192.168.1.5:5174", 5174).is_err());
    }

    #[test]
    fn bearer_auth_rejects_invalid_and_stale_tokens() {
        assert!(is_authorized(Some("Bearer current"), "current"));
        assert!(!is_authorized(Some("Bearer stale"), "current"));
        assert!(!is_authorized(None, "current"));
    }

    #[test]
    fn filters_wrong_ports_and_deduplicates_project_event_ids() {
        let settings = BuildSoundSettings {
            enabled: true,
            monitored_port: 5174,
            ..Default::default()
        };
        let mut bridge = BridgeRuntime::default();
        let now = Instant::now();
        assert!(matches!(
            accept_bridge_message(
                "/v1/events",
                &settings,
                bridge_message(5175),
                &mut bridge,
                now,
            ),
            Ok(BridgeAcceptance::Ignored)
        ));
        assert!(matches!(
            accept_bridge_message(
                "/v1/events",
                &settings,
                bridge_message(5174),
                &mut bridge,
                now,
            ),
            Ok(BridgeAcceptance::Event(_, _))
        ));
        assert!(matches!(
            accept_bridge_message(
                "/v1/events",
                &settings,
                bridge_message(5174),
                &mut bridge,
                now + Duration::from_millis(1),
            ),
            Ok(BridgeAcceptance::Duplicate)
        ));
    }

    #[test]
    fn heartbeat_connects_then_expires_after_twelve_seconds() {
        let settings = BuildSoundSettings {
            enabled: true,
            monitored_port: 5174,
            ..Default::default()
        };
        let mut bridge = BridgeRuntime::default();
        let start = Instant::now();
        assert!(matches!(
            accept_bridge_message(
                "/v1/heartbeat",
                &settings,
                bridge_message(5174),
                &mut bridge,
                start,
            ),
            Ok(BridgeAcceptance::Heartbeat(_))
        ));
        assert_eq!(bridge.status.state, "connected");
        assert!(!expire_heartbeat(
            &mut bridge,
            start + HEARTBEAT_TIMEOUT - Duration::from_millis(1),
        ));
        assert!(expire_heartbeat(&mut bridge, start + HEARTBEAT_TIMEOUT,));
        assert_eq!(bridge.status, BuildBridgeStatus::default());
    }

    #[test]
    fn disabled_catalog_still_detects_heartbeats_but_ignores_events() {
        let settings = BuildSoundSettings {
            enabled: false,
            monitored_port: 5174,
            ..Default::default()
        };
        let mut bridge = BridgeRuntime::default();
        let now = Instant::now();
        assert!(matches!(
            accept_bridge_message(
                "/v1/heartbeat",
                &settings,
                bridge_message(5174),
                &mut bridge,
                now,
            ),
            Ok(BridgeAcceptance::Heartbeat(_))
        ));
        assert!(matches!(
            accept_bridge_message(
                "/v1/events",
                &settings,
                bridge_message(5174),
                &mut bridge,
                now,
            ),
            Ok(BridgeAcceptance::Ignored)
        ));
    }

    #[tokio::test]
    async fn rejects_oversized_http_bodies_before_reading_them() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let client = tokio::spawn(async move {
            let mut stream = TcpStream::connect(address).await.unwrap();
            stream
                .write_all(
                    format!(
                        "POST /v1/events HTTP/1.1\r\nContent-Length: {}\r\n\r\n",
                        MAX_BRIDGE_BODY + 1
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        let (mut server, _) = listener.accept().await.unwrap();
        assert!(matches!(
            read_http_request(&mut server).await,
            Err(HttpReadError::Oversized)
        ));
        client.await.unwrap();
    }

    #[tokio::test]
    async fn parses_authenticated_raw_http_and_rejects_malformed_lengths() {
        async fn parse(raw: &'static [u8]) -> Result<HttpRequest, HttpReadError> {
            let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
            let address = listener.local_addr().unwrap();
            tokio::spawn(async move {
                let mut stream = TcpStream::connect(address).await.unwrap();
                stream.write_all(raw).await.unwrap();
            });
            let (mut server, _) = listener.accept().await.unwrap();
            read_http_request(&mut server).await
        }

        let request = parse(
            b"POST /v1/events HTTP/1.1\r\nAuthorization: Bearer token\r\nContent-Length: 2\r\n\r\n{}",
        )
        .await
        .unwrap();
        assert_eq!(request.authorization.as_deref(), Some("Bearer token"));
        assert_eq!(request.body, b"{}");
        assert!(matches!(
            parse(b"POST /v1/events HTTP/1.1\r\nContent-Length: nope\r\n\r\n").await,
            Err(HttpReadError::Malformed(_))
        ));
    }

    #[test]
    fn discovery_file_is_private_and_removed_on_cleanup() {
        let root = std::env::temp_dir().join(format!("asmr-discovery-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let state = BuildSoundsState {
            audio_dir: root.join("audio"),
            root: root.clone(),
            persisted: Mutex::new(PersistedBuildSounds::default()),
            bridge: Mutex::new(BridgeRuntime::default()),
        };
        let path = state.discovery_path();
        atomic_write(&path, b"discovery", true).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        state.clean_discovery();
        assert!(!path.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn normalizes_missing_files_and_disables_enablement() {
        let root = std::env::temp_dir().join(format!("asmr-normalize-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let mut persisted = PersistedBuildSounds {
            settings: BuildSoundSettings {
                enabled: true,
                ..Default::default()
            },
            soundbites: vec![SoundbiteMetadata {
                id: "missing".into(),
                display_name: "Missing".into(),
                mime_type: "audio/wav".into(),
                byte_size: 1,
                duration: 1.0,
                created_at: 0,
                available: true,
            }],
        };
        normalize_persisted(&root, &mut persisted);
        assert!(!persisted.settings.enabled);
        assert!(!persisted.soundbites[0].available);
        let _ = fs::remove_dir(&root);
    }
}
