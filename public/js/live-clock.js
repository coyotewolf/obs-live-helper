(function(){
  const CLOCK_KEY='obsHelperLiveClock';
  const CONFIG_KEY='obsHelperOverlayConfigCache';
  const channel=new BroadcastChannel('obs-helper-overlay-config');
  const defaults={label:'LIVE',timezone:'Asia/Taipei',hour12:false,scale:1,timeSize:'56px',dateSize:'18px',backgroundAlpha:.72};
  let config=readConfig();
  let lastServerUpdatedAt=0;

  function clamp(value, fallback, min, max){
    const n = Number(value);
    if(!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function readConfig(){
    try{return normalize(JSON.parse(localStorage.getItem(CLOCK_KEY)||'{}'))}
    catch{return {...defaults}}
  }

  function normalize(raw={}){
    return {
      ...defaults,
      ...raw,
      scale: clamp(raw.scale, defaults.scale, .3, 3),
      backgroundAlpha: clamp(raw.backgroundAlpha, defaults.backgroundAlpha, 0, 1),
      label:String(raw.label||defaults.label),
      timezone:String(raw.timezone||defaults.timezone),
      hour12:Boolean(raw.hour12),
      timeSize:String(raw.timeSize||defaults.timeSize),
      dateSize:String(raw.dateSize||defaults.dateSize)
    };
  }

  function applyQueryOverrides(){
    const qs=new URLSearchParams(location.search);
    if(qs.has('scale'))config.scale=Number(qs.get('scale'));
    if(qs.has('timeSize'))config.timeSize=qs.get('timeSize');
    if(qs.has('dateSize'))config.dateSize=qs.get('dateSize');
    if(qs.has('label'))config.label=qs.get('label');
    if(qs.has('tz'))config.timezone=qs.get('tz');
    if(qs.has('hour12'))config.hour12=qs.get('hour12')==='true';
    if(qs.has('alpha'))config.backgroundAlpha=clamp(qs.get('alpha'), config.backgroundAlpha, 0, 1);
  }

  function applyStyle(){
    document.documentElement.style.setProperty('--scale',config.scale);
    document.documentElement.style.setProperty('--time-size',config.timeSize);
    document.documentElement.style.setProperty('--date-size',config.dateSize);
    document.documentElement.style.setProperty('--clock-alpha',config.backgroundAlpha);
    document.getElementById('liveTag').textContent=config.label||'LIVE';
  }

  const timeEl=document.getElementById('time');
  const dateEl=document.getElementById('date');
  const liveTag=document.getElementById('liveTag');
  const weekdayMap={Sunday:'Sun',Monday:'Mon',Tuesday:'Tue',Wednesday:'Wed',Thursday:'Thu',Friday:'Fri',Saturday:'Sat'};

  function pad(n){return n<10?'0'+n:String(n)}

  function render(){
    const now=new Date();
    const tz=config.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
    let parts;
    try{
      const fmt=new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:Boolean(config.hour12)});
      parts=fmt.formatToParts(now).reduce((acc,part)=>{acc[part.type]=part.value;return acc},{});
    }catch{
      config.timezone='UTC';
      parts=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:Boolean(config.hour12)}).formatToParts(now).reduce((acc,part)=>{acc[part.type]=part.value;return acc},{});
    }

    timeEl.textContent=`${parts.hour}:${parts.minute}:${parts.second}${config.hour12&&parts.dayPeriod?' '+parts.dayPeriod.toUpperCase():''}`;
    const d=new Date(now.toLocaleString('en-US',{timeZone:config.timezone||'UTC'}));
    const mm=pad(d.getMonth()+1);
    const dd=pad(d.getDate());
    const weekday=weekdayMap[new Intl.DateTimeFormat('en-US',{timeZone:config.timezone||'UTC',weekday:'long'}).format(d)]||'---';
    dateEl.textContent=`${mm}/${dd} ${weekday}`;
  }

  function applyConfig(clock,updatedAt=0){
    config=normalize(clock);
    applyQueryOverrides();
    if(updatedAt)lastServerUpdatedAt=updatedAt;
    localStorage.setItem(CLOCK_KEY,JSON.stringify(config));
    applyStyle();
    render();
  }

  async function fetchSharedConfig(){
    try{
      const res=await fetch('/api/overlay-config?_t='+Date.now(),{cache:'no-store'});
      const data=await res.json();
      if(!data?.ok||!data.config?.clock)return;
      const updatedAt=Number(data.config.updatedAt||0);
      localStorage.setItem(CONFIG_KEY,JSON.stringify(data.config));
      if(updatedAt>=lastServerUpdatedAt){
        applyConfig(data.config.clock,updatedAt);
      }
    }catch(err){}
  }

  applyQueryOverrides();
  applyStyle();
  render();
  setInterval(render,1000);

  let glow=false;
  setInterval(()=>{
    glow=!glow;
    if(glow){
      liveTag.style.boxShadow='0 0 12px var(--accent-glow), 0 0 24px var(--accent-glow)';
      liveTag.style.color='#ffffff';
      liveTag.style.borderColor='var(--accent-pink)';
    }else{
      liveTag.style.boxShadow='none';
      liveTag.style.color='var(--accent-pink)';
      liveTag.style.borderColor='var(--accent-pink)';
    }
  },1000);

  channel.addEventListener('message',event=>{
    if(event.data?.type!=='overlay-config-change'||!event.data.clock)return;
    applyConfig(event.data.clock);
  });

  fetchSharedConfig();
  setInterval(fetchSharedConfig,1000);
})();
