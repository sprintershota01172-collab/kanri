const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function open({installed=true,width=402,viewport=813,physical=874}={}){
 const dom=new JSDOM(html,{
  url:'https://kanri.example.test/',pretendToBeVisual:true,runScripts:'dangerously',
  beforeParse(win){
   Object.defineProperty(win,'innerWidth',{configurable:true,value:width,writable:true});
   Object.defineProperty(win,'innerHeight',{configurable:true,value:viewport,writable:true});
   Object.defineProperty(win.screen,'height',{configurable:true,value:physical,writable:true});
   win.matchMedia=q=>({matches:installed&&q.includes('display-mode: standalone'),addListener(){},removeListener(){}});
   Object.defineProperty(win.navigator,'standalone',{configurable:true,value:installed});
  }
 });
 return dom;
}
{
 const dom=open();
 assert.equal(dom.window.document.documentElement.style.getPropertyValue('--kanri-visible-height'),'813px','PWA uses accessible viewport, not physical 874px');
 dom.window.innerHeight=525;
 dom.window.dispatchEvent(new dom.window.Event('resize'));
 assert.equal(dom.window.document.documentElement.style.getPropertyValue('--kanri-visible-height'),'813px','keyboard resize cannot push nav underneath viewport');
 dom.window.close();
}
for(const [width,viewport,physical] of [[375,752,812],[393,792,852],[430,872,932]]){
 const dom=open({width,viewport,physical});
 assert.equal(dom.window.document.documentElement.style.getPropertyValue('--kanri-visible-height'),viewport+'px','visible height for '+width);
 dom.window.close();
}
{
 const dom=open({installed:false});
 assert.equal(dom.window.document.documentElement.style.getPropertyValue('--kanri-visible-height'),'813px','Safari uses the same visible viewport rule');
 dom.window.close();
}
assert.ok(html.includes('v1.9.3 — SAFETY'),'latest navigation CSS override exists');
assert.ok(html.includes('.nav-btn{min-height:48px;position:relative;z-index:101;pointer-events:auto!important}'),'all nav buttons remain interactive');
assert.ok(html.includes('body::after{content:none!important;display:none!important}'),'old overlay no longer covers buttons');
assert.ok(html.includes('height:100dvh!important'),'native CSS dynamic viewport determines app height');
assert.doesNotMatch(html,/const physical=Number\(window\.screen\?\.height\)/,'do not use larger screen.height to position touchable controls');

console.log('PASS: nav constrained to visible iPhone viewport, keyboard freeze, overlay removed');
