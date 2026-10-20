<div align="center">

# 🎙️ ASMR Recorder

**A macOS desktop application for recording and editing audio and video**

[![Tauri](https://img.shields.io/badge/Tauri-v2-FFC131?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

## ✨ Features

- 🎙️ **System + Mic Audio** — Microphone via `getUserMedia`; system / per-app audio captured natively through ScreenCaptureKit (macOS 14+)
- 🖥️ **Native Screen & Region Capture** — ScreenCaptureKit crops and scales to the recording layout before copying frames; a latest-frame buffer keeps memory and latency bounded
- 🖼️ **Screen Preview Gallery** — Choose a display from still thumbnails, refresh on demand, and position the crop over a larger preview
- 🧩 **Multi-Section Composition** — Composite multiple screen/camera sources onto one canvas, encoded in-browser with WebCodecs (H.264)
- 🎬 **Recording & Editing Modes** — Saved takes open in a native FilmCraft-powered editor with a multitrack timeline, effects, keyframes, masks, graphics, captions, mixing, multicam and export
- 🗂️ **Editing Workspaces** — Dockable Apple-styled panels, native `.fcproj` projects, autosave/recovery, proxies and interchange
- ✂️ **Lossless Trim Editor** — Post-record trimming via `mediabunny` packet-copy (no re-encode)
- 🍎 **macOS 14+ first** — ScreenCaptureKit-based; non-macOS builds fall back to `cpal`/`scrap` stubs (not the supported path)

---

See [the migration coverage and validation notes](docs/filmcraft-migration.md) for the implemented interfaces, tested workflows and remaining limitations.

## 🚀 Quick Start

### Prerequisites

| Tool      | Version | Installation                                  |
| --------- | ------- | --------------------------------------------- |
| Node.js   | v18+    | [nodejs.org](https://nodejs.org/)             |
| Rust      | 1.95.0 (pinned) | [rustup.rs](https://rustup.rs/)               |
| Tauri CLI | v2      | `npm install -g @tauri-apps/cli` _(optional)_ |

### System Dependencies

<details>
<summary>🍎 <strong>macOS</strong></summary>

```bash
xcode-select --install
```

Requires **macOS 14+** and a Swift toolchain (ships with Xcode / Command Line Tools).
ScreenCaptureKit uses Swift interop, so the dynamic linker must see the Swift runtime
(`DYLD_LIBRARY_PATH=/usr/lib/swift`). The `npm run tauri` script (and `dev.sh`) inject this
automatically — always launch via `npm run tauri dev` / `npm run tauri build` (or `./dev.sh`),
never a bare `tauri`, or the `screencapturekit` bindings fail to load.

For screen/audio permission testing, run the packaged `.app` from a certificate-signed debug build:

```bash
npm run tauri -- build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

The launcher automatically selects the single valid **Apple Development** certificate in Keychain, or uses `APPLE_SIGNING_IDENTITY` when explicitly set. It stops debug bundle builds if a certificate is unavailable instead of generating another ad-hoc identity. Set up the free development certificate through Xcode's signed-in Personal Team/automatic signing first. Certificates and private keys stay in Keychain, outside the repository.

macOS ties screen/audio grants to a code-signing requirement. Ad-hoc builds change that requirement when their executable changes, even if the permission switch stays on. After moving to certificate signing, renew the existing grant once and keep launching the same app bundle. Plain `tauri dev` runs a separate development executable and is not the packaged capture-permission test path. See [Apple's explanation](https://developer.apple.com/forums/thread/819406) and [Tauri signing setup](https://v2.tauri.app/distribute/sign/macos/).

</details>

<details>
<summary>🪟 <strong>Windows</strong></summary>

Install [C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

</details>

<details>
<summary>🐧 <strong>Linux</strong></summary>

```bash
sudo apt install libwebkit2gtk-4.0-dev build-essential libssl-dev \
    libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

</details>

---

## 📥 Installation

```bash
# Clone the repository
git clone https://github.com/BusanSashimi/asmr-recorder.git
cd asmr-recorder

# Install frontend dependencies
cd frontend && npm install && cd ..

# Install root dependencies
npm install
```

---

## 🛠️ Development

Start the app in development mode:

```bash
npm run tauri dev
```

This command will:

1. 🌐 Start the Vite dev server for the frontend
2. 🦀 Compile the Rust backend
3. 🖼️ Launch the Tauri application window

---

## 📦 Production Build

```bash
npm run tauri build
```

Profile capture using a certificate-signed **release** `.app`; debug builds leave Rust image processing unoptimized. Native source resolution follows the selected output layout, including full-detail Solo/PiP backgrounds. Sources outside the layout pause until needed again.

Web Inspector is enabled in local release builds through Tauri's `devtools` feature. On macOS, press **⌘ Option I** or right-click and choose **Inspect Element**.

On macOS 27 with the pinned Rust 1.95 toolchain, set `CARGO_PROFILE_RELEASE_STRIP=none` and `CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=none` for local release builds. This avoids an upstream Mach-O stripping problem that prevents compiler plugins from loading; optimization remains enabled. See the [Rust compiler issue](https://github.com/rust-lang/rust/issues/157750). Use the existing certificate through `APPLE_SIGNING_IDENTITY` for local signing.

---

## 🏗️ Tech Stack

> 📐 See [ARCHITECTURE.md](./ARCHITECTURE.md) for the live recording → capture → save data flow.

<table>
<tr>
<td align="center" width="150">
<img src="https://tauri.app/meta/tauri_logo_dark.svg" width="50" alt="Tauri"/><br/>
<strong>Tauri v2</strong><br/>
<sub>App Framework</sub>
</td>
<td align="center" width="150">
<img src="https://www.rust-lang.org/logos/rust-logo-512x512.png" width="50" alt="Rust"/><br/>
<strong>Rust</strong><br/>
<sub>Backend Logic</sub>
</td>
<td align="center" width="150">
<img src="https://upload.wikimedia.org/wikipedia/commons/a/a7/React-icon.svg" width="50" alt="React"/><br/>
<strong>React</strong><br/>
<sub>Frontend UI</sub>
</td>
<td align="center" width="150">
<img src="https://vitejs.dev/logo.svg" width="50" alt="Vite"/><br/>
<strong>Vite</strong><br/>
<sub>Build Tool</sub>
</td>
</tr>
</table>

### 📚 Key Libraries

| Library                    | Where    | Purpose                                                      |
| -------------------------- | -------- | ------------------------------------------------------------ |
| `screencapturekit`         | Rust     | Native screen + system-audio capture (macOS 14+)             |
| WebCodecs (`VideoEncoder`) | Frontend | In-browser H.264 encode of the composite canvas              |
| `mediabunny`               | Frontend | Muxes the WebCodecs recording to MP4 + the lossless trim editor |
| `tauri-plugin-updater`     | Rust     | In-app auto-update via GitHub releases                       |
| `cpal` / `scrap`           | Rust     | Non-macOS fallback stubs only (cfg-gated; not the live path) |

---

## 📝 Commands Reference

| Command               | Description                      |
| --------------------- | -------------------------------- |
| `npm run tauri dev`   | 🔧 Start development environment |
| `npm run tauri build` | 📦 Build production application  |

---

<div align="center">

**Built with ❤️ using Tauri, Rust, and React**

</div>
