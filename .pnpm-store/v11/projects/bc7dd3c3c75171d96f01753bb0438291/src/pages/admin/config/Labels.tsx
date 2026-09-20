import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { PanelLabelEditor } from '../../../components/PanelLabel';
import type { PanelLabelTarget } from '../../../components/PanelLabel';
import { useAdminHeader, useAdminPageAccess } from '../../../layouts/AdminLayoutContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
type PrinterStatus = { configured: boolean; connected: boolean; message: string };

export default function Labels() {
  const { setHeader } = useAdminHeader();
  const { canEdit } = useAdminPageAccess();
  const [context, setContext] = useState<PanelLabelTarget | null>(null);
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => { setHeader({ title: 'Etiquetas', kicker: 'Producción / Impresión' }); }, [setHeader]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const request = async (path: string) => {
          const response = await fetch(`${API_BASE_URL}/api/labels/${path}`, { credentials: 'include', signal: controller.signal });
          if (!response.ok) throw new Error('No se pudo cargar la configuración de impresión.');
          return response.json();
        };
        const [target, printer] = await Promise.all([request('panel-context'), request('status')]);
        setContext(target as PanelLabelTarget | null);
        setStatus(printer as PrinterStatus);
        setError(null);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo cargar la etiqueta.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [revision]);
  return <div className="mx-auto max-w-5xl space-y-6 p-6">
    <div className="flex items-center justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">Etiquetas de paneles</h1>
        <p className="mt-1 text-sm text-gray-500">Vista previa del panel con la actividad más reciente. Los operadores imprimen el panel seleccionado en Framing.</p></div>
      <button type="button" disabled={loading} onClick={() => { setLoading(true); setRevision(value => value + 1); }}
        className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold"><RefreshCw size={16} />Actualizar</button>
    </div>
    {status && <div className="rounded-xl border bg-white p-4 text-sm"><p className="font-semibold">Zebra ZD420</p><p className="mt-1 text-gray-600">{status.message}</p></div>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {loading ? <p>Cargando etiqueta…</p> : context ? <div className="rounded-xl border bg-white p-5">
      <PanelLabelEditor key={`${context.work_unit_id}-${context.panel_definition_id}-${revision}`} target={context} audience="admin" canPrint={canEdit} />
    </div> : !error && <p>No hay paneles disponibles.</p>}
  </div>;
}
