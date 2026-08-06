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

export default function BarcodeScanner({
  value,
  onChange,
  placeholder = 'Scan or type barcode',
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);

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
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const reader = new BrowserMultiFormatReader();

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

  return (
    <div className="w-full">
      {label && <span className="text-xs text-slate-500 font-medium">{label}</span>}

      <div className={`flex gap-2 ${label ? 'mt-1' : ''}`}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoCapitalize="characters"
          autoComplete="off"
          className="flex-1 h-11 px-3 rounded-lg border border-slate-200 bg-white text-sm font-mono"
        />
        <button
          type="button"
          onClick={scanning || starting ? stop : start}
          disabled={decoder === null}
          aria-label={scanning ? 'Stop scanning' : 'Scan barcode with camera'}
          className={`h-11 w-11 shrink-0 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 ${
            scanning || starting ? 'bg-rose-100 text-rose-600' : 'bg-blue-600 text-white hover:bg-blue-700'
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
        <p className="mt-1 text-[11px] text-amber-700 flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-px" /> {error}
        </p>
      )}
    </div>
  );
}
