const platform = window.yapmodPlatform;
document.documentElement.dataset.platform = platform;
const invoke = (command) => window.__TAURI_INTERNALS__.invoke(command);
const retry = document.querySelector('#retry');
const status = document.querySelector('#status');
let timeout = setTimeout(showRetry, 15000);

function showRetry() {
  status.textContent = 'Unable to reach Yapin. Check your connection and try again.';
  retry.hidden = false;
}

async function connect() {
  retry.hidden = true;
  status.textContent = 'Connecting to Yapin…';
  clearTimeout(timeout);
  timeout = setTimeout(showRetry, 15000);
  try {
    await invoke('open_yapin');
  } catch {
    clearTimeout(timeout);
    showRetry();
  }
}

window.addEventListener('yapmod-connected', () => {
  clearTimeout(timeout);
  document.querySelector('main').hidden = true;
});
retry.addEventListener('click', connect);
installWindowCaption(document.querySelector('#titlebar'), platform,
  action => window.__TAURI_INTERNALS__.invoke('window_caption', { action }));
