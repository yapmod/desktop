// Tauri installs this transport at document start, before the site's scripts.
(() => {
  if (window !== window.top) return;
  const internals = window.__TAURI_INTERNALS__;
  const origin = window.location.origin;
  const isYapin = origin === "https://www.yapin.gg" || origin === "https://yapin.gg";
  const invokeKey = __INVOKE_KEY__;
  const serialize = JSON.stringify;
  const send = window.ipc.postMessage.bind(window.ipc);

  Object.defineProperty(internals, "postMessage", {
    value({ cmd, callback, error, payload, options }) {
      const label = internals.metadata.currentWebview.label;
      if (label !== "shell" && !(label === "yapin" && isYapin)) {
        internals.runCallback(error, "Desktop commands are unavailable on this page.");
        return;
      }

      // All desktop commands use JSON. Return their results through Tauri's
      // callbacks too, so an object response never needs a channel fetch.
      send(serialize({
        __proto__: null,
        cmd, callback, error, payload,
        options: { ...options, customProtocolIpcBlocked: true },
        __TAURI_INVOKE_KEY__: invokeKey,
      }));
    },
  });
})();
