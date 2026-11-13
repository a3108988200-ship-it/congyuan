const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const empty=()=>({days:{},settings:{templates:[]}});
function user(request){
 const id=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 if(!id||!email)return null;
 let name=email;
 const raw=request.headers.get('oai-authenticated-user-full-name');
 if(raw&&request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){try{name=decodeURIComponent(raw);}catch{}}
 return {id,username:email,name,role:'member'};
}
function valid(data){
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).sort().join(',')!=='days,settings'||!data.days||typeof data.days!=='object'||Array.isArray(data.days)||!data.settings||typeof data.settings!=='object'||Array.isArray(data.settings))return false;
 if(Object.keys(data.days).length>5000||JSON.stringify(data).length>1800000)return false;
 for(const [date,day] of Object.entries(data.days)){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!day||!Array.isArray(day.tasks)||day.tasks.length>100)return false;
  const ids=new Set();
  for(const t of day.tasks){
   if(!t||typeof t.id!=='string'||t.id.length>100||ids.has(t.id)||typeof t.title!=='string'||!t.title.trim()||t.title.length>120||typeof t.target!=='string'||t.target.length>2000||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)||!Array.isArray(t.steps)||t.steps.length>100||!t.steps.every(s=>typeof s==='string'&&s.length<=5000)||!['pending','doing','done','blocked','deferred'].includes(t.status))return false;
   if(t.stepChecks!==undefined&&(!Array.isArray(t.stepChecks)||t.stepChecks.length>t.steps.length||!t.stepChecks.every(v=>typeof v==='boolean')))return false;
   if(t.result!==undefined&&(typeof t.result!=='string'||t.result.length>5000))return false;
   ids.add(t.id);
  }
  for(const field of ['review','tomorrow','journal','note'])if(day[field]!==undefined&&(typeof day[field]!=='string'||day[field].length>(['journal','note'].includes(field)?5000:10000)))return false;
 }
 return true;
}
async function owner(bucket,id){
 let record=await bucket.get('system/owner.json');
 if(!record){await bucket.put('system/owner.json',JSON.stringify({id}),{onlyIf:{etagDoesNotMatch:'*'}});record=await bucket.get('system/owner.json');}
 if(!record)throw new Error('Owner initialization failed');
 return (await record.json()).id===id;
}
async function state(bucket,id,env,isOwner){
 const key='users/'+encodeURIComponent(id)+'/state.json';
 const record=await bucket.get(key);
 if(record)return {key,etag:record.etag,value:await record.json()};
 let data=empty();
 if(isOwner&&env.CONRAD_MIGRATION_DATA){
  let raw=env.CONRAD_MIGRATION_DATA+Array.from({length:15},(_,i)=>env['CONRAD_MIGRATION_DATA_'+(i+1)]||'').join('');
  if(env.CONRAD_MIGRATION_ENCODING==='gzip-base64'){
   const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
   raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  data=JSON.parse(raw);if(!valid(data))throw new Error('Migration data invalid');
 }
 return {key,etag:null,value:{revision:0,data}};
}
export default {
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  try{
   if(path==='/api/health')return reply({ok:true,storage:!!env.BUCKET,version:'cloud-v1'});
   const identity=user(request);
   if(path==='/api/session'&&!identity)return reply({authenticated:false,setup:false,localSetup:false});
   if(path.startsWith('/api/')){
    if(!identity)return reply({error:'请先使用ChatGPT账号登录。'},401);
    if(!env.BUCKET)return reply({error:'云端存储尚未就绪，请稍后重试。'},503);
    if(!['GET','POST'].includes(request.method))return reply({error:'不支持此操作。'},405);
    if(request.method==='POST'){
     if(request.headers.get('Origin')!==url.origin)return reply({error:'来源校验失败。'},403);
     if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply({error:'请求格式不正确。'},415);
    }
    const isOwner=await owner(env.BUCKET,identity.id);identity.role=isOwner?'admin':'member';
    if(path==='/api/session')return reply({authenticated:true,setup:false,localSetup:false,user:identity,cloud:true});
    if(path==='/api/state'){
     const current=await state(env.BUCKET,identity.id,env,isOwner);
     if(request.method==='GET')return reply({...current.value,user:identity});
     if(Number(request.headers.get('Content-Length')||0)>2000000)return reply({error:'记录过大。'},413);
     const bodyText=await request.text();if(bodyText.length>1900000)return reply({error:'记录过大。'},413);
     let body;try{body=JSON.parse(bodyText);}catch{return reply({error:'记录格式不正确。'},400);}
     if(body.expectedUserId!==identity.id||!Number.isInteger(body.revision)||body.revision!==current.value.revision)return reply({error:'记录或账号已变化，请刷新后重试。'},409);
     if(!valid(body.data))return reply({error:'记录格式不正确，尚未保存。'},400);
     const value={revision:current.value.revision+1,data:body.data};
     const saved=await env.BUCKET.put(current.key,JSON.stringify(value),{onlyIf:current.etag?{etagMatches:current.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
     if(!saved)return reply({error:'另一台设备刚更新了记录，请载入最新内容后重试。'},409);
     return reply({revision:value.revision});
    }
    return reply({error:'云端使用ChatGPT登录；访问权限由Sites分享设置管理。'},404);
   }
   const asset=ASSETS[path==='/'?'/index.html':path];
   if(!asset)return new Response('Not found',{status:404});
   return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'Referrer-Policy':'strict-origin-when-cross-origin'}});
  }catch(error){console.error('Cloud planner request failed:',error.message);return reply({error:'云端暂时无法完成请求；本次修改未确认保存，请稍后重试。'},503);}
 }
};
