(function(){
  const THEME_KEY='obsHelperTheme';
  const channel=new BroadcastChannel('obs-helper-theme');
  function applyTheme(theme){document.body.dataset.theme=theme||'blue-night';}
  applyTheme(localStorage.getItem(THEME_KEY)||'blue-night');
  channel.addEventListener('message',event=>{
    if(event.data?.type==='theme-change'){
      localStorage.setItem(THEME_KEY,event.data.theme);
      applyTheme(event.data.theme);
    }
  });
  window.obsHelperTheme={
    get:()=>localStorage.getItem(THEME_KEY)||'blue-night',
    set:theme=>{localStorage.setItem(THEME_KEY,theme);applyTheme(theme);channel.postMessage({type:'theme-change',theme});}
  };
})();
