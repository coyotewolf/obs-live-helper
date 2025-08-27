/* -----------------  OBS Live Helper – Dashboard  ----------------- */
const bcStyle = new BroadcastChannel('obs-style-sync');

/* ---------- 先把內建清單 + 使用者自行上傳的字體併起來 ---------- */
const builtinFonts = [
  "DFKai-SB","Noto Sans TC","Microsoft JhengHei","PMingLiU",
  "Segoe UI","Arial","Verdana","Helvetica","monospace",
  "Noto Sans JP","Yu Gothic","MS PGothic","Meiryo"
];
const userFonts = JSON.parse(localStorage.getItem('userFonts') || '[]');
const fontList  = Array.from(new Set([...builtinFonts, ...userFonts]));

/* ---------- DOM ---------- */
const $            = id=>document.getElementById(id);
const editor       = $("editorArea");
const preview      = $("previewArea");
const toolbar      = $("toolbar");
const fontSel      = $("fontSel");
const fontFile     = $("fontFile");
const uploadFontBtn= $("uploadFontBtn");

const saveBtn      = $("saveTextBtn");
const clearBtn     = $("clearTextBtn");
const fontSizeInp  = $("fontSizeInp");           // 左側「整體」字級
const fontColorInp = $("fontColorInp");
const currentColorInp=$("currentColorInp");
const boldChk      = $("boldChk");
const alignSel     = $("alignSel");

/* 單一欄位字號控制（作用於「選取文字」） */
const fontSizeCtrl = $("fontSizeCtrl");

/* 新增：message.html 頁面底色控制（含透明） */
const pageBgColor       = $("pageBgColor");
const pageBgTransparent = $("pageBgTransparent");

/* ---------- 字體下拉 ---------- */
function rebuildFontOptions(selected = fontSel.value){
  fontSel.innerHTML = fontList.map(f=>`<option value="${f}">${f}</option>`).join("");
  if (fontList.includes(selected)) fontSel.value = selected;
}
rebuildFontOptions();

fontSel.addEventListener("change",()=>{
  document.execCommand("fontName",false,fontSel.value);
  editor.focus();
  syncPreview();
});

/* ---------- 上傳自訂字體 ---------- */
fontFile.addEventListener("change",()=>uploadFontBtn.style.display=fontFile.files.length?"":"none");

uploadFontBtn.addEventListener("click",async()=>{
  if(!fontFile.files.length) return;
  uploadFontBtn.disabled=true; uploadFontBtn.textContent="⏳ 上傳中…";

  const fd=new FormData(); fd.append("font",fontFile.files[0]);
  try{
    // /api/font/upload 會把 @font-face 寫進 /storage/style.css，並回 {family:"xxx"}
    const { family } = await fetch("/api/font/upload",{method:"POST",body:fd}).then(r=>r.json());

    if(!fontList.includes(family)){
      fontList.push(family);
      userFonts.push(family);
      localStorage.setItem('userFonts', JSON.stringify(userFonts));
      rebuildFontOptions(family);
    }else fontSel.value = family;

    document.execCommand("fontName",false,family);
    syncPreview();

    // 通知 message.html 重載 /style.css
    bcStyle.postMessage({type:'reload-style'});
  }catch(err){ alert("字體上傳失敗！"); console.error(err);}
  finally{
    fontFile.value=""; uploadFontBtn.disabled=false;
    uploadFontBtn.style.display="none"; uploadFontBtn.textContent="⬆ 上傳";
  }
});

/* ---------- 同步預覽 ---------- */
function syncPreview(){ preview.innerHTML = editor.innerHTML; }

/* 預覽框的容器樣式 */
function applyPreviewContainerStyle(){
  preview.style.whiteSpace = 'nowrap';
  preview.style.textAlign  = 'left';
  preview.style.lineHeight = '1';
  preview.style.fontSize   = `${parseInt(fontSizeInp.value||16,10)}px`;
  preview.style.color      = fontColorInp.value || '#000000';
  preview.style.fontFamily = 'Arial, Helvetica, sans-serif';
  preview.style.fontVariantNumeric = 'lining-nums';
  preview.style.fontFeatureSettings = '"lnum" 1';
  // 頁面底色 → 也讓預覽框同步顯示（支援透明）
  const bg = pageBgTransparent.checked ? 'transparent' : (pageBgColor.value || '#ffffff');
  preview.style.background = bg;
}
[fontSizeInp, fontColorInp, boldChk, alignSel].forEach(ctrl=>{
  if(!ctrl) return;
  ctrl.addEventListener('input', ()=>{
    applyPreviewContainerStyle();
    syncPreview();
    // 同時把 CSS 即時推送到 message.html
    bcStyle.postMessage({type:'set-css', css: buildCSS()});
  });
});

/* 頁面底色改變：即時套用預覽 + 推送到 message.html */
pageBgColor.addEventListener('input',()=>{
  applyPreviewContainerStyle();
  syncPreview();
});
pageBgTransparent.addEventListener('change',()=>{
  // 不停用 color input，使用者可先選色、勾透明，之後再取消透明可回到那個色
  applyPreviewContainerStyle();
  syncPreview();
});

/* ---------- 工具列 ---------- */
toolbar.addEventListener("click",e=>{
  const btn=e.target.closest("button"); if(!btn) return;
  let cmd=btn.dataset.cmd;
  if(cmd==="strikethrough")   cmd="strikeThrough";
  if(cmd==="transparent")     document.execCommand("hiliteColor",false,"transparent");
  else                        document.execCommand(cmd,false,null);
  editor.focus(); syncPreview();
});
$("foreColor").oninput = e=>{ document.execCommand("foreColor", false, e.target.value); syncPreview(); };
$("backColor").oninput = e=>{ document.execCommand("hiliteColor",false, e.target.value); syncPreview(); };
editor.addEventListener("keydown",e=>{
  if(e.ctrlKey&&e.key==='b'){document.execCommand('bold');  e.preventDefault();}
  if(e.ctrlKey&&e.key==='i'){document.execCommand('italic');e.preventDefault();}
  if(e.ctrlKey&&e.key==='s'){saveEditor();                 e.preventDefault();}
});
editor.addEventListener("input",syncPreview);

/* ---------- 初始文字 ---------- */
(async()=>{
  const raw = await fetch('/api/editor').then(r=>r.text());
  editor.innerHTML = raw;
  syncPreview();
  applyPreviewContainerStyle();
})();

/* ---------- 針對「選取文字」套用字號（px） ---------- */
let lastRange = null;
function saveSelection(){
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0);
    if (editor.contains(r.commonAncestorContainer)) {
      lastRange = r.cloneRange();
    }
  }
}
editor.addEventListener('mouseup', saveSelection);
editor.addEventListener('keyup',   saveSelection);
editor.addEventListener('mouseleave', saveSelection);
document.addEventListener('selectionchange', ()=>{
  if (document.activeElement === editor) saveSelection();
});

function applyFontSizeToSelection(px){
  const size = parseInt(px,10);
  if (!size || size <= 0) return;

  const sel = window.getSelection();
  let range = (lastRange && lastRange.cloneRange()) || (sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null);
  if (!range || range.collapsed) return;
  if (!editor.contains(range.commonAncestorContainer)) return;

  const frag    = range.extractContents();
  const wrapper = document.createElement('span');
  wrapper.style.fontSize = `${size}px`;
  wrapper.appendChild(frag);
  range.insertNode(wrapper);

  sel.removeAllRanges();
  range.selectNodeContents(wrapper);
  sel.addRange(range);
  saveSelection();

  syncPreview();
}
function handleFontSizeInput(){
  const v = fontSizeCtrl.value.trim();
  const px = (v.endsWith('px') ? v.slice(0,-2) : v);
  applyFontSizeToSelection(px);
}
fontSizeCtrl.addEventListener('change', handleFontSizeInput);
fontSizeCtrl.addEventListener('keydown', e=>{
  if (e.key === 'Enter') { e.preventDefault(); handleFontSizeInput(); }
});

/* ---------- 儲存前：把非 px 的字級轉為 px ---------- */
function normalizeFontSizesToPx(rootEl){
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT, null);
  const els = [];
  while (walker.nextNode()) els.push(walker.currentNode);

  els.forEach(el=>{
    if (el.tagName === 'FONT' && el.hasAttribute('size')) {
      const s = el.getAttribute('size');
      const map = {1:10,2:13,3:16,4:18,5:24,6:32,7:48};
      const px = map[s] || parseInt(s,10) || 16;
      el.style.fontSize = `${px}px`;
      el.removeAttribute('size');
    }
    const fs = el.style.fontSize;
    if (fs && !fs.endsWith('px')) {
      const px = window.getComputedStyle(el).fontSize;
      el.style.fontSize = px;
    }
  });
}

/* ---------- 組合要給 message.html 的容器 CSS ---------- */
function buildCSS(){
  const basePx = parseInt(fontSizeInp.value||16,10);
  const pageBg = pageBgTransparent.checked ? 'transparent' : (pageBgColor.value || '#ffffff');
  return `html,body{background:${pageBg};margin:0;padding:0;}
#msgBox{
  font-size:${basePx}px;
  color:${fontColorInp.value};
  white-space:nowrap;
  text-align:left;
  line-height:1;
  font-family: Arial, Helvetica, sans-serif;
  font-variant-numeric: lining-nums;
  font-feature-settings: "lnum" 1;
}
#msgBox span,
#msgBox b, #msgBox i, #msgBox u, #msgBox s,
#msgBox font{
  display:inline;
  vertical-align:text-bottom;
  line-height:1em;
}`;
}

/* ---------- 儲存文字 ---------- */
async function saveEditor(){
  normalizeFontSizesToPx(editor);

  const html = editor.innerHTML;
  await fetch('/api/editor/save',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({text:html})
  });

  syncPreview();
  applyPreviewContainerStyle();

  // 即時同步到 message.html
  bcStyle.postMessage({type:'update-html',html});
  bcStyle.postMessage({type:'set-css',css:buildCSS()});

  // 觸發 /style.css 重新載入（若剛上傳字體）
  const core = document.getElementById('coreStyle');
  if (core) core.href = '/style.css?t=' + Date.now();
}
saveBtn.onclick = saveEditor;

/* ---------- 清空 ---------- */
clearBtn.onclick = async ()=>{
  editor.innerHTML=''; syncPreview();
  await fetch('/api/editor/clear',{method:'POST'});
  bcStyle.postMessage({type:'update-html',html:''});
  bcStyle.postMessage({type:'set-css',css:buildCSS()});
};

/* ---------- 儲存樣式（整體） ---------- */
$("saveStyleBtn").onclick = async ()=>{
  const css=buildCSS();
  await fetch('/api/style/save',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({css})
  });
  // 即時推送
  bcStyle.postMessage({type:'set-css',css});
};

/* ---------- Spotify 區（原功能保留） ---------- */
const loginBtn  = $("loginBtn");
const trackInfo = $("trackInfo");
const logView   = $("logView");
loginBtn.onclick = () => window.open('/api/spotify/auth/login','_blank');

async function loadStatus(){
  const st = await fetch('/api/spotify/status').then(r=>r.json());
  if(!st.authorized){ trackInfo.textContent='未授權'; return; }
  if(!st.playing){   trackInfo.textContent='暫停中'; return; }
  trackInfo.textContent = `${st.track.artists} - ${st.track.name} (${st.lyricsSynced?'✅':'❌'})`;
}
async function loadLog(){
  const txt = await fetch('/api/spotify/log').then(r=>r.text());
  logView.textContent = txt;
  logView.scrollTop   = logView.scrollHeight;
}
loadStatus(); loadLog();
setInterval(loadStatus,3000);
setInterval(loadLog,   6000);
