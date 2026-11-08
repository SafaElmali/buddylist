// Keep every installer available; only the main download buttons follow the visitor's OS.
const DOWNLOADS = {
  mac: { label: 'Download for Mac' },
  windows: { label: 'Download for Windows' },
  linux: { label: 'Download for Linux' },
};

/** A supported desktop OS, or null when the visitor should choose an installer themselves. */
export function desktopPlatform({ userAgentData, platform = '', userAgent = '', maxTouchPoints = 0 } = {}) {
  const system = userAgentData?.platform || platform;
  if (
    userAgentData?.mobile ||
    /Android|iPhone|iPad|iPod|CrOS/i.test(`${system} ${userAgent}`) ||
    (/Mac/i.test(system) && maxTouchPoints > 1)
  )
    return null;
  if (/Mac/i.test(system) || /Macintosh/i.test(userAgent)) return 'mac';
  // Intel/AMD x64 are the only Windows and Linux builds. Do not guess from a mobile or ARM browser.
  if (/arm|aarch64/i.test(`${userAgentData?.architecture || ''} ${system} ${userAgent}`)) return null;
  if (/^Win/i.test(system) || /Windows NT/i.test(userAgent)) return 'windows';
  if (/Linux/i.test(system) || /Linux/i.test(userAgent)) return 'linux';
  return null;
}

export function configureDownloads(root, device) {
  const platform = desktopPlatform(device);
  const choice = DOWNLOADS[platform];
  const installer = platform && root.querySelector(`[data-download-platform="${platform}"]`);
  if (!choice || !installer) return;
  const card = root.querySelector(`[data-platform-card="${platform}"]`);
  if (card) {
    card.classList.add('is-current');
    card.querySelector('.download-current').hidden = false;
  }
  for (const link of root.querySelectorAll('[data-download-auto]')) {
    link.setAttribute('href', installer.getAttribute('href'));
    link.setAttribute('aria-label', choice.label);
    const label = link.querySelector('[data-download-label]');
    if (label) label.textContent = choice.label;
  }
}
