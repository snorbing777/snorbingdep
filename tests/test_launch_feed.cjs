const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Store,parseLaunch,Connection}=require('../launch_feed.js');
const mint='So11111111111111111111111111111111111111112';
const creation={txType:'create',mint,name:'Example',symbol:'EX',marketCapSol:30,solAmount:.1};

test('only valid creation events enter the feed; missing values stay unknown',()=>{
  assert.equal(parseLaunch({message:'subscribed'}),null);
  assert.equal(parseLaunch({...creation,txType:'buy'}),null);
  assert.equal(parseLaunch({...creation,mint:'javascript:alert(1)'}),null);
  const token=parseLaunch({...creation,marketCapSol:'NaN',solAmount:undefined},1000);
  assert.equal(token.marketCapSol,null);assert.equal(token.creatorSol,null);
  assert.equal(token.receivedAt,1000);
});
test('deduplicates tokens, bounds visible memory and counts bursts outside retained rows',()=>{
  const store=new Store(1);
  assert.ok(store.add(creation,1000));assert.equal(store.add(creation,2000),null);
  store.add({...creation,mint:'11111111111111111111111111111111'},3000);
  assert.equal(store.items.length,1);assert.equal(store.total,2);
  assert.equal(store.recentCount(5000),2);assert.equal(store.recentCount(65000),0);
});
test('filters names and addresses, age and cap without inventing quotes',()=>{
  const store=new Store();store.add(creation,1000);
  store.add({...creation,mint:'11111111111111111111111111111111',name:'Second',marketCapSol:99},5000);
  assert.equal(store.select({search:'EXAMPLE',now:6000}).length,1);
  assert.equal(store.select({search:mint,now:6000}).length,1);
  assert.equal(store.select({age:2,now:6000}).length,1);
  assert.equal(store.select({sort:'cap'})[0].name,'Second');
});
test('retains 1000 launches and removes the oldest only after capacity',()=>{
  const store=new Store();
  for(let i=0;i<1001;i++){
    let value=i,key='';do{key='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[value%58]+key;value=Math.floor(value/58);}while(value);
    store.add({...creation,mint:'1'.repeat(32-key.length)+key},i);
  }
  assert.equal(store.items.length,1000);assert.equal(store.total,1001);
  assert.equal(store.items.at(-1).receivedAt,1);
});

function fixture(){
  const sockets=[],statuses=[],tokens=[],timers=[];
  class Socket { constructor(url){this.url=url;this.sent=[];this.readyState=0;sockets.push(this);}send(x){this.sent.push(x);}close(){this.readyState=3;this.closed=true;this.onclose?.();} }
  const connection=new Connection({onToken:x=>tokens.push(x),onStatus:x=>statuses.push(x),WebSocketImpl:Socket,
    setTimer:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimer:()=>{}});
  return {connection,sockets,statuses,tokens,timers};
}
test('subscribes only to public new-token data, and a pause does not reconnect',()=>{
  const f=fixture();f.connection.start();f.connection.start();assert.equal(f.sockets.length,1);
  f.sockets[0].onopen();assert.deepEqual(JSON.parse(f.sockets[0].sent[0]),{method:'subscribeNewToken'});
  f.sockets[0].onmessage({data:JSON.stringify(creation)});assert.equal(f.tokens.length,1);
  f.connection.stop();assert.equal(f.statuses.at(-1).state,'paused');assert.equal(f.timers.length,0);
  f.sockets[0].onmessage({data:JSON.stringify(creation)});assert.equal(f.tokens.length,1);
});
test('reconnect marks lost coverage and ignores events from the replaced socket',()=>{
  const f=fixture();f.connection.start();const old=f.sockets[0];old.onopen();old.close();
  assert.equal(f.statuses.at(-1).state,'reconnecting');assert.equal(f.timers[0].delay,1000);
  f.timers[0].fn();f.sockets[1].onopen();assert.equal(f.statuses.at(-1).gap,true);
  old.onmessage({data:JSON.stringify(creation)});assert.equal(f.tokens.length,0);
});
test('provider rejection stops the stream without exposing raw provider content',()=>{
  const f=fixture();f.connection.start();f.sockets[0].onopen();
  f.sockets[0].onmessage({data:'{"error":"untrusted provider message"}'});
  assert.equal(f.statuses.at(-1).state,'provider_error');assert.equal(f.connection.stopped,true);
  assert.equal(f.tokens.length,0);assert.equal(f.timers.length,0);
});
test('trade subscriptions stay bounded, unsubscribe evicted tokens and restore after reconnect',()=>{
  const f=fixture();f.connection.start();f.sockets[0].readyState=1;f.sockets[0].onopen();
  f.connection.setTradeTokens([mint]);
  assert.deepEqual(JSON.parse(f.sockets[0].sent.at(-1)),{method:'subscribeTokenTrade',keys:[mint]});
  const second='11111111111111111111111111111111';f.connection.setTradeTokens([second]);
  assert.deepEqual(JSON.parse(f.sockets[0].sent.at(-2)),{method:'unsubscribeTokenTrade',keys:[mint]});
  f.sockets[0].close();f.timers[0].fn();f.sockets[1].onopen();
  assert.deepEqual(JSON.parse(f.sockets[1].sent.at(-1)),{method:'subscribeTokenTrade',keys:[second]});
  f.connection.setTradeTokens(Array.from({length:40},(_,i)=>'2'.repeat(31)+String.fromCharCode(65+i%20)));
  assert.ok(f.connection.tradeTokens.length<=25);
});
