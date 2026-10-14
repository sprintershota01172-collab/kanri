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
 assert.equal(dom.window.document.documentElement.style.getPropertyValue('--kanri-standalone-height'),'874px','installed iPhone should use full physical portrait height');
 // Keyboard height changes must not resize the whole screen.
 dom.window.innerHeight=525;
 dom.window.dispatchEvent(new dom.window.Event('resize'));
 assert.equal(dom.window.document.documentElement.style.getPropertyValue('--kanri-standalone-height'),'874px','keyboard resize must not move screen');
 dom.window.close();
}
for(const [width,viewport,physical] of [[375,752,812],[393,792,852],[430,872,932]]){
 const dom=open({width,viewport,physical});
 assert.equal(dom.window.document.documentElement.style.getPropertyValue('--kanri-standalone-height'),physical+'px','full viewport on iPhone '+width);
 dom.window.close();
}
{
 const dom=open({installed:false});
 assert.equal(dom.window.document.documentElement.style.getPropertyValue('--kanri-standalone-height'),'','ordinary Safari keeps native viewport rules');
 dom.window.close();
}
{
 const dom=open({installed:true,viewport:750,physical:960});
 assert.equal(dom.window.document.documentElement.style.getPropertyValue('--kanri-standalone-height'),'750px','reject implausible physical screen mismatch');
 dom.window.close();
}
{
 const dom=open({installed:true,width:850,viewport:402,physical:874});
 assert.equal(dom.window.document.documentElement.style.getPropertyValue('--kanri-standalone-height'),'','landscape ignores portrait lock');
 dom.window.close();
}
assert.ok(html.includes('height:var(--kanri-standalone-height,100lvh)!important'),'app and document must share authoritative height');
assert.ok(html.includes('bottom:0!important'),'nav remains bottom-anchored');
assert.ok(html.includes('padding-bottom:calc(58px + env(safe-area-inset-bottom,0px))!important'),'safe-area nav height reserved');
console.log('PASS: iPhone PWA full height (874 vs 813), keyboard freeze, Safari fallback, landscape fallback');
