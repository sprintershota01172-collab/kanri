'use strict';
// Real-browser regression for iPhone-size layout: native compositor transitions,
// no screen bounce and no stacked overlays under fast tab/day taps.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const name=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!name.startsWith(root+path.sep)&&name!==root){res.writeHead(403).end();return}
  const filename=name===root?path.join(root,'index.html'):name;
  fs.readFile(filename,(error,data)=>{
    if(error){res.writeHead(404).end();return}
    res.writeHead(200,{'content-type':types[path.extname(filename)]||'application/octet-stream'}).end(data);
  });
});
const listen=()=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const close=()=>new Promise(resolve=>server.close(resolve));
(async()=>{
  await listen();
  const browser=await chromium.launch({headless:true});
  try{
    for(const reducedMotion of ['no-preference','reduce']){
      const context=await browser.newContext({
        viewport:{width:393,height:852},screen:{width:393,height:852},
        deviceScaleFactor:3,isMobile:true,hasTouch:true,reducedMotion
      });
      const page=await context.newPage();
      const pageErrors=[];
      page.on('pageerror',error=>pageErrors.push(error.message));
      await page.goto('http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'load'});
      const original=await page.evaluate(()=>{
        const el=document.querySelector('.main'),nav=document.querySelector('.nav');
        const m=el.getBoundingClientRect(),n=nav.getBoundingClientRect();
        return {mainTop:m.top,mainHeight:m.height,navTop:n.top,navBottom:n.bottom};
      });
      await page.locator('[data-tab="calendar"]').click();
      assert.equal(await page.locator('#calendarScreen.active').count(),1,'PLAN active after tab tap');
      await page.waitForTimeout(420);
      assert.equal(await page.locator('.screen.kanri-exiting').count(),0,'old tab fully removed after entrance');
      await page.locator('#calModes [data-mode="month"]').click();
      const selected=await page.locator('#calendarContent .month-grid .day.sel').getAttribute('data-caldate');
      await page.evaluate(()=>{window.__monthGrid=document.querySelector('.month-grid')});
      const other=page.locator('#calendarContent .month-grid .day:not(.outside)').filter({hasNotText:'never-exists'}).first();
      const dates=await page.locator('#calendarContent .month-grid .day:not(.outside)').evaluateAll(xs=>xs.map(x=>x.dataset.caldate));
      const next=dates.find(d=>d!==selected);
      assert.ok(next,'another date exists within visible month');
      await page.locator('#calendarContent .month-grid [data-caldate="'+next+'"]').click();
      assert.equal(await page.evaluate(()=>window.__monthGrid===document.querySelector('.month-grid')),true,
        'daily pick must not recreate the calendar');
      assert.equal(await page.locator('#calendarContent .month-grid .day.sel').getAttribute('data-caldate'),next);

      await page.locator('#nextDate').click();
      await page.locator('#prevDate').click();
      await page.waitForTimeout(460);
      assert.equal(await page.locator('.kanri-day-previous').count(),0,'no afterimage from rapid calendar navigation');

      await page.locator('[data-tab="puzzle"]').click();
      await page.locator('#puznext').click();
      await page.locator('#puzprev').click();
      await page.waitForTimeout(470);
      assert.equal(await page.locator('.kanri-day-previous').count(),0,'no stacked puzzle day layers');
      const after=await page.evaluate(()=>{
        const el=document.querySelector('.main'),nav=document.querySelector('.nav');
        const m=el.getBoundingClientRect(),n=nav.getBoundingClientRect();
        return {mainTop:m.top,mainHeight:m.height,navTop:n.top,navBottom:n.bottom};
      });
      for(const key of Object.keys(original))
        assert.ok(Math.abs(original[key]-after[key])<1,'app frame must remain stable: '+key);
      if(reducedMotion==='reduce')
        assert.equal(await page.evaluate(()=>document.getAnimations().length),0,'motion reduced for accessibility');
      assert.deepEqual(pageErrors,[],'no runtime errors in browser');
      await context.close();
    }
  }finally{await browser.close()}
  console.log('PASS iPhone-size tab/day transitions, frame stability, no ghost overlays and reduced-motion');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>close());
