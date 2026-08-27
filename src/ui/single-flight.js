export function createSingleFlight() {
  let busy = false;
  return {
    get busy() { return busy; },
    async run(fn) {
      if (busy) return null;
      busy = true;
      try {
        return await fn();
      } finally {
        busy = false;
      }
    },
  };
}
