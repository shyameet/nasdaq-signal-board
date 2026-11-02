// Labels on / off (owner 24/10/2026: "i dont want to see these values on my chart but rahul might"). One button in the
// top bar of every page hides the texts drawn over the charts: the price chart's corner line (time, O H L C, gate, EMA
// values), the numbers beside each wave in the Entry / Trend labels (the wave names stay, so they still switch the
// waves) and the gate conditions in the chart headers. Kept in this browser for every page.
// Pane labels on / off (owner 2/11/2026: "an option to switch off the labels of the trend swing panes ... they are taking
// much of my screen ... just their labels so i could see the whole chart"): a second button beside it hides the Entry,
// Trend and Swing panes' labels altogether (their line switches with them: shown again, they switch the lines as before).
(function () {
  const KEY = "sb-labels", PKEY = "sb-pane-labels";
  const css = `
    body.no-labels .pane > .tag:not(.mix), body.no-labels .tag.mix .t-v, body.no-labels .t-vals,
    body.no-labels .phead > .gk, body.no-labels .phead > .gw, body.no-labels .phead > .conds, body.no-labels .phead > .other,
    body.no-labels .rules { display: none !important; }
    body.no-pane-labels .tag.mix { display: none !important; }
    .lb-btn { font: 600 12px/1 inherit; font-family: inherit; color: var(--muted, #8a8f98); background: var(--bg, #0f1115);
      border: 1px solid var(--line, #2a2e36); border-radius: 7px; padding: 6px 10px; cursor: pointer; white-space: nowrap; }
    .lb-btn:hover, .lb-btn:focus-visible { color: var(--text, #e6e6e6); border-color: var(--line-strong, #3a3f49); }
    .lb-btn[aria-pressed="true"] { color: var(--text, #e6e6e6); border-color: var(--accent, #5b8cff); }`;
  const get = (key) => { try { return localStorage.getItem(key) !== "0"; } catch (e) { return true; } };   // on unless switched off
  const put = (key, on) => { try { localStorage.setItem(key, on ? "1" : "0"); } catch (e) { /* not kept: fine */ } };

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  // one button: its body class (set while it is OFF), its key, its text and its two tooltips (on, off)
  function button(cls, key, text, tipOn, tipOff) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "lb-btn"; btn.textContent = text;
    const set = (on) => {
      document.body.classList.toggle(cls, !on);
      btn.setAttribute("aria-pressed", String(on));
      btn.title = on ? tipOn : tipOff;
      put(key, on);
    };
    btn.addEventListener("click", () => set(btn.getAttribute("aria-pressed") !== "true"));
    return { btn, set: () => set(get(key)) };
  }
  const labels = button("no-labels", KEY, "Labels", "Hide the values and labels drawn over the charts", "Show the values and labels over the charts");
  const panes = button("no-pane-labels", PKEY, "Pane labels", "Hide the Entry, Trend and Swing panes' labels (their line switches too), to see the whole panes",
                       "Show the Entry, Trend and Swing panes' labels (their line switches)");

  function mount() {
    const bar = document.querySelector(".topbar");
    if (!bar) return;
    bar.appendChild(labels.btn);
    bar.appendChild(panes.btn);
    labels.set(); panes.set();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
