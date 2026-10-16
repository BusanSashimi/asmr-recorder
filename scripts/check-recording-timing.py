#!/usr/bin/env python3
"""Check A/V track boundaries in a real capture (requires ffprobe)."""
import argparse
import csv
import json
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("recording")
parser.add_argument("--tolerance", type=float, default=0.15)
args = parser.parse_args()
report = json.loads(subprocess.check_output([
    "ffprobe", "-v", "error", "-show_entries",
    "stream=codec_type,start_time,duration", "-of", "json", args.recording,
], text=True))
video = next(s for s in report["streams"] if s["codec_type"] == "video")
audio = next(s for s in report["streams"] if s["codec_type"] == "audio")
start_delta = float(audio["start_time"]) - float(video["start_time"])
end_delta = (float(audio["start_time"]) + float(audio["duration"]) -
             float(video["start_time"]) - float(video["duration"]))
print(f"Audio minus video: start {start_delta:+.6f}s; end {end_delta:+.6f}s")
if abs(start_delta) > args.tolerance or abs(end_delta) > args.tolerance:
    raise SystemExit(f"FAIL: track boundaries differ by more than {args.tolerance}s")
# A paused audio clock must drop a video frame, rather than enqueue two frames
# at the same decoding timestamp. Check packets incrementally for long takes.
last_dts = {}
first_invalid = None
with subprocess.Popen([
    "ffprobe", "-v", "error", "-show_packets", "-show_entries",
    "packet=stream_index,dts", "-of", "csv=p=0", args.recording,
], stdout=subprocess.PIPE, text=True) as probe:
    for row in csv.reader(probe.stdout):
        if len(row) < 2 or row[1] == "N/A":
            continue
        stream, dts = int(row[0]), int(row[1])
        if stream in last_dts and dts <= last_dts[stream] and first_invalid is None:
            first_invalid = f"stream {stream}: DTS {dts} follows {last_dts[stream]}"
        last_dts[stream] = dts
    if probe.wait():
        raise SystemExit("FAIL: could not inspect media packet timestamps")
if first_invalid:
    raise SystemExit(f"FAIL: non-increasing packet timestamps ({first_invalid})")
print("PASS: aligned track boundaries and strictly increasing packet DTS (does not certify perceptual lip sync)")
