import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const frontend=path.join(root,'frontend');
const assets={};
for(const name of ['index.html','app.js','board.js','board.css','style.css','accounts.js','favicon.svg']){
 const ext=name.split('.').at(-1),type=({html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml'})[ext];
 assets['/'+name]={body:fs.readFileSync(path.join(frontend,name),'utf8'),type};
}
const dist=path.join(root,'dist');
fs.mkdirSync(path.join(dist,'server'),{recursive:true});fs.mkdirSync(path.join(dist,'.openai'),{recursive:true});
fs.writeFileSync(path.join(dist,'server/index.js'),'const ASSETS='+JSON.stringify(assets)+';\n'+fs.readFileSync(path.join(root,'worker/backend.js'),'utf8'));
fs.copyFileSync(path.join(root,'.openai/hosting.json'),path.join(dist,'.openai/hosting.json'));
console.log('Built cloud planner; '+Object.keys(assets).length+' embedded assets. No private records in source.');
