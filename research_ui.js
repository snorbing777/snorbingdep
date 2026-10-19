(function(){
  'use strict';
  const $=id=>document.getElementById(id),reports=new Map(),latest=[],queue=[];
  let running=false,selected=null;
  const element=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
  const dollars=n=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:5}):'Unknown';
  function badge(mint,report){
    const card=document.querySelector(`.token[data-mint="${mint}"] .unreviewed`);
    if(card){card.textContent=report?.status==='screen_passed'?'● SCREEN PASSED · RETURNS UNKNOWN':report?.status==='screen_blocked'?'● BLOCKED BY SCREENING':report?'● INSUFFICIENT DATA':'● RESEARCH QUEUED';card.classList.toggle('lime',report?.eligible===true);}
  }
  async function load(token){
    const old=reports.get(token.mint);if(old&&Date.now()/1000-old.observed_at<30)return old;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
    try{const response=await fetch('/api/analysis?mint='+encodeURIComponent(token.mint),{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('provider');const data=await response.json();reports.set(token.mint,data);while(reports.size>1000)reports.delete(reports.keys().next().value);badge(token.mint,data);window.DeskAlerts?.analysis(token,data);return data;}
    finally{clearTimeout(timer);}
  }
  async function run(){
    if(running||!$('auto-research').checked||!queue.length)return;running=true;const token=queue.shift();
    try{const report=await load(token);$('research-state').textContent='Latest screening: '+token.symbol+' · '+report.status.replaceAll('_',' ');if(selected?.mint===token.mint)render(report);}
    catch(_){$('research-state').textContent='Research provider unavailable. No screening approval; retry from a coin card.';}
    finally{running=false;if(queue.length)setTimeout(run,2000);}
  }
  function observe(token){latest.unshift(token);latest.length=Math.min(10,latest.length);if(!queue.some(t=>t.mint===token.mint)){queue.push(token);while(queue.length>10)queue.shift();}setTimeout(()=>badge(token.mint,reports.get(token.mint)),300);run();}
  function render(data){
    const body=$('research-body');body.replaceChildren();
    body.append(element('div',data.status.replaceAll('_',' ').toUpperCase(),'research-verdict'),element('p',data.reason||'Market activity score: '+data.score+'. This score is not the probability of a profitable trade.'));
    body.append(element('small','Observed '+new Date(data.observed_at*1000).toLocaleString()+'. Screening is a snapshot; conditions can change.'));
    const grid=element('div','','research-grid');for(const [key,value] of Object.entries(data.metrics||{})){const box=element('div','','research-stat');box.append(element('small',key.replaceAll('_',' ')),element('strong',key.endsWith('usd')?dollars(value):typeof value==='number'?value.toLocaleString(undefined,{maximumFractionDigits:2}):value??'Unknown'));grid.append(box);}body.append(grid);
    body.append(element('h3','Why this coin passes or is blocked'));
    for(const [key,passed] of Object.entries(data.checks||{}))body.append(element('div',(passed?'✓ PASS · ':'✕ BLOCKED · ')+key.replaceAll('_',' '),passed?'check-pass':'check-block'));
    const n=data.narrative||{};body.append(element('h3','Narrative and virality'),element('p',(n.narrative||'No measured narrative')+' · '+(n.reason||'No evidence')));
    const measurements=[['Mentions / 5m',n.mentions_5m],['Previous 5m',n.previous_mentions_5m],['Unique authors',n.unique_authors_5m],['Engagements',n.engagements_5m]];
    for(const [label,value] of measurements)body.append(element('div',label+': '+(value??'Unknown'),'research-measure'));
    body.append(element('p','Narrative gate: ≥30 mentions, ≥20 authors, ≥100 engagements and ≥2.5× growth; complete sample no older than 5 minutes. Missing or stale evidence blocks entries.'));
    const limits=data.thresholds||{};body.append(element('p',`Market gate: age ≥${limits.min_age_minutes??'—'} minutes and ≤${limits.max_age_hours??'—'} hours, liquidity ≥${dollars(limits.min_liquidity)}, 5m volume ≥${dollars(limits.min_volume_5m)}, buys ≥${limits.min_buys_5m??'—'}, buy/sell ratio ≥${limits.min_buy_sell_ratio??'—'}.`));
    body.append(element('h3','What would 100× imply?'),element('p',data.scenario_100x_cap_usd?'At constant supply, a 100× price would imply approximately '+dollars(data.scenario_100x_cap_usd)+' market cap. This is arithmetic, not a forecast, price target or exit-liquidity estimate.':'No reliable current market cap. A 100× scenario cannot be calculated.'));
    body.append(element('h3','Still unknown'));for(const unknown of data.unknowns||[])body.append(element('p','• '+unknown));
    for(const source of [...(data.sources||[]),...(n.sources||[])]){const safe=MarketExtras.imageURL(source);if(safe){const link=element('a','Source ↗','button small');link.href=safe;link.target='_blank';link.rel='noopener noreferrer';body.append(link);}}
  }
  async function open(token){selected=token;$('research-title').textContent='Runner research · '+token.symbol;$('research-mint').textContent=token.mint;$('research-body').replaceChildren(element('p','Loading market and narrative measurements…'));if(!$('research-dialog').open)$('research-dialog').showModal();try{const report=await load(token);if(selected?.mint===token.mint)render(report);}catch(_){if(selected?.mint===token.mint)$('research-body').replaceChildren(element('p','Research unavailable. Check the app server and provider connection. This coin has not passed screening.'));}}
  $('close-research').onclick=()=>$('research-dialog').close();$('refresh-research').onclick=()=>{if(selected){reports.delete(selected.mint);open(selected);}};
  $('auto-research').onchange=()=>run();setInterval(()=>{for(const t of latest)if(!queue.some(x=>x.mint===t.mint))queue.push(t);run();},60000);
  window.RunnerResearch={open,observe};
})();
