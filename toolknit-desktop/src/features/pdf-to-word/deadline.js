// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
/** Bounded conversion CPU budget; interactive dependency setup pauses the clock. */
export function createConversionDeadline({ baseMs, onTimeout, clock = () => performance.now(), schedule = setTimeout, cancel = clearTimeout }) {
  let remaining=baseMs,extra=0,started=clock(),timer=null,pauses=0,disposed=false;
  const stop=()=>{if(timer!==null){cancel(timer);timer=null;remaining=Math.max(0,remaining-(clock()-started));}};
  const arm=()=>{if(disposed||pauses||timer!==null)return;started=clock();timer=schedule(()=>{timer=null;if(!disposed){disposed=true;onTimeout();}},Math.max(1,remaining));};
  arm();
  return {
    addOcrPage() { if(disposed)return;stop();const next=Math.min(50*60*1000,extra+45*1000);remaining+=next-extra;extra=next;arm(); },
    pause() { if(disposed)return()=>{};stop();pauses++;let released=false;return()=>{if(released)return;released=true;pauses--;arm();}; },
    dispose() { if(disposed)return;stop();disposed=true; }
  };
}
