import React, { useEffect, useMemo, useState } from 'react';
import {
  AlignLeft,
  Box,
  CheckCircle2,
  Hash,
  Printer,
  RefreshCw,
  Save,
  Send,
  Type,
  WifiOff,
} from 'lucide-react';
import {
  assertAdminPageMutationAllowed,
  useAdminHeader,
  useAdminPageAccess,
} from '../../../layouts/AdminLayoutContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const SWISS_BLUE = '#002FA7';

type LabelFieldKey =
  | 'production_number'
  | 'project_name'
  | 'module_number'
  | 'panel_name';

type LabelSettings = {
  selected_fields: LabelFieldKey[];
  copies: number;
};

type ProductionLabelData = {
  work_unit_id: number;
  production_number: string;
  project_name: string;
  module_number: number;
  panel_name: string | null;
  scope: 'module' | 'panel';
  source: 'active_task' | 'recent_activity' | 'production_queue';
  activity_at: string | null;
};

type LabelPrinterProfile = {
  model: string;
  dpi: number;
  dots_per_mm: number;
  print_width_dots: number;
  label_length_dots: number;
  print_width_mm: number;
  label_length_mm: number;
  media_type: string;
  print_method: string;
};

type LabelPrinterStatus = {
  configured: boolean;
  connected: boolean;
  state: string;
  message: string;
  host: string | null;
  port: number;
  raw_status: string | null;
  profile: LabelPrinterProfile;
};

type TestPrintResponse = {
  sent: boolean;
  message: string;
  bytes_sent: number;
  copies: number;
};

const FALLBACK_SETTINGS: LabelSettings = {
  selected_fields: ['production_number', 'project_name', 'module_number', 'panel_name'],
  copies: 1,
};

const FIELD_OPTIONS: Array<{
  id: LabelFieldKey;
  label: string;
  description: string;
  icon: React.ElementType;
}> = [
  {
    id: 'production_number',
    label: 'N° de producción',
    description: 'Identificador de la casa u orden en la cola de producción.',
    icon: Hash,
  },
  {
    id: 'project_name',
    label: 'Proyecto',
    description: 'Nombre del proyecto asociado al módulo seleccionado.',
    icon: AlignLeft,
  },
  {
    id: 'module_number',
    label: 'Módulo',
    description: 'Número de módulo dentro de la unidad de producción.',
    icon: Type,
  },
  {
    id: 'panel_name',
    label: 'Panel',
    description: 'Se imprime solo cuando la actividad seleccionada corresponde a un panel.',
    icon: Box,
  },
];

const SOURCE_LABELS: Record<ProductionLabelData['source'], string> = {
  active_task: 'Tarea activa',
  recent_activity: 'Actividad más reciente',
  production_queue: 'Siguiente en la cola',
};

const buildHeaders = (options: RequestInit): Headers => {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
};

const apiRequest = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: buildHeaders(options),
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail || `Solicitud fallida (${response.status})`);
  }
  return (await response.json()) as T;
};

const Labels: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const { canEdit } = useAdminPageAccess();
  const [savedSettings, setSavedSettings] = useState<LabelSettings | null>(null);
  const [draft, setDraft] = useState<LabelSettings>(FALLBACK_SETTINGS);
  const [production, setProduction] = useState<ProductionLabelData | null>(null);
  const [printerStatus, setPrinterStatus] = useState<LabelPrinterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error' | 'info'>('info');

  useEffect(() => {
    setHeader({
      title: 'Etiquetas',
      kicker: 'Producción / Impresión',
    });
  }, [setHeader]);

  const loadPage = async (showSpinner = true) => {
    if (showSpinner) {
      setRefreshing(true);
    }
    setMessage(null);
    try {
      const [settingsData, statusData, productionData] = await Promise.all([
        apiRequest<LabelSettings>('/api/labels/settings'),
        apiRequest<LabelPrinterStatus>('/api/labels/status'),
        apiRequest<ProductionLabelData | null>('/api/labels/latest-production'),
      ]);
      setSavedSettings(settingsData);
      setDraft(settingsData);
      setPrinterStatus(statusData);
      setProduction(productionData);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cargar Etiquetas.');
      setMessageTone('error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadPage(false);
  }, []);

  const hasChanges = useMemo(
    () => JSON.stringify(savedSettings) !== JSON.stringify(draft),
    [draft, savedSettings],
  );
  const selected = useMemo(() => new Set(draft.selected_fields), [draft.selected_fields]);
  const activityLabel = useMemo(() => {
    if (!production?.activity_at) {
      return 'Sin actividad registrada';
    }
    return new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(production.activity_at));
  }, [production]);

  const toggleField = (field: LabelFieldKey) => {
    setDraft((current) => {
      const isSelected = current.selected_fields.includes(field);
      if (isSelected && current.selected_fields.length === 1) {
        setMessage('La etiqueta debe conservar al menos un campo.');
        setMessageTone('info');
        return current;
      }
      return {
        ...current,
        selected_fields: isSelected
          ? current.selected_fields.filter((item) => item !== field)
          : [...current.selected_fields, field],
      };
    });
  };

  const saveDraft = async (): Promise<LabelSettings> => {
    assertAdminPageMutationAllowed(canEdit, { method: 'PUT' });
    const updated = await apiRequest<LabelSettings>('/api/labels/settings', {
      method: 'PUT',
      body: JSON.stringify(draft),
    });
    setSavedSettings(updated);
    setDraft(updated);
    return updated;
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await saveDraft();
      setMessage('Configuración de etiqueta guardada.');
      setMessageTone('success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la configuración.');
      setMessageTone('error');
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = async () => {
    setPrinting(true);
    setMessage(null);
    try {
      await saveDraft();
      const response = await apiRequest<TestPrintResponse>('/api/labels/test-print', {
        method: 'POST',
      });
      setMessage(`${response.message} ${response.copies} copia(s).`);
      setMessageTone('success');
      const [statusData, productionData] = await Promise.all([
        apiRequest<LabelPrinterStatus>('/api/labels/status'),
        apiRequest<ProductionLabelData | null>('/api/labels/latest-production'),
      ]);
      setPrinterStatus(statusData);
      setProduction(productionData);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo enviar la muestra.');
      setMessageTone('error');
    } finally {
      setPrinting(false);
    }
  };

  const statusAccent = printerStatus?.connected ? '#16734A' : SWISS_BLUE;

  return (
    <div
      className="mx-auto max-w-[1500px] space-y-5 text-slate-950"
      style={{ fontFamily: '"Helvetica Neue", Arial, sans-serif' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 bg-white px-5 py-4">
        <div>
          <p className="text-sm font-semibold">Etiqueta del último módulo en producción</p>
          <p className="mt-1 text-xs text-slate-500">
            Configura los campos, revisa el registro elegido y envía una prueba en formato landscape.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadPage()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 border border-slate-300 bg-white px-4 py-2 text-sm font-semibold transition hover:border-slate-950 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canEdit || saving || !hasChanges}
            className="inline-flex items-center gap-2 border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: SWISS_BLUE, color: SWISS_BLUE }}
          >
            <Save className="h-4 w-4" />
            {saving ? 'Guardando...' : 'Guardar configuración'}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!canEdit || printing || !production}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: SWISS_BLUE }}
          >
            <Send className="h-4 w-4" />
            {printing ? 'Enviando...' : 'Enviar muestra'}
          </button>
        </div>
      </div>

      {message && (
        <div
          className="border-l-4 bg-white px-4 py-3 text-sm"
          style={{
            borderColor: messageTone === 'error' ? '#DC2626' : messageTone === 'success' ? '#16734A' : SWISS_BLUE,
          }}
          role="status"
        >
          {message}
        </div>
      )}

      <section className="border border-slate-300 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 px-5 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Registro seleccionado</p>
            <p className="mt-1 text-sm font-semibold">
              {production ? SOURCE_LABELS[production.source] : 'No hay módulos disponibles'}
            </p>
          </div>
          {production && (
            <span className="border border-[#002FA7] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#002FA7]">
              {production.scope === 'panel' ? 'Panel' : 'Módulo'} · {activityLabel}
            </span>
          )}
        </div>
        <div className="grid divide-y divide-slate-300 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          {[
            ['N° producción', production?.production_number ?? '—'],
            ['Proyecto', production?.project_name ?? '—'],
            ['Módulo', production ? `M-${String(production.module_number).padStart(2, '0')}` : '—'],
            ['Panel', production?.panel_name ?? 'No aplica'],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
              <p className="mt-2 truncate text-lg font-bold tracking-[-0.03em]" title={value}>{value}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[410px_minmax(0,1fr)]">
        <section className="border border-slate-300 bg-white">
          <div className="grid border-b border-slate-300 grid-cols-[1fr_135px]">
            <div className="px-5 py-5">
              <h2 className="text-2xl font-bold tracking-[-0.03em]">Campos incluidos</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                La información viene del registro de producción mostrado arriba.
              </p>
            </div>
            <div className="border-l border-slate-300 px-4 py-5">
              <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                Copias
                <select
                  value={draft.copies}
                  onChange={(event) => setDraft((current) => ({ ...current, copies: Number(event.target.value) }))}
                  disabled={!canEdit}
                  className="mt-3 block w-full border border-slate-300 bg-white px-3 py-2 text-base font-semibold outline-none focus:border-[#002FA7]"
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="divide-y divide-slate-300">
            {FIELD_OPTIONS.map((field, index) => {
              const Icon = field.icon;
              const isSelected = selected.has(field.id);
              return (
                <div key={field.id} className={`grid grid-cols-[48px_1fr] gap-4 px-5 py-5 ${isSelected ? 'bg-white' : 'bg-[#F7F7F8]'}`}>
                  <button
                    type="button"
                    onClick={() => toggleField(field.id)}
                    disabled={!canEdit}
                    aria-pressed={isSelected}
                    aria-label={`${isSelected ? 'Quitar' : 'Incluir'} ${field.label}`}
                    className="flex h-11 w-11 items-center justify-center border-2 transition disabled:cursor-not-allowed"
                    style={{
                      borderColor: isSelected ? SWISS_BLUE : '#CBD5E1',
                      backgroundColor: isSelected ? SWISS_BLUE : '#FFFFFF',
                      color: isSelected ? '#FFFFFF' : '#64748B',
                    }}
                  >
                    {isSelected ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </button>
                  <div>
                    <div className="flex items-baseline gap-3">
                      <span className="text-xs font-bold tabular-nums text-slate-400">0{index + 1}</span>
                      <h3 className="text-base font-bold">{field.label}</h3>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{field.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="space-y-5">
          <section className="border border-slate-300 bg-[#F7F7F8] p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold">Vista previa · Landscape</h2>
                <p className="mt-1 text-xs text-slate-500">Lectura 1618 × 799 dots; soporte físico 799 × 1618 dots</p>
              </div>
              <span className="text-xs font-bold tabular-nums text-[#002FA7]">01 / 01</span>
            </div>

            <div
              className="mx-auto w-full border border-slate-300 p-3"
              style={{
                backgroundImage: 'linear-gradient(#E2E8F0 1px, transparent 1px), linear-gradient(90deg, #E2E8F0 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
            >
              <div
                className="relative grid w-full place-items-center overflow-hidden bg-white"
                style={{ aspectRatio: '1618 / 799' }}
              >
                <div
                  className="relative grid h-[91.99%] w-[94.07%] overflow-hidden border-2 border-slate-950 font-bold"
                  style={{
                    gridTemplateColumns: '65.18% 34.82%',
                    fontFamily: '"Arial Narrow", Arial, sans-serif',
                    fontStretch: 'condensed',
                  }}
                >
                  {production ? (
                    <>
                      <div className="flex min-w-0 flex-col border-r-2 border-slate-950 px-[3%] py-[3.2%]">
                        {selected.has('production_number') && (
                          <div>
                            <p className="text-[clamp(7px,0.75vw,11px)] uppercase tracking-normal text-slate-500">N° producción</p>
                            <p className="truncate text-[clamp(24px,4.7vw,68px)] leading-none tracking-normal">
                              {production.production_number}
                            </p>
                          </div>
                        )}
                        {selected.has('project_name') && (
                          <div className="mt-[6%]">
                            <p className="text-[clamp(7px,0.75vw,11px)] uppercase tracking-normal text-slate-500">Proyecto</p>
                            <p className="mt-1 truncate text-[clamp(13px,2.2vw,30px)] leading-none tracking-normal">
                              {production.project_name}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex min-w-0 flex-col px-[6%] py-[5%]">
                        {selected.has('module_number') && (
                          <div>
                            <p className="text-[clamp(7px,0.75vw,11px)] uppercase tracking-normal text-slate-500">Módulo</p>
                            <p className="text-[clamp(28px,5.5vw,78px)] leading-none tracking-normal">
                              M-{String(production.module_number).padStart(2, '0')}
                            </p>
                          </div>
                        )}
                        {selected.has('panel_name') && production.panel_name && (
                          <div className="mt-[12%] border-t border-slate-950 pt-[7%]">
                            <p className="text-[clamp(7px,0.75vw,11px)] uppercase tracking-normal text-slate-500">Panel</p>
                            <p className="mt-1 truncate text-[clamp(14px,2.5vw,34px)] leading-none tracking-normal">
                              {production.panel_name}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="absolute bottom-[2%] left-[2%] text-[clamp(5px,0.55vw,8px)] uppercase tracking-normal text-slate-500">
                        ZD420 / 203 DPI / MUESTRA PRODUCCION / LANDSCAPE
                      </div>
                    </>
                  ) : (
                    <div className="col-span-2 flex items-center justify-center p-8 text-center text-sm text-slate-500">
                      No hay un módulo disponible para construir la vista previa.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="border border-slate-300 bg-white">
            <div className="flex items-start justify-between gap-4 border-b border-slate-300 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5" style={{ color: statusAccent }}>
                  {printerStatus?.connected ? <Printer className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
                </div>
                <div>
                  <h2 className="text-sm font-bold">Zebra ZD420</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {printerStatus?.message ?? 'Cargando estado del servidor...'}
                  </p>
                </div>
              </div>
              <span className="border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ borderColor: statusAccent, color: statusAccent }}>
                {printerStatus?.connected ? 'Conectada' : printerStatus?.configured ? 'Sin conexión' : 'Sin IP'}
              </span>
            </div>
            <div className="grid grid-cols-3 divide-x divide-slate-300">
              <div className="px-4 py-4">
                <p className="text-3xl font-bold tracking-[-0.06em] text-[#002FA7]">203</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">DPI</p>
              </div>
              <div className="px-4 py-4">
                <p className="text-3xl font-bold tracking-[-0.06em]">799</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Ancho / dots</p>
              </div>
              <div className="px-4 py-4">
                <p className="text-3xl font-bold tracking-[-0.06em]">1618</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Largo / dots</p>
              </div>
            </div>
            <div className="border-t border-slate-300 px-5 py-3 text-xs text-slate-500">
              {printerStatus?.host
                ? `${printerStatus.host}:${printerStatus.port}`
                : 'Pendiente: configurar ZEBRA_PRINTER_HOST cuando la impresora tenga Wi-Fi.'}
            </div>
          </section>
        </div>
      </div>

      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70">
          <div className="flex items-center gap-3 border border-slate-300 border-l-4 border-l-[#002FA7] bg-white px-5 py-3 text-sm font-semibold">
            <RefreshCw className="h-4 w-4 animate-spin text-[#002FA7]" />
            Cargando Etiquetas...
          </div>
        </div>
      )}
    </div>
  );
};

export default Labels;
