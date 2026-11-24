// Static-only artifact for GitHub Pages. Do not publish the private repository.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),out=path.join(root,'dist'),src=path.join(root,'web');
const env=process.env,live=env.LIFEOS_ENABLE_GOOGLE==='true',enrollment=env.LIFEOS_ENROLLMENT==='true';
if(live&&enrollment)throw Error('Choose setup or live, not both');
const cfg={enabled:false,enrollment:false,clientId:'',ownerSubSha256:'',origin:''};
if(live||enrollment){
 const origin=env.LIFEOS_ORIGIN||'',owner=(env.LIFEOS_PAGES_OWNER||'').toLowerCase();
 if(!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(owner)||owner==='mauveplace'||origin!=='https://'+owner+'.github.io')throw Error('Dedicated GitHub Pages organization origin required');
 if(env.LIFEOS_PRODUCTION_BRANCH!==env.GITHUB_REF_NAME||!env.GITHUB_REF_NAME)throw Error('Live production branch required');
 const client=env.LIFEOS_GOOGLE_CLIENT_ID||'',sub=env.LIFEOS_OWNER_SUB_SHA256||'';
 if(!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(client)||(live&&!/^[a-f0-9]{64}$/.test(sub)))throw Error('Invalid public OAuth client or stable owner pin');
 Object.assign(cfg,{enabled:live,enrollment,clientId:client,ownerSubSha256:live?sub:'',origin});
}
const allow=['index.html','style.css','app.mjs','core.mjs','sheets.mjs','google.mjs','config.mjs','manifest.webmanifest','icon.svg','sw.js'];
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
for(const file of allow)fs.copyFileSync(path.join(src,file),path.join(out,file));
fs.writeFileSync(path.join(out,'config.mjs'),'export const googleConfig=Object.freeze('+JSON.stringify(cfg)+');\n');
fs.writeFileSync(path.join(out,'.nojekyll'),'');
console.log(live?'GITHUB_PAGES_OWNER_CONFIG_READY (live consent unverified)':'GITHUB_PAGES_SYNTHETIC_BUILD_READY');
