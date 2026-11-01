import test from 'node:test';
import assert from 'node:assert/strict';
import {clockBounds} from './helpers/load-clock.mjs';

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
