#!/bin/bash
# Development script that properly sets DYLD_LIBRARY_PATH for Swift libraries
# This is needed because the screencapturekit crate uses Swift bindings

export DYLD_LIBRARY_PATH="/usr/lib/swift:$DYLD_LIBRARY_PATH"
export PATH="$HOME/.cargo/bin:$PATH"

# Start the frontend dev server in background
cd frontend && npm run dev &
VITE_PID=$!

# Wait for Vite to be ready
sleep 2

# Run the Tauri app
cd ../src-tauri && cargo run --no-default-features --features ffmpeg

# Cleanup
kill $VITE_PID 2>/dev/null
