import React, { useEffect, useMemo, useState } from 'react';
import { Clock, CloudUpload, Database, HardDrive, RefreshCw, ShieldCheck } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type BackupRecord = {
  filename: string;
  size_bytes: number;
  created_at: string;
  label?: string | null;
};

type BackupSettings = {
  enabled: boolean;
  interval_minutes: number;
  retention_count: number;
  last_backup_at: string | null;
};

type BackupCreateResponse = {
  backup: BackupRecord;
  settings: BackupSettings;
  pruned: string[];
};

type BackupRestoreResponse = {
  primary_db: string;
  archived_db: string;
  restored_from: string;
  checkpoint_backup: BackupRecord;
  pruned: string[];
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
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = -1;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = size < 10 ? 1 : 0;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
};

const formatDate = (value: string | null): string => {
  if (!value) {
    return '--';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const Backups: React.FC = () => {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<BackupSettings | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [backupLabel, setBackupLabel] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = async (showSpinner = true) => {
    if (showSpinner) {
      setRefreshing(true);
    }
    setStatusMessage(null);
    try {
      const [settingsData, backupsData] = await Promise.all([
        apiRequest<BackupSettings>('/api/backups/settings'),
        apiRequest<BackupRecord[]>('/api/backups'),
      ]);
      setSettings(settingsData);
      setSettingsDraft(settingsData);
      setBackups(backupsData);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load backups.';
      setStatusMessage(message);
    } finally {
      if (showSpinner) {
        setRefreshing(false);
      }
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh(false);
  }, []);

  const nextRun = useMemo(() => {
    if (!settings) {
      return '--';
    }
    if (!settings.enabled) {
      return 'Automation paused';
    }
    if (!settings.last_backup_at) {
      return 'Runs on scheduler start';
    }
    const last = new Date(settings.last_backup_at);
    if (Number.isNaN(last.getTime())) {
      return '--';
    }
    const next = new Date(last.getTime() + settings.interval_minutes * 60 * 1000);
    return next.toLocaleString();
  }, [settings]);

  const handleCreateBackup = async () => {
    setCreating(true);
    setStatusMessage(null);
    try {
      const response = await apiRequest<BackupCreateResponse>('/api/backups', {
        method: 'POST',
        body: JSON.stringify({ label: backupLabel.trim() || null }),
      });
      setSettings(response.settings);
      setSettingsDraft(response.settings);
      setBackups((prev) => {
        const next = [response.backup, ...prev.filter((item) => item.filename !== response.backup.filename)];
        return next;
      });
      if (response.pruned.length > 0) {
        setStatusMessage(`Backup created. Pruned ${response.pruned.length} older backups.`);
      } else {
        setStatusMessage('Backup created successfully.');
      }
      setBackupLabel('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backup creation failed.';
      setStatusMessage(message);
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (backup: BackupRecord) => {
    const confirmation = window.confirm(
      `Restore "${backup.label || backup.filename}"? ` +
        'This will create a manual checkpoint backup, restore the snapshot, and switch the primary database.'
    );
    if (!confirmation) {
      return;
    }
    setRestoring(backup.filename);
    setStatusMessage(null);
    try {
      const response = await apiRequest<BackupRestoreResponse>('/api/backups/restore', {
        method: 'POST',
        body: JSON.stringify({ filename: backup.filename, force_disconnect: true }),
      });
      await refresh(false);
      setStatusMessage(
        `Restore complete. Previous primary is now "${response.archived_db}". ` +
          `Checkpoint saved as "${response.checkpoint_backup.filename}".`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Restore failed.';
      setStatusMessage(message);
    } finally {
      setRestoring(null);
    }
  };

  const handleSaveSettings = async () => {
    if (!settingsDraft) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      const updated = await apiRequest<BackupSettings>('/api/backups/settings', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: settingsDraft.enabled,
          interval_minutes: settingsDraft.interval_minutes,
          retention_count: settingsDraft.retention_count,
        }),
      });
      setSettings(updated);
      setSettingsDraft(updated);
      setStatusMessage('Backup schedule updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update schedule.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Configuration / Resilience
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">Backup Control Center</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Run manual snapshots, restore clean cutovers, and rotate retention safely.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => refresh()}
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow-sm"
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleCreateBackup}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            disabled={creating}
          >
            <CloudUpload className="h-4 w-4" />
            {creating ? 'Creating...' : 'Create backup'}
          </button>
        </div>
      </header>

      {statusMessage && (
        <div className="rounded-2xl border border-black/5 bg-white/90 px-4 py-3 text-sm text-[var(--ink-muted)] shadow-sm">
          {statusMessage}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(201,215,245,0.6)] text-[var(--ink)]">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-display text-[var(--ink)]">Manual backup</h2>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Capture a snapshot immediately with an optional label.
                  </p>
                </div>
              </div>
              <div className="text-right text-xs text-[var(--ink-muted)]">
                <div>Last backup</div>
                <div className="font-semibold text-[var(--ink)]">
                  {settings ? formatDate(settings.last_backup_at) : '--'}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
              <label className="text-sm text-[var(--ink-muted)]">
                Snapshot label
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  placeholder="e.g. Pre-maintenance rollout"
                  value={backupLabel}
                  onChange={(event) => setBackupLabel(event.target.value)}
                />
              </label>
              <button
                onClick={handleCreateBackup}
                className="mt-6 inline-flex items-center justify-center rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                disabled={creating}
              >
                {creating ? 'Working...' : 'Run backup'}
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-black/5 bg-[rgba(242,98,65,0.08)] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Backups</p>
                <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{backups.length}</p>
              </div>
              <div className="rounded-2xl border border-black/5 bg-[rgba(47,107,79,0.08)] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Retention</p>
                <p className="mt-2 text-lg font-semibold text-[var(--ink)]">
                  {settings ? settings.retention_count : '--'} files
                </p>
              </div>
              <div className="rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.6)] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Next run</p>
                <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{nextRun}</p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(47,107,79,0.12)] text-[var(--leaf)]">
                  <HardDrive className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-display text-[var(--ink)]">Backup history</h2>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Latest snapshots stored in the backup vault.
                  </p>
                </div>
              </div>
              <button
                onClick={() => refresh()}
                className="text-xs font-semibold text-[var(--accent)]"
                disabled={refreshing}
              >
                {refreshing ? 'Refreshing...' : 'Reload'}
              </button>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-black/5">
              <div className="grid grid-cols-[1.4fr_0.8fr_0.6fr_0.6fr] bg-[rgba(15,27,45,0.04)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                <span>Snapshot</span>
                <span>Created</span>
                <span>Size</span>
                <span className="text-right">Restore</span>
              </div>
              <div className="divide-y divide-black/5">
                {loading && (
                  <div className="px-4 py-4 text-sm text-[var(--ink-muted)]">Loading backups...</div>
                )}
                {!loading && backups.length === 0 && (
                  <div className="px-4 py-4 text-sm text-[var(--ink-muted)]">No backups yet.</div>
                )}
                {backups.map((backup) => {
                  const isRestorable = backup.filename.endsWith('.dump');
                  return (
                    <div
                      key={backup.filename}
                      className="grid grid-cols-[1.4fr_0.8fr_0.6fr_0.6fr] items-center px-4 py-3 text-sm"
                    >
                      <div>
                        <p className="font-semibold text-[var(--ink)]">
                          {backup.label || 'Untitled snapshot'}
                        </p>
                        <p className="text-xs text-[var(--ink-muted)] font-mono">{backup.filename}</p>
                      </div>
                      <span className="text-xs text-[var(--ink-muted)]">
                        {formatDate(backup.created_at)}
                      </span>
                      <span className="text-xs text-[var(--ink)]">{formatBytes(backup.size_bytes)}</span>
                      <div className="text-right">
                        <button
                          onClick={() => handleRestore(backup)}
                          className="text-xs font-semibold text-[var(--leaf)] disabled:opacity-60"
                          disabled={!isRestorable || restoring === backup.filename}
                        >
                          {isRestorable
                            ? restoring === backup.filename
                              ? 'Restoring...'
                              : 'Restore'
                            : 'Unsupported'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(242,98,65,0.12)] text-[var(--accent)]">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[var(--ink)]">Automatic backups</h3>
                <p className="text-xs text-[var(--ink-muted)]">
                  Set cadence and retention limits for scheduled runs.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-4 text-sm">
              <label className="flex items-center gap-3 rounded-2xl border border-black/5 px-3 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--accent)]"
                  checked={settingsDraft?.enabled ?? false}
                  onChange={(event) =>
                    setSettingsDraft((prev) =>
                      prev ? { ...prev, enabled: event.target.checked } : prev
                    )
                  }
                />
                <span className="text-[var(--ink)]">Enable scheduled backups</span>
              </label>

              <label className="text-sm text-[var(--ink-muted)]">
                Interval (minutes)
                <input
                  type="number"
                  min={1}
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  value={settingsDraft?.interval_minutes ?? 1}
                  onChange={(event) =>
                    setSettingsDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            interval_minutes: Math.max(1, Number(event.target.value) || 1),
                          }
                        : prev
                    )
                  }
                />
              </label>

              <label className="text-sm text-[var(--ink-muted)]">
                Retain last N backups
                <input
                  type="number"
                  min={1}
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  value={settingsDraft?.retention_count ?? 1}
                  onChange={(event) =>
                    setSettingsDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            retention_count: Math.max(1, Number(event.target.value) || 1),
                          }
                        : prev
                    )
                  }
                />
              </label>

              <button
                onClick={handleSaveSettings}
                className="w-full rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save schedule'}
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-black/5 bg-[rgba(15,27,45,0.06)] p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-[var(--ink-muted)]" />
              <div>
                <h3 className="text-sm font-semibold text-[var(--ink)]">Operational notes</h3>
                <p className="text-xs text-[var(--ink-muted)]">
                  Restore creates a manual checkpoint backup, reloads the snapshot, and switches the
                  primary database (disconnects active sessions). Keep `pg_dump` + `pg_restore`
                  available on the server.
                </p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default Backups;
