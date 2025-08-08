/* ----------------- OBS Live Helper – Dashboard  ----------------- */
const bcStyle = new BroadcastChannel('obs-style-sync');

/* ---------- 字體清單 ---------- */
const fontMap = {
  zh: ["DFKai-SB","Noto Sans TC","Microsoft JhengHei","PMingLiU"],
  en: ["Segoe UI","Arial","Verdana","Helvetica","monospace"],
  ja: ["Noto Sans JP","Yu Gothic","MS PGothic","Meiryo"]
};

/* ---------- DOM ---------- */
const $ = id => document.getElementById(id);
const editor  = $("editorArea");
const preview = $("previewArea");
const toolbar = $("toolbar");
const fontZhSel = $("fontZhSel"), fontEnSel = $("fontEnSel"), fontJaSel = $("fontJaSel");
const fontFile  = $("fontFile");
const saveBtn   = $("saveTextBtn"), clearBtn = $("clearTextBtn"), saveStyleBtn = $("saveStyleBtn");
const fontSizeInp=$("fontSizeInp"), fontColorInp=$("fontColorInp"), currentColorInp=$("currentColorInp");
const boldChk=$("boldChk"), alignSel=$("alignSel");

/* ---------- 填字體下拉 ---------- */
function fill(sel,list){ sel.innerHTML=list.map(f=>`<option value="${f}">${f}</option>`).join("") }
fill(fontZhSel,fontMap.zh); fill(fontEnSel,fontMap.en); fill(fontJaSel,fontMap.ja);

/* ---------- 字體 CSS 變數 ---------- */
function applyFontVars(){
  const zh=`"${fontZhSel.value}"`,en=`"${fontEnSel.value}"`,ja=`"${fontJaSel.value}"`;
  [editor,preview].forEach(el=>{
    el.style.setProperty("--ff-zh",zh);
    el.style.setProperty("--ff-en",en);
    el.style.setProperty("--ff-ja",ja);
  });
}
[fontZhSel,fontEnSel,fontJaSel].forEach(s=>s.addEventListener("change",()=>{applyFontVars();syncPreview();}));

/* ---------- 上傳字型 ---------- */
fontFile.onchange=async()=>{
  if(!fontFile.files.length) return;
  const fd=new FormData(); fd.append("font",fontFile.files[0]);
  const {family}=await fetch("/api/font/upload",{method:"POST",body:fd}).then(r=>r.json());
  fontZhSel.add(new Option(family,family)); fontZhSel.value=family;
  applyFontVars(); syncPreview();
};

/* ---------- 語言分片 & 字體清理 ---------- */
function wrapLangSpans(html){
  const box = document.createElement("div");
  box.innerHTML = html;

  /* ① 去掉 <font> 與內嵌 font-family ---------- */
  box.querySelectorAll("font").forEach(f => {
    while (f.firstChild) f.parentNode.insertBefore(f.firstChild, f);
    f.remove();
  });
  box.querySelectorAll("[style*='font-family']").forEach(el => {
    el.style.fontFamily = "";
    if (!el.getAttribute("style")) el.removeAttribute("style");
  });

  /* ② 逐字切片，標上 zh / ja / en ---------- */
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, null);
  const rgZH = /[\u4E00-\u9FFF]/;
  const rgJA = /[\u3040-\u30FF\u31F0-\u31FF]/;
  let node;
  while ((node = walker.nextNode())) {
    const txt = node.nodeValue;
    if (!txt.trim()) continue;
    const frag = document.createDocumentFragment();
    for (const ch of txt) {
      const span = document.createElement("span");
      span.textContent = ch;
      span.className = rgZH.test(ch) ? "zh" : rgJA.test(ch) ? "ja" : "en";
      frag.appendChild(span);
    }
    node.parentNode.replaceChild(frag, node);
  }
  return box.innerHTML;
}


/* ---------- 同步預覽 ---------- */
function syncPreview(){ applyFontVars(); preview.innerHTML=wrapLangSpans(editor.innerHTML); }
editor.addEventListener("input",syncPreview);

/* ---------- 工具列 ---------- */
toolbar.addEventListener("click",e=>{
  const btn=e.target.closest("button"); if(!btn) return;
  let cmd=btn.dataset.cmd;
  if(cmd==="strikethrough") cmd="strikeThrough";
  if(cmd==="transparent") document.execCommand("hiliteColor",false,"transparent");
  else document.execCommand(cmd,false,null);
  editor.focus(); syncPreview();
});
$("foreColor").oninput=e=>{document.execCommand("foreColor",false,e.target.value);syncPreview();};
$("backColor").oninput=e=>{document.execCommand("hiliteColor",false,e.target.value);syncPreview();};
editor.addEventListener("keydown",e=>{
  if(e.ctrlKey&&e.key==='b'){document.execCommand('bold');e.preventDefault();}
  if(e.ctrlKey&&e.key==='i'){document.execCommand('italic');e.preventDefault();}
  if(e.ctrlKey&&e.key==='s'){saveEditor();e.preventDefault();}
});

/* ---------- 初始文字 ---------- */
(async()=>{
  const raw=await fetch('/api/editor').then(r=>r.text());
  editor.innerHTML=raw; applyFontVars(); syncPreview();
})();

/* ---------- 組 CSS ---------- */
function buildCSS(){
  return `#msgBox{font-size:${fontSizeInp.value}px;color:${fontColorInp.value};
display:flex;flex-direction:column;justify-content:${alignSel.value};}
#msgBox .zh{font-family:"${fontZhSel.value}",sans-serif;}
#msgBox .en{font-family:"${fontEnSel.value}",sans-serif;}
#msgBox .ja{font-family:"${fontJaSel.value}",sans-serif;}
#msgBox .current{color:${currentColorInp.value};${boldChk.checked?'font-weight:700;':'font-weight:400;'}}`;
}

/* ---------- 儲存文字 ---------- */
async function saveEditor(){
  const wrapped=wrapLangSpans(editor.innerHTML);

  /* 1. 後端持久化 */
  await fetch('/api/editor/save',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({text:wrapped})
  });

  /* 2. 本地預覽 */
  preview.innerHTML=wrapped;

  /* 3. 即時廣播 HTML + 最新字體 CSS -------- */
  const cssNow = buildCSS();
  bcStyle.postMessage({type:'update-html',html:wrapped});
  bcStyle.postMessage({type:'set-css',    css:cssNow});
}

saveBtn.onclick=saveEditor;
clearBtn.onclick=async()=>{
  editor.innerHTML=''; syncPreview();
  await fetch('/api/editor/clear',{method:'POST'});
  bcStyle.postMessage({type:'update-html',html:''});
};

/* ---------- 儲存樣式：如需永久寫檔仍可使用 ---------- */
async function saveCurrentStyle(){
  const css=buildCSS();
  await fetch('/api/style/save',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({css})
  });
  bcStyle.postMessage({type:'set-css',css});
}
saveStyleBtn.onclick=saveCurrentStyle;

/* ---------- Spotify 狀態 / 日誌（保留原功能） ---------- */
const loginBtn  = $("loginBtn");
const trackInfo = $("trackInfo");
const logView   = $("logView");
loginBtn.onclick = ()=> window.open('/api/spotify/auth/login','_blank');
async function loadStatus(){
  const st = await fetch('/api/spotify/status').then(r=>r.json());
  if(!st.authorized){ trackInfo.textContent='未授權'; return; }
  if(!st.playing)   { trackInfo.textContent='暫停中'; return; }
  trackInfo.textContent = `${st.track.artists} - ${st.track.name} (${st.lyricsSynced?'✅':'❌'})`;
}
async function loadLog(){
  const txt = await fetch('/api/spotify/log').then(r=>r.text());
  logView.textContent = txt; logView.scrollTop = logView.scrollHeight;
}
loadStatus(); loadLog(); setInterval(loadStatus,3000); setInterval(loadLog,6000);
