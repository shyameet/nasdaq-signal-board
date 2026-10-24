// Labels on / off (owner 24/10/2026: "i dont want to see these values on my chart but rahul might"). One button in the
// top bar of every page hides the texts drawn over the charts: the price chart's corner line (time, O H L C, gate, EMA
// values), the numbers beside each wave in the Entry / Trend labels (the wave names stay, so they still switch the
// waves) and the gate conditions in the chart headers. Kept in this browser for every page.
(function () {
  const KEY = "sb-labels";
  const css = `
    body.no-labels .pane > .tag:not(.mix), body.no-labels .tag.mix .t-v, body.no-labels .t-vals,
    body.no-labels .phead > .gk, body.no-labels .phead > .gw, body.no-labels .phead > .conds, body.no-labels .phead > .other,
    body.no-labels .rules { display: none !important; }
    .lb-btn { font: 600 12px/1 inherit; font-family: inherit; color: var(--muted, #8a8f98); background: var(--bg, #0f1115);
      border: 1px solid var(--line, #2a2e36); border-radius: 7px; padding: 6px 10px; cursor: pointer; white-space: nowrap; }
    .lb-btn:hover, .lb-btn:focus-visible { color: var(--text, #e6e6e6); border-color: var(--line-strong, #3a3f49); }
    .lb-btn[aria-pressed="true"] { color: var(--text, #e6e6e6); border-color: var(--accent, #5b8cff); }`;
  const get = () => { try { return localStorage.getItem(KEY) !== "0"; } catch (e) { return true; } };   // on unless switched off
  const put = (on) => { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) { /* not kept: fine */ } };

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "lb-btn";
  function set(on) {
    document.body.classList.toggle("no-labels", !on);
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = "Labels";
    btn.title = on ? "Hide the values and labels drawn over the charts" : "Show the values and labels over the charts";
    put(on);
  }
  btn.addEventListener("click", () => set(btn.getAttribute("aria-pressed") !== "true"));

  function mount() {
    const bar = document.querySelector(".topbar");
    if (!bar) return;
    bar.appendChild(btn);
    set(get());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
