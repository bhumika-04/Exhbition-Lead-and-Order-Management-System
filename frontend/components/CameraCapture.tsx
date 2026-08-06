'use client';

import { useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  label?: string;
}

export default function CameraCapture({ onCapture, label = 'Capture Photo' }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }

      setStream(mediaStream);
      setShowCamera(true);
    } catch (error) {
      console.error('Error accessing camera:', error);
      toast.error('Could not access camera. Please check permissions.');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setShowCamera(false);
  }, [stream]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      if (!blob) return;

      const file = new File([blob], `card_${Date.now()}.jpg`, { type: 'image/jpeg' });
      const imageUrl = URL.createObjectURL(blob);

      setCapturedImage(imageUrl);
      onCapture(file);
      stopCamera();
    }, 'image/jpeg', 0.95);
  }, [onCapture, stopCamera]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const imageUrl = URL.createObjectURL(file);
      setCapturedImage(imageUrl);
      onCapture(file);
    }
  };

  const retake = () => {
    setCapturedImage(null);
    startCamera();
  };

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        className="hidden"
      />

      {!showCamera && !capturedImage && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={startCamera}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition flex items-center justify-center"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {label}
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-3 px-4 rounded-lg transition flex items-center justify-center"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            Or Upload from Gallery
          </button>
        </div>
      )}

      {showCamera && (
        <div className="relative bg-black rounded-lg overflow-hidden">
          <video ref={videoRef} autoPlay playsInline className="w-full" />
          <canvas ref={canvasRef} className="hidden" />

          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent">
            <div className="flex justify-center space-x-4">
              <button
                type="button"
                onClick={stopCamera}
                className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-6 rounded-full transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={capturePhoto}
                className="bg-white hover:bg-gray-100 text-gray-900 font-medium py-2 px-8 rounded-full transition"
              >
                📸 Capture
              </button>
            </div>
          </div>
        </div>
      )}

      {capturedImage && (
        <div className="space-y-3">
          <img src={capturedImage} alt="Captured" className="w-full rounded-lg border-2 border-green-500" />
          <button
            type="button"
            onClick={retake}
            className="w-full bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-lg transition"
          >
            Retake Photo
          </button>
        </div>
      )}
    </div>
  );
}
