// Charts only (owner 23/10/2026: "a minimize option for the settings ... so that we could only see the charts").
// One button in the top bar hides the top bar, the tabs, the setting rows and the drawing rail on every page; the charts
// take the room (they size themselves to their box). A small pill in the corner brings everything back, as does Esc.
// The choice is kept for the next page and the next visit.
(function () {
  const KEY = "sb-charts-only";
  const css = `
    body.charts-only .topbar, body.charts-only .controls, body.charts-only .strip, body.charts-only .rail,
    body.charts-only .dv > .top, body.charts-only .foot { display: none !important; }
    body.charts-only .board:has(> .rail) { grid-template-columns: minmax(0, 1fr) !important; }
    .co-btn { font: 600 12px/1 inherit; font-family: inherit; color: var(--muted, #8a8f98); background: var(--bg, #0f1115);
      border: 1px solid var(--line, #2a2e36); border-radius: 7px; padding: 6px 10px; cursor: pointer; white-space: nowrap; }
    .co-btn:hover, .co-btn:focus-visible { color: var(--text, #e6e6e6); border-color: var(--line-strong, #3a3f49); }
    .co-pill { position: fixed; left: calc(6px + env(safe-area-inset-left, 0px)); bottom: calc(6px + env(safe-area-inset-bottom, 0px));
      z-index: 50; opacity: .75; display: none; padding: 5px 9px; color: var(--text, #e6e6e6);
      border-color: var(--line-strong, #3a3f49); box-shadow: 0 2px 12px rgba(0, 0, 0, .45); }
    .co-pill:hover, .co-pill:focus-visible { opacity: 1; }
    body.charts-only .co-pill { display: inline-block; }`;
  const get = () => { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } };
  const put = (on) => { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) { /* not kept: fine */ } };

  function set(on) {
    document.body.classList.toggle("charts-only", on);
    btn.setAttribute("aria-pressed", String(on));
    put(on);
    window.dispatchEvent(new Event("resize"));            // any chart that listens to the window, not only its box
  }

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "co-btn"; btn.textContent = "Charts only";
  btn.title = "Hide the tabs and settings and show only the charts (Esc brings them back)";
  btn.addEventListener("click", () => set(true));
  const pill = document.createElement("button");
  pill.type = "button"; pill.className = "co-btn co-pill"; pill.textContent = "☰ Controls";
  pill.title = "Bring back the tabs and settings (Esc)";
  pill.addEventListener("click", () => set(false));

  function mount() {
    const bar = document.querySelector(".topbar");
    if (!bar) return;
    bar.appendChild(btn);
    document.body.appendChild(pill);
    if (get()) set(true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.body.classList.contains("charts-only")) set(false);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
