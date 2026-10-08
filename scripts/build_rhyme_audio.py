"""Build public audio copies without the spoken platform outro; keep the source intact."""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--ffmpeg", default="ffmpeg", help="FFmpeg executable path")
args = parser.parse_args()
source = ROOT / "月光光童谣.mp4"
out = ROOT / "assets/audio"
captions = json.loads((out / "yueguangguang-captions.json").read_text(encoding="utf-8"))

# The recording ends at 78.170s; silence lasts until the brand voice at 79.627s.
# Cutting inside that silence preserves the song and avoids a click or fade over it.
trim = f"atrim=end={captions['duration']},asetpts=PTS-STARTPTS"
for extension, codec in [("mp3", ["-c:a", "libmp3lame", "-b:a", "192k"]),
                         ("m4a", ["-c:a", "aac", "-b:a", "128k"])]:
    subprocess.run([args.ffmpeg, "-y", "-v", "error", "-i", str(source), "-vn",
                    "-af", trim, *codec, "-map_metadata", "-1",
                    str(out / f"yueguangguang.{extension}")], check=True)
shutil.copyfile(out / "yueguangguang.mp3", out / "yueguangguang.bin")
# Retain the existing public video format, but replace its soundtrack with the
# same trimmed AAC used above; the local reference video is never overwritten.
subprocess.run([args.ffmpeg, "-y", "-v", "error", "-i", str(source),
                "-i", str(out / "yueguangguang.m4a"), "-map", "0:v:0", "-map", "1:a:0",
                "-c", "copy", "-t", str(captions["duration"]), "-map_metadata", "-1",
                "-movflags", "+faststart", str(out / "yueguangguang.mp4")], check=True)
print(f"Public recording: {captions['duration']}s; original source preserved; binary matches MP3")
