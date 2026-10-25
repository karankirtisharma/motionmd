// Poster markup: thumbnail + lazy preview video.

(function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  window.MD_MEDIA = {
    poster: (p) => `media/p-${p.id}.jpg`,
    preview: (p) => `media/p-${p.id}.mp4`,
    full: (p) => `media/v-${p.media.clip}.mp4`,
  };

  // The <video> has no src until it is previewed (see app.js), so idle cards cost nothing.
  window.MD_POSTER = function (p, { eager = false } = {}) {
    const src = window.MD_MEDIA.poster(p);
    return `<div class="poster">
      <img src="${src}" alt="" decoding="async" ${eager ? '' : 'loading="lazy"'}>
      <video muted loop playsinline preload="none" data-src="${esc(window.MD_MEDIA.preview(p))}" aria-hidden="true"></video>
    </div>`;
  };

})();
