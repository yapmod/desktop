function installBadge(platform) {
  if (window !== window.top ||
      !["https://www.yapin.gg", "https://yapin.gg"].includes(window.location.origin) ||
      window.__TAURI_INTERNALS__?.metadata.currentWebview.label !== "yapin" ||
      window.yapinDesktop) return;

  // Yapin discovers this bridge during startup and supplies its unread count.
  // Keep it independent of the downloaded client's later plugin lifecycle.
  window.yapinDesktop = {
    platform,
    setBadge(count) {
      const value = typeof count === "number" && Number.isFinite(count) && count > 0
        ? Math.min(99, Math.trunc(count)) || null : null;
      void window.__TAURI_INTERNALS__.invoke("desktop_set_badge", { count: value })
        .catch(error => console.warn("[yapmod-desktop] Could not set the app badge.", error));
    },
  };
}
