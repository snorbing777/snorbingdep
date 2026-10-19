const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[],sockets=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
   window.walletSubmissions=[];window.rejectWallet=false;
   const account={address:'So11111111111111111111111111111111111111112',publicKey:new Uint8Array(32),chains:['solana:mainnet'],features:['solana:signAndSendTransaction']};
   const wallet={name:'Phantom',version:'1.0.0',accounts:[],chains:['solana:mainnet'],features:{
     'standard:connect':{connect:async()=>({accounts:[account]})},
     'standard:events':{on:()=>()=>{}},
     'solana:signAndSendTransaction':{signAndSendTransaction:async input=>{walletSubmissions.push({chain:input.chain,bytes:Array.from(input.transaction),options:input.options});if(rejectWallet)throw Error('network failure');return [{signature:new Uint8Array(64).fill(3)}];}}
   }};
   window.addEventListener('wallet-standard:app-ready',event=>event.detail.register(wallet));
 });
 await page.routeWebSocket('wss://pumpportal.fun/api/data',ws=>{sockets.push(ws);ws.onMessage(()=>{});});
 const mint='11111111111111111111111111111111',now=Date.now()/1000;
 const report={mint,observed_at:now,status:'screen_blocked',eligible:false,score:78,checks:{liquidity:true,narrative_evidence:false},metrics:{liquidity_usd:80000,market_cap_usd:200000},scenario_100x_cap_usd:20000000,narrative:{reason:'No narrative measurements',sources:[]},sources:[],unknowns:['Creator intent'],thresholds:{min_age_minutes:30,max_age_hours:48,min_liquidity:50000,min_volume_5m:10000,min_buys_5m:30,min_buy_sell_ratio:1.5}};
 await page.route('**/api/analysis?*',route=>route.fulfill({json:report}));
 // Reproduce local resolver failure; the browser must fetch metadata itself.
 await page.route('**/api/artwork?*',route=>route.fulfill({status:503,json:{error:'resolver unavailable'}}));
 await page.route('https://ipfs.io/ipfs/TestMetadata',route=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"image":"https://images.example.com/recovered.png"}'}));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1kAAAAASUVORK5CYII=','base64');
 await page.route('https://images.example.com/recovered.png',async route=>{await new Promise(resolve=>setTimeout(resolve,600));await route.fulfill({contentType:'image/png',body:png});});
 let prepared=0;
 await page.route('**/api/manual/prepare',route=>{prepared++;const data=route.request().postDataJSON();return route.fulfill({json:{transaction:Buffer.from([0,1,2]).toString('base64'),...data,max_debit_sol:.015,slippage_percent:1,simulation_passed:true,expires_at:Date.now()/1000+30}});});
 await page.route('**/api/manual/status?*',route=>route.fulfill({json:{status:'confirmed'}}));
 await page.goto(process.env.DASHBOARD_URL||'http://127.0.0.1:8766');
 await page.getByText('Launch stream connected',{exact:true}).waitFor();
 sockets[0].send(JSON.stringify({txType:'create',mint,name:'Recovery fixture',symbol:'FIX',uri:'ipfs://TestMetadata'}));
 await page.waitForFunction(()=>document.querySelector('.token img')?.naturalWidth>0);
 await page.evaluate(()=>window.originalImage=document.querySelector('.token img'));
 sockets[0].send(JSON.stringify({txType:'create',mint:'2'.repeat(32),name:'Second fixture',symbol:'TWO'}));
 await page.waitForFunction(()=>document.querySelectorAll('.token').length===2);
 assert.equal(await page.evaluate(()=>originalImage===document.querySelector('[data-mint="11111111111111111111111111111111"] img')),true);
 await page.locator(`[data-mint="${mint}"]`).getByRole('button',{name:'Analyze runner potential'}).click();
 await page.getByText('Narrative and virality',{exact:true}).waitFor();
 assert.match(await page.locator('#research-body').textContent(),/No narrative measurements/);
 assert.match(await page.locator('#research-body').textContent(),/not a forecast/);
 assert.match(await page.locator('#research-body').textContent(),/20,000,000/);
 assert.match(await page.locator('#research-body').textContent(),/BLOCKED/);
 await page.locator('#close-research').click();
 await page.locator(`[data-mint="${mint}"]`).getByRole('button',{name:'Manual trade',exact:true}).click();
 await page.locator('#manual-connect').click();
 await page.waitForFunction(()=>!document.querySelector('#manual-prepare').disabled);
 assert.equal(prepared,0);assert.equal(await page.evaluate(()=>walletSubmissions.length),0);
 await page.locator('#manual-prepare').click();
 await page.waitForFunction(()=>!document.querySelector('#manual-submit').disabled);
 assert.equal(prepared,1);assert.equal(await page.evaluate(()=>walletSubmissions.length),0);
 assert.match(await page.locator('#manual-review').textContent(),/outside the automated/);
 await page.locator('#manual-submit').click();
 await page.waitForFunction(()=>document.querySelector('#manual-status').textContent.includes('transaction confirmed'));
 assert.match(await page.locator('#event-history').textContent(),/MANUAL TRADE CONFIRMED/);
 const submissions=await page.evaluate(()=>walletSubmissions);assert.equal(submissions.length,1);assert.deepEqual(submissions[0].bytes,[0,1,2]);assert.equal(submissions[0].options.skipPreflight,false);assert.equal(submissions[0].chain,'solana:mainnet');
 await page.evaluate(()=>window.rejectWallet=true);
 await page.locator('#manual-prepare').click();await page.waitForFunction(()=>!document.querySelector('#manual-submit').disabled);
 await page.locator('#manual-submit').click();await page.getByText('Submission outcome uncertain.',{exact:false}).waitFor();
 assert.equal(await page.locator('#manual-prepare').isDisabled(),true);
 assert.ok(await page.evaluate(()=>localStorage.getItem('signal-desk-manual-pending')));
 await page.reload();await page.locator('#connect-phantom').click();
 assert.equal(await page.locator('#manual-prepare').isDisabled(),true);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);await browser.close();
 console.log('PASS: browser metadata recovery, stable image nodes, transparent blocked research/100x arithmetic, Wallet Standard connection, explicit approval, no preparation broadcast, and uncertain-submit persistence. Mock providers and wallet only.');
})().catch(error=>{console.error(error);process.exit(1)});
