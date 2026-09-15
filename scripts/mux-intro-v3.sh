#!/usr/bin/env bash
# Burn ASS (BorderStyle=1 outline) and mux looped beds → Fly-DJ-intro-v3{,-AUDIO}.mp4
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="${1:-/tmp/fly-dj-v3/raw-capture.mp4}"
ASS="${2:-$ROOT/handoff/Fly-DJ-intro-v3.ass}"
OUT_DIR="${3:-$ROOT/handoff}"
BEDS="$ROOT/public/audio/beds"
MIX="/tmp/fly-dj-v3/beds-mix.wav"
mkdir -p "$OUT_DIR" /tmp/fly-dj-v3 /opt/cursor/artifacts

ffprobe -hide_banner "$RAW" 2>&1 | tail -20

# Techno 0–57, Glitch 57–64, Breakbeat 64–136. Title 0–5 quieter; showcase 110–126 a bit louder.
ffmpeg -y \
  -stream_loop -1 -i "$BEDS/techno_120_a.wav" \
  -stream_loop -1 -i "$BEDS/glitch_110_a.wav" \
  -stream_loop -1 -i "$BEDS/breakbeat_140_a.wav" \
  -filter_complex "\
    [0:a]atrim=0:57,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.6,volume=0.78,volume=0.18:enable='between(t,0,5)'[tec];\
    [1:a]atrim=0:7,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.2,volume=0.82[gli];\
    [2:a]atrim=0:72,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.2,volume=0.84,volume=1.12:enable='between(t,46,62)',afade=t=out:st=68:d=4[brk];\
    [tec][gli][brk]concat=n=3:v=0:a=1[out]" \
  -map "[out]" -ac 2 -ar 44100 "$MIX"

# Scale if needed, burn ASS (outline only — never force BorderStyle=3).
ffmpeg -y -i "$RAW" \
  -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,ass=${ASS}" \
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -an \
  "$OUT_DIR/Fly-DJ-intro-v3.mp4"

ffmpeg -y \
  -i "$OUT_DIR/Fly-DJ-intro-v3.mp4" \
  -i "$MIX" \
  -map 0:v -map 1:a -shortest \
  -c:v copy -c:a aac -b:a 192k \
  "$OUT_DIR/Fly-DJ-intro-v3-AUDIO.mp4"

cp -f "$OUT_DIR/Fly-DJ-intro-v3.mp4" /opt/cursor/artifacts/Fly-DJ-intro-v3.mp4
cp -f "$OUT_DIR/Fly-DJ-intro-v3-AUDIO.mp4" /opt/cursor/artifacts/Fly-DJ-intro-v3-AUDIO.mp4

echo "==== VERIFY ===="
ffprobe -v error -show_entries format=duration:stream=width,height,codec_name \
  -of default=noprint_wrappers=1 "$OUT_DIR/Fly-DJ-intro-v3.mp4"
ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name \
  -of default=noprint_wrappers=1 "$OUT_DIR/Fly-DJ-intro-v3-AUDIO.mp4"
ls -lh "$OUT_DIR/Fly-DJ-intro-v3.mp4" "$OUT_DIR/Fly-DJ-intro-v3-AUDIO.mp4"
