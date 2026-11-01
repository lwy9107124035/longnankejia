import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createAdminBackend} from './helpers/admin-harness.mjs';
import {migrateRecordStorage, recordsManifest, readRecordState, recordChangeSnapshot, writeRecordState} from '../functions/_lib/admin-records.js';
const schema=globalThis.HeritageContent;
async function setup(t,cards=[]) {
  const backend=createAdminBackend();t.after(()=>backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql',import.meta.url),'utf8'));
  const content=structuredClone(schema.defaults);content.kepuCustom=cards;
  await migrateRecordStorage(backend.db,{value:content,revision:0});
  const login=await backend.call({action:'login',credential:'admin123',clientId:'row-concurrency'});assert.equal(login.status,200);
  return {...backend,bearer:login.data.bearer};
}
function accounting(site,manifest) {
  const rows=site.sqlite.prepare('SELECT kind,COUNT(*) AS count FROM admin_content_items WHERE generation=? AND value!=\'null\' GROUP BY kind').all(manifest.generation);
  const actual=Object.fromEntries(rows.map(row=>[row.kind,row.count]));
  for(const [kind,count] of Object.entries(manifest.counts)) if(!kind.includes('/media/'))assert.equal(count,actual[kind]||0,kind);
  const total=site.sqlite.prepare('SELECT SUM(length(CAST(value AS BLOB))) AS bytes FROM admin_content_items WHERE generation=?').get(manifest.generation).bytes;
  assert.equal(manifest.bytes,total);assert.equal(Object.hasOwn(manifest,'_writeClaim'),false);
}
function request(id,baseHash,name=id,operationId='parallel-save-'+id) {
  return {action:'update_content',operationId,changes:[{key:'kepuCustom/'+id,baseHash,value:{id,name,detail:'完整正文'}}]};
}

test('independent simultaneous edits commit once each and preserve actual parent revisions, receipts and incremental visibility',async t=>{
  const site=await setup(t),empty=await schema.cellHash(null),bodies=['parallel-a','parallel-b','parallel-c'].map(id=>request(id,empty));
  const replies=await Promise.all(bodies.map(body=>site.call(body,site.bearer)));
  for(const [i,reply] of replies.entries()) {
    assert.equal(reply.status,200);assert.equal(reply.data.accepted.length,1);assert.match(reply.response.headers.get('Server-Timing'),/save_attempts;desc="1"/);
    assert.equal(reply.data.baseRevision,reply.data.revision-1);
    const receipt=JSON.parse(site.sqlite.prepare('SELECT value FROM admin_content_receipts WHERE id=?').get(bodies[i].operationId).value);
    assert.equal(receipt.baseRevision,reply.data.baseRevision);
  }
  assert.deepEqual(replies.map(reply=>reply.data.revision).sort(),[2,3,4]);
  const manifest=await recordsManifest(site.db);assert.equal(manifest.counts.kepuCustom,3);accounting(site,manifest);
  const latest=replies.find(reply=>reply.data.revision===4);
  const page=await (await site.fetchApi('/api/admin/sync?format=records&field=kepuCustom&since=3')).json();
  assert.deepEqual(page.rows.map(row=>row.key),latest.data.accepted);
});

test('two stale snapshots of different records safely add their byte deltas and assign the real commit revision',async t=>{
  const site=await setup(t,[{id:'cell-a',name:'甲',detail:'旧甲'},{id:'cell-b',name:'乙',detail:'旧乙'}]),manifest=await recordsManifest(site.db);
  const a=(await recordChangeSnapshot(site.db,manifest,['kepuCustom/cell-a'])).current,b=(await recordChangeSnapshot(site.db,manifest,['kepuCustom/cell-b'])).current;
  const nextA=structuredClone(a.value),nextB=structuredClone(b.value);nextA.kepuCustom[0].detail='加长后的甲正文';nextB.kepuCustom[0].detail='加长后的乙正文'.repeat(20);
  assert.equal(await writeRecordState(site.db,manifest,a.value,nextA),2);assert.equal(await writeRecordState(site.db,manifest,b.value,nextB),3);
  const current=await recordsManifest(site.db);accounting(site,current);assert.equal(current.counts.kepuCustom,2);
  const delta=await (await site.fetchApi('/api/admin/sync?format=records&field=kepuCustom&since=2')).json();
  assert.equal(delta.rows.length,1);assert.equal(delta.rows[0].key,'kepuCustom/cell-b');assert.equal(delta.rows[0].value.detail,nextB.kepuCustom[0].detail);
});

test('a same-digest record with newer provenance still rejects an obsolete write snapshot',async t=>{
  const site=await setup(t,[{id:'provenance',name:'原资料',detail:'原正文'}]),manifest=await recordsManifest(site.db);
  const a=(await recordChangeSnapshot(site.db,manifest,['kepuCustom/provenance'])).current,b=(await recordChangeSnapshot(site.db,manifest,['kepuCustom/provenance'])).current;
  const newer=structuredClone(b.value);newer.kepuCustom[0].creatorName='新的归属';assert.equal(await writeRecordState(site.db,manifest,b.value,newer),2);
  const stale=structuredClone(a.value);stale.kepuCustom[0].detail='不应写入';await assert.rejects(writeRecordState(site.db,manifest,a.value,stale),error=>error.code==='SYNC_CONFLICT');
  const current=await recordsManifest(site.db),saved=await readRecordState(site.db,current,['kepuCustom/provenance']);
  assert.equal(saved.value.kepuCustom[0].creatorName,'新的归属');assert.equal(saved.value.kepuCustom[0].detail,'原正文');assert.equal(current.revision,2);accounting(site,current);
});

test('parallel reuse of one operation ID for different records cannot write the second payload',async t=>{
  const site=await setup(t),empty=await schema.cellHash(null),operation='shared-operation-id-race';
  const replies=await Promise.all(['operation-a','operation-b'].map(id=>site.call(request(id,empty,id,operation),site.bearer)));
  assert.deepEqual(replies.map(reply=>reply.status).sort(),[200,409]);assert.equal(replies.find(reply=>reply.status===409).data.code,'OPERATION_MISMATCH');
  const current=await recordsManifest(site.db);assert.equal(current.counts.kepuCustom,1);assert.equal(current.counts._history,1);assert.equal(site.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_content_receipts').get().n,1);accounting(site,current);
});

test('a failure after admission rolls back every row, counter, receipt and transient claim before a safe retry',async t=>{
  const site=await setup(t),manifest=await recordsManifest(site.db),body=request('rollback-transaction',await schema.cellHash(null));
  site.sqlite.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON admin_content_receipts BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END");
  const failed=await site.call(body,site.bearer);assert.equal(failed.status,503);assert.deepEqual(await recordsManifest(site.db),manifest);assert.equal(site.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_content_receipts').get().n,0);accounting(site,manifest);
  site.sqlite.exec('DROP TRIGGER reject_receipt');const retry=await site.call(body,site.bearer);assert.equal(retry.status,200);assert.equal(retry.data.accepted.length,1);
  const current=await recordsManifest(site.db);assert.equal(current.revision,2);assert.equal(current.counts.kepuCustom,1);assert.equal(current.counts._history,1);accounting(site,current);
});

test('same-record competitors keep one winner and one durable conflict without duplicate history on replay',async t=>{
  const site=await setup(t,[{id:'same-record',name:'原资料',detail:'完整正文'}]),base=await schema.cellHash({id:'same-record',name:'原资料',detail:'完整正文'});
  const bodies=['甲','乙'].map((name,i)=>request('same-record',base,name,'same-record-operation-'+i));
  const replies=await Promise.all(bodies.map(body=>site.call(body,site.bearer)));
  assert.ok(replies.every(reply=>reply.status===200));assert.equal(replies.reduce((n,reply)=>n+reply.data.accepted.length,0),1);assert.equal(replies.reduce((n,reply)=>n+reply.data.conflicts.length,0),1);
  const before=await recordsManifest(site.db);assert.equal(before.revision,2);assert.equal(before.counts._history,1);
  for(const [i,body] of bodies.entries()){const replay=await site.call(body,site.bearer);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.deepEqual(replay.data.accepted,replies[i].data.accepted);assert.deepEqual(replay.data.conflicts,replies[i].data.conflicts);}
  assert.deepEqual(await recordsManifest(site.db),before);accounting(site,before);
});
