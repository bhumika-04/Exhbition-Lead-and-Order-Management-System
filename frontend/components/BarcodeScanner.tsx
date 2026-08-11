'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScanLine, X, Loader2, AlertTriangle } from 'lucide-react';

/**
 * Barcode capture with a typed fallback.
 *
 * Two decoders, chosen at runtime:
 *
 *  1. The browser's native `BarcodeDetector` (Chrome/Edge on Android and
 *     desktop). Fast, hardware-accelerated, and costs nothing to download.
 *  2. ZXing, **lazily imported** only when the native API is absent — Safari,
 *     Firefox, and older Chrome. It is a few hundred KB, so it must not land in
 *     the main bundle for the majority who never need it.
 *
 * A USB scanner at the counter simply types into the same field, so one
 * component covers all three ways a barcode gets entered.
 */

type Decoder = 'native' | 'zxing';

// Keep in step between the two decoders so a code that scans on Android also
// scans on an iPhone.
const NATIVE_FORMATS = [
  'code_128', 'code_39', 'code_93', 'ean_13', 'ean_8',
  'upc_a', 'upc_e', 'itf', 'codabar',
];

/**
 * ZXing warns on every format that fails to match, on every frame. Its
 * `instanceof ReaderException` check does not survive bundling, so ordinary
 * "no barcode in this frame" results are logged as though they were errors —
 * hundreds of lines a second, which makes the console unusable while scanning.
 * The library exposes no log level, so filter that one message while a camera
 * is live.
 *
 * Reference-counted at module scope rather than per component: the order form
 * renders one scanner per line item, so two can be live at once, and
 * per-instance save/restore would leave a wrapper permanently installed.
 */
let zxingMuteCount = 0;
let savedConsoleWarn: typeof console.warn | null = null;

function muteZxingNoise() {
  if (zxingMuteCount++ > 0) return;
  savedConsoleWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('MultiFormatReader')) return;
    savedConsoleWarn?.(...args);
  };
}

function unmuteZxingNoise() {
  if (zxingMuteCount === 0) return;
  if (--zxingMuteCount === 0 && savedConsoleWarn) {
    console.warn = savedConsoleWarn;
    savedConsoleWarn = null;
  }
}

export default function BarcodeScanner({
  value,
  onChange,
  placeholder = 'Scan or type barcode',
  label,
  autoStart = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  /** Opens the camera on mount — for a dedicated "scan" screen where pressing
   *  a second button to begin would be redundant. */
  autoStart?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);
  // Tracked so stop() releases exactly one mute, never a stray one.
  const mutedRef = useRef(false);

  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [decoder, setDecoder] = useState<Decoder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Decided once on mount so the button label can say which path will run.
    setDecoder(
      typeof window !== 'undefined' && 'BarcodeDetector' in window ? 'native' : 'zxing'
    );
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // ZXing owns the stream it opened, so let it release its own.
    zxingControlsRef.current?.stop();
    zxingControlsRef.current = null;

    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    if (mutedRef.current) { unmuteZxingNoise(); mutedRef.current = false; }
    setScanning(false);
    setStarting(false);
  }, []);

  // Release the camera if the user navigates away mid-scan, otherwise the
  // indicator light stays on and the tab keeps burning battery.
  useEffect(() => () => stop(), [stop]);

  const found = useCallback((code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    onChange(trimmed);
    if (navigator.vibrate) navigator.vibrate(60);
    stop();
  }, [onChange, stop]);

  /** Native BarcodeDetector: our own stream plus a per-frame detect loop. */
  const startNative = useCallback(async () => {
    const Detector = (window as any).BarcodeDetector;
    const detector = new Detector({ formats: NATIVE_FORMATS });

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    streamRef.current = stream;
    setScanning(true);
    setStarting(false);

    // The <video> only mounts once `scanning` is true, so wait a frame for it.
    requestAnimationFrame(() => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    });

    const tick = async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      try {
        const codes = await detector.detect(videoRef.current);
        if (codes?.length && codes[0].rawValue) { found(codes[0].rawValue); return; }
      } catch {
        // A single failed frame is normal — keep looking.
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [found]);

  /** ZXing fallback. decodeFromVideoDevice opens and owns its own stream. */
  const startZxing = useCallback(async () => {
    const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
      import('@zxing/browser'),
      import('@zxing/library'),
    ]);

    // Without this ZXing tries every format it knows — QR, Micro QR, DataMatrix,
    // Aztec, PDF417, MaxiCode — on every frame. Garment tags are 1D, so those
    // attempts are pure waste: slower scanning and a flood of warnings. Keep the
    // list matching NATIVE_FORMATS so a code that scans on one decoder scans on
    // the other.
    const hints = new Map<number, unknown>([
      [DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.CODE_93,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.ITF,
        BarcodeFormat.CODABAR,
      ]],
    ]);

    muteZxingNoise();
    mutedRef.current = true;
    const reader = new BrowserMultiFormatReader(hints as never);

    setScanning(true);
    setStarting(false);

    // Wait for the <video> that `scanning` just mounted.
    await new Promise(r => requestAnimationFrame(() => r(null)));
    if (!videoRef.current) throw new Error('video element unavailable');

    const controls = await reader.decodeFromVideoDevice(
      undefined,                 // let the browser pick; prefers the rear camera
      videoRef.current,
      (result) => { if (result) found(result.getText()); }
    );
    zxingControlsRef.current = controls;
  }, [found]);

  const start = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      if (decoder === 'native') await startNative();
      else await startZxing();
    } catch (err: any) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission denied — type the barcode instead'
          : err?.name === 'NotFoundError'
          ? 'No camera found — type the barcode instead'
          : 'Could not start the camera — type the barcode instead'
      );
      stop();
    }
  }, [decoder, startNative, startZxing, stop]);

  // Waits for `decoder` so the correct path is chosen; runs once.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || decoder === null || autoStarted.current) return;
    autoStarted.current = true;
    start();
  }, [autoStart, decoder, start]);

  return (
    <div className="w-full">
      {label && <span className="text-xs text-muted-foreground font-medium">{label}</span>}

      <div className={`flex gap-2 ${label ? 'mt-1' : ''}`}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoCapitalize="characters"
          autoComplete="off"
          className="flex-1 h-11 px-3 rounded-lg border border-border bg-card text-sm font-mono"
        />
        <button
          type="button"
          onClick={scanning || starting ? stop : start}
          disabled={decoder === null}
          aria-label={scanning ? 'Stop scanning' : 'Scan barcode with camera'}
          className={`h-11 w-11 shrink-0 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 ${
            scanning || starting ? 'bg-destructive/12 text-destructive' : 'bg-primary text-white hover:bg-primary/90'
          }`}
        >
          {starting ? <Loader2 className="w-5 h-5 animate-spin" />
            : scanning ? <X className="w-5 h-5" />
            : <ScanLine className="w-5 h-5" />}
        </button>
      </div>

      {(scanning || starting) && (
        <div className="mt-2 relative rounded-xl overflow-hidden bg-black">
          <video ref={videoRef} playsInline muted className="w-full max-h-60 object-cover" />
          {/* Aiming guide — a barcode reads much faster when it is centred */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-4/5 h-16 border-2 border-white/80 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
          <p className="absolute bottom-2 inset-x-0 text-center text-[11px] text-white/90">
            {starting ? 'Starting camera…' : 'Point at the barcode on the tag'}
          </p>
        </div>
      )}

      {error && (
        <p className="mt-1 text-[11px] text-warning flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-px" /> {error}
        </p>
      )}
    </div>
  );
}
