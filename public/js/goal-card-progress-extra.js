/* OBS Live Helper – clean goal progress animation override */
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

  function animateCard(card, { force = false } = {}){
    const fill = card.querySelector('.fill-bg');
    const progressText = card.querySelector('.progressText');
    if (!fill || !progressText) return;

    const progress = parseProgress(card);
    if (!progress) return;

    const prevPct = Number(card.dataset.cleanProgressPct);
    const prevCurrent = Number(card.dataset.cleanProgressCurrent);
    const hasPrev = Number.isFinite(prevPct) && Number.isFinite(prevCurrent);
    const changed = force || !hasPrev || Math.abs(prevPct - progress.pct) > 0.01 || prevCurrent !== progress.current;

    if (!changed) return;

    card.dataset.cleanProgressPct = String(progress.pct);
    card.dataset.cleanProgressCurrent = String(progress.current);

    if (!hasPrev || force) {
      fill.style.width = `${progress.pct}%`;
      return;
    }

    fill.getAnimations?.().forEach(animation => animation.cancel());
    progressText.getAnimations?.().forEach(animation => animation.cancel());

    const goingUp = progress.pct > prevPct;
    fill.style.width = `${prevPct}%`;

    requestAnimationFrame(() => {
      fill.style.width = `${progress.pct}%`;
      fill.animate(
        [
          { width: `${prevPct}%`, filter: 'brightness(1)', opacity: .82 },
          { width: `${progress.pct}%`, filter: goingUp ? 'brightness(1.16)' : 'brightness(.94)', opacity: goingUp ? .9 : .78, offset: .62 },
          { width: `${progress.pct}%`, filter: 'brightness(1)', opacity: .86 }
        ],
        { duration: 760, easing: 'cubic-bezier(.18,.82,.18,1)', fill: 'both' }
      );
    });

    card.classList.remove('progress-rise', 'progress-fall');
    void card.offsetWidth;
    card.classList.add(goingUp ? 'progress-rise' : 'progress-fall');
    setTimeout(() => card.classList.remove('progress-rise', 'progress-fall'), 900);

    progressText.animate(
      [
        { transform: 'translateY(0)', opacity: .82, filter: 'brightness(1)' },
        { transform: goingUp ? 'translateY(-1px)' : 'translateY(1px)', opacity: 1, filter: goingUp ? 'brightness(1.18)' : 'brightness(.94)' },
        { transform: 'translateY(0)', opacity: 1, filter: 'brightness(1)' }
      ],
      { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)' }
    );
  }

  function scan({ force = false } = {}){
    container.querySelectorAll('.goal-card:not(.leaving)').forEach(card => animateCard(card, { force }));
  }

  const observer = new MutationObserver(() => requestAnimationFrame(() => scan()));
  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style', 'class']
  });

  requestAnimationFrame(() => scan({ force: true }));
})();
