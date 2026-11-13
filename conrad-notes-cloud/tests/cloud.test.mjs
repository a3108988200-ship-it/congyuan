import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
const text=fs.readFileSync(new URL('../dist/server/index.js',import.meta.url),'utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'))).default;
class Bucket {
 values=new Map();count=0;
 async get(key){const v=this.values.get(key);return v?{etag:v.etag,json:async()=>JSON.parse(v.body)}:null;}
 async put(key,body,options={}){
  const old=this.values.get(key),condition=options.onlyIf;
  if(condition?.etagDoesNotMatch==='*'&&old)return null;
  if(condition?.etagMatches&&condition.etagMatches!==old?.etag)return null;
  const v={etag:String(++this.count),body};this.values.set(key,v);return v;
 }
}
const initial={days:{'2026-11-10':{tasks:[],journal:'synthetic private owner note'}},settings:{templates:[]}};
const env={BUCKET:new Bucket(),CONRAD_MIGRATION_DATA:gzipSync(JSON.stringify(initial)).toString('base64'),CONRAD_MIGRATION_ENCODING:'gzip-base64'};
async function call(path,{id='owner',method='GET',body,origin='https://notes.test'}={}){
 const headers={};if(id){headers['oai-authenticated-user-id']=id;headers['oai-authenticated-user-email']=id+'@example.com';}
 if(method==='POST'){headers.Origin=origin;headers['Content-Type']='application/json';}
 return worker.fetch(new Request('https://notes.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
}
assert.equal((await call('/api/state',{id:null})).status,401);
let response=await call('/api/state'),state=await response.json();
assert.deepEqual(state.data,initial,'owner migration is delivered privately');
assert.equal(state.revision,0);
const payload={expectedUserId:'owner',revision:0,data:initial};
assert.equal((await call('/api/state',{method:'POST',body:payload,origin:'https://evil.test'})).status,403);
assert.equal((await call('/api/state',{method:'POST',body:{...payload,expectedUserId:'someone'}})).status,409);
assert.equal((await call('/api/state',{method:'POST',body:{...payload,data:{days:{bad:{tasks:[]}},settings:{}}}})).status,400);
const writes=await Promise.all([call('/api/state',{method:'POST',body:payload}),call('/api/state',{method:'POST',body:payload})]);
assert.deepEqual(writes.map(r=>r.status).sort(),[200,409],'only one concurrent save wins');
state=await (await call('/api/state')).json();assert.equal(state.revision,1);assert.deepEqual(state.data,initial);
const other=await (await call('/api/state',{id:'other'})).json();assert.deepEqual(other.data.days,{},'other identities never receive owner seed');
assert.equal((await call('/api/state',{id:'other',method:'POST',body:{...payload,revision:1}})).status,409);
response=await call('/');const html=await response.text();
assert.ok(html.includes('/signin-with-chatgpt?return_to=%2F'));
assert.ok(html.includes('target="_top"'));
assert.ok(!html.includes('onclick='),'no blocked inline click handlers');
assert.ok(html.includes('cloudAddTask'));
assert.equal((await call('/api/health',{id:null})).status,200);
console.log('PASS: ChatGPT identity, private owner migration, cross-user isolation, origin/schema validation, optimistic concurrent saves, reload and cloud UI entry.');
