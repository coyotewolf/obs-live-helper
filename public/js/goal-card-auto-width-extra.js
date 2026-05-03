/* OBS Live Helper – make auto goal cards share the longest required width */
(function goalCardAutoWidthExtra(){
  const container = document.getElementById('cardsContainer');
  if (!container) return;

  const MIN_COL = 520;
  const MIN_ROW = 220;
  const EXTRA_PADDING = 106; // card horizontal padding + badge + gap + safety buffer

  function numberFromCss(value, fallback){
    const n = Number(String(value || '').replace('px', '').trim());
    return Number.isFinite(n) ? n : fallback;
  }

  function measureText(text, font){
    const canvas = measureText.canvas || (measureText.canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    return Math.ceil(ctx.measureText(String(text || '')).width);
  }

  function computeLongestWidth(){
    const cards = Array.from(container.querySelectorAll('.goal-card:not(.leaving)'));
    if (!cards.length) return null;

    let longest = 0;
    for (const card of cards) {
      const textEl = card.querySelector('.text');
      const progressEl = card.querySelector('.progressText');
      const textStyle = getComputedStyle(textEl || card);
      const progressStyle = getComputedStyle(progressEl || card);
      const textWidth = measureText(textEl?.textContent || '', `${textStyle.fontWeight} ${textStyle.fontSize} ${textStyle.fontFamily}`);
      const progressWidth = measureText(progressEl?.textContent || '', `${progressStyle.fontWeight} ${progressStyle.fontSize} ${progressStyle.fontFamily}`);
      longest = Math.max(longest, textWidth, progressWidth);
    }

    return Math.ceil(longest + EXTRA_PADDING);
  }

  function applyAutoWidth(){
    if (container.dataset.widthMode !== 'auto') return;
    const width = computeLongestWidth();
    if (!width) return;

    const root = document.documentElement;
    const minCol = numberFromCss(getComputedStyle(root).getPropertyValue('--card-min-col'), MIN_COL);
    const minRow = numberFromCss(getComputedStyle(root).getPropertyValue('--card-min-row'), MIN_ROW);
    const colWidth = Math.max(minCol, width);
    const rowWidth = Math.max(minRow, width);

    root.style.setProperty('--card-width-col', `${colWidth}px`);
    root.style.setProperty('--card-width-row', `${rowWidth}px`);
  }

  const observer = new MutationObserver(() => requestAnimationFrame(applyAutoWidth));
  observer.observe(container, { childList: true, subtree: true, characterData: true, attributes: true });

  window.addEventListener('resize', () => requestAnimationFrame(applyAutoWidth));
  document.fonts?.ready?.then(applyAutoWidth).catch(() => {});
  requestAnimationFrame(applyAutoWidth);
  setInterval(applyAutoWidth, 1000);
})();
