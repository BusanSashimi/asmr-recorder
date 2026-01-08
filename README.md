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

- 🎤 **High-Fidelity Audio Recording** — Crystal-clear audio capture powered by `cpal`
- 🖥️ **Screen Capture** — Seamless screen recording with `scrap`
- ⚡ **Lightning Fast** — Native performance with Rust backend
- 🎨 **Modern UI** — Beautiful React + TypeScript interface
- 📦 **Cross-Platform** — Works on macOS, Windows, and Linux

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
git clone https://github.com/yourusername/asmr-recorder.git
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

---

## 🏗️ Tech Stack

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

| Library                                                 | Purpose                      |
| ------------------------------------------------------- | ---------------------------- |
| [`cpal`](https://github.com/RustAudio/cpal)             | Cross-platform audio I/O     |
| [`scrap`](https://github.com/nickkuk/scrap)             | Screen capture               |
| [`ffmpeg-next`](https://github.com/zmwangx/rust-ffmpeg) | Media processing _(planned)_ |

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
