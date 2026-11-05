const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve(__dirname,'..','package.json'));
const express=req('express');
const multer=req('multer');
const fixtureParent=path.resolve(__dirname,'..','test-results');
const root=path.join(fixtureParent,'dependency-security-'+process.pid);
assert.ok(root.startsWith(fixtureParent+path.sep));
process.env.OBS_LIVE_HELPER_DATA_DIR=root;

async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;}
async function close(server){await new Promise(resolve=>server.close(resolve));}
async function main(){
 const app=express();
 app.use('/font',req('./routes/font'));
 app.post('/filter',multer({storage:multer.memoryStorage(),fileFilter(_r,file,cb){setTimeout(()=>cb(null,file.originalname!=='reject.bin'),file.originalname==='reject.bin'?0:25);}}).array('files'),(_r,res)=>res.json({ok:true}));
 app.use((error,_r,res,_next)=>res.status(400).json({error:error.code||error.message}));
 const server=http.createServer(app);const origin=await listen(server);
 try{
   const form=new FormData();form.append('font',new Blob(['font-fixture']),'security-fixture.woff');
   let response=await fetch(origin+'/font/upload',{method:'POST',body:form});
   assert.equal(response.status,200);assert.equal((await response.json()).family,'security-fixture');
   assert.equal(fs.readFileSync(path.join(root,'fonts/security-fixture.woff'),'utf8'),'font-fixture');
   response=await fetch(origin+'/font/list');assert.ok((await response.json()).includes('security-fixture'));
   response=await fetch(origin+'/font/upload',{method:'POST',body:new FormData()});assert.equal(response.status,400);
   response=await fetch(origin+'/font/upload',{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=broken'},body:'malformed'});assert.equal(response.status,400);
   const filtered=new FormData();filtered.append('files',new Blob(['one']),'reject.bin');filtered.append('files',new Blob(['two']),'allowed.bin');
   response=await fetch(origin+'/filter',{method:'POST',body:filtered});assert.equal(response.status,200);
   const expectedFonts=fs.readdirSync(path.join(root,'fonts')).sort();
   // Abort a real partial disk upload, then check for orphaned temporary files.
   await new Promise(resolve=>{
     const request=http.request(origin+'/font/upload',{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=abort-fixture'}});
     request.on('error',()=>{});request.write('--abort-fixture\r\nContent-Disposition: form-data; name="font"; filename="aborted.woff"\r\nContent-Type: application/octet-stream\r\n\r\npartial');
     setTimeout(()=>{request.destroy();resolve();},40);
   });
   await new Promise(resolve=>setTimeout(resolve,100));
   assert.deepEqual(fs.readdirSync(path.join(root,'fonts')).sort(),expectedFonts);
   response=await fetch(origin+'/font/list');assert.equal(response.status,200);
 }finally{await close(server);}
 const received=[];
 const destination=http.createServer((r,res)=>{received.push(r.headers);res.end('ok');});
 const dest=await listen(destination);
 const redirect=http.createServer((_r,res)=>{res.writeHead(302,{Location:dest.replace('127.0.0.1','localhost')+'/target'});res.end();});
 const from=await listen(redirect);
 try{
   const follow=req('follow-redirects').http;
   for(const sensitiveHeaders of [['X-API-Key'],vm.runInNewContext("['X-API-Key']")]){
     await new Promise((resolve,reject)=>follow.get(from,{family:4,headers:{'X-API-Key':'synthetic-fixture','X-Harmless':'keep',Authorization:'Bearer fixture'},sensitiveHeaders},r=>{r.resume();r.on('end',resolve);}).on('error',reject));
   }
   await req('axios').get(from,{family:4,headers:{Authorization:'Bearer fixture','X-Harmless':'keep'}});
   assert.equal(received.length,3);
   for(const headers of received){assert.equal(headers.authorization,undefined);assert.equal(headers['x-api-key'],undefined);assert.equal(headers['x-harmless'],'keep');}
 }finally{await close(redirect);await close(destination);}
 const modernReq=createRequire(req.resolve('config-file-ts'));
 assert.equal(modernReq('glob/package.json').version,'14.0.2');
 assert.equal(modernReq('glob').globSync('fonts/*.woff',{cwd:root}).length,1);
 assert.equal(typeof req('glob'),'function','legacy glob7 callback API retained');
 const nodemonReq=createRequire(req.resolve('nodemon'));
 assert.equal(nodemonReq('minimatch').minimatch('index.js','**/*.js'),true);
 console.log(JSON.stringify({status:'passed',versions:{multer:req('multer/package.json').version,followRedirects:req('follow-redirects/package.json').version,glob:modernReq('glob/package.json').version},checks:['real font upload/list/missing/malformed','async fileFilter','aborted upload cleans disk','same-realm and cross-realm custom header stripping','Axios authorization stripping','modern glob and nodemon minimatch','legacy glob7 API retained'],liveServices:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
