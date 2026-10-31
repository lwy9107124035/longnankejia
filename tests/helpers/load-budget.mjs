const day = now => new Date(now).toISOString().slice(0, 10);

function recent(at, now) {
  const timestamp = Date.parse(at);
  return Number.isFinite(timestamp) && timestamp <= now + 30000 && now - timestamp <= 15 * 60000;
}
export function createLoadPermit(usage, { readEstimate = 1000000, writeEstimate = 20000, maxHttpRequests = 15000 } = {}, now = Date.now()) {
  if (!usage || !usage.scope?.startsWith('all account databases') || !recent(usage.at, now) || usage.periodStart !== day(now) + 'T00:00:00Z') throw Error('A current UTC-day account-wide D1 usage check is required');
  for (const value of [usage.rowsRead, usage.rowsWritten, readEstimate, writeEstimate]) if (!Number.isSafeInteger(value) || value < 0) throw Error('D1 usage or test estimate is unknown');
  if (usage.rowsRead + readEstimate > 4000000 || usage.rowsWritten + writeEstimate > 80000) throw Error('D1 test budget unavailable: preserve the Free-plan reserve for normal use');
  const permit = { utcDate: day(now), checkedAt: new Date(now).toISOString(), maxHttpRequests, readEstimate, writeEstimate };
  assertLoadPermit(permit, maxHttpRequests, now); return permit;
}
export function assertLoadPermit(input, expectedRequests, now = Date.now()) {
  let permit;
  try { permit = typeof input === 'string' ? JSON.parse(input) : input; }
  catch { throw Error('Invalid load-test permit'); }
  if (!permit || permit.utcDate !== day(now) || !recent(permit.checkedAt, now)) throw Error('Load-test permit missing, expired, or from another UTC day');
  if (!Number.isSafeInteger(permit.maxHttpRequests) || permit.maxHttpRequests > 15000 || permit.maxHttpRequests < expectedRequests || !Number.isSafeInteger(expectedRequests) || expectedRequests < 1) throw Error('Load-test HTTP budget is invalid');
  if (!Number.isSafeInteger(permit.readEstimate) || permit.readEstimate < 1 || !Number.isSafeInteger(permit.writeEstimate) || permit.writeEstimate < 0) throw Error('Load-test resource estimate is invalid');
  return permit;
}
