import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminBackend, captureQueryPlans } from './helpers/admin-harness.mjs';
import { migrateRecordStorage, recordSummaries, recordSummarySnapshot, pageRecoveryHistory } from '../functions/_lib/admin-records.js';
import {setupEnvironment} from './helpers/store-harness.mjs';
import {createHash} from 'node:crypto';
import {onRequestPost} from '../functions/api/admin/sync.js';

async function savedCardBackend(t) {
  const backend=createAdminBackend();t.after(()=>backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql',import.meta.url),'utf8'));
  const content=structuredClone(globalThis.HeritageContent.defaults);
  content.kepuCustom=[{id:'ack-card',name:'原名称',detail:'原始完整正文'}];
  content.auditLogs=[{id:'prior-log',action:'既有日志',detail:'',time:1}];
  await migrateRecordStorage(backend.db,{value:content,revision:0});
  const login=await backend.call({action:'login',credential:'admin123',clientId:'ack-test'});
  return {...backend,bearer:login.data.bearer,card:content.kepuCustom[0]};
}

test('durable save acknowledgements survive an unavailable optional summary and replay without duplicate history',async t=>{
  for(const compact of [true,false]) {
    const backend=await savedCardBackend(t),prepare=backend.db.prepare.bind(backend.db);let summaryReads=0,standaloneVersionReads=0;
    backend.db.prepare=sql=>{
      if(sql==="SELECT value, revision FROM admin_state WHERE key='content'")standaloneVersionReads++;
      if(sql.includes("kind='auditLogs' ORDER BY")){summaryReads++;throw Error('synthetic summary unavailable');}
      return prepare(sql);
    };
    const body={action:'update_content',operationId:'durable-acknowledgement-test',...(compact&&{ackFormat:'compact-v1'}),
      changes:[{key:'kepuCustom/ack-card',baseHash:await globalThis.HeritageContent.cellHash(backend.card,true),value:{...backend.card,name:'新名称'}}]};
    const saved=await backend.call(body,backend.bearer);assert.equal(saved.status,200);
    assert.equal(standaloneVersionReads,0,'Save auth already read the content version');
    assert.deepEqual(saved.data.accepted,['kepuCustom/ack-card']);assert.equal(saved.data.auditAppend.length,1);assert.equal(saved.data.recoveryAppend.length,1);
    assert.equal(saved.data.auditLogs,undefined);assert.equal(summaryReads,compact?0:1);
    if(!compact)assert.equal(saved.data.metadataPending,true);
    const replay=await backend.call(body,backend.bearer);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);
    assert.deepEqual(replay.data.auditAppend,saved.data.auditAppend);
    assert.equal(backend.sqlite.prepare("SELECT COUNT(*) AS count FROM admin_content_items WHERE kind='_history'").get().count,1);
    const invalid=await backend.call({...body,ackFormat:'unsupported'},backend.bearer);assert.equal(invalid.status,400);assert.equal(invalid.data.code,'INVALID_ACK_FORMAT');
  }
});

test('the combined save auth/version read rejects sessions or invitations revoked while receiving the body',async t=>{
  for(const editor of [false,true]) {
    const backend=await savedCardBackend(t);let bearer=backend.bearer;
    const invite={id:'synthetic-editor',token:'SYNTHETIC-INVITE',name:'合成协管员'};
    if(editor) {
      backend.sqlite.prepare("INSERT INTO admin_state(key,value,revision) VALUES('tokens',?,0) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify([invite]));
      bearer='a'.repeat(64);
      backend.sqlite.prepare('INSERT INTO admin_sessions(id,role,name,token_id,expires_at) VALUES(?,?,?,?,?)')
        .run(createHash('sha256').update(bearer).digest('hex'),'editor','合成协管员',invite.id,Date.now()+60000);
    }
    const payload={action:'update_content',ackFormat:'compact-v1',operationId:'revoked-during-body-test',changes:[{key:'kepuCustom/ack-card',baseHash:await globalThis.HeritageContent.cellHash(backend.card,true),value:{...backend.card,name:'不应保存'}}]};
    const stream=new ReadableStream({pull(controller){
      if(editor)backend.sqlite.prepare("UPDATE admin_state SET value=? WHERE key='tokens'").run(JSON.stringify([{...invite,paused:true}]));
      else backend.sqlite.exec('DELETE FROM admin_sessions');
      controller.enqueue(new TextEncoder().encode(JSON.stringify(payload)));controller.close();
    }},{highWaterMark:0});
    const response=await onRequestPost({env:backend.env,request:new Request('http://127.0.0.1:8931/api/admin/sync',{method:'POST',duplex:'half',body:stream,headers:{'Content-Type':'application/json',Authorization:'Bearer '+bearer}})});
    assert.equal(response.status,401);
    assert.equal(JSON.parse(backend.sqlite.prepare("SELECT value FROM admin_content_items WHERE key='kepuCustom/ack-card'").get().value).name,'原名称');
    assert.equal(backend.sqlite.prepare("SELECT COUNT(*) AS count FROM admin_content_items WHERE kind='_history'").get().count,0);
  }
});

test('the client immediately retains old and new audit/recovery rows with compact save confirmations',async t=>{
  const backend=await savedCardBackend(t),device=setupEnvironment(backend);
  const login=await device.store.verifyLogin('admin123');device.store.saveSession(login);assert.ok(await device.store.syncWithCloud());
  const requests=[],fetch=device.sandbox.fetch;
  device.sandbox.fetch=(url,options={})=>{if(options.body){const body=JSON.parse(options.body);if(body.action==='update_content')requests.push(body);}return fetch(url,options);};
  for(const name of ['第一次校正','第二次校正']) {
    device.store.updateHeritageCard('ack-card',{name});assert.ok(await device.store.syncCustomToCloud());
  }
  assert.ok(requests.length>=2&&requests.every(request=>request.ackFormat==='compact-v1'));
  assert.equal(device.store.getSyncStatus().pending,false);
  const logs=device.store.getAuditLogs();assert.ok(logs.some(log=>log.id==='prior-log'));assert.equal(new Set(logs.map(log=>log.id)).size,logs.length);
  assert.equal(device.store.getRecoveryHistory().length,2);
});

test('save summaries and their revision use one round trip and cannot mix a later audit transaction',async t=>{
  const backend=createAdminBackend();t.after(()=>backend.close());backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql',import.meta.url),'utf8'));
  const manifest=await migrateRecordStorage(backend.db,{value:structuredClone(globalThis.HeritageContent.defaults),revision:0});
  const insert=backend.sqlite.prepare("INSERT INTO admin_content_items(generation,key,kind,value,digest,revision) VALUES(?,?,'auditLogs',?,'synthetic',1)");
  const log=id=>JSON.stringify({id,action:'合成记录',detail:'',time:1});insert.run(manifest.generation,'auditLogs/early',log('early'));
  const batch=backend.db.batch.bind(backend.db);let trips=0;backend.db.batch=async statements=>{trips++;const result=await batch(statements);backend.sqlite.exec('BEGIN');insert.run(manifest.generation,'auditLogs/later',log('later'));backend.sqlite.exec("UPDATE admin_state SET revision=2 WHERE key='content'; COMMIT");return result;};
  const snapshot=await recordSummarySnapshot(backend.db,manifest,[]);assert.equal(trips,1);assert.equal(snapshot.manifest.revision,1);assert.deepEqual(snapshot.summaries.auditLogs.map(row=>row.id),['early']);
  backend.db.batch=batch;const fresh=await recordSummarySnapshot(backend.db,manifest,[]);assert.equal(fresh.manifest.revision,2);assert.deepEqual(fresh.summaries.auditLogs.map(row=>row.id),['later','early']);
});

test('administrator summaries and recovery pages use ordered indexes instead of sorting the accumulated history', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  const manifest = await migrateRecordStorage(backend.db, { value: structuredClone(globalThis.HeritageContent.defaults), revision: 0 });
  const insert = backend.sqlite.prepare('INSERT INTO admin_content_items(generation,key,kind,value,digest,revision) VALUES(?,?,?,?,?,1)');
  backend.sqlite.exec('BEGIN');
  for (let i = 0; i < 20; i++) insert.run(manifest.generation, '_history/recover-' + i, '_history', JSON.stringify({ id: 'recover-' + i, title: '可恢复记录', time: i, before: { name: '旧内容' } }), 'synthetic');
  for (let i = 0; i < 5000; i++) insert.run(manifest.generation, '_history/create-' + i, '_history', JSON.stringify({ id: 'create-' + i, title: '新增记录', time: 100 + i, before: null }), 'synthetic');
  for (let i = 0; i < 1000; i++) insert.run(manifest.generation, 'auditLogs/log-' + i, 'auditLogs', JSON.stringify({ id: 'log-' + i, time: i, action: '合成操作', detail: '' }), 'synthetic');
  backend.sqlite.exec('COMMIT');
  const plans = captureQueryPlans(backend), result = await recordSummaries(backend.db, manifest, []);
  assert.equal(result.auditLogs.length, 200); assert.equal(result.auditLogs[0].id, 'log-999');
  assert.equal(result.recovery.length, 20); assert.equal(result.recovery[0].id, 'recover-19');
  assert.ok(plans.some(plan => plan.includes('admin_content_sequence'))); assert.ok(plans.some(plan => plan.includes('admin_content_recovery')));
  assert.ok(plans.every(plan => !plan.includes('TEMP B-TREE')));
  const page = await pageRecoveryHistory(backend.db, manifest); assert.equal(page.rows.length, 20); assert.equal(page.cursor, '');
  assert.match(plans.at(-1), /admin_content_recovery/); assert.doesNotMatch(plans.at(-1), /TEMP B-TREE/);
});
