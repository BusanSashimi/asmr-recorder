# Architecture

ASMR Recorder is a [Tauri 2](https://tauri.app/) desktop app: a **React 19 + WebCodecs**
frontend (`frontend/`) and a **Rust** backend (`src-tauri/`). It targets **macOS 14+**.

There is exactly **one** recording path: the frontend WebCodecs pipeline. The legacy native
Rust recording pipeline was deleted — see
[ai-dev/doc/legacy-native-pipeline-removal.md](ai-dev/doc/legacy-native-pipeline-removal.md).

## Recording data flow (the live path)

1. **Sources** — native screen, cropped region, and/or camera — are composited onto a `<canvas>`
   in `frontend/src/components/asmr-recorder/recording-canvas.tsx`.
2. **Encode** — canvas frames are encoded in-browser by the WebCodecs `VideoEncoder` (H.264);
   mic/system audio is encoded by `AudioEncoder` (AAC). Frames are encoded at full resolution
   (no downscaling), in `recording-canvas.tsx`.
3. **Mux** — encoded packets are muxed to MP4 with **`mediabunny`** (`Output` +
   `Mp4OutputFormat` + `EncodedVideo/AudioPacketSource`). mediabunny is the project's single
   muxer for both recording and trimming — the previously-used `mp4-muxer` was migrated off and
   removed (see [ai-dev/doc/mp4-muxer-to-mediabunny-migration.md](ai-dev/doc/mp4-muxer-to-mediabunny-migration.md)).
4. **Save** — the finished MP4 `ArrayBuffer` is sent to Rust's `save_media_recording` over a
   **raw-byte** Tauri IPC (`src-tauri/src/lib.rs:15-20`, `InvokeBody::Raw`) and written to disk.
   No base64, so there is no string-length size cap on long recordings.

If WebCodecs is unavailable the canvas falls back to `MediaRecorder` (WebM); the same raw-byte
save command handles both.

### The WKWebView AAC quirk

WKWebView's `AudioEncoder` emits `decoderConfig.description` as a full MPEG-4 ES_Descriptor, but
the muxer wraps `description` in its own DecoderSpecificInfo (esds). Handing it the ES_Descriptor
double-wraps it and the audio track becomes undecodable, so `extractAudioSpecificConfig`
(`recording-canvas.tsx`) strips it down to the bare AudioSpecificConfig first. This applies to
mediabunny exactly as it did to mp4-muxer.

## Capture (Rust / ScreenCaptureKit)

`getUserMedia` (mic) works in WKWebView, but `getDisplayMedia` (screen **and** system audio) is
blocked — so screen and system audio are captured natively via ScreenCaptureKit and streamed to
the frontend over Tauri `Channel`s.

| Module (`src-tauri/src/`) | Responsibility |
| ------------------------- | -------------- |
| `screen_stream.rs`        | SCK screen frames → JPEG → frontend over a `Channel` (with ack backpressure) |
| `system_audio_stream.rs`  | SCK system / per-app audio → interleaved PCM over a `Channel` |
| `screen.rs` / `system_audio.rs` | Capture config + cfg-gated platform selection (macOS → `screencapturekit`; non-macOS → `cpal`/`scrap` fallback stubs) |
| `recording.rs`            | Device / running-app enumeration (`list_audio_apps`) |
| `lib.rs`                  | Plugin + command wiring and the `save_media_recording` save command |
| `main.rs`                 | 4-line shim → `asmr_recorder_lib::run()` |

ScreenCaptureKit uses Swift interop, so the binary must be launched with
`DYLD_LIBRARY_PATH=/usr/lib/swift` (injected by the `npm run tauri` script and `dev.sh`).

## Trim editor

`frontend/src/components/asmr-recorder/trim-editor.tsx` does a **lossless transmux** with
`mediabunny` (dynamic import): it packet-copies encoded video/audio, snapping the cut-in to the
preceding keyframe, with an opt-in frame-accurate mode that re-encodes only the leading partial
GOP. Export reuses the same raw-byte `save_media_recording` IPC. See
[ai-dev/doc/trim-editor-v2-multisegment.md](ai-dev/doc/trim-editor-v2-multisegment.md).

## Distribution

Code-signed + notarized macOS builds with in-app auto-update via `tauri-plugin-updater` against
a GitHub-releases `latest.json`. See
[ai-dev/doc/packaging-and-distribution.md](ai-dev/doc/packaging-and-distribution.md) and
[ai-dev/doc/auto-update.md](ai-dev/doc/auto-update.md).

## Deeper topic docs

Detailed, code-grounded design notes live in [`ai-dev/doc/`](ai-dev/doc/):

- [legacy-native-pipeline-removal.md](ai-dev/doc/legacy-native-pipeline-removal.md) — what the single recording path replaced
- [native-screen-transport-raw-bytes.md](ai-dev/doc/native-screen-transport-raw-bytes.md) — the screen `Channel` + ack backpressure
- [native-system-audio-capture.md](ai-dev/doc/native-system-audio-capture.md) — SCK system-audio capture
- [composition-layouts.md](ai-dev/doc/composition-layouts.md) — the layout registry (Solo / PiP / Side-by-Side / 2×2)
- [next-implementations.md](ai-dev/doc/next-implementations.md) — the running roadmap / backlog
