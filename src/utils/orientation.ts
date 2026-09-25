/**
 * Read EXIF Orientation from a File / Blob. Returns a value between 1 and 8,
 * or null when the file isn't a JPEG/HEIC/PNG/WebP with EXIF.
 *
 * Why: phone photos carry an Orientation tag the raw decoder ignores.
 * Browsers (including WebView2) apply it visually when `image-orientation` is
 * left at its default, but `naturalWidth/naturalHeight` stay in the physical
 * pixel space. Without compensating, the page builds a container from the
 * physical size while the rendered content is rotated, and the picture ends up
 * squeezed or stretched. Rust reports the visual dimensions for path items;
 * here we patch the same field for File objects (web picker / drag-drop).
 */
let cachedParser: Promise<typeof import('exifr').default> | null = null;
function parser() {
  if (!cachedParser) cachedParser = import('exifr').then((m) => m.default);
  return cachedParser;
}

const orientationCache = new WeakMap<Blob, number | null>();

export async function readOrientationIfBlob(blob: Blob | null): Promise<number | null> {
  if (!blob) return null;
  const cached = orientationCache.get(blob);
  if (cached !== undefined) return cached;
  try {
    const exifr = await parser();
    // We only need the EXIF Orientation field; tell exifr to skip everything
    // else (gps, interop, xmp, …) so the parse stays cheap.
    const data = await exifr.parse(blob, {
      tiff: true,
      exif: true,
      ifd0: {},
      gps: false,
      interop: false,
      ifd1: false,
      xmp: false,
      icc: false,
      iptc: false,
      jfif: false,
      ihdr: false,
      translateValues: false,
      reviveValues: false,
      mergeOutput: false,
    });
    const o = (data as { Orientation?: number } | undefined)?.Orientation;
    const result = typeof o === 'number' && o >= 1 && o <= 8 ? o : null;
    orientationCache.set(blob, result);
    return result;
  } catch {
    orientationCache.set(blob, null);
    return null;
  }
}

export async function readOrientationIfFile(file: Blob | null): Promise<number | null> {
  return readOrientationIfBlob(file);
}