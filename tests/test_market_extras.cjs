const {test}=require('node:test');
const assert=require('node:assert/strict');
const {imageURL,metadataURL,Artwork,WhaleTracker,Sounds}=require('../market_extras.js');
test('images use public HTTPS URLs and metadata uses known gateways',()=>{
  assert.equal(imageURL('ipfs://QmExample'),'https://ipfs.io/ipfs/QmExample');
  assert.equal(imageURL('ar://example'),'https://arweave.net/example');
  for(const url of ['javascript:alert(1)','http://example.com/a.png','https://127.0.0.1/a','https://[::1]/a','https://foo.local/a','https://user:secret@example.com/a'])assert.equal(imageURL(url),null);
  assert.equal(metadataURL('https://untrusted.example/metadata.json'),null);
  assert.ok(metadataURL('https://ipfs.io/ipfs/QmExample'));
});
test('metadata loads once, uses no credentials and failed artwork has fallback',async()=>{
  let fetches=0,changed;const complete=new Promise(resolve=>changed=resolve);
  const artwork=new Artwork({fetchImpl:async(url,options)=>{fetches++;assert.equal(options.credentials,'omit');return new Response(JSON.stringify({image:'https://example.com/token.png'}));},onChange:changed});
  const token={mint:'token',uri:'ipfs://QmExample'};
  assert.equal(artwork.get(token),null);assert.equal(artwork.get(token),null);
  await complete;assert.equal(artwork.get(token),'https://example.com/token.png');assert.equal(fetches,1);
  artwork.reject(token.mint);assert.equal(artwork.get(token),null);
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
