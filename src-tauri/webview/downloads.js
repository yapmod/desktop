// Cross-origin links ignore the download attribute, even when it has a filename.
(() => {
  if (window !== window.top || !["https://www.yapin.gg", "https://yapin.gg"].includes(location.origin)) return;
  if (window.__TAURI_INTERNALS__?.metadata.currentWebview.label !== "yapin") return;
  const key = Symbol.for("yapmod.desktop.downloads");
  if (window[key]) return;
  window[key] = true;
  const pending = new WeakSet();

  document.addEventListener("click", async (event) => {
    const link = event.target.closest?.("a[download]");
    if (!link || event.defaultPrevented || event.button !== 0) return;
    const url = new URL(link.href);
    if (url.protocol !== "https:" || url.origin === location.origin) return;
    event.preventDefault();
    event.stopPropagation();
    if (pending.has(link)) return;
    pending.add(link);
    try {
      const response = await fetch(url.href);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = URL.createObjectURL(await response.blob());
      const download = document.createElement("a");
      download.href = blob;
      download.download = link.download || "download";
      document.body.append(download);
      download.click();
      download.remove();
      // Give the WebView time to take ownership of the blob before releasing it.
      setTimeout(() => URL.revokeObjectURL(blob), 60_000);
    } catch (error) {
      console.error("Could not download the attachment:", error);
      window.alert("The file could not be downloaded. Please try again.");
    } finally {
      pending.delete(link);
    }
  }, true);
})();
