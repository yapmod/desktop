// Rust supplies the verified client, bundled plugin and optional signed plugin.
(function bootstrap(startClient, bundledPlugin, updatedPluginSource) {
  if (window !== window.top ||
      !["https://www.yapin.gg", "https://yapin.gg"].includes(location.origin)) return;

  const key = Symbol.for("yapmod.desktop.bootstrap");
  const previous = window[key];
  if (previous?.loading || (previous?.client && previous.client === window.YapmodClient)) return;
  const state = { loading: true };
  window[key] = state;

  async function registerPlugins(client) {
    const bridge = Object.freeze({
      invoke: (command, args) => window.__TAURI_INTERNALS__.invoke(command, args),
    });
    if (updatedPluginSource) {
      // Isolate parse errors in a plugin release from the client and local fallback.
      const blob = new Blob(["export default ", updatedPluginSource], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      try {
        const { default: register } = await import(url);
        await register(client, bridge);
        return;
      } catch (error) {
        console.warn("[yapmod-desktop] Using the bundled desktop plugin.", error);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    await bundledPlugin(client, bridge);
  }

  async function start() {
    try {
      if (!window.YapmodClient) startClient();
      const client = window.YapmodClient;
      if (client?.state !== "ready" || typeof client.registerClientPlugin !== "function") {
        throw new Error("The client did not expose its plugin API.");
      }
      await registerPlugins(client);
      state.client = client;
    } catch (error) {
      console.error("[yapmod-desktop] Initialization failed.", error);
    } finally {
      state.loading = false;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    void start();
  }
})
