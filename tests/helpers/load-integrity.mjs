import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export async function retainedRowsFingerprint(db,keys) {
  assert.ok(Array.isArray(keys)&&keys.length>0&&keys.length<=1000&&new Set(keys).size===keys.length
    &&keys.every(key=>typeof key==='string'&&key.length>0&&!key.includes('load-fixture-')), 'Invalid retained-row key set');
  const rows=await db.prepare("SELECT key,value,revision FROM admin_content_items WHERE generation=(SELECT json_extract(value,'$.generation') FROM admin_state WHERE key='content') AND key IN (SELECT value FROM json_each(?)) ORDER BY key")
    .bind(JSON.stringify(keys)).all();
  assert.equal(rows.results.length,keys.length,'A retained row is missing');
  return {count:rows.results.length,sha256:createHash('sha256').update(JSON.stringify(rows.results)).digest('hex')};
}

export async function verifyRecordAccounting(db) {
  const result=await db.batch([
    db.prepare("SELECT value FROM admin_state WHERE key='content'"),
    db.prepare("SELECT kind,SUM(CASE WHEN value!='null' THEN 1 ELSE 0 END) AS count,SUM(length(CAST(value AS BLOB))) AS bytes FROM admin_content_items WHERE generation=(SELECT json_extract(value,'$.generation') FROM admin_state WHERE key='content') GROUP BY kind")
  ]);
  const marker=JSON.parse(result[0].results[0].value),actualCounts=Object.fromEntries(result[1].results.map(row=>[row.kind,row.count]));
  assert.equal(Object.hasOwn(marker,'_writeClaim'),false,'A transient write claim remains');
  for(const [kind,count] of Object.entries(marker.counts))if(!kind.includes('/media/'))assert.equal(count,actualCounts[kind]||0,'Record counts disagree');
  const bytes=result[1].results.reduce((total,row)=>total+row.bytes,0);
  assert.equal(marker.bytes,bytes,'Logical byte accounting disagrees');
  return {countsMatch:true,bytesMatch:true,logicalBytes:bytes,noTransientClaim:true};
}
