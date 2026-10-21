// Navigation regression: stable tab animation, rapid taps and zero-rebuild date picks.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
let reduced=false;
const motions=[];
const dom=new JSDOM(html,{
  url:'https://example.test/kanri/',runScripts:'dangerously',pretendToBeVisual:true,
  beforeParse(w){
    w.matchMedia=()=>({matches:reduced,addListener(){},removeListener(){}});
    w.Element.prototype.animate=function(frames,opts){
      const listeners={};
      const animation={
        el:this,frames,opts,
        addEventListener(type,fn){(listeners[type]??=[]).push(fn)},
        cancel(){(listeners.cancel||[]).forEach(fn=>fn())},
        finish(){(listeners.finish||[]).forEach(fn=>fn())}
      };
      motions.push(animation);
      return animation;
    };
  }
});
const d=dom.window.document;
const click=sel=>{const el=d.querySelector(sel);assert.ok(el,'missing '+sel);el.click();return el};
const dayValue=()=>d.querySelector('#calendarContent .day.sel')?.dataset.caldate;
try{
  click('[data-tab="calendar"]');
  assert.ok(d.querySelector('#calendarScreen.active'),'calendar tab should be active');
  assert.ok(d.querySelector('#boardScreen.kanri-exiting'),'previous tab remains for exit animation');
  assert.ok(motions.some(m=>m.el.id==='calendarScreen'),'incoming tab animation recorded');
  click('[data-tab="puzzle"]');
  assert.equal(d.querySelectorAll('.screen.kanri-exiting').length,1,'rapid tap clears stale outgoing screens');
  click('[data-tab="calendar"]');
  motions.slice().forEach(m=>m.finish());
  assert.equal(d.querySelectorAll('.screen.kanri-exiting').length,0,'exit screens cleaned on completion');

  click('#calModes [data-mode="month"]');
  assert.ok(d.querySelector('.month-grid'),'month view rendered');
  const grid=d.querySelector('.month-grid');
  const first=dayValue();
  const other=Array.from(grid.querySelectorAll('.day')).find(el=>
    el.dataset.caldate!==first&&el.dataset.caldate.slice(0,7)===first.slice(0,7));
  assert.ok(other,'a second day in current month exists');
  const initialCount=motions.length;
  other.click();
  assert.equal(dayValue(),other.dataset.caldate,'selected day changes');
  assert.equal(d.querySelector('.month-grid'),grid,'same-month selection preserves entire month grid DOM');
  assert.ok(d.querySelector('.agenda-head strong').textContent.includes(Number(other.dataset.caldate.slice(-2))),'agenda updated for new day');
  assert.ok(motions.length>initialCount,'agenda transition animated');
  assert.equal(d.querySelectorAll('.kanri-agenda-previous').length,1,'old agenda preserved while sliding');
  click('#nextDate');
  assert.notEqual(d.querySelector('.month-grid'),grid,'new month renders new day grid');
  assert.ok(d.querySelector('.kanri-day-previous'),'previous month retains outgoing visual layer');
  click('#prevDate');
  assert.equal(d.querySelectorAll('.kanri-day-previous').length,1,'rapid month navigation does not stack previous layers');
  motions.slice().forEach(m=>m.finish());
  assert.equal(d.querySelectorAll('.kanri-day-previous').length,0,'all outgoing layers removed');

  click('#calModes [data-mode="week"]');
  const week=d.querySelector('.week-cards');
  const chosen=week.querySelector('.week-day.active');
  const another=Array.from(week.querySelectorAll('.week-day')).find(el=>el!==chosen);
  another.click();
  assert.equal(d.querySelector('.week-cards'),week,'same-week selection preserves week cards');
  assert.ok(another.classList.contains('active'),'week selection updated');

  click('[data-tab="puzzle"]');
  const original=d.querySelector('.puzzle-day strong').textContent;
  click('#puznext');
  assert.notEqual(d.querySelector('.puzzle-day strong').textContent,original,'puzzle day advanced');
  assert.ok(d.querySelector('#puzzleContent .kanri-day-previous'),'puzzle day has outgoing layer');
  click('#puzprev');
  assert.equal(d.querySelectorAll('#puzzleContent .kanri-day-previous').length,1,'fast puzzle day changes clean overlays');
  motions.slice().forEach(m=>m.finish());
  assert.equal(d.querySelectorAll('.kanri-day-previous').length,0,'puzzle transitions cleaned');

  reduced=true;
  const motionCount=motions.length;
  click('[data-tab="settings"]');
  assert.equal(d.querySelectorAll('.screen.kanri-exiting').length,0,'reduced-motion mode has no outgoing screen');
  assert.equal(motions.length,motionCount,'reduced motion does not animate');
  console.log('PASS tab transitions, rapid taps, month/week agenda reuse, puzzle day, cleanup and reduced motion');
}finally{dom.window.close()}
