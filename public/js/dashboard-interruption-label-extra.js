/* Rename legacy 'immediate play' wording to host-reviewed interruption wording. */
(function(){
  function patchText(){
    document.querySelectorAll('button').forEach(btn=>{
      if(btn.textContent.trim()==='立即插播') btn.textContent='同意插播';
    });
    document.querySelectorAll('.requestItem small').forEach(el=>{
      el.textContent=el.textContent.replace('插播','請求插播').replace('已插播','已同意插播');
    });
  }
  const oldToast=window.showToast;
  if(typeof oldToast==='function'){
    window.showToast=function(msg){
      oldToast(String(msg||'').replace('已立即插播','已同意插播，請自行在 Spotify 播放'));
    };
  }
  new MutationObserver(patchText).observe(document.body,{childList:true,subtree:true,characterData:true});
  patchText();
})();
