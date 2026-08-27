function structured(error) {
  return {
    code: error?.code ?? 'E_HISTORY',
    stage: error?.stage ?? 'history',
    sourceId: error?.sourceId ?? '',
    message: String(error?.message ?? error ?? 'History frame failed'),
    detail: String(error?.detail ?? error?.stack ?? error?.message ?? error ?? 'History frame failed'),
    context: error?.context ?? {},
  };
}

export class HistoryBackfill {
  constructor({ pipeline, post, delay = () => new Promise((resolve) => setTimeout(resolve, 0)), now = () => Date.now() }) {
    this.pipeline = pipeline;
    this.post = post;
    this.delay = delay;
    this.now = now;
    this.generation = 0;
  }

  cancel() {
    this.generation += 1;
    return this.generation;
  }

  async run({ frames = [], site, productId = 1, elevationNumber = null }) {
    const generation = ++this.generation;
    const total = frames.length;
    let done = 0;
    for (let index = total - 1; index >= 0; index -= 1) {
      if (generation !== this.generation) return { done, total, cancelled: true };
      const frame = frames[index];
      try {
        await this.pipeline.load({
          site,
          objectKey: frame.objectKey,
          scanStartMs: frame.scanStartMs,
          elevationNumber,
          productId,
        });
      } catch (error) {
        this.post({ type: 'DIAGNOSTIC', payload: structured(error) });
      }
      done += 1;
      this.post({ type: 'CACHE_PROGRESS', payload: { done, total } });
      if (generation !== this.generation) return { done, total, cancelled: true };
      await this.delay();
    }
    return { done, total, cancelled: false };
  }
}
