# Recording Implementation Status

## Overview

The ASMR Recorder now supports two recording modes:

1. **Native Recording** - Single screen or webcam capture with PiP overlay
2. **Composite Recording** - Multi-section 4-grid layout (experimental)

## Native Recording

**Status**: ✅ Fully functional

- Uses Tauri's native capture APIs (ScreenCaptureKit on macOS)
- Supports screen + webcam Picture-in-Picture
- High quality encoding (H.264 + AAC)
- Real-time performance
- Output: MP4 files

**Usage**: Use the Settings dialog to configure screen/webcam sources.

## Composite Recording (4-Section Grid)

**Status**: ⚠️ Experimental - Performance Limited

### Architecture

The composite recording system allows recording a 4-section grid where each section can contain:
- Full screen capture
- Cropped screen region
- Camera feed

**How it works**:
1. Frontend composites all 4 sections into a canvas
2. Canvas frames are captured and sent to Tauri via IPC
3. Tauri encodes frames with FFmpeg while capturing audio natively

### Known Limitations

#### Performance Bottleneck

Tauri's IPC uses JSON serialization, which creates a bottleneck for real-time video data transfer:

- At 1080p: ~8MB per frame = ~240MB/sec at 30fps
- JSON conversion of pixel arrays is CPU-intensive
- Causes UI freezing and frame drops

**Current Workarounds**:
- Reduced resolution (1/6 scale = ~320x180)
- Reduced frame rate (15fps default)
- Frame dropping when IPC is busy
- Non-blocking frame sends

#### Output Quality

Due to the performance limitations:
- Output resolution is significantly lower than display resolution
- Frame rate is limited
- May have frame drops during recording

### Recommendations

**For High Quality Recording**: Use **Native Recording** mode
- Better performance
- Higher resolution
- Smoother frame rate
- More reliable

**For Multi-Source Recording**: Use **Composite Recording**
- Accept lower quality trade-off
- Use lower resolution settings (720p or less)
- Keep frame rate at 15fps or lower
- Minimize other CPU-intensive tasks during recording

## Future Improvements

Potential solutions to improve composite recording performance:

1. **Binary IPC Transfer**: Implement custom binary protocol instead of JSON
2. **Shared Memory**: Use shared memory for frame data transfer
3. **Web Workers**: Off-load frame processing to worker threads
4. **WebCodecs API**: Use browser's native encoding capabilities
5. **Alternative Architecture**: Stream via local WebRTC or WebSocket

## Testing

Current test results location: `test-results/`

To test composite recording:
1. Add sources to the 4-section preview
2. Adjust settings for low resolution (720p or lower)
3. Set frame rate to 15fps
4. Click Record
5. Keep recording duration short (< 30 seconds recommended)

## Technical Details

### Frame Data Flow

```
[Section Sources] → [Composite Canvas] → [Scale Down] → [ImageData]
     ↓
[Array.from()] → [JSON] → [Tauri IPC] → [Vec<u8>]
     ↓
[CompositeFrame] → [FFmpeg Encoder] → [MP4]
```

### Bottleneck Analysis

The primary bottleneck is the `Array.from(imageData.data)` conversion which:
- Converts Uint8ClampedArray to regular Array
- Each byte becomes a JSON number
- 8MB becomes ~30-40MB JSON string
- Blocks main thread during conversion

### Code Locations

- Frontend canvas compositing: `frontend/src/components/asmr-recorder/recording-canvas.tsx`
- Backend frame receiver: `src-tauri/src/external_recorder.rs`
- Recording context: `frontend/src/contexts/recording-context.tsx`
- Tauri commands: `src-tauri/src/lib.rs`

## Conclusion

The composite recording feature is functional but limited by IPC performance constraints. It's suitable for low-resolution preview recordings but not recommended for production-quality output. Use native recording mode for high-quality results.
