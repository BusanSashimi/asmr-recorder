# ASMR Recorder

A desktop application for recording high-fidelity audio and screen input, built with Tauri v2, Rust, and React.

## Project Setup

### Prerequisites

- **Node.js** (v18+)
- **Rust** (Install via [rustup](https://rustup.rs/))
- **Tauri CLI**: `npm install -g @tauri-apps/cli` (optional, included in package.json)

### System Dependencies

- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Windows**: C++ Build Tools
- **Linux**: `libwebkit2gtk-4.0-dev`, `build-essential`, `libssl-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`

## Installation

1.  Clone the repository.
2.  Install frontend dependencies:
    ```bash
    cd frontend
    npm install
    ```
3.  Install root dependencies:
    ```bash
    # from project root
    npm install
    ```

## Running in Development

To start the app in development mode:

```bash
npm run tauri dev
```

This command will:
1.  Start the Vite dev server for the frontend.
2.  Compile the Rust backend.
3.  Launch the Tauri application window.

## Building for Production

```bash
npm run tauri build
```

## Tech Stack

- **Tauri v2**: Application framework.
- **Rust**: Backend logic.
    - `cpal`: Audio capture.
    - `scrap`: Screen capture.
    - `ffmpeg-next`: Media processing (planned).
- **React + TypeScript**: Frontend UI.
- **Vite**: Frontend build tool.

## Key Commands

- `npm run tauri dev`: Start dev environment.
- `npm run tauri build`: Build production app.
