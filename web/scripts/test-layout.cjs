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
 const base=gap>0&&gap<=240?Math.max(gap>=54&&gap<=160?Math.min(48,Math.max(0,gap-34)):0,Math.max(0,Math.min(180,physicalHeight-50-height))):0;
 const expectedStep=gap>0&&gap<=240?base+Math.min(24,Math.max(0,gap-base-22)):0;
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

async function checkLongGantt(browser){
 const context=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
 const page=await context.newPage();
 const url='http://127.0.0.1:'+server.address().port+'/index.html';
 await page.goto(url,{waitUntil:'load'});
 await page.evaluate(()=>{
  const tasks=Array.from({length:26},(_,i)=>({id:'long-gantt-'+i,title:'縦スクロール '+i,important:true,urgent:true,group:'仕事',folderId:'work',duration:60,due:null,scheduled:null,leadDays:1,ganttStart:null,pin:false,rank:null,done:false,created:'2026-10-15T00:00:00.000Z'}));
  localStorage.setItem('kanri_v1_tasks',JSON.stringify(tasks));
 });
 await page.reload({waitUntil:'load'});
 await page.locator('[data-tab="calendar"]').click();
 await page.locator('[data-mode="gantt"]').click();
 const initial=await page.evaluate(()=>{
  const left=document.querySelector('#ganttNameBody'),right=document.querySelector('#ganttDayBody');
  const row=left.querySelector('.gantt-label-complete-row');
  return {leftVisible:left.clientHeight,leftTotal:left.scrollHeight,rightVisible:right.clientHeight,rightTotal:right.scrollHeight,rows:left.querySelectorAll('.gantt-label-row').length,dayRows:right.querySelectorAll('.gantt-task-row').length,rowHeight:row.getBoundingClientRect().height,header:document.querySelector('.gantt-label-head').getBoundingClientRect().height};
 });
 assert.equal(initial.rows,26,'long Gantt must mount all 26 name rows');
 assert.equal(initial.dayRows,26,'long Gantt must mount all 26 date rows');
 assert.ok(initial.leftVisible>200,'long Gantt has usable height: '+JSON.stringify(initial));
 assert.ok(Math.abs(initial.leftVisible-20*initial.rowHeight)<4,'Gantt fits exactly 20 rows without changing height: '+JSON.stringify(initial));
 assert.ok(Math.abs(initial.rightVisible-initial.leftVisible)<3,'dates and names have equal viewport heights: '+JSON.stringify(initial));
 assert.ok(initial.leftTotal>initial.leftVisible,'task names must scroll vertically');
 assert.ok(initial.rightTotal>initial.rightVisible,'date grid must scroll vertically');
 const horizontal=await page.evaluate(()=>{
  const scroller=document.querySelector('#ganttScroll'),table=document.querySelector('.gantt-scroll-table'),name=document.querySelector('.gantt-names');
  const strong=document.querySelector('.gantt-label-complete-row strong'),lt=document.querySelector('.gantt-lt');
  const initialX=scroller.scrollLeft;
  scroller.scrollLeft=180;
  return {initialX,scrollLeft:scroller.scrollLeft,scrollWidth:scroller.scrollWidth,clientWidth:scroller.clientWidth,tableWidth:table.getBoundingClientRect().width,nameWidth:name.getBoundingClientRect().width,titleWidth:strong.getBoundingClientRect().width,ltWidth:lt.getBoundingClientRect().width};
 });
 assert.ok(horizontal.scrollWidth>horizontal.clientWidth+150,'horizontal scrollable content must exceed viewport '+JSON.stringify(horizontal));
 assert.ok(horizontal.scrollLeft>90,'horizontal scrolling must work with all twenty-six rows '+JSON.stringify(horizontal));
 assert.ok(horizontal.nameWidth>=210,'task labels need room for approximately fifteen Japanese characters '+JSON.stringify(horizontal));
 assert.ok(horizontal.titleWidth>=145,'title column should hold approximately fifteen characters '+JSON.stringify(horizontal));
 assert.ok(horizontal.ltWidth<=34,'LT column must remain compact '+JSON.stringify(horizontal));
 // Emulate a real finger swipe on the date header, not only programmatic scrollLeft.
 await page.evaluate(()=>{document.querySelector('#ganttScroll').scrollLeft=0});
 const rect=await page.locator('#ganttScroll').boundingBox();
 assert.ok(rect&&rect.width>55,'Gantt date viewport must remain tappable');
 const client=await context.newCDPSession(page);
 const sx=rect.x+rect.width-13,sy=rect.y+18;
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sx,y:sy,id:1}]});
 for(let step=1;step<=6;step++){
   await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:sx-step*17,y:sy,id:1}]});
   await page.waitForTimeout(16);
 }
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForTimeout(80);
 const swipeX=await page.locator('#ganttScroll').evaluate(el=>el.scrollLeft);
 assert.ok(swipeX>10,'real horizontal touch swipe must move Gantt dates: '+swipeX);
 const scrolled=await page.evaluate(()=>{
  const left=document.querySelector('#ganttNameBody'),right=document.querySelector('#ganttDayBody');
  left.scrollTop=left.scrollHeight-left.clientHeight;
  left.dispatchEvent(new Event('scroll'));
  return {names:left.scrollTop,days:right.scrollTop};
 });
 assert.ok(scrolled.names>0,'scrolled to task 26');
 assert.ok(Math.abs(scrolled.names-scrolled.days)<2,'name/date scroll synchronization '+JSON.stringify(scrolled));
 await context.close();
 return '26 tasks rendered, 20-row viewport, synced vertical scrolling';
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
  console.log('PASS',await checkLongGantt(browser));
 }finally{await browser.close();await new Promise(ok=>server.close(ok))}
})().catch(error=>{console.error(error);process.exitCode=1;server.close()});
