"""Encode the existing local MP4 as H.264/AAC HLS and DASH playback fixtures."""
import argparse
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--ffmpeg', default='ffmpeg')
args = parser.parse_args()
if Path(args.ffmpeg).is_file():
    args.ffmpeg = str(Path(args.ffmpeg).resolve())
root = Path(__file__).resolve().parent.parent
output = root / '.cache/customer-feedback-20261111/stream-fixtures'
for kind in ('hls', 'dash'):
    (output / kind).mkdir(parents=True, exist_ok=True)
    for generated in (output / kind).iterdir():
        if generated.is_file():
            generated.unlink()
base = [args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(root / 'assets/audio/yueguangguang.mp4'), '-t', '6',
        '-vf', 'scale=640:-2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-crf', '28',
        '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-c:a', 'aac', '-ar', '48000', '-ac', '2']
subprocess.run(base + ['-hls_segment_type', 'mpegts', '-hls_time', '2', '-hls_playlist_type', 'vod', 'index.m3u8'], cwd=output / 'hls', check=True)
subprocess.run(base + ['-f', 'dash', '-seg_duration', '2', 'index.mpd'], cwd=output / 'dash', check=True)
print(output)
