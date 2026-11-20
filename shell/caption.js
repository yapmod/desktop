// Shared by the local loading screen and the signed-in Yapin header.
function installWindowCaption(bar, platform, action) {
  const abort = new AbortController();
  const { signal } = abort;
  let controls;
  if (platform === "macos" || platform === "windows") {
    bar.addEventListener("mousedown", event => {
      if (!event.isTrusted || event.button !== 0 ||
          event.target.closest("button, a, input, select, textarea, [role=button], [contenteditable=true]")) return;
      event.preventDefault();
      void action(event.detail === 2 ? "toggleMaximize" : "drag");
    }, { signal });
  }
  if (platform === "windows") {
    controls = document.createElement("div");
    controls.className = "yapmod-window-controls";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "Window controls");
    const buttons = {};
    for (const [command, label] of [["minimize", "Minimize"], ["toggleMaximize", "Maximize"], ["close", "Close"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.command = command;
      button.title = label;
      button.setAttribute("aria-label", label);
      button.append(document.createElement("i"));
      button.addEventListener("click", async event => {
        if (!event.isTrusted) return;
        await action(command);
        if (command === "toggleMaximize") void updateMaximize();
      }, { signal });
      controls.append(button);
      buttons[command] = button;
    }
    async function updateMaximize() {
      const maximized = await action("isMaximized");
      const button = buttons.toggleMaximize;
      const label = maximized ? "Restore" : "Maximize";
      button.classList.toggle("restore", maximized);
      button.title = label;
      button.setAttribute("aria-label", label);
    }
    bar.append(controls);
    window.addEventListener("resize", updateMaximize, { signal });
    void updateMaximize();
  }
  return () => { abort.abort(); controls?.remove(); };
}
