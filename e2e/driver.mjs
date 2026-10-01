/**
 * The "human". ACT runs inside the page, looks at the decision UI exactly as a player would and
 * performs ONE click (hand card, option button, seat, confirm …). It is stringified by Playwright,
 * so it must stay self-contained. Returns a label for what it did, or null if nothing to do.
 */
export function ACT(r) {
  const W = (window.__e2e ||= { id: null, tries: 0, need: 0 });
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const click = (el) => el.click();
  const fresh = (id) => {
    if (W.id !== id) {
      W.id = id;
      W.tries = 0;
      W.need = null;
    } else W.tries++;
    return W.tries > 60 ? 'stuck' : null;
  };

  // A player with no connection can't usefully act (and the reconnect banner says so).
  if ($('.conn-banner')) return null;

  // Role selection overlay.
  const rp = $('.rolepick');
  if (rp) {
    const cards = $$('.card.is-clickable', rp);
    if (!cards.length) return null;
    if (fresh(rp.dataset.promptId || 'role')) return 'stuck';
    click(pick(cards));
    return 'role';
  }

  // A reveal confirmation is open → confirm (a human would, having chosen that move on purpose).
  const rc = $('.revealconfirm__actions .btn--gold');
  if (rc) {
    click(rc);
    return 'reveal-confirm';
  }

  // A "how to play this card" menu is open → choose one way.
  const menu = $$('.playmenu__item:not(.playmenu__item--cancel)');
  if (menu.length) {
    click(pick(menu));
    return 'menu';
  }

  const d = $('.decide');
  if (!d) return null;
  const kind = d.dataset.kind;
  const min = Number(d.dataset.min ?? 0);
  const max = Number(d.dataset.max ?? 0);
  if (fresh(d.dataset.promptId)) return 'stuck';
  const primary = () => $('.decide .btn--primary');
  const secondary = () => $$('.decide__row .btn').find((b) => !b.classList.contains('btn--primary'));

  switch (kind) {
    case 'turn': {
      const playable = $$('.hand .card.is-playable');
      const skills = $$('.decide .btn--gold');
      if ((!playable.length && !skills.length) || r < 0.28) {
        click(primary());
        return 'turn:end';
      }
      if (skills.length && r < 0.45) {
        click(pick(skills));
        return 'turn:skill';
      }
      click(pick(playable));
      return 'turn:card';
    }
    case 'choice': {
      const opts = $$('.decide .option:not([disabled])');
      if (!opts.length) return null;
      click(pick(opts));
      return 'choice';
    }
    case 'players': {
      const opts = $$('.decide .option--player');
      if (max === 1) {
        click(pick(opts));
        return 'players';
      }
      const chosen = $$('.decide .option--player.is-selected');
      const free = opts.filter((o) => !o.classList.contains('is-selected'));
      if (chosen.length < min && free.length) click(pick(free));
      else click(primary());
      return 'players:multi';
    }
    case 'cards': {
      const inHand = !$('.decide__cards');
      const pool = inHand ? $$('.hand .card.is-clickable') : $$('.decide__cards .card');
      if (W.need === null) {
        const cap = Math.min(max, pool.length);
        const lo = Math.min(min, cap);
        W.need = lo + Math.floor(r * 0.999 * (cap - lo + 1));
        if (!inHand) W.need = Math.max(W.need, 1);
      }
      const selected = pool.filter((c) => c.classList.contains('is-selected')).length;
      if (selected < W.need) {
        const free = pool.filter((c) => !c.classList.contains('is-selected'));
        if (!free.length) return null;
        click(pick(free));
        return 'cards:select';
      }
      if (W.need === 0) {
        const s = secondary();
        if (s) click(s);
        else click(primary());
      } else click(primary());
      return 'cards:confirm';
    }
    case 'number': {
      const plus = $$('.stepper .btn')[1];
      if (W.tries === 0 && plus && r < 0.6) {
        click(plus);
        return 'number:plus';
      }
      click(primary());
      return 'number';
    }
    case 'order':
      click(primary());
      return 'order';
  }
  return null;
}
