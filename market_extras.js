(function(root){
  'use strict';
  const META_HOSTS=new Set(['ipfs.io','gateway.pinata.cloud','pump.mypinata.cloud','arweave.net','dweb.link']);
  const IMAGE_HOSTS=new Set([...META_HOSTS,'images.pump.fun','cdn.dexscreener.com','dd.dexscreener.com','pbs.twimg.com']);
  function imageURL(value){
    if(typeof value!=='string'||value.length>2048)return null;
    value=value.trim();
    if(value.startsWith('ipfs://'))value='https://ipfs.io/ipfs/'+value.slice(7).replace(/^ipfs\//,'');
    if(value.startsWith('ar://'))value='https://arweave.net/'+value.slice(5);
    try{
      const url=new URL(value),host=url.hostname.toLowerCase();
      if(url.protocol==='http:'&&META_HOSTS.has(host)&&url.pathname.startsWith('/ipfs/')&&(!url.port||url.port==='80')){url.protocol='https:';url.port='';}
      if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!host.includes('.')||
        host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||/^\d+\.\d+\.\d+\.\d+$/.test(host)||host.includes(':'))return null;
      const sub=host.match(/^(b[a-z2-7]{20,120})\.ipfs\./);
      if(sub)return 'https://ipfs.io/ipfs/'+sub[1]+url.pathname;
      if(/^\/ipfs\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})(\/|$)/.test(url.pathname)&&!IMAGE_HOSTS.has(host))return 'https://ipfs.io'+url.pathname;
      return url.href;
    }catch(_){return null;}
  }
  function metadataURL(value){const safe=imageURL(value);if(!safe)return null;const host=new URL(safe).hostname;return META_HOSTS.has(host)||host.endsWith('.ipfs.dweb.link')?safe:null;}
  function imageCandidates(value,proxy){
    const image=imageURL(value);if(!image)return [];
    const url=new URL(image),known=IMAGE_HOSTS.has(url.hostname)||url.hostname.endsWith('.ipfs.dweb.link');
    const choices=[proxy,image,known?'/api/token-image?url='+encodeURIComponent(image):null];
    if(url.pathname.startsWith('/ipfs/'))for(const host of ['ipfs.io','gateway.pinata.cloud','pump.mypinata.cloud'])choices.push('https://'+host+url.pathname+url.search);
    return [...new Set(choices.filter(Boolean))];
  }
  function metadataImage(data,source){
    let image=data?.image||data?.image_uri||data?.imageUri||data?.image_url||data?.imageUrl;
    if(image&&typeof image==='object')image=image.url||image.uri;
    if(typeof image!=='string')return null;
    return imageURL(image.startsWith('ipfs://')||image.startsWith('ar://')?image:new URL(image,source).href);
  }
  async function boundedJSON(response){
    if(!response.ok)throw Error('http_'+response.status);
    if(!response.body)throw Error('empty_response');
    const reader=response.body.getReader(),chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw Error('oversize');}chunks.push(value);}
    const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder().decode(raw));
  }
  class Artwork{
    constructor({fetchImpl=root.fetch,onChange=()=>{},now=()=>Date.now()}={}){
      this.fetch=(...args)=>fetchImpl.call(root,...args);
      Object.assign(this,{onChange,now});this.cache=new Map();this.queue=[];this.active=0;
    }
    get(token){
      let entry=this.cache.get(token.mint);
      if(!entry){
        entry={url:null,choices:[],failed:new Set(),token:{...token},pending:false,attempted:false,attempts:0,revision:0,status:'Loading creator metadata'};
        this.cache.set(token.mint,entry);this.useImage(entry,token.image);
        if(!entry.url)this.enqueue(token.mint);
      }else{
        // Alerts can request artwork with only a mint before the creation event.
        // Preserve newly received metadata instead of retaining that empty entry.
        const changed=(token.uri&&token.uri!==entry.token.uri)||(token.image&&token.image!==entry.token.image);
        for(const [key,value] of Object.entries(token))if(value!==null&&value!==undefined&&value!=='')entry.token[key]=value;
        if(changed){
          entry.revision++;entry.attempts=0;entry.attempted=false;entry.failed.clear();
          entry.controller?.abort();
          if(token.image)this.useImage(entry,token.image);
          if(!entry.url&&!entry.pending)this.enqueue(token.mint);
        }
        if(!entry.url&&!entry.pending&&entry.retryAt&&this.now()>=entry.retryAt&&entry.attempts<3){entry.failed.clear();this.enqueue(token.mint);}
      }
      while(this.cache.size>1200)this.cache.delete(this.cache.keys().next().value);
      return entry.url;
    }
    useImage(entry,image,proxy){
      entry.choices=imageCandidates(image,proxy).filter(url=>!entry.failed.has(url));
      entry.url=entry.choices.shift()||null;
      if(entry.url)entry.status='Loading creator image';
    }
    status(mint){return this.cache.get(mint)?.status||'Loading artwork';}
    loaded(mint,url){const entry=this.cache.get(mint);if(entry&&(!url||url===entry.url))entry.status='Artwork loaded';}
    diagnostics(mint){const entry=this.cache.get(mint);return entry?{mint,status:entry.status,stream_image_present:Boolean(entry.token?.image),stream_uri_present:Boolean(entry.token?.uri),attempts:[...(entry.browserAttempts||[]),...(entry.diagnostics?.attempts||[])],proxy_failure:entry.diagnostics?.proxy_failure||null}:{};}
    async inspect(mint){const entry=this.cache.get(mint);if(!entry)return;try{entry.diagnostics=await this.json('/api/artwork?mint='+encodeURIComponent(mint)+'&uri='+encodeURIComponent(entry.token?.uri||''),22000);}catch(_){} }
    enqueue(mint){
      const entry=this.cache.get(mint);if(!entry||entry.pending)return;
      entry.pending=true;entry.status='Loading creator metadata';this.queue.push(mint);
      this.queue.sort((a,b)=>(this.cache.get(b)?.token?.receivedAt||0)-(this.cache.get(a)?.token?.receivedAt||0));
      if(this.queue.length>1000){const dropped=this.cache.get(this.queue.pop());if(dropped){dropped.pending=false;dropped.retryAt=this.now()+30000;dropped.status='Artwork queued for later';}}
      this.pump();
    }
    reject(mint,failedURL,reason='image_request_or_decode_failed'){
      const entry=this.cache.get(mint);if(!entry||(failedURL&&entry.url!==failedURL))return;
      if(entry.url)entry.failed.add(entry.url);
      const source=entry.url?.startsWith('/api/token-image?')?'Local image proxy':'Creator image host';
      entry.browserAttempts??=[];
      if(!entry.browserAttempts.some(a=>a.source===source&&a.status===reason))entry.browserAttempts.push({stage:'Browser image',source,status:reason});
      entry.url=entry.choices.find(url=>!entry.failed.has(url))||null;
      entry.choices=entry.choices.filter(url=>url!==entry.url);
      if(entry.url)entry.status='Trying another image gateway';
      else{entry.status='Image unavailable · retrying';entry.retryAt=this.now()+10000;if(!entry.attempted)this.enqueue(mint);}
      this.onChange(mint);
    }
    retry(onlyMint){
      for(const [mint,entry] of this.cache)if(!onlyMint||mint===onlyMint){
        entry.revision++;entry.attempts=0;entry.attempted=false;entry.force=true;entry.failed.clear();entry.controller?.abort();
        this.useImage(entry,entry.token.image);
        if(!entry.url&&!entry.pending)this.enqueue(mint);
      }
      this.onChange(onlyMint);
    }
    async json(url,timeout,signal){
      const controller=new AbortController(),abort=()=>controller.abort();
      if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(abort,timeout);
      try{return await boundedJSON(await this.fetch(url,{signal:controller.signal,credentials:url.startsWith('/')?'same-origin':'omit',referrerPolicy:'no-referrer',redirect:'follow'}));}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }
    async pump(){
      if(this.active>=4||!this.queue.length)return;
      const mint=this.queue.shift(),entry=this.cache.get(mint);if(!entry){this.pump();return;}
      this.active++;entry.attempts++;
      const revision=entry.revision,controller=new AbortController();entry.controller=controller;
      const uri=typeof entry.token.uri==='string'?entry.token.uri.slice(0,2048):'';
      const browserAttempts=[];
      try{
        const backend=(async()=>{
          try{
            const data=await this.json('/api/artwork?mint='+encodeURIComponent(mint)+'&uri='+encodeURIComponent(uri)+(entry.force?'&refresh=1':''),22000,controller.signal);
            if(entry.revision===revision)entry.diagnostics=data;
            const image=imageURL(data.image);
            if(!image)throw Error('image_field_missing');
            const proxy=typeof data.proxy==='string'&&data.proxy.startsWith('/api/token-image?url=')?data.proxy:null;
            return {image,proxy};
          }catch(error){
            if(!controller.signal.aborted&&entry.revision===revision)entry.diagnostics??={attempts:[{stage:'Local artwork resolver',status:'unreachable_or_no_image'}]};
            throw error;
          }
        })();
        const safe=metadataURL(uri),sources=safe?[safe]:[];
        if(safe){const url=new URL(safe);if(url.pathname.startsWith('/ipfs/'))sources.push('https://ipfs.io'+url.pathname,'https://gateway.pinata.cloud'+url.pathname);}
        // Try browser metadata alongside Python; a slow RPC or TLS failure must
        // not delay accessible creator metadata by 22 seconds.
        const browsers=[...new Set(sources)].slice(0,2).map(async source=>{
          try{
            const image=metadataImage(await this.json(source,5000,controller.signal),source);
            if(!image)throw Error('image_field_missing');
            browserAttempts.push({stage:'Browser token metadata',status:'image_found'});return {image};
          }catch(error){
            if(!controller.signal.aborted)browserAttempts.push({stage:'Browser token metadata',status:/^http_[0-9]{3}$/.test(error.message)?error.message:'unavailable_or_cors'});
            throw error;
          }
        });
        const found=await Promise.any([backend,...browsers]);
        if(entry.revision===revision){this.useImage(entry,found.image,found.proxy);entry.force=false;}
      }catch(_){
        if(entry.revision===revision&&!entry.url){
          const causes=(entry.diagnostics?.attempts||[]).map(a=>a.status);
          entry.status=causes.includes('tls_certificate_failed')?'Python TLS certificate error · click for help':'Creator image unavailable · click for details';
        }
      }finally{
        controller.abort();entry.pending=false;entry.controller=null;this.active--;
        if(entry.revision===revision){entry.attempted=true;entry.retryAt=this.now()+Math.min(90000,10000*3**(entry.attempts-1));entry.browserAttempts=[...(entry.browserAttempts||[]),...browserAttempts].slice(-12);}
        else if(!entry.url)this.enqueue(mint);
        this.onChange(mint);this.pump();
      }
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
  const api={imageURL,imageCandidates,metadataURL,Artwork,WhaleTracker,Sounds};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MarketExtras=api;
})(typeof window!=='undefined'?window:globalThis);
