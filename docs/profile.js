(() => {
  const cfg = window.MSR_PUBLIC_CONFIG || {};
  const $ = id => document.getElementById(id);
  let client = null;
  let currentProfile = {
    station_name: cfg.stationName || 'Manu Stream Radio',
    slogan: cfg.tagline || '',
    logo_data_url: ''
  };

  const initials = name => {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    return (words.slice(0, 3).map(w => w[0]).join('') || 'SR').toUpperCase();
  };

  const ensureDiscLogo = (disc, logo, name) => {
    if (!disc) return;
    let img = disc.querySelector('img.station-disc-logo');
    let span = disc.querySelector('span');
    if (logo) {
      if (!img) {
        img = document.createElement('img');
        img.className = 'station-disc-logo';
        img.alt = `Logo de ${name}`;
        disc.appendChild(img);
      }
      img.src = logo;
      img.hidden = false;
      if (span) span.hidden = true;
      disc.classList.add('has-station-logo');
    } else {
      if (img) img.hidden = true;
      if (span) { span.hidden = false; span.textContent = initials(name); }
      disc.classList.remove('has-station-logo');
    }
  };

  const applyProfile = profile => {
    if (!profile) return;
    currentProfile = { ...currentProfile, ...profile };
    const name = String(currentProfile.station_name || cfg.stationName || 'Manu Stream Radio').trim() || 'Manu Stream Radio';
    const slogan = String(currentProfile.slogan || cfg.tagline || '').trim();
    const logo = String(currentProfile.logo_data_url || '').trim();

    document.title = `${name} — Écouter`;
    if ($('stationName')) $('stationName').textContent = name;
    if ($('tagline')) $('tagline').textContent = slogan;
    if ($('stationFooterName')) $('stationFooterName').textContent = name;

    const box = $('stationLogoBox');
    const img = $('stationLogo');
    const letters = $('stationInitials');
    if (box && img && letters) {
      if (logo) {
        img.src = logo;
        img.alt = `Logo de ${name}`;
        img.hidden = false;
        letters.hidden = true;
        box.classList.add('has-logo');
      } else {
        img.removeAttribute('src');
        img.hidden = true;
        letters.hidden = false;
        letters.textContent = initials(name);
        box.classList.remove('has-logo');
      }
    }

    document.querySelectorAll('.audio-copy h3').forEach(el => { el.textContent = name; });
    document.querySelectorAll('.radio-disc').forEach(el => ensureDiscLogo(el, logo, name));
    document.querySelectorAll('.placeholder b').forEach(el => {
      if (/Connexion à/i.test(el.textContent || '')) el.textContent = `Connexion à ${name}…`;
    });
  };

  const refresh = async () => {
    if (!cfg.stationId || !cfg.supabaseUrl || !cfg.supabasePublishableKey) return;
    try {
      if (!client) {
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.116.0');
        client = createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
      }
      const { data, error } = await client
        .from('radio_station_profile')
        .select('station_name,slogan,logo_data_url,updated_at')
        .eq('station_id', cfg.stationId)
        .maybeSingle();
      if (error) throw error;
      if (data) applyProfile(data);
    } catch (err) {
      console.warn('Profil public station indisponible', err);
    }
  };

  applyProfile(currentProfile);
  const player = $('mainPlayer');
  if (player) new MutationObserver(() => applyProfile(currentProfile)).observe(player, { childList: true, subtree: true });
  void refresh();
  setInterval(() => void refresh(), 8000);
})();
