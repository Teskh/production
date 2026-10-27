export const MAX_QC_VIDEO_SECONDS = 150;
export const QC_VIDEO_LIMIT_MESSAGE = 'Los videos de esta ejecucion no pueden sumar mas de 2:30.';

export const validateVideoTotal = (durations: number[]) => {
  if (durations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
    throw new Error('No se pudo determinar la duracion del video.');
  }
  if (durations.reduce((total, duration) => total + duration, 0) > MAX_QC_VIDEO_SECONDS + 1e-6) {
    throw new Error(QC_VIDEO_LIMIT_MESSAGE);
  }
};

export const formatVideoDuration = (seconds: number) => {
  const rounded = Math.ceil(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
};

export const readVideoDuration = (source: Blob | string): Promise<number> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.ondurationchange = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      if (typeof source !== 'string') URL.revokeObjectURL(url);
    };
    const fail = () => {
      cleanup();
      reject(new Error('No se pudo leer la duracion del video. Seleccione otro archivo.'));
    };
    const finish = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        const duration = video.duration;
        cleanup();
        resolve(duration);
        return true;
      }
      return false;
    };
    const timeout = window.setTimeout(fail, 20000);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      if (!finish()) {
        // MediaRecorder WebM often lacks a duration header. Seeking to the end
        // makes the browser determine duration from the recorded timestamps.
        try { video.currentTime = 1e10; } catch { fail(); }
      }
    };
    video.ondurationchange = () => { finish(); };
    video.onseeked = () => { if (!finish()) fail(); };
    video.onerror = fail;
    video.src = url;
  });
