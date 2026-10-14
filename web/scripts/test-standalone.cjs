'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {runInNewContext}=require('node:vm');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const css=html.slice(html.indexOf('<style>')+7,html.indexOf('</style>'));
const mobile=fs.readFileSync(path.join(__dirname,'..','mobile-viewport.js'),'utf8');
const layout=css.slice(css.indexOf('/* v2.0 — tabi-aligned'));
assert.ok(layout.length>1600,'Latest tidy iPhone shell should exist');
assert.ok(layout.includes('height:var(--vh,100svh)!important'),'The mobile shell follows tabi measured height');
assert.ok(layout.includes('flex:1 1 0%!important'),'Main work area receives remaining height');
assert.ok(layout.includes('flex:0 0 calc(64px + var(--safe-bottom))!important'),'Navigation reserves both buttons and safe-area');
assert.ok(layout.includes('padding:3px max(12px,env(safe-area-inset-left,0px)) calc(4px + var(--safe-bottom))!important'),'Home-indicator inset is inside navigation');
assert.ok(layout.includes('min-height:44px!important'),'Navigation buttons stay touchable');
assert.ok(layout.includes('background:#FFFFFF!important'),'Tabi-inspired white navigation matches iPhone lower system area');
assert.ok(layout.includes('.nav-btn.active{color:#17243B!important}'),'Active tab remains visible on white');
assert.ok(layout.includes('border-radius:0!important'),'No dark round strip clipping the navigation');
assert.ok(!layout.includes('height:100vh!important'),'Do not reintroduce dangerous standalone 100vh override');
assert.ok(!css.includes('/* v1.9.7 — iOS standalone height correction'),'Remove the old conflicting fullscreen hack');
assert.ok(!css.includes('/* v1.9.8: Match tabi'),'Remove old conflicting dark-to-light background gradient');
assert.ok(html.includes('<script src="./mobile-viewport.js"></script>'),'Tabi-style viewport script remains loaded');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.webmanifest'),'utf8'));
assert.equal(manifest.display,'standalone');
assert.equal(manifest.background_color,'#F4F5F6');
assert.equal(manifest.theme_color,'#F4F5F6');
assert.ok(html.includes('name="apple-mobile-web-app-status-bar-style" content="default"'),'Light status bar remains supported');
function viewportTest(){
 const vars=new Map(),classes=new Set(),documentEvents={},viewportEvents={},windowEvents={};
 const viewport={height:844,offsetTop:0,addEventListener(type,fn){viewportEvents[type]=fn}};
 const document={
  documentElement:{style:{setProperty(key,val){vars.set(key,val)}},classList:{toggle(key,state){state?classes.add(key):classes.delete(key)}}},
  activeElement:null,addEventListener(type,fn){documentEvents[type]=fn}
 };
 const window={innerHeight:844,innerWidth:390,visualViewport:viewport,addEventListener(type,fn){windowEvents[type]=fn}};
 runInNewContext(mobile,{window,document,requestAnimationFrame:fn=>fn(),matchMedia:()=>({matches:true})},{timeout:1200});
 assert.equal(vars.get('--vh'),'844px');
 assert.equal(vars.get('--sheet-visual-height'),'844px');
 document.activeElement={matches:()=>true};documentEvents.focusin();
 viewport.height=490;viewportEvents.resize();
 assert.equal(vars.get('--vh'),'844px','keyboard never moves fixed app shell');
 assert.equal(vars.get('--sheet-visual-height'),'490px','input sheet follows visible keyboard viewport');
 viewport.height=487;viewportEvents.resize();
 assert.equal(vars.get('--sheet-visual-height'),'490px','small predictive keyboard movements filtered');
 viewport.offsetTop=31;viewportEvents.scroll();
 assert.equal(vars.get('--sheet-visual-top'),'31px','iOS viewport offset tracked');
 document.activeElement=null;viewport.height=844;viewport.offsetTop=0;documentEvents.focusout();
 assert.equal(vars.get('--vh'),'844px');
 assert.equal(vars.get('--sheet-visual-top'),'0px');
 window.innerWidth=844;window.innerHeight=390;viewport.height=390;
 windowEvents.orientationchange();
 assert.equal(vars.get('--vh'),'390px','rotation recalculates app height');
}
viewportTest();
function incrementalFooterTest({installed,physical,layout}){
 const vars=new Map(),documentEvents={},viewportEvents={};
 const viewport={height:layout,offsetTop:0,addEventListener(type,fn){viewportEvents[type]=fn}};
 const document={
   documentElement:{style:{setProperty(key,val){vars.set(key,val)}},classList:{toggle(){}}},
   activeElement:null,addEventListener(type,fn){documentEvents[type]=fn}
 };
 const window={
   innerHeight:layout,innerWidth:393,screen:{height:physical},
   navigator:{standalone:installed},visualViewport:viewport,
   matchMedia:q=>({matches:installed&&q.includes('display-mode: standalone')||q.includes('pointer: coarse')}),
   addEventListener(){}
 };
 runInNewContext(mobile,{window,document,requestAnimationFrame:fn=>fn()},{timeout:1200});
 const expected=installed&&physical-layout>=54&&physical-layout<=160?Math.min(24,physical-layout-34):0;
 assert.equal(vars.get('--kanri-bottom-step'),expected+'px','incremental adjustment constrained to installed PWA');
 assert.equal(vars.get('--vh'),(layout+expected)+'px','shell height includes only guarded step');
 document.activeElement={matches:()=>true};documentEvents.focusin();
 viewport.height=layout-280;viewportEvents.resize();
 assert.equal(vars.get('--vh'),(layout+expected)+'px','keyboard does not move expanded shell');
 assert.equal(vars.get('--sheet-visual-height'),(layout-280)+'px','sheet adapts to keyboard');
}
incrementalFooterTest({installed:true,physical:874,layout:804});
incrementalFooterTest({installed:true,physical:932,layout:812});
incrementalFooterTest({installed:false,physical:874,layout:804});
incrementalFooterTest({installed:true,physical:874,layout:830});
incrementalFooterTest({installed:true,physical:1100,layout:812});
for(const [width,height] of [[375,812],[393,852],[402,874],[430,932]]){
 const dom=new JSDOM(html,{url:'https://kanri.example.test/',pretendToBeVisual:true,runScripts:'dangerously',beforeParse(win){
  Object.defineProperty(win,'innerWidth',{configurable:true,value:width});
  Object.defineProperty(win,'innerHeight',{configurable:true,value:height});
  win.matchMedia=q=>({matches:q.includes('display-mode: standalone')||q.includes('pointer: coarse'),addListener(){},removeListener(){}});
 }});
 const d=dom.window.document;
 assert.equal(d.querySelectorAll('.nav .nav-btn').length,5,'all nav tabs exist');
 d.querySelector('.nav-btn[data-tab="calendar"]').click();
 assert.ok(d.querySelector('#calendarScreen').classList.contains('active'),'PLAN tap works');
 d.querySelector('.nav-btn[data-tab="settings"]').click();
 assert.ok(d.querySelector('#settingsScreen').classList.contains('active'),'SETUP tap works');
 dom.window.close();
}
console.log('PASS: tabi-aligned mobile shell, fully visible tabs, input freeze, and iOS safe area');
