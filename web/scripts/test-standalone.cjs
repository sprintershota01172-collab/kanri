'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {runInNewContext}=require('node:vm');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const css=html.slice(html.indexOf('<style>')+7,html.indexOf('</style>'));
const mobile=fs.readFileSync(path.join(__dirname,'..','mobile-viewport.js'),'utf8');
const v9=css.slice(css.indexOf('/* v1.9.6 — iPhone layout'));
assert.ok(v9.length>1800,'expected latest compact CSS shell rules');
assert.ok(v9.includes('height:var(--vh,100svh)!important'),'shell height comes from measured viewport');
assert.ok(v9.includes('flex:1 1 0%!important'),'content expands between header and navigation');
assert.ok(v9.includes('flex:0 0 calc(54px + var(--safe-bottom,env(safe-area-inset-bottom,0px)))!important'),'nav reserves home-indicator safe area');
assert.ok(v9.includes('padding:4px max(12px,env(safe-area-inset-left,0px)) calc(4px + var(--safe-bottom,env(safe-area-inset-bottom,0px)))!important'),'safe-area padding is additional to menu content');
assert.ok(v9.includes('min-height:44px!important'),'nav stays tappable');
assert.ok(v9.includes('background:#0D1626!important'),'iPhone exterior and menu have matching navy color');
assert.ok(html.includes('<script src="./mobile-viewport.js"></script>'),'viewport script loads ahead of app');
const corrected=css.slice(css.indexOf('/* v1.9.7 — iOS standalone height correction'));
assert.ok(corrected.length>200,'iOS full-height override exists');
assert.ok(corrected.includes('height:100vh!important'),'standalone screen grows to full viewport');
assert.ok(corrected.includes('max-height:100vh!important'),'standalone viewport has a bounded height');
assert.ok(corrected.includes('.device{'),'override targets actual kanri app container');
assert.ok(corrected.includes('.nav{')&&corrected.includes('flex-shrink:0!important'),'nav stays fully visible when screen expands');
assert.ok(!html.includes('function syncStandAloneHeight'),'no legacy viewport heights');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.webmanifest'),'utf8'));
assert.equal(manifest.display,'standalone');
assert.equal(manifest.background_color,'#F4F5F6');
assert.equal(manifest.theme_color,'#F4F5F6');
assert.ok(html.includes('name="apple-mobile-web-app-status-bar-style" content="default"'),'iOS status bar should use light default mode');
assert.ok(html.includes('name="theme-color" content="#F4F5F6"'),'HTML theme must match light header');
assert.ok(html.includes('v1.9.8: Match tabi'), 'light iPhone status area styling exists');
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
console.log('PASS: tabi-measured viewport, keyboard freeze, native safe area, all nav tabs');
