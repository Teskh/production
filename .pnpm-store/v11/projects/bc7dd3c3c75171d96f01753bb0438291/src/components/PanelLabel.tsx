import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Printer, X } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export type PanelLabelTarget = { work_unit_id: number; panel_definition_id: number };
type Preview = {
  data: { description: string; model: string; project: string; module: number; area: string; correlativo: string; label_date: string };
  missing_fields: string[];
  sources: Record<string, string>;
  svg: string;
};

async function labelRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/labels${path}`, {
    ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === 'string' ? body.detail : response.status === 422
      ? 'Revisa los datos del panel en el catálogo antes de imprimir.'
      : `No se pudo completar la solicitud (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export function PanelLabelEditor({ target, audience, canPrint = true, onPrintingChange }: {
  target: PanelLabelTarget; audience: 'worker' | 'admin'; canPrint?: boolean; onPrintingChange?: (printing: boolean) => void;
}) {
  const [copies, setCopies] = useState(1);
  const [result, setResult] = useState<{ preview: Preview; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const printLock = useRef(false);
  const requestKey = JSON.stringify({ ...target, copies });

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setError(null);
      setMessage(null);
      labelRequest<Preview>(`/${audience}/preview`, { method: 'POST', body: requestKey, signal: controller.signal })
        .then(preview => { if (!controller.signal.aborted) setResult({ preview, key: requestKey }); })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo cargar la etiqueta.');
        });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [requestKey, audience]);

  const preview = result?.preview;
  const current = result?.key === requestKey;
  const print = async () => {
    if (!preview || !current || printLock.current) return;
    printLock.current = true;
    setPrinting(true);
    onPrintingChange?.(true);
    setError(null);
    setMessage(null);
    try {
      const response = await labelRequest<{ message: string }>(`/${audience}/print`, {
        method: 'POST', body: JSON.stringify({ ...target, copies, label_date: preview.data.label_date }),
      });
      setMessage(response.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo enviar la etiqueta.');
    } finally {
      printLock.current = false;
      setPrinting(false);
      onPrintingChange?.(false);
    }
  };

  return <div className="space-y-5">
    {preview ? <>
      <img className={`w-full border border-gray-300 bg-white ${current ? '' : 'opacity-50'}`}
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`} alt={`Etiqueta de ${preview.data.description}, módulo ${preview.data.module}`} />
      <fieldset disabled={printing} className="space-y-4">
        <label className="flex items-center gap-3 text-sm font-semibold">Copias
          <input type="number" min={1} max={10} value={copies} className="w-20 rounded-lg border border-gray-300 px-3 py-2"
            onChange={event => setCopies(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} />
        </label>
      </fieldset>
    </> : !error && <p className="text-sm text-gray-500">Cargando etiqueta…</p>}
    {preview && preview.missing_fields.length > 0 && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
      Faltan datos en el catálogo o la orden de trabajo: {preview.missing_fields.map(field => ({ description: 'Panel', model: 'Modelo', project: 'Proyecto', area: 'Área', correlativo: 'Correlativo' }[field] ?? field)).join(', ')}. Solicita su actualización antes de imprimir.
    </p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    <button type="button" onClick={() => void print()} disabled={!canPrint || !current || !preview || preview.missing_fields.length > 0 || printing}
      aria-label={printing ? 'Enviando etiqueta' : message ? 'Imprimir otra copia' : 'Imprimir etiqueta'}
      title={printing ? 'Enviando etiqueta' : message ? 'Imprimir otra copia' : 'Imprimir etiqueta'}
      className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-700 text-white disabled:opacity-40">
      {printing ? <LoaderCircle size={24} className="animate-spin" aria-hidden="true" /> : <Printer size={24} aria-hidden="true" />}
    </button>
  </div>;
}

export function PanelLabelDialog({ target, onClose }: { target: PanelLabelTarget; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [printing, setPrinting] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onClose={onClose} onCancel={event => { if (printing) event.preventDefault(); }} aria-labelledby="panel-label-title" className="w-[min(900px,95vw)] max-h-[90vh] rounded-2xl p-6 shadow-xl backdrop:bg-gray-900/40">
    <div className="mb-5 flex items-center justify-between gap-4">
      <h2 id="panel-label-title" className="text-xl font-semibold">Etiqueta del panel</h2>
      <button type="button" disabled={printing} onClick={onClose} aria-label="Cerrar" className="rounded-full p-2 hover:bg-gray-100 disabled:opacity-40"><X /></button>
    </div>
    <PanelLabelEditor target={target} audience="worker" onPrintingChange={setPrinting} />
  </dialog>;
}
