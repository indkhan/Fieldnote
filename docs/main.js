const RELEASE_API = 'https://api.github.com/repos/indkhan/Fieldnote/releases/latest';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function detectPlatform() {
  const hint = `${navigator.userAgentData?.platform ?? ''} ${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (/iphone|ipad|android/.test(hint)) return null;
  if (hint.includes('win')) return 'windows';
  if (hint.includes('mac')) return 'mac';
  if (hint.includes('linux')) return 'linux';
  return null;
}

function setUpDownloads() {
  const platform = detectPlatform();
  const names = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };
  const primary = document.querySelectorAll('[data-primary-download]');
  if (platform) {
    for (const link of primary) {
      link.querySelector('[data-primary-label]').textContent = `Download for ${names[platform]}`;
      if (platform === 'windows') link.dataset.asset = 'windows';
    }
    document.querySelector(`[data-platform="${platform}"]`)?.classList.add('current');
    document.querySelector(`[data-platform="${platform}"] .dl-tag`)?.removeAttribute('hidden');
  }

  // Links work without this. It only upgrades them to direct files once the release is known.
  const assetPatterns = {
    windows: /_x64-setup\.exe$/,
    'mac-arm': /_aarch64\.dmg$/,
    'mac-intel': /_x64\.dmg$/,
    appimage: /\.AppImage$/,
    deb: /\.deb$/,
  };
  fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
    .then(response => (response.ok ? response.json() : Promise.reject(response.status)))
    .then(release => {
      for (const link of document.querySelectorAll('[data-asset]')) {
        const asset = release.assets?.find(file => assetPatterns[link.dataset.asset]?.test(file.name));
        if (asset) link.href = asset.browser_download_url;
      }
      for (const label of document.querySelectorAll('[data-version]')) label.textContent = release.tag_name;
    })
    .catch(() => {});
}

function setUpTabs() {
  for (const group of document.querySelectorAll('[role="tablist"]')) {
    const tabs = [...group.querySelectorAll('[role="tab"]')];
    const select = tab => {
      for (const other of tabs) {
        const active = other === tab;
        other.setAttribute('aria-selected', String(active));
        other.tabIndex = active ? 0 : -1;
        const panel = other.getAttribute('aria-controls');
        if (panel) document.getElementById(panel).hidden = !active;
      }
      if (tab.dataset.text) document.querySelector(group.dataset.textTarget).textContent = tab.dataset.text;
    };
    for (const tab of tabs) {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', event => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!step) return;
        const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
        select(next);
        next.focus();
      });
    }
  }
}

function setUpRecordingDemo() {
  const panel = document.querySelector('#demo-panel');
  if (!panel) return;
  const barCount = innerWidth < 560 ? 36 : 56;
  const bars = document.querySelector('#demo-bars');
  bars.innerHTML = '<i></i>'.repeat(barCount);
  const nodes = [...bars.children];
  const state = document.querySelector('#demo-state');
  const hint = document.querySelector('#demo-hint');
  const timer = document.querySelector('#demo-timer');
  const copy = {
    speaking: ['Someone is speaking', 'Your voice is being recorded.'],
    waiting: ['Listening…', 'Recording. Start talking whenever you are ready.'],
  };
  const history = [];
  let tick = 0;

  const level = t => {
    const inPause = t % 62 > 46;
    if (inPause) return 0;
    const phrase = Math.max(0, Math.sin(t * 0.21));
    return Math.pow(phrase * Math.abs(Math.sin(t * 0.73)) * (0.6 + 0.4 * Math.sin(t * 2.3)), 0.6);
  };
  const paint = () => {
    const speaking = history.slice(-5).some(sample => sample.height > 0.12);
    const kind = speaking ? 'speaking' : 'waiting';
    panel.dataset.voice = kind;
    if (state.textContent !== copy[kind][0]) {
      state.textContent = copy[kind][0];
      hint.textContent = copy[kind][1];
    }
    const offset = barCount - history.length;
    nodes.forEach((bar, index) => {
      const sample = history[index - offset];
      bar.style.height = `${Math.max(6, (sample?.height ?? 0) * 100)}%`;
      bar.classList.toggle('on', Boolean(sample?.voice));
    });
    const seconds = Math.floor(tick / 10);
    timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const advance = () => {
    tick += 1;
    const height = Math.abs(level(tick));
    history.push({ height, voice: height > 0.12 });
    if (history.length > barCount) history.shift();
  };

  // Start with a full waveform, so the panel makes sense before anyone has watched it.
  tick = 12;
  for (let i = 0; i < barCount; i += 1) advance();
  tick = 12 * 10;
  paint();
  if (reducedMotion) return;

  let visible = false;
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; }).observe(panel);
  setInterval(() => {
    if (!visible || document.hidden) return;
    advance();
    paint();
  }, 100);
}

function setUpNav() {
  const nav = document.querySelector('.nav');
  const update = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', update, { passive: true });
  update();
}

setUpNav();
setUpTabs();
setUpDownloads();
setUpRecordingDemo();
