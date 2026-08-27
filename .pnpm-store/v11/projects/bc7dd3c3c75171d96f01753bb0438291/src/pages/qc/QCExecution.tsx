import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Camera,
  Check,
  X,
  MessageSquare,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Flashlight,
  Image,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import './QCSystem.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const QC_ROLE_VALUES = new Set(['Calidad', 'QC']);

type QCFailureModeSummary = {
  id: number;
  check_definition_id: number | null;
  name: string;
  description: string | null;
  default_severity_level: 'baja' | 'media' | 'critica' | null;
  default_rework_description: string | null;
};

type QCCheckDefinitionSummary = {
  id: number;
  name: string;
  guidance_text: string | null;
  category_id: number | null;
};

type QCCheckInstanceSummary = {
  id: number;
  check_definition_id: number | null;
  check_name: string | null;
  ad_hoc_guidance: string | null;
  scope: 'panel' | 'module' | 'aux';
  work_unit_id: number;
  panel_unit_id: number | null;
  station_id: number | null;
  station_name: string | null;
  module_number: number;
  panel_code: string | null;
  status: 'Open' | 'Closed';
  opened_at: string;
};

type QCCheckMediaSummary = {
  id: number;
  media_type: 'guidance' | 'reference';
  uri: string;
  created_at: string | null;
};

type QCCheckInstanceDetail = {
  check_instance: QCCheckInstanceSummary;
  check_definition: QCCheckDefinitionSummary | null;
  failure_modes: QCFailureModeSummary[];
  media_assets: QCCheckMediaSummary[];
};

type ProductionQueueItemSummary = {
  id: number;
  project_name: string;
  house_identifier: string;
};

type QCReworkState = {
  id: number;
  check_instance_id: number;
  description: string;
  module_number: number;
  panel_code: string | null;
  station_name: string | null;
};

type QCStep = {
  id: string;
  title: string;
  desc: string;
  required: boolean;
  image?: string | null;
};

type EvidenceUploadStatus = 'pending' | 'uploading' | 'uploaded' | 'error';

type EvidenceItem = {
  url: string;
  id: string;
  type: 'image' | 'video';
  file: File;
  uploadId?: number;
  uploadStatus: EvidenceUploadStatus;
  uploadError?: string;
};

type QCEvidenceUploadResponse = {
  id: number;
  client_upload_id: string;
  uri: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

type TorchMediaTrackCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
};

type TorchMediaTrackConstraintSet = MediaTrackConstraintSet & {
  torch?: boolean;
};

const apiRequest = async <T,>(path: string): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(
      await responseErrorMessage(response, `Solicitud fallida (${response.status})`)
    );
  }
  return (await response.json()) as T;
};

const responseErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  const text = await response.text();
  if (!text) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === 'string') {
      return parsed.detail;
    }
  } catch {
    // Keep the server response when it is not JSON.
  }
  return text;
};

const apiJsonRequest = async <T,>(path: string, payload: unknown, method = 'POST'): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(
      await responseErrorMessage(response, `Solicitud fallida (${response.status})`)
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

const resolveMediaUri = (uri: string): string => {
  if (!uri) {
    return uri;
  }
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }
  if (uri.startsWith('/')) {
    return `${API_BASE_URL}${uri}`;
  }
  return `${API_BASE_URL}/${uri}`;
};

const severityLevelById: Record<string, 'baja' | 'media' | 'critica'> = {
  sev_baja: 'baja',
  sev_media: 'media',
  sev_critica: 'critica',
};

const severityRankById: Record<string, number> = {
  sev_baja: 0,
  sev_media: 1,
  sev_critica: 2,
};

const SEVERITY_LEVELS = [
  { id: 'sev_baja', name: 'Baja', color: 'bg-emerald-600 text-white' },
  { id: 'sev_media', name: 'Media', color: 'bg-amber-500 text-slate-900' },
  { id: 'sev_critica', name: 'Critica', color: 'bg-red-600 text-white' },
];

const MAX_VIDEO_DURATION_SECONDS = 120;
const MAX_VIDEO_EVIDENCE_BYTES = 50 * 1024 * 1024;
const VIDEO_RECORDING_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

const formatDuration = (seconds: number) => {
  const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  return `${mins}:${secs}`;
};

const getSupportedVideoRecordingMimeType = (): string | null => {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null;
  }
  return VIDEO_RECORDING_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? null;
};

const createEvidenceId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `qc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const QCExecution: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const checkIdParam = queryParams.get('check');
  const reworkIdParam = queryParams.get('rework');
  const reworkState = location.state?.rework as QCReworkState | undefined;
  const returnTo =
    typeof location.state?.returnTo === 'string' && location.state.returnTo.startsWith('/qc/')
      ? location.state.returnTo
      : '/qc';
  const checkId =
    Number(checkIdParam ?? location.state?.checkId ?? reworkState?.check_instance_id ?? 0) || null;

  const [checkDetail, setCheckDetail] = useState<QCCheckInstanceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [canExecute, setCanExecute] = useState(false);

  const [currentStep, setCurrentStep] = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  const [showFailModal, setShowFailModal] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [showEvidenceRequiredModal, setShowEvidenceRequiredModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [evidenceGateError, setEvidenceGateError] = useState<string | null>(null);
  const [captureMode, setCaptureMode] = useState<'photo' | 'video'>('photo');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingRecording, setIsProcessingRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const [refImageIndex, setRefImageIndex] = useState(0);
  const [guideImageIndex, setGuideImageIndex] = useState(0);

  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [notes, setNotes] = useState('');
  const [selectedFailureModeIds, setSelectedFailureModeIds] = useState<string[]>([]);
  const [selectedSeverityId, setSelectedSeverityId] = useState<string | null>(null);
  const [reworkText, setReworkText] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingMimeTypeRef = useRef<string | null>(null);
  const discardRecordingOnStopRef = useRef(false);
  const recordingIntervalRef = useRef<number | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [captureFlash, setCaptureFlash] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchError, setTorchError] = useState<string | null>(null);
  const refTouchState = useRef<{ startX: number; startY: number; tracking: boolean } | null>(null);
  const guideTouchState = useRef<{ startX: number; startY: number; tracking: boolean } | null>(null);
  const [workUnitMeta, setWorkUnitMeta] = useState<ProductionQueueItemSummary | null>(null);
  const [previewEvidenceId, setPreviewEvidenceId] = useState<string | null>(null);
  const evidenceUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const evidenceUrls = evidenceUrlsRef.current;
    return () => {
      if (recordingIntervalRef.current !== null) {
        window.clearInterval(recordingIntervalRef.current);
      }
      if (recordingTimeoutRef.current !== null) {
        window.clearTimeout(recordingTimeoutRef.current);
      }
      evidenceUrls.forEach((url) => URL.revokeObjectURL(url));
      evidenceUrls.clear();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const verifySession = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/admin/me`, {
          credentials: 'include',
        });
        if (!active) {
          return;
        }
        if (response.status === 401) {
          navigate('/qc', { replace: true, state: { blocked: 'qc-auth' } });
          return;
        }
        if (!response.ok) {
          throw new Error('No se pudo verificar la sesion de QC.');
        }
        const data = (await response.json()) as { role?: string };
        if (!data.role || !QC_ROLE_VALUES.has(data.role)) {
          navigate('/qc', { replace: true, state: { blocked: 'qc-auth' } });
          return;
        }
        setCanExecute(true);
      } catch {
        if (active) {
          navigate('/qc', { replace: true, state: { blocked: 'qc-auth' } });
        }
      } finally {
        if (active) {
          setAuthLoading(false);
        }
      }
    };
    void verifySession();
    return () => {
      active = false;
    };
  }, [navigate]);

  useEffect(() => {
    let isMounted = true;
    if (authLoading) {
      return () => {
        isMounted = false;
      };
    }
    if (!canExecute) {
      setLoading(false);
      return () => {
        isMounted = false;
      };
    }
    if (!checkId) {
      setLoading(false);
      return () => {
        isMounted = false;
      };
    }
    const loadDetail = async () => {
      try {
        const data = await apiRequest<QCCheckInstanceDetail>(`/api/qc/check-instances/${checkId}`);
        if (!isMounted) {
          return;
        }
        setCheckDetail(data);
        setErrorMessage(null);
      } catch (error) {
        if (!isMounted) {
          return;
        }
        const message = error instanceof Error ? error.message : 'No se pudo cargar la revision.';
        setErrorMessage(message);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    loadDetail();
    return () => {
      isMounted = false;
    };
  }, [authLoading, canExecute, checkId]);

  useEffect(() => {
    const workUnitId = checkDetail?.check_instance.work_unit_id;
    if (!workUnitId) {
      setWorkUnitMeta(null);
      return;
    }
    let active = true;
    const loadWorkUnitMeta = async () => {
      try {
        const items = await apiRequest<ProductionQueueItemSummary[]>('/api/production-queue');
        if (!active) {
          return;
        }
        const match = items.find((item) => item.id === workUnitId) ?? null;
        setWorkUnitMeta(match);
      } catch {
        if (active) {
          setWorkUnitMeta(null);
        }
      }
    };
    void loadWorkUnitMeta();
    return () => {
      active = false;
    };
  }, [checkDetail?.check_instance.work_unit_id]);

  const runtimeStep = useMemo<QCStep | null>(() => {
    if (!checkDetail?.check_definition && !checkDetail?.check_instance?.check_name) {
      return null;
    }
    return {
      id: 'runtime',
      title:
        checkDetail?.check_definition?.name ??
        checkDetail?.check_instance?.check_name ??
        'Revision QC',
      desc:
        checkDetail?.check_definition?.guidance_text ??
        checkDetail?.check_instance?.ad_hoc_guidance ??
        'Sin guia adicional.',
      required: true,
      image: null,
    };
  }, [
    checkDetail?.check_definition,
    checkDetail?.check_instance?.ad_hoc_guidance,
    checkDetail?.check_instance?.check_name,
  ]);

  const steps = useMemo<QCStep[]>(() => {
    return runtimeStep ? [runtimeStep] : [];
  }, [runtimeStep]);
  const currentStepData = steps[currentStep];

  const referenceImages = useMemo(() => {
    const runtimeRefs =
      checkDetail?.media_assets
        ?.filter((asset) => asset.media_type === 'reference')
        .map((asset) => resolveMediaUri(asset.uri)) ?? [];
    if (runtimeRefs.length) {
      return runtimeRefs;
    }
    return steps.map((step) => step.image).filter((img): img is string => !!img);
  }, [checkDetail?.media_assets, steps]);

  const guidanceImages = useMemo(() => {
    const runtimeGuides =
      checkDetail?.media_assets
        ?.filter((asset) => asset.media_type === 'guidance')
        .map((asset) => resolveMediaUri(asset.uri)) ?? [];
    if (runtimeGuides.length) {
      return runtimeGuides;
    }
    return [];
  }, [checkDetail?.media_assets]);

  const failureModes = useMemo(() => {
    if (checkDetail?.failure_modes?.length) {
      return checkDetail.failure_modes.map((mode) => {
        const severityId =
          mode.default_severity_level === 'critica'
            ? 'sev_critica'
            : mode.default_severity_level === 'media'
            ? 'sev_media'
            : mode.default_severity_level === 'baja'
            ? 'sev_baja'
            : 'sev_media';
        return {
          id: String(mode.id),
          name: mode.name,
          description: mode.description ?? '',
          defaultSeverityId: severityId,
          defaultReworkText: mode.default_rework_description ?? '',
        };
      });
    }
    return [];
  }, [checkDetail?.failure_modes]);

  const selectedFailureModes = useMemo(
    () =>
      selectedFailureModeIds
        .map((id) => failureModes.find((mode) => mode.id === id))
        .filter((mode): mode is (typeof failureModes)[number] => !!mode),
    [failureModes, selectedFailureModeIds]
  );

  const highestSeverityId = useMemo(() => {
    if (selectedFailureModes.length === 0) {
      return null;
    }
    return selectedFailureModes.reduce((highest, mode) => {
      if (!highest) {
        return mode.defaultSeverityId;
      }
      return severityRankById[mode.defaultSeverityId] > severityRankById[highest]
        ? mode.defaultSeverityId
        : highest;
    }, selectedFailureModes[0]?.defaultSeverityId ?? null);
  }, [selectedFailureModes]);

  const combinedDefaultReworkText = useMemo(() => {
    if (selectedFailureModes.length === 0) {
      return '';
    }
    const uniqueDefaults = Array.from(
      new Set(
        selectedFailureModes
          .map((mode) => mode.defaultReworkText.trim())
          .filter((text) => text.length > 0)
      )
    );
    return uniqueDefaults.join('\n\n');
  }, [selectedFailureModes]);

  useEffect(() => {
    if (selectedFailureModeIds.length === 0) {
      setReworkText('');
      return;
    }
    setReworkText(combinedDefaultReworkText);
  }, [combinedDefaultReworkText, selectedFailureModeIds.length]);

  useEffect(() => {
    if (failureModes.length === 0) {
      return;
    }
    if (selectedFailureModeIds.length === 0) {
      if (selectedSeverityId !== null) {
        setSelectedSeverityId(null);
      }
      return;
    }
    if (highestSeverityId && selectedSeverityId !== highestSeverityId) {
      setSelectedSeverityId(highestSeverityId);
    }
  }, [failureModes.length, highestSeverityId, selectedFailureModeIds.length, selectedSeverityId]);

  const headerModule =
    checkDetail?.check_instance.module_number ?? reworkState?.module_number ?? 'Manual';
  const headerStation =
    checkDetail?.check_instance.station_name ?? reworkState?.station_name ?? 'Sin estacion';
  const headerPanel =
    checkDetail?.check_instance.panel_code ?? reworkState?.panel_code ?? null;
  const headerTitle =
    checkDetail?.check_definition?.name ??
    checkDetail?.check_instance?.check_name ??
    'Revision QC';
  const headerProject = workUnitMeta?.project_name ?? 'Proyecto sin nombre';
  const headerHouse = workUnitMeta?.house_identifier ?? 'Sin identificar';
  const headerHouseLabel = `Casa ${headerHouse}`;

  const formatStampDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  };

  const formatStampTime = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const buildWatermarkLines = (date: Date) => {
    const parts: string[] = [];
    if (workUnitMeta?.project_name) {
      parts.push(workUnitMeta.project_name);
    }
    if (workUnitMeta?.house_identifier) {
      parts.push(`Casa ${workUnitMeta.house_identifier}`);
    }
    if (headerModule) {
      parts.push(`Modulo ${headerModule}`);
    }
    if (headerPanel) {
      parts.push(`Panel ${headerPanel}`);
    }
    const lines: string[] = [];
    if (parts.length > 0) {
      lines.push(parts.join(' · '));
    }
    if (headerTitle) {
      lines.push(headerTitle);
    }
    lines.push(`${formatStampDate(date)} ${formatStampTime(date)}`);
    return lines.filter(Boolean);
  };

  const clearRecordingTimers = useCallback(() => {
    if (recordingIntervalRef.current !== null) {
      window.clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    if (recordingTimeoutRef.current !== null) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
  }, []);

  const getCameraVideoTrack = useCallback(
    () => cameraStreamRef.current?.getVideoTracks()[0] ?? null,
    []
  );

  const canUseTorch = useCallback((track: MediaStreamTrack | null) => {
    const capabilities = track?.getCapabilities?.() as TorchMediaTrackCapabilities | undefined;
    return Boolean(capabilities?.torch);
  }, []);

  const applyTorch = async (enabled: boolean) => {
    const track = getCameraVideoTrack();
    if (!track || !canUseTorch(track)) {
      setTorchSupported(false);
      setTorchEnabled(false);
      setTorchError('Linterna no disponible en este dispositivo.');
      return;
    }

    try {
      await track.applyConstraints({
        advanced: [{ torch: enabled } as TorchMediaTrackConstraintSet],
      });
      setTorchSupported(true);
      setTorchEnabled(enabled);
      setTorchError(null);
    } catch {
      setTorchEnabled(false);
      setTorchError('No se pudo cambiar la linterna.');
    }
  };

  const stopCamera = useCallback((discardRecording = false) => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      discardRecordingOnStopRef.current = discardRecording;
      recorder.stop();
    }
    clearRecordingTimers();
    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
    recordingMimeTypeRef.current = null;
    setIsRecording(false);
    setRecordingSeconds(0);
    if (cameraStreamRef.current) {
      const track = getCameraVideoTrack();
      if (canUseTorch(track)) {
        void track?.applyConstraints({
          advanced: [{ torch: false } as TorchMediaTrackConstraintSet],
        });
      }
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    setTorchSupported(false);
    setTorchEnabled(false);
    setTorchError(null);
  }, [canUseTorch, clearRecordingTimers, getCameraVideoTrack]);

  useEffect(() => {
    if (!showCamera || previewEvidenceId) {
      stopCamera();
      setCameraReady(false);
      setCameraError(null);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Este navegador no soporta camara.');
      setCameraReady(false);
      return;
    }
    let active = true;
    const startCamera = async () => {
        setCameraError(null);
        setCameraReady(false);
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
        cameraStreamRef.current = stream;
        const track = stream.getVideoTracks()[0] ?? null;
        setTorchSupported(canUseTorch(track));
        setTorchEnabled(false);
        setTorchError(null);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraReady(true);
      } catch (error) {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : 'No se pudo abrir la camara.';
        setCameraError(message);
        setCameraReady(false);
      }
    };
    void startCamera();
    return () => {
      active = false;
      stopCamera(true);
    };
  }, [canUseTorch, previewEvidenceId, showCamera, stopCamera]);

  const handleCameraCapture = async () => {
    if (isRecording || isProcessingRecording) {
      return;
    }
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
    const watermarkLines = buildWatermarkLines(stampDate);
    if (watermarkLines.length > 0) {
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
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.9)
    );
    if (!blob) {
      setCameraError('No se pudo capturar la foto.');
      return;
    }
    const fileName = `qc-${checkId ?? 'check'}-${Date.now()}.webp`;
    const file = new File([blob], fileName, { type: blob.type || 'image/webp' });
    const url = URL.createObjectURL(blob);
    evidenceUrlsRef.current.add(url);
    setEvidence((prev) => [
      ...prev,
      {
        id: createEvidenceId(),
        url,
        type: 'image',
        file,
        uploadStatus: 'pending',
      },
    ]);
    setCaptureFlash(true);
    window.setTimeout(() => setCaptureFlash(false), 160);
    setEvidenceGateError(null);
    setActionError(null);
  };

  const videoRecordingMimeType = getSupportedVideoRecordingMimeType();

  const stopVideoRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return;
    }
    recorder.stop();
  };

  const addEvidenceFiles = (files: File[]) => {
    const acceptedFiles = files.filter(
      (file) => file.type.startsWith('image/') || file.type.startsWith('video/')
    );
    if (!acceptedFiles.length) {
      setEvidenceGateError('Seleccione una foto o video valido.');
      setActionError('Seleccione una foto o video valido.');
      return;
    }

    const oversized = acceptedFiles.find((file) => file.size > MAX_VIDEO_EVIDENCE_BYTES);
    if (oversized) {
      const message = `"${oversized.name}" excede 50 MB.`;
      setEvidenceGateError(message);
      setActionError(message);
      return;
    }

    const items = acceptedFiles.map((file): EvidenceItem => {
      const type: EvidenceItem['type'] = file.type.startsWith('video/') ? 'video' : 'image';
      const url = URL.createObjectURL(file);
      evidenceUrlsRef.current.add(url);
      return {
        id: createEvidenceId(),
        url,
        type,
        file,
        uploadStatus: 'pending',
      };
    });

    setEvidence((prev) => [...prev, ...items]);
    setEvidenceGateError(null);
    setActionError(null);
  };

  const startVideoRecording = () => {
    if (!cameraStreamRef.current) {
      setCameraError('La camara aun no esta lista.');
      return;
    }
    if (!videoRecordingMimeType) {
      setCameraError('Este navegador no soporta grabacion de video.');
      return;
    }
    if (isProcessingRecording) {
      return;
    }
    try {
      const recorder = new MediaRecorder(cameraStreamRef.current, {
        mimeType: videoRecordingMimeType,
      });
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recordingMimeTypeRef.current = videoRecordingMimeType;
      discardRecordingOnStopRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        clearRecordingTimers();
        setIsRecording(false);
        setRecordingSeconds(0);
        setCameraError('No se pudo grabar el video.');
      };

      recorder.onstop = () => {
        clearRecordingTimers();
        setIsRecording(false);
        setRecordingSeconds(0);

        if (discardRecordingOnStopRef.current) {
          discardRecordingOnStopRef.current = false;
          recordingChunksRef.current = [];
          recordingMimeTypeRef.current = null;
          return;
        }

        setIsProcessingRecording(true);
        const blob = new Blob(recordingChunksRef.current, {
          type: recordingMimeTypeRef.current || recorder.mimeType || 'video/webm',
        });
        recordingChunksRef.current = [];
        recordingMimeTypeRef.current = null;

        if (!blob.size) {
          setCameraError('No se pudo guardar el video.');
          setIsProcessingRecording(false);
          return;
        }
        if (blob.size > MAX_VIDEO_EVIDENCE_BYTES) {
          setCameraError('El video excede 50 MB. Grabe un clip mas corto.');
          setIsProcessingRecording(false);
          return;
        }

        const fileExtension =
          blob.type.includes('mp4') || recorder.mimeType.includes('mp4') ? '.mp4' : '.webm';
        const fileName = `qc-${checkId ?? 'check'}-${Date.now()}${fileExtension}`;
        const file = new File([blob], fileName, { type: blob.type || recorder.mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        const evidenceId = createEvidenceId();

        evidenceUrlsRef.current.add(url);
        setEvidence((prev) => [
          ...prev,
          {
            id: evidenceId,
            url,
            type: 'video',
            file,
            uploadStatus: 'pending',
          },
        ]);
        setPreviewEvidenceId(evidenceId);
        setEvidenceGateError(null);
        setActionError(null);
        setIsProcessingRecording(false);
      };

      recorder.start(1000);
      setCameraError(null);
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingIntervalRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= MAX_VIDEO_DURATION_SECONDS) {
            return MAX_VIDEO_DURATION_SECONDS;
          }
          return prev + 1;
        });
      }, 1000);
      recordingTimeoutRef.current = window.setTimeout(() => {
        stopVideoRecording();
      }, MAX_VIDEO_DURATION_SECONDS * 1000);
    } catch {
      setCameraError('No se pudo iniciar la grabacion.');
    }
  };

  const evidenceRequiredForOutcome = (outcome: 'Pass' | 'Fail' | 'Skip' | 'Waive') =>
    outcome === 'Pass' || outcome === 'Fail';

  const updateEvidenceUploadState = (
    id: string,
    patch: Partial<Pick<EvidenceItem, 'uploadId' | 'uploadStatus' | 'uploadError'>>
  ) => {
    setEvidence((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const stageEvidenceItem = async (item: EvidenceItem): Promise<number> => {
    if (!checkId) {
      throw new Error('No se encontro la revision para subir el registro.');
    }
    if (item.uploadId) {
      return item.uploadId;
    }

    updateEvidenceUploadState(item.id, {
      uploadStatus: 'uploading',
      uploadError: undefined,
    });
    const formData = new FormData();
    formData.append('client_upload_id', item.id);
    formData.append('file', item.file);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/qc/check-instances/${checkId}/evidence-uploads`,
        {
          method: 'POST',
          credentials: 'include',
          body: formData,
        }
      );
      if (!response.ok) {
        throw new Error(
          await responseErrorMessage(
            response,
            `No se pudo subir registro (${response.status})`
          )
        );
      }
      const uploaded = (await response.json()) as QCEvidenceUploadResponse;
      updateEvidenceUploadState(item.id, {
        uploadId: uploaded.id,
        uploadStatus: 'uploaded',
        uploadError: undefined,
      });
      return uploaded.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo subir el registro.';
      updateEvidenceUploadState(item.id, {
        uploadStatus: 'error',
        uploadError: message,
      });
      throw new Error(message);
    }
  };

  const stageEvidenceUploads = async (): Promise<number[]> => {
    const uploadIds: number[] = [];
    for (const item of evidence) {
      uploadIds.push(await stageEvidenceItem(item));
    }
    return uploadIds;
  };

  const retryEvidenceItem = async (id: string) => {
    const item = evidence.find((candidate) => candidate.id === id);
    if (!item || item.uploadStatus === 'uploading') {
      return;
    }
    setActionError(null);
    try {
      await stageEvidenceItem(item);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo subir el registro.');
    }
  };

  const executeCheck = async (outcome: 'Pass' | 'Fail' | 'Skip' | 'Waive') => {
    if (!checkId) {
      setActionError('No se encontro la revision para completar.');
      return;
    }
    if (isSubmitting) {
      return;
    }
    if (evidenceRequiredForOutcome(outcome) && evidence.length === 0) {
      const message = 'Agregue registro antes de aprobar o fallar esta revision.';
      setEvidenceGateError(message);
      setActionError(message);
      setShowEvidenceRequiredModal(true);
      return;
    }
    if (outcome === 'Fail' && failureModes.length > 0 && selectedFailureModeIds.length === 0) {
      setActionError('Seleccione al menos un modo de falla antes de confirmar.');
      return;
    }
    setIsSubmitting(true);
    setActionError(null);
    try {
      const severity =
        outcome === 'Fail' && selectedSeverityId
          ? severityLevelById[selectedSeverityId]
          : undefined;
      if (outcome === 'Fail' && !severity) {
        setActionError('Seleccione una severidad antes de confirmar.');
        return;
      }
      const failureIds =
        outcome === 'Fail'
          ? selectedFailureModeIds
              .map((value) => Number(value))
              .filter((value) => !Number.isNaN(value))
          : [];
      const evidenceUploadIds = await stageEvidenceUploads();
      const payload = {
        outcome,
        notes: notes.trim() || null,
        severity_level: outcome === 'Fail' ? severity : null,
        failure_mode_ids: failureIds,
        rework_description: outcome === 'Fail' ? reworkText.trim() || null : null,
        evidence_upload_ids: evidenceUploadIds,
      };
      await apiJsonRequest<{ id: number }>(
        `/api/qc/check-instances/${checkId}/execute`,
        payload
      );
      navigate(returnTo);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo completar la revision.';
      setActionError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePass = () => {
    if (isSubmitting) {
      return;
    }
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
      if (referenceImages.length > 0) {
        setRefImageIndex(Math.min(currentStep + 1, referenceImages.length - 1));
      }
    } else {
      void executeCheck('Pass');
    }
  };

  const handleFailSubmit = () => {
    if (evidence.length === 0) {
      const message = 'Agregue registro antes de registrar una falla.';
      setEvidenceGateError(message);
      setActionError(message);
      setShowEvidenceRequiredModal(true);
      return;
    }
    setShowFailModal(false);
    void executeCheck('Fail');
  };

  const closeCamera = () => {
    if (isRecording || isProcessingRecording) {
      return;
    }
    setShowCamera(false);
    setCameraError(null);
    setPreviewEvidenceId(null);
  };

  const openRegistroCamera = () => {
    setShowCamera(true);
    setCameraError(null);
  };

  const removeEvidenceItem = async (id: string) => {
    const target = evidence.find((item) => item.id === id);
    if (!target || target.uploadStatus === 'uploading') {
      return;
    }
    if (target.uploadId) {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/qc/evidence-uploads/${target.uploadId}`,
          { method: 'DELETE', credentials: 'include' }
        );
        if (!response.ok && response.status !== 404) {
          setActionError(
            await responseErrorMessage(response, 'No se pudo eliminar el registro subido.')
          );
          return;
        }
      } catch {
        setActionError('No se pudo eliminar el registro subido. Revise la conexion.');
        return;
      }
    }
    if (target.url) {
      URL.revokeObjectURL(target.url);
      evidenceUrlsRef.current.delete(target.url);
    }
    setEvidence((prev) => prev.filter((item) => item.id !== id));
    if (previewEvidenceId === id) {
      setPreviewEvidenceId(null);
    }
  };

  const handleTouchStart =
    (stateRef: React.MutableRefObject<{ startX: number; startY: number; tracking: boolean } | null>) =>
    (event: React.TouchEvent) => {
      const touch = event.touches[0];
      stateRef.current = { startX: touch.clientX, startY: touch.clientY, tracking: true };
    };

  const handleTouchEnd =
    (
      stateRef: React.MutableRefObject<{ startX: number; startY: number; tracking: boolean } | null>,
      onPrev: () => void,
      onNext: () => void
    ) =>
    (event: React.TouchEvent) => {
      const state = stateRef.current;
      if (!state?.tracking) {
        return;
      }
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - state.startX;
      const deltaY = touch.clientY - state.startY;
      stateRef.current = null;
      if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY)) {
        return;
      }
      if (deltaX > 0) {
        onPrev();
      } else {
        onNext();
      }
    };

  const canSubmitFail =
    !!selectedSeverityId &&
    (failureModes.length === 0 || selectedFailureModeIds.length > 0);
  const previewEvidence = previewEvidenceId
    ? evidence.find((item) => item.id === previewEvidenceId) ?? null
    : null;

  const nextRefImage = () => setRefImageIndex((i) => (i + 1) % referenceImages.length);
  const prevRefImage = () =>
    setRefImageIndex((i) => (i - 1 + referenceImages.length) % referenceImages.length);
  const nextGuideImage = () => setGuideImageIndex((i) => (i + 1) % guidanceImages.length);
  const prevGuideImage = () =>
    setGuideImageIndex((i) => (i - 1 + guidanceImages.length) % guidanceImages.length);

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 text-white">
        Verificando sesion...
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 text-white">
        Cargando revision...
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 text-white">
        {errorMessage}
      </div>
    );
  }

  if (!checkDetail && !reworkIdParam) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 text-white">
        Revision no encontrada.
      </div>
    );
  }

  return (
    <div className="qc-execution flex flex-col overflow-hidden text-white">
      {/* Minimal Header */}
      <header className="qc-execution__header flex items-center px-4 py-2">
        <div className="min-w-0">
          <div className="qc-execution__context-primary truncate">
            {headerProject}
            <span className="mx-2">•</span>
            {headerHouseLabel}
          </div>
          <div className="qc-execution__context-secondary truncate">
            <span className="font-semibold text-white">{headerModule}</span>
            <span className="mx-2">•</span>
            <span>
              {headerStation}
              {headerPanel ? ` · Panel ${headerPanel}` : ''}
            </span>
            {steps.length > 0 && (
              <>
                <span className="mx-2">•</span>
                <span>
                  Paso {currentStep + 1}/{steps.length}
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content: Two Carousels Side by Side */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Reference Images Carousel */}
        <div
          className="qc-execution__viewer relative flex min-h-[30vh] flex-1 items-center justify-center lg:min-h-0"
          onTouchStart={
            referenceImages.length > 1 ? handleTouchStart(refTouchState) : undefined
          }
          onTouchEnd={
            referenceImages.length > 1
              ? handleTouchEnd(refTouchState, prevRefImage, nextRefImage)
              : undefined
          }
        >
          <div className="qc-execution__viewer-label">
            Referencia
          </div>

          {referenceImages.length > 0 ? (
            <>
              <img
                src={referenceImages[refImageIndex]}
                alt="Referencia"
                className="max-w-full max-h-full object-contain p-4"
              />

              {referenceImages.length > 1 && (
                <>
                  <button
                    onClick={prevRefImage}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={nextRefImage}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {referenceImages.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setRefImageIndex(i)}
                        className={`w-2 h-2 rounded-full transition-colors ${
                          i === refImageIndex ? 'bg-white' : 'bg-white/40'
                        }`}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="text-slate-500 flex flex-col items-center">
              <Image className="w-12 h-12 mb-2 opacity-50" />
              <span className="text-sm">Sin imagen de referencia</span>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="hidden lg:block w-px bg-slate-700" />
        <div className="lg:hidden h-px bg-slate-700" />

        {/* Guidance Images Carousel */}
        <div
          className="qc-execution__viewer qc-execution__viewer--secondary relative flex min-h-[30vh] flex-1 items-center justify-center lg:min-h-0"
          onTouchStart={guidanceImages.length > 1 ? handleTouchStart(guideTouchState) : undefined}
          onTouchEnd={
            guidanceImages.length > 1
              ? handleTouchEnd(guideTouchState, prevGuideImage, nextGuideImage)
              : undefined
          }
        >
          <div className="qc-execution__viewer-label qc-execution__viewer-label--guide">
            Guía visual
          </div>

          {guidanceImages.length > 0 ? (
            <>
              <img
                src={guidanceImages[guideImageIndex]}
                alt="Guia"
                className="max-w-full max-h-full object-contain p-4"
              />

              {guidanceImages.length > 1 && (
                <>
                  <button
                    onClick={prevGuideImage}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={nextGuideImage}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {guidanceImages.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setGuideImageIndex(i)}
                        className={`w-2 h-2 rounded-full transition-colors ${
                          i === guideImageIndex ? 'bg-white' : 'bg-white/40'
                        }`}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="text-slate-500 flex flex-col items-center">
              <Image className="w-12 h-12 mb-2 opacity-50" />
              <span className="text-sm">Sin guia visual</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Panel: Description + Actions */}
      <div className="qc-execution__panel">
        {/* Description */}
        <div className="qc-execution__description px-4 py-3">
          <h2 className="text-lg font-bold text-white">{currentStepData?.title || headerTitle}</h2>
          <p className="text-sm text-slate-300 mt-1">
            {currentStepData?.desc || 'Sin guia adicional.'}
          </p>
          <div className="qc-execution__facts mt-3">
            <span className="qc-execution__fact">Proyecto · {headerProject}</span>
            <span className="qc-execution__fact">Casa · {headerHouse}</span>
            <span className="qc-execution__fact">
              Módulo · {headerModule}
            </span>
            {headerPanel && (
              <span className="qc-execution__fact">Panel · {headerPanel}</span>
            )}
            <span className="qc-execution__fact">
              Estación · {headerStation}
            </span>
          </div>
          {reworkState && (
            <p className="text-xs text-slate-400 mt-2">Estado: {reworkState.description}</p>
          )}
          {actionError && (
            <p className="mt-2 rounded-lg border border-red-500/40 bg-red-900/30 px-3 py-2 text-xs text-red-200">
              {actionError}
            </p>
          )}
        </div>

        {evidence.length > 0 && (
          <div className="qc-execution__evidence-rail">
            <div className="qc-execution__evidence-label">
              Registros <span>{evidence.length}</span>
            </div>
            <div className="qc-execution__evidence-list">
              {evidence.map((item, index) => (
                <div key={item.id} className="qc-execution__evidence-item">
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewEvidenceId(item.id);
                      openRegistroCamera();
                    }}
                    className="qc-execution__evidence-preview"
                    aria-label={`Abrir registro ${index + 1}`}
                  >
                    {item.type === 'video' ? (
                      <video src={item.url} className="h-full w-full object-cover" />
                    ) : (
                      <img src={item.url} alt="" className="h-full w-full object-cover" />
                    )}
                    <span
                      className={`qc-execution__upload-state qc-execution__upload-state--${item.uploadStatus}`}
                    >
                      {item.uploadStatus === 'uploading' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : item.uploadStatus === 'uploaded' ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : item.uploadStatus === 'error' ? (
                        '!'
                      ) : (
                        index + 1
                      )}
                    </span>
                  </button>
                  <div className="qc-execution__evidence-controls">
                    {item.uploadStatus === 'error' && (
                      <button
                        type="button"
                        onClick={() => void retryEvidenceItem(item.id)}
                        aria-label={`Reintentar registro ${index + 1}`}
                        title={item.uploadError ?? 'Reintentar carga'}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void removeEvidenceItem(item.id)}
                      disabled={item.uploadStatus === 'uploading' || isSubmitting}
                      aria-label={`Eliminar registro ${index + 1}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions Row */}
        <div className="qc-execution__actions flex items-center justify-between gap-3 p-3">
          {/* Left: Tools */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(returnTo)}
              disabled={isSubmitting}
              className="qc-execution__tool"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Volver</span>
            </button>
            <button
              type="button"
              onClick={openRegistroCamera}
              disabled={isSubmitting}
              className="qc-execution__tool"
            >
              <Camera className="w-4 h-4" />
              <span className="hidden sm:inline">Registro</span>
              {evidence.length === 0 && evidenceGateError && (
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400" aria-hidden="true" />
              )}
            </button>
            <label className="qc-execution__tool cursor-pointer">
              <Image className="w-4 h-4" />
              <span className="hidden sm:inline">Galeria</span>
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                disabled={isSubmitting}
                onChange={(event) => {
                  const files = event.target.files ? Array.from(event.target.files) : [];
                  event.target.value = '';
                  addEvidenceFiles(files);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => setShowNotesModal(true)}
              disabled={isSubmitting}
              className={`qc-execution__tool ${notes ? 'border-blue-400 bg-blue-800' : ''}`}
            >
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">Nota</span>
            </button>

          </div>

          {/* Right: Main Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFailModal(true)}
              disabled={isSubmitting}
              className="qc-execution__action qc-execution__action--fail"
            >
              <X className="w-5 h-5" />
              <span>Fallar</span>
            </button>
            <button
              onClick={handlePass}
              disabled={isSubmitting}
              className="qc-execution__action qc-execution__action--pass"
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Check className="w-5 h-5" />
              )}
              <span>
                {isSubmitting
                  ? 'Guardando...'
                  : currentStep < steps.length - 1
                    ? 'Siguiente'
                    : 'Finalizar'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* --- Modals --- */}

      {/* Evidence Required Modal */}
      {showEvidenceRequiredModal && (
        <div className="qc-execution__modal-layer z-[60]">
          <div className="qc-execution__modal-card w-full max-w-md overflow-hidden border border-slate-700 bg-slate-800 shadow-2xl">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center">
              <div className="flex items-center gap-2 text-amber-300">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="font-bold text-white">Registro requerido</h3>
              </div>
              <button
                onClick={() => setShowEvidenceRequiredModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <p className="text-sm text-slate-200">
                {evidenceGateError ?? 'Agregue registro antes de continuar.'}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Adjunte una foto o video para poder cerrar la revision.
              </p>
            </div>
            <div className="p-4 bg-slate-900/50 flex justify-end gap-3">
              <button
                onClick={() => setShowEvidenceRequiredModal(false)}
                className="px-4 py-2 text-slate-300 font-semibold hover:bg-slate-700 rounded-lg"
              >
                Volver
              </button>
              <button
                onClick={() => {
                  setShowEvidenceRequiredModal(false);
                  openRegistroCamera();
                }}
                className="px-4 py-2 bg-amber-500 text-slate-900 font-semibold rounded-lg hover:bg-amber-400"
              >
                Abrir camara
              </button>
              <label className="cursor-pointer rounded-lg bg-slate-700 px-4 py-2 font-semibold text-slate-100 hover:bg-slate-600">
                Desde galeria
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = event.target.files ? Array.from(event.target.files) : [];
                    event.target.value = '';
                    addEvidenceFiles(files);
                    setShowEvidenceRequiredModal(false);
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Camera Overlay */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-900/90 border-b border-slate-800">
            <div className="text-sm text-slate-200 font-semibold">
              Registro {captureMode === 'video' ? 'de video' : 'fotografico'}
            </div>
          </div>
          <div className="flex-1 relative bg-slate-950">
            {cameraError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                <p className="text-red-300 text-sm">{cameraError}</p>
                <p className="text-xs text-slate-400 mt-2">
                  Verifique permisos de camara o intente de nuevo.
                </p>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center px-4 py-6">
                <div className="h-full w-full max-w-4xl border border-white/10 relative overflow-hidden rounded-xl bg-black">
                  <video
                    ref={videoRef}
                    className="h-full w-full object-contain"
                    playsInline
                    muted
                    autoPlay
                  />
                  {captureFlash && <div className="absolute inset-0 bg-white/70" />}
                  <div className="absolute bottom-3 left-3 text-[11px] text-white/90 font-mono bg-black/60 px-2 py-1 rounded leading-snug">
                    {buildWatermarkLines(new Date()).map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                  {captureMode === 'video' && (
                    <div className="absolute top-3 right-3 rounded-full bg-black/60 px-3 py-1 text-[11px] font-semibold text-white">
                      {isRecording
                        ? `Grabando ${formatDuration(recordingSeconds)} / ${formatDuration(MAX_VIDEO_DURATION_SECONDS)}`
                        : `Max ${formatDuration(MAX_VIDEO_DURATION_SECONDS)}`}
                    </div>
                  )}
                  {torchError && (
                    <div className="absolute top-3 left-3 rounded-full bg-black/70 px-3 py-1 text-[11px] font-semibold text-amber-100">
                      {torchError}
                    </div>
                  )}
                </div>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
            {previewEvidence && (
              <div className="absolute inset-0 z-20 grid grid-rows-[minmax(0,1fr)_auto] bg-black/90">
                <div className="flex min-h-0 items-center justify-center overflow-hidden p-4">
                  {previewEvidence.type === 'video' ? (
                    <video src={previewEvidence.url} controls className="max-h-full max-w-full" />
                  ) : (
                    <img src={previewEvidence.url} alt="Registro" className="max-h-full max-w-full" />
                  )}
                </div>
                <div className="qc-execution__camera-preview-actions">
                  <button
                    onClick={() => setPreviewEvidenceId(null)}
                    className="rounded-full bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-700"
                  >
                    Volver
                  </button>
                  <button
                    onClick={() => void removeEvidenceItem(previewEvidence.id)}
                    disabled={previewEvidence.uploadStatus === 'uploading' || isSubmitting}
                    className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            )}
            {!cameraError && (
              <>
                {evidence.length > 0 && (
                  <div className="absolute bottom-28 left-4 right-4 flex items-center gap-3 overflow-x-auto pb-2">
                    {evidence.map((item) => (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setPreviewEvidenceId(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setPreviewEvidenceId(item.id);
                          }
                        }}
                        className="relative w-16 h-16 rounded-lg border border-slate-700 overflow-hidden shrink-0"
                      >
                        {item.type === 'video' ? (
                          <video src={item.url} className="w-full h-full object-cover" />
                        ) : (
                          <img src={item.url} alt="Registro" className="w-full h-full object-cover" />
                        )}
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void removeEvidenceItem(item.id);
                          }}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] flex items-center justify-center"
                          aria-label="Eliminar registro"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="qc-execution__camera-controls">
                  <button
                    type="button"
                    onClick={() => setCaptureMode('photo')}
                    disabled={isRecording || isProcessingRecording}
                    className={`qc-execution__camera-mode ${
                      captureMode === 'photo' ? 'qc-execution__camera-mode--active' : ''
                    }`}
                  >
                    Foto
                  </button>
                  <button
                    type="button"
                    onClick={() => setCaptureMode('video')}
                    disabled={!videoRecordingMimeType || isRecording || isProcessingRecording}
                    className={`qc-execution__camera-mode ${
                      captureMode === 'video' ? 'qc-execution__camera-mode--record' : ''
                    }`}
                  >
                    Video
                  </button>
                  <button
                    type="button"
                    onClick={() => void applyTorch(!torchEnabled)}
                    disabled={!cameraReady || !torchSupported}
                    title={
                      torchSupported
                        ? torchEnabled
                          ? 'Apagar linterna'
                          : 'Encender linterna'
                        : 'Linterna no disponible'
                    }
                    className={`qc-execution__camera-mode ${
                      torchEnabled ? 'qc-execution__camera-mode--torch' : ''
                    }`}
                  >
                    <Flashlight className="h-4 w-4" />
                    <span className="hidden sm:inline">Linterna</span>
                  </button>
                  <div className="hidden sm:block text-right text-xs text-slate-300">
                    {captureMode === 'video' ? (
                      <>
                        <div>Videos sin audio</div>
                        <div className="text-slate-400">Hasta 2 min por video</div>
                      </>
                    ) : (
                      <>
                        <div>Foto instantanea</div>
                        <div className="text-slate-400">Combine fotos y varios videos</div>
                      </>
                    )}
                  </div>
                  <button
                    onClick={closeCamera}
                    disabled={isRecording || isProcessingRecording}
                    className="px-4 py-2 rounded-full bg-emerald-500 text-slate-900 font-semibold hover:bg-emerald-400"
                  >
                    Listo
                  </button>
                  {captureMode === 'photo' ? (
                    <button
                      onClick={handleCameraCapture}
                      disabled={!cameraReady || isProcessingRecording}
                      className={`w-20 h-20 rounded-full border-4 flex items-center justify-center transition-transform ${
                        cameraReady && !isProcessingRecording
                          ? 'border-white hover:scale-105'
                          : 'border-slate-600 opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <div
                        className={`w-16 h-16 rounded-full ${
                          cameraReady && !isProcessingRecording ? 'bg-white' : 'bg-slate-600'
                        }`}
                      />
                    </button>
                  ) : (
                    <button
                      onClick={isRecording ? stopVideoRecording : startVideoRecording}
                      disabled={
                        !cameraReady ||
                        isProcessingRecording ||
                        !videoRecordingMimeType
                      }
                      className={`w-20 h-20 rounded-full border-4 flex items-center justify-center transition-transform ${
                        cameraReady &&
                        !isProcessingRecording &&
                        !!videoRecordingMimeType
                          ? 'border-red-400 hover:scale-105'
                          : 'border-slate-600 opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <div
                        className={`${
                          isRecording
                            ? 'h-7 w-7 rounded-md bg-red-500'
                            : 'h-16 w-16 rounded-full bg-red-500'
                        }`}
                      />
                    </button>
                  )}
                </div>
              </>
            )}
            {cameraError && (
              <div className="qc-execution__camera-error-actions">
                <button type="button" onClick={closeCamera}>
                  Volver a la revision
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Notes Modal */}
      {showNotesModal && (
        <div className="qc-execution__modal-layer z-50">
          <div className="qc-execution__modal-card w-full max-w-lg overflow-hidden border border-slate-700 bg-slate-800 shadow-2xl">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center">
              <h3 className="font-bold text-white">Agregar nota</h3>
              <button onClick={() => setShowNotesModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <textarea
                className="w-full h-32 bg-slate-900 border border-slate-600 rounded-lg p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                placeholder="Escribe los detalles de observacion aqui..."
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                autoFocus
              />
            </div>
            <div className="p-4 bg-slate-900/50 flex justify-end">
              <button
                onClick={() => setShowNotesModal(false)}
                className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700"
              >
                Guardar nota
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Failure Mode Modal */}
      {showFailModal && (
        <div className="qc-execution__modal-layer z-50">
          <div className="qc-execution__modal-card flex max-h-[90dvh] w-full max-w-lg flex-col border border-slate-700 bg-slate-800 shadow-2xl">
            <div className="p-4 border-b border-slate-700 bg-red-900/30 flex justify-between items-center rounded-t-xl">
              <div className="flex items-center text-red-400">
                <AlertTriangle className="w-5 h-5 mr-2" />
                <h3 className="font-bold">Registrar falla</h3>
              </div>
              <button onClick={() => setShowFailModal(false)} className="text-red-400 hover:text-red-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto">
              {evidence.length === 0 && (
                <div className="mb-5 rounded-lg border border-amber-500/40 bg-amber-900/20 px-3 py-2">
                  <p className="text-xs text-amber-200">
                    Adjunte evidencia antes de confirmar la falla.
                  </p>
                  <button
                    onClick={openRegistroCamera}
                    className="mt-2 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-400"
                  >
                    <Camera className="w-4 h-4" />
                    Abrir camara
                  </button>
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-bold text-slate-300 mb-2">Modos de falla</label>
                {failureModes.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    Sin modos de falla configurados para esta revision.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {failureModes.map((mode) => (
                      <label
                        key={mode.id}
                        className={`flex items-start p-3 border rounded-lg cursor-pointer transition-all ${
                          selectedFailureModeIds.includes(mode.id)
                            ? 'border-red-500 bg-red-900/30 ring-1 ring-red-500'
                            : 'border-slate-600 hover:border-slate-500 bg-slate-900/50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          name={`failureMode-${mode.id}`}
                          className="mt-1 mr-3 text-red-600 focus:ring-red-500"
                          checked={selectedFailureModeIds.includes(mode.id)}
                          onChange={() => {
                            setSelectedFailureModeIds((prev) => {
                              if (prev.includes(mode.id)) {
                                return prev.filter((id) => id !== mode.id);
                              }
                              return [...prev, mode.id];
                            });
                          }}
                        />
                        <div>
                          <div className="font-semibold text-white">{mode.name}</div>
                          <div className="text-xs text-slate-400">{mode.description}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {(failureModes.length === 0 || selectedFailureModeIds.length > 0) && (
                <div className="mb-6">
                  <label className="block text-sm font-bold text-slate-300 mb-2">Severidad</label>
                  <div className="flex flex-wrap gap-2">
                    {SEVERITY_LEVELS.map((sev) => (
                      <button
                        key={sev.id}
                        onClick={() => setSelectedSeverityId(sev.id)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                          selectedSeverityId === sev.id
                            ? `${sev.color} border-current ring-1 ring-current`
                            : 'bg-slate-900 text-slate-400 border-slate-600 hover:bg-slate-700'
                        }`}
                      >
                        {sev.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-bold text-slate-300 mb-2">
                  Instrucciones de retrabajo
                </label>
                <textarea
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-sm h-20 text-white placeholder-slate-500"
                  value={reworkText}
                  onChange={(event) => setReworkText(event.target.value)}
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-700 bg-slate-900/50 flex justify-end gap-3 rounded-b-xl">
              <button
                onClick={() => setShowFailModal(false)}
                className="px-5 py-2 text-slate-300 font-semibold hover:bg-slate-700 rounded-lg"
              >
                Cancelar
              </button>
              <button
                disabled={!canSubmitFail || isSubmitting || evidence.length === 0}
                onClick={handleFailSubmit}
                className={`px-5 py-2 text-white font-bold rounded-lg shadow-sm ${
                  canSubmitFail && !isSubmitting && evidence.length > 0
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-red-900 cursor-not-allowed opacity-50'
                }`}
              >
                Confirmar falla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QCExecution;
