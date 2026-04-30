(function(){
  const GOAL_KEY='obsHelperGoalCards';
  const CONFIG_KEY='obsHelperOverlayConfigCache';
  const channel=new BroadcastChannel('obs-helper-overlay-config');
  const defaults={layout:{direction:'column',gap:30,baseAlpha:.65,completedAlpha:.65,completeFlashMs:3000},cards:[{uid:'goal-default',text:'今日小目標：完成任務3場',current:0,total:3,visible:true,completed:false}]};
  const cardsContainer=document.getElementById('cardsContainer');
  const hudArea=document.getElementById('hudArea');
  let config=normalize(readConfig());
  let lastServerUpdatedAt=0;
  let previousCards=new Map(config.cards.map(c=>[c.uid,{...c}]));
  let lastCompleted=new Set(config.cards.filter(c=>c.completed||c.current>=c.total).map(c=>c.uid));
  let isUserDragging=false;
  let pendingFetch=false;

  function clone(v){return JSON.parse(JSON.stringify(v));}
  function uid(){return (crypto.randomUUID&&crypto.randomUUID())||`goal-${Date.now()}-${Math.random().toString(36).slice(2)}`;}
  function readConfig(){try{return JSON.parse(localStorage.getItem(GOAL_KEY)||'null')||clone(defaults)}catch{return clone(defaults)}}
  function normalize(raw){
    const base=raw||{};const next={...clone(defaults),...base};
    next.layout={...clone(defaults.layout),...(base.layout||{})};
    next.layout.direction=next.layout.direction==='row'?'row':'column';
    next.layout.gap=Math.max(0,Math.min(240,Number(next.layout.gap??30)));
    next.layout.baseAlpha=Math.max(0,Math.min(1,Number(next.layout.baseAlpha??.65)));
    next.layout.completedAlpha=Math.max(0,Math.min(1,Number(next.layout.completedAlpha??next.layout.baseAlpha)));
    next.layout.completeFlashMs=Math.max(0,Math.min(30000,Number(next.layout.completeFlashMs??3000)));
    const cards=Array.isArray(base.cards)&&base.cards.length?base.cards:clone(defaults.cards);
    next.cards=cards.slice(0,20).map((card,index)=>{const total=Math.max(1,Number(card.total)||1);const current=Math.max(0,Math.min(total,Number(card.current)||0));return{uid:String(card.uid||uid()),text:String(card.text||`今日小目標 ${index+1}`),current,total,visible:card.visible!==false,completed:Boolean(card.completed)}});
    return next;
  }
  function escapeHtml(text){return String(text||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));}
  function applyCSS(){const root=document.documentElement;root.style.setProperty('--cards-gap',`${config.layout.gap??30}px`);root.style.setProperty('--base-alpha',config.layout.baseAlpha??.65);root.style.setProperty('--completed-alpha',config.layout.completedAlpha??.65);}
  function isCompleted(card){return Boolean(card.completed)||Number(card.current)>=Number(card.total);}
  function sortCards(cards){return [...cards.filter(c=>!isCompleted(c)),...cards.filter(c=>isCompleted(c))];}
  function visibleCards(){return sortCards(config.cards).filter(c=>c.visible!==false);}
  function getPositions(){const map=new Map();cardsContainer.querySelectorAll('.goal-card:not(.leaving)').forEach(el=>map.set(el.dataset.uid,el.getBoundingClientRect()));return map;}
  function animateMoves(before){cardsContainer.querySelectorAll('.goal-card:not(.leaving)').forEach(el=>{const prev=before.get(el.dataset.uid);if(!prev)return;const now=el.getBoundingClientRect();const dx=prev.left-now.left;const dy=prev.top-now.top;if(Math.abs(dx)>1||Math.abs(dy)>1){el.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],{duration:360,easing:'cubic-bezier(.2,.7,.2,1)'});}});}
  function createCardElement(card){
    const total=Math.max(1,Number(card.total)||1);const current=Math.max(0,Math.min(total,Number(card.current)||0));const pct=Math.max(0,Math.min(100,current/total*100));const completed=isCompleted(card);
    const el=document.createElement('div');el.className=`goal-card ${completed?'completed':''}`;el.dataset.uid=card.uid;el.innerHTML=`<div class="fill-bg" style="width:${pct}%"></div><div class="shine"></div><div class="badge ${completed?'is-heart is-heart-small':''}">${completed?'❤':'💖'}</div><div class="stack"><div class="text ${completed?'is-done':''}">${escapeHtml(card.text)}</div><div class="progressText">${current} / ${total}</div></div>`;return el;
  }
  function updateCardElement(el,card){
    const total=Math.max(1,Number(card.total)||1);const current=Math.max(0,Math.min(total,Number(card.current)||0));const pct=Math.max(0,Math.min(100,current/total*100));const completed=isCompleted(card);const prev=previousCards.get(card.uid);
    el.classList.toggle('completed',completed);el.dataset.uid=card.uid;el.querySelector('.fill-bg').style.width=pct+'%';
    const badge=el.querySelector('.badge');badge.textContent=completed?'❤':'💖';badge.classList.toggle('is-heart',completed);badge.classList.toggle('is-heart-small',completed);
    const text=el.querySelector('.text');text.textContent=card.text;text.classList.toggle('is-done',completed);el.querySelector('.progressText').textContent=`${current} / ${total}`;
    if(prev&&current>Number(prev.current||0)){el.classList.remove('progress-bump');void el.offsetWidth;el.classList.add('progress-bump');setTimeout(()=>el.classList.remove('progress-bump'),720);}
    if(completed&&!lastCompleted.has(card.uid)){spawnGoldFX(el,config.layout.completeFlashMs??3000);lastCompleted.add(card.uid);} if(!completed) lastCompleted.delete(card.uid);
  }
  function render(options={}){
    if(isUserDragging&&!options.force)return;
    applyCSS();cardsContainer.dataset.mode=config.layout.direction||'column';
    const before=getPositions();const currentEls=new Map(Array.from(cardsContainer.querySelectorAll('.goal-card:not(.leaving)')).map(el=>[el.dataset.uid,el]));
    const target=visibleCards();const targetUids=new Set(target.map(c=>c.uid));
    currentEls.forEach((el,uid)=>{if(!targetUids.has(uid)){el.classList.add('leaving');el.style.height=el.offsetHeight+'px';setTimeout(()=>el.remove(),360);}});
    target.forEach(card=>{let el=currentEls.get(card.uid);if(!el){el=createCardElement(card);el.classList.add('entering');cardsContainer.appendChild(el);requestAnimationFrame(()=>el.classList.remove('entering'));}else{updateCardElement(el,card);}cardsContainer.appendChild(el);});
    animateMoves(before);refreshQuickRails();enableHUDDragSort();previousCards=new Map(config.cards.map(c=>[c.uid,{...c}]));
  }
  function refreshQuickRails(){
    document.querySelectorAll('.quick-rail').forEach(el=>el.remove());
    const cards=Array.from(cardsContainer.querySelectorAll('.goal-card:not(.leaving)')); if(!cards.length)return;
    const rail=document.createElement('div');rail.className='quick-rail';hudArea.appendChild(rail);
    const areaBox=hudArea.getBoundingClientRect();const mode=config.layout.direction||'column';
    cards.forEach(cardEl=>{const card=config.cards.find(c=>c.uid===cardEl.dataset.uid);if(!card)return;const item=makeQuickItem(card);const r=cardEl.getBoundingClientRect();
      if(mode==='row'){item.classList.add('bottom');item.style.left=(r.left-areaBox.left+r.width/2)+'px';item.style.top=(r.bottom-areaBox.top+8)+'px';item.style.transform='translateX(-50%)';}
      else{item.classList.add('right');item.style.left=(r.right-areaBox.left+12)+'px';item.style.top=(r.top-areaBox.top+r.height/2)+'px';item.style.transform='translateY(-50%)';}
      rail.appendChild(item);
    });
  }
  function makeQuickItem(card){
    const wrap=document.createElement('div');wrap.className='quick-item';wrap.dataset.uid=card.uid;wrap.innerHTML=`<div class="mini"><button data-act="cur-">–</button><input class="cur" type="number" min="0" value="${card.current}"><button data-act="cur+">+</button><span class="slash">/</span><button data-act="tot-">–</button><input class="tot" type="number" min="1" value="${card.total}"><button data-act="tot+">+</button></div><button class="hide-btn" data-act="hide" title="隱藏">👁</button>`;
    const cur=wrap.querySelector('.cur'),tot=wrap.querySelector('.tot');
    const apply=()=>{const c=config.cards.find(x=>x.uid===card.uid);if(!c)return;const total=Math.max(1,Number(tot.value)||1);const current=Math.max(0,Math.min(total,Number(cur.value)||0));c.total=total;c.current=current;if(current<total)c.completed=false;saveGoalToServer(true);render({force:true});};
    wrap.addEventListener('click',e=>{const btn=e.target.closest('[data-act]');if(!btn)return;const c=config.cards.find(x=>x.uid===card.uid);if(!c)return;let total=Math.max(1,Number(c.total)||1);let current=Math.max(0,Math.min(total,Number(c.current)||0));if(btn.dataset.act==='cur-')current=Math.max(0,current-1);if(btn.dataset.act==='cur+')current=Math.min(total,current+1);if(btn.dataset.act==='tot-'){total=Math.max(1,total-1);current=Math.min(current,total);}if(btn.dataset.act==='tot+')total+=1;if(btn.dataset.act==='hide')c.visible=false;c.current=current;c.total=total;if(current<total)c.completed=false;saveGoalToServer(true);render({force:true});});
    cur.addEventListener('change',apply);tot.addEventListener('change',apply);return wrap;
  }
  async function saveGoalToServer(debounce=false){
    localStorage.setItem(GOAL_KEY,JSON.stringify(config));channel.postMessage({type:'overlay-config-change',goal:config});
    clearTimeout(saveGoalToServer.timer);const run=async()=>{try{let shared={};try{shared=JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}')}catch{}const payload={theme:shared.theme||document.body.dataset.theme||'blue-night',goal:config,clock:shared.clock};const res=await fetch('/api/overlay-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await res.json().catch(()=>null);if(data?.ok&&data.config){lastServerUpdatedAt=Number(data.config.updatedAt||Date.now());localStorage.setItem(CONFIG_KEY,JSON.stringify(data.config));}}catch(err){console.warn('goal save failed',err);}};
    if(debounce)saveGoalToServer.timer=setTimeout(run,160);else run();
  }
  function enableHUDDragSort(){
    cardsContainer.onpointerdown=e=>{const card=e.target.closest('.goal-card');if(!card||e.target.closest('.quick-item')||e.target.closest('input')||e.target.closest('button'))return;const startX=e.clientX,startY=e.clientY;let dragging=false;let placeholder=null;let rect=null;const uid0=card.dataset.uid;card.setPointerCapture?.(e.pointerId);
      const move=ev=>{const dx=ev.clientX-startX,dy=ev.clientY-startY;if(!dragging&&Math.hypot(dx,dy)>6){dragging=true;isUserDragging=true;rect=card.getBoundingClientRect();placeholder=document.createElement('div');placeholder.className='goal-card placeholder';placeholder.style.width=rect.width+'px';placeholder.style.height=rect.height+'px';card.parentNode.insertBefore(placeholder,card.nextSibling);card.classList.add('dragging');card.style.width=rect.width+'px';card.style.height=rect.height+'px';card.style.left=rect.left+'px';card.style.top=rect.top+'px';document.body.classList.add('hud-dragging');}
        if(!dragging)return;ev.preventDefault();card.style.left=(rect.left+dx)+'px';card.style.top=(rect.top+dy)+'px';updatePlaceholder(ev.clientX,ev.clientY,placeholder,card);};
      const up=()=>{card.removeEventListener('pointermove',move);card.removeEventListener('pointerup',up);card.removeEventListener('pointercancel',up);if(!dragging)return;card.classList.remove('dragging');card.style.cssText='';if(placeholder){cardsContainer.insertBefore(card,placeholder);placeholder.remove();}
        const order=Array.from(cardsContainer.querySelectorAll('.goal-card:not(.leaving)')).map(el=>el.dataset.uid);const byUid=new Map(config.cards.map(c=>[c.uid,c]));const hidden=config.cards.filter(c=>!order.includes(c.uid));config.cards=[...order.map(uid=>byUid.get(uid)).filter(Boolean),...hidden];isUserDragging=false;document.body.classList.remove('hud-dragging');saveGoalToServer(false);render({force:true});};
      card.addEventListener('pointermove',move);card.addEventListener('pointerup',up);card.addEventListener('pointercancel',up);};
  }
  function updatePlaceholder(x,y,placeholder,draggingEl){
    const items=Array.from(cardsContainer.querySelectorAll('.goal-card:not(.dragging):not(.leaving)')).filter(el=>el!==placeholder);const mode=config.layout.direction||'column';if(!items.length)return;
    if(mode==='column'){let target=null;for(const it of items){const r=it.getBoundingClientRect();if(y<r.top+r.height/2){target=it;break;}}target?cardsContainer.insertBefore(placeholder,target):cardsContainer.appendChild(placeholder);}
    else{let target=null;for(const it of items){const r=it.getBoundingClientRect();if(y<r.bottom&&x<r.left+r.width/2){target=it;break;}}target?cardsContainer.insertBefore(placeholder,target):cardsContainer.appendChild(placeholder);}
  }
  function spawnGoldFX(cardEl,durationMs){const layer=document.createElement('div');layer.className='particle-layer';cardEl.appendChild(layer);const burst=document.createElement('div');burst.className='burst';burst.style.animation='burstFlash 600ms ease-out forwards';layer.appendChild(burst);const sprays=Math.max(2,Math.floor(durationMs/300));let count=0;const timer=setInterval(()=>{createSpray(layer);count++;if(count>=sprays)clearInterval(timer)},300);setTimeout(()=>layer.remove(),Math.max(800,durationMs+500));}
  function createSpray(layer){const rect=layer.getBoundingClientRect();const W=rect.width,H=rect.height;for(let i=0;i<44;i++){const p=document.createElement('span');p.className='particle';const size=2.5+Math.random()*8.5;p.style.width=size+'px';p.style.height=size+'px';p.style.left=Math.random()*W+'px';p.style.top=Math.random()*H+'px';p.style.setProperty('--dx',(Math.random()*2-1)*(W*.25)+'px');p.style.setProperty('--dy',(Math.random()*2-1)*(H*.2)-30+'px');const dur=700+Math.random()*900;p.style.animation=`particleDrift ${dur}ms cubic-bezier(.2,.7,.2,1) forwards`;layer.appendChild(p);}}
  function applyConfig(goal,updatedAt=0){if(isUserDragging){pendingFetch=true;return;}config=normalize(goal);if(updatedAt)lastServerUpdatedAt=updatedAt;localStorage.setItem(GOAL_KEY,JSON.stringify(config));render();}
  async function fetchSharedConfig(){if(isUserDragging)return;try{const res=await fetch('/api/overlay-config?_t='+Date.now(),{cache:'no-store'});const data=await res.json();if(!data?.ok||!data.config?.goal)return;const updatedAt=Number(data.config.updatedAt||0);localStorage.setItem(CONFIG_KEY,JSON.stringify(data.config));if(updatedAt>=lastServerUpdatedAt){applyConfig(data.config.goal,updatedAt);}}catch(err){}}
  channel.addEventListener('message',event=>{if(event.data?.type!=='overlay-config-change'||!event.data.goal)return;applyConfig(event.data.goal);});
  addEventListener('resize',()=>refreshQuickRails());
  render({force:true});fetchSharedConfig();setInterval(fetchSharedConfig,1000);
})();
