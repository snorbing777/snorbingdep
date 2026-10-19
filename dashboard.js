'use strict';
const $ = id => document.getElementById(id);
const money = n => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString(undefined, {style:'currency',currency:'USD',maximumFractionDigits:2}) : '—';
const compact = n => n === null ? '—' : n.toLocaleString(undefined, {maximumFractionDigits:2,notation:n>=10000?'compact':'standard'});
function node(tag, text, cls) { const n=document.createElement(tag); n.textContent=text; if(cls)n.className=cls; return n; }
function age(time) { const seconds=Math.max(0,Math.floor((Date.now()-time)/1000));return seconds<60?`${seconds}s ago`:seconds<3600?`${Math.floor(seconds/60)}m ago`:`${Math.floor(seconds/3600)}h ago`; }
let notificationsEnabled=false, renderTimer=null, pageSize=60;
const store = new PumpLaunchFeed.Store();
let streamState='connecting', lastEvent=0;
const cards=new Map();
const artwork=new MarketExtras.Artwork({onChange:mint=>{
  if(mint&&cards.has(mint))renderArtwork(cards.get(mint),store.items.find(t=>t.mint===mint));
  else for(const token of store.items)if(cards.has(token.mint))renderArtwork(cards.get(token.mint),token);
  if(mint)window.DeskAlerts?.refreshArtwork(mint);
}});
window.DeskAlerts?.setArtwork(mint=>artwork.get(store.items.find(t=>t.mint===mint)||{mint}));
const sounds=new MarketExtras.Sounds(), whales=new MarketExtras.WhaleTracker();
let imageMint=null;
$('close-image').onclick=()=>$('image-dialog').close();
$('copy-image-details').onclick=async()=>{try{await navigator.clipboard.writeText($('art-mint').textContent+'\n'+$('art-details').textContent);$('copy-image-details').textContent='Diagnostics copied';}catch(_){$('copy-image-details').textContent='Select the diagnostic text and copy it';}};
$('retry-one-image').onclick=()=>{if(imageMint){artwork.retry(imageMint);showImageDetails(imageMint);}};
function showImageDetails(mint,inspect=false){imageMint=mint;$('art-mint').textContent=mint;const d=artwork.diagnostics(mint);
  $('art-details').textContent=`${d.status}\nImage URL in launch event: ${d.stream_image_present?'yes':'no'}\nMetadata URI in launch event: ${d.stream_uri_present?'yes':'no'}\n`+(d.attempts||[]).map(a=>a.stage+': '+a.status).join('\n')+(d.proxy_failure?'\nImage proxy: '+d.proxy_failure:'')+'\n\nTLS error: run the matching Python Install Certificates.command on macOS. HTTP 429: provider rate limit. Missing metadata: the creator may not have published accessible artwork.';
  if(!$('image-dialog').open)$('image-dialog').showModal();
  if(inspect)artwork.inspect(mint).then(()=>{if(imageMint===mint&&$('image-dialog').open)showImageDetails(mint);});
}
let whaleEvents=[], lastWhalePopup=0;
function syncWhales(){feed.setTradeTokens($('whale-enabled').checked?store.items.slice(0,25).map(t=>t.mint):[]);$('whale-scope').textContent=$('whale-enabled').checked?`Monitoring ${feed.tradeTokens.length} recent launches · threshold is trade size, not wallet identity.`:'Large-buy monitoring off. Enable to watch the 25 most recent received launches.';}
$('sound-toggle').onclick=async()=>{
  if(sounds.enabled){sounds.mute();$('sound-toggle').textContent='Enable sounds';$('sound-state').textContent='Muted';return;}
  try{await sounds.enable();sounds.volume=Number($('sound-volume').value)/100;sounds.play('launch',true);$('sound-toggle').textContent='Mute sounds';$('sound-state').textContent='Sound on · rapid events grouped';}
  catch(_){$('sound-state').textContent='Audio unavailable. Check browser permissions and try again.';}
};
$('sound-volume').oninput=()=>{sounds.volume=Number($('sound-volume').value)/100;};
$('whale-enabled').onchange=()=>{syncWhales();if(streamState==='provider_error')feed.reconnect();};
$('whale-threshold').onchange=()=>{const n=Number($('whale-threshold').value);if(!Number.isFinite(n)||n<=0){$('whale-threshold').value='10';}$('whale-threshold').value=String(Math.min(1000000,Math.max(.1,Number($('whale-threshold').value))));};

function alertNode(a) {
  const n=node('article','',`mini-alert ${a.kind}`);
  n.append(node('strong',a.title),node('p',a.detail),node('time',new Date(a.time*1000).toLocaleString()));
  return n;
}
function popup(a) {
  window.DeskAlerts?.publish(a);
}
$('test').onclick=()=>popup({id:'demo-'+Date.now(),time:Date.now()/1000,kind:'watch',title:'TEST CALLOUT',detail:'Demonstration only. No order was placed.'});
if('Notification'in window&&Notification.permission==='granted')$('notify').textContent='Desktop notifications on';
$('notify').onclick=async()=>{
  if(!('Notification' in window)){$('permission').textContent='Your browser supports in-page alerts only.';return;}
  try{notificationsEnabled=await Notification.requestPermission()==='granted';$('notify').textContent=notificationsEnabled?'Desktop notifications on':'Enable notifications';$('permission').textContent=notificationsEnabled?'Desktop callouts enabled for this session.':'Permission not granted; in-page alerts remain active.';}
  catch(_){$('permission').textContent='Desktop notifications unavailable in this browser.';}
};
$('wallet-help').onclick=()=>$('wallet-dialog').showModal();
$('close-wallet').onclick=()=>$('wallet-dialog').close();
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{
  document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-selected',String(b===button));});
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('hidden',p.id!=='tab-'+button.dataset.tab));
});

function renderArtwork(card,t){
  if(!t)return;
  const avatar=card.querySelector('.avatar'),status=card.querySelector('.art-status'),url=artwork.get(t),previous=avatar.querySelector('img');
  status.textContent=artwork.status(t.mint);
  status.setAttribute('role','button');status.tabIndex=0;status.onclick=()=>showImageDetails(t.mint,true);status.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();showImageDetails(t.mint,true);}};
  if(imageMint===t.mint&&$('image-dialog').open)showImageDetails(t.mint);
  if(previous?.dataset.url===url)return;
  previous?.remove();
  if(url){const img=document.createElement('img');img.dataset.url=url;img.alt=t.name+' token artwork';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
    img.onload=()=>{artwork.loaded(t.mint);status.textContent='Artwork loaded';};
    img.onerror=()=>{img.remove();artwork.reject(t.mint,url);};img.src=url;avatar.append(img);
  }
}
function tokenCard(t) {
  if(cards.has(t.mint))return cards.get(t.mint);
  const card=node('article','','token');card.dataset.mint=t.mint;
  const top=node('div','','token-top'), avatar=node('div',t.symbol.slice(0,2).toUpperCase(),'avatar');
  let hue=0;for(const c of t.mint)hue=(hue*31+c.charCodeAt(0))%360;
  avatar.style.background=`hsl(${hue} 25% 25%)`;avatar.style.color=`hsl(${hue} 80% 84%)`;
  const name=node('div','','token-name');name.append(node('strong',t.name),node('div','$'+t.symbol,'symbol'));
  const timestamp=node('span',age(t.receivedAt),'token-age');timestamp.dataset.time=String(t.receivedAt);
  top.append(avatar,name,timestamp);
  const stats=node('div','','token-stats');
  for(const [label,value] of [['Launch cap · SOL',compact(t.marketCapSol)],['Creator buy · SOL',compact(t.creatorSol)]]) {
    const group=node('div','');group.append(node('span',label),node('strong',value));stats.append(group);
  }
  const bottom=node('div','','token-bottom'), copy=node('button',t.mint.slice(0,6)+'…'+t.mint.slice(-5)+' ⧉','contract');
  copy.title=t.mint;copy.setAttribute('aria-label','Copy contract '+t.mint);
  copy.onclick=async()=>{try{await navigator.clipboard.writeText(t.mint);copy.textContent='Address copied ✓';}catch(_){popup({id:'copy-'+Date.now(),time:Date.now()/1000,kind:'warning',title:'COPY ADDRESS',detail:t.mint});}};
  const link=node('a','View on pump.fun ↗','button small');link.href='https://pump.fun/coin/'+encodeURIComponent(t.mint);link.target='_blank';link.rel='noopener noreferrer';
  const actions=node('div','','token-actions'),analyze=node('button','Analyze runner potential','button small'),trade=node('button','Manual trade','button small');
  analyze.onclick=()=>window.RunnerResearch.open(t);trade.onclick=()=>window.ManualWallet.open(t.mint);
  actions.append(analyze,trade);
  bottom.append(copy,link);card.append(top,node('small','Loading artwork','art-status'),stats,bottom,actions,node('span','● NEW LAUNCH · UNREVIEWED','unreviewed'));
  cards.set(t.mint,card);renderArtwork(card,t);
  return card;
}
const more=node('button','Show more','button small');more.onclick=()=>{pageSize+=60;renderLaunches();};$('retained').after(more);
function renderLaunches() {
  renderTimer=null;
  const tokens=store.select({search:$('search').value,age:Number($('age').value),sort:$('sort').value});
  const activeMint=document.activeElement?.closest('.token')?.dataset.mint;
  const rows=tokens.slice(0,pageSize).map(tokenCard);
  if(!rows.length) {
    const empty=node('div','','empty');empty.append(node('div','◎','empty-icon'));
    empty.append(node('strong',store.items.length?'No matching launches':streamState==='connected'?'Listening for the next launch':'Launch feed is not connected yet'));
    empty.append(node('p',store.items.length?'Try another ticker, contract, or age filter.':streamState==='connected'?'New creations will appear here as the provider delivers them. No wallet or trading process is required.':'Check your internet connection and the feed status. Reconnect to try again. Existing launches are not backfilled.'));
    rows.push(empty);
  }
  // Preserve existing image elements; replacing the entire grid on every launch
  // repeatedly cancelled slow/lazy image downloads.
  const wanted=new Set(rows);for(const child of [...$('tokens').children])if(!wanted.has(child))child.remove();
  rows.forEach((row,i)=>{if($('tokens').children[i]!==row)$('tokens').insertBefore(row,$('tokens').children[i]||null);});
  const retained=new Set(store.items.map(t=>t.mint));for(const mint of cards.keys())if(!retained.has(mint))cards.delete(mint);
  if(activeMint)$('tokens').querySelector(`[data-mint="${activeMint}"] .contract`)?.focus({preventScroll:true});
  $('visible-count').textContent=`${tokens.length} tokens`;
  $('launch-total').textContent=store.total.toLocaleString();$('launch-minute').textContent=store.recentCount().toLocaleString();
  more.classList.toggle('hidden',tokens.length<=pageSize);
  $('retained').textContent=`Showing ${Math.min(tokens.length,pageSize)} of ${store.items.length} retained · max 1000`;
}
function scheduleRender(){if(renderTimer===null)renderTimer=setTimeout(renderLaunches,250);}
for(const id of ['search','age','sort'])$(id).addEventListener(id==='search'?'input':'change',()=>{pageSize=60;renderLaunches();});

const feed=new PumpLaunchFeed.Connection({
  onToken(message){
    const token=store.add(message);
    if(token){lastEvent=Date.now();scheduleRender();syncWhales();window.RunnerResearch?.observe(token);if($('launch-sounds').checked)sounds.play('launch');return;}
    const trade=whales.accept(message,feed.tradeTokens,Number($('whale-threshold').value));
    if(trade){
      const token=store.items.find(t=>t.mint===trade.mint),symbol=token?.symbol||trade.mint.slice(0,6);
      const alert={id:trade.signature+':'+trade.mint,time:trade.time,kind:'whale',title:`LARGE BUY · ${symbol}`,detail:`${trade.sol.toFixed(2)} SOL reported buy · ${trade.mint}. Trade-size alert, not a verified whale identity.`};
      whaleEvents.unshift(alert);whaleEvents=whaleEvents.slice(0,12);renderWhales();
      sounds.play('whale');
      if(Date.now()-lastWhalePopup>=6000){lastWhalePopup=Date.now();popup(alert);} // Muting audio does not disable visual alerts.
    }
  },
  onStatus(status){
    streamState=status.state;if(status.state==='connected')connectedAt=Date.now();
    const labels={connecting:'Connecting to launch stream',connected:'Launch stream connected',reconnecting:'Disconnected · retrying',paused:'Launch stream paused',provider_error:'Provider rejected subscription'};
    $('feed-state').textContent=labels[status.state]||'Stream unavailable';
    $('feed-badge').classList.toggle('online',status.state==='connected');
    $('pause-feed').textContent=feed.stopped?'Resume feed':'Pause feed';
    $('coverage').textContent=status.gap?'Coverage gap: launches during downtime or pauses may be missing. No backfill. Showing received events only.':'Source: PumpPortal new-token stream. No historical backfill. Events may be missed during interruptions.';
    $('coverage').classList.toggle('warning',status.gap);scheduleRender();
    $('whale-connection').textContent=status.state==='connected'?'Trade stream uses this connection; provider coverage applies.':'Trade monitoring interrupted with launch feed.';
  }
});
let connectedAt=0,lastRecovery=0;
$('pause-feed').onclick=()=>{if(feed.stopped)feed.start();else feed.stop();};
$('reconnect').onclick=()=>feed.reconnect();
$('retry-art').onclick=()=>artwork.retry();
feed.start();renderLaunches();
window.addEventListener('online',()=>{if(!feed.stopped)feed.reconnect();});
function recoverStream(){if(!feed.stopped&&streamState==='connected'&&Date.now()-Math.max(lastEvent,connectedAt)>120000&&Date.now()-lastRecovery>120000){lastRecovery=Date.now();feed.reconnect();}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)recoverStream();});
function renderWhales(){
  $('whale-timeline').replaceChildren(...whaleEvents.map(alertNode));
  if(!whaleEvents.length)$('whale-timeline').append(node('p','No qualifying buys received for monitored tokens.','side-note'));
}
renderWhales();
window.addEventListener('beforeunload',()=>feed.stop(false));
setInterval(()=>{
  recoverStream();
  for(const t of store.items.slice(0,pageSize))if(cards.has(t.mint))renderArtwork(cards.get(t.mint),t);
  document.querySelectorAll('.token-age').forEach(el=>el.textContent=age(Number(el.dataset.time)));
  $('launch-minute').textContent=store.recentCount().toLocaleString();
  $('feed-updated').textContent=lastEvent?'Last event '+age(lastEvent):'Awaiting first event';
  if(lastEvent && streamState==='connected' && Date.now()-lastEvent>90000)$('feed-state').textContent='Connected · no recent events';
},1000);

async function refreshBot() {
  try {
    const response=await fetch('/api/status',{cache:'no-store'});if(!response.ok)throw Error('status');const d=await response.json();
    const stale=!d.time||Date.now()/1000-d.time>Math.max(120,2*(d.interval_seconds||60));
    const mode=d.mode==='paper'?'Paper':d.mode==='live-pump'?'Live · Pump':d.mode==='live-solana'?'Live · Solana':'Offline';
    const statusMode=d.error?'Stopped':stale?'Offline':mode;
    $('mode').textContent=statusMode;$('positions-mode').textContent=statusMode;
    for(const id of ['mode','positions-mode','scanner-status'])$(id).classList.toggle('offline',stale||Boolean(d.error));
    $('scanner-status').textContent=d.error?'Error':stale?'Offline':d.halted?'Halted':'Updated';
    $('equity').textContent=money(d.equity);$('positions').textContent=(d.positions||[]).length;$('limit').textContent=money(d.daily_loss_usd);
    $('equity-note').textContent=stale?'No fresh trading bot report':mode+' · tracked ledger';
    $('position-note').textContent=stale?'No fresh trading data':'From the trading ledger';
    $('server-health').textContent='App server online';
    $('status').textContent=d.error?d.error:stale?'Trading process offline or not reporting. Launch discovery above runs independently.':d.halted?'Daily stop active. New entries halted.':'Bot report updated '+new Date(d.time*1000).toLocaleTimeString()+'. Manual orders require Phantom approval.';
    $('bot-warning').textContent=d.error|| (d.halted?'Daily stop active. Exits depend on liquidity and execution.':'');$('bot-warning').classList.toggle('hidden',!d.error&&!d.halted);
    const rows=(d.candidates||[]).slice().sort((a,b)=>b.score-a.score).map(x=>{
      const row=node('tr',''), name=node('td','');name.append(node('strong',x.symbol||'Unknown'),node('div',x.chain||'solana','symbol'));
      name.title=x.token_address||x.address;const failed=Object.entries(x.checks||{}).filter(([,v])=>!v).map(([k])=>k).join(', ');
      row.append(name,node('td',Number(x.price).toPrecision(5)),node('td',Number(x.score).toFixed(1)),node('td',x.eligible?'WATCH':failed+(x.narrative_reason?' · '+x.narrative_reason:''),x.eligible?'lime':''));return row;
    });
    if(!rows.length){const r=node('tr',''),cell=node('td','No scanner report. Fresh launches remain available in Discover.');cell.colSpan=4;r.append(cell);rows.push(r);}$('markets').replaceChildren(...rows);
    const holdings=(d.positions||[]).map(p=>node('div',`${p.symbol||p.address} · ${p.chain||'solana'} · entry cost ${money(p.spent)} · entry price ${Number(p.entry).toPrecision(5)}`,'position'));
    if(!holdings.length)holdings.push(node('div','No open positions reported. Browsing launches does not start trading.','side-body'));$('holdings').replaceChildren(...holdings);
    const alerts=d.alerts||[];$('timeline').replaceChildren(...alerts.slice(-12).reverse().map(alertNode));if(!alerts.length)$('timeline').append(node('p','No trade callouts yet. New launches appear in Discover; they are not buy signals.','side-note'));
    window.DeskAlerts?.report(d);
  } catch(_) {
    $('server-health').textContent='App server offline · reopen Signal Desk app';
    $('status').textContent='Dashboard connection lost. Trading reports may be stale.';$('mode').textContent='Disconnected';
    $('mode').classList.add('offline');
  }
}
refreshBot();setInterval(refreshBot,3000);

let depositAddress=null;
$('copy-deposit').onclick=async()=>{if(!depositAddress)return;try{await navigator.clipboard.writeText(depositAddress);$('copy-deposit').textContent='Address copied ✓';}catch(_){$('copy-deposit').textContent='Select and copy the full address above';}};
function positionsInto(id,data){
  const rows=(data.positions||[]).map(p=>node('div',`${p.symbol||p.address} · entry cost ${money(p.spent)} · last reported price ${Number(p.last_price).toPrecision(5)}`,'position'));
  if(!rows.length)rows.push(node('p','No open positions reported.','side-note'));$(id).replaceChildren(...rows);
}
function modeInto(prefix,data){
  const stale=!data.time||Date.now()/1000-data.time>Math.max(120,2*(data.interval_seconds||60));
  $(prefix+'-equity').textContent=money(data.equity);$(prefix+'-count').textContent=(data.positions||[]).length;
  $(prefix+'-state').textContent=data.error?'Stopped':stale?'Offline':data.halted?'Halted':prefix==='paper'?'Paper running':'Live report';
  $(prefix+'-status').textContent=data.error|| (stale?'No fresh process report. Starting the dashboard does not start this trading process.':'Updated '+new Date(data.time*1000).toLocaleTimeString()+'. Entries require fresh narrative measurements; these do not guarantee runners.');
  if(prefix==='live'){
    $('live-limit').textContent=money(data.daily_loss_usd);
    if(data.execution_timing_ms)$('live-timing').textContent='Last measured processing: '+Object.entries(data.execution_timing_ms).map(([k,v])=>k+' '+v+' ms').join(' · ')+'. Future timings vary.';
  }
  positionsInto(prefix+'-positions',data);
  $(prefix+'-alerts').replaceChildren(...(data.alerts||[]).slice(-15).reverse().map(alertNode));
}
function communityImage(url){return typeof url==='string'&&/^\/api\/community-image\?id=[a-f0-9]{64}$/.test(url)?url:MarketExtras.imageURL(url);}
function communityCard(post){
  const card=node('article','','community-post'),header=node('div','','community-author');
  const avatar=communityImage(post.avatar);if(avatar){const img=document.createElement('img');img.src=avatar;img.alt='Author profile image';img.referrerPolicy='no-referrer';img.onerror=()=>img.remove();header.append(img);}
  const who=node('div','');who.append(node('strong',post.author||post.username||'Unknown author'),node('div',`${post.source||'External'} · ${new Date(post.time*1000).toLocaleString()}`,'symbol'));header.append(who);
  card.append(header,node('p',post.text||''));
  let image=communityImage(post.image);
  if(!image&&post.mint){const token=store.items.find(t=>t.mint===post.mint)||{mint:post.mint};image=artwork.get(token);}
  if(image){const img=document.createElement('img');img.src=image;img.alt='Unverified callout or token artwork';img.className='community-media';img.referrerPolicy='no-referrer';img.loading='lazy';img.onerror=()=>img.remove();card.append(img);}
  if(post.mint)card.append(node('small',post.mint));
  const source=MarketExtras.imageURL(post.source_url);if(source){const link=node('a','Open original callout ↗','button small');link.href=source;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}
  return card;
}
async function refreshSections(){
  const results=await Promise.allSettled(['/api/status?mode=paper','/api/status?mode=live','/api/wallet','/api/community'].map(async url=>{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('status');return response.json();}));
  if(results[0].status==='fulfilled')modeInto('paper',results[0].value);
  if(results[1].status==='fulfilled')modeInto('live',results[1].value);
  for(const result of results.slice(0,2))if(result.status==='fulfilled')window.DeskAlerts?.report(result.value);
  if(results[2].status==='fulfilled'){depositAddress=results[2].value.address;$('deposit-address').textContent=depositAddress||results[2].value.status;$('copy-deposit').disabled=!depositAddress;}
  if(results[3].status==='fulfilled'){
    const data=results[3].value;$('community-status').textContent=data.status+(data.updated_at?' · last collector update '+new Date(data.updated_at*1000).toLocaleString():'');
    const rows=(data.items||[]).slice().reverse().slice(0,50).map(communityCard);
    if(!rows.length)rows.push(node('div','No source posts fetched. Configure authorized X / Telegram access; posts and performance are not fabricated.','empty'));$('community-items').replaceChildren(...rows);
  }
}
refreshSections();setInterval(refreshSections,3000);
async function checkVersion(){try{const response=await fetch('/api/health',{cache:'no-store'}),data=await response.json();$('update-warning').classList.toggle('hidden',data.version>=3);$('app-version').textContent='Server v'+(data.version||'unknown');}catch(_){$('app-version').textContent='Server unavailable';}}
checkVersion();setInterval(checkVersion,30000);
