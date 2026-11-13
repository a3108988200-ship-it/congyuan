// Localhost-only synthetic UI fixture. Never used in the production Worker.
import http from 'node:http';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../dist/server/index.js',import.meta.url),'utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const map=new Map();let revision=0;
const env={BUCKET:{async get(k){const v=map.get(k);return v?{etag:v.etag,json:async()=>JSON.parse(v.text)}:null;},async put(k,text,opt){const old=map.get(k);if(opt?.onlyIf?.etagDoesNotMatch==='*'&&old)return null;if(opt?.onlyIf?.etagMatches&&opt.onlyIf.etagMatches!==old?.etag)return null;const v={text,etag:String(++revision)};map.set(k,v);return v;}},CONRAD_MIGRATION_DATA:JSON.stringify({days:{},settings:{templates:[]}})};
http.createServer(async(req,res)=>{
 try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id','synthetic-ui-test');headers.set('oai-authenticated-user-email','preview@example.test');const r=await worker.fetch(new Request('http://127.0.0.1:8791'+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}),env);res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));}catch{res.writeHead(500);res.end('preview failed');}
}).listen(8791,'127.0.0.1',()=>console.log('Synthetic preview http://127.0.0.1:8791'));
