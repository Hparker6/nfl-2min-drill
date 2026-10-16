import { useEffect, useState } from 'react';

/**
 * A tab left open keeps running the version it loaded (phones keep tabs for days). When the tab comes back into
 * view, and every ten minutes, look at the live page: if it loads a different build, offer a one-tap update.
 * Progress is saved as it is played, so reloading is safe.
 */
const BUILD = /assets\/index-[\w-]+\.js/;
export function UpdateBar() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const mine = [...document.scripts].map((s) => s.src.match(BUILD)?.[0]).find(Boolean);
    if (!mine) return;   // the dev server: nothing to compare
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        const live = html.match(BUILD)?.[0];
        if (live && live !== mine) setReady(true);
      } catch { /* offline: try again later */ }
      busy = false;
    };
    const id = setInterval(check, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, []);
  if (!ready) return null;
  return (
    <div className="updbar" role="status">
      <span>A new version of the game is ready.</span>
      <button className="btn primary" onClick={() => location.reload()}>Update</button>
    </div>
  );
}
