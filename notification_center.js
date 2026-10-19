(function(root){
  'use strict';
  class Events{
    constructor({onEvent=()=>{},now=()=>Date.now()/1000,storage=null}={}){
      Object.assign(this,{onEvent,now,storage});this.seen=new Set();this.history=[];this.runners=new Map();
      try{const saved=JSON.parse(storage?.getItem('signal-desk-alerts')||'{}');this.seen=new Set((saved.seen||[]).filter(x=>typeof x==='string').slice(-5000));this.history=(saved.history||[]).filter(e=>e&&typeof e.id==='string'&&typeof e.title==='string').slice(-500);}catch(_){}
    }
    save(){try{this.storage?.setItem('signal-desk-alerts',JSON.stringify({seen:[...this.seen].slice(-5000),history:this.history}));}catch(_){} }
    emit(event){if(!event?.id||this.seen.has(event.id))return false;this.seen.add(event.id);while(this.seen.size>5000)this.seen.delete(this.seen.values().next().value);this.history.push(event);this.history=this.history.slice(-500);this.save();this.onEvent(event);return true;}
    fresh(time){return Number.isFinite(time)&&this.now()-time>=-5&&this.now()-time<=120;}
    analysis(token,data,source='research'){
      const time=data.observed_at??data.time;if(!this.fresh(time))return;
      const mint=token.mint||token.token_address||token.address;if(!mint)return;
      const symbol=token.symbol||mint.slice(0,8),checks=data.checks||{},failed=Object.entries(checks).filter(([,v])=>v!==true).map(([key])=>key.replaceAll('_',' '));
      const approved=data.eligible===true,reason=data.narrative_reason||data.narrative?.reason||data.reason||'';
      this.emit({id:`${source}:analysis:${mint}:${time}`,type:'analysis',kind:'analysis',time,mint,symbol,source,title:`ANALYSIS COMPLETE · ${symbol}`,
        detail:`${source} · ${approved?'Screen passed':'No entry approved'}${failed.length?' · Blocked: '+failed.join(', '):''}${reason?' · '+reason:''}`});
      const required=['chain_enabled','pump_filter','price','age','liquidity','volume','buys','buy_pressure','momentum','narrative_evidence'];
      const runner=approved&&required.every(key=>checks[key]===true)&&Object.values(checks).every(v=>v===true);
      const key=source+':'+mint,previous=this.runners.get(key);this.runners.set(key,runner);while(this.runners.size>2000)this.runners.delete(this.runners.keys().next().value);
      if(runner&&!previous)this.emit({id:`${source}:runner:${mint}:${time}`,type:'runner',kind:'watch',time,mint,symbol,source,title:`POTENTIAL RUNNER · ${symbol}`,
        detail:`${source} · Market and fresh narrative screening passed. Score ${data.score??'unknown'} measures activity, not return probability. No order placed and no 100× prediction.`});
    }
    report(data){
      if(!data||!this.fresh(data.time)||!['paper','live-pump','live-solana'].includes(data.mode))return;
      const source=data.mode==='paper'?'paper':'live';
      if(!data.error)for(const token of data.candidates||[])this.analysis(token,{...token,time:data.time},source);
      for(const alert of data.alerts||[]){if(!this.fresh(alert.time)||!['entry','exit','warning'].includes(alert.kind))continue;
        this.emit({...alert,id:source+':'+alert.id,type:['entry','exit'].includes(alert.kind)?'trade':'warning',source});}
    }
  }
  if(typeof module!=='undefined'&&module.exports){module.exports={Events};return;}
  const $=id=>document.getElementById(id),make=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
  let preferences={analysis:true,runner:true,trade:true},imageFor=()=>null;
  try{preferences={...preferences,...JSON.parse(localStorage.getItem('signal-desk-alert-preferences')||'{}')};}catch(_){}
  function safeImage(value){return typeof value==='string'&&value.startsWith('/api/token-image?url=')?value:MarketExtras.imageURL(value);}
  function attachImage(card,event){
    if(!event.mint)return;card.dataset.mint=event.mint;
    const url=safeImage(imageFor(event.mint));if(!url||card.querySelector('img'))return;
    const img=document.createElement('img');img.src=url;img.alt=(event.symbol||'Token')+' artwork';img.referrerPolicy='no-referrer';img.className='alert-image';img.onerror=()=>img.remove();card.prepend(img);
  }
  function card(event){const n=make('article','',`mini-alert ${['analysis','watch','entry','exit','warning','whale'].includes(event.kind)?event.kind:'watch'}`);n.dataset.eventId=event.id;const old=event.type==='runner'&&Date.now()/1000-event.time>120;n.append(make('strong',old?'PAST SCREENING MATCH · '+(event.symbol||event.mint):event.title),make('p',(old?'Snapshot is over two minutes old; refresh research. ':'')+(event.detail||'')),make('time',new Date(event.time*1000).toLocaleString()));attachImage(n,event);return n;}
  const queue=[];let visible=0;
  function pump(){const limit=root.matchMedia?.('(max-width:680px)').matches?2:5;while(visible<limit&&queue.length){const event=queue.shift(),n=card(event),close=make('button','×','close');let closed=false;visible++;
    function dismiss(){if(closed)return;closed=true;n.remove();visible--;pump();}
    close.setAttribute('aria-label','Dismiss notification');close.onclick=dismiss;n.prepend(close);$('toasts').append(n);setTimeout(dismiss,event.type==='analysis'?5000:10000);
  }$('alert-queue').textContent=queue.length?`${queue.length} pop-ups queued · every event is saved below`:'';}
  function deliver(event){
    $('event-history').prepend(card(event));while($('event-history').children.length>100)$('event-history').lastChild.remove();$('event-count').textContent=ledger.history.length+' recorded';
    if(preferences[event.type]===false)return;
    if(queue.length>=1000)queue.shift();if(event.type==='trade'||event.type==='runner')queue.unshift(event);else queue.push(event);pump();
    if('Notification'in root&&Notification.permission==='granted'){try{new Notification(event.title,{body:event.detail,tag:event.id,icon:safeImage(imageFor(event.mint))||'/shark.svg'});}catch(_) {$('permission').textContent='Desktop delivery unavailable; on-screen pop-ups and history are active.';}}
  }
  let storage=null;try{storage=localStorage;}catch(_){}
  const ledger=new Events({storage,onEvent:deliver});
  for(const event of ledger.history.slice(-100).reverse())$('event-history').append(card(event));$('event-count').textContent=ledger.history.length+' recorded';
  for(const type of ['analysis','runner','trade']){const box=$('alerts-'+type);box.checked=preferences[type];box.onchange=()=>{preferences[type]=box.checked;try{localStorage.setItem('signal-desk-alert-preferences',JSON.stringify(preferences));}catch(_){}};}
  $('clear-events').onclick=()=>{ledger.history=[];ledger.save();$('event-history').replaceChildren();$('event-count').textContent='0 recorded';};
  root.DeskAlerts={publish:event=>ledger.emit({...event,type:event.type||'general'}),analysis:(token,data,source)=>ledger.analysis(token,data,source),report:data=>ledger.report(data),
    setArtwork:callback=>{imageFor=callback;},refreshArtwork:mint=>{for(const n of document.querySelectorAll('#event-history article,#toasts article'))if(n.dataset.mint===mint){const event=ledger.history.find(e=>e.id===n.dataset.eventId);if(event)attachImage(n,event);}}};
})(typeof window!=='undefined'?window:globalThis);
