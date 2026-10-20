const {test}=require('node:test');
const assert=require('node:assert/strict');
const {imageURL,imageCandidates,metadataURL,Artwork,WhaleTracker,Sounds}=require('../market_extras.js');
test('only creator-supplied image URLs are used; no image URL is invented from a mint',()=>{
  let fetched=0;const artwork=new Artwork({fetchImpl:()=>{fetched++;throw Error('must not fetch metadata');}});
  const first={mint:'So11111111111111111111111111111111111111112',image:'https://assets.example/creator-one.png'};
  const second={mint:'2'.repeat(32),image:'https://assets.example/creator-two.png'};
  assert.equal(artwork.get(first),first.image);assert.equal(artwork.get(second),second.image);
  assert.notEqual(artwork.get(first),artwork.get(second));
  artwork.loaded(first.mint,first.image);assert.equal(artwork.status(first.mint),'Artwork loaded');
  assert.equal(fetched,0);
  const choices=imageCandidates('ipfs://QmCreatorImage');
  assert.equal(choices[0],'https://ipfs.io/ipfs/QmCreatorImage');
  assert.ok(choices.some(url=>url.startsWith('/api/token-image?url=')));
  assert.ok(choices.includes('https://gateway.pinata.cloud/ipfs/QmCreatorImage'));
});
test('later creation metadata replaces an empty alert cache; browser lookup beats a stalled backend',async()=>{
  let finish,aborted=0;const calls=[],done=new Promise(resolve=>finish=resolve);
  const image='https://assets.example/actual-creator.png';
  const artwork=new Artwork({fetchImpl:(url,options)=>{
    calls.push(url);assert.equal(options.credentials,url.startsWith('/')?'same-origin':'omit');
    if(url.startsWith('/'))return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{aborted++;reject(Error('aborted'));},{once:true}));
    return Promise.resolve(new Response(JSON.stringify({imageUrl:{url:image}})));
  },onChange:()=>{if(artwork.cache.get('mint')?.url===image)finish();}});
  artwork.get({mint:'mint'});
  artwork.get({mint:'mint',uri:'ipfs://QmActualMetadata'});
  await done;
  assert.equal(artwork.get({mint:'mint'}),image);
  assert.equal(artwork.cache.get('mint').token.uri,'ipfs://QmActualMetadata');
  assert.ok(calls.includes('https://ipfs.io/ipfs/QmActualMetadata'));
  assert.ok(aborted>=1);assert.equal(artwork.active,0);
});
test('failed creator image tries proxy and equivalent CID gateways; stale errors cannot remove recovery',()=>{
  const artwork=new Artwork(),token={mint:'mint',image:'ipfs://QmCreatorImage'};
  const original=artwork.get(token);artwork.reject(token.mint,original);
  assert.match(artwork.get(token),/^\/api\/token-image/);
  artwork.reject(token.mint,artwork.get(token));
  const recovered=artwork.get(token);assert.equal(recovered,'https://gateway.pinata.cloud/ipfs/QmCreatorImage');
  artwork.reject(token.mint,original);assert.equal(artwork.get(token),recovered);
  artwork.loaded(token.mint,original);assert.notEqual(artwork.status(token.mint),'Artwork loaded');
  assert.ok(artwork.diagnostics(token.mint).attempts.some(a=>a.source==='Local image proxy'));
  artwork.retry(token.mint);assert.equal(artwork.get(token),original);
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
  await complete;assert.equal(artwork.get(token),'https://example.com/token.png');assert.equal(fetches,3);
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
