'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ScanLine, X, Keyboard } from 'lucide-react';

/**
 * Barcode capture with a typing fallback.
 *
 * Uses the browser's native BarcodeDetector where available (Chrome/Edge on
 * Android, which is most of the exhibition-floor traffic). Everywhere else —
 * notably iOS Safari, which still has no BarcodeDetector — the camera button
 * is hidden and the field behaves as a plain text input. A USB scanner at the
 * counter also just types into it, so one component covers all three ways a
 * barcode gets entered.
 */
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

  const [scanning, setScanning] = useState(false);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'BarcodeDetector' in window);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  // Camera and animation frames must be released if the user navigates away
  // mid-scan, or the torch stays on and the tab keeps burning battery.
  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const Detector = (window as any).BarcodeDetector;
      const detector = new Detector({
        formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar'],
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setScanning(true);

      // The <video> only exists once scanning is true, so wait a frame for it.
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
          if (codes?.length) {
            const found = codes[0].rawValue?.trim();
            if (found) {
              onChange(found);
              if (navigator.vibrate) navigator.vibrate(60);
              stop();
              return;
            }
          }
        } catch {
          // A single failed frame is normal — keep looking.
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err: any) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission denied — type the barcode instead'
          : 'Could not open the camera — type the barcode instead'
      );
      stop();
    }
  }, [onChange, stop]);

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
        {supported && (
          <button
            type="button"
            onClick={scanning ? stop : start}
            aria-label={scanning ? 'Stop scanning' : 'Scan barcode with camera'}
            className={`h-11 w-11 shrink-0 rounded-lg flex items-center justify-center transition-colors ${
              scanning ? 'bg-rose-100 text-rose-600' : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {scanning ? <X className="w-5 h-5" /> : <ScanLine className="w-5 h-5" />}
          </button>
        )}
      </div>

      {scanning && (
        <div className="mt-2 relative rounded-xl overflow-hidden bg-black">
          <video ref={videoRef} playsInline muted className="w-full max-h-56 object-cover" />
          {/* Aiming guide — a barcode read is much faster when it is centred */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-4/5 h-16 border-2 border-white/80 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
          <p className="absolute bottom-2 inset-x-0 text-center text-[11px] text-white/90">
            Point at the barcode on the tag
          </p>
        </div>
      )}

      {!supported && (
        <p className="mt-1 text-[10px] text-slate-400 flex items-center gap-1">
          <Keyboard className="w-3 h-3" /> Camera scanning isn&apos;t available on this browser — type it in
        </p>
      )}

      {error && <p className="mt-1 text-[11px] text-amber-700">{error}</p>}
    </div>
  );
}
