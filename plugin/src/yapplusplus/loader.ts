export const YAPPLUSPLUS_SCRIPT_URL = 'https://raw.githubusercontent.com/salami-reborn/yapplusplus/main/Extras/web.js';
const SOURCE_LIMIT = 512 * 1024;

export async function loadYapplusplus(signal: AbortSignal, setStatus: (value: string) => void) {
  const response = await fetch(YAPPLUSPLUS_SCRIPT_URL, { cache: 'no-cache', signal });
  if (!response.ok) throw new Error(`Yap++ returned HTTP ${response.status}.`);
  const source = await response.text();
  if (!source.trim() || source.length > SOURCE_LIMIT) throw new Error('The Yap++ integration source is empty or too large.');
  if (signal.aborted) return;

  const script = document.createElement('script');
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    URL.revokeObjectURL(url);
    script.remove();
    signal.removeEventListener('abort', cleanup);
  };
  signal.addEventListener('abort', cleanup, { once: true });
  script.onload = () => {
    cleanup();
    if (!signal.aborted) setStatus('Yap++ started. Check its in-page notice for plugin status.');
  };
  script.onerror = () => {
    cleanup();
    if (!signal.aborted) setStatus('Yap++ could not start. Reload Yapin to try again.');
  };
  script.src = url;
  document.head.append(script);
}