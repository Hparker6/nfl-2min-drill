/*
 * The ad slots on the static pages (the guide) and the Worker's pages (the leaderboard, the stats): filled here, since
 * the pages' security policy allows no inline scripts. The game fills its own slots (src/ui/AdSlot.tsx).
 * Google's script loads once, only when the page has a slot. A browser the game knows belongs to a Coach's Edition
 * owner (no ads is part of what they bought) gets no script and no slots.
 */
(function () {
  var slots = document.querySelectorAll('ins.adsbygoogle.ad-page');
  if (!slots.length) return;
  var owner = false;
  try {
    owner = localStorage.getItem('the4thcall:account:payments') === 'live'
      && JSON.parse(localStorage.getItem('the4thcall:account:owns') || '[]').indexOf('coach_edition') >= 0;
  } catch (e) { /* storage off: not known to be an owner */ }
  if (owner) {
    for (var i = 0; i < slots.length; i++) { var box = slots[i].closest('.ad-slot'); if (box) box.remove(); }
    return;
  }
  var s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2581780385461126';
  document.head.appendChild(s);
  window.adsbygoogle = window.adsbygoogle || [];
  // one push per slot (the queue works before the script arrives; an ad blocker just leaves them empty)
  for (var j = 0; j < slots.length; j++) { try { window.adsbygoogle.push({}); } catch (e) { /* blocked */ } }
})();
