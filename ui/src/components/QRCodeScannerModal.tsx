import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';

type QRCodeScannerModalProps = {
  open: boolean;
  onClose: () => void;
  onDetected: (value: string) => void;
  variant?: 'modal' | 'background';
};

type DetectedBarcode = {
  rawValue?: string;
};

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>;
};

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const ROI_SCALE = 0.45;
const SCAN_INTERVAL_MS = 90;
const SUCCESS_COOLDOWN_MS = 1200;
const FLASH_DURATION_MS = 140;
const FULL_FRAME_INTERVAL = 8;
const USE_GRAYSCALE = false;

const QRCodeScannerModal: React.FC<QRCodeScannerModalProps> = ({
  open,
  onClose,
  onDetected,
  variant = 'modal',
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const scanningRef = useRef(false);
  const lastScanRef = useRef(0);
  const lastSuccessRef = useRef(0);
  const lastValueRef = useRef<string | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const flashTimeoutRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const frameCountRef = useRef(0);

  const [status, setStatus] = useState<'idle' | 'starting' | 'ready' | 'unsupported' | 'error'>(
    'idle'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastDetected, setLastDetected] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  const supportsBarcodeDetector = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return 'BarcodeDetector' in window;
  }, []);

  const stopScanner = useCallback(() => {
    activeRef.current = false;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (flashTimeoutRef.current !== null) {
      window.clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    detectorRef.current = null;
    scanningRef.current = false;
    lastScanRef.current = 0;
    lastSuccessRef.current = 0;
    lastValueRef.current = null;
    setStatus('idle');
    frameCountRef.current = 0;
  }, []);

  const playBeep = useCallback(() => {
    try {
      if (!audioRef.current || audioRef.current.state === 'closed') {
        audioRef.current = new AudioContext();
      }
      const context = audioRef.current;
      if (!context) {
        return;
      }
      if (context.state === 'suspended') {
        void context.resume();
      }
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.value = 0.0001;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
      oscillator.stop(context.currentTime + 0.2);
    } catch (error) {
      // Ignore audio failures; scanning should continue.
    }
  }, []);

  const handleSuccess = useCallback(
    (value: string) => {
      const now = performance.now();
      if (
        now - lastSuccessRef.current < SUCCESS_COOLDOWN_MS &&
        value === lastValueRef.current
      ) {
        return;
      }
      lastSuccessRef.current = now;
      lastValueRef.current = value;
      setLastDetected(value);
      onDetected(value);
      setFlash(true);
      playBeep();
      if (flashTimeoutRef.current !== null) {
        window.clearTimeout(flashTimeoutRef.current);
      }
      flashTimeoutRef.current = window.setTimeout(() => {
        setFlash(false);
      }, FLASH_DURATION_MS);
    },
    [onDetected, playBeep]
  );

  const scanFrame = useCallback(async () => {
    if (!activeRef.current || !videoRef.current || !canvasRef.current || !detectorRef.current) {
      return;
    }
    const now = performance.now();
    if (now - lastScanRef.current < SCAN_INTERVAL_MS || scanningRef.current) {
      animationFrameRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    lastScanRef.current = now;
    scanningRef.current = true;
    try {
      const video = videoRef.current;
      if (video.readyState < 2) {
        animationFrameRef.current = requestAnimationFrame(scanFrame);
        return;
      }
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        animationFrameRef.current = requestAnimationFrame(scanFrame);
        return;
      }
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      if (!videoWidth || !videoHeight) {
        animationFrameRef.current = requestAnimationFrame(scanFrame);
        return;
      }
      const size = Math.round(Math.min(videoWidth, videoHeight) * ROI_SCALE);
      const sourceX = Math.round((videoWidth - size) / 2);
      const sourceY = Math.round((videoHeight - size) / 2);
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size;
        canvas.height = size;
      }
      context.imageSmoothingEnabled = false;
      context.drawImage(video, sourceX, sourceY, size, size, 0, 0, size, size);
      if (USE_GRAYSCALE) {
        const imageData = context.getImageData(0, 0, size, size);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          data[i] = avg;
          data[i + 1] = avg;
          data[i + 2] = avg;
        }
        context.putImageData(imageData, 0, 0);
      }
      const results = await detectorRef.current.detect(canvas);
      const firstValue = results[0]?.rawValue?.trim();
      if (firstValue) {
        handleSuccess(firstValue);
      } else {
        frameCountRef.current += 1;
        if (frameCountRef.current % FULL_FRAME_INTERVAL === 0) {
          const fullResults = await detectorRef.current.detect(video);
          const fullValue = fullResults[0]?.rawValue?.trim();
          if (fullValue) {
            handleSuccess(fullValue);
          }
        }
      }
    } catch (error) {
      // Ignore transient decode errors.
    } finally {
      scanningRef.current = false;
      if (activeRef.current) {
        animationFrameRef.current = requestAnimationFrame(scanFrame);
      }
    }
  }, [handleSuccess]);

  const startScanner = useCallback(async () => {
    if (!open) {
      return;
    }
    if (!supportsBarcodeDetector) {
      setStatus('unsupported');
      setErrorMessage('BarcodeDetector no esta disponible en este dispositivo.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      setErrorMessage('El acceso a camara no es compatible en este navegador.');
      return;
    }
    setStatus('starting');
    setErrorMessage(null);
    try {
      const videoConstraints: MediaTrackConstraints = {
        facingMode: { ideal: 'user' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      };
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        throw new Error('Elemento de video no listo.');
      }
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          resolve();
        };
        video.addEventListener('loadedmetadata', onLoaded);
      });
      const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor })
        .BarcodeDetector;
      if (!Detector) {
        throw new Error('BarcodeDetector no esta disponible.');
      }
      detectorRef.current = new Detector({ formats: ['qr_code'] });
      setStatus('ready');
      animationFrameRef.current = requestAnimationFrame(scanFrame);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo iniciar el escaner de camara.';
      setStatus('error');
      setErrorMessage(message);
    }
  }, [open, scanFrame, supportsBarcodeDetector]);

  useEffect(() => {
    activeRef.current = open;
    if (!open) {
      stopScanner();
      return;
    }
    void startScanner();
    return () => {
      stopScanner();
    };
  }, [open, startScanner, stopScanner]);

  useEffect(() => {
    if (!open) {
      setLastDetected(null);
      setFlash(false);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  if (variant === 'background') {
    return (
      <div className="sr-only" aria-hidden="true">
        <video ref={videoRef} muted playsInline autoPlay />
        <canvas ref={canvasRef} />
      </div>
    );
  }

  const statusLabel = (() => {
    switch (status) {
      case 'starting':
        return 'Iniciando camara...';
      case 'ready':
        return 'Escaneando codigos QR';
      case 'unsupported':
        return 'Escaner no compatible';
      case 'error':
        return 'Error del escaner';
      default:
        return 'En espera';
    }
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-slate-900/70" onClick={onClose} />
      <div className="relative w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Escanear QR</h3>
            <p className="text-xs text-slate-500">
              Centra el codigo en el recuadro. El escaneo corre a 720p con cuadros limitados y barridos de cuadro completo.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              muted
              playsInline
              autoPlay
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[45%] w-[45%] rounded-2xl border-4 border-emerald-400/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.6)]" />
            </div>
            <div
              className={`pointer-events-none absolute inset-0 bg-emerald-400/25 transition-opacity duration-150 ${
                flash ? 'opacity-100' : 'opacity-0'
              }`}
            />
            <canvas ref={canvasRef} className="hidden" />
            {status !== 'ready' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/70 px-6 text-center text-sm text-slate-100">
                <Camera className="h-6 w-6 text-emerald-300" />
                <span className="font-semibold">{statusLabel}</span>
                {errorMessage && <span className="text-xs text-slate-300">{errorMessage}</span>}
              </div>
            )}
          </div>

          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Estado</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">{statusLabel}</div>
              {status === 'ready' && (
                <div className="mt-2 text-xs text-slate-500">
                  Procesando ROI central a ~10-12 fps con barridos de respaldo.
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Ultimo escaneo</div>
              <div className="mt-2 font-mono text-xs text-slate-900 break-all">
                {lastDetected ?? 'Aun no se detectan codigos.'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
              <div className="text-xs uppercase tracking-wide text-slate-500">Consejos</div>
              <p className="mt-2">
                Manten el QR nivelado y dentro del recuadro. Acercate si la deteccion es lenta.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
          <span className="text-xs text-slate-500">El destello verde + beep confirma un escaneo.</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
};

export default QRCodeScannerModal;
