#!/bin/bash
# Launch the dev app. `npm run tauri dev` runs vite (beforeDevCommand) and the
# Tauri shell with DEFAULT cargo features; the npm `tauri` script injects
# DYLD_LIBRARY_PATH=/usr/lib/swift for the screencapturekit Swift bindings.
exec npm run tauri dev
