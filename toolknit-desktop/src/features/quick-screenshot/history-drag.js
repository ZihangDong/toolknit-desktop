export function createHistoryDrag({list,scope,allowed,collection,request,onStart,onChanged,onError}){
  let gesture=null,active=false,frame=0,suppressUntil=0;
  const rows=()=>[...list.querySelectorAll('.shot-history-item')];
  function clearMarker(){list.querySelectorAll('.is-drop-before,.is-drop-after').forEach(row=>row.classList.remove('is-drop-before','is-drop-after'));}
  function markTarget(){
    const target=document.elementFromPoint(gesture.x,gesture.y)?.closest('.shot-history-item');clearMarker();gesture.target=null;
    if(target&&target!==gesture.row&&list.contains(target)){
      gesture.target=target;gesture.after=gesture.y>target.getBoundingClientRect().top+target.clientHeight/2;
      target.classList.add(gesture.after?'is-drop-after':'is-drop-before');
    }
  }
  function finish(){
    cancelAnimationFrame(frame);frame=0;clearMarker();gesture?.row.classList.remove('is-dragging');
    if(gesture&&gesture.row.hasPointerCapture(gesture.pointerId))gesture.row.releasePointerCapture(gesture.pointerId);
    gesture=null;active=false;list.classList.remove('is-sorting');
  }
  function point(){
    if(!gesture?.sorting||!active)return;
    const {x,y}=gesture,box=list.getBoundingClientRect();
    if(x>=box.left&&x<=box.right){
      const speed=y<box.top+36?-10:y>box.bottom-36?10:0;
      if(speed)list.scrollTop+=speed;
    }
    markTarget();
    frame=requestAnimationFrame(point);
  }
  async function reorder(id,targetId,after){
    try{await request({action:'reorder',collection:collection(),id,targetId,after});}
    catch(error){onError(error);}
    finally{finish();await onChanged();}
  }
  scope.event(list,'pointerdown',event=>{
    if(event.button!==0||!allowed()||active)return;
    const row=event.target.closest('.shot-history-item');if(!row)return;
    const sorting=Boolean(event.target.closest('[data-history-reorder]'));
    if(!sorting&&!['text','image','phrase'].includes(row.dataset.kind))return;
    gesture={row,sorting,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,target:null,after:false};
    row.setPointerCapture(event.pointerId);
  });
  scope.event(list,'pointermove',event=>{
    if(!gesture||event.pointerId!==gesture.pointerId)return;
    gesture.x=event.clientX;gesture.y=event.clientY;
    if(active||Math.hypot(gesture.x-gesture.startX,gesture.y-gesture.startY)<7)return;
    active=true;onStart();suppressUntil=Infinity;gesture.row.classList.add('is-dragging');
    if(gesture.sorting){list.classList.add('is-sorting');frame=requestAnimationFrame(point);return;}
    const id=Number(gesture.row.dataset.entryId),kind=collection();
    gesture.row.releasePointerCapture(event.pointerId);
    void request({action:'drag',collection:kind,id}).catch(onError).finally(()=>{suppressUntil=performance.now()+350;finish();void onChanged();});
  });
  scope.event(list,'pointerup',event=>{
    if(!gesture||event.pointerId!==gesture.pointerId)return;
    if(active&&!gesture.sorting)return;
    if(active){gesture.x=event.clientX;gesture.y=event.clientY;markTarget();}
    if(active&&gesture.target){
      const {row,target,after}=gesture;cancelAnimationFrame(frame);frame=0;suppressUntil=performance.now()+350;
      clearMarker();list.insertBefore(row,after?target.nextSibling:target);
      void reorder(Number(row.dataset.entryId),Number(target.dataset.entryId),after);return;
    }
    const changed=active,sorting=gesture.sorting;finish();if(changed||sorting)suppressUntil=performance.now()+350;if(changed)void onChanged();
  });
  scope.event(list,'pointercancel',()=>{if(gesture?.sorting){suppressUntil=performance.now()+350;finish();void onChanged();}else if(!active)finish();});
  scope.event(list,'dragstart',event=>event.preventDefault());
  scope.event(list,'click',event=>{if(performance.now()<suppressUntil||event.target.closest('[data-history-reorder]')){event.preventDefault();event.stopPropagation();}},{capture:true});
  scope.event(list,'keydown',event=>{
    const grip=event.target.closest('[data-history-reorder]');if(!grip||!allowed()||active||!['ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const row=grip.closest('.shot-history-item'),items=rows(),next=items[items.indexOf(row)+(event.key==='ArrowDown'?1:-1)];
    if(next){active=true;onStart();void reorder(Number(row.dataset.entryId),Number(next.dataset.entryId),event.key==='ArrowDown').then(()=>{if(grip.isConnected&&!scope.disposed)grip.focus({preventScroll:true});});}
  });
  scope.event(window,'keydown',event=>{if(event.key==='Escape'&&gesture?.sorting){event.preventDefault();event.stopImmediatePropagation();suppressUntil=performance.now()+350;finish();void onChanged();}},{capture:true});
  scope.use(finish);
  return {get active(){return active;},cancel:finish};
}
