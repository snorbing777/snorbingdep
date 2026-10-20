(function(root){
  'use strict';
  const META_HOSTS=new Set(['ipfs.io','gateway.pinata.cloud','pump.mypinata.cloud','arweave.net']);
  function pumpImageURL(mint){
    // The mint selects the creator's artwork on pump.fun's own image service.
    // Do not request an on-error redirect, which could return a generic icon.
    return typeof mint==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)?
      'https://images.pump.fun/coin-image/'+encodeURIComponent(mint)+'?img-width=128&img-dpr=2':null;
  }
  function imageURL(value){
    if(typeof value!=='string'||value.length>2048)return null;
    if(value.startsWith('ipfs://'))value='https://ipfs.io/ipfs/'+value.slice(7).replace(/^ipfs\//,'');
    if(value.startsWith('ar://'))value='https://arweave.net/'+value.slice(5);
    try{
      const url=new URL(value),host=url.hostname.toLowerCase();
      if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!host.includes('.')||
        host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||/^\d+\.\d+\.\d+\.\d+$/.test(host)||host.includes(':'))return null;
      return url.href;
    }catch(_){return null;}
  }
  function metadataURL(value){const safe=imageURL(value);if(!safe)return null;const host=new URL(safe).hostname;return META_HOSTS.has(host)||host.endsWith('.ipfs.dweb.link')?safe:null;}
  async function boundedJSON(response){
    if(!response.ok||!response.body)throw Error('unavailable');
    const reader=response.body.getReader(),chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw Error('oversize');}chunks.push(value);}
    const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder().decode(raw));
  }
  class Artwork{
    constructor({fetchImpl=root.fetch,onChange=()=>{},now=()=>Date.now()}={}){this.fetch=(...args)=>fetchImpl.call(root,...args);Object.assign(this,{onChange,now});this.cache=new Map();this.queue=[];this.active=0;}
    get(token){
      let value=this.cache.get(token.mint);
      if(!value){const image=imageURL(token.image),pump=pumpImageURL(token.mint);value={url:image||pump,backup:null,fallback:pump,failed:new Set(),token,pending:false,attempted:false,attempts:0,status:image?'Loading creator image':pump?'Loading pump.fun artwork':'Loading metadata'};this.cache.set(token.mint,value);if(!value.url)this.enqueue(token.mint);}
      else if(!value.url&&!value.pending&&value.retryAt&&this.now()>=value.retryAt&&value.attempts<3){value.failed.clear();value.url=pumpImageURL(token.mint);if(value.url){value.attempted=false;value.status='Retrying pump.fun artwork';}else this.enqueue(token.mint);}
      while(this.cache.size>1200)this.cache.delete(this.cache.keys().next().value);
      return this.cache.get(token.mint)?.url||null;
    }
    status(mint){return this.cache.get(mint)?.status||'Loading artwork';}
    loaded(mint,url){const entry=this.cache.get(mint);if(entry&&(!url||url===entry.url))entry.status='Artwork loaded';}
    diagnostics(mint){const entry=this.cache.get(mint);return entry?{mint,status:entry.status,stream_image_present:Boolean(entry.token?.image),stream_uri_present:Boolean(entry.token?.uri),attempts:[...(entry.browserAttempts||[]),...(entry.diagnostics?.attempts||[])],proxy_failure:entry.diagnostics?.proxy_failure||null}:{};}
    async inspect(mint){const entry=this.cache.get(mint);if(!entry)return;try{entry.diagnostics=await this.json('/api/artwork?mint='+encodeURIComponent(mint)+'&uri='+encodeURIComponent(entry.token?.uri||''),22000);}catch(_){} }
    enqueue(mint){const entry=this.cache.get(mint);if(!entry||entry.pending)return;entry.pending=true;entry.status='Loading metadata';this.queue.push(mint);
      this.queue.sort((a,b)=>(this.cache.get(b)?.token?.receivedAt||0)-(this.cache.get(a)?.token?.receivedAt||0));
      if(this.queue.length>1000){const dropped=this.cache.get(this.queue.pop());if(dropped){dropped.pending=false;dropped.retryAt=this.now()+30000;dropped.status='Artwork queued for later';}}
      this.pump();
    }
    reject(mint,failedURL){const old=this.cache.get(mint);if(!old||(failedURL&&old.url!==failedURL))return;
      if(old.url)old.failed.add(old.url);
      const source=old.url===pumpImageURL(mint)?'Pump.fun image service':old.url?.startsWith('/api/token-image?')?'Local image proxy':old.url===imageURL(old.token?.image)?'Launch event image':'Creator metadata image';
      old.browserAttempts??=[];if(!old.browserAttempts.some(a=>a.source===source))old.browserAttempts.push({stage:'Browser image',source,status:'image_request_or_decode_failed'});
      if(old.backup&&!old.failed.has(old.backup)){old.url=old.backup;old.backup=null;old.status='Trying direct image';}
      else if(old.fallback&&!old.failed.has(old.fallback)){old.url=old.fallback;old.status='Loading pump.fun artwork';}
      else{old.url=null;old.status='Image unavailable · retrying';old.retryAt=this.now()+10000;if(!old.attempted)this.enqueue(mint);}
      this.onChange(mint);
    }
    retry(onlyMint){for(const [mint,value] of this.cache)if((!onlyMint||mint===onlyMint)&&!value.pending){value.attempts=0;value.attempted=false;value.force=true;value.failed.clear();value.backup=null;value.url=pumpImageURL(mint)||imageURL(value.token?.image);value.status=value.url?'Retrying pump.fun artwork':'Loading metadata';if(!value.url)this.enqueue(mint);}this.onChange(onlyMint);}
    async json(url,timeout){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{return await boundedJSON(await this.fetch(url,{signal:controller.signal,credentials:url.startsWith('/')?'same-origin':'omit',referrerPolicy:'no-referrer',redirect:'follow'}));}finally{clearTimeout(timer);}}
    async pump(){
      if(this.active>=4||!this.queue.length)return;
      const mint=this.queue.shift(),entry=this.cache.get(mint);if(!entry){this.pump();return;}this.active++;entry.attempts++;
      try{
        let metadata;const uri=typeof entry.token?.uri==='string'?entry.token.uri.slice(0,2048):'';
        try{metadata=await this.json('/api/artwork?mint='+encodeURIComponent(mint)+'&uri='+encodeURIComponent(uri)+(entry.force?'&refresh=1':''),22000);entry.diagnostics=metadata;}catch(_){entry.diagnostics={attempts:[{stage:'Local artwork resolver',status:'unreachable_or_timed_out'}]};}entry.force=false;
        let url=imageURL(metadata?.image),proxy=typeof metadata?.proxy==='string'&&metadata.proxy.startsWith('/api/token-image?url=')?metadata.proxy:null;
        // Browser trust and CORS differ from Python's. Try public metadata directly
        // when the local resolver fails (including macOS Python trust-store errors).
        if(!url&&!proxy){
          const safe=metadataURL(uri),choices=safe?[safe]:[];
          if(safe){const parsed=new URL(safe);if(parsed.pathname.startsWith('/ipfs/'))choices.push('https://ipfs.io'+parsed.pathname,'https://gateway.pinata.cloud'+parsed.pathname);}
          for(const source of [...new Set(choices)].slice(0,2)){
            try{const data=await this.json(source,5000),image=data.image||data.image_uri;url=imageURL(image?new URL(image,source).href:null);if(url)break;}catch(_){}
          }
        }
        if(url&&entry.failed.has(url)&&!proxy)url=null;
        entry.url=proxy||url;entry.backup=proxy&&!entry.failed.has(url)?url:null;
        const causes=(entry.diagnostics?.attempts||[]).map(a=>a.status);
        entry.status=entry.url?'Loading image':causes.includes('tls_certificate_failed')?'Python TLS certificate error · click for help':!uri?'Looking up artwork by mint · unavailable so far':'Metadata unavailable · click for details';
      }catch(_){entry.url=null;entry.status='Metadata unavailable · retry later';}
      finally{entry.pending=false;entry.attempted=true;entry.retryAt=this.now()+Math.min(90000,10000*3**(entry.attempts-1));this.active--;this.onChange(mint);this.pump();}
    }
  }
  class WhaleTracker{
    constructor(){this.seen=new Set();}
    accept(message,watched,threshold){
      if(!Number.isFinite(threshold)||threshold<=0||message?.txType!=='buy'||!watched.includes(message.mint)||
        typeof message.signature!=='string'||!message.signature||message.signature.length>128)return null;
      const amount=Number(message.solAmount);
      if(!Number.isFinite(amount)||amount<threshold)return null;
      const key=message.signature+':'+message.mint;
      if(this.seen.has(key))return null;this.seen.add(key);
      if(this.seen.size>2000)this.seen.delete(this.seen.values().next().value);
      return {mint:message.mint,sol:amount,signature:message.signature,time:Date.now()/1000};
    }
  }
  class Sounds{
    constructor({Context=root.AudioContext||root.webkitAudioContext,now=()=>Date.now()}={}){this.Context=Context;this.now=now;this.enabled=false;this.last={};this.volume=.2;}
    async enable(){if(!this.Context)throw Error('unsupported');this.context??=new this.Context();await this.context.resume();if(this.context.state!=='running')throw Error('suspended');this.enabled=true;}
    mute(){this.enabled=false;}
    play(kind,force=false){
      if(!this.enabled||this.context?.state!=='running')return false;
      const now=this.now(),cooldown=kind==='whale'?6000:2500;
      if(!force&&this.last[kind]!==undefined&&now-this.last[kind]<cooldown)return false;
      this.last[kind]=now;
      const frequencies=kind==='whale'?[440,660,880]:[740,990];
      frequencies.forEach((frequency,index)=>{
        const oscillator=this.context.createOscillator(),gain=this.context.createGain(),start=this.context.currentTime+index*.1;
        oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,start);
        gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(this.volume*.25,start+.015);gain.gain.exponentialRampToValueAtTime(.0001,start+.16);
        oscillator.connect(gain);gain.connect(this.context.destination);oscillator.start(start);oscillator.stop(start+.18);
        oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
      });return true;
    }
  }
  const api={imageURL,pumpImageURL,metadataURL,Artwork,WhaleTracker,Sounds};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MarketExtras=api;
})(typeof window!=='undefined'?window:globalThis);
