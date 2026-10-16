'use strict';
// Read-only Supabase adapter. Application rendering is kept independent of transport.
window.SalesSource = (() => {
  const REGION_PREFIXES = ['서울','경기','부산','인천','대구','광주','대전'];
  function normalize(records, columns) {
    const seen = new Set();
    const ids = new Set();
    const number = (value, label, nullable=false) => {
      if (value === null || value === undefined || value === '') {
        if (nullable) return null;
        throw new Error(`${label} 값이 비어 있습니다.`);
      }
      const result = typeof value === 'number' ? value : Number(String(value).replace(/[,원\s]/g,''));
      if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${label}은 0 이상의 정수여야 합니다.`);
      return result;
    };
    const normalized = records.map(record => {
      const read = key => record[columns[key]];
      const id = read('id');
      if (!['string','number'].includes(typeof id) || (typeof id === 'number' && !Number.isSafeInteger(id)) || String(id).trim() === '' || ids.has(String(id))) throw new Error('고유한 판매 ID 컬럼이 필요합니다.');
      ids.add(String(id));
      const raw = read('date');
      let date = String(raw ?? '').trim();
      if (/^\d{8}$/.test(date)) date = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
      else if (/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(date)) date=date.split('.').map((s,i)=>i?s.padStart(2,'0'):s).join('-');
      if (/^\d{4}-\d{2}-\d{2}T/.test(date)) date=date.slice(0,10);
      const parsed = new Date(date+'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10)!==date) throw new Error('판매일 날짜 형식을 확인하세요.');
      const text = key => {
        const value=read(key);
        if (typeof value!=='string' || !value.trim()) throw new Error(`${key} 컬럼이 비어 있습니다.`);
        return value.trim();
      };
      const rawRegion = text('region');
      const item={id,date,region:REGION_PREFIXES.find(r=>rawRegion.startsWith(r))||rawRegion,
        store:text('store'),product:text('product'),plan:read('plan')==null?null:String(read('plan')).trim()||null,
        quantity:number(read('quantity'),'수량',true),revenue:number(read('revenue'),'매출'),staff:read('staff')==null?'—':String(read('staff'))};
      const signature=JSON.stringify([item.date,item.region,item.store,item.product,item.plan,item.quantity,item.revenue,item.staff]);
      item.duplicate=seen.has(signature);seen.add(signature);
      return item;
    });
    for(const key of ['revenue','quantity']) if(!Number.isSafeInteger(normalized.reduce((n,r)=>n+(r[key]||0),0))) throw new Error('집계 범위를 초과했습니다.');
    return normalized;
  }
  function connect(config, {onRows,onStatus,onAuth}) {
    const client=window.SalesSupabase.createClient(config.url,config.publicKey,{db:{schema:config.schema},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
    let stopped=false,channel=null,inFlight=false,pending=false,generation=0,controller=null;
    let subscribed=false,lastSync=null,timer=null,debounce=null,sessionUser=null,dataError=null;
    const status=(kind,message)=>{
      if(stopped)return;
      // Transport recovery cannot clear a failed database read. Only a successful read can.
      if(dataError && ['live','polling'].includes(kind))onStatus({kind:'error',message:dataError,lastSync});
      else onStatus({kind,message,lastSync});
    };
    function errorMessage(error) {
      if (['42501','PGRST301','PGRST302'].includes(error?.code) || [401,403].includes(error?.status)) return '읽기 권한이 없습니다. 로그인하거나 DB 접근 정책을 확인해 주세요.';
      if (error?.code === '42P01' || error?.code === 'PGRST205') return '판매 테이블을 찾을 수 없습니다. 연결 설정을 확인해 주세요.';
      if (error?.code === 'INVALID_SALES_DATA') return 'DB의 판매일·수량·매출·필수 컬럼 형식을 확인해 주세요.';
      if (error?.code === 'DATASET_TOO_LARGE') return '데이터가 너무 많습니다. 서버 집계가 필요합니다.';
      if (error?.code === '42703' || error?.code === 'PGRST204') return '판매 컬럼 설정이 DB 구조와 다릅니다.';
      return '데이터를 동기화하지 못했습니다. 연결과 읽기 권한을 확인해 주세요.';
    }
    async function load() {
      if(stopped)return;
      if(!navigator.onLine){status('offline','오프라인 · 마지막 동기화 데이터');return;}
      if(inFlight){pending=true;return;}
      inFlight=true;pending=false;
      const version=generation;
      controller=new AbortController();
      const signal=controller.signal;
      if(!lastSync)status('loading','DB 데이터를 불러오는 중');
      try {
        // Keep the primary-key order stable, and load every page (Supabase defaults to 1,000).
        const records=[];
        const pageSize=500;
        let total=null;
        for(let offset=0;;) {
          const {data,error,count,status:httpStatus}=await client.from(config.table)
            .select([...new Set(Object.values(config.columns))].map(c=>`"${c}"`).join(','),{count:'exact'})
            .order(config.columns.id,{ascending:true}).range(offset,offset+pageSize-1).abortSignal(signal);
          if(error)throw Object.assign(new Error('Query failed'),{code:error.code,status:httpStatus});
          if(!Array.isArray(data) || !Number.isInteger(count))throw new Error('Expected exact row count');
          if(total===null)total=count;
          // A concurrent insert/delete during paging invalidates the snapshot; retry it.
          if(total!==count){pending=true;return;}
          records.push(...data);
          if(records.length>=total)break;
          if(!data.length)throw new Error('Incomplete result');
          offset+=data.length;
          if(records.length>=100000)throw Object.assign(new Error('Dataset too large'),{code:'DATASET_TOO_LARGE'});
        }
        if(records.length!==total)throw new Error('Incomplete result');
        let normalized;
        try {normalized=normalize(records,config.columns);}
        catch {throw Object.assign(new Error('Invalid sales data'),{code:'INVALID_SALES_DATA'});}
        if(stopped || version!==generation)return;
        dataError=null;lastSync=new Date();onRows(normalized);status(subscribed?'live':'polling',subscribed?'실시간 연결':'자동 동기화 · 실시간 재연결 중');
      } catch(error) {
        if(stopped || version!==generation)return;
        dataError=errorMessage(error);status('error',dataError);
      } finally {
        inFlight=false;
        if(pending&&!stopped){pending=false;clearTimeout(debounce);debounce=setTimeout(load,150);}
      }
    }
    function schedule(){if(stopped)return;clearTimeout(debounce);debounce=setTimeout(load,120);}
    function restart(session) {
      if(stopped)return;
      generation++;controller?.abort();lastSync=null;subscribed=false;dataError=null;
      sessionUser=session?.user?.id||null;status('loading','DB 데이터를 불러오는 중');onRows([]);onAuth(session?.user||null);
      if(channel)client.removeChannel(channel);
      const current=generation;
      channel=client.channel(`sales-dashboard-${current}`)
        .on('postgres_changes',{event:'*',schema:config.schema,table:config.table},schedule)
        .subscribe(event=>{
          if(stopped||current!==generation)return;
          subscribed=event==='SUBSCRIBED';
          if(subscribed){schedule();if(lastSync)status('live','실시간 연결');}
          else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(event))status('polling','실시간 재연결 중 · 30초마다 동기화');
        });
      load();
    }
    client.auth.getSession().then(({data,error})=>{
      if(stopped)return;
      if(error){status('error','로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.');return;}
      restart(data.session);
    }).catch(()=>status('error','로그인 세션을 확인하지 못했습니다.'));
    const {data:{subscription:authSubscription}}=client.auth.onAuthStateChange((event,session)=>{
      if(event==='INITIAL_SESSION')return;
      // Defer SDK calls until the auth callback has released its internal lock.
      setTimeout(()=>{if(!stopped&&(sessionUser!==(session?.user?.id||null)||event==='SIGNED_OUT'))restart(session);},0);
    });
    timer=setInterval(()=>{if(document.visibilityState!=='hidden')load();},30000);
    const online=()=>schedule();
    const offline=()=>status('offline','오프라인 · 마지막 동기화 데이터');
    const visible=()=>{if(document.visibilityState==='visible')schedule();};
    window.addEventListener('online',online);window.addEventListener('offline',offline);document.addEventListener('visibilitychange',visible);
    return {
      refresh:()=>load(),
      signIn:async(email,password)=>{const {error}=await client.auth.signInWithPassword({email,password});if(error)throw new Error('이메일·비밀번호 또는 로그인 권한을 확인해 주세요.');},
      signOut:async()=>{const {error}=await client.auth.signOut();if(error)throw new Error('로그아웃하지 못했습니다. 다시 시도해 주세요.');},
      stop:()=>{stopped=true;generation++;controller?.abort();clearInterval(timer);clearTimeout(debounce);authSubscription.unsubscribe();if(channel)client.removeChannel(channel);client.auth.stopAutoRefresh();window.removeEventListener('online',online);window.removeEventListener('offline',offline);document.removeEventListener('visibilitychange',visible);}
    };
  }
  return {connect,normalize};
})();
