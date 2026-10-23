'use strict';
// End-to-end viewport test for scrollable quadrant lists and 10 font levels.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const name=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(name!==root&&!name.startsWith(root+path.sep)){res.writeHead(403).end();return}
  fs.readFile(name===root?path.join(root,'index.html'):name,(error,data)=>{
    if(error){res.writeHead(404).end();return}
    res.writeHead(200,{'content-type':mime[path.extname(name)]||'application/octet-stream'}).end(data);
  });
});
const listen=()=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const close=()=>new Promise(resolve=>server.close(resolve));
const items=Array.from({length:26},(_,i)=>({
  id:'task-'+i,title:'スクロール確認 '+String(i+1).padStart(2,'0'),
  due:'2026-12-22',important:true,urgent:true,leadDays:1,duration:20,
  folderId:'work',group:'仕事',pin:true,rank:i,done:false,
  created:'2026-01-01T00:00:00.000Z',weekendWork:false
}));
(async()=>{
 await listen();
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({
    viewport:{width:393,height:852},screen:{width:393,height:852},
    deviceScaleFactor:3,isMobile:true,hasTouch:true
  });
  await context.addInitScript(tasks=>{
    localStorage.setItem('kanri_v1_tasks',JSON.stringify(tasks));
    localStorage.setItem('kanri_v2_view',JSON.stringify({tab:'board',folderId:'work'}));
  },items);
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'load'});
  const area=page.locator('#board [data-board-folder="work"] .quadrant[data-q="0"] .task-area');
  assert.equal(await area.locator('.task-wrap').count(),26,'all tasks exist; none hidden behind pagination');
  assert.equal(await page.locator('#board [data-page-key]').count(),0,'board pagination is removed');
  const sizes=await area.evaluate(el=>({client:el.clientHeight,scroll:el.scrollHeight,overflow:getComputedStyle(el).overflowY}));
  assert.ok(sizes.client>30&&sizes.scroll>sizes.client+200,'quad task area has its own real scroll overflow: '+JSON.stringify(sizes));
  assert.equal(sizes.overflow,'auto');
  const outerBefore=await page.locator('#board').evaluate(el=>el.scrollTop);
  await area.evaluate(el=>{el.scrollTop=230});
  await page.waitForTimeout(80);
  const innerAfter=await area.evaluate(el=>el.scrollTop);
  assert.ok(innerAfter>150,'inner list scrolls by itself');
  assert.equal(await page.locator('#board').evaluate(el=>el.scrollTop),outerBefore,'outer group view does not move with inner scroll');
  await page.locator('#sortButton').click();
  assert.ok(await area.evaluate(el=>el.scrollTop)>100,'list scroll is preserved on board rerender');

  await page.locator('[data-tab="settings"]').click();
  await page.locator('#fontStepRange').evaluate(el=>{
    el.value='10';el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  assert.equal(await page.locator('#fontStepValue').textContent(),'10 / 10');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('kanri_v1_prefs')).fontStep),10,'font choice persisted');
  await page.locator('[data-tab="board"]').click();
  const computed=await page.evaluate(()=>{
    const app=document.querySelector('#app');
    const title=document.querySelector('#board .static-task-title');
    return {scale:getComputedStyle(app).getPropertyValue('--kanri-text-scale').trim(),font:parseFloat(getComputedStyle(title).fontSize)};
  });
  assert.equal(computed.scale,'1.30');
  assert.ok(computed.font>10,'board text gets visibly larger');
  assert.equal(await area.locator('.task-wrap').count(),26,'text settings must not discard tasks');
  assert.ok(await area.evaluate(el=>el.scrollTop)>100,'scroll position survives switching tabs');

  // Edge autoscroll permits placing a card into a task-list position that was
  // previously hidden below the quadrant. It starts only after long press.
  await area.evaluate(el=>{el.scrollTop=0});
  const card=area.locator('.task-card').first(),box=await card.boundingBox(),r=await area.boundingBox();
  assert.ok(box&&r);
  const x=box.x+Math.min(box.width-12,55),y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.waitForTimeout(290);
  await page.mouse.move(x,r.y+r.height-5,{steps:6});
  await page.waitForTimeout(300);
  assert.ok(await area.evaluate(el=>el.scrollTop)>0,'long-press drag scrolls at edge of long list');
  const hint=await page.evaluate(()=>{
    const slot=document.querySelector('#board .kanri-drag-slot');
    return slot?{text:slot.textContent,after:getComputedStyle(slot,'::after').content}:null;
  });
  assert.ok(hint,'drag shows an insertion gap');
  assert.equal(hint.text,'','slot has no message text');
  assert.ok(hint.after==='none'||hint.after==='normal','slot has no pseudo-element message');
  await page.mouse.up();
  assert.equal(await page.locator('#board .kanri-drag-slot').count(),0,'slot removed after drop');

  await page.reload();
  assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).getPropertyValue('--kanri-text-scale').trim()),'1.30','font scale survives page reload');
  assert.deepEqual(errors,[],'no browser exceptions');
  await context.close();
 }finally{await browser.close()}
 console.log('PASS 26 tasks scroll within quadrants, 10 font steps persist, drag edge scrolling and no insertion label');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>close());
