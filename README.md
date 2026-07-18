<div align="center">

# 🎙️ ASMR Recorder

**A sleek desktop application for capturing high-fidelity audio and screen recordings**

[![Tauri](https://img.shields.io/badge/Tauri-v2-FFC131?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

## ✨ Features

- 🎙️ **System + Mic Audio** — Microphone via `getUserMedia`; system / per-app audio captured natively through ScreenCaptureKit (macOS 14+)
- 🖥️ **Native Screen & Region Capture** — Full-display or cropped-region capture via ScreenCaptureKit, streamed to the UI over a Tauri Channel
- 🧩 **Multi-Section Composition** — Composite multiple screen/camera sources onto one canvas, encoded in-browser with WebCodecs (H.264)
- 🔨 **Build-Triggered Soundbites** — Mix imported clips into recordings after successful Vite HMR/full-reload events without playing them through the speakers
- ✂️ **Lossless Trim Editor** — Post-record trimming via `mediabunny` packet-copy (no re-encode)
- 🍎 **macOS 14+ first** — ScreenCaptureKit-based; non-macOS builds fall back to `cpal`/`scrap` stubs (not the supported path)

---

## 🚀 Quick Start

### Prerequisites

| Tool      | Version | Installation                                  |
| --------- | ------- | --------------------------------------------- |
| Node.js   | v18+    | [nodejs.org](https://nodejs.org/)             |
| Rust      | Latest  | [rustup.rs](https://rustup.rs/)               |
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

The companion Vite plugin and its port-5174 acceptance fixture live in
[`packages/vite-plugin-asmr-recorder`](./packages/vite-plugin-asmr-recorder).

---

## 📦 Production Build

```bash
npm run tauri build
```

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
