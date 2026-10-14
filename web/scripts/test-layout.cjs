'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png'};
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
 const filename=path.resolve(root,'.'+pathname);
 if(!(filename===root||filename.startsWith(root+path.sep))){res.writeHead(403);res.end();return}
 const target=filename===root?path.join(root,'index.html'):filename;
 fs.readFile(target,(err,data)=>{if(err){res.writeHead(404);res.end();return}res.writeHead(200,{'content-type':mime[path.extname(target)]||'text/plain'});res.end(data)});
});
async function check(browser,width,height,safe,physicalHeight=height){
 const context=await browser.newContext({viewport:{width,height},screen:{width,height:physicalHeight},deviceScaleFactor:3,isMobile:true,hasTouch:true});
 await context.addInitScript((bottom)=>{
  Object.defineProperty(navigator,'standalone',{configurable:true,value:true});
  const native=window.matchMedia.bind(window);
  window.matchMedia=(query)=>query.includes('display-mode: standalone')?{matches:true,media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}:native(query);
  document.documentElement.style.setProperty('--safe-bottom',bottom+'px');
 },safe);
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'load'});
 await page.evaluate(bottom=>document.documentElement.style.setProperty('--safe-bottom',bottom+'px'),safe);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));

 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.nav')).display==='grid');
 const data=await page.evaluate(()=>{
   const rect=sel=>{let r=document.querySelector(sel).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};
   const buttons=[...document.querySelectorAll('.nav .nav-btn')].map(el=>{
    const r=el.getBoundingClientRect();
    const cx=(r.left+r.right)/2,cy=(r.top+r.bottom)/2;
    const target=document.elementFromPoint(cx,cy);
    return {name:el.getAttribute('aria-label')||el.textContent.trim(),top:r.top,bottom:r.bottom,left:r.left,right:r.right,
      centerAccessible:target===el||el.contains(target)||!!target?.closest('.nav-btn')?.isSameNode(el),
      display:getComputedStyle(el).display,visibility:getComputedStyle(el).visibility};
   });
   const css=getComputedStyle(document.querySelector('.device'));
   return {step:document.documentElement.style.getPropertyValue('--kanri-bottom-step'),innerHeight:window.innerHeight,rootHeight:getComputedStyle(document.documentElement).height,
     vh:document.documentElement.style.getPropertyValue('--vh'),nav:rect('.nav'),main:rect('.main'),device:rect('.device'),
     buttons,background:getComputedStyle(document.querySelector('.nav')).backgroundColor,
     deviceHeight:parseFloat(css.height)};
 });
 const label=width+'x'+height+' safe '+safe+' physical '+physicalHeight;
 const gap=physicalHeight-height;
 const expectedStep=gap>0&&gap<=240?Math.max(gap>=54&&gap<=160?Math.min(48,Math.max(0,gap-34)):0,Math.max(0,Math.min(180,physicalHeight-50-height))):0;
 assert.equal(data.step,expectedStep+'px',label+' extension must be limited');
 assert.equal(data.buttons.length,5,label+' has exactly 5 tabs');
 assert.ok(data.nav.top>=0&&data.nav.bottom<=height+expectedStep+1,label+' nav extension within guarded limit: '+JSON.stringify(data));
 assert.ok(data.nav.bottom>=height+expectedStep-2,label+' nav reaches compensated bottom: '+JSON.stringify(data.nav));
 assert.ok(data.nav.height>=64+safe-2,label+' nav has room for safe area: '+JSON.stringify(data));
 assert.ok(data.main.bottom<=data.nav.top+2,label+' content must not overlap the tab bar');
 assert.ok(data.device.bottom<=height+expectedStep+2,label+' shell may extend only by guarded step');
 for(const b of data.buttons){
  assert.ok(b.top>=data.nav.top-2&&b.bottom<=data.nav.bottom+2,label+' tab in nav: '+JSON.stringify(b));
  assert.ok(b.centerAccessible,label+' tab must be tappable: '+JSON.stringify(b));
  assert.notEqual(b.display,'none',label+' tab visible');
 }
 assert.equal(data.background,'rgb(255, 255, 255)',label+' nav matches lower iOS white region');
 await page.locator('.nav-btn[data-tab="calendar"]').click();
 assert.ok(await page.locator('#calendarScreen').evaluate(el=>el.classList.contains('active')),label+' PLAN clickable');
 await page.locator('.nav-btn[data-tab="settings"]').click();
 assert.ok(await page.locator('#settingsScreen').evaluate(el=>el.classList.contains('active')),label+' SETUP clickable');
 await context.close();
 return label+': nav '+data.nav.top.toFixed(1)+'–'+data.nav.bottom.toFixed(1)+'; '+data.buttons.length+' tappable tabs';
}
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const [w,h] of [[375,812],[393,852],[402,874],[430,932]]){
   for(const safe of [0,34])console.log('PASS',await check(browser,w,h,safe));
  }
  // PWA receives a shorter innerHeight than the iPhone CSS-pixel screen.
  // Only the lower shell extends; all five button hit targets must remain usable.
  console.log('PASS',await check(browser,393,780,34,852));
  console.log('PASS',await check(browser,402,800,34,874));
 }finally{await browser.close();await new Promise(ok=>server.close(ok))}
})().catch(error=>{console.error(error);process.exitCode=1;server.close()});
