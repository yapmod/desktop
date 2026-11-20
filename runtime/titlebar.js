// Runs independently of the downloadable client so window controls work offline.
(function integrateTitlebar(platform, logo, css, installCaption) {
  if (window !== window.top || !["https://www.yapin.gg", "https://yapin.gg"].includes(location.origin)) return;
  const native = window.__TAURI_INTERNALS__;
  if (native?.metadata.currentWebview.label !== "yapin" || !document.body) return;
  const key = Symbol.for("yapmod.desktop.titlebar");
  if (window[key]) { window[key](); return; }

  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  const desktopFrame = platform === "macos" || platform === "windows";
  let app, bar, removeCaption, integrated;
  let layoutUpdate = Promise.resolve();
  const appObserver = new MutationObserver(sync);
  const brandObserver = new MutationObserver(sync);
  const resize = new ResizeObserver(syncLayout);

  function syncLayout() {
    if (!desktopFrame) return;
    const visible = !!bar?.getBoundingClientRect().height;
    if (visible === integrated) return;
    integrated = visible;
    layoutUpdate = layoutUpdate.then(() => {
      if (visible === integrated) return native.invoke("set_integrated_titlebar", { integrated: visible });
    }).catch(error => {
      if (visible === integrated) integrated = undefined;
      console.warn("[yapmod-desktop] Could not update the title bar layout.", error);
    });
  }

  function sync() {
    const nextApp = document.body.querySelector(":scope > .app");
    if (app !== nextApp) {
      appObserver.disconnect();
      app = nextApp;
      if (app) appObserver.observe(app, { childList: true });
    }
    const nextBar = app?.querySelector(":scope > .topbar") ?? null;
    if (bar !== nextBar) {
      resize.disconnect();
      brandObserver.disconnect();
      removeCaption?.();
      bar = nextBar;
      if (bar) {
        bar.dataset.yapmodCaption = platform;
        removeCaption = installCaption(bar, platform, action => native.invoke("window_caption", { action }));
        brandObserver.observe(bar, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["src"] });
        resize.observe(bar);
      }
    }
    const brand = bar?.querySelector(".topbar-brand");
    const icon = brand?.querySelector("img");
    if (icon && icon.getAttribute("src") !== logo) icon.setAttribute("src", logo);
    for (const node of brand?.childNodes ?? []) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() && node.textContent !== "Yapmod") {
        node.textContent = "Yapmod";
      }
    }
    syncLayout();
  }

  // Only observe the app boundary and header. Chat messages can stream continuously.
  new MutationObserver(sync).observe(document.body, { childList: true });
  function renameTitle() {
    const title = document.title.replace(/(^|[|–—-]\s*|^\(\d+\+?\)\s*)Yapin[’']?$/i, "$1Yapmod");
    if (document.title !== title) document.title = title;
  }
  new MutationObserver(renameTitle).observe(document.head, { childList: true, subtree: true, characterData: true });
  function refresh() {
    integrated = undefined;
    sync();
  }
  window[key] = refresh;
  window.addEventListener("pageshow", refresh);
  renameTitle();
  refresh();
})
