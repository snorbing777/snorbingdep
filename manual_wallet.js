(function(){
  'use strict';
  const $=id=>document.getElementById(id),wallets=new Set();let wallet=null,account=null,plan=null,busy=false,pending=null,revision=0;
  try{pending=JSON.parse(localStorage.getItem('signal-desk-manual-pending'));}catch(_){}
  const notice=text=>{$('manual-status').textContent=text;};
  function persist(value){pending=value;let saved=true;try{if(value)localStorage.setItem('signal-desk-manual-pending',JSON.stringify(value));else localStorage.removeItem('signal-desk-manual-pending');}catch(_){saved=false;}update();return saved;}
  function update(){
    $('phantom-address').textContent=account?.address||'No manual wallet connected';
    $('manual-prepare').disabled=busy||!account||Boolean(pending);
    $('manual-submit').disabled=busy||!account||!plan||Date.now()/1000>plan.expires_at||Boolean(pending);
    document.querySelectorAll('.manual-form input,.manual-form select').forEach(input=>input.disabled=busy);
    $('manual-recover').classList.toggle('hidden',!pending);
    if(pending){$('manual-signature').textContent=pending.signature||'Submission outcome unknown. Check Phantom activity before retrying.';if(pending.signature){$('manual-signature').href='https://solscan.io/tx/'+encodeURIComponent(pending.signature);$('manual-signature').target='_blank';$('manual-signature').rel='noopener noreferrer';}}
    else{$('manual-signature').textContent='';$('manual-signature').removeAttribute('href');}
  }
  function register(...items){items.forEach(w=>wallets.add(w));return()=>items.forEach(w=>wallets.delete(w));}
  const api=Object.freeze({register});
  window.addEventListener('wallet-standard:register-wallet',event=>{if(typeof event.detail==='function')event.detail(api);});
  class Ready extends Event{get detail(){return api;}constructor(){super('wallet-standard:app-ready');}}
  window.dispatchEvent(new Ready());
  async function connect(){
    wallet=[...wallets].find(w=>w.name==='Phantom'&&w.features?.['standard:connect']&&w.features?.['solana:signAndSendTransaction']);
    if(!wallet){notice('Phantom Wallet Standard not detected. Open this app in Chrome or Brave with the current Phantom extension installed and unlocked, then reload.');return;}
    try{const result=await wallet.features['standard:connect'].connect();account=result.accounts.find(a=>a.chains.includes('solana:mainnet')&&a.features.includes('solana:signAndSendTransaction'));if(!account)throw Error('account');plan=null;revision++;notice('Phantom connected for manual Solana trades. Each trade requires approval. Use the same wallet account you use on pump.fun.');
      wallet.features['standard:events']?.on('change',properties=>{if(properties.accounts){account=properties.accounts.find(a=>a.chains.includes('solana:mainnet')&&a.features.includes('solana:signAndSendTransaction'))||null;plan=null;revision++;update();}});
    }catch(_){notice('Connection cancelled or no supported Solana account was returned.');}update();
  }
  function open(mint){if(!busy){if(mint)$('manual-mint').value=mint;plan=null;revision++;$('manual-review').textContent='Prepare an order to review its mint, amount and debit allowance. A preparation sends nothing.';}if(!$('manual-dialog').open)$('manual-dialog').showModal();update();}
  $('connect-phantom').onclick=()=>{open();connect();};$('manual-connect').onclick=connect;$('close-manual').onclick=()=>$('manual-dialog').close();
  $('manual-disconnect').onclick=async()=>{try{await wallet?.features['standard:disconnect']?.disconnect();}catch(_){}account=null;plan=null;revision++;update();notice('Manual wallet disconnected.');};
  $('manual-side').onchange=()=>{$('buy-amount-row').classList.toggle('hidden',$('manual-side').value!=='buy');$('sell-amount-row').classList.toggle('hidden',$('manual-side').value!=='sell');plan=null;revision++;update();};
  for(const id of ['manual-mint','manual-sol','manual-percent'])$(id).oninput=()=>{plan=null;revision++;update();};
  $('manual-prepare').onclick=async()=>{
    if(!account||pending||busy)return;busy=true;plan=null;update();notice('Building and simulating an unsigned trade. Nothing is being submitted.');
    const version=revision,owner=account.address,body={owner,mint:$('manual-mint').value.trim(),side:$('manual-side').value,amount_sol:$('manual-sol').value,percent:Number($('manual-percent').value)},controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
    try{const response=await fetch('/api/manual/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal}),data=await response.json();if(!response.ok){notice(data.error||'Preparation failed.');return;}if(account?.address!==owner||revision!==version){notice('Wallet or order changed; prepare again.');return;}plan=data;
      $('manual-review').textContent=`${data.side.toUpperCase()} · ${data.mint}\nWallet: ${data.owner}\n${data.side==='buy'?data.amount_sol+' SOL; simulated total debit allowance ≤'+data.max_debit_sol+' SOL including rent and fees':data.percent+'% of this token balance'}\nSlippage setting: ${data.slippage_percent}%. Simulation passed; actual execution can differ. Expires in 30 seconds. Manual orders are outside the automated $2 entry / $15 daily stop controls.`;notice('Review these details, then choose Approve in Phantom.');
    }catch(_){notice('Preparation connection failed. No request to sign or submit was made.');}finally{clearTimeout(timer);busy=false;update();}
  };
  function base58(bytes){let n=0n;for(const b of bytes)n=n*256n+BigInt(b);let text='';while(n){text='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[Number(n%58n)]+text;n/=58n;}for(const b of bytes){if(b!==0)break;text='1'+text;}return text;}
  async function checkPending(){if(!pending?.signature)return;try{const response=await fetch('/api/manual/status?owner='+encodeURIComponent(pending.owner)+'&signature='+encodeURIComponent(pending.signature)),data=await response.json();if(!response.ok)return;notice('Manual transaction: '+data.status+'. Signature: '+pending.signature);if(['confirmed','finalized','failed'].includes(data.status)){const signature=pending.signature;window.DeskAlerts?.publish({id:'manual:trade:'+signature,time:Date.now()/1000,type:data.status==='failed'?'warning':'trade',kind:data.status==='failed'?'warning':'entry',source:'manual',mint:pending.mint,title:data.status==='failed'?'MANUAL TRANSACTION FAILED':'MANUAL TRADE CONFIRMED',detail:pending.mint+' · '+signature+' · Verify balances in Phantom.'});persist(null);notice('Manual transaction '+data.status+': '+signature+'. Verify balances in Phantom.');}else setTimeout(checkPending,4000);}catch(_){notice('Confirmation unavailable. Check Phantom activity and the public signature; do not blindly retry.');}}
  $('manual-submit').onclick=async()=>{
    if(!plan||!account||busy||pending||Date.now()/1000>plan.expires_at)return;
    if(plan.owner!==account.address){plan=null;update();return;}busy=true;update();if(!persist({owner:account.address,mint:plan.mint,created_at:Date.now()})){busy=false;notice('Browser storage is unavailable. Enable local site storage before submitting; no wallet request was made.');update();return;}notice('Review the real transaction in Phantom. Only approve if the mint, amount and fees match.');
    try{const bytes=Uint8Array.from(atob(plan.transaction),c=>c.charCodeAt(0));const [result]=await wallet.features['solana:signAndSendTransaction'].signAndSendTransaction({account,chain:'solana:mainnet',transaction:bytes,options:{commitment:'confirmed',skipPreflight:false,maxRetries:2}});
      if(!(result?.signature instanceof Uint8Array)||result.signature.length!==64)throw Error('signature');persist({...pending,signature:base58(result.signature)});notice('Submitted through Phantom; checking confirmation.');checkPending();
    }catch(error){if(error?.code===4001){persist(null);notice('You rejected the Phantom request.');}else notice('Submission outcome uncertain. Check Phantom activity before clearing the pending flag or trying again.');}
    finally{plan=null;busy=false;update();}
  };
  $('manual-recover').onclick=()=>{if(confirm('Check Phantom activity and the transaction on-chain first. Clear this flag only when you have established the outcome. Clear the pending flag?')){persist(null);notice('Pending flag cleared after your review. Prepare a fresh order if needed.');}};
  setInterval(update,1000);update();if(pending?.signature)checkPending();window.ManualWallet={open};
})();
