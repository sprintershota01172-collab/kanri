const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const css=html.split('<style>')[1].split('</style>')[0];
const shell=css.slice(css.indexOf('/* v1.9.5 — iPhone PWA layout'));
assert.ok(shell.length>1000,'expected shell layout override at end of stylesheet');
assert.ok(shell.includes('position:fixed!important;') && shell.includes('inset:0!important;'),'device fills available webview');
assert.ok(shell.includes('display:flex!important;flex-direction:column!important;'),'three-part flex shell');
assert.ok(shell.includes('flex:1 1 0%!important;'),'content grows to fill space');
assert.ok(shell.includes('position:relative!important;'),'navigation participates in flex layout');
assert.ok(shell.includes('flex:0 0 calc(63px + env(safe-area-inset-bottom,0px))!important;'),'navigation reserves safe-area space');
assert.ok(shell.includes('padding:0 0 env(safe-area-inset-bottom,0px)!important;'),'navigation does not overlap home indicator');
assert.ok(shell.includes('background:#0D1626!important;'),'navigation and outside safe area share navy');
assert.ok(shell.includes('.nav-btn{')&&shell.includes('pointer-events:auto!important;'),'nav buttons remain tappable');
assert.ok(!shell.includes('window.screen.height'),'physical screen height no longer determines app height');
assert.ok(!html.includes('function syncStandAloneHeight'),'remove unstable PWA screen-height script');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.webmanifest'),'utf8'));
assert.equal(manifest.display,'standalone');
assert.equal(manifest.background_color,'#0D1626');
assert.equal(manifest.theme_color,'#0D1626');
function run({standalone,width,height}){
 const dom=new JSDOM(html,{url:'https://kanri.example.test/',pretendToBeVisual:true,runScripts:'dangerously',
  beforeParse(win){
   Object.defineProperty(win,'innerWidth',{configurable:true,value:width});
   Object.defineProperty(win,'innerHeight',{configurable:true,value:height});
   Object.defineProperty(win.navigator,'standalone',{configurable:true,value:standalone});
   win.matchMedia=q=>({matches:standalone&&q.includes('display-mode: standalone'),addListener(){},removeListener(){}});
  }
 });
 const {document:doc}=dom.window;
 assert.equal(doc.querySelectorAll('.nav .nav-btn').length,5,'all 5 navigation buttons exist');
 const board=doc.querySelector('#boardScreen');
 const plan=doc.querySelector('#calendarScreen');
 assert.ok(board.classList.contains('active'),'initial board active');
 doc.querySelector('.nav-btn[data-tab="calendar"]').click();
 assert.ok(plan.classList.contains('active'),'PLAN tab must remain clickable');
 doc.querySelector('.nav-btn[data-tab="settings"]').click();
 assert.ok(doc.querySelector('#settingsScreen').classList.contains('active'),'SETUP tab clickable');
 dom.window.close();
}
for(const [width,height] of [[375,812],[393,852],[402,874],[430,932]]){
 run({standalone:true,width,height});
 run({standalone:false,width,height});
}
console.log('PASS iPhone PWA shell: 3-row flex, matching safe area, tappable tabs, 4 phone sizes');
