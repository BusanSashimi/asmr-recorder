//! ASMR's native host for the pinned FilmCraft engine. Project mutations have one owner.
use filmcraft_engine::{FsServices, Session, autosave::AutosaveConfig};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, mpsc},
    time::Duration,
};
use tokio::sync::oneshot;

type Work = Box<dyn FnOnce(&mut Session, &mut crate::editor_playback::Playback) + Send>;
pub struct Editor {
    tx: mpsc::SyncSender<Work>,
    frames: Arc<tokio::sync::Semaphore>,
    waves: Arc<tokio::sync::Semaphore>,
    pub closing: std::sync::atomic::AtomicBool,
}

impl Editor {
    pub fn start(data_dir: PathBuf) -> Result<Self, String> {
        let (tx, rx) = mpsc::sync_channel::<Work>(32);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("editor-session".into())
            .spawn(move || {
                filmcraft_platform::register();
                let mut session = Session::new(Arc::new(FsServices));
                let result = session
                    .start_autosave(AutosaveConfig::new(data_dir))
                    .map_err(|e| e.to_string());
                let failed = result.is_err();
                let _ = ready_tx.send(result);
                if failed {
                    return;
                }
                session.voiceover.input =
                    Some(Box::new(crate::editor_playback::audio_in::CpalIn::new("")));
                let mut playback = crate::editor_playback::Playback::new();
                loop {
                    match rx.recv_timeout(Duration::from_millis(50)) {
                        Ok(work) => {
                            work(&mut session, &mut playback);
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                    session.poll_persistence();
                    playback.tick(&mut session);
                    session.pump_jobs(Duration::from_millis(3));
                    session.drain_events();
                }
                playback.stop();
                session.shutdown();
            })
            .map_err(|e| e.to_string())?;
        ready_rx.recv().map_err(|e| e.to_string())??;
        Ok(Self {
            tx,
            frames: Arc::new(tokio::sync::Semaphore::new(2)),
            waves: Arc::new(tokio::sync::Semaphore::new(2)),
            closing: std::sync::atomic::AtomicBool::new(false),
        })
    }

    async fn call<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Session) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        self.with_playback(move |s, _| f(s)).await
    }
    async fn with_playback<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Session, &mut crate::editor_playback::Playback) -> Result<T, String>
        + Send
        + 'static,
    ) -> Result<T, String> {
        let (tx, rx) = oneshot::channel();
        self.tx.try_send(Box::new(move |s, p| {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(s,p)))
                .unwrap_or_else(|_| Err("The editor could not complete this operation. Your recovery journal is preserved.".into()));
            let _ = tx.send(result);
        })).map_err(|_| "The editor is busy. Please retry.".to_string())?;
        rx.await
            .map_err(|_| "The editor worker stopped.".to_string())?
    }
}

#[tauri::command]
pub async fn editor_transport(
    editor: tauri::State<'_, Editor>,
    action: String,
    time: Option<String>,
) -> Result<Value, String> {
    let (tx, rx) = oneshot::channel();
    editor
        .tx
        .try_send(Box::new(move |s, p| {
            let result = (|| {
                if s.voiceover.recording()
                    && matches!(action.as_str(), "seek" | "sourceSeek" | "sourcePlay")
                {
                    return Err("Stop and save the voice-over take before seeking.".into());
                }
                match action.as_str() {
                    "play" => p.start(s)?,
                    "forward" => p.shuttle(s, 1.0, false)?,
                    "reverse" => p.shuttle(s, -1.0, false)?,
                    "sourceForward" => p.shuttle(s, 1.0, true)?,
                    "sourceReverse" => p.shuttle(s, -1.0, true)?,
                    "loop" => p.toggle_loop(),
                    "pause" => {
                        p.tick(s);
                        p.pause(s)?;
                        if s.voiceover.recording() {
                            s.execute("audio.voiceover.stop", json!({"time":s.playhead().0}))
                                .map_err(|e| e.to_string())?;
                        }
                    }
                    "sourcePlay" => p.start_source(s)?,
                    "sourceSeek" => {
                        p.pause(s)?;
                        let t = time
                            .ok_or("Missing time")?
                            .parse::<i64>()
                            .map_err(|_| "Invalid time")?;
                        s.execute("source.setPlayhead", json!({"time":t}))
                            .map_err(|e| e.to_string())?;
                    }
                    "seek" => {
                        p.pause(s)?;
                        let tick = time
                            .ok_or("Missing time")?
                            .parse::<i64>()
                            .map_err(|_| "Invalid time")?;
                        s.set_playhead(filmcraft_engine::time::Tick(tick.max(0)));
                    }
                    "status" => {}
                    _ => return Err("Unknown transport operation".to_string()),
                }
                Ok(p.status(s))
            })();
            let _ = tx.send(result);
        }))
        .map_err(|_| "Editor busy")?;
    rx.await.map_err(|_| "Editor stopped")?
}

// All integer values are strings on the wire. Decimal text and filenames are never
// guessed to be numbers on input: only explicitly tagged integers are decoded.
fn lossless(value: Value) -> Value {
    match value {
        Value::Number(n) if n.is_i64() || n.is_u64() => Value::String(n.to_string()),
        Value::Array(a) => Value::Array(a.into_iter().map(lossless).collect()),
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, lossless(v))).collect()),
        v => v,
    }
}
fn decode(value: Value, depth: usize) -> Result<Value, String> {
    if depth > 64 {
        return Err("Parameters are nested too deeply.".into());
    }
    match value {
        Value::Object(o) if o.len() == 1 && o.contains_key("$integer") => {
            let text = o
                .get("$integer")
                .and_then(Value::as_str)
                .ok_or("Invalid integer")?;
            if let Ok(v) = text.parse::<i64>() {
                Ok(json!(v))
            } else {
                text.parse::<u64>()
                    .map(|v| json!(v))
                    .map_err(|_| "Integer out of range".into())
            }
        }
        Value::Object(o) => o
            .into_iter()
            .map(|(k, v)| Ok((k, decode(v, depth + 1)?)))
            .collect::<Result<serde_json::Map<_, _>, String>>()
            .map(Value::Object),
        Value::Array(a) => a
            .into_iter()
            .map(|v| decode(v, depth + 1))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        v => Ok(v),
    }
}

fn snapshot(s: &mut Session) -> Result<Value, String> {
    let commands: Vec<Value> = filmcraft_engine::command_specs()
        .iter()
        .map(|c| {
            let reason = (c.enabled)(s).err();
            json!({"id":c.id,"label":c.label,"menu":c.menu,"shortcut":c.shortcut,
            "params":c.params,"enabled":reason.is_none(),"reason":reason})
        })
        .collect();
    let jobs = s
        .execute("jobs.list", json!({}))
        .map_err(|e| e.to_string())?;
    let history = s
        .execute("history.list", json!({}))
        .map_err(|e| e.to_string())?;
    Ok(lossless(
        json!({"revision":s.revision,"dirty":s.is_dirty(),"path":s.path,
        "project":s.project,"state":s.state,"sequence":s.active_sequence(),
        "duration":s.active_sequence().map(|q| q.duration()),
        "source":s.state.source_item.and_then(|id|filmcraft_engine::clip_ops::source_view(s,id)).map(|v|{let mut value=v.to_json(s.state.source_playhead);value["rate"]=json!(v.rate);value}),
        "voiceover":s.voiceover.recording(),"commands":commands,"jobs":jobs,"history":history,
        "recovery":s.recovery_candidates()}),
    ))
}

#[tauri::command]
pub async fn editor_snapshot(editor: tauri::State<'_, Editor>) -> Result<Value, String> {
    editor.call(snapshot).await
}

#[tauri::command]
pub async fn editor_execute(
    editor: tauri::State<'_, Editor>,
    command: String,
    params: Value,
    revision: Option<String>,
) -> Result<Value, String> {
    let mut params = decode(params, 0)?;
    editor
        .with_playback(move |s, p| {
            if let Some(rev) = revision {
                if rev != s.revision.to_string()
                    && !matches!(
                        command.as_str(),
                        "trim.shuttle"
                            | "trim.shuttleStop"
                            | "trim.cancelDynamic"
                            | "trim.playAround"
                    )
                {
                    return Err("The project changed. Refresh and retry the edit.".into());
                }
            }
            if matches!(
                command.as_str(),
                "file.open"
                    | "file.newProject"
                    | "file.newProjectFromTemplate"
                    | "file.close"
                    | "file.closeProject"
                    | "file.closeAllProjects"
                    | "file.revert"
                    | "file.recover"
                    | "sequence.open"
                    | "source.open"
                    | "audio.voiceover.start"
                    | "audio.voiceover.stop"
            ) {
                p.tick(s);
                p.pause(s)?;
                if s.voiceover.recording() && command != "audio.voiceover.stop" {
                    return Err("Stop and save the voice-over take first.".into());
                }
            }
            if matches!(
                command.as_str(),
                "trim.shuttle" | "trim.playAround" | "trim.shuttleStop" | "trim.tick"
            ) {
                if p.is_playing() {
                    p.tick(s);
                    p.pause(s)?;
                }
                params["clock"] = json!(p.clock());
            }
            if command == "multicam.recordStart" {
                p.start(s)?;
            }
            let result = s.execute(&command, params).map_err(|e| e.to_string())?;
            if command == "audio.voiceover.start" {
                s.set_playhead(filmcraft_engine::time::Tick(
                    result["captureStart"].as_i64().unwrap_or(0),
                ));
                p.start(s)?;
            }
            Ok(json!({"result":lossless(result),"snapshot":snapshot(s)?}))
        })
        .await
}

#[tauri::command]
pub async fn editor_effects(editor: tauri::State<'_, Editor>) -> Result<Value, String> {
    editor
        .call(|_| {
            Ok(lossless(
                serde_json::to_value(filmcraft_engine::project::effect_defs())
                    .map_err(|e| e.to_string())?,
            ))
        })
        .await
}

#[tauri::command]
pub async fn editor_import_take(
    editor: tauri::State<'_, Editor>,
    path: String,
) -> Result<Value, String> {
    editor
        .call(move |s| {
            let result = s
                .execute("file.import", json!({"paths":[path]}))
                .map_err(|e| e.to_string())?;
            let item = result
                .get("items")
                .and_then(Value::as_array)
                .and_then(|a| a.first())
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    format!(
                        "The recording is saved, but import failed: {}",
                        result.get("errors").unwrap_or(&Value::Null)
                    )
                })?;
            s.state.project_selection = vec![filmcraft_engine::project::ItemId(item)];
            s.execute(
                "file.newSequence",
                json!({"name":"Recording","fromItem":item,"video":1,"audio":1}),
            )
            .map_err(|e| e.to_string())?;
            snapshot(s)
        })
        .await
}

#[tauri::command]
pub async fn editor_frame(
    editor: tauri::State<'_, Editor>,
    time: String,
    width: u32,
    source: Option<bool>,
    item: Option<String>,
    angle: Option<usize>,
) -> Result<tauri::ipc::Response, String> {
    let permit = editor
        .frames
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Preview is busy")?;
    let time = time.parse::<i64>().map_err(|_| "Invalid frame time")?;
    let explicit_item = item
        .map(|id| id.parse::<u64>().map(filmcraft_engine::project::ItemId))
        .transpose()
        .map_err(|_| "Invalid item")?;
    let is_source = source.unwrap_or(false) || explicit_item.is_some();
    let (project, media, services, id, scale) = editor
        .call(move |s| {
            let (id, w) = if is_source {
                let id = if let Some(id) = explicit_item {
                    id
                } else {
                    s.state
                        .source_item
                        .and_then(|id| filmcraft_engine::clip_ops::source_view(s, id))
                        .ok_or("Open a source clip first")?
                        .media
                };
                let w = s
                    .project
                    .item(id)
                    .and_then(|i| i.as_media())
                    .and_then(|m| m.info.video.as_ref())
                    .map(|v| v.width)
                    .unwrap_or(1920);
                (id, w)
            } else {
                let seq = s
                    .active_sequence()
                    .ok_or("Create a sequence to preview media.")?;
                (
                    s.state.active_sequence.ok_or("No sequence")?,
                    seq.settings.width,
                )
            };
            let scale = width.clamp(160, 1280) as f32 / w.max(1) as f32;
            Ok((
                s.project.clone(),
                s.media.clone(),
                s.services.clone(),
                id,
                scale.min(1.0),
            ))
        })
        .await?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let provider = media.provider(project.clone(), services);
        let t = filmcraft_engine::time::Tick(time.max(0));
        let t = if !is_source {
            project
                .sequence(id)
                .map(|q| {
                    q.settings.frame_rate.snap(t).min(
                        (q.duration() - q.settings.frame_rate.frame_duration())
                            .max(filmcraft_engine::time::Tick::ZERO),
                    )
                })
                .unwrap_or(t)
        } else {
            t
        };
        let img = if let Some(angle) = angle {
            filmcraft_engine::render::multicam::render_angle_thumbnail(
                &project, id, angle, t, scale, &provider,
            )
            .ok_or("Camera unavailable")?
        } else if is_source {
            filmcraft_engine::render::render_item(&project, id, t, scale, &provider)
                .ok_or("This source has no video frame")?
        } else {
            filmcraft_engine::render::render_sequence(
                &project,
                id,
                t,
                filmcraft_engine::render::RenderOptions {
                    scale,
                    captions: true,
                    ..Default::default()
                },
                &provider,
            )
        };
        let mut bytes = Vec::with_capacity(8 + img.w * img.h * 4);
        bytes.extend_from_slice(&(img.w as u32).to_le_bytes());
        bytes.extend_from_slice(&(img.h as u32).to_le_bytes());
        bytes.extend_from_slice(&img.over_black_rgba8());
        Ok::<_, String>(bytes)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn integers_roundtrip_without_losing_ten_hour_ticks() {
        let ticks = 254_016_000_000_i64 * 36_000;
        assert_eq!(lossless(json!(ticks)), json!(ticks.to_string()));
        assert_eq!(
            decode(
                json!({"time":{"$integer":ticks.to_string()},"title":"123"}),
                0
            )
            .unwrap(),
            json!({"time":ticks,"title":"123"})
        );
        assert!(decode(json!({"$integer":"92233720368547758080"}), 0).is_err());
    }
    #[test]
    fn edit_and_project_roundtrip() {
        let mut s = Session::default();
        s.execute("file.newSequence", json!({"name":"Test","fps":30}))
            .unwrap();
        s.execute("file.newColorMatte", json!({"color":"#336699","seconds":2}))
            .unwrap();
        let item = s.state.project_selection[0];
        s.execute(
            "timeline.place",
            json!({"item":item.0,"track":"V1","frame":0}),
        )
        .unwrap();
        assert!(s.active_sequence().unwrap().duration().0 > 0);
        assert!(snapshot(&mut s).unwrap()["revision"].is_string());
        let frame = s
            .try_render_program_at(0.1, filmcraft_engine::time::Tick::ZERO)
            .unwrap();
        assert_eq!(frame.over_black_rgba8().len(), frame.w * frame.h * 4);
        s.execute("edit.undo", json!({})).unwrap();
        assert_eq!(s.active_sequence().unwrap().duration().0, 0);
    }

    #[test]
    fn ui_payloads_edit_animate_mask_caption_and_mix() {
        let mut s = Session::default();
        s.execute(
            "file.newSequence",
            json!({"name":"UI contract","fps":30,"width":320,"height":180,"video":1,"audio":1}),
        )
        .unwrap();
        s.execute("file.newColorMatte", json!({"color":"#336699","seconds":5}))
            .unwrap();
        let item = s.state.project_selection[0];
        s.execute(
            "timeline.place",
            json!({"item":item.0,"track":"V1","frame":0}),
        )
        .unwrap();
        let clip = s.active_sequence().unwrap().video_tracks[0].items[0].id;
        let one = s.sequence_rate().tick_of(30);
        let two = s.sequence_rate().tick_of(60);
        let payload=decode(json!({"clip":{"$integer":clip.0.to_string()},"effect":"opacity","param":"opacity","value":20.0,"time":{"$integer":one.0.to_string()},"keyframe":true}),0).unwrap();
        s.execute("effects.setParam", payload).unwrap();
        s.execute("effects.setParam",json!({"clip":clip.0,"effect":"opacity","param":"opacity","value":80.0,"time":two.0,"keyframe":true})).unwrap();
        let opacity = &s
            .active_sequence()
            .unwrap()
            .find_item(clip)
            .unwrap()
            .1
            .effect("opacity")
            .unwrap()
            .params["opacity"];
        assert!(
            (opacity.f64_at(one + filmcraft_engine::time::Tick((two - one).0 / 2)) - 50.0).abs()
                < 0.001
        );
        s.execute("masks.add",json!({"clip":clip.0,"effect":"opacity","shape":"rectangle","center":[160,90],"size":[100,80]})).unwrap();
        s.execute(
            "masks.set",
            json!({"clip":clip.0,"effect":"opacity","mask":0,"feather":12.0}),
        )
        .unwrap();
        s.execute(
            "captions.add",
            json!({"text":"A caption","time":one.0,"durationSeconds":2}),
        )
        .unwrap();
        assert_eq!(
            s.active_sequence().unwrap().caption_tracks[0].captions[0].start,
            one
        );
        s.execute(
            "mixer.setValue",
            json!({"strip":"A1","lane":"volume","value":-6.0}),
        )
        .unwrap();
        assert_eq!(s.active_sequence().unwrap().audio_tracks[0].volume_db, -6.0);
        let original = s
            .active_sequence()
            .unwrap()
            .find_item(clip)
            .unwrap()
            .1
            .duration;
        s.execute(
            "timeline.trim",
            json!({"clip":clip.0,"edge":"out","mode":"regular","deltaFrames":-15}),
        )
        .unwrap();
        assert_eq!(
            s.active_sequence()
                .unwrap()
                .find_item(clip)
                .unwrap()
                .1
                .duration,
            original - s.sequence_rate().tick_of(15)
        );
        s.execute("edit.undo", json!({})).unwrap();
        assert_eq!(
            s.active_sequence()
                .unwrap()
                .find_item(clip)
                .unwrap()
                .1
                .duration,
            original
        );
        // The same canonical model used by .fcproj persistence retains these edits.
        let project: filmcraft_project::Project =
            serde_json::from_value(serde_json::to_value(&s.project).unwrap()).unwrap();
        let sequence = project.sequence(s.state.active_sequence.unwrap()).unwrap();
        assert_eq!(sequence.caption_tracks[0].captions[0].text, "A caption");
        assert_eq!(
            sequence
                .find_item(clip)
                .unwrap()
                .1
                .effect("opacity")
                .unwrap()
                .masks
                .len(),
            1
        );
    }
}

#[tauri::command]
pub async fn editor_shutdown(editor: tauri::State<'_, Editor>) -> Result<(), String> {
    editor
        .with_playback(|s, p| {
            if s.voiceover.recording() {
                return Err("Stop and save the voice-over take first.".into());
            }
            if s.jobs.iter().any(|j| {
                !j.progress
                    .finished
                    .load(std::sync::atomic::Ordering::Relaxed)
            }) {
                return Err("Finish or cancel running jobs first.".into());
            }
            p.pause(s)?;
            s.shutdown();
            Ok(())
        })
        .await?;
    editor
        .closing
        .store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn editor_query(
    editor: tauri::State<'_, Editor>,
    command: String,
    params: Value,
) -> Result<Value, String> {
    if command == "effects.curve" || command == "effects.values" {
        let params = decode(params, 0)?;
        return editor
            .call(move |s| {
                let id = filmcraft_project::ClipId(params["clip"].as_u64().ok_or("Select a clip")?);
                let (_, clip) = s
                    .active_sequence()
                    .and_then(|q| q.find_item(id))
                    .ok_or("Clip unavailable")?;
                if command == "effects.values" {
                    let time = clip.effect_time_at(filmcraft_engine::time::Tick(
                        params["time"].as_i64().unwrap_or(s.playhead().0),
                    ));
                    return Ok(lossless(json!(
                        clip.effects
                            .iter()
                            .map(|e| e
                                .params
                                .iter()
                                .map(|(id, p)| (id, p.value_at(time)))
                                .collect::<std::collections::BTreeMap<_, _>>())
                            .collect::<Vec<_>>()
                    )));
                }
                let index = params["effect"].as_u64().ok_or("Choose an effect")? as usize;
                let param = params["param"].as_str().ok_or("Choose a parameter")?;
                let p = clip
                    .effects
                    .get(index)
                    .and_then(|e| e.params.get(param))
                    .ok_or("Parameter unavailable")?;
                let start = clip.source_in;
                let span = clip.source_out() - start;
                Ok(json!(
                    (0..=128)
                        .map(|i| {
                            let t = start
                                + filmcraft_engine::time::Tick(((span.0 as i128 * i) / 128) as i64);
                            [t.seconds(), p.f64_at(t)]
                        })
                        .collect::<Vec<_>>()
                ))
            })
            .await;
    }
    if command == "trim.monitor" {
        return editor
            .call(|s| {
                let mut v = s
                    .execute("trim.monitor", json!({}))
                    .map_err(|e| e.to_string())?;
                v["revision"] = json!(s.revision);
                Ok(lossless(v))
            })
            .await;
    }
    if command == "mixer.meters" {
        return editor
            .call(|s| Ok(lossless(json!(s.previews.live.take_meters()))))
            .await;
    }
    if !matches!(
        command.as_str(),
        "transcript.inspect"
            | "transcript.models"
            | "tts.voices"
            | "export.formats"
            | "export.queue.list"
            | "scopes.read"
            | "mixer.inspect"
            | "masks.list"
            | "multicam.inspect"
            | "source.inspect"
            | "audio.voiceover.settings"
    ) {
        return Err("Unknown editor query".into());
    }
    let params = decode(params, 0)?;
    editor
        .call(move |s| {
            s.execute(&command, params)
                .map(lossless)
                .map_err(|e| e.to_string())
        })
        .await
}

/// Decode bounded audio blocks away from the session owner. Peaks contain real
/// per-channel extrema; silence and missing media are never fabricated.
#[tauri::command]
pub async fn editor_waveform(
    editor: tauri::State<'_, Editor>,
    item: String,
    start: String,
    duration: String,
    stream: Option<usize>,
    bins: usize,
) -> Result<Value, String> {
    let permit = editor
        .waves
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Preview is busy")?;
    let id = filmcraft_project::ItemId(item.parse().map_err(|_| "Invalid item")?);
    let start = start.parse::<i64>().map_err(|_| "Invalid start")?.max(0);
    let duration = duration
        .parse::<i64>()
        .map_err(|_| "Invalid duration")?
        .max(0);
    let (project, media, services) = editor
        .call(move |s| Ok((s.project.clone(), s.media.clone(), s.services.clone())))
        .await?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        use filmcraft_engine::{render::SourceProvider, time::Tick};
        let provider = media.provider(project.clone(), services);
        let sequence = project.sequence(id);
        let sr = sequence.map(|q| q.settings.sample_rate).unwrap_or(8000);
        let source = provider.source(id);
        if sequence.is_none() && source.is_none() {
            return Err("Audio source is unavailable".to_string());
        }
        let total = Tick(duration).to_units_floor(sr as i64).max(0) as usize;
        let first = Tick(start).to_units_floor(sr as i64);
        let bins = bins.clamp(16, 2048).min(total.max(1));
        let mut peaks = vec![[0f32; 2]; bins];
        let mut cursor = 0usize;
        while cursor < total {
            let n = (total - cursor).min(sr as usize * 4);
            let sound = if let Some(q) = sequence {
                filmcraft_engine::render::audio::mix_sequence(
                    &project,
                    q,
                    first + cursor as i64,
                    n,
                    &provider,
                )
            } else {
                source
                    .as_ref()
                    .unwrap()
                    .audio_stream(stream.unwrap_or(0), first + cursor as i64, n, sr)
                    .map_err(|e| e.to_string())?
            };
            for channel in &sound.channels {
                for (i, &sample) in channel.iter().take(n).enumerate() {
                    if sample.is_finite() {
                        let p = &mut peaks
                            [((cursor + i) as u128 * bins as u128 / total.max(1) as u128) as usize];
                        p[0] = p[0].min(sample);
                        p[1] = p[1].max(sample);
                    }
                }
            }
            cursor += n;
        }
        Ok(json!(peaks))
    })
    .await
    .map_err(|e| e.to_string())?
}
