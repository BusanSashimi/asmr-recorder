# FilmCraft editing integration

Implemented against FilmCraft **0.8.0**, revision `8309f21a6c3f34ddf190af7fd9bfd913053a1fd5`. The headless engine is a pinned Cargo dependency; its egui application and branding are not bundled. Source and web research: [filmcraft-research.md](filmcraft-research.md). Runtime inventory: [filmcraft-catalog.json](filmcraft-catalog.json), **701 commands and 303 effect definitions**. Those counts describe available engine APIs, not 1,004 independently verified user workflows.

## Mode ownership

| Recording Mode | Editing Mode |
| --- | --- |
| Screen/region/camera sources and composite layout | Project/media bins, source and program monitors |
| Microphone, system/per-app audio and live meters | Timeline audio, mixer, effects, automation and voice-over |
| Capture settings, destination, record and stop | Assembly, trimming, multicam, graphics, captions, color and masks |
| Finalize and durably save the original take | Projects, recovery, proxies, speech, interchange and export |

A saved take automatically opens a matching sequence with one linked video/audio pair in Editing Mode. Existing sequences remain in the project. Recordings remain composite video with mixed audio; editing does not manufacture separate camera or audio stems. Recording source configuration stays mounted across mode switches; native capture/monitoring is suspended while editing. Mode changes are locked during recording, finalization and timeline voice-over. Quick Trim retains the original packet-copy workflow.

## Editing surfaces

| Family | Dedicated interface | Additional operations |
| --- | --- | --- |
| Project/media | Open/save, import, bins, move media, search, media selection, source audition, recovery | All Actions: metadata, interpretation, relink, search bins, project manager, templates, collection |
| Timeline | Multiple tracks, linked selection, snapping, drag move/copy/insert, edge trimming, razor, delete, track output/lock, zoom, waveforms, thumbnails, captions and markers | All Actions: targeting/patching, groups, nests, replace, time remapping, scene detection, split edits and track configuration |
| Trimming | Regular/ripple/roll/slip/slide/rate tools, frame nudges, two-sided Trim monitor, dynamic J/K/L and loop around edit | All Actions: edit-point navigation, extend and trim preferences |
| Playback | Source/program transport, frame stepping, scrub, In/Out, insert/overwrite, J/K/L shuttle, looping and comparison reference | Native audio clock and buffered background mixing; forward program shuttle 0.5–4× supports pitch correction |
| Effects/transitions | Searchable complete effect catalog, effect stack, parameter controls, transition duration/alignment/parameters | All Actions: presets, stack operations, transition policies |
| Animation | Keyframe toggles, values, timing, interpolation and influence; draggable scalar graph with evaluated curve | Source-time keyframe coordinates; point, path and color parameters have typed controls |
| Masks | Shapes, polygon vertices, source overlay drag/nudge, Bézier handles, feather/invert/expansion, tracking | All Actions: additional mask and tracking options |
| Color/scopes | Color effect controls, histogram, waveform, RGB parade, YUV/HLS sample plots | All Actions: color management and sequence color settings |
| Graphics/text | Text/shape layers, ordering, selection and parameter inspector; title and caption editing | All Actions: layout, animation, templates, caption styling/import/export |
| Audio | Native playback, mixer meters/faders/pan/mute/solo/arm, insert parameters, routing, automation modes | All Actions: sends, submixes, essential sound, music remix and channel configuration |
| Multicam | Angle preview grid, switch/cut, record cuts, audio follows, sequence creation/sync | All Actions: angle and sync options |
| Speech | Model/voice catalog and download, transcription, word selection/seek/lift/extract/captions, generated narration, native voice-over | Models are optional local downloads; no hosted AI service or API key required |
| Proxies/jobs | Create/attach/detach/toggle proxies, job progress and cancellation | Native engine jobs and persistence pump |
| Delivery | Format availability, range, dimensions, bitrate, caption burn-in, export queue and retry | Presets and advanced export; EDL, FCP7 XML, FCPXML, OTIO, AAF and OMF interchange |

**All Actions** uses the live registry's availability checks and labeled parameter forms. It supplements the dedicated panels. Advanced operations use the engine's parameter-description DSL; uncommon schema variants still need acceptance coverage. FilmCraft's own limitations remain: no Premiere `.prproj` or `.mogrt` import, no general plugin host, approximate 2D stabilization, and some persisted document settings without render behavior. See the research inventory before promising compatibility.

## Design and implementation

- Existing [Apple-aligned design system](design-system.md): SF system font, semantic light/dark surfaces, blue selection, red recording/destructive states, 28 px controls, visible focus and restrained separators. Media remains on a dark stage. Editing panels use Dockview with Assembly, Editing, Color, Effects and Audio presets, persisted layouts, floating groups and keyboard-accessible panel arrangement. The 800×600 layout uses tabs instead of forcing all panels side by side.
- `Editor` owns one native `Session` on a bounded worker queue. Mutations are serialized, revision checked and undoable. Autosave/recovery and asynchronous jobs are pumped on that worker. Playback and dynamic trim use native clocks. Long CPU preview/waveform work uses separate bounded background workers.
- IPC carries IDs and 254,016,000,000-Hz ticks as decimal strings. Explicit `$integer` input envelopes preserve exact Rust integers without converting numeric-looking names or paths. Native frame delivery uses binary RGBA, not JSON pixel arrays.
- Capture uses raw-byte IPC and unique `.partial` files, syncs before rename, retains failed-save buffers for retry and imports only after successful save. Initialization and stop share ownership of encoder/audio resources. Video timestamps use the audio rendering clock when sound is enabled; video-only captures use elapsed wall time. The audio worklet preserves silent quanta and original context times. Frames with repeated or regressing clock timestamps are dropped, preserving strictly increasing video packet times. Debug builds save numeric timing diagnostics alongside test recordings.
- Save/recovery/close flows guard unsaved projects, pending capture saves, voice-over and active jobs. FilmCraft and bundled font license notices ship under `licenses/filmcraft`.

## Validation and limits

**Latest automated result:** 66 frontend tests and 22 Rust tests pass, along with the frontend production build, debug macOS application bundle, scoped editor/capture lint and synthetic native smoke example. Whole-repository lint still reports 12 pre-existing errors and 4 warnings in recording preview/context, hooks and configuration; the scoped editor/capture checks are clean.

Automated coverage includes exact time/drop-frame formatting, command form parsing and typed values, keyframe interpolation, mask/caption/mixer payloads, trim undo, project serialization, dynamic trim commit/undo, audio conversion/device recovery, shuttle pitch/latency and existing recording tests. A synthetic native smoke example renders titles/captions/mattes, exports H.264, reopens `.fcproj`, reimports the media and checks source marks.

Manual macOS testing confirmed permission-aware screen capture, automatic saved-take handoff, linked A/V timeline, project save/reopen, and a full native H.264/AAC export. The first 2560×1440, 13.4-second debug export completed in 268.9 seconds (~1.51 fps). This is a correctness check, **not a release performance benchmark**.

The native Quit menu now routes through the document guard; Save and Close and subsequent `.fcproj` reopen were verified. The final native Trim monitor check retained its controls after edit-point selection, dynamically ripple-trimmed linked A/V from 15.35 to 3.27 seconds, and restored both to 15.35 seconds with one Undo. The test project was saved after restoration.

**Capture timing acceptance passed on 2026-10-16:** a fresh native 2560×1440 H.264 recording with stereo 48 kHz AAC was saved and automatically opened as linked A/V in Editing Mode. The final fixture is `test-results/recording_20261016_124414_450521000.mp4`; its project was saved through the native dialog as `verified-capture-final.fcproj` in the temporary `asmr-editor-smoke` directory. The independent check reports audio starting **18.667 ms** after video and ending **67.993 ms** after it, within the 150 ms tolerance. Both streams have strictly increasing packet DTS, and FFmpeg decodes both without errors.

Initial captures exposed audio ending 1.3–1.5 seconds before video because WebKit's audio rendering clock could pause while wall time continued. Video now follows that audio clock. The resumed acceptance check also caught duplicate video timestamps during clock pauses; capture now drops those frames until the clock advances. A regression test reproduces the observed repeated/regressing clock values. Capture performance and perceptual lip sync under sustained load remain separate acceptance work.

The permission blocker was a stale code-signing requirement in macOS TCC: its log explicitly showed the current executable hash failing to match the stored grant. Resetting **only** `ScreenCapture` for `com.asmrrecorder.app`, restoring its existing grant through System Settings with user authentication, and choosing Quit & Reopen resolved it. Ad-hoc debug rebuilds change the hash, so a future rebuild may need the same permission refresh. The final tested app remains built and permission-enabled.

```sh
python3 scripts/check-recording-timing.py path/to/new-recording.mp4
```

The check compares audio/video track boundaries within 150 ms and verifies strictly increasing packet decoding timestamps. It does not certify perceptual lip sync. AudioWorklet timing semantics were checked against [MDN’s currentTime documentation](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope/currentTime).

Remaining acceptance/performance work:

- Preview currently uses the CPU renderer with bounded requests and small thumbnail caches. FilmCraft's GPU presentation and complete frame-cache/prefetch/preroll pipeline are not ported. High-resolution or expensive effects may play with dropped preview frames; audio retains the native clock.
- Dynamic trim loop preview is visual; dedicated loop audio audition is not wired. Reverse/extreme program shuttle and non-1× source shuttle are silent. Forward program shuttle uses the migrated pitch-corrected mixer.
- Speech/model download commands can occupy the session worker until the upstream synchronous operation finishes. Model downloads, every voice/language and transcription accuracy have not been exercised in this checkout.
- Every effect, interchange format, codec, proxy variant, mask tracker, multicam sync path and advanced command has not been independently tested. Runtime availability comes from the pinned engine. This integration is not a certification of complete upstream UI or format parity.
- Native QA was on macOS. Windows/Linux capture remains outside this application's supported path. Notarization and updater signing require the existing release credentials; local debug validation disables updater artifact signing only through a temporary build override.

Useful commands (from repository root):

```sh
npm --prefix frontend test
npm --prefix frontend run build
DYLD_LIBRARY_PATH=/usr/lib/swift cargo test --manifest-path src-tauri/Cargo.toml
DYLD_LIBRARY_PATH=/usr/lib/swift cargo run --manifest-path src-tauri/Cargo.toml --example editor_smoke
DYLD_LIBRARY_PATH=/usr/lib/swift cargo run --manifest-path src-tauri/Cargo.toml --example editor_catalog
npm run tauri build
```

Rust is pinned to 1.95.0 in `rust-toolchain.toml`; Cargo.lock pins the complete native dependency graph. The catalog example writes JSON to stdout. The smoke example creates fixtures beneath the system temporary directory, in `asmr-editor-smoke`.
