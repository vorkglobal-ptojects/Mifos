'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Button } from './ui/button';
import { Camera, X, Check, Upload } from 'lucide-react';

import { compressImage } from '@/lib/image-compression';

interface WebcamCaptureProps {
  onCapture: (base64Image: string) => void;
  onClose: () => void;
  initialImage?: string | null;
}

export function WebcamCapture({ onCapture, onClose, initialImage }: WebcamCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(initialImage || null);
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) return;
      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } 
        });
      } catch {
        // Fallback for laptop/desktop or front webcams without 'environment' facingMode
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: true 
        });
      }
      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.play().catch(() => {});
      }
      setError(null);
    } catch (err: any) {
      console.error("Error accessing camera:", err);
      setError("Unable to access camera. Please check permissions or select a photo file.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      startCamera();
    }, 0);
    return () => {
      clearTimeout(timer);
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    if (videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [capturedImage]);

  const capturePhoto = async () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);
        const image = canvas.toDataURL('image/jpeg', 0.85);
        stopCamera();
        try {
          const compressed = await compressImage(image, 1200, 0.8);
          setCapturedImage(compressed);
        } catch {
          setCapturedImage(image);
        }
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      compressImage(file, 1280, 960, 0.85).then((compressed) => {
        if (compressed) {
          setCapturedImage(compressed);
          stopCamera();
        }
      });
      // Clear file input value so user can select the same file again if they retake
      e.target.value = '';
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
    startCamera();
  };

  const handleConfirm = () => {
    if (capturedImage) {
      onCapture(capturedImage);
      stopCamera();
    }
  };

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  return (
    <div className="flex flex-col items-center bg-slate-900/95 p-4 rounded-xl shadow-2xl relative w-full max-w-lg mx-auto">
      <input 
        ref={fileInputRef} 
        type="file" 
        accept="image/*" 
        className="hidden" 
        onChange={handleFileUpload} 
      />

      <Button 
        variant="ghost" 
        size="icon" 
        className="absolute top-2 right-2 text-white hover:bg-slate-800 rounded-full"
        onClick={handleClose}
      >
        <X className="w-5 h-5" />
      </Button>

      <div className="w-full aspect-video bg-black rounded-lg overflow-hidden relative mt-6 flex items-center justify-center">
        {error && !capturedImage ? (
          <div className="flex flex-col items-center justify-center p-4 text-center">
            <div className="text-red-400 text-sm font-semibold mb-3">{error}</div>
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => fileInputRef.current?.click()}
              className="text-white border-white/20 hover:bg-white/10 gap-2"
            >
              <Upload className="w-4 h-4" /> Upload Photo File
            </Button>
          </div>
        ) : capturedImage ? (
          <img src={capturedImage} alt="Captured scale proof" className="w-full h-full object-contain bg-black" />
        ) : (
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted
            className="w-full h-full object-cover"
          />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="mt-4 flex gap-3 w-full justify-center">
        {capturedImage ? (
          <>
            <Button onClick={handleRetake} variant="secondary" className="flex-1 font-bold">
              Retake
            </Button>
            <Button onClick={handleConfirm} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold gap-2">
              <Check className="w-4 h-4" /> Confirm & Use Photo
            </Button>
          </>
        ) : (
          <>
            <Button 
              onClick={capturePhoto} 
              disabled={!!error} 
              className="flex-[2] bg-amber-500 hover:bg-amber-600 text-white font-bold h-12 gap-2 text-base"
            >
              <Camera className="w-5 h-5" /> Capture Photo
            </Button>
            <Button 
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 text-white border-white/20 hover:bg-white/10 h-12 gap-1.5 text-xs font-bold"
            >
              <Upload className="w-4 h-4" /> File
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
