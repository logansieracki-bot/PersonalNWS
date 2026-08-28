function adapterError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = 'E_RADAR_ADAPTER';
  error.stage = 'radar-slot';
  return error;
}

export function createRadarSlot({ map, ui, diagnostics } = {}) {
  let adapter = null;
  let controller = null;

  async function detach() {
    const previous = adapter;
    const previousController = controller;
    adapter = null;
    controller = null;
    try {
      if (typeof previousController?.stop === 'function') await previousController.stop();
      else if (typeof previous?.stop === 'function') await previous.stop();
      diagnostics?.info?.('radar-slot', 'RADAR_DETACHED', 'Radar adapter detached');
    } catch (error) {
      diagnostics?.error?.('radar-slot', 'RADAR_DETACH_FAILED', error?.message ?? 'Radar adapter failed to stop', {}, error);
    }
  }

  async function attach(nextAdapter) {
    if (!nextAdapter || typeof nextAdapter.start !== 'function') throw adapterError('Radar adapter must implement start(context)');
    if (adapter) await detach();
    adapter = nextAdapter;
    diagnostics?.info?.('radar-slot', 'RADAR_ATTACH_START', 'Attaching radar adapter');
    try {
      controller = await nextAdapter.start({ map, ui, diagnostics });
      diagnostics?.info?.('radar-slot', 'RADAR_ATTACHED', 'Radar adapter attached');
      return controller;
    } catch (cause) {
      adapter = null;
      controller = null;
      const error = adapterError(cause?.message ?? 'Radar adapter failed to start', cause);
      diagnostics?.error?.('radar-slot', error.code, error.message, {}, cause);
      throw error;
    }
  }

  return Object.freeze({
    attach,
    detach,
    debug: () => ({ attached: Boolean(adapter), controllerReady: Boolean(controller) }),
  });
}
