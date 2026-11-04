import test from 'node:test';
import assert from 'node:assert/strict';
import {clockBounds,calibratedTimeline} from './helpers/load-clock.mjs';
import {confirmPeakWrites} from './helpers/read-load-reports.mjs';

test('timed writes reach the deadline with their lower clock bound while retaining the strict full-peak check',()=>{
  const base=Date.parse('2026-11-04T11:13:09Z'),target=base+400;
  const report={allUsersActiveFrom:new Date(base+222).toISOString(),allUsersActiveUntil:new Date(base+5000).toISOString()};
  const receipts=[1,2,3].map(()=>new Date(base+1000).toISOString());
  for(const shift of [-5000,0,5000]) {
    let local=base+580+shift;
    const clock=calibratedTimeline({lower:-360-shift,upper:-shift},()=>local);
    const window=()=>({actors:3,accepted:3,sameRecordAccepted:1,sameRecordConflict:1,
      startedAt:new Date(clock.earliest()).toISOString(),finishedAt:new Date(clock.latest()+1000).toISOString()});
    assert.equal(clock.now(),target);
    assert.equal(confirmPeakWrites(report,[window()],receipts),false,'A midpoint deadline leaves the conservative start two milliseconds too early');
    assert.ok(clock.millisecondsUntil(target)>0);
    local+=clock.millisecondsUntil(target);
    assert.equal(clock.earliest(),target);
    assert.equal(confirmPeakWrites(report,[window()],receipts),true);
  }
});

test('clock calibration retains whole-second uncertainty and handles clocks ahead or behind',()=>{
  const observations = [{start:10000,end:10100,serverTime:10000},{start:10500,end:10600,serverTime:10000},{start:10900,end:11000,serverTime:11000}];
  assert.deepEqual(clockBounds(observations),{lower:0,upper:500,uncertaintyMs:500});
  for(const shift of [-5000,5000]) {
    const bounds=clockBounds(observations.map(sample=>({...sample,start:sample.start+shift,end:sample.end+shift})));
    assert.equal(bounds.lower,-shift); assert.equal(bounds.upper,500-shift);
  }
});
test('clock calibration refuses missing, contradictory and excessively uncertain observations',()=>{
  assert.throws(()=>clockBounds([]));
  assert.throws(()=>clockBounds(Array(3).fill({start:10000,end:12000,serverTime:10000})));
  assert.throws(()=>clockBounds([{start:10000,end:10100,serverTime:10000},{start:10500,end:10600,serverTime:10000},{start:10900,end:11000,serverTime:13000}]));
  assert.throws(()=>clockBounds(Array(3).fill({start:10,end:9,serverTime:0})));
});
