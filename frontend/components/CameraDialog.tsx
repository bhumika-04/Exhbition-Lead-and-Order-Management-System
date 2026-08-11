'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Camera, SwitchCamera, Loader2, AlertTriangle } from 'lucide-react';

/**
 * Full-screen webcam capture.
 *
 * Used on desktop, where a file input — even with `capture` — only ever opens a
 * file picker. On phones the native camera app is better (autofocus, HDR, full
 * sensor resolution), so callers route mobile to a `capture` input instead and
 * open this only on desktop.
 */
export default function CameraDialog({
  open,
  title = 'Take photo',
  onCapture,
  onClose,
}: {
  open: boolean;
  title?: string;
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async (preferredId?: string) => {
    setStarting(true);
    setError(null);
    stop();
    try {
      // Browsers only expose mediaDevices in a secure context. Over plain HTTP
      // on a LAN address it is undefined, and calling through it throws a
      // TypeError that the catch below reported as "could not start the camera"
      // — true but useless. Say what is actually wrong.
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          window.isSecureContext
            ? 'This browser does not support in-page camera capture. Use Upload instead.'
            : `The camera needs a secure connection. You are on ${window.location.protocol}//${window.location.host} — `
              + 'open the site over HTTPS or on localhost, or use Upload instead.'
        );
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: preferredId
          ? { deviceId: { exact: preferredId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // Labels are only populated after permission is granted, so enumerate
      // here rather than before the getUserMedia call.
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter(d => d.kind === 'videoinput');
      setDevices(cams);

      const active = stream.getVideoTracks()[0]?.getSettings().deviceId;
      setDeviceId(preferredId ?? active ?? cams[0]?.deviceId);
    } catch (err: any) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow it in your browser, or use Upload instead.'
          : err?.name === 'NotFoundError'
          ? 'No camera found on this device. Use Upload instead.'
          : 'Could not start the camera. Use Upload instead.'
      );
    } finally {
      setStarting(false);
    }
  }, [stop]);

  useEffect(() => {
    if (open) start();
    return () => stop();
  }, [open, start, stop]);

  // Escape closes, matching every other dialog in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { stop(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, stop]);

  const switchCamera = () => {
    if (devices.length < 2) return;
    const i = devices.findIndex(d => d.deviceId === deviceId);
    start(devices[(i + 1) % devices.length].deviceId);
  };

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    canvas.toBlob(blob => {
      if (!blob) return;
      onCapture(new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' }));
      stop();
      onClose();
    }, 'image/jpeg', 0.92);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 shrink-0">
        <span className="text-sm font-semibold text-white flex-1">{title}</span>
        {devices.length > 1 && !error && (
          <button onClick={switchCamera} aria-label="Switch camera"
                  className="p-2 rounded-lg text-white/80 hover:bg-card/10">
            <SwitchCamera className="w-5 h-5" />
          </button>
        )}
        <button onClick={() => { stop(); onClose(); }} aria-label="Close"
                className="p-2 rounded-lg text-white/80 hover:bg-card/10">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Preview */}
      <div className="flex-1 min-h-0 relative flex items-center justify-center">
        {error ? (
          <div className="flex flex-col items-center gap-3 px-8 text-center">
            <AlertTriangle className="w-10 h-10 text-warning" />
            <p className="text-sm text-white/90 max-w-xs">{error}</p>
          </div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted
                   className="max-h-full max-w-full object-contain" />
            {starting && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-7 h-7 animate-spin text-white/70" />
              </div>
            )}
            {/* Card-shaped guide: a visiting card framed edge-to-edge reads far
                better than one floating in the middle of the frame. */}
            {!starting && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[86%] max-w-lg aspect-[1.6/1] border-2 border-white/70 rounded-xl" />
              </div>
            )}
          </>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Shutter */}
      <div className="shrink-0 px-6 pb-8 pt-4 flex items-center justify-center">
        {error ? (
          <button onClick={() => { stop(); onClose(); }}
                  className="px-6 py-3 rounded-xl bg-card/10 text-white text-sm font-semibold">
            Close
          </button>
        ) : (
          <button onClick={capture} disabled={starting} aria-label="Capture"
                  className="w-16 h-16 rounded-full bg-card disabled:bg-card/40 flex items-center justify-center ring-4 ring-white/30 transition-transform active:scale-95">
            <Camera className="w-6 h-6 text-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}
