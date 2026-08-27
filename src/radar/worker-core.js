export class RadarWorkerError extends Error {
  constructor(code, stage, message, detail = '', sourceId = '') {
    super(message);
    this.name = 'RadarWorkerError';
    this.code = code;
    this.stage = stage;
    this.detail = detail || message;
    this.sourceId = sourceId;
  }
}

export class WorkerCore {
  constructor({ role, now = () => Date.now(), listVolumes, pipeline, diagnostics = null }) {
    this.role = role;
    this.now = now;
    this.listVolumes = listVolumes;
    this.pipeline = pipeline;
    this.diagnostics = diagnostics;
  }

  #log(level, stage, code, message, context = {}, error = null) {
    try { this.diagnostics?.record?.(level, stage, code, message, context, error); } catch {}
  }

  async selectSite({ site, productId = 1, lookbackMs = 2 * 60 * 60 * 1000 }) {
    const started = this.now();
    const end = this.now();
    const start = end - lookbackMs;
    this.#log('info', 'listing', 'WORKER_LIST_START', `Listing recent Level II volumes for ${site}`, { site, productId, lookbackMs, role: this.role });
    const listed = await this.listVolumes(site, start, end);
    const frames = listed.map((entry) => ({ site, objectKey: entry.objectKey ?? entry.key, scanStartMs: entry.scanStartMs, live: false }));
    this.#log('info', 'listing', 'WORKER_LIST_OK', `Found ${frames.length} Level II volumes for ${site}`, { site, productId, frameCount: frames.length, role: this.role, elapsedMs: this.now() - started });
    if (!frames.length) {
      throw new RadarWorkerError(
        'E_NO_RECENT_DATA',
        'listing',
        `No recent Level II volumes found for ${site}`,
        `No completed objects were found in the requested ${Math.round(lookbackMs / 60000)} minute window.`,
        site,
      );
    }
    const candidates = frames.slice(-3).reverse();
    let lastError = null;
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      try {
        const frame = await this.pipeline.load({
          site,
          objectKey: candidate.objectKey,
          scanStartMs: candidate.scanStartMs,
          elevationNumber: null,
          productId,
        });
        if (index > 0) this.#log('warn', 'archive', 'FALLBACK_FRAME_USED', `Used an earlier completed volume for ${site}`, { site, objectKey: candidate.objectKey, candidateIndex: index, productId });
        return { frames, frame };
      } catch (error) {
        lastError = error;
        this.#log('warn', error?.stage ?? 'archive', error?.code ?? 'FRAME_CANDIDATE_FAILED', `Candidate Level II frame failed for ${site}`, { site, objectKey: candidate.objectKey, candidateIndex: index, productId, sourceId: error?.sourceId ?? '' }, error);
      }
    }
    throw lastError ?? new RadarWorkerError('E_NO_USABLE_FRAME', 'archive', `No usable recent Level II volume found for ${site}`, '', site);
  }

  async loadFrame(payload) {
    return this.pipeline.load(payload);
  }
}
