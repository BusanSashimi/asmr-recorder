// Adapted from FilmCraft 8309f21a6c3f34ddf190af7fd9bfd913053a1fd5.
// Copyright FilmCraft contributors; MIT OR Apache-2.0. See licenses/filmcraft.
#![allow(dead_code)]
mod audio;
pub mod audio_in;
mod play_ahead;
mod shuttle;
use filmcraft_engine::{Session, time::Tick};
use serde_json::json;
use std::sync::Arc;

pub struct Playback {
    audio: audio::CpalOut,
    anchor: Tick,
    source: bool,
    speed: f64,
    looping: bool,
    audio_clock: bool,
    item: Option<filmcraft_project::ItemId>,
    note: Option<String>,
    playing: bool,
    started: std::time::Instant,
    epoch: std::time::Instant,
}
impl Playback {
    pub fn new() -> Self {
        Self {
            audio: audio::CpalOut::new(),
            anchor: Tick::ZERO,
            source: false,
            speed: 1.0,
            looping: false,
            audio_clock: false,
            item: None,
            note: None,
            playing: false,
            started: std::time::Instant::now(),
            epoch: std::time::Instant::now(),
        }
    }
    pub fn clock(&self) -> f64 {
        self.epoch.elapsed().as_secs_f64()
    }
    pub fn is_playing(&self) -> bool {
        self.playing
    }
    pub fn stop(&mut self) {
        self.audio.stop();
        self.playing = false;
    }
    pub fn start(&mut self, s: &mut Session) -> Result<(), String> {
        self.start_speed(s, 1.0)
    }
    pub fn start_speed(&mut self, s: &mut Session, speed: f64) -> Result<(), String> {
        self.pause(s)?;
        self.speed = speed;
        if !s.voiceover.recording()
            && s.active_sequence()
                .is_some_and(|q| s.playhead() >= q.duration())
            && speed > 0.0
        {
            s.set_playhead(Tick::ZERO);
        }
        self.source = false;
        self.item = s.state.active_sequence;
        let seq = s.active_sequence().ok_or("No sequence is open")?;
        let id = s.state.active_sequence.ok_or("No sequence is open")?;
        self.audio
            .configure(&s.prefs.audio_hardware, Some(seq.settings.sample_rate));
        let sr = self.audio.sample_rate().max(1);
        self.anchor = s.playhead();
        self.audio_clock = false;
        if let Some((rate, mix)) = shuttle::mix(s, id, sr, speed) {
            let fill = play_ahead::spawn(
                mix,
                self.anchor.to_units_floor(rate as i64),
                sr,
                self.audio.channels(),
                Arc::new(play_ahead::AudioStats::default()),
            );
            self.audio.start(fill)?;
            self.audio_clock = true;
        }
        self.started = std::time::Instant::now();
        self.playing = true;
        s.execute("mixer.recordStart", json!({"time":self.anchor.0}))
            .map_err(|e| e.to_string())?;
        if s.voiceover.recording() {
            s.execute("audio.voiceover.sync", json!({"time":self.anchor.0}))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    pub fn pause(&mut self, s: &mut Session) -> Result<(), String> {
        if s.trim_play.active() {
            s.execute("trim.shuttleStop", json!({"clock":self.clock()}))
                .map_err(|e| e.to_string())?;
        }
        let was_playing = self.playing;
        self.stop();
        if was_playing && !self.source {
            s.execute("mixer.recordStop", json!({"time":s.playhead().0}))
                .map_err(|e| e.to_string())?;
        }
        if s.mcrec.active() {
            s.execute("multicam.recordStop", json!({"time":s.playhead().0}))
                .map_err(|e| e.to_string())?;
        }
        // Voice-over capture is committed explicitly by the stop command, so a failed
        // disk write leaves the input buffer available for retry.
        Ok(())
    }
    pub fn start_source(&mut self, s: &mut Session) -> Result<(), String> {
        self.pause(s)?;
        let item = s.state.source_item.ok_or("Open a source clip first")?;
        let view = filmcraft_engine::clip_ops::source_view(s, item).ok_or("Source unavailable")?;
        self.source = true;
        self.speed = 1.0;
        self.audio_clock = true;
        self.item = Some(item);
        self.audio.configure(&s.prefs.audio_hardware, None);
        let sr = self.audio.sample_rate().max(1);
        if s.state.source_playhead >= view.end {
            s.state.source_playhead = view.start;
        }
        self.anchor = s.state.source_playhead;
        let project = s.project.clone();
        let provider = s.media.provider(project.clone(), s.services.clone());
        use filmcraft_engine::render::SourceProvider;
        let source = provider.source(view.media);
        let end = view.end.to_units_floor(sr as i64);
        let map = [
            s.prefs.audio_hardware.map_left,
            s.prefs.audio_hardware.map_right,
        ];
        let mixdown = filmcraft_audio_dsp::channels::Mixdown::from_id(&s.prefs.audio.mixdown_type)
            .unwrap_or_default();
        let channels = project
            .item(view.media)
            .and_then(|i| i.as_media())
            .and_then(|m| m.interpret.audio_channels.as_ref())
            .and_then(|m| m.clips.first())
            .cloned()
            .unwrap_or_default();
        let fill = play_ahead::spawn(
            move |cursor, buf, ch| {
                buf.fill(0.0);
                if ch == 0 || cursor >= end {
                    return;
                }
                let n = (buf.len() / ch).min(end.saturating_sub(cursor) as usize);
                if let Some(source) = &source
                    && let Ok(mut sound) = source.audio(cursor, n, sr)
                {
                    if !channels.is_empty() {
                        sound.channels = channels
                            .iter()
                            .filter_map(|c| sound.channels.get(usize::from(*c)).cloned())
                            .collect();
                    }
                    let sound = filmcraft_engine::render::audio::to_layout(
                        sound,
                        filmcraft_audio_dsp::channels::Layout::Stereo,
                        mixdown,
                    );
                    if let Some(left) = sound.channels.first() {
                        filmcraft_engine::settings::map_output(
                            left,
                            sound.channels.get(1).unwrap_or(left),
                            buf,
                            ch,
                            map,
                        );
                    }
                }
            },
            self.anchor.to_units_floor(sr as i64),
            sr,
            self.audio.channels(),
            Arc::new(play_ahead::AudioStats::default()),
        );
        self.audio.start(fill)?;
        self.started = std::time::Instant::now();
        self.playing = true;
        Ok(())
    }
    pub fn tick(&mut self, s: &mut Session) {
        if s.trim_play.active() {
            if let Err(error) = s.execute("trim.tick", json!({"clock":self.clock()})) {
                self.note = Some(error.to_string());
                let _ = s.execute("trim.cancelDynamic", json!({}));
            }
        }
        if !self.playing {
            return;
        }
        if self.item
            != if self.source {
                s.state.source_item
            } else {
                s.state.active_sequence
            }
        {
            let _ = self.pause(s);
            return;
        }
        self.audio.recover();
        let elapsed = match if self.audio_clock {
            self.audio.played_frames()
        } else {
            None
        } {
            Some(n) => Tick::from_units(
                n.min(i64::MAX as u64) as i64,
                self.audio.sample_rate().max(1) as i64,
            ),
            None => Tick::from_seconds_f64(self.started.elapsed().as_secs_f64()),
        };
        let end = if self.source {
            s.state
                .source_item
                .and_then(|id| filmcraft_engine::clip_ops::source_view(s, id))
                .map(|v| v.end)
                .unwrap_or(Tick::ZERO)
        } else if let Some(rec) = &s.voiceover.rec {
            rec.punch_out
                .map(|t| t + Tick::from_seconds_f64(s.prefs.voice_over.postroll_seconds))
                .unwrap_or(Tick(i64::MAX))
        } else {
            s.active_sequence()
                .map(|q| q.duration())
                .unwrap_or(Tick::ZERO)
        };
        let elapsed = Tick::from_seconds_f64(elapsed.seconds() * self.speed);
        let now = self.anchor + elapsed;
        if self.source {
            s.state.source_playhead = now.clamp(Tick::ZERO, end);
        } else {
            s.set_playhead(now.clamp(Tick::ZERO, end));
        }
        if now >= end || now < Tick::ZERO {
            if self.looping && !s.voiceover.recording() && !s.mcrec.active() {
                if self.source {
                    s.state.source_playhead = Tick::ZERO;
                    let _ = self.start_source(s);
                } else {
                    s.set_playhead(Tick::ZERO);
                    let _ = self.start_speed(s, self.speed.abs());
                }
                return;
            }
            if let Err(e) = self.pause(s) {
                self.note = Some(e);
            }
            if s.voiceover.recording()
                && let Err(e) = s.execute("audio.voiceover.stop", json!({"time":s.playhead().0}))
            {
                self.note = Some(e.to_string());
            }
        }
    }
    pub fn toggle_loop(&mut self) {
        self.looping = !self.looping;
    }
    pub fn shuttle(&mut self, s: &mut Session, direction: f64, source: bool) -> Result<(), String> {
        if s.voiceover.recording() {
            return Err("Stop voice-over before changing playback speed.".into());
        }
        self.tick(s);
        let speed = if self.playing && self.source == source && self.speed.signum() == direction {
            (self.speed.abs() * 2.0).min(16.0) * direction
        } else {
            direction
        };
        if source {
            self.start_source(s)?;
            self.speed = speed;
            if speed != 1.0 {
                self.audio.stop();
                self.audio_clock = false;
            }
        } else {
            self.start_speed(s, speed)?;
        }
        Ok(())
    }
    pub fn status(&self, s: &Session) -> serde_json::Value {
        json!({"playing":self.playing || s.trim_play.active(),"speed":s.trim_play.dynamic.as_ref().map(|d|d.speed).unwrap_or(self.speed),"looping":self.looping,"target":if self.source && !s.trim_play.active(){"source"}else{"program"},"time":s.playhead().0.to_string(),"sourceTime":s.state.source_playhead.0.to_string(),"note":self.note.clone().or_else(||self.audio.note())})
    }
}
pub trait AudioOut {
    /// Start output; `fill(buffer, channels)` is called on the audio thread with interleaved f32.
    fn start(&mut self, fill: Box<dyn FnMut(&mut [f32], usize) + Send>) -> Result<u32, String>;
    fn stop(&mut self);
    /// Device sample rate.
    fn sample_rate(&self) -> u32;
    /// Device output channels (what `fill` will be called with).
    fn channels(&self) -> usize {
        2
    }
    /// Frames played since `start` (the playback master clock), if the device reports it.
    fn played_frames(&self) -> Option<u64>;
    /// Called every frame while playing, before `played_frames`: restart a stream the device
    /// dropped (a driver error, an unplugged device), keeping the clock and `fill`. A stream that
    /// cannot be restarted reports `played_frames() == None`.
    fn recover(&mut self) {}
    /// Hosts and devices that can be chosen in Settings ▸ Audio Hardware.
    fn devices(&self) -> AudioDevices {
        AudioDevices::default()
    }
    /// Apply Settings ▸ Audio Hardware (device class/output, buffer size, sample rate). Takes
    /// effect at the next `start`; `document_rate` is the sequence sample rate for "Attempt to
    /// force hardware to document sample rate".
    fn configure(
        &mut self,
        _hw: &filmcraft_engine::settings::AudioHardwarePrefs,
        _document_rate: Option<u32>,
    ) {
    }
    /// A hardware note for the status bar — e.g. the default output device could not be opened
    /// and a fallback device is in use, or no output device was found — or None.
    fn note(&self) -> Option<String> {
        None
    }
}

/// What the platform audio layer can open (Settings ▸ Audio Hardware).
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AudioDevices {
    /// Audio hosts / device classes (`CoreAudio`, `WASAPI`, `ALSA`…).
    pub hosts: Vec<String>,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    /// Output channels of the selected output device.
    pub output_channels: u16,
}

pub fn playback_mix(
    session: &Session,
    seq_id: filmcraft_project::ItemId,
    sr: u32,
) -> impl FnMut(i64, &mut [f32], usize) + Send + 'static {
    let project = session.project.clone();
    let provider = session
        .media
        .provider(project.clone(), session.services.clone());
    let previews = session.previews.clone();
    // Settings ▸ Audio Hardware ▸ Output Mapping
    let map = [
        session.prefs.audio_hardware.map_left,
        session.prefs.audio_hardware.map_right,
    ];
    // Preferences ▸ Audio ▸ 5.1 Mixdown Type: how a 5.1 Mix plays on a stereo device
    let mixdown =
        filmcraft_audio_dsp::channels::Mixdown::from_id(&session.prefs.audio.mixdown_type)
            .unwrap_or_default();
    let cues = cues(session, sr);
    previews.live.publish_project(project.clone());
    let mut resampler = None;
    move |cursor: i64, buf: &mut [f32], ch: usize| {
        // the newest project snapshot: mixer moves and other edits are heard while playing
        let project = previews
            .live
            .project()
            .filter(|p| p.sequence(seq_id).is_some())
            .unwrap_or_else(|| project.clone());
        let Some(seq) = project.sequence(seq_id) else {
            buf.fill(0.0);
            return;
        };
        let n = buf.len() / ch.max(1);
        let seq_sr = seq.settings.sample_rate;
        // a 5.1 Mix plays as six channels (L, R, C, LFE, Ls, Rs) on a device with at least six
        use filmcraft_audio_dsp::channels::Layout;
        let layout = if ch >= 6
            && seq.settings.audio_master == filmcraft_project::AudioChannels::Surround51
        {
            Layout::Surround51
        } else {
            Layout::Stereo
        };
        let mix = if seq_sr == sr {
            previews.mix_layout(&project, seq_id, cursor, n, &provider, layout, mixdown)
        } else {
            // Mix at the sequence rate as one continuous stream, interpolated to the device rate
            // (started afresh when the rate or the channel layout changes while playing).
            let key = (seq_sr, layout);
            if resampler.as_ref().is_none_or(|(k, _)| *k != key) {
                resampler = Some((
                    key,
                    filmcraft_audio_dsp::resample::StreamResampler::new(seq_sr, sr),
                ));
            }
            let Some((_, r)) = resampler.as_mut() else {
                buf.fill(0.0);
                return;
            };
            let channels = r.process(cursor, n, |s0, m| {
                previews
                    .mix_layout(&project, seq_id, s0, m, &provider, layout, mixdown)
                    .channels
            });
            filmcraft_frame::AudioBuffer {
                sample_rate: sr,
                channels,
            }
        };
        if layout == Layout::Surround51 {
            buf.fill(0.0);
            for (i, frame) in buf.chunks_mut(ch).enumerate() {
                for (c, x) in frame.iter_mut().take(6).enumerate() {
                    *x = mix.channels[c][i];
                }
            }
        } else {
            filmcraft_engine::settings::map_output(
                &mix.channels[0],
                &mix.channels[1.min(mix.channels.len() - 1)],
                buf,
                ch,
                map,
            );
        }
        mix_cues(buf, ch, cursor, &cues);
    }
}

pub fn cues(s: &filmcraft_engine::Session, sr: u32) -> (Vec<i64>, Vec<f32>) {
    match &s.voiceover.rec {
        Some(rec) if s.prefs.voice_over.countdown_sound_cues => {
            let at = filmcraft_engine::voiceover::cue_times(rec.capture_start, rec.record_start)
                .into_iter()
                .map(|t| t.to_units_floor(sr as i64))
                .collect();
            (at, filmcraft_engine::voiceover::cue_tone(sr))
        }
        _ => (Vec::new(), Vec::new()),
    }
}

/// Add the cue beeps that fall in the output block starting at device sample `cursor`.
pub fn mix_cues(buf: &mut [f32], ch: usize, cursor: i64, cues: &(Vec<i64>, Vec<f32>)) {
    let (at, tone) = cues;
    let ch = ch.max(1);
    let n = (buf.len() / ch) as i64;
    for &c in at {
        let (a, b) = (c.max(cursor), (c + tone.len() as i64).min(cursor + n));
        for i in a..b {
            let x = tone[(i - c) as usize];
            for s in &mut buf[(i - cursor) as usize * ch..(i - cursor + 1) as usize * ch] {
                *s += x;
            }
        }
    }
}

fn shuttle_mix_rate(device_rate: u32, speed: f64) -> Option<u32> {
    if device_rate == 0 || !speed.is_finite() || !(0.5..=4.0).contains(&speed) {
        return None;
    }
    let rate = (f64::from(device_rate) / speed).round();
    (1.0..=f64::from(u32::MAX))
        .contains(&rate)
        .then_some(rate as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dynamic_trim_ticks_and_stop_commits_one_undo() {
        let mut s = Session::default();
        s.execute("file.newSequence", json!({"fps":30,"video":1,"audio":1}))
            .unwrap();
        s.execute("file.newColorMatte", json!({"seconds":5}))
            .unwrap();
        let item = s.state.project_selection[0];
        s.execute(
            "timeline.place",
            json!({"item":item.0,"track":"V1","frame":0}),
        )
        .unwrap();
        let clip = s.active_sequence().unwrap().video_tracks[0].items[0].id;
        s.execute(
            "trim.selectEditPoint",
            json!({"clip":clip.0,"edge":"out","kind":"ripple"}),
        )
        .unwrap();
        let before = s.active_sequence().unwrap().duration();
        let undo = s.history.undo.len();
        let mut p = Playback::new();
        s.execute(
            "trim.shuttle",
            json!({"direction":"reverse","clock":p.clock()}),
        )
        .unwrap();
        p.epoch -= std::time::Duration::from_secs(1);
        p.tick(&mut s);
        assert!(p.status(&s)["playing"].as_bool().unwrap());
        assert!(s.active_sequence().unwrap().duration() < before);
        p.pause(&mut s).unwrap();
        assert!(!s.trim_play.active());
        assert_eq!(s.history.undo.len(), undo + 1);
        s.execute("edit.undo", json!({})).unwrap();
        assert_eq!(s.active_sequence().unwrap().duration(), before);
    }
}
