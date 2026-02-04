# Debugging Guide for Composite Recording

## Current Issues Being Investigated

1. **Low Resolution**: Characters unreadable in the 3 monitor sections
2. **Black Camera Section**: 4th section (camera) shows black screen
3. **Recording Stops Early**: Video data stops after ~15 seconds but audio continues

## Changes Made

### Resolution Improvements
- **Increased recording scale from 1/6 to 1/2**
  - Old: 320x180 (~230KB per frame)
  - New: 960x540 (~2MB per frame)
- Text should now be readable in recorded output

### Comprehensive Logging Added

The following log messages will now appear in the console:

#### Startup Logs
```
[RecordingCanvas] Starting capture: 960x540 @ 15fps (66.7ms interval)
[RecordingCanvas] Frame data size: 2073600 bytes per frame
[RecordingCanvas] Interval started with ID: <number>
```

#### First 3 Frames
```
[RecordingCanvas] Frame 0 section sources: [detailed section info]
- Shows each section's type, element, readyState, etc.
```

#### During Recording (every 50 frames)
```
[RecordingCanvas] Interval still running: 50 frames, 3.3s elapsed, interval ID: <number>
```

#### Progress Updates (every 30 frames)
```
[RecordingCanvas] Progress: 30 frames sent, 5 dropped
```

#### Video Issues (first 5 frames + every 50 frames)
```
[RecordingCanvas] Video not ready at frame X: readyState=1, paused=false, ended=false, srcObject=true
```

#### On Stop
```
[RecordingCanvas] Stopping interval <number>
[RecordingCanvas] Stopped: 228 frames captured, 15 dropped, 15.2s elapsed
```

## Testing Instructions

### Step 1: Start Recording with Dev Tools Open
1. Open Chrome DevTools (View → Developer → JavaScript Console)
2. Clear the console
3. Set up your 4 sections in the preview:
   - Section 0 (top-left): Screen capture
   - Section 1 (top-right): Another screen/region
   - Section 2 (bottom-left): Another screen/region  
   - Section 3 (bottom-right): **Camera** (this is the problematic one)
4. Click Record

### Step 2: Monitor Console Output

Watch for these specific issues:

#### Camera Section (Black Screen Issue)
Look for logs about section 3:
```
[RecordingCanvas] Frame 0 section sources:
  { index: 3, type: 'video', hasElement: true, videoReadyState: 1, ... }
```

**Key Questions**:
- Is `type` = 'video'?
- Is `hasElement` = true?
- What is `videoReadyState`? (Should be 4 = HAVE_ENOUGH_DATA)
- Is `videoPaused` = false?
- Is `srcObject` present?

If `videoReadyState` is less than 4, the camera video isn't ready.

#### Early Recording Stop (15 Second Issue)
Monitor the interval logs:
```
[RecordingCanvas] Interval still running: 50 frames, 3.3s elapsed
[RecordingCanvas] Interval still running: 100 frames, 6.7s elapsed
[RecordingCanvas] Interval still running: 150 frames, 10.0s elapsed
[RecordingCanvas] Interval still running: 200 frames, 13.3s elapsed
```

**Key Questions**:
- Does the interval continue past 15 seconds?
- Do the frame counts keep increasing?
- When does the interval stop logging?

### Step 3: Record for 30+ Seconds

Let the recording run for at least 30 seconds to see if:
1. The interval keeps running
2. Frame counts continue to increase
3. Any errors appear in console

### Step 4: Check the Output File

After stopping:
```bash
cd test-results
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height,nb_frames recording_*.mp4 | tail -20
```

**Expected**:
- Video resolution: 960x540 (not 320x180)
- Video frames should match audio duration (e.g., 30 seconds @ 15fps = 450 frames)

### Step 5: Report Findings

Please provide:
1. **All console logs** (copy the entire output)
2. **When recording stopped** (based on interval logs)
3. **Section source details** from frame 0
4. **ffprobe output** for the recorded file
5. **Screen recording** or screenshot showing:
   - The 4 preview sections BEFORE recording
   - The camera feed showing live video

## Expected Behaviors

### Healthy Recording
- All 4 sections show valid sources in frame 0 log
- Video sources have `readyState: 4`
- Interval logs continue every ~3.3 seconds (50 frames)
- Progress logs show increasing frame counts
- Minimal dropped frames (< 10%)

### Camera Section Working
```
{ index: 3, type: 'video', hasElement: true, elementTag: 'VIDEO', 
  videoReadyState: 4, videoPaused: false, canvasSize: 'N/A' }
```

### Interval Running Continuously
```
[RecordingCanvas] Interval still running: 50 frames, 3.3s elapsed, interval ID: 5
[RecordingCanvas] Interval still running: 100 frames, 6.7s elapsed, interval ID: 5
[RecordingCanvas] Interval still running: 150 frames, 10.0s elapsed, interval ID: 5
... continues until you click Stop ...
```

## Common Issues

### Camera Shows Black
**Symptom**: `videoReadyState < 4` for section 3

**Possible Causes**:
- Camera permission not granted
- Camera stream not started before recording
- Wrong video element reference

**Debug**: Check if camera shows in preview BEFORE recording

### Recording Stops Early
**Symptom**: Interval logs stop after ~15 seconds

**Possible Causes**:
- Component unmounting (React state change)
- Error in captureAndSendFrame causing interval to clear
- IPC backpressure causing the system to stall

**Debug**: Look for any errors or warnings before interval stops

### Low Frame Rate
**Symptom**: High dropped frame count

**Possible Causes**:
- IPC too slow at 960x540 resolution
- Main thread blocked by Array.from() conversion

**Solution**: Expect some dropped frames, but should be < 30%

## Backend Logging

The Rust backend also has logging. Check the terminal where `npm run tauri:dev` is running:

```
Received first frame: 960x540, 2073600 bytes, timestamp: 76ms
```

This confirms frames are reaching the backend.

## Next Steps Based on Findings

1. **If camera section is black**: Debug the camera source assignment in Preview component
2. **If recording stops early**: Add error boundaries and investigate component lifecycle
3. **If resolution is still low**: Check `RECORDING_SCALE` is actually 1/2 in both files
4. **If frame rate is too low**: May need to reduce scale back to 1/3 or implement binary IPC

---

*Created: 2026-02-04*
