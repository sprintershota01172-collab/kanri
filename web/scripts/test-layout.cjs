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
 assert.ok(horizontal.nameWidth>=140&&horizontal.nameWidth<=160,'Gantt task label column should be roughly eight Japanese characters wide '+JSON.stringify(horizontal));
 assert.ok(horizontal.titleWidth>=68&&horizontal.titleWidth<=104,'Gantt title should fit approximately eight Japanese characters and leave room for dates '+JSON.stringify(horizontal));
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
async function checkCompactMonthAgenda(browser){
 const context=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
 const page=await context.newPage();
 const url='http://127.0.0.1:'+server.address().port+'/index.html';
 await page.goto(url,{waitUntil:'load'});
 await page.evaluate(()=>{
   const d=new Date();
   const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
   const tasks=Array.from({length:22},(_,i)=>({id:'month-agenda-'+i,title:'月予定 '+i,important:true,urgent:true,group:'仕事',folderId:'work',duration:30,due:key,scheduled:null,leadDays:1,ganttStart:null,pin:false,rank:null,done:false,created:d.toISOString()}));
   localStorage.setItem('kanri_v1_tasks',JSON.stringify(tasks));
 });
 await page.reload({waitUntil:'load'});
 await page.locator('[data-tab="calendar"]').click();
 assert.ok(await page.locator('[data-mode="gantt"]').evaluate(el=>el.classList.contains('selected')),'PLAN defaults to Gantt');
 assert.ok(await page.locator('.gantt-excel').count(),'Gantt renders when PLAN initially opens');
 await page.locator('[data-mode="month"]').click();
 const layout=await page.evaluate(()=>{
  const month=document.querySelector('.month-box'),calendar=document.querySelector('#calendarContent'),list=document.querySelector('.agenda-list');
  const cards=[...list.querySelectorAll('.agenda-task')];
  const visibleTop=list.getBoundingClientRect().top,visibleBottom=list.getBoundingClientRect().bottom;
  return {
    calendarHeight:calendar.getBoundingClientRect().height,
    monthHeight:month.getBoundingClientRect().height,
    visibleCards:cards.filter(el=>el.getBoundingClientRect().top>=visibleTop-1&&el.getBoundingClientRect().bottom<=visibleBottom+1).length,
    allCards:cards.length,
    listHeight:list.clientHeight,listScrollHeight:list.scrollHeight,
    sixWeeks:document.querySelectorAll('.month-grid .day').length,
  };
 });
 assert.equal(layout.sixWeeks,42,'month grid keeps 42 date cells');
 assert.ok(layout.monthHeight/layout.calendarHeight<0.52,'month grid is compact: '+JSON.stringify(layout));
 assert.ok(layout.visibleCards>=5,'about five appointment cards remain visible below month grid: '+JSON.stringify(layout));
 assert.equal(layout.allCards,22,'no events are silently omitted');
 assert.ok(layout.listScrollHeight>layout.listHeight,'additional appointments are scrollable');
 await context.close();
 return 'Gantt default; compact month with at least five visible appointments and scrollable overflow';
}
async function checkTaskCompletionAndTicker(browser){
 const context=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
 const page=await context.newPage();
 const url='http://127.0.0.1:'+server.address().port+'/index.html';
 await page.goto(url,{waitUntil:'load'});
 await page.evaluate(()=>{
   const d=new Date();
   const today=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
   const task=(id,name)=>({id,title:name,important:true,urgent:true,group:'仕事',folderId:'work',duration:30,due:today,scheduled:null,leadDays:1,ganttStart:null,pin:false,rank:null,done:false,created:d.toISOString()});
   localStorage.setItem('kanri_v1_tasks',JSON.stringify([
     task('tap-complete-focus','完了動作の確認：ものすごく長いタスク名が左方向へ流れて表示されることを確認するためのテスト項目その一'),
     task('tap-complete-calendar','完了動作の確認：もう一つの長いタスク名を日付の一覧からタップして完了できるか')
   ]));
 });
 await page.reload({waitUntil:'load'});
 const card=page.locator('.task-card').first();
 await card.waitFor();
 await page.waitForTimeout(220);
 const layout=await card.evaluate(el=>{
   const view=el.querySelector('.ticker-window'),track=view.querySelector('.ticker-track');
   const check=el.querySelector('.check');
   return {height:el.getBoundingClientRect().height,
     checkWidth:check.getBoundingClientRect().width,checkHeight:check.getBoundingClientRect().height,
     textWidth:track.querySelector('.ticker-text').getBoundingClientRect().width,windowWidth:view.getBoundingClientRect().width,
     textLength:track.querySelector('.ticker-text').textContent.length,trackWidth:track.getBoundingClientRect().width,trackCss:getComputedStyle(track).display,viewWidth:view.clientWidth,tag:el.outerHTML.slice(0,500),
     overflowing:track.querySelector('.ticker-text').getBoundingClientRect().width>view.getBoundingClientRect().width,
     animated:track.classList.contains('ticker-moving'),
     compactMeta:!!el.querySelector('.task-meta-compact'),multiline:!!el.querySelector('.meta')};
 });
 assert.ok(layout.height>=26&&layout.height<=32,'FOCUS task strip is approximately half-height: '+JSON.stringify(layout));
 assert.ok(layout.checkWidth>=26&&layout.checkHeight>=25,'check tap target remains usable: '+JSON.stringify(layout));
 assert.ok(layout.overflowing&&layout.animated,'long one-line title scrolls like an airport ticker: '+JSON.stringify(layout));
 assert.ok(layout.compactMeta&&!layout.multiline,'deadline/time metadata stays on one line: '+JSON.stringify(layout));
 await page.locator('[data-done="tap-complete-focus"]').tap();
 let taskState=await page.evaluate(()=>JSON.parse(localStorage.getItem('kanri_v1_tasks')));
 assert.equal(taskState.find(t=>t.id==='tap-complete-focus').done,true,'actual touch tap on FOCUS check completes task');
 assert.ok(!await page.locator('[data-done="tap-complete-focus"]').count(),'completed task immediately leaves FOCUS');
 assert.ok(await page.locator('#undoBar.show').count(),'completion offers undo');
 await page.locator('[data-tab="calendar"]').tap();
 await page.locator('[data-mode="month"]').tap();
 const agenda=page.locator('[data-done="tap-complete-calendar"].agenda-check');
 await agenda.waitFor();
 const agendaHeight=await agenda.evaluate(el=>el.closest('.agenda-task').getBoundingClientRect().height);
 assert.ok(agendaHeight>=24&&agendaHeight<=30,'monthly agenda row is about half-height: '+agendaHeight);
 await agenda.tap();
 taskState=await page.evaluate(()=>JSON.parse(localStorage.getItem('kanri_v1_tasks')));
 assert.equal(taskState.find(t=>t.id==='tap-complete-calendar').done,true,'actual touch tap on monthly agenda check completes task');
 assert.equal(await page.locator('.agenda-check').count(),0,'completed agenda task disappears');
 await page.locator('#trashCalendar').tap();
 assert.equal(await page.locator('.trash-item').count(),2,'both tasks are retained in seven-day trash');
 await context.close();
 return 'real touch-tap completion in FOCUS and month, 29px bands and animated long titles';
}
async function checkGroupGestures(browser){
 const context=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'load'});
 await page.locator('[data-quick-folder="work"]').click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('kanri_v2_view')).folderId),'work','selected group is work');
 const rect=await page.locator('#board .quadrant').first().boundingBox();
 assert.ok(rect&&rect.width>100,'TODO board must provide a swipe surface');
 const client=await context.newCDPSession(page);
 const x=rect.x+rect.width-14,y=rect.y+rect.height*.45;
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
 for(let i=1;i<=8;i++){
   await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-i*13,y,id:1}]});
   await page.waitForTimeout(12);
 }
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForTimeout(70);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('kanri_v2_view')).folderId),'personal','left swipe on TODO board changes to adjacent group');
 assert.ok(await page.locator('#boardScreen').evaluate(el=>el.classList.contains('active')),'group swipe must not switch bottom tabs');
 const work=page.locator('[data-quick-folder="work"]');
 await work.scrollIntoViewIfNeeded();
 const box=await work.boundingBox();
 assert.ok(box,'work group chip is visible to long-press');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();
 await page.waitForTimeout(490);
 await page.mouse.up();
 await page.waitForSelector('#groupMoveNext');
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('kanri_v2_folders')).filter(f=>f.parentId===null).map(f=>f.id));
 await page.locator('#groupMoveNext').click();
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('kanri_v2_folders')).filter(f=>f.parentId===null).map(f=>f.id));
 assert.ok(after.indexOf('work')>before.indexOf('work'),'long-press menu moves group right');
 await context.close();
 return 'touch swipe switches groups and long press reorders group buttons';
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
  console.log('PASS',await checkCompactMonthAgenda(browser));
  console.log('PASS',await checkTaskCompletionAndTicker(browser));
  console.log('PASS',await checkGroupGestures(browser));
 }finally{await browser.close();await new Promise(ok=>server.close(ok))}
})().catch(error=>{console.error(error);process.exitCode=1;server.close()});
