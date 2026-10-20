const {test}=require('node:test');
const assert=require('node:assert/strict');
const {imageURL,pumpImageURL,metadataURL,Artwork,WhaleTracker,Sounds}=require('../market_extras.js');
test('mint-specific pump artwork starts without a metadata URI, Python RPC or metadata request',()=>{
  let fetched=0;const artwork=new Artwork({fetchImpl:()=>{fetched++;throw Error('must not fetch metadata');}});
  const first={mint:'So11111111111111111111111111111111111111112'},second={mint:'2'.repeat(32)};
  assert.equal(artwork.get(first),'https://images.pump.fun/coin-image/'+first.mint+'?img-width=128&img-dpr=2');
  assert.notEqual(artwork.get(first),artwork.get(second));
  artwork.loaded(first.mint,artwork.get(first));assert.equal(artwork.status(first.mint),'Artwork loaded');
  assert.equal(fetched,0);
  for(const mint of ['../secret','x?mint=other','https://localhost','0'.repeat(32)])assert.equal(pumpImageURL(mint),null);
});
test('broken stream image tries pump artwork, then metadata proxy; stale errors cannot remove recovered image',async()=>{
  let finish,fetches=0;const done=new Promise(resolve=>finish=resolve);
  const artwork=new Artwork({fetchImpl:async()=>{fetches++;return new Response(JSON.stringify({image:'https://ipfs.io/ipfs/fixture',proxy:'/api/token-image?url=fixture'}));},onChange:()=>{if(fetches&&![...artwork.cache.values()].some(entry=>entry.pending))finish();}});
  const token={mint:'So11111111111111111111111111111111111111112',image:'https://example.com/stream.png'};
  const original=artwork.get(token);artwork.reject(token.mint,original);
  assert.equal(artwork.get(token),pumpImageURL(token.mint));assert.equal(fetches,0);
  artwork.reject(token.mint,artwork.get(token));await done;
  assert.equal(artwork.get(token),'/api/token-image?url=fixture');assert.equal(fetches,1);
  assert.ok(artwork.diagnostics(token.mint).attempts.some(a=>a.source==='Pump.fun image service'));
  artwork.reject(token.mint,original);assert.equal(artwork.get(token),'/api/token-image?url=fixture');
  artwork.loaded(token.mint,original);assert.notEqual(artwork.status(token.mint),'Artwork loaded');
  artwork.retry(token.mint);assert.equal(artwork.get(token),pumpImageURL(token.mint));
});
test('images use public HTTPS URLs and metadata uses known gateways',()=>{
  assert.equal(imageURL('ipfs://QmExample'),'https://ipfs.io/ipfs/QmExample');
  assert.equal(imageURL('ar://example'),'https://arweave.net/example');
  for(const url of ['javascript:alert(1)','http://example.com/a.png','https://127.0.0.1/a','https://[::1]/a','https://foo.local/a','https://user:secret@example.com/a'])assert.equal(imageURL(url),null);
  assert.equal(metadataURL('https://untrusted.example/metadata.json'),null);
  assert.ok(metadataURL('https://ipfs.io/ipfs/QmExample'));
});
test('metadata loads once, authenticates only local requests and failed artwork has fallback',async()=>{
  let fetches=0,changed;const complete=new Promise(resolve=>changed=resolve);
  const artwork=new Artwork({fetchImpl:async(url,options)=>{fetches++;assert.equal(options.credentials,url.startsWith('/')?'same-origin':'omit');return new Response(JSON.stringify({image:'https://example.com/token.png'}));},onChange:changed});
  const token={mint:'token',uri:'ipfs://QmExample'};
  assert.equal(artwork.get(token),null);assert.equal(artwork.get(token),null);
  await complete;assert.equal(artwork.get(token),'https://example.com/token.png');assert.equal(fetches,1);
  artwork.reject(token.mint);assert.equal(artwork.get(token),null);
  assert.ok(artwork.diagnostics(token.mint).attempts.some(a=>a.status==='image_request_or_decode_failed'));
});
test('large buys require buy side, watched mint, threshold and unique signature',()=>{
  const tracker=new WhaleTracker();const event={txType:'buy',mint:'mint',signature:'signature',solAmount:12};
  assert.equal(tracker.accept(event,[],10),null);
  assert.equal(tracker.accept({...event,txType:'sell'},['mint'],10),null);
  assert.equal(tracker.accept(event,['mint'],15),null);
  assert.equal(tracker.accept({...event,solAmount:'NaN'},['mint'],10),null);
  assert.equal(tracker.accept(event,['mint'],10).sol,12);
  assert.equal(tracker.accept(event,['mint'],10),null);
});
test('failed metadata retries after backoff and does not refetch on every render',async()=>{
  let now=0,fetches=0,changed;
  const artwork=new Artwork({now:()=>now,fetchImpl:async()=>{fetches++;return new Response('{"image":null}');},onChange:()=>changed?.()});
  const token={mint:'retry-mint'};
  await new Promise(resolve=>{changed=resolve;artwork.get(token);});
  for(let i=0;i<50;i++)artwork.get(token);assert.equal(fetches,1);
  now=10001;await new Promise(resolve=>{changed=resolve;artwork.get(token);});assert.equal(fetches,2);
  now=40002;await new Promise(resolve=>{changed=resolve;artwork.get(token);});assert.equal(fetches,3);
  now=1000000;artwork.get(token);assert.equal(fetches,3);
});
test('sound is opt-in, has separate cooldowns, respects mute and schedules finite envelopes',async()=>{
  let started=0,now=10000;
  const param={setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}};
  class Context{constructor(){this.state='suspended';this.currentTime=1;this.destination={};}async resume(){this.state='running';}createOscillator(){return {frequency:param,connect(){},start(){started++;},stop(){},disconnect(){}};}createGain(){return {gain:param,connect(){},disconnect(){}};}}
  const sound=new Sounds({Context,now:()=>now});
  assert.equal(sound.play('launch'),false);assert.equal(started,0);
  await sound.enable();assert.equal(sound.play('launch'),true);assert.equal(started,2);
  assert.equal(sound.play('launch'),false);assert.equal(sound.play('whale'),true);assert.equal(started,5);
  now+=3000;assert.equal(sound.play('launch'),true);assert.equal(sound.play('whale'),false);
  sound.mute();assert.equal(sound.play('whale',true),false);
});
