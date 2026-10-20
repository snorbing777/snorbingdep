const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1kAAAAASUVORK5CYII=','base64');
function mint(index){let value=index,key='';do{key='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[value%58]+key;value=Math.floor(value/58);}while(value);return '1'.repeat(32-key.length)+key;}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),sockets=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.routeWebSocket('wss://pumpportal.fun/api/data',ws=>{sockets.push(ws);ws.onMessage(()=>{});});
  await page.route('**/api/artwork?*',route=>{
   const address=new URL(route.request().url()).searchParams.get('mint');
   return route.fulfill({json:{image:'https://assets.example/'+address+'.png'}});
  });
  await page.route('https://assets.example/**',route=>{if(route.request().url().endsWith('/never.png'))return;return route.fulfill({contentType:'image/png',body:png});});
  await page.goto(process.env.DASHBOARD_URL||'http://127.0.0.1:8766');
  await page.getByText('Launch stream connected',{exact:true}).waitFor();await page.locator('#auto-research').uncheck();
  const stuck=mint(2000);
  sockets[0].send(JSON.stringify({txType:'create',mint:stuck,name:'Stalled image',symbol:'WAIT',image:'https://assets.example/never.png'}));
  const recovered=page.locator(`[data-mint="${stuck}"] img`);
  await page.waitForFunction(address=>document.querySelector(`[data-mint="${address}"] img`)?.src==='https://assets.example/'+address+'.png'&&document.querySelector(`[data-mint="${address}"] img`).naturalWidth>0,stuck);
  assert.match(await recovered.getAttribute('src'),new RegExp(stuck));
  const make=i=>({txType:'create',mint:mint(i),name:'Creation '+i,symbol:'NEW'+i,image:'https://assets.example/'+mint(i)+'.png'});
  for(let i=1;i<=75;i++)sockets[0].send(JSON.stringify(make(i)));
  await page.waitForFunction(()=>document.querySelectorAll('.token').length===76);
  assert.equal(await page.getByRole('button',{name:'Show more',exact:true}).count(),0);
  for(let i=76;i<=1001;i++)sockets[0].send(JSON.stringify(make(i)));
  await page.waitForFunction(()=>document.querySelectorAll('.token').length===1000);
  assert.match(await page.locator('#retained').textContent(),/Showing 1000 of 1000/);
  assert.equal(await page.locator('.token').first().getAttribute('data-mint'),mint(1001));
  assert.equal(await page.locator('.token').last().getAttribute('data-mint'),mint(2));
  const first=page.locator('.token').first();await first.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('.token img')?.naturalWidth>0);
  assert.equal(await first.locator('img').getAttribute('src'),'https://assets.example/'+mint(1001)+'.png');
  const last=page.locator('.token').last();await last.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('.token:last-child img')?.naturalWidth>0);
  assert.equal(await last.locator('img').getAttribute('src'),'https://assets.example/'+mint(2)+'.png');
  await page.locator('#search').fill('no token matches this');assert.equal(await page.locator('.token').count(),0);
  await page.locator('#show-all').click();assert.equal(await page.locator('.token').count(),1000);
  assert.deepEqual(errors,[]);
  console.log('PASS: stalled image recovers after a deadline, 1000 received creations render without pagination, oldest eviction is correct and first/last cards load their distinct metadata image URLs. Fixtures only.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
