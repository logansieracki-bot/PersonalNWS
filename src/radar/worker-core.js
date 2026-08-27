export class WorkerCore {
  constructor({ role, pipeline, diagnostics = null }) {
    this.role = role;
    this.pipeline = pipeline;
    this.diagnostics = diagnostics;
  }

  async loadFrame(payload) {
    return this.pipeline.load(payload);
  }
}
