import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {controlRequest,warmControlConnections} from './helpers/load-control-client.mjs';
async function server(t,handler) {
  const value=http.createServer(handler);let connections=0;value.on('connection',()=>connections++);
  await new Promise(resolve=>value.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{value.closeAllConnections();value.close(resolve);}));
  return {origin:'http://127.0.0.1:'+value.address().port,connections:()=>connections};
}
test('persistent control requests reuse connections and keep each synthetic actor header with its own body',async t=>{
  const seen=[],site=await server(t,async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);seen.push([req.headers.authorization,body.actor]);res.setHeader('Content-Type','application/json');res.setHeader('Server-Timing','content;dur=2.5');res.end(JSON.stringify({ok:true,actor:body.actor}));});
  for(let actor=0;actor<6;actor++){const reply=await controlRequest(site.origin+'/save',{body:{actor},headers:{Authorization:'Bearer synthetic-'+actor}});assert.equal(reply.status,200);assert.equal(reply.data.actor,actor);assert.equal(reply.timing.serverMs,2.5);}
  assert.ok(site.connections()<=2);assert.deepEqual(seen,Array.from({length:6},(_,i)=>['Bearer synthetic-'+i,i]));
});
test('connection calibration reads only five static pages before the timed JSON requests',async t=>{
  const paths=[],site=await server(t,(req,res)=>{paths.push(req.url);res.setHeader('Content-Type',req.url==='/'?'text/html':'application/json');res.end(req.url==='/'?'<html>isolated</html>':'{"ok":true}');});
  await warmControlConnections(site.origin);assert.deepEqual(paths,Array(5).fill('/'));
  assert.equal((await controlRequest(site.origin+'/save')).status,200);assert.equal(paths.at(-1),'/save');
});
test('control transport times out, refuses redirects and hides malformed private response content',async t=>{
  let redirected=false;const site=await server(t,(req,res)=>{
    if(req.url==='/redirect'){res.writeHead(302,{Location:'/unexpected'});res.end();return;}
    if(req.url==='/unexpected')redirected=true;
    if(req.url==='/slow'){const timer=setTimeout(()=>res.end('{"ok":true}'),1000);res.on('close',()=>clearTimeout(timer));return;}
    res.end('SYNTHETIC-PRIVATE-CREDENTIAL');
  });
  await assert.rejects(controlRequest(site.origin+'/bad'),error=>error.message==='Control response JSON is invalid');
  await assert.rejects(controlRequest(site.origin+'/slow',{timeoutMs:25}),/Control transport did not confirm/);
  await assert.rejects(controlRequest(site.origin+'/redirect'),/Control transport did not confirm/);assert.equal(redirected,false);
});
