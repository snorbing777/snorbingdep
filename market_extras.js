(function(root){
  'use strict';
  const META_HOSTS=new Set(['ipfs.io','gateway.pinata.cloud','pump.mypinata.cloud','arweave.net']);
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
  class Artwork{
    constructor({fetchImpl=root.fetch,onChange=()=>{}}={}){this.fetch=(...args)=>fetchImpl.call(root,...args);this.onChange=onChange;this.cache=new Map();this.queue=[];this.active=0;}
    get(token){
      if(this.cache.has(token.mint))return this.cache.get(token.mint).url;
      const image=imageURL(token.image),uri=metadataURL(token.uri);
      this.cache.set(token.mint,{url:image,pending:!image&&Boolean(uri)});
      if(this.cache.size>256)this.cache.delete(this.cache.keys().next().value);
      if(!image&&uri){if(this.queue.length>=128){const old=this.queue.shift();this.cache.set(old.mint,{url:null,pending:false});}this.queue.push({mint:token.mint,uri});this.pump();}
      return image;
    }
    reject(mint){this.cache.set(mint,{url:null,pending:false});}
    async pump(){
      if(this.active>=4||!this.queue.length)return;
      const job=this.queue.shift();this.active++;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
      try{
        const response=await this.fetch(job.uri,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'follow'});
        if(response.url&&!metadataURL(response.url))throw Error('redirect');
        if(!response.ok||!response.body)throw Error('metadata');
        const reader=response.body.getReader(),chunks=[];let size=0;
        while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw Error('oversize');}chunks.push(value);}
        const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.byteLength;}
        const metadata=JSON.parse(new TextDecoder().decode(raw));
        this.cache.set(job.mint,{url:imageURL(metadata.image),pending:false});
      }catch(_){this.cache.set(job.mint,{url:null,pending:false});}
      finally{clearTimeout(timer);while(this.cache.size>256)this.cache.delete(this.cache.keys().next().value);this.active--;this.onChange();this.pump();}
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
  const api={imageURL,metadataURL,Artwork,WhaleTracker,Sounds};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MarketExtras=api;
})(typeof window!=='undefined'?window:globalThis);
