// Install button (owner 30/10/2026: "add something to let me install it as an app"). Shows in the toolbar only on a
// touch screen (the tablet), only in the browser (not inside the installed app), and only when Chrome says the app
// can be installed; on desktop nothing changes. The installed app opens fullscreen (brand/site.webmanifest).
(function () {
  const touch = matchMedia('(pointer: coarse)').matches;
  const inApp = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  if (!touch) return;
  // Owner 30/10: an app installed before the fullscreen setting still opens with the status bar until Chrome updates
  // it, so inside the installed app the first tap goes fullscreen (browsers allow it only on a tap). Android hides the
  // bottom bar with it; leaving the page, switching apps or swiping out ends it and the next tap brings it back
  if (matchMedia('(display-mode: standalone)').matches && document.documentElement.requestFullscreen) {
    addEventListener('pointerup', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }, true);
  }
  if (inApp) return;
  let ask = null, btn = null;
  function show() {
    const bar = document.querySelector('.topbar');
    if (!bar || btn) return;
    btn = document.createElement('button');
    btn.className = 'btn'; btn.type = 'button'; btn.id = 'installApp';
    btn.textContent = 'Install app'; btn.title = 'Add the Signal Board to the home screen; it opens fullscreen';
    btn.onclick = async () => {
      if (!ask) return;
      ask.prompt();
      const r = await ask.userChoice;
      if (r && r.outcome === 'accepted') btn.remove();
      ask = null;
    };
    const spot = bar.querySelector('.spacer');
    bar.insertBefore(btn, spot ? spot.nextSibling : null);
  }
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); ask = e;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
  });
  addEventListener('appinstalled', () => { if (btn) btn.remove(); });
})();
