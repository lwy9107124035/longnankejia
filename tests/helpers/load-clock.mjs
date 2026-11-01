import assert from 'node:assert/strict';
import {readLimited} from '../../functions/_lib/read-limited.js';

export function clockBounds(samples) {
  assert.ok(samples.length >= 3, 'Clock calibration requires independent observations');
  for (const sample of samples) assert.ok([sample.start,sample.end,sample.serverTime].every(Number.isFinite)
    && sample.end >= sample.start && sample.serverTime % 1000 === 0, 'Invalid clock observation');
  // CDN trace timestamps have whole-second precision, not millisecond precision.
  const lower = Math.max(...samples.map(sample => sample.serverTime - sample.end));
  const upper = Math.min(...samples.map(sample => sample.serverTime + 1000 - sample.start));
  assert.ok(upper >= lower && upper - lower <= 1000, 'Cloud clock calibration is inconsistent or too uncertain');
  return {lower,upper,uncertaintyMs:upper-lower};
}

export async function calibrateLoadClock(origin) {
  assert.equal(origin, 'https://codex.longnankejia-dev.pages.dev');
  const wall = Date.now(), mono = performance.now(), localNow = () => wall + performance.now() - mono;
  const samples = [];
  for (let index = 0; index < 12; index++) {
    const start = localNow();
    const response = await fetch(origin + '/cdn-cgi/trace', {cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
    const raw = new TextDecoder().decode(await readLimited(response,8192)), end = localNow();
    const timestamp = raw.match(/^ts=(\d+(?:\.\d+)?)$/m);
    assert.ok(response.status === 200 && timestamp, 'Cloud clock reference unavailable');
    samples.push({start,end,serverTime:Math.floor(Number(timestamp[1]))*1000});
  }
  const bounds = clockBounds(samples), offset = (bounds.lower+bounds.upper)/2;
  return {now:() => localNow()+offset, earliest:() => Math.floor(localNow()+bounds.lower), latest:() => Math.ceil(localNow()+bounds.upper),
    report:{reference:'owned codex CDN trace, whole-second timestamp',...bounds,samples,httpRequests:samples.length}};
}
