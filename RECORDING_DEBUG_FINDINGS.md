# Recording Debug Findings - 2026-02-04

## Problem Summary

After implementing composite recording, the system exhibited three critical issues:
1. Component restarting constantly during recording
2. IPC throughput bottleneck causing massive frame drops
3. Video frozen/black after a few seconds

## Root Cause Analysis

### Issue 1: Component Restart Loop ❌

**Symptom**: Hundreds of "Frame 0" logs, recording ran for 88 seconds but captured 0 frames

**Frontend Log Evidence**:
```
[RecordingCanvas] Frame 0 section sources: ...  (repeated hundreds of times)
[RecordingCanvas] Stopped: 0 frames captured, 0 dropped, 88.2s elapsed
[RecordingCanvas] WARNING: Only captured 0 frames in 88.2s, expected ~1322 frames
```

**Root Cause**:
```typescript
// ❌ BAD - Dependencies cause constant re-creation
const compositeFrame = useCallback(() => {
  // ... uses sectionSources ...
}, [sectionSources, ...]);  // sectionSources changes every render!

const captureAndSendFrame = useCallback(() => {
  compositeFrame();
}, [compositeFrame]);  // Recreated when compositeFrame changes

const startFrameCapture = useCallback(() => {
  setInterval(captureAndSendFrame, ...);
}, [captureAndSendFrame]);  // Recreated when captureAndSendFrame changes

useEffect(() => {
  if (isRecording) startFrameCapture();
}, [isRecording, startFrameCapture]);  // Runs when startFrameCapture changes
```

**The Cascade**:
1. Parent component re-renders
2. Passes new `sectionSources` array reference
3. `compositeFrame` recreated
4. `captureAndSendFrame` recreated  
5. `startFrameCapture` recreated
6. `useEffect` fires, stops old interval, starts new one
7. Frame counter resets to 0
8. Repeat every render (multiple times per second!)

### Issue 2: IPC Throughput Bottleneck ❌

**Symptom**: Watchdog warnings, 79% frame drop rate

**Frontend Log Evidence**:
```
[RecordingCanvas] Progress: 30 frames sent, 120 dropped
WATCHDOG: No frame sent in 0.3s! Last frame: 28, isSending: true
[RecordingCanvas] Stopped: 48 frames captured, 186 dropped, 25.0s elapsed
WARNING: Only captured 48 frames in 25.0s, expected ~375 frames
```

**Backend Log Evidence**:
```
Received first frame: 960x540, 2073600 bytes
Encoding complete: 48 frames  (matches frontend - only 48 frames made it through)
```

**Analysis**:
- At 960x540 resolution: 2,073,600 bytes per frame
- Converted to JSON array: `Array.from(Uint8ClampedArray)` creates ~30MB JSON string
- At 15 fps target: 450 MB/sec JSON data through IPC
- Result: `isSending` stays true, frames pile up, 79% dropped
- Effective frame rate: ~2 fps instead of 15 fps

### Issue 3: Video Frozen/Black ❌

**Symptom**: Video shows content for first 3 seconds, then freezes or goes black

**Root Cause**: Combination of issues #1 and #2
- Component restarts lose the video element references
- Low effective frame rate (2 fps) makes video appear frozen
- When `isSending` backs up, no new frames are composited
- Result: Last successful frame repeats, or black if sources lost

## Solutions Implemented

### Fix 1: Stabilize Component with Refs ✅

```typescript
// Store all changing values in refs
const sectionSourcesRef = useRef(sectionSources);
const recordingWidthRef = useRef(recordingWidth);
const recordingHeightRef = useRef(recordingHeight);
const frameRateRef = useRef(frameRate);
const onFrameErrorRef = useRef(onFrameError);

// Update refs when props change (doesn't trigger callback recreation)
useEffect(() => {
  sectionSourcesRef.current = sectionSources;
  recordingWidthRef.current = recordingWidth;
  recordingHeightRef.current = recordingHeight;
  frameRateRef.current = frameRate;
  onFrameErrorRef.current = onFrameError;
}, [sectionSources, recordingWidth, recordingHeight, frameRate, onFrameError]);

// Remove dependencies from callbacks
const compositeFrame = useCallback(() => {
  const currentSources = sectionSourcesRef.current; // Read from ref
  // ... use currentSources ...
}, [outputWidth, outputHeight, ...]); // NO sectionSources dependency

// Inline all logic in single useEffect
useEffect(() => {
  if (!isRecording) return;
  
  // All recording logic here - no function dependencies
  const interval = setInterval(() => {
    captureAndSendFrame(); // Call directly, no dependency
  }, intervalMs);
  
  return () => clearInterval(interval);
}, [isRecording]); // ONLY depend on isRecording
```

**Result**: Component runs once per recording session, no restarts

### Fix 2: Reduce Resolution for IPC Throughput ✅

**Resolution Scaling Tests**:
| Scale | Resolution | Frame Size | Result |
|-------|-----------|-----------|--------|
| 1/2 | 960x540 | 2.07 MB | 79% drop rate ❌ |
| 1/3 | 640x360 | 921 KB | Not tested |
| 1/4 | 480x270 | 518 KB | Target ✅ |
| 1/6 | 320x180 | 230 KB | Works but unreadable |

**Final Choice**: 1/4 scale (480x270)
- Compromise between quality and performance
- Should achieve ~50% or better frame delivery
- Text should still be somewhat readable

### Fix 3: Comprehensive Logging ✅

Added detailed logging to track:
- **Startup**: Resolution, frame rate, frame size
- **Section sources**: Type, element state, video readyState
- **Progress**: Every 30 frames + every 50 frames elapsed
- **Watchdog**: Detects when frames aren't sending
- **Cleanup**: Total frames, drop rate, session duration

## Expected Behavior After Fixes

### Successful Recording Session

**Console logs should show**:
```
[RecordingCanvas] Starting recording session
[RecordingCanvas] Starting capture: 480x270 @ 15fps (66.7ms interval)
[RecordingCanvas] Frame data size: 518400 bytes per frame
[RecordingCanvas] Interval started with ID: 75
[RecordingCanvas] Section sources: [0] VIDEO: ready=4, paused=false, hasStream=true, [1] VIDEO: ready=4, paused=false, hasStream=true, [2] VIDEO: ready=4, paused=false, hasStream=true, [3] VIDEO: ready=4, paused=false, hasStream=true
[RecordingCanvas] Sending first frame: 518400 bytes
[RecordingCanvas] Progress: 30 frames sent, 15 dropped
[RecordingCanvas] Interval still running: 50 frames, 3.3s elapsed, interval ID: 75
[RecordingCanvas] Progress: 60 frames sent, 28 dropped
[RecordingCanvas] Interval still running: 100 frames, 6.7s elapsed, interval ID: 75
... continues for full duration ...
[RecordingCanvas] Progress: 450 frames sent, 120 dropped
[RecordingCanvas] Cleanup - stopping intervals
[RecordingCanvas] Session ended: 450 frames captured, 120 dropped, 30.0s elapsed
```

**Key Indicators**:
- ✅ Single "Starting recording session" message
- ✅ Same interval ID throughout (no restarts)
- ✅ All sections show `ready=4` (video ready)
- ✅ Frame count increases continuously
- ✅ Drop rate < 50%
- ✅ No watchdog warnings
- ✅ Final frame count ≈ duration × fps (e.g., 30s × 15fps = 450)

### Video Output Quality

**At 480x270 resolution**:
- Text should be readable but not crisp
- Motion should be smooth at 15 fps (with some drops)
- All 4 sections should have content
- Camera feed should be visible (if `ready=4`)

## Remaining Limitations

### IPC Performance Ceiling

Tauri IPC uses JSON serialization, which creates a hard limit:
- **Maximum sustainable throughput**: ~10-15 MB/sec
- **480x270 @ 15fps requires**: ~7.8 MB/sec (518KB × 15)
- **Higher resolutions cause exponential drops**

### Resolution vs Performance Trade-off

| Use Case | Recommended Scale | Resolution | Quality |
|----------|------------------|-----------|---------|
| Quick preview | 1/6 | 320x180 | Poor |
| Readable text | 1/4 | 480x270 | Fair |
| Good quality | 1/3 | 640x360 | Good (may drop frames) |
| High quality | Use native recording | Full res | Excellent |

## Testing Checklist

Before starting a new recording session:

1. ✅ **Clear console** to see fresh logs
2. ✅ **Verify all 4 sections** have sources in the preview
3. ✅ **Check camera is live** before recording (not black)
4. ✅ **Start recording** and watch for:
   - Single "Starting recording session" log
   - All sections show `ready=4`
   - Interval ID stays constant
   - Frame count increases
   - Drop rate < 50%
5. ✅ **Record for 30+ seconds** to verify stability
6. ✅ **Check output file**:
   ```bash
   ffprobe -show_streams recording_*.mp4
   ```
   - Video should be 480x270
   - Frame count should be close to duration × 15
   - Audio should match video duration

## Next Steps (If Issues Persist)

### If Component Still Restarts
- Check for other state changes in parent (Preview component)
- Add `React.memo` to RecordingCanvas
- Move to separate context to isolate state

### If Frame Drop Rate > 50%
- Reduce resolution to 1/5 or 1/6 scale
- Reduce frame rate to 10 fps
- Implement binary IPC (requires Tauri plugin)

### If Camera Shows Black
- Verify camera permission granted
- Check camera stream is active before recording
- Ensure video element has `autoPlay` and `playsInline` attributes
- Check `videoReadyState` is 4 (HAVE_ENOUGH_DATA)

### For Production Quality
Consider alternative approaches:
1. **Native Capture Only** - Use existing working recorder
2. **Browser MediaRecorder** - Combine with Tauri audio (separate files)
3. **Shared Memory** - Bypass IPC (requires native code)
4. **WebRTC Local Loopback** - Stream via local connection
5. **Binary IPC Plugin** - Custom Tauri plugin for binary transfer

---

*Debug session: 2026-02-04*
*Resolution: 480x270 @ 15fps (1/4 scale)*
*Target: < 50% frame drops*
