(() => {
  const cfg = window.MSR_PUBLIC_CONFIG || {};
  const $ = id => document.getElementById(id);
  const stationName = cfg.stationName || 'Manu Stream Radio';
  $('stationName').textContent = stationName;
  $('tagline').textContent = cfg.tagline || '';
  $('nextShow').textContent = cfg.nextShow || 'À annoncer';
  $('contactText').textContent = cfg.contactText || 'Manu Stream';

  const host = location.hostname || 'cauctomanu-dotcom.github.io';
  const box = $('mainPlayer');
  const badge = $('sourceBadge');
  const sub = $('nowSub');

  const setIframe = (src, label, allow) => {
    const iframe = document.createElement('iframe');
    iframe.allow = allow;
    iframe.allowFullscreen = true;
    iframe.src = src;
    box.classList.remove('empty', 'audio-mode');
    box.replaceChildren(iframe);
    badge.textContent = label;
    sub.textContent = 'Direct intégré — aucune plateforme à choisir.';
  };

  const setAudio = (src) => {
    const wrap = document.createElement('div');
    wrap.className = 'audio-stage';
    wrap.innerHTML = `<div class="radio-disc"><span>MSR</span></div><div class="audio-copy"><p class="eyebrow">FLUX RADIO DIRECT</p><h3>${stationName}</h3><p>Appuie sur lecture pour écouter le direct.</p></div>`;
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'none';
    audio.src = src;
    wrap.appendChild(audio);
    box.classList.remove('empty');
    box.classList.add('audio-mode');
    box.replaceChildren(wrap);
    badge.textContent = 'FLUX RADIO DIRECT';
    sub.textContent = 'Flux radio direct intégré.';
  };

  if (cfg.audioStreamUrl) {
    setAudio(cfg.audioStreamUrl);
  } else if (cfg.twitchChannel) {
    setIframe(
      `https://player.twitch.tv/?channel=${encodeURIComponent(cfg.twitchChannel)}&parent=${encodeURIComponent(host)}&autoplay=false`,
      'DIRECT INTÉGRÉ',
      'autoplay; fullscreen'
    );
  } else if (cfg.youtubeChannelId) {
    setIframe(
      `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(cfg.youtubeChannelId)}&autoplay=0`,
      'DIRECT INTÉGRÉ',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
    );
  }
})();
