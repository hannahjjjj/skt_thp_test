'use strict';
(() => {
  const icons = {
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    store:'<path d="M3 10h18l-2-6H5l-2 6Z M4 10v10h16V10 M9 20v-6h6v6 M8 4l-1 6m9-6 1 6"/>',
    list:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    file:'<path d="M14 2H5v20h14V7l-5-5Z M14 2v6h5M8 12h8m-8 4h8"/>',
    download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    reset:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
    wallet:'<path d="M20 7H5a2 2 0 0 1 0-4h13v4M4 7v13h16V7 M20 11h-6v5h6"/><path d="M16 13.5h.1"/>',
    box:'<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10 9-5M12 12 3 7m9 5v10M7.5 4.5l9 5"/>',
    receipt:'<path d="M5 3h14v19l-3-2-4 2-4-2-3 2V3ZM8 7h8M8 11h8m-8 4h4"/>',
    chart:'<path d="M3 3v18h18M7 15l4-4 4 2 6-8m-5 0h5v5"/>',
    pie:'<path d="M10 3a9 9 0 1 0 11 11H10V3Z M14 2v8h8a9 9 0 0 0-8-8Z"/>',
    award:'<circle cx="12" cy="8" r="5"/><path d="m8 12-2 9 6-3 6 3-2-9"/>',
    search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
    spark:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7ZM20 2v4m-2-2h4"/>'
  };
  document.querySelectorAll('[data-icon]').forEach(el => {
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[el.dataset.icon] || ''}</svg>`;
  });
  const config = window.SALES_CONFIG || {mode:'demo'};
  const isDatabase = config.mode === 'supabase';
  let rows = isDatabase ? [] : (window.SALES_DATA?.rows || []);
  let source = null, currentUser = null, hasSnapshot = !isDatabase;
  const $ = id => document.getElementById(id);
  const fmt = n => new Intl.NumberFormat('ko-KR').format(n);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sum = (items, field) => items.reduce((n, r) => n + (r[field] ?? 0), 0);
  const colors = ['#3f8062','#89ad93','#bbcdb3','#dcc89d','#aabdd1'];
  const state = {month:'',region:'',store:'',product:'',excludeDuplicates:false,search:'',page:1,sort:'date',direction:-1,granularity:'month'};
  let filtered = [], tableRows = [];
  const pageSize = 10;
  const group = (items, field) => {
    const map = new Map();
    for (const row of items) {
      if (!map.has(row[field])) map.set(row[field], {name:row[field], revenue:0, quantity:0, count:0});
      const item = map.get(row[field]);
      item.revenue += row.revenue; item.quantity += row.quantity ?? 0; item.count++;
    }
    return [...map.values()].sort((a,b) => b.revenue-a.revenue || a.name.localeCompare(b.name,'ko'));
  };
  function options(id, values, label) {
    $(id).innerHTML = `<option value="">${label}</option>` + values.map(v => `<option value="${escape(v)}">${escape(v)}</option>`).join('');
  }
  const sortedUnique = field => [...new Set(rows.map(r=>r[field]))].sort((a,b)=>a.localeCompare(b,'ko'));
  function refreshOptions() {
    for (const field of ['region','product']) {
      const values=sortedUnique(field);
      if (!values.includes(state[field])) state[field]='';
      options(field,values,field==='region'?'전체 지역':'전체 상품군');
      $(field).value=state[field];
    }
    const months=[...new Set(rows.map(r=>r.date.slice(0,7)))].sort();
    if (!months.includes(state.month)) state.month='';
    $('month').innerHTML='<option value="">전체 기간</option>'+months.map(m=>`<option value="${m}">${m.slice(0,4)}년 ${Number(m.slice(5))}월</option>`).join('');
    $('month').value=state.month;
    storeOptions();
  }
  function storeOptions() {
    const values = [...new Set(rows.filter(r => !state.region || r.region === state.region).map(r => r.store))].sort((a,b) => a.localeCompare(b,'ko'));
    if (!values.includes(state.store)) state.store = '';
    options('store', values, '전체 매장');
    $('store').value = state.store;
  }
  function updateMetadata() {
    const dates=rows.map(r=>r.date).sort();
    const first=dates[0],last=dates.at(-1);
    const period=first?`${first.replaceAll('-','.')}–${last.replaceAll('-','.')}`:'조회된 판매 데이터 없음';
    const quarter=d=>`${d.slice(0,4)} Q${Math.ceil(Number(d.slice(5,7))/3)}`;
    $('heading-period').textContent=first?(quarter(first)===quarter(last)?quarter(first):`${first.slice(0,7)} – ${last.slice(0,7)}`):'';
    $('sidebar-period').textContent=first?quarter(last):'SALES';
    $('banner-period').textContent=first?`${first.slice(0,7).replace('-','.')} — ${last.slice(0,7).replace('-','.')}`:'—';
    $('banner-source').textContent=isDatabase?'DB 판매일 기준':'엑셀 샘플 기준';
    $('source-name').textContent=isDatabase?'Supabase 데이터':'엑셀 샘플 데이터';
    $('source-detail').textContent=isDatabase?`${config.schema}.${config.table}`:'매장판매실적.xlsx';
    $('footer-source').textContent=isDatabase?'Supabase · DB 변경 자동 반영':'엑셀 샘플 · 실시간 데이터 아님';
    $('data-source-guide').textContent=`출처: ${isDatabase?'Supabase DB':'매장판매실적.xlsx · Untitled 시트'} · ${period} · ${fmt(rows.length)}행`;
    const missing=rows.filter(r=>r.quantity===null).length;
    const duplicates=rows.filter(r=>r.duplicate).length;
    $('duplicate-count').textContent=duplicates;
    $('data-quality-guide').textContent=`날짜·지역명·금액 표기를 통일합니다. 수량 미입력 ${missing}건은 수량 합계에서만 제외하며 매출은 포함합니다. 모든 판매 항목이 같은 중복 의심 ${duplicates}행은 기본 포함하고 위 옵션으로 제외할 수 있습니다. 요금제 미입력은 ‘—’로 표시합니다.${isDatabase?' 로그인 계정의 읽기 권한에 해당하는 데이터만 표시하며, 변경 이벤트와 30초 주기 조회로 동기화합니다.':''}`;
  }
  function applyRows(nextRows) {rows=nextRows;refreshOptions();updateMetadata();render();}
  function render() {
    filtered = rows.filter(r => (!state.month || r.date.startsWith(state.month)) && (!state.region || r.region===state.region) && (!state.store || r.store===state.store) && (!state.product || r.product===state.product) && (!state.excludeDuplicates || !r.duplicate));
    const revenue = sum(filtered,'revenue');
    const quantity = sum(filtered,'quantity');
    const missing = filtered.filter(r => r.quantity === null).length;
    $('total-revenue').innerHTML = `${fmt(revenue)}<small>원</small>`;
    $('total-quantity').innerHTML = `${fmt(quantity)}<small>개</small>`;
    $('total-count').innerHTML = `${fmt(filtered.length)}<small>건</small>`;
    $('average-revenue').innerHTML = `${fmt(filtered.length ? Math.round(revenue/filtered.length) : 0)}<small>원</small>`;
    $('quantity-note').textContent = missing ? `수량 미입력 ${missing}건 제외` : '미입력 수량 없음';
    const dates = filtered.map(r=>r.date).sort();
    $('period-label').textContent = dates.length ? `${dates[0].replaceAll('-','.')} – ${dates.at(-1).replaceAll('-','.')}` : '해당 기간 데이터 없음';
    $('result-label').textContent = `${new Set(filtered.map(r=>r.store)).size}개 매장 · ${fmt(filtered.length)}건의 판매 내역`;
    const stores = group(filtered,'store');
    const top = stores[0];
    $('insight-title').textContent = top ? `${top.name}, 선택한 기간의 매출 1위` : '선택한 조건에 해당하는 판매가 없습니다';
    $('insight-description').textContent = top ? `${fmt(top.revenue)}원으로 전체 매출의 ${(revenue ? top.revenue / revenue * 100 : 0).toFixed(1)}%를 기록했어요. ${new Set(filtered.map(r=>r.region)).size}개 지역, ${stores.length}개 매장의 실적을 함께 살펴보세요.` : '기간이나 필터를 변경해 다른 판매 실적을 살펴보세요.';
    renderTrend(); renderProducts(revenue); renderStores(stores); renderRegions(revenue); renderTable();
    if(!hasSnapshot) for(const id of ['total-revenue','total-quantity','total-count','average-revenue']) $(id).textContent='—';
  }
  function renderTrend() {
    const monthKeys = state.month ? [state.month] : [...new Set(rows.map(r=>r.date.slice(0,7)))].sort();
    const keys = state.granularity === 'month' ? monthKeys : monthKeys.flatMap(m => {
      const [year,month] = m.split('-').map(Number);
      return Array.from({length:new Date(year,month,0).getDate()},(_,i)=>`${m}-${String(i+1).padStart(2,'0')}`);
    });
    const totals = new Map(keys.map(k=>[k,0]));
    filtered.forEach(r => { const k = state.granularity==='month' ? r.date.slice(0,7) : r.date; totals.set(k,(totals.get(k)||0)+r.revenue); });
    const values = keys.map(k=>totals.get(k));
    const max = Math.max(...values,1);
    const best = keys[values.indexOf(Math.max(...values))];
    const multiYear=new Set(keys.map(k=>k.slice(0,4))).size>1;
    const dateLabel = k => (multiYear?`${k.slice(0,4)}.`:'')+(state.granularity==='month' ? `${Number(k.slice(5,7))}월` : `${Number(k.slice(5,7))}/${Number(k.slice(8,10))}`);
    $('trend-caption').innerHTML = filtered.length ? `<span>가장 높은 매출 <strong>${dateLabel(best)}</strong></span><span>${state.granularity==='month'?'월별':'일별'} 합계 · <strong>${fmt(Math.max(...values))}원</strong></span>` : '<span>선택한 조건의 판매 데이터가 없습니다.</span>';
    if (!filtered.length) { $('trend-chart').innerHTML = '<div class="empty-chart">조건에 맞는 데이터가 없습니다.</div>'; return; }
    const W=640,H=240,left=57,right=24,top=25,bottom=36,plotH=H-top-bottom,plotW=W-left-right;
    const step=Math.pow(10,Math.floor(Math.log10(max/4)));
    const ceiling=Math.ceil(max/4/step)*step*4;
    const x=i=>keys.length===1 ? left+plotW/2 : left+i*plotW/(keys.length-1);
    const y=v=>H-bottom-v/ceiling*plotH;
    let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${state.granularity==='month'?'월별':'일별'} 매출 추이"><title>매출 추이: ${keys.map((k,i)=>`${dateLabel(k)} ${fmt(values[i])}원`).join(', ')}</title><defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6ea88b" stop-opacity=".23"/><stop offset="100%" stop-color="#6ea88b" stop-opacity=".01"/></linearGradient></defs>`;
    for(let i=0;i<=4;i++) {
      const value=ceiling*i/4, yy=y(value);
      svg+=`<line x1="${left}" y1="${yy}" x2="${W-right}" y2="${yy}" stroke="#eaf0ec" stroke-dasharray="3 4"/><text x="${left-13}" y="${yy+3}" text-anchor="end" fill="#a1acb3" font-size="10">${fmt(Math.round(value/10000))}</text>`;
    }
    const points=values.map((v,i)=>`${x(i)},${y(v)}`).join(' ');
    if (keys.length === 1) {
      svg+=`<rect x="${x(0)-40}" y="${y(values[0])}" width="80" height="${H-bottom-y(values[0])}" rx="4" fill="#8caf99"/>`;
    } else {
      svg+=`<polygon points="${left},${H-bottom} ${points} ${W-right},${H-bottom}" fill="url(#trend-fill)"/><polyline class="spark-line" points="${points}" fill="none" stroke="#4e8b6c" stroke-width="2.5"/>`;
    }
    const labelEvery=Math.max(1,Math.ceil(keys.length/6));
    keys.forEach((k,i)=>{
      if(i%labelEvery===0 || i===keys.length-1) svg+=`<text x="${x(i)}" y="${H-12}" text-anchor="middle" fill="#98a6ad" font-size="10">${dateLabel(k)}</text>`;
      const r=state.granularity==='month'?4:2;
      svg+=`<circle cx="${x(i)}" cy="${y(values[i])}" r="${r}" fill="#fff" stroke="#4e8b6c" stroke-width="2"><title>${dateLabel(k)} · ${fmt(values[i])}원</title></circle>`;
      if (state.granularity==='month') svg+=`<text x="${x(i)}" y="${y(values[i])-14}" text-anchor="middle" fill="#518169" font-size="10" font-weight="600">${fmt(Math.round(values[i]/10000))}만</text>`;
    });
    $('trend-chart').innerHTML=svg+'</svg>';
  }
  function renderProducts(revenue) {
    const groups=group(filtered,'product');
    if(!groups.length || revenue===0) { $('product-chart').innerHTML='<div class="empty-chart">표시할 매출액이 없습니다.</div>'; return; }
    const circumference=2*Math.PI*65;
    let offset=0;
    const circles=groups.map((g,i)=>{
      const length=g.revenue/revenue*circumference;
      const out=`<circle cx="80" cy="80" r="65" fill="none" stroke="${colors[i % colors.length]}" stroke-width="17" stroke-dasharray="${Math.max(0,length-3)} ${circumference-Math.max(0,length-3)}" stroke-dashoffset="${-offset}"><title>${escape(g.name)} · ${fmt(g.revenue)}원 (${(g.revenue/revenue*100).toFixed(1)}%)</title></circle>`;
      offset+=length;return out;
    }).join('');
    $('product-chart').innerHTML=`<div class="donut-wrap"><svg viewBox="0 0 160 160" role="img" aria-label="상품군별 매출 비중"><circle cx="80" cy="80" r="65" fill="none" stroke="#f2f5f2" stroke-width="17"/>${circles}</svg><div class="donut-center">매출 비중 1위<strong>${(groups[0].revenue/revenue*100).toFixed(1)}<span style="font-size:13px">%</span></strong><small>${escape(groups[0].name)}</small></div></div><div class="product-legend">${groups.map((g,i)=>`<div class="product-legend-row"><span class="color-dot" style="background:${colors[i % colors.length]}"></span><span>${escape(g.name)}</span><strong>${fmt(Math.round(g.revenue/10000))}만</strong><small>${(g.revenue/revenue*100).toFixed(1)}%</small></div>`).join('')}</div>`;
  }
  function renderStores(stores) {
    $('store-ranking').innerHTML=stores.length ? stores.slice(0,5).map((s,i)=>`<div class="ranking-row"><span class="ranking-number">${i+1}</span><span class="ranking-name">${escape(s.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${s.revenue/stores[0].revenue*100}%"></div></div><span class="ranking-value" title="${fmt(s.revenue)}원">${fmt(Math.round(s.revenue/10000))}<small> 만원</small></span></div>`).join('') : '<div class="empty-chart">조건에 맞는 매장이 없습니다.</div>';
  }
  function renderRegions(revenue) {
    const regions=group(filtered,'region');
    $('region-count').textContent=`${regions.length}개 지역`;
    $('region-body').innerHTML=regions.length ? regions.map(r=>`<tr><td>${escape(r.name)}</td><td>${fmt(r.revenue)}원</td><td><div class="region-share"><span class="bar-track"><span class="bar-fill" style="display:block;width:${(revenue?r.revenue/revenue*100:0)}%"></span></span><span>${((revenue?r.revenue/revenue*100:0)).toFixed(1)}%</span></div></td></tr>`).join('') : '<tr><td colspan="3" class="empty-row">조건에 맞는 데이터가 없습니다.</td></tr>';
  }
  function renderTable() {
    const query=state.search.trim().toLocaleLowerCase('ko');
    tableRows=filtered.filter(r=>!query || [r.store,r.staff,r.plan,r.product,r.region,r.date].some(v=>String(v??'').toLocaleLowerCase('ko').includes(query))).sort((a,b)=>{
      // Keep unknown quantities last in both directions.
      if(a[state.sort]===null) return b[state.sort]===null ? String(a.id).localeCompare(String(b.id),'en',{numeric:true}) : 1;
      if(b[state.sort]===null) return -1;
      const result=typeof a[state.sort]==='string' ? a[state.sort].localeCompare(b[state.sort]) : a[state.sort]-b[state.sort];
      return result*state.direction || String(a.id).localeCompare(String(b.id),'en',{numeric:true});
    });
    const pages=Math.max(1,Math.ceil(tableRows.length/pageSize));
    state.page=Math.max(1,Math.min(state.page,pages));
    const start=(state.page-1)*pageSize;
    $('table-count').textContent=`${fmt(tableRows.length)}건`;
    $('sales-body').innerHTML=tableRows.length ? tableRows.slice(start,start+pageSize).map(r=>`<tr><td>${r.date.replaceAll('-','.')}<small class="db-id" title="${escape(r.id)}">${isDatabase?`판매 ID ${escape(r.id)}`:`원본 ${escape(r.id)}행`}</small></td><td>${escape(r.region)}</td><td><strong>${escape(r.store)}</strong></td><td><span class="product-chip" data-product="${escape(r.product)}">${escape(r.product)}</span><small>${escape(r.plan||'—')}</small></td><td>${r.quantity===null?'<span title="원본 수량 미입력">—</span>':fmt(r.quantity)}</td><td>${fmt(r.revenue)}원</td><td>${escape(r.staff)}</td><td>${r.duplicate?'<span class="data-state warning">중복 의심</span>':''}${r.quantity===null?'<span class="data-state warning">수량 누락</span>':''}${!r.duplicate&&r.quantity!==null?'<span class="data-state">정상</span>':''}</td></tr>`).join('') : '<tr><td colspan="8" class="empty-row">검색 결과가 없습니다. 검색어나 필터를 변경해 주세요.</td></tr>';
    $('page-info').textContent=tableRows.length ? `전체 ${fmt(tableRows.length)}건 중 ${fmt(start+1)}–${fmt(Math.min(start+pageSize,tableRows.length))}건 표시` : '0건 표시';
    $('page-number').textContent=`${state.page} / ${pages}`;
    $('prev-page').disabled=state.page===1;
    $('next-page').disabled=state.page===pages;
    document.querySelectorAll('[data-sort]').forEach(b=>{
      const active=b.dataset.sort===state.sort;
      b.querySelector('span').textContent=active?(state.direction===1?'↑':'↓'):'↕';
      b.closest('th').setAttribute('aria-sort',active?(state.direction===1?'ascending':'descending'):'none');
    });
  }
  for(const field of ['month','region','store','product']) $(field).addEventListener('change',()=>{
    state[field]=$(field).value;state.page=1;
    if(field==='region') storeOptions();
    render();
  });
  $('exclude-duplicates').addEventListener('change',()=>{state.excludeDuplicates=$('exclude-duplicates').checked;state.page=1;render();});
  $('filters').addEventListener('submit',e=>e.preventDefault());
  $('filters').addEventListener('reset',e=>{
    e.preventDefault();
    for(const field of ['month','region','store','product']) {state[field]='';$(field).value='';}
    state.search='';$('search').value='';state.excludeDuplicates=false;$('exclude-duplicates').checked=false;state.page=1;
    storeOptions();render();
  });
  $('search').addEventListener('input',()=>{state.search=$('search').value;state.page=1;renderTable();});
  $('prev-page').addEventListener('click',()=>{state.page--;renderTable();});
  $('next-page').addEventListener('click',()=>{state.page++;renderTable();});
  document.querySelectorAll('[data-sort]').forEach(b=>b.addEventListener('click',()=>{state.direction=state.sort===b.dataset.sort?-state.direction:-1;state.sort=b.dataset.sort;state.page=1;renderTable();}));
  document.querySelectorAll('[data-granularity]').forEach(b=>b.addEventListener('click',()=>{
    state.granularity=b.dataset.granularity;
    document.querySelectorAll('[data-granularity]').forEach(btn=>{const selected=btn===b;btn.classList.toggle('selected',selected);btn.setAttribute('aria-pressed',selected);});
    renderTrend();
  }));
  let toastTimer;
  $('export').addEventListener('click',()=>{
    if(!tableRows.length) {showToast('다운로드할 판매 내역이 없습니다.');return;}
    // Neutralize spreadsheet formulas in free-text cells when exporting CSV.
    const csvCell=v=>`"${String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')}"`;
    const header=['판매일','지역','매장명','상품군','요금제','수량','매출액(원)','담당자',isDatabase?'판매 ID':'원본 행','중복 의심'];
    const content=[header,...tableRows.map(r=>[r.date,r.region,r.store,r.product,r.plan,r.quantity,r.revenue,r.staff,r.id,r.duplicate?'예':'아니오'])].map(r=>r.map(csvCell).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+content],{type:'text/csv;charset=utf-8;'}));
    const a=document.createElement('a');a.href=url;a.download=`매장판매실적_${state.month||'전체기간'}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast(`${fmt(tableRows.length)}건의 판매 내역을 다운로드했습니다.`);
  });
  function showToast(message) {clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
  document.querySelectorAll('[data-nav]').forEach(a=>a.addEventListener('click',()=>{document.querySelectorAll('[data-nav]').forEach(link=>link.classList.toggle('active',link===a));}));
  applyRows(rows);
  function updateStatus({kind,message,lastSync}) {
    const previousSnapshot=hasSnapshot;hasSnapshot=!isDatabase||Boolean(lastSync);
    if(previousSnapshot!==hasSnapshot)render();
    $('connection-status').dataset.kind=kind;
    $('connection-text').textContent=message;
    $('sync-notice').dataset.kind=kind;
    const syncTime=lastSync?new Intl.DateTimeFormat('ko-KR',{dateStyle:'short',timeStyle:'medium',timeZone:'Asia/Seoul'}).format(lastSync):null;
    $('sync-message').textContent=kind==='demo'?'현재 엑셀 샘플 데이터를 보고 있습니다. Supabase 연결 정보가 설정되면 DB 실적으로 전환됩니다.':`${message}${syncTime?` · 마지막 동기화 ${syncTime} (한국시간)`:''}${!rows.length&&lastSync?' · 조회 결과 0건: 데이터 유무와 계정의 읽기 권한을 확인해 주세요.':''}`;
    $('refresh-data').hidden=kind==='demo'||kind==='loading';
    if(!lastSync&&isDatabase) for(const id of ['total-revenue','total-quantity','total-count','average-revenue']) $(id).textContent='—';
    $('export').disabled=isDatabase&&!lastSync;
  }
  $('refresh-data').addEventListener('click',()=>source?.refresh());
  $('auth-button').addEventListener('click',async()=>{
    if(currentUser){
      $('auth-button').disabled=true;
      try{await source.signOut();showToast('로그아웃했습니다.');}catch(error){showToast(error.message);}finally{$('auth-button').disabled=false;}
    } else {$('auth-error').textContent='';$('auth-dialog').showModal();}
  });
  $('close-auth').addEventListener('click',()=>$('auth-dialog').close());
  $('auth-dialog').addEventListener('close',()=>$('auth-password').value='');
  $('auth-form').addEventListener('submit',async event=>{
    event.preventDefault();$('auth-submit').disabled=true;$('auth-error').textContent='';
    try{await source.signIn($('auth-email').value.trim(),$('auth-password').value);$('auth-dialog').close();}
    catch(error){$('auth-error').textContent=error.message;}
    finally{$('auth-submit').disabled=false;$('auth-password').value='';}
  });
  if(isDatabase){
    updateStatus({kind:'loading',message:'DB 데이터를 불러오는 중',lastSync:null});
    $('auth-button').hidden=false;
    try {
      source=window.SalesSource.connect(config,{
        onRows:applyRows,onStatus:updateStatus,
        onAuth:user=>{currentUser=user;$('auth-button').textContent=user?'로그아웃':'로그인';$('auth-button').title=user?.email||'판매 대시보드 로그인';}
      });
      window.addEventListener('pagehide',event=>{if(!event.persisted)source.stop();});
    } catch {updateStatus({kind:'error',message:'Supabase 연결 설정을 확인해 주세요.',lastSync:null});}
  } else updateStatus({kind:'demo',message:'엑셀 샘플 데이터',lastSync:null});
})();
