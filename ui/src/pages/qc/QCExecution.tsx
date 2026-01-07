import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Camera,
  Check,
  X,
  MessageSquare,
  AlertTriangle,
  ChevronLeft,
  SkipForward,
  AlertCircle,
  ChevronRight,
  Image,
} from 'lucide-react';
import { CHECK_DEFINITIONS, PENDING_CHECKS, FAILURE_MODES, SEVERITY_LEVELS } from '../../services/qcMockData';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const QC_ROLE_VALUES = new Set(['Calidad', 'QC']);

const MOCK_GUIDANCE_IMAGES = [
  'https://placehold.co/600x400/3b82f6/white?text=Guidance+1',
  'https://placehold.co/600x400/3b82f6/white?text=Guidance+2',
];

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

const apiRequest = async <T,>(path: string): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Solicitud fallida (${response.status})`);
  }
  return (await response.json()) as T;
};

const apiJsonRequest = async <T,>(path: string, payload: unknown, method = 'POST'): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Solicitud fallida (${response.status})`);
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

const QCExecution: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const checkIdParam = queryParams.get('check');
  const reworkIdParam = queryParams.get('rework');
  const reworkState = location.state?.rework as QCReworkState | undefined;
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

  const [refImageIndex, setRefImageIndex] = useState(0);
  const [guideImageIndex, setGuideImageIndex] = useState(0);

  type EvidenceItem = { url: string; id: string; type: 'image' | 'video'; file?: File };
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [notes, setNotes] = useState('');
  const [selectedFailureModeIds, setSelectedFailureModeIds] = useState<string[]>([]);
  const [selectedSeverityId, setSelectedSeverityId] = useState<string | null>(null);
  const [reworkText, setReworkText] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const mockCheckInstance = useMemo(
    () =>
      PENDING_CHECKS.find(
        (check) => check.id === checkIdParam || check.id === location.state?.checkId
      ),
    [checkIdParam, location.state?.checkId]
  );

  const defId =
    mockCheckInstance?.checkDefinitionId ||
    location.state?.defId ||
    (!checkDetail ? 'chk_wall' : undefined);
  const checkDef = defId ? CHECK_DEFINITIONS[defId] : undefined;

  const runtimeStep = useMemo<QCStep | null>(() => {
    if (!checkDetail?.check_definition && !checkDetail?.check_instance?.check_name && !checkDef?.name) {
      return null;
    }
    return {
      id: 'runtime',
      title:
        checkDetail?.check_definition?.name ??
        checkDetail?.check_instance?.check_name ??
        checkDef?.name ??
        'Revision QC',
      desc: checkDetail?.check_definition?.guidance_text ?? checkDef?.guidance ?? 'Sin guia adicional.',
      required: true,
      image: null,
    };
  }, [checkDetail?.check_definition, checkDetail?.check_instance?.check_name, checkDef?.guidance, checkDef?.name]);

  const steps = useMemo<QCStep[]>(() => {
    if (checkDef?.steps?.length) {
      return checkDef.steps as QCStep[];
    }
    return runtimeStep ? [runtimeStep] : [];
  }, [checkDef?.steps, runtimeStep]);
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
    return MOCK_GUIDANCE_IMAGES;
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
    return FAILURE_MODES;
  }, [checkDetail?.failure_modes]);

  useEffect(() => {
    if (selectedFailureModeIds.length === 0) {
      setReworkText('');
      setSelectedSeverityId(null);
      return;
    }
    if (!selectedSeverityId) {
      const firstMode = failureModes.find((item) => item.id === selectedFailureModeIds[0]);
      setSelectedSeverityId(firstMode?.defaultSeverityId ?? null);
    }
    if (!reworkText.trim()) {
      const firstMode = failureModes.find((item) => item.id === selectedFailureModeIds[0]);
      setReworkText(firstMode?.defaultReworkText ?? '');
    }
  }, [failureModes, reworkText, selectedFailureModeIds, selectedSeverityId]);

  const handleEvidenceSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }
    const additions: EvidenceItem[] = files.map((file) => ({
      id: `${file.name}-${file.lastModified}-${file.size}`,
      url: URL.createObjectURL(file),
      type: file.type.startsWith('video') ? 'video' : 'image',
      file,
    }));
    setEvidence((prev) => [...prev, ...additions]);
    setEvidenceGateError(null);
    setActionError(null);
    setShowCamera(false);
    event.target.value = '';
  };

  const evidenceRequiredForOutcome = (outcome: 'Pass' | 'Fail' | 'Skip' | 'Waive') =>
    outcome === 'Pass' || outcome === 'Fail';

  const uploadEvidence = async (executionId: number) => {
    const uploads = evidence.filter((item) => item.file);
    for (const item of uploads) {
      const formData = new FormData();
      formData.append('file', item.file as File);
      const response = await fetch(`${API_BASE_URL}/api/qc/executions/${executionId}/evidence`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `No se pudo subir evidencia (${response.status})`);
      }
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
      const message = 'Agregue evidencia antes de aprobar o fallar esta revision.';
      setEvidenceGateError(message);
      setActionError(message);
      setShowEvidenceRequiredModal(true);
      return;
    }
    if (outcome === 'Fail' && selectedFailureModeIds.length === 0) {
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
      const payload = {
        outcome,
        notes: notes.trim() || null,
        severity_level: outcome === 'Fail' ? severity : null,
        failure_mode_ids: failureIds,
        rework_description: outcome === 'Fail' ? reworkText.trim() || null : null,
      };
      const execution = await apiJsonRequest<{ id: number }>(
        `/api/qc/check-instances/${checkId}/execute`,
        payload
      );
      if (evidence.some((item) => item.file)) {
        await uploadEvidence(execution.id);
      }
      navigate('/qc');
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
      const message = 'Agregue evidencia antes de registrar una falla.';
      setEvidenceGateError(message);
      setActionError(message);
      setShowEvidenceRequiredModal(true);
      return;
    }
    setShowFailModal(false);
    void executeCheck('Fail');
  };

  const handleCapture = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleSkipStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleSkipCheck = () => {
    void executeCheck('Skip');
  };

  const canSubmitFail = selectedFailureModeIds.length > 0 && !!selectedSeverityId;

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

  if (!checkDef && !checkDetail && !reworkIdParam) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 text-white">
        Revision no encontrada.
      </div>
    );
  }

  const headerModule =
    checkDetail?.check_instance.module_number ?? mockCheckInstance?.moduleNumber ?? 'Manual';
  const headerStation =
    checkDetail?.check_instance.station_name ?? mockCheckInstance?.stationName ?? 'Sin estacion';
  const headerPanel =
    checkDetail?.check_instance.panel_code ?? mockCheckInstance?.panelCode ?? null;
  const headerTitle = checkDetail?.check_definition?.name ?? checkDef?.name ?? 'Revision QC';

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        multiple
        onChange={handleEvidenceSelection}
      />
      {/* Minimal Header */}
      <div className="flex items-center px-4 py-2 bg-slate-800/50 backdrop-blur-sm">
        <button
          onClick={() => navigate('/qc')}
          className="p-2 rounded-lg hover:bg-slate-700 transition-colors"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="ml-2 text-sm text-slate-400">
          <span className="font-medium text-white">{headerModule}</span>
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

      {/* Main Content: Two Carousels Side by Side */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Reference Images Carousel */}
        <div className="flex-1 relative bg-slate-800 flex items-center justify-center min-h-[30vh] lg:min-h-0">
          <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-semibold z-10">
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
        <div className="flex-1 relative bg-slate-800/50 flex items-center justify-center min-h-[30vh] lg:min-h-0">
          <div className="absolute top-3 left-3 bg-blue-600/80 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-semibold z-10">
            Guia Visual
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
      <div className="bg-slate-800 border-t border-slate-700">
        {/* Description */}
        <div className="px-4 py-3 border-b border-slate-700/50">
          <h2 className="text-lg font-bold text-white">{currentStepData?.title || headerTitle}</h2>
          <p className="text-sm text-slate-300 mt-1">
            {currentStepData?.desc || checkDef?.guidance || 'Sin guia adicional.'}
          </p>
          {reworkState && (
            <p className="text-xs text-slate-400 mt-2">Re-trabajo: {reworkState.description}</p>
          )}
          {actionError && (
            <p className="mt-2 rounded-lg border border-red-500/40 bg-red-900/30 px-3 py-2 text-xs text-red-200">
              {actionError}
            </p>
          )}
        </div>

        {/* Actions Row */}
        <div className="flex items-center justify-between p-3 gap-3">
          {/* Left: Tools */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCamera(true)}
              className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-sm"
            >
              <Camera className="w-4 h-4" />
              <span className="hidden sm:inline">Evidencia</span>
              {evidence.length === 0 && evidenceGateError && (
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400" aria-hidden="true" />
              )}
            </button>
            <button
              onClick={() => setShowNotesModal(true)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm ${
                notes ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-700 hover:bg-slate-600'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">Nota</span>
            </button>

            {evidence.length > 0 && (
              <div className="flex -space-x-2 ml-2">
                {evidence.slice(0, 3).map((ev) => (
                  <div
                    key={ev.id}
                    className="w-8 h-8 rounded-lg border-2 border-slate-800 overflow-hidden"
                  >
                    {ev.type === 'video' ? (
                      <video src={ev.url} className="w-full h-full object-cover" />
                    ) : (
                      <img src={ev.url} alt="ev" className="w-full h-full object-cover" />
                    )}
                  </div>
                ))}
                {evidence.length > 3 && (
                  <div className="w-8 h-8 rounded-lg border-2 border-slate-800 bg-slate-700 flex items-center justify-center text-xs">
                    +{evidence.length - 3}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Center: Secondary Actions */}
          <div className="hidden sm:flex items-center gap-1">
            <button
              onClick={handleSkipStep}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              title="Omitir paso"
              disabled={currentStep >= steps.length - 1}
            >
              <SkipForward className="w-5 h-5" />
            </button>
            <button
              onClick={handleSkipCheck}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              title="Omitir revision"
              disabled={isSubmitting}
            >
              <AlertCircle className="w-5 h-5" />
            </button>
          </div>

          {/* Right: Main Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFailModal(true)}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 rounded-xl font-bold transition-colors"
            >
              <X className="w-5 h-5" />
              <span className="hidden sm:inline">Fallar</span>
            </button>
            <button
              onClick={handlePass}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-600 rounded-xl font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-[0.98]"
            >
              <Check className="w-5 h-5" />
              <span>{currentStep < steps.length - 1 ? 'Siguiente' : 'Finalizar'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* --- Modals --- */}

      {/* Evidence Required Modal */}
      {showEvidenceRequiredModal && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 w-full max-w-md rounded-xl shadow-2xl overflow-hidden border border-slate-700">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center">
              <div className="flex items-center gap-2 text-amber-300">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="font-bold text-white">Evidencia requerida</h3>
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
                {evidenceGateError ?? 'Agregue evidencia antes de continuar.'}
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
                  handleCapture();
                }}
                className="px-4 py-2 bg-amber-500 text-slate-900 font-semibold rounded-lg hover:bg-amber-400"
              >
                Adjuntar evidencia
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera Overlay */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex-1 flex flex-col items-center justify-center relative bg-slate-900">
            <p className="text-white/50 text-sm absolute top-8">Simulador de camara</p>
            <div className="w-full max-w-md aspect-[4/3] border border-white/20 relative flex items-center justify-center">
              <div className="w-48 h-48 border-2 border-white/30 rounded-lg flex items-center justify-center">
                <span className="text-white/20 text-4xl font-thin">+</span>
              </div>
              <div className="absolute bottom-4 left-4 text-[10px] text-yellow-400 font-mono bg-black/50 px-2 py-1 rounded">
                {headerModule} | {new Date().toLocaleTimeString()}
              </div>
            </div>
            <div className="mt-8 flex items-center gap-8">
              <button
                onClick={() => setShowCamera(false)}
                className="p-4 rounded-full bg-slate-800 text-white hover:bg-slate-700"
              >
                <X className="w-6 h-6" />
              </button>
              <button
                onClick={handleCapture}
                className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center hover:scale-105 transition-transform"
              >
                <div className="w-16 h-16 bg-white rounded-full"></div>
              </button>
              <div className="w-14" />
            </div>
          </div>
        </div>
      )}

      {/* Notes Modal */}
      {showNotesModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 w-full max-w-lg rounded-xl shadow-2xl overflow-hidden border border-slate-700">
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 w-full max-w-lg rounded-xl shadow-2xl flex flex-col max-h-[90vh] border border-slate-700">
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
                    Adjunte evidencia (foto/video) antes de confirmar la falla.
                  </p>
                  <button
                    onClick={handleCapture}
                    className="mt-2 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-400"
                  >
                    <Camera className="w-4 h-4" />
                    Adjuntar evidencia
                  </button>
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-bold text-slate-300 mb-2">Modos de falla</label>
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
              </div>

              {selectedFailureModeIds.length > 0 && (
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
