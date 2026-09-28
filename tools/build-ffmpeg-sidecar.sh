#!/usr/bin/env bash
# Build a *minimal* FFmpeg for the Lumina sidecar.
#
# Why: the prebuilt gyan essentials build is 100 MB per exe (plus 100 MB each
# for ffplay/ffprobe). Shipping that next to a 6 MB app is silly, so we compile
# only what the sidecar actually needs:
#
#   demuxers : matroska (MKV), mov (MP4/MOV), wav (test fixture)
#   decoders  : eac3 (Dolby Digital Plus), ac3, aac, pcm_s16le
#   parser    : ac3      (E-AC-3 frame sync inside container packets)
#   encoder   : pcm_s16le — converts fltp → s16 *inside libavcodec* via
#                          libswresample, so we never need libavfilter /
#                          the auto-inserted aresample filter
#   muxer     : wav      (self-describing header on stdout; Rust parses it)
#   protocols : file, pipe
#
# Everything else stays off: no encoders for video, no muxers besides wav, no
# filters, no network protocols, no programs except ffmpeg itself.
# Result: roughly 5-10 MB instead of 100 MB.
#
# Usage (from MSYS2 MINGW64 shell or any bash with /mingw64/bin on PATH):
#   bash tools/build-ffmpeg-sidecar.sh [SRC_DIR] [OUT_DIR]
#
# Requires: MSYS2 with mingw-w64-x86_64-{gcc,make,pkgconf,nasm} + msys2 make/nasm.
set -euo pipefail

SRC="${1:-/d/Ai/lumina/src-tauri/ffmpeg-sc}"
OUT="${2:-/d/Ai/lumina/src-tauri/bin}"
JOBS="$(nproc 2>/dev/null || echo 4)"

export PATH="/mingw64/bin:$PATH"

if [ ! -f "$SRC/configure" ]; then
    echo "ffmpeg source not found at $SRC" >&2
    exit 1
fi
mkdir -p "$OUT"
cd "$SRC"

if [ ! -f ffbuild/config.mak ]; then
    echo "== configure (minimal, fully static) =="
    # --pkg-config-flags=--static is the load-bearing flag: without it the
    # mingw build links libiconv/zlib/winpthreads as *runtime* DLLs and the
    # sidecar dies with STATUS_DLL_NOT_FOUND on a machine that lacks MSYS2.
    # --extra-ldflags -static finishes the job for anything pkg-config missed.
    ./configure \
        --prefix="$OUT/stage" \
        --arch=x86_64 \
        --pkg-config-flags=--static \
        --extra-ldflags="-static -Wl,--gc-sections -Wl,--as-needed" \
        --disable-everything \
        --disable-doc --disable-manpages \
        --disable-debug --disable-symver \
        --disable-ffplay --disable-ffprobe \
        --enable-static --disable-shared \
        --disable-network \
        --disable-iconv \
        --enable-decoder=eac3,ac3,aac,pcm_s16le \
        --enable-parser=ac3,aac \
        --enable-demuxer=matroska,mov,wav \
        --enable-encoder=pcm_s16le \
        --enable-muxer=wav \
        --enable-protocol=file,pipe \
        --enable-filter=aformat,anull,atrim,crop,format,hflip,null,rotate,transpose,trim,vflip \
        --extra-cflags="-Os -ffunction-sections -fdata-sections"
    # Fail fast: with --disable-everything the ffmpeg *program* is dropped
    # silently when its ffmpeg_select filters are missing, and you only find
    # out after compiling 200 objects. Catch it here.
    if ! grep -qE '^ffmpeg_(objs|deps|select|extralibs)=' ffbuild/config.mak 2>/dev/null; then
        echo "FATAL: configure dropped the ffmpeg program." >&2
        echo "       Its deps are: ffmpeg_deps=\"avcodec avfilter avformat threads\"" >&2
        echo "       and it additionally selects the aformat/anull/atrim/crop/format/" >&2
        echo "       hflip/null/rotate/transpose/trim/vflip filters — enable them all." >&2
        exit 1
    fi
fi

echo "== make -j$JOBS =="
make -j"$JOBS"

# The mingw build emits ffmpeg.exe at the source root; older layouts put it in
# ffbuild/. Try both rather than guessing.
BUILT=""
for cand in ffmpeg.exe ffmpeg_g.exe ffbuild/ffmpeg.exe ffbuild/ffmpeg_g.exe; do
    if [ -f "$cand" ]; then
        BUILT="$cand"
        break
    fi
done
if [ -z "$BUILT" ]; then
    echo "FATAL: no ffmpeg.exe produced (looked in source root and ffbuild/)" >&2
    exit 1
fi
cp -f "$BUILT" "$OUT/ffmpeg-x86_64-pc-windows-msvc.exe"
[ -f LICENSE.md ] && cp -f LICENSE.md "$OUT/LICENSE.ffmpeg.txt"

echo
echo "== self-check =="
FF="$OUT/ffmpeg-x86_64-pc-windows-msvc.exe"
SZ=$(stat -c %s "$FF")
echo "sidecar: $FF ($((SZ / 1024 / 1024)) MB)"

# 1) decoders present
"$FF" -hide_banner -decoders 2>/dev/null | grep -E '\b(eac3|ac3|aac)\b' || {
    echo "FATAL: required decoders missing" >&2
    exit 1
}
echo "decoders: eac3 / ac3 / aac present"

# 2) no external runtime DLLs — a missing libiconv/zlib/winpthread only shows
#    up as STATUS_DLL_NOT_FOUND, which a "does it list decoders" check misses.
MISSING=$(ldd "$FF" 2>/dev/null | grep 'not found' || true)
if [ -n "$MISSING" ]; then
    echo "FATAL: sidecar needs runtime DLLs:" >&2
    echo "$MISSING" >&2
    exit 1
fi
echo "linkage: fully static (no missing DLLs)"

# 3) actually decode — the only check that proves the binary runs here.
#    Note: raw s16le needs a raw demuxer, which a decode-only build does not
#    enable, so feed it a real WAV (the sidecar's own demuxer list covers that).
WAV="$(mktemp -t seam-XXXXXX).wav"
RAW="$(mktemp -t seamraw-XXXXXX)"
le32() { # little-endian uint32, avoids hand-computed hex in the WAV header
    local v=$1
    printf "\\x$(printf '%02x' $((v & 0xff)))\\x$(printf '%02x' $(((v >> 8) & 0xff)))"
    printf "\\x$(printf '%02x' $(((v >> 16) & 0xff)))\\x$(printf '%02x' $(((v >> 24) & 0xff)))"
}
head -c 48000 /dev/zero > "$RAW"          # 0.25 s of 48 kHz stereo s16 silence
{
    printf 'RIFF'; le32 $((36 + 48000)); printf 'WAVE'
    printf 'fmt '; le32 16; printf '\x01\x00'      # PCM
    printf '\x02\x00'; le32 48000                  # channels, sample rate
    le32 192000; printf '\x04\x00'; printf '\x10\x00'  # byte rate, block align, bits
    printf 'data'; le32 48000
    cat "$RAW"
} > "$WAV"
PCM=$("$FF" -v error -nostdin -i "$WAV" -map 0:a:0 -c:a pcm_s16le -f wav - 2>/dev/null | wc -c)
rm -f "$WAV" "$RAW"
if [ "${PCM:-0}" -lt 40000 ]; then
    echo "FATAL: decode produced only ${PCM:-0} bytes" >&2
    exit 1
fi
echo "decode: ${PCM} bytes of PCM over a pipe"

echo
echo "OK — drop this next to lumina.exe in src-tauri/target/release/"
