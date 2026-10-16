const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const root = path.resolve(__dirname,'..');
const env = {...process.env,SUPABASE_URL:'https://salescope-test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_browser_test_only',SUPABASE_ANON_KEY:'',NEXT_PUBLIC_SUPABASE_URL:'',NEXT_PUBLIC_SUPABASE_ANON_KEY:'',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'',SUPABASE_SCHEMA:'public',SUPABASE_TABLE:'sales',SUPABASE_COLUMNS:''};
execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,env});
const server = spawn('python3',['-m','http.server','8766','--bind','127.0.0.1'],{cwd:path.join(root,'dist'),stdio:'ignore'});
let browser,checks=0;
function check(value,message){assert.ok(value,message);checks++;}
(async()=>{
  for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:8766')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let records=Array.from({length:1017},(_,i)=>({id:i+1,sale_date:i<500?'2026-09-15':'2026-10-16',region:'서울특별시',store:i<500?'강남점':'홍대점',product:i%2?'기기':'5G요금제',plan:null,quantity:1,revenue:1000+i,staff:'담당자'}));
  let requestCount=0,failRequests=false,authRequired=false,pages=[],sockets=[],serverCap=500;
  const sentHeaders=[];
  await page.route('https://salescope-test.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/rest/v1/sales'){
      requestCount++;sentHeaders.push(req.headers());
      if(failRequests){await route.fulfill({status:503,json:{message:'Database unavailable'}});return;}
      if(authRequired&&!req.headers().authorization?.includes('test-user-token')){await route.fulfill({status:401,json:{code:'42501',message:'Permission denied'}});return;}
      const range=req.headers().range?.split('-').map(Number);
      const offset=Number(url.searchParams.get('offset')||range?.[0]||0),limit=Math.min(serverCap,Number(url.searchParams.get('limit')||(range ? range[1]-range[0]+1 : 500)));
      pages.push(offset);
      await route.fulfill({status:200,headers:{'content-type':'application/json','access-control-allow-origin':'*','access-control-expose-headers':'content-range','content-range':`${offset}-${Math.min(offset+limit,records.length)-1}/${records.length}`},body:JSON.stringify(records.slice(offset,offset+limit))});return;
    }
    if(url.pathname==='/auth/v1/token'){
      const data=req.postDataJSON();
      if(data.password!=='correct-password'){await route.fulfill({status:400,json:{error:'invalid_grant',error_description:'Invalid credentials'}});return;}
      await route.fulfill({status:200,json:{access_token:'test-user-token',refresh_token:'test-refresh',token_type:'bearer',expires_in:3600,user:{id:'00000000-0000-0000-0000-000000000001',email:'reader@example.com',aud:'authenticated'}}});return;
    }
    if(url.pathname==='/auth/v1/logout'){await route.fulfill({status:204});return;}
    await route.fulfill({status:404,json:{message:'Not found'}});
  });
  await page.routeWebSocket('wss://salescope-test.supabase.co/**',ws=>{
    const socket={ws,topic:null,joinRef:null,active:true};sockets.push(socket);
    ws.onMessage(raw=>{
      const [joinRef,ref,topic,event,payload]=JSON.parse(raw.toString());
      if(event==='phx_join'){
        socket.topic=topic;socket.joinRef=joinRef;
        ws.send(JSON.stringify([joinRef,ref,topic,'phx_reply',{status:'ok',response:{postgres_changes:[{id:1,event:'*',schema:'public',table:'sales'}]}}]));
      }else if(event==='phx_leave'){socket.active=false;ws.send(JSON.stringify([joinRef,ref,topic,'phx_reply',{status:'ok',response:{}}]));}
      else if(event==='heartbeat')ws.send(JSON.stringify([joinRef,ref,topic,'phx_reply',{status:'ok',response:{}}]));
    });
    ws.onClose(()=>socket.active=false);
  });
  const metric=async id=>Number((await page.locator(id).innerText()).replace(/[^0-9]/g,''));
  const waitCount=async n=>{await page.waitForFunction(n=>Number(document.getElementById('total-count').textContent.replace(/[^0-9]/g,''))===n,n);};
  async function waitRevenue(amount){await page.waitForFunction(n=>Number(document.getElementById('total-revenue').textContent.replace(/[^0-9]/g,''))===n,amount);}
  function emit(type,record){
    const socket=sockets.filter(s=>s.active&&s.topic).at(-1);assert.ok(socket,'Realtime subscribed');
    socket.ws.send(JSON.stringify([socket.joinRef,null,socket.topic,'postgres_changes',{ids:[1],data:{schema:'public',table:'sales',commit_timestamp:new Date().toISOString(),type,columns:[],record:type==='DELETE'?{}:record,old_record:type==='DELETE'?record:{},errors:[]}}]));
  }
  await page.goto('http://127.0.0.1:8766');
  try { await waitCount(1017); } catch(error) { console.error({requestCount,pages,errors,status:await page.locator('#sync-message').innerText(),body:await page.locator('#total-count').innerText()});throw error;}
  await page.waitForFunction(()=>document.querySelector('#connection-status').dataset.kind==='live');
  check(pages.includes(0)&&pages.includes(500)&&pages.includes(1000),'Loads beyond Supabase default 1000 rows');
  check(await metric('#total-revenue')===records.reduce((n,r)=>n+r.revenue,0),'All DB rows included in totals');
  check(await page.locator('#month option').count()===3,'Periods generated from DB dates');
  check((await page.locator('#heading-period').innerText()).includes('2026-10'),'Quarter label no longer hardcoded');
  check(await page.locator('.region-table td').first().innerText()==='서울','DB region names normalized');
  check(sentHeaders.every(h=>h.apikey==='sb_publishable_browser_test_only'),'Official SDK sends public API key');
  check((await fs.readFile(path.join(root,'dist/index.html'),'utf8')).includes('data/sales.js')===false,'Live build does not load Excel samples');
  let row={id:1018,sale_date:'2026-11-02',region:'부산광역시',store:'서면점',product:'액세서리',plan:null,quantity:null,revenue:5000000,staff:'새 담당자'};
  records.push(row);emit('INSERT',row);
  await waitCount(1018);
  check(await page.locator('#month option[value="2026-11"]').count()===1,'Insert adds new month');
  check(await page.locator('#region option[value="부산"]').count()===1,'Insert adds new region');
  check(await page.locator('#store option[value="서면점"]').count()===1,'Insert adds new store');
  check((await page.locator('#quantity-note').innerText()).includes('1건'),'Null quantities reported');
  await page.selectOption('#store','서면점');await waitRevenue(5000000);
  check(await metric('#total-count')===1,'Filter works on live data');
  row={...row,revenue:7000000};records[records.length-1]=row;emit('UPDATE',row);
  await waitRevenue(7000000);
  check(await page.locator('#store').inputValue()==='서면점','Update preserves active filters');
  await page.locator('#search').fill('새 담당자');
  row={...row,revenue:8000000};records[records.length-1]=row;emit('UPDATE',row);await waitRevenue(8000000);
  check(await page.locator('#search').inputValue()==='새 담당자','Update preserves search');
  records.pop();emit('DELETE',row);await waitCount(1017);
  check(await page.locator('#store').inputValue()==='','Deleted store clears invalid filter');
  check(await page.locator('#store option[value="서면점"]').count()===0,'Deleted store removed');
  await page.getByRole('button',{name:'모든 필터 초기화'}).click();
  const oldRevenue=records.reduce((n,r)=>n+r.revenue,0);
  failRequests=true;emit('UPDATE',records[0]);
  await page.waitForFunction(()=>document.querySelector('#connection-status').dataset.kind==='error');
  check(await metric('#total-revenue')===oldRevenue,'Failed refresh preserves last successful snapshot');
  check((await page.locator('#sync-message').innerText()).includes('마지막 동기화'),'Failure displays last sync time');
  failRequests=false;await page.locator('#refresh-data').click();
  await page.waitForFunction(()=>document.querySelector('#connection-status').dataset.kind==='live');
  // A malformed row fails the whole refresh, rather than silently undercounting revenue.
  const validDate=records[0].sale_date;records[0].sale_date='2026-02-30';emit('UPDATE',records[0]);
  await page.waitForFunction(()=>document.querySelector('#connection-status').dataset.kind==='error');
  check(await metric('#total-revenue')===oldRevenue,'Malformed data does not replace snapshot');
  records[0].sale_date=validDate;await page.locator('#refresh-data').click();
  await page.waitForFunction(()=>document.querySelector('#connection-status').dataset.kind==='live');
  // Rejoin triggers reconciliation, even when no change event is received.
  let socket=sockets.filter(s=>s.active&&s.topic).at(-1);
  row={id:1018,sale_date:'2027-01-03',region:'경기도',store:'새매장',product:'기기',plan:null,quantity:2,revenue:999,staff:null};records.push(row);
  socket.ws.send(JSON.stringify([socket.joinRef,null,socket.topic,'phx_error',{}]));
  await waitCount(1018);
  check(await page.locator('#month option[value="2027-01"]').count()===1,'Reconnect loads changes missed while disconnected');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  for(const width of [360,390,768,1024]) {
    await page.setViewportSize({width,height:844});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Live UI fits ${width}px with multiple-year period`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'/tmp/salescope-live-mobile.png',fullPage:true});
  // Polling also reconciles if publication/events are not available.
  await page.clock.install();
  const before=requestCount;records.pop();
  await page.clock.runFor(31000);await waitCount(1017);
  check(requestCount>before,'30-second periodic reconciliation');
  serverCap=120;pages=[];await page.locator('#refresh-data').click();
  await page.waitForFunction(()=>document.querySelector('#connection-status').dataset.kind==='live');
  await page.waitForTimeout(300);
  check(pages.includes(120)&&pages.includes(960),'Respects projects with a smaller API row cap');
  serverCap=500;
  const saved=records;records=[];emit('DELETE',saved[0]);await waitCount(0);
  check(await metric('#total-revenue')===0,'Empty database displays zero, no sample fallback');
  check((await page.locator('#sync-message').innerText()).includes('조회 결과 0건'),'Empty result explains access scope');
  records=[{...saved[0],revenue:0}];emit('INSERT',records[0]);await waitCount(1);
  check(!(await page.locator('main').innerText()).includes('NaN'),'Zero revenue produces no NaN percentages');
  check((await page.locator('#product-chart').innerText()).includes('표시할 매출액이 없습니다'),'Zero revenue chart explained');
  records=saved;emit('INSERT',saved[0]);await waitCount(1017);

  // Test an actual Auth SDK session transition and ensure old-session data clears.
  authRequired=true;await page.reload();
  await page.waitForFunction(()=>document.querySelector('#connection-status').dataset.kind==='error');
  check((await page.locator('#total-revenue').innerText())==='—','Initial auth failure does not show sample or zero revenue');
  await page.getByRole('button',{name:'모든 필터 초기화'}).click();
  check((await page.locator('#total-revenue').innerText())==='—','Filters cannot turn an initial failure into zero metrics');
  await page.locator('#auth-button').click();
  await page.locator('#auth-email').fill('reader@example.com');await page.locator('#auth-password').fill('wrong-password');
  await page.locator('#auth-submit').click();
  await page.waitForFunction(()=>document.querySelector('#auth-error').textContent.length>0);
  check(await page.locator('#auth-dialog').isVisible(),'Login failure remains in dialog');
  await page.locator('#auth-password').fill('correct-password');await page.locator('#auth-submit').click();
  await waitCount(1017);
  check((await page.locator('#auth-button').innerText())==='로그아웃','Authenticated session supported');
  check(!(await page.locator('#auth-dialog').isVisible()),'Successful login closes dialog');
  await page.locator('#auth-button').click();
  await page.waitForFunction(()=>document.querySelector('#connection-status').dataset.kind==='error');
  check((await page.locator('#total-revenue').innerText())==='—','Logout clears data from previous account');
  check((await page.locator('#auth-button').innerText())==='로그인','Logout button state resets');
  check(errors.length===0,'No runtime errors: '+errors.join(','));
  console.log(`PASS: ${checks} Supabase browser checks using official SDK with mocked REST, Auth and Realtime transport. This does not validate the user project.`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill();});
