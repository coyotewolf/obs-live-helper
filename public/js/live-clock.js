(function(){
  const CLOCK_KEY='obsHelperLiveClock';
  const channel=new BroadcastChannel('obs-helper-overlay-config');
  const defaults={label:'LIVE',timezone:'Asia/Taipei',hour12:false,scale:1,timeSize:'56px',dateSize:'18px'};
  let config=readConfig();
  function readConfig(){try{return {...defaults,...JSON.parse(localStorage.getItem(CLOCK_KEY)||'{}')}}catch{return {...defaults}}}
  function applyQueryOverrides(){const qs=new URLSearchParams(location.search);if(qs.has('scale'))config.scale=Number(qs.get('scale'));if(qs.has('timeSize'))config.timeSize=qs.get('timeSize');if(qs.has('dateSize'))config.dateSize=qs.get('dateSize');if(qs.has('label'))config.label=qs.get('label');if(qs.has('tz'))config.timezone=qs.get('tz');if(qs.has('hour12'))config.hour12=qs.get('hour12')==='true'}
  function applyStyle(){document.documentElement.style.setProperty('--scale',config.scale);document.documentElement.style.setProperty('--time-size',config.timeSize);document.documentElement.style.setProperty('--date-size',config.dateSize);document.getElementById('liveTag').textContent=config.label||'LIVE'}
  const timeEl=document.getElementById('time');const dateEl=document.getElementById('date');const liveTag=document.getElementById('liveTag');
  const weekdayMap={Sunday:'Sun',Monday:'Mon',Tuesday:'Tue',Wednesday:'Wed',Thursday:'Thu',Friday:'Fri',Saturday:'Sat'};
  function pad(n){return n<10?'0'+n:String(n)}
  function render(){const now=new Date();const tz=config.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';const fmt=new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:Boolean(config.hour12)});const parts=fmt.formatToParts(now).reduce((acc,part)=>{acc[part.type]=part.value;return acc},{});timeEl.textContent=`${parts.hour}:${parts.minute}:${parts.second}${config.hour12&&parts.dayPeriod?' '+parts.dayPeriod.toUpperCase():''}`;const d=new Date(now.toLocaleString('en-US',{timeZone:tz}));const mm=pad(d.getMonth()+1);const dd=pad(d.getDate());const weekday=weekdayMap[new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'long'}).format(d)];dateEl.textContent=`${mm}/${dd} ${weekday}`}
  applyQueryOverrides();applyStyle();render();setInterval(render,1000);
  let glow=false;setInterval(()=>{glow=!glow;if(glow){liveTag.style.boxShadow='0 0 12px var(--accent-glow), 0 0 24px var(--accent-glow)';liveTag.style.color='#ffffff';liveTag.style.borderColor='var(--accent-pink)'}else{liveTag.style.boxShadow='none';liveTag.style.color='var(--accent-pink)';liveTag.style.borderColor='var(--accent-pink)'}},1000);
  channel.addEventListener('message',event=>{if(event.data?.type!=='overlay-config-change'||!event.data.clock)return;config={...defaults,...event.data.clock};localStorage.setItem(CLOCK_KEY,JSON.stringify(config));applyStyle();render()});
})();
