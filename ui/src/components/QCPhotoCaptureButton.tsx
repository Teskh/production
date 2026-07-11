import React, { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import clsx from 'clsx';

type QCPhotoCaptureButtonProps = {
  watermarkLines: (date: Date) => string[];
  onCapture: (file: File) => void;
  fileNamePrefix?: string;
  buttonLabel?: string;
  className?: string;
  disabled?: boolean;
};

const drawWatermark = (
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  lines: string[]
) => {
  const watermarkLines = lines.filter(Boolean);
  if (!watermarkLines.length) {
    return;
  }
  const padding = Math.max(12, Math.round(canvas.width * 0.02));
  const fontSize = Math.max(14, Math.round(canvas.width * 0.02));
  const lineHeight = Math.round(fontSize * 1.25);
  context.font = `600 ${fontSize}px sans-serif`;
  context.textBaseline = 'top';
  const maxLineWidth = Math.max(
    ...watermarkLines.map((line) => context.measureText(line).width)
  );
  const boxWidth = Math.min(canvas.width - padding * 2, maxLineWidth + padding * 2);
  const boxHeight = watermarkLines.length * lineHeight + padding * 2;
  const x = padding;
  const y = canvas.height - boxHeight - padding;
  context.fillStyle = 'rgba(0, 0, 0, 0.6)';
  context.fillRect(x, y, boxWidth, boxHeight);
  context.fillStyle = 'rgba(255, 255, 255, 0.92)';
  watermarkLines.forEach((line, index) => {
    context.fillText(line, x + padding, y + padding + index * lineHeight);
  });
};

const QCPhotoCaptureButton: React.FC<QCPhotoCaptureButtonProps> = ({
  watermarkLines,
  onCapture,
  fileNamePrefix = 'qc-observation',
  buttonLabel = 'Tomar foto',
  className,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [captureFlash, setCaptureFlash] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }

    let active = true;
    const startCamera = async () => {
      setCameraError(null);
      setCameraReady(false);
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Este navegador no soporta camara.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 30 },
          },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stopCamera();
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraReady(true);
      } catch (error) {
        if (!active) {
          return;
        }
        setCameraError(error instanceof Error ? error.message : 'No se pudo abrir la camara.');
        setCameraReady(false);
      }
    };
    void startCamera();
    return () => {
      active = false;
      stopCamera();
    };
  }, [open]);

  const openCamera = () => {
    setCameraError(null);
    setCameraReady(false);
    setOpen(true);
  };

  const closeCamera = () => {
    stopCamera();
    setCameraReady(false);
    setCameraError(null);
    setOpen(false);
  };

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) {
      setCameraError('No se pudo acceder a la camara.');
      return;
    }
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) {
      setCameraError('La camara aun no esta lista.');
      return;
    }
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError('No se pudo preparar la captura.');
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const stampDate = new Date();
    drawWatermark(context, canvas, watermarkLines(stampDate));
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.9)
    );
    if (!blob) {
      setCameraError('No se pudo capturar la foto.');
      return;
    }
    const file = new File([blob], `${fileNamePrefix}-${Date.now()}.webp`, {
      type: blob.type || 'image/webp',
    });
    setCaptureFlash(true);
    window.setTimeout(() => setCaptureFlash(false), 120);
    onCapture(file);
    closeCamera();
  };

  return (
    <>
      <button
        type="button"
        onClick={openCamera}
        disabled={disabled}
        className={clsx(
          'inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-semibold text-[var(--ink)] ring-1 ring-black/10 disabled:cursor-not-allowed disabled:opacity-60',
          className
        )}
      >
        <Camera className="h-4 w-4" />
        {buttonLabel}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4">
          <div className="grid max-h-[92vh] w-full max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl bg-slate-950 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-white/50">Camara QC</p>
                <h3 className="text-sm font-semibold">Tomar foto con marca de agua</h3>
              </div>
              <button
                type="button"
                onClick={closeCamera}
                className="rounded-full p-2 text-white/70 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="relative min-h-[360px] bg-black">
              {cameraError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                  <p className="text-sm text-red-300">{cameraError}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    Verifique permisos de camara o intente de nuevo.
                  </p>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center p-4">
                  <div className="relative h-full w-full max-w-4xl overflow-hidden rounded-xl border border-white/10 bg-black">
                    <video
                      ref={videoRef}
                      className="h-full w-full object-contain"
                      playsInline
                      muted
                      autoPlay
                    />
                    {captureFlash ? <div className="absolute inset-0 bg-white/70" /> : null}
                    <div className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 font-mono text-[11px] leading-snug text-white/90">
                      {watermarkLines(new Date()).map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </div>
                    {!cameraReady ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-white/70">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Preparando camara...
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
              <button
                type="button"
                onClick={closeCamera}
                className="rounded-full bg-slate-800 px-4 py-2 text-sm font-semibold text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleCapture()}
                disabled={!cameraReady || Boolean(cameraError)}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
              >
                <Camera className="h-4 w-4" />
                Tomar foto
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default QCPhotoCaptureButton;
