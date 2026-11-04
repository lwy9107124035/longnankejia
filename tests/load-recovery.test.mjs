import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {remoteRequest,createRestDatabase} from '../scripts/migrate-content-records.mjs';
import {cleanupSessionIds} from './helpers/load-integrity.mjs';
import {recoverReadRequests} from './helpers/load-read-recovery.mjs';

for (const code of [9109, 7403]) test(`read recovery handles provider authorization envelope ${code} once without replaying mutations`, async () => {
  let calls=0,refreshes=0,denied=true;
  const request=async()=>{calls++;return denied?{success:false,errors:[{code}]}:{success:true,result:[{success:true,results:[{ready:1}]}]};};
  const db=createRestDatabase(recoverReadRequests(request,{refresh:async()=>{refreshes++;denied=false;}}),{apply:true});
  assert.equal((await db.prepare('SELECT 1 AS ready').first()).ready,1);
  assert.equal(calls,2);assert.equal(refreshes,1);
  denied=true;
  await assert.rejects(db.prepare('SELECT 1 AS ready').first(),new RegExp('codes '+code));
  assert.equal(calls,3);assert.equal(refreshes,1,'A second denial must stop after one refresh');
  await assert.rejects(db.prepare('DELETE FROM synthetic').run(),new RegExp('codes '+code));
  assert.equal(calls,4);assert.equal(refreshes,1,'Mutation authorization denial must not trigger a replay');
  await assert.rejects(db.batch([db.prepare('SELECT 1'),db.prepare('DELETE FROM synthetic')]),new RegExp('codes '+code));
  assert.equal(calls,5);assert.equal(refreshes,1);
});

test('read recovery bounds transport retries and preserves uncertain writes and other provider failures', async () => {
  let calls=0,delays=0,refreshes=0;
  const failed=recoverReadRequests(async()=>{calls++;throw Error('synthetic transport failure');},{refresh:async()=>{refreshes++;},delay:async()=>{delays++;}});
  await assert.rejects(failed({sql:'SELECT 1'}),/synthetic transport failure/);
  assert.equal(calls,3);assert.equal(delays,2);assert.equal(refreshes,0);
  await assert.rejects(failed({sql:'DELETE FROM synthetic'}),/synthetic transport failure/);
  assert.equal(calls,4);assert.equal(delays,2);
  const rejected=createRestDatabase(recoverReadRequests(async()=>({success:false,errors:[{code:7500}]}),{refresh:async()=>{refreshes++;}}));
  await assert.rejects(rejected.prepare('SELECT 1').all(),/codes 7500/);
  assert.equal(refreshes,0);
});

test('a long-running REST controller reads refreshed authorization and retains provider rejection codes without replaying writes',async t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'load-auth-')),configPath=path.join(folder,'auth.toml');
  t.after(()=>{fs.unlinkSync(configPath);fs.rmdirSync(folder);});
  const seen=[];let reject=false;
  const spawnProcess=()=>{
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stdout.setEncoding=()=>{};child.stderr={resume(){}};child.stdin=new EventEmitter();
    child.stdin.end=config=>{seen.push(config);queueMicrotask(()=>{child.stdout.emit('data',JSON.stringify(reject?{success:false,errors:[{code:9109}]}:{success:true,result:[{success:true,results:[]}]}));child.emit('close',reject?22:0);});};return child;
  };
  fs.writeFileSync(configPath,'oauth_token = "SYNTHETIC-FIRST"');
  const request=remoteRequest({target:'codex',accountId:'a'.repeat(32),configPath},{spawnProcess}),db=createRestDatabase(request,{apply:true});
  await db.prepare('SELECT 1').all();fs.writeFileSync(configPath,'oauth_token = "SYNTHETIC-REFRESHED"');await db.prepare('SELECT 1').all();
  assert.match(seen[0],/SYNTHETIC-FIRST/);assert.match(seen[1],/SYNTHETIC-REFRESHED/);
  reject=true;await assert.rejects(db.prepare('DELETE FROM synthetic').run(),/codes 9109/);assert.equal(seen.length,3,'Mutation was not replayed');
});
test('recovery includes only hashes in matching control and prior cleanup ledgers',()=>{
  const prefix='load-fixture-'+'a'.repeat(24),a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
  assert.deepEqual(cleanupSessionIds(prefix,[c],[{prefix,sessionHashes:[a,b]},{prefix,sessionHashes:[b,c]}]),[c,a,b]);
  assert.deepEqual(cleanupSessionIds(prefix,[c],[{prefix,sessionHash:a}]),[c,a]);
  assert.throws(()=>cleanupSessionIds(prefix,[c],[{prefix:'load-fixture-'+'b'.repeat(24),sessionHashes:[a]}]));
  assert.throws(()=>cleanupSessionIds(prefix,[c],[{prefix,sessionHashes:['not-a-hash']}]));
});
