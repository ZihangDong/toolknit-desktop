export function createHistoryMotion({q, tr, scope, reduced, createPageTransition}) {
  const title=q('HistoryTitle'), button=q('HistoryMode'), filters=q('HistoryFilters');
  let currentTitle='', hint='', signature='', transition=null, cardAnimations=[];

  function preview(active) {
    title.dataset.preview=String(active);
    title.setAttribute('aria-label',active?hint:currentTitle);
  }
  function face(text, className) {
    const line=document.createElement('span');line.className=className;line.setAttribute('aria-hidden','true');
    Array.from(text).forEach((character,index)=>{
      const letter=document.createElement('span');letter.textContent=character;
      letter.style.setProperty('--flip-delay',`${Math.min(index,12)*12}ms`);
      line.append(letter);
    });
    return line;
  }
  function syncTitle(mode) {
    currentTitle=tr(mode==='phrases'?'phrases':'recent');
    hint=tr(mode==='phrases'?'historySwitchRecords':'historySwitchPhrases');
    const next=`${currentTitle}\n${hint}`;
    if(next!==signature){
      signature=next;title.replaceChildren(face(currentTitle,'shot-title-current'),face(hint,'shot-title-hint'));preview(false);
    }
    button.title=hint;button.setAttribute('aria-label',hint);button.setAttribute('aria-pressed',String(mode==='phrases'));
  }
  function stopCards() {cardAnimations.forEach(animation=>animation.cancel());cardAnimations=[];}
  function revealList(direction=1) {
    stopCards();if(reduced())return;
    cardAnimations=[...q('HistoryList').children].slice(0,5).map((card,index)=>{
      const animation=card.animate([
        {opacity:0,transform:`translateX(${direction*12}px) translateY(5px) rotate(${direction*.6}deg)`},
        {opacity:1,transform:'translateX(0) translateY(0) rotate(0)'}
      ],{duration:260,delay:index*24,easing:'cubic-bezier(.2,.8,.2,1)',fill:'backwards'});
      animation.finished.then(()=>animation.cancel(),()=>{});return animation;
    });
  }
  function selectFilter(kind) {
    const buttons=[...filters.querySelectorAll('button')];
    const index=buttons.findIndex(item=>item.dataset.historyKind===kind);
    filters.style.setProperty('--history-filter-index',String(Math.max(0,index)));
    buttons.forEach((item,i)=>item.setAttribute('aria-pressed',String(i===index)));
  }
  function changeView(action) {
    preview(false);stopCards();
    transition??=createPageTransition();return transition.run(action);
  }
  function cancel() {preview(false);stopCards();transition?.dispose();transition=null;}
  scope.event(button,'pointerenter',()=>{if(!button.disabled)preview(true);});
  scope.event(button,'pointerleave',()=>preview(false));
  scope.event(button,'focus',()=>{if(button.matches(':focus-visible'))preview(true);});
  scope.event(button,'blur',()=>preview(false));
  scope.use(cancel);
  return {syncTitle,selectFilter,revealList,changeView,cancel};
}
