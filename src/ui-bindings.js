export function createUIBindings(documentRef = document) {
  const byId = (id) => documentRef.getElementById(id);
  const nodes = {
    dot: byId('dot'), site: byId('site'), detail: byId('detail'), history: byId('history'), stream: byId('stream'),
    fatal: byId('fatal'), fatalText: byId('fatalText'), fatalCode: byId('fatalCode'), fatalCopy: byId('fatalCopy'),
    coords: byId('coords'), value: byId('value'), timeline: byId('timeline'),
    timeLeft: byId('timeLeft'), timeNow: byId('timeNow'), timeRight: byId('timeRight'),
    cacheProgress: byId('cacheProgress'), tracks: byId('tracks'),
  };

  function setStatus({ site, detail, history, stream, live = false, bad = false } = {}) {
    if (site !== undefined && nodes.site) nodes.site.textContent = String(site);
    if (detail !== undefined && nodes.detail) nodes.detail.textContent = String(detail);
    if (history !== undefined && nodes.history) nodes.history.textContent = String(history);
    if (stream !== undefined && nodes.stream) nodes.stream.textContent = String(stream);
    if (nodes.dot?.classList) {
      nodes.dot.classList.remove('live');
      nodes.dot.classList.remove('bad');
      if (bad) nodes.dot.classList.add('bad');
      else if (live) nodes.dot.classList.add('live');
    }
  }

  function setTimeline({ index = 0, count = 0, left = '—', now = '—', right = '—', progress = 0 } = {}) {
    const safeCount = Math.max(0, Number(count) || 0);
    const safeIndex = safeCount ? Math.min(safeCount - 1, Math.max(0, Number(index) || 0)) : 0;
    if (nodes.timeline) {
      nodes.timeline.min = '0';
      nodes.timeline.max = String(Math.max(0, safeCount - 1));
      nodes.timeline.value = String(safeIndex);
    }
    if (nodes.timeLeft) nodes.timeLeft.textContent = String(left);
    if (nodes.timeNow) nodes.timeNow.textContent = String(now);
    if (nodes.timeRight) nodes.timeRight.textContent = String(right);
    const fill = nodes.cacheProgress?.firstElementChild;
    if (fill?.style) fill.style.width = `${Math.round(Math.min(1, Math.max(0, Number(progress) || 0)) * 100)}%`;
  }

  function showFatal(error = {}) {
    if (nodes.fatalText) nodes.fatalText.textContent = String(error.message ?? 'Unknown error');
    if (nodes.fatalCode) nodes.fatalCode.textContent = [error.stage, error.code].filter(Boolean).join(' · ');
    if (nodes.fatal?.style) nodes.fatal.style.display = 'block';
  }

  function clearFatal() {
    if (nodes.fatal?.style) nodes.fatal.style.display = 'none';
    if (nodes.fatalText) nodes.fatalText.textContent = '';
    if (nodes.fatalCode) nodes.fatalCode.textContent = '';
  }

  return Object.freeze({
    nodes,
    setStatus,
    setTimeline,
    setCoordinates(text) { if (nodes.coords) nodes.coords.textContent = String(text ?? '—'); },
    setValue(text) { if (nodes.value) nodes.value.textContent = String(text ?? '—'); },
    showFatal,
    clearFatal,
    toggleTracks() { return nodes.tracks?.classList?.toggle('active') ?? false; },
    onCopyDebug(handler) { nodes.fatalCopy?.addEventListener?.('click', handler); },
  });
}
