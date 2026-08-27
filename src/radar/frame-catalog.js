import { listCompletedVolumes } from './nexrad-source.js';

export async function discoverRecentFrames(siteId, {
  nowMs = Date.now(),
  lookbackMs = 2 * 60 * 60 * 1000,
  timeoutMs = 3_500,
  listImpl = listCompletedVolumes,
} = {}) {
  const startMs = nowMs - lookbackMs;
  return listImpl(siteId, startMs, nowMs, { timeoutMs });
}
