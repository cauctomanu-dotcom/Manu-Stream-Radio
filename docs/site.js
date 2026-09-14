(() => {
  const cfg = window.MSR_PUBLIC_CONFIG || {};
  const $ = id => document.getElementById(id);
  $('stationName').textContent = cfg.stationName || 'Manu Stream Radio';
  $('tagline').textContent = cfg.tagline || '';
  $('nextShow').textContent = cfg.nextShow || 'À annoncer';
  $('contactText').textContent = cfg.contactText || 'Manu Stream';

  const host = location.hostname || 'cauctomanu-dotcom.github.io';
  if (cfg.twitchChannel) {
    const iframe = document.createElement('iframe');
    iframe.allow = 'autoplay; fullscreen';
    iframe.allowFullscreen = true;
    iframe.src = `https://player.twitch.tv/?channel=${encodeURIComponent(cfg.twitchChannel)}&parent=${encodeURIComponent(host)}&autoplay=false`;
    const box = $('twitchPlayer');
    box.classList.remove('empty'); box.replaceChildren(iframe);
  }

  if (cfg.youtubeChannelId) {
    const iframe = document.createElement('iframe');
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.src = `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(cfg.youtubeChannelId)}&autoplay=0`;
    const box = $('youtubePlayer');
    box.classList.remove('empty'); box.replaceChildren(iframe);
  }

  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === btn));
    document.querySelectorAll('.player-panel').forEach(x => x.classList.toggle('active', x.id === btn.dataset.target));
  }));
})();
