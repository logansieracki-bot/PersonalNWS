export class AppController {
  constructor({ priority, history = null, ui, renderer, productId = 1, onFirstFrame = null }) {
    this.priority = priority;
    this.history = history;
    this.ui = ui;
    this.renderer = renderer;
    this.productId = productId;
    this.elevationNumber = null;
    this.site = null;
    this.frames = [];
    this.currentIndex = 0;
    this.manifest = null;
    this.onFirstFrame = onFirstFrame;
  }

  async selectSite(site) {
    this.site = site;
    this.ui.site(site);
    this.ui.busy(true);
    try {
      const result = await this.priority.request('SELECT_SITE', { site: site.id, productId: this.productId });
      this.frames = result.frames ?? [];
      this.currentIndex = Math.max(0, this.frames.length - 1);
      this.#acceptFrame(result.frame);
      this.ui.timeline(this.frames, this.currentIndex);
      if (this.onFirstFrame) {
        try { Promise.resolve(this.onFirstFrame(result.frame)).catch(() => {}); } catch { /* background startup must never block radar */ }
      }
      if (this.history && this.frames.length) {
        this.history.request('START_HISTORY', {
          site: site.id,
          frames: this.frames,
          productId: this.productId,
          elevationNumber: this.elevationNumber,
        }).catch((error) => this.ui.error(error));
      }
      return result.frame;
    } catch (error) {
      this.ui.error(error);
      throw error;
    } finally {
      this.ui.busy(false);
    }
  }

  async loadIndex(index) {
    if (!this.site || !this.frames.length) return null;
    const clamped = Math.max(0, Math.min(this.frames.length - 1, Number(index)));
    const descriptor = this.frames[clamped];
    this.ui.busy(true);
    try {
      const frame = await this.priority.request('LOAD_FRAME', {
        site: this.site.id,
        objectKey: descriptor.objectKey,
        scanStartMs: descriptor.scanStartMs,
        elevationNumber: this.elevationNumber,
        productId: this.productId,
      });
      this.currentIndex = clamped;
      this.#acceptFrame(frame);
      this.ui.timeline(this.frames, this.currentIndex);
      return frame;
    } catch (error) {
      this.ui.error(error);
      throw error;
    } finally {
      this.ui.busy(false);
    }
  }

  async setProduct(productId) {
    this.productId = Number(productId);
    return this.loadIndex(this.currentIndex);
  }

  async setElevation(elevationNumber) {
    this.elevationNumber = Number(elevationNumber);
    return this.loadIndex(this.currentIndex);
  }

  #acceptFrame(frame) {
    if (!frame) throw new Error('worker returned no radar frame');
    this.manifest = frame.manifest;
    this.elevationNumber = frame.elevationNumber;
    this.productId = frame.productId;
    this.renderer.setFrame(frame.buffer, this.site, frame);
    this.ui.manifest(frame.manifest, frame.elevationNumber, frame.productId);
  }
}
