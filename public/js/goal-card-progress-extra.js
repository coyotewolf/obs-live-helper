/* OBS Live Helper – progress decrease stabilizer.
   goal-card.js handles the normal progress increase animation. This file only
   corrects decreases, especially 1 -> 0, so it does not fight the main 0 -> 1
   animation and cause flicker. */
(function goalCardProgressExtra(){
  const container = document.getElementById('cardsContainer');
  if (!container) return;

  function parseProgress(card){
    const text = card.querySelector('.progressText')?.textContent || '';
    const match = text.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const current = Math.max(0, Number(match[1]) || 0);
    const total = Math.max(1, Number(match[2]) || 1);
    return {
      current,
      total,
      pct: Math.max(0, Math.min(100, current / total * 100))
    };
  }

  function setBaseline(card, progress){
    card.dataset.progressPct = String(progress.pct);
    card.dataset.progressCurrent = String(progress.current);
    card.dataset.progressTotal = String(progress.total);
  }

  function cleanupLegacyEffects(card){
    card.querySelectorAll('.progressFloat').forEach(el => el.remove());
    const edge = card.querySelector('.progress-edge');
    if (edge) {
      edge.getAnimations?.().forEach(animation => animation.cancel());
      edge.style.opacity = '0';
    }
  }

  function animateDecrease(card, fromPct, toPct){
    const fill = card.querySelector('.fill-bg');
    const progressText = card.querySelector('.progressText');
    if (!fill || !progressText) return;

    fill.getAnimations?.().forEach(animation => animation.cancel());
    progressText.getAnimations?.().forEach(animation => animation.cancel());

    fill.style.transition = 'none';
    fill.style.width = `${fromPct}%`;
    void fill.offsetWidth;

    requestAnimationFrame(() => {
      fill.style.transition = '';
      const animation = fill.animate(
        [
          { width: `${fromPct}%`, opacity: .86, filter: 'brightness(1)' },
          { width: `${toPct}%`, opacity: .8, filter: 'brightness(.96)', offset: .72 },
          { width: `${toPct}%`, opacity: .86, filter: 'brightness(1)' }
        ],
        { duration: 720, easing: 'cubic-bezier(.18,.82,.18,1)', fill: 'both' }
      );
      fill.style.width = `${toPct}%`;
      animation.onfinish = () => {
        fill.style.transition = '';
        fill.style.width = `${toPct}%`;
        try { animation.cancel(); } catch {}
      };
    });

    card.classList.remove('progress-rise', 'progress-fall');
    void card.offsetWidth;
    card.classList.add('progress-fall');
    setTimeout(() => card.classList.remove('progress-fall'), 850);

    progressText.animate(
      [
        { transform: 'translateY(0)', opacity: .86, filter: 'brightness(1)' },
        { transform: 'translateY(1px)', opacity: 1, filter: 'brightness(.96)' },
        { transform: 'translateY(0)', opacity: 1, filter: 'brightness(1)' }
      ],
      { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)' }
    );
  }

  function inspectCard(card, { initial = false } = {}){
    cleanupLegacyEffects(card);

    const progress = parseProgress(card);
    const fill = card.querySelector('.fill-bg');
    if (!progress || !fill) return;

    const prevPct = Number(card.dataset.progressPct);
    const prevCurrent = Number(card.dataset.progressCurrent);
    const prevTotal = Number(card.dataset.progressTotal);
    const hasPrevious = Number.isFinite(prevPct) && Number.isFinite(prevCurrent) && Number.isFinite(prevTotal);

    if (initial || !hasPrevious) {
      setBaseline(card, progress);
      fill.style.width = `${progress.pct}%`;
      return;
    }

    const pctChanged = Math.abs(prevPct - progress.pct) > 0.01;
    const valueChanged = prevCurrent !== progress.current || prevTotal !== progress.total;
    if (!pctChanged && !valueChanged) return;

    const isDecrease = progress.pct < prevPct || progress.current < prevCurrent;
    const fromPct = Math.max(0, Math.min(100, prevPct));
    const toPct = progress.pct;

    setBaseline(card, progress);

    if (isDecrease) {
      animateDecrease(card, fromPct, toPct);
      return;
    }

    // Increase is handled by goal-card.js. Only update the baseline here so the
    // two animation systems do not fight each other during 0 -> 1.
  }

  function scan(options = {}){
    container.querySelectorAll('.goal-card:not(.leaving)').forEach(card => inspectCard(card, options));
  }

  const observer = new MutationObserver(() => requestAnimationFrame(() => scan()));
  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true
  });

  requestAnimationFrame(() => scan({ initial: true }));
})();
