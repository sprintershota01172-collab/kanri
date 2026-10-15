/* The same viewport strategy as tabi/mobile-input.js, adapted for kanri. */
(() => {
  'use strict';
  const root=document.documentElement;
  const viewport=window.visualViewport;
  const coarse=window.matchMedia?.('(pointer: coarse)').matches??true;
  const editable=el=>el?.matches?.('textarea,input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([readonly]),select');
  let layoutHeight=window.innerHeight,layoutWidth=window.innerWidth;
  let lastHeight=-1,lastTop=-1,lastEditing=false,lastBottomStep=0;
  // This testable read uses computed pixels, not an unresolved env() string.
  window.KanriStatusTopInset=()=>{
    if(!document.body?.appendChild)return 0;
    const probe=document.createElement('div');
    probe.style.cssText='position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    const measured=probe.getBoundingClientRect().height;
    probe.remove();
    return measured;
  };
  function refresh(){
    if(!coarse)return;
    const editing=!!editable(document.activeElement);
    const editorOpen=!!document.querySelector('#modal.open .sheet.editor-sheet');
    const visualHeight=Math.max(1,Math.round(viewport?.height||window.innerHeight));
    const visualTop=Math.max(0,Math.round(viewport?.offsetTop||0));
    // iOS may scroll the visual viewport inside a fixed layout viewport when
    // focusing a numerical input. Anchor the editor to the *visible* part.
    // The surrounding application still retains its measured fixed height.
    const maxSheetArea=Math.max(160,layoutHeight+lastBottomStep);
    const editorTop=Math.max(6,Math.min(maxSheetArea-166,visualTop+6));
    const editorVisibleHeight=Math.min(
      Math.max(160,visualHeight-12),
      Math.max(160,maxSheetArea-editorTop-7)
    );
    root.style.setProperty('--kanri-editor-top',editorTop+'px');
    root.style.setProperty('--kanri-editor-fit-height',editorVisibleHeight+'px');
    root.classList.toggle('kanri-keyboard-open',editorOpen&&editing&&visualHeight<layoutHeight-90);
    if(Math.abs(window.innerWidth-layoutWidth)>80){
      layoutWidth=window.innerWidth;
      layoutHeight=Math.max(window.innerHeight,visualHeight);
      lastHeight=-1;
    }
    // Keep the non-keyboard app shell at its initial height. iOS may change
    // visualViewport.height when a button is tapped or browser chrome animates;
    // treating this as a new app height causes the entire UI to jump upwards.
    // Genuine rotation is handled by the width-change branch above.
    const available=editing?Math.max(160,Math.min(layoutHeight,visualHeight)):layoutHeight;
    if(lastHeight<0||Math.abs(available-lastHeight)>18||lastEditing!==editing){
      root.style.setProperty('--sheet-visual-height',available+'px');
      lastHeight=available;
    }
    if(lastTop<0||Math.abs(visualTop-lastTop)>3||(!editing&&lastEditing)){
      root.style.setProperty('--sheet-visual-top',visualTop+'px');
      lastTop=visualTop;
    }
    // "default" iOS standalone status bars place the WebKit origin BELOW
    // the system status area. screen.height includes that area; innerHeight
    // can additionally omit part of the usable bottom surface. Therefore,
    // screen.height must never be used directly as the shell height.
    // Derive the bottom from the physical CSS screen minus the TOP status bar,
    // while the navigation itself reserves the bottom safe-area inset.
    // The measured position is frozen while the keyboard is open.
    if(!editing){
      const installed=window.navigator?.standalone===true||
        window.matchMedia?.('(display-mode: standalone)').matches===true;
      const portrait=window.innerHeight>=window.innerWidth;
      const physical=Number(window.screen?.height)||0;
      const screenWidth=Number(window.screen?.width)||0;
      const plausible=installed&&portrait&&
        physical>layoutHeight&&physical-layoutHeight<=240&&
        (!screenWidth||Math.abs(screenWidth-window.innerWidth)<36);
      if(plausible){
        // Read the actual CSS inset when available. Some iOS PWA versions
        // expose zero for default (non-translucent) status bars, hence the
        // 50px fallback. Bound to the usual iPhone status-area range.
        const safeTop=Number(window.KanriStatusTopInset?.())||0;
        const topStatus=Math.max(44,Math.min(62,safeTop||50));
        const usable=Math.max(layoutHeight,physical-topStatus);
        const conservativeStep=physical-layoutHeight>=54&&physical-layoutHeight<=160?
          Math.min(48,Math.max(0,physical-layoutHeight-34)):0;
        const baseStep=Math.max(conservativeStep,Math.max(0,Math.min(180,Math.round(usable-layoutHeight))));
        // Fine-tune the position by up to 24px, while keeping at least 22px
        // of the physical screen below the web shell for the home indicator.
        const extra=Math.min(24,Math.max(0,physical-layoutHeight-baseStep-22));
        lastBottomStep=baseStep+extra;
      }else lastBottomStep=0;
    }
    root.style.setProperty('--kanri-bottom-step',lastBottomStep+'px');
    root.style.setProperty('--vh',(layoutHeight+lastBottomStep)+'px');
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
