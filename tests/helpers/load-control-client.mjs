import {readLimited} from '../../functions/_lib/read-limited.js';
import {parseControlResponse} from './read-load-reports.mjs';

async function requestBytes(url,{body,headers={},timeoutMs=30000}={},limit=24*1024*1024) {
  const started=performance.now();
  try {
    const response=await fetch(url,{method:body?'POST':'GET',headers:{...headers,...(body&&{'Content-Type':'application/json'})},
      ...(body&&{body:JSON.stringify(body)}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
    const bytes=await readLimited(response,limit);
    return {status:response.status,bytes,seconds:(performance.now()-started)/1000,timing:response.headers.get('Server-Timing')||'',contentType:response.headers.get('Content-Type')||''};
  } catch { throw Error('Control transport did not confirm request: fetch'); }
}
export async function controlRequest(url,options) {
  const result=await requestBytes(url,options);
  return parseControlResponse(new TextDecoder().decode(result.bytes)+'\n'+result.status+'\n'+result.seconds+'\n'+result.timing);
}
export async function warmControlConnections(origin) {
  await Promise.all(Array.from({length:5},async()=>{
    const response=await requestBytes(new URL('/',origin),{timeoutMs:1500},1024*1024);
    if(response.status!==200||!response.contentType.startsWith('text/html'))throw Error('Control connection calibration failed');
  }));
  // Return consumed sockets to the pool before starting the timed writes.
  await new Promise(setImmediate);
}
