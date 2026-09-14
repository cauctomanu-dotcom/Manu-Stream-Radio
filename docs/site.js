(async () => {
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
  const liveBadge = $('liveBadge');
  const nowTitle = $('nowTitle');
  const VOLUME_KEY = 'msr-listener-volume-v1';
  const MUTE_KEY = 'msr-listener-muted-v1';
  let listenerVolume = Math.min(1, Math.max(0, Number(localStorage.getItem(VOLUME_KEY) ?? 80) / 100));
  let listenerMuted = localStorage.getItem(MUTE_KEY) === '1';

  const volumeMarkup = () => `
    <div class="volume-control" aria-label="Volume d'écoute">
      <button id="volumeMuteBtn" class="volume-btn mute" type="button" aria-label="Couper ou remettre le son">${listenerMuted ? '🔇' : '🔊'}</button>
      <button id="volumeDownBtn" class="volume-btn" type="button" aria-label="Baisser le volume">−</button>
      <input id="listenerVolume" class="volume-slider" type="range" min="0" max="100" step="1" value="${Math.round(listenerVolume * 100)}" aria-label="Volume">
      <button id="volumeUpBtn" class="volume-btn" type="button" aria-label="Monter le volume">+</button>
      <strong id="volumeValue" class="volume-value">${listenerMuted ? 0 : Math.round(listenerVolume * 100)}%</strong>
    </div>`;

  const bindVolumeControls = applyVolume => {
    const slider = $('listenerVolume');
    const value = $('volumeValue');
    const muteBtn = $('volumeMuteBtn');
    const downBtn = $('volumeDownBtn');
    const upBtn = $('volumeUpBtn');
    if (!slider || !value || !muteBtn || !downBtn || !upBtn) return;

    const render = () => {
      slider.value = String(Math.round(listenerVolume * 100));
      value.textContent = `${listenerMuted ? 0 : Math.round(listenerVolume * 100)}%`;
      muteBtn.textContent = listenerMuted ? '🔇' : (listenerVolume < 0.5 ? '🔉' : '🔊');
      muteBtn.classList.toggle('active', listenerMuted);
      applyVolume(listenerMuted ? 0 : listenerVolume);
    };

    const setVolume = percent => {
      const p = Math.min(100, Math.max(0, Math.round(percent)));
      listenerVolume = p / 100;
      if (p > 0) listenerMuted = false;
      localStorage.setItem(VOLUME_KEY, String(p));
      localStorage.setItem(MUTE_KEY, listenerMuted ? '1' : '0');
      render();
    };

    slider.addEventListener('input', () => setVolume(Number(slider.value)));
    downBtn.addEventListener('click', () => setVolume(listenerVolume * 100 - 10));
    upBtn.addEventListener('click', () => setVolume(listenerVolume * 100 + 10));
    muteBtn.addEventListener('click', () => {
      listenerMuted = !listenerMuted;
      localStorage.setItem(MUTE_KEY, listenerMuted ? '1' : '0');
      render();
    });
    render();
  };

  const setLive = (live, text) => {
    liveBadge.classList.toggle('live', !!live);
    liveBadge.classList.toggle('offline', !live);
    liveBadge.innerHTML = `<span></span> ${live ? 'EN DIRECT' : 'HORS ANTENNE'}`;
    if (text) sub.textContent = text;
  };

  const setIframe = (src, label, allow) => {
    const iframe = document.createElement('iframe');
    iframe.allow = allow;
    iframe.allowFullscreen = true;
    iframe.src = src;
    box.classList.remove('empty', 'audio-mode', 'realtime-mode');
    box.replaceChildren(iframe);
    badge.textContent = label;
    sub.textContent = 'Direct intégré — aucune plateforme à choisir.';
  };

  const setAudio = src => {
    const wrap = document.createElement('div');
    wrap.className = 'audio-stage';
    wrap.innerHTML = `<div class="radio-disc"><span>MSR</span></div><div class="audio-copy"><p class="eyebrow">FLUX RADIO DIRECT</p><h3>${stationName}</h3><p>Appuie sur lecture pour écouter le direct.</p>${volumeMarkup()}</div>`;
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'none';
    audio.src = src;
    wrap.appendChild(audio);
    box.classList.remove('empty', 'realtime-mode');
    box.classList.add('audio-mode');
    box.replaceChildren(wrap);
    bindVolumeControls(v => { audio.volume = v; });
    badge.textContent = 'FLUX RADIO DIRECT';
    sub.textContent = 'Flux radio direct intégré.';
  };

  const setupRealtimeBridge = async () => {
    box.classList.remove('empty', 'audio-mode');
    box.classList.add('realtime-mode');
    box.innerHTML = `
      <div class="realtime-stage">
        <div class="radio-disc"><span>MSR</span></div>
        <div class="audio-copy">
          <p class="eyebrow">MASTER STUDIO · TEST REALTIME</p>
          <h3>${stationName}</h3>
          <p id="radioSignalText">Connexion au studio…</p>
          <button id="listenLiveBtn" class="listen-button" type="button">▶ ÉCOUTER LE DIRECT</button>
          ${volumeMarkup()}
          <small id="radioLatencyText">Tampon anti-coupures activé · quelques secondes de retard sont normales.</small>
        </div>
      </div>`;
    badge.textContent = 'WEB RADIO · TEST';

    const signalText = $('radioSignalText');
    const latencyText = $('radioLatencyText');
    const listenBtn = $('listenLiveBtn');
    const BUFFER_SEGMENTS = 3;
    let armed = false;
    let audioCtx = null;
    let masterGain = null;
    let nextPlayAt = 0;
    let lastHeartbeat = 0;
    let currentMime = 'audio/webm;codecs=opus';
    let decoding = false;
    let primed = false;
    let fallbackPlaying = false;
    let fallbackAudio = null;
    const rawQueue = [];
    const decodedQueue = [];
    const fallbackQueue = [];

    const ensureAudioContext = () => {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = listenerMuted ? 0 : listenerVolume;
        masterGain.connect(audioCtx.destination);
      }
      return audioCtx;
    };

    bindVolumeControls(v => {
      if (masterGain && audioCtx) masterGain.gain.setValueAtTime(v, audioCtx.currentTime);
      if (fallbackAudio) fallbackAudio.volume = v;
    });

    const extractBinary = msg => {
      const p = msg?.payload ?? msg;
      if (p instanceof ArrayBuffer) return p;
      if (ArrayBuffer.isView(p)) return p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength);
      if (p?.data instanceof ArrayBuffer) return p.data;
      if (ArrayBuffer.isView(p?.data)) return p.data.buffer.slice(p.data.byteOffset, p.data.byteOffset + p.data.byteLength);
      return null;
    };

    const playFallback = () => {
      if (!armed || fallbackPlaying || !fallbackQueue.length) return;
      fallbackPlaying = true;
      const buf = fallbackQueue.shift();
      const url = URL.createObjectURL(new Blob([buf], { type: currentMime }));
      const audio = new Audio(url);
      fallbackAudio = audio;
      audio.volume = listenerMuted ? 0 : listenerVolume;
      audio.onended = audio.onerror = () => {
        URL.revokeObjectURL(url);
        fallbackPlaying = false;
        fallbackAudio = null;
        playFallback();
      };
      audio.play().catch(() => {
        URL.revokeObjectURL(url);
        fallbackPlaying = false;
        fallbackAudio = null;
      });
    };

    const pumpDecoded = () => {
      if (!armed || !audioCtx || !masterGain) return;
      const now = audioCtx.currentTime;
      if (primed && nextPlayAt && nextPlayAt < now + 0.06) {
        primed = false;
        nextPlayAt = 0;
        latencyText.textContent = `Réseau irrégulier · rechargement du tampon ${decodedQueue.length}/${BUFFER_SEGMENTS}`;
      }
      if (!primed) {
        if (decodedQueue.length < BUFFER_SEGMENTS) {
          latencyText.textContent = `Préchargement audio ${decodedQueue.length}/${BUFFER_SEGMENTS}…`;
          return;
        }
        primed = true;
        nextPlayAt = now + 0.28;
      }
      while (decodedQueue.length) {
        const decoded = decodedQueue.shift();
        const src = audioCtx.createBufferSource();
        src.buffer = decoded;
        src.connect(masterGain);
        src.start(nextPlayAt);
        nextPlayAt += decoded.duration;
      }
      latencyText.textContent = `Direct stabilisé · tampon ${(Math.max(0, nextPlayAt - now)).toFixed(1)} s`;
    };

    const processRawQueue = async () => {
      if (decoding || !armed) return;
      ensureAudioContext();
      decoding = true;
      try {
        while (armed && rawQueue.length) {
          const buf = rawQueue.shift();
          try {
            const decoded = await audioCtx.decodeAudioData(buf.slice(0));
            decodedQueue.push(decoded);
            if (decodedQueue.length > 8) decodedQueue.splice(0, decodedQueue.length - 8);
            pumpDecoded();
          } catch {
            fallbackQueue.push(buf.slice(0));
            if (fallbackQueue.length > 5) fallbackQueue.splice(0, fallbackQueue.length - 4);
            playFallback();
          }
        }
      } finally {
        decoding = false;
        if (armed && rawQueue.length) void processRawQueue();
      }
    };

    const enqueueSegment = buf => {
      if (!armed) {
        signalText.textContent = 'Signal reçu — clique sur ÉCOUTER LE DIRECT.';
        return;
      }
      rawQueue.push(buf.slice(0));
      if (rawQueue.length > 10) rawQueue.splice(0, rawQueue.length - 8);
      void processRawQueue();
    };

    listenBtn.onclick = async () => {
      armed = !armed;
      if (armed) {
        ensureAudioContext();
        await audioCtx.resume().catch(() => {});
        nextPlayAt = 0;
        primed = false;
        rawQueue.length = 0;
        decodedQueue.length = 0;
        fallbackQueue.length = 0;
        listenBtn.textContent = '■ COUPER LE SON';
        listenBtn.classList.add('active');
        signalText.textContent = lastHeartbeat ? 'Écoute activée — création du tampon anti-coupures…' : 'Écoute activée — attente du studio…';
        latencyText.textContent = `Préchargement audio 0/${BUFFER_SEGMENTS}…`;
      } else {
        listenBtn.textContent = '▶ ÉCOUTER LE DIRECT';
        listenBtn.classList.remove('active');
        nextPlayAt = 0;
        primed = false;
        rawQueue.length = 0;
        decodedQueue.length = 0;
        fallbackQueue.length = 0;
        if (fallbackAudio) {
          fallbackAudio.pause();
          fallbackAudio = null;
          fallbackPlaying = false;
        }
        if (audioCtx) await audioCtx.suspend().catch(() => {});
      }
    };

    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.116.0');
      const supabase = createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { params: { eventsPerSecond: 20 } }
      });
      const channel = supabase.channel(cfg.realtimeTopic, { config: { broadcast: { ack: false, self: false } } });
      channel
        .on('broadcast', { event: 'radio-state' }, msg => {
          const state = msg?.payload || {};
          lastHeartbeat = Date.now();
          currentMime = state.mime || currentMime;
          if (state.title) nowTitle.textContent = state.title;
          if (state.live) {
            setLive(true, state.artist ? `${state.artist} · ${state.mode || 'EN DIRECT'}` : (state.mode || 'EN DIRECT'));
            signalText.textContent = armed ? 'Studio connecté — écoute en cours.' : 'Studio connecté — clique sur ÉCOUTER LE DIRECT.';
            badge.textContent = 'MASTER STUDIO';
          } else {
            setLive(false, 'Le studio est actuellement hors antenne.');
            signalText.textContent = 'Hors antenne — la page attend le prochain direct.';
          }
        })
        .on('broadcast', { event: 'audio-segment' }, msg => {
          lastHeartbeat = Date.now();
          const bin = extractBinary(msg);
          if (bin?.byteLength) {
            setLive(true);
            enqueueSegment(bin);
          }
        })
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') signalText.textContent = 'Connecté — en attente du signal du studio.';
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') signalText.textContent = `Connexion radio impossible${err?.message ? ` : ${err.message}` : ''}`;
        });

      setInterval(() => {
        if (lastHeartbeat && Date.now() - lastHeartbeat > 12000) {
          setLive(false, 'Le studio ne transmet pas actuellement.');
          signalText.textContent = 'Aucun signal récent — attente du studio.';
          lastHeartbeat = 0;
          primed = false;
          nextPlayAt = 0;
          rawQueue.length = 0;
          decodedQueue.length = 0;
        }
      }, 3000);
    } catch (err) {
      signalText.textContent = `Pont radio indisponible : ${err.message}`;
      badge.textContent = 'ERREUR CONNEXION';
    }
  };

  if (cfg.realtimeEnabled && cfg.supabaseUrl && cfg.supabasePublishableKey && cfg.realtimeTopic) {
    await setupRealtimeBridge();
  } else if (cfg.audioStreamUrl) {
    setAudio(cfg.audioStreamUrl);
  } else if (cfg.twitchChannel) {
    setIframe(`https://player.twitch.tv/?channel=${encodeURIComponent(cfg.twitchChannel)}&parent=${encodeURIComponent(host)}&autoplay=false`, 'DIRECT INTÉGRÉ', 'autoplay; fullscreen');
  } else if (cfg.youtubeChannelId) {
    setIframe(`https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(cfg.youtubeChannelId)}&autoplay=0`, 'DIRECT INTÉGRÉ', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
  }
})();
