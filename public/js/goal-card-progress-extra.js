/* OBS Live Helper – stable bidirectional progress bar animation.
   Loaded after goal-card.js to normalize progress changes and prevent stale WAAPI
   animations from blocking width updates when current decreases. */
(function goalCardProgressExtra(){
  const container = document.getElementById('cardsContainer');
  if (!container) return;

  function parseProgress(card){
    const text = card.querySelector('.progressText')?.textContent || '';
    const match = text.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const current = Math.max(0, Number(match[1]) || 0);
    const total = Math.max(1, Number(match[2]) || 1);
    return { current, total, pct: Math.max(0, Math.min(100, current / total * 100)) };
  }

  function cleanupLegacyEffects(card){
    card.querySelectorAll('.progressFloat').forEach(el => el.remove());
    const edge = card.querySelector('.progress-edge');
    if (edge) edge.getAnimations?.().forEach(animation => animation.cancel());
  }

  function animateCard(card, { initial = false } = {}){
    const fill = card.querySelector('.fill-bg');
    const progressText = card.querySelector('.progressText');
    if (!fill || !progressText) return;

    cleanupLegacyEffects(card);

    const progress = parseProgress(card);
    if (!progress) return;

    const prevPct = Number(card.dataset.progressPct);
    const prevCurrent = Number(card.dataset.progressCurrent);
    const hasPrevious = Number.isFinite(prevPct) && Number.isFinite(prevCurrent);
    const changed = !hasPrevious || Math.abs(prevPct - progress.pct) > 0.01 || prevCurrent !== progress.current;

    if (!changed && !initial) return;

    card.dataset.progressPct = String(progress.pct);
    card.dataset.progressCurrent = String(progress.current);

    fill.getAnimations?.().forEach(animation => animation.cancel());
    progressText.getAnimations?.().forEach(animation => animation.cancel());

    if (!hasPrevious || initial) {
      fill.style.width = `${progress.pct}%`;
      return;
    }

    const goingUp = progress.pct > prevPct;
    const fromPct = Math.max(0, Math.min(100, prevPct));
    const toPct = progress.pct;

    fill.style.transition = 'none';
    fill.style.width = `${fromPct}%`;
    void fill.offsetWidth;
    fill.style.transition = '';

    requestAnimationFrame(() => {
      fill.style.width = `${toPct}%`;
      fill.animate(
        [
          { width: `${fromPct}%`, opacity: .84, filter: 'brightness(1)' },
          { width: `${toPct}%`, opacity: goingUp ? .9 : .8, filter: goingUp ? 'brightness(1.12)' : 'brightness(.96)', offset: .62 },
          { width: `${toPct}%`, opacity: .86, filter: 'brightness(1)' }
        ],
        { duration: 720, easing: 'cubic-bezier(.18,.82,.18,1)', fill: 'both' }
      );
    });

    card.classList.remove('progress-rise', 'progress-fall');
    void card.offsetWidth;
    card.classList.add(goingUp ? 'progress-rise' : 'progress-fall');
    setTimeout(() => card.classList.remove('progress-rise', 'progress-fall'), 850);

    progressText.animate(
      [
        { transform: 'translateY(0)', opacity: .86, filter: 'brightness(1)' },
        { transform: goingUp ? 'translateY(-1px)' : 'translateY(1px)', opacity: 1, filter: goingUp ? 'brightness(1.14)' : 'brightness(.96)' },
        { transform: 'translateY(0)', opacity: 1, filter: 'brightness(1)' }
      ],
      { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)' }
    );
  }

  function scan(options = {}){
    container.querySelectorAll('.goal-card:not(.leaving)').forEach(card => animateCard(card, options));
  }

  const observer = new MutationObserver(() => {
    requestAnimationFrame(() => scan());
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true
  });

  requestAnimationFrame(() => scan({ initial: true }));
})();
