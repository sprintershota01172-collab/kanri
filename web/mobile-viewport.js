/* The same viewport strategy as tabi/mobile-input.js, adapted for kanri. */
(() => {
  'use strict';
  const root=document.documentElement;
  const viewport=window.visualViewport;
  const coarse=window.matchMedia?.('(pointer: coarse)').matches??true;
  const editable=el=>el?.matches?.('textarea,input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([readonly]),select');
  let layoutHeight=window.innerHeight,layoutWidth=window.innerWidth;
  let lastHeight=-1,lastTop=-1,lastEditing=false;
  function refresh(){
    if(!coarse)return;
    const editing=!!editable(document.activeElement);
    const visualHeight=Math.max(1,Math.round(viewport?.height||window.innerHeight));
    const visualTop=Math.max(0,Math.round(viewport?.offsetTop||0));
    if(Math.abs(window.innerWidth-layoutWidth)>80){
      layoutWidth=window.innerWidth;
      layoutHeight=Math.max(window.innerHeight,visualHeight);
      lastHeight=-1;
    }else if(!editing&&visualHeight>=layoutHeight-80){
      layoutHeight=Math.max(window.innerHeight,visualHeight);
    }
    const available=Math.max(160,Math.min(layoutHeight,visualHeight));
    if(lastHeight<0||Math.abs(available-lastHeight)>18||lastEditing!==editing){
      root.style.setProperty('--sheet-visual-height',available+'px');
      lastHeight=available;
    }
    if(lastTop<0||Math.abs(visualTop-lastTop)>3||(!editing&&lastEditing)){
      root.style.setProperty('--sheet-visual-top',visualTop+'px');
      lastTop=visualTop;
    }
    // iOS home-screen PWAs sometimes leave a visually unused strip below the
    // webview. Advance toward it cautiously: at most 24 CSS px per release,
    // never consume the roughly 34px reserved for the system home indicator.
    // This is intentionally disabled for normal Safari and while editing.
    const installed=window.navigator?.standalone===true||window.matchMedia?.('(display-mode: standalone)').matches===true;
    const physical=Number(window.screen?.height)||0;
    const gap=physical-layoutHeight;
    const canExtend=installed&&!editing&&window.innerHeight>=window.innerWidth&&gap>=54&&gap<=160;
    const bottomStep=canExtend?Math.min(24,Math.max(0,gap-34)):0;
    root.style.setProperty('--kanri-bottom-step',bottomStep+'px');
    // Keep a constant viewport through keyboard opening (same strategy as tabi).
    root.style.setProperty('--vh',(layoutHeight+bottomStep)+'px');
    root.classList.toggle('editing-input',editing);
    lastEditing=editing;
  }
  document.addEventListener('focusin',refresh);
  document.addEventListener('focusout',()=>requestAnimationFrame(refresh));
  viewport?.addEventListener('resize',refresh,{passive:true});
  viewport?.addEventListener('scroll',refresh,{passive:true});
  window.addEventListener('resize',refresh);
  window.addEventListener('orientationchange',()=>{
    layoutWidth=-1;
    requestAnimationFrame(refresh);
  });
  window.KanriViewport={refresh};
  refresh();
})();
