let worker;
let nextId = 0;
const pending = new Map();
let busyCount = 0;

function setBusy(change) {
  busyCount += change;
  document.documentElement.classList.toggle('worker-busy', busyCount > 0);
}

function getWorker() {
  if (worker) return worker;
  const url = new URL('./io-worker.js', import.meta.url);
  url.searchParams.set('threeBase', window.__THREE_BASE__ || '');
  worker = new Worker(url, { type: 'module' });
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  };
  worker.onerror = event => {
    const error = new Error(event.message || 'Background worker failed');
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker.terminate();
    worker = null;
  };
  return worker;
}

export function runWorkerTask(operation, payload, transfer = []) {
  setBusy(1);
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    try { getWorker().postMessage({ id, operation, payload }, transfer); }
    catch (error) { pending.delete(id); reject(error); }
  }).finally(() => setBusy(-1));
}

export async function withWaitCursor(task) {
  setBusy(1);
  try {
    await new Promise(resolve => requestAnimationFrame(resolve));
    return await task();
  }
  finally { setBusy(-1); }
}
