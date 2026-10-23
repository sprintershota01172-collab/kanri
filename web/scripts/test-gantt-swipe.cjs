'use strict';
// Browser-level regression: Gantt horizontal/vertical swipes must not show an
// outline or desynchronize task names and date cells.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const filename=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(filename!==root&&!filename.startsWith(root+path.sep)){res.writeHead(403).end();return}
  fs.readFile(filename===root?path.join(root,'index.html'):filename,(err,data)=>{
    if(err){res.writeHead(404).end();return}
    res.writeHead(200,{'content-type':mime[path.extname(filename)]||'application/octet-stream'}).end(data);
  });
});
const listen=()=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const close=()=>new Promise(resolve=>server.close(resolve));
const sample=Array.from({length:44},(_,i)=>({
 id:'gantt-'+i,title:'同期テスト'+String(i+1).padStart(2,'0'),
 due:'2026-10-29',leadDays:6,duration:30,group:'仕事',folderId:'work',
 important:true,urgent:true,pin:true,rank:i,done:false,weekendWork:i%2===0
}));
(async()=>{
 await listen();
 const browser=await chromium.launch({headless:true});
 try{
  const ctx=await browser.newContext({
   viewport:{width:393,height:852},screen:{width:393,height:852},
   deviceScaleFactor:3,isMobile:true,hasTouch:true,reducedMotion:'reduce'
  });
  await ctx.addInitScript(tasks=>{
   localStorage.setItem('kanri_v1_tasks',JSON.stringify(tasks));
   localStorage.setItem('kanri_v2_view',JSON.stringify({tab:'calendar',folderId:'work'}));
  },sample);
  const page=await ctx.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'load'});
  const before=await page.evaluate(()=>{
   const vertical=document.querySelector('#ganttVertical');
   const scroll=document.querySelector('#ganttScroll');
   const sheet=document.querySelector('.gantt-unified .gantt-sheet');
   const names=[...document.querySelectorAll('#ganttNameBody > .gantt-label-complete-row')];
   const dates=[...document.querySelectorAll('#ganttDayBody > .gantt-task-row')];
   return {
    countNames:names.length,countDates:dates.length,
    scrollHeight:vertical.scrollHeight,clientHeight:vertical.clientHeight,
    horizontalWidth:scroll.scrollWidth,horizontalClient:scroll.clientWidth,
    border:getComputedStyle(sheet).borderTopWidth,
    outlineV:getComputedStyle(vertical).outlineStyle,
    outlineH:getComputedStyle(scroll).outlineStyle,
    offsets:[0,10,25,40].map(i=>names[i].getBoundingClientRect().top-dates[i].getBoundingClientRect().top)
   };
  });
  assert.equal(before.countNames,44);
  assert.equal(before.countDates,44);
  assert.ok(before.scrollHeight>before.clientHeight+150,'single native vertical scroller has overflow: '+JSON.stringify(before));
  assert.ok(before.horizontalWidth>before.horizontalClient+300,'dates have independent horizontal scroll');
  assert.equal(before.border,'0px','outer frame hidden');
  assert.equal(before.outlineV,'none','vertical focus border hidden');
  assert.equal(before.outlineH,'none','horizontal focus border hidden');
  assert.ok(before.offsets.every(n=>Math.abs(n)<=1.1),'rows aligned initially '+before.offsets);
  await page.locator('#ganttVertical').evaluate(el=>{el.scrollTop=270;el.focus()});
  await page.waitForTimeout(75);
  const after=await page.evaluate(()=>{
   const vertical=document.querySelector('#ganttVertical');
   const names=[...document.querySelectorAll('#ganttNameBody > .gantt-label-complete-row')];
   const dates=[...document.querySelectorAll('#ganttDayBody > .gantt-task-row')];
   return {top:vertical.scrollTop,offsets:[0,10,25,40].map(i=>names[i].getBoundingClientRect().top-dates[i].getBoundingClientRect().top)};
  });
  assert.ok(after.top>100,'vertical scroll moved');
  assert.ok(after.offsets.every(n=>Math.abs(n)<=1.1),'date cells and labels must remain exactly in sync after scroll '+after.offsets);

  const scroll=page.locator('#ganttScroll');
  await scroll.evaluate(el=>{el.scrollLeft=270;el.focus()});
  await page.waitForTimeout(75);
  const header=await page.evaluate(()=>{
   const scroll=document.querySelector('#ganttScroll'),head=document.querySelector('#ganttDateHeader');
   const viewport=document.querySelector('.gantt-heading-viewport');
   return {
    left:scroll.scrollLeft,
    headLeft:head.getBoundingClientRect().left,
    viewportLeft:viewport.getBoundingClientRect().left,
    v:document.querySelector('#ganttVertical').scrollTop,
    border:getComputedStyle(document.querySelector('.gantt-unified .gantt-sheet')).borderTopWidth,
    outline:getComputedStyle(scroll).outlineStyle
   };
  });
  assert.ok(header.left>150,'horizontal scroll moved');
  assert.ok(Math.abs(header.headLeft-(header.viewportLeft-header.left))<1.1,
    'date heading tracks horizontal swipe '+JSON.stringify(header));
  assert.ok(Math.abs(header.v-after.top)<1,'horizontal swipe does not disturb vertical position');
  assert.equal(header.border,'0px');
  assert.equal(header.outline,'none');
  assert.deepEqual(errors,[]);
  await ctx.close();
 }finally{await browser.close()}
 console.log('PASS Gantt frame hidden, 44 task names and date rows aligned, independent horizontal/vertical scrolling');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>close());
