import test from 'node:test';
import assert from 'node:assert/strict';
import {githubLoadControl} from './helpers/github-load-control.mjs';

test('a transient status read retries once within the pre-peak control budget',async()=>{
  let calls=0,waits=0;
  const value=await githubLoadControl(['run','view','123'],{execute:(_,args,options)=>{
    assert.equal(options.timeout,10000);assert.equal(options.windowsHide,true);calls++;
    return calls===1?{status:1,stderr:'connection closed'}:{status:0,stdout:'{"status":"completed"}'};
  },delay:async ms=>{assert.equal(ms,1000);waits++;}});
  assert.equal(value,'{"status":"completed"}');assert.equal(calls,2);assert.equal(waits,1);
});
test('control mutations, authorization failures and repeated transport failures never loop or leak raw errors',async()=>{
  for(const [args,stderr,expected] of [[['workflow','run'],'connection PRIVATE',1],[['run','cancel'],'connection PRIVATE',1],
    [['run','view'],'HTTP 403 PRIVATE',1],[['run','view'],'TLS PRIVATE',2]]) {
    let calls=0;
    await assert.rejects(githubLoadControl(args,{execute:()=>{calls++;return {status:1,stderr};},delay:async()=>{}}),error=>!error.message.includes('PRIVATE'));
    assert.equal(calls,expected);
  }
});
