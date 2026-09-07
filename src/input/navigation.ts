const selector =
  'button:not(:disabled),select:not(:disabled),input:not(:disabled):not([type=hidden]),textarea:not(:disabled),summary,[tabindex="0"]';
export function inputScope() {
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role=dialog]')];
  return (
    dialogs.at(-1) ??
    document.querySelector<HTMLElement>('.lab-drawer') ??
    document.querySelector<HTMLElement>('.app')!
  );
}
export function focusable(scope = inputScope()) {
  return [...scope.querySelectorAll<HTMLElement>(selector)].filter(
    (e) =>
      !e.closest('[inert]') &&
      e.getClientRects().length > 0 &&
      getComputedStyle(e).visibility !== 'hidden',
  );
}
export function focusElement(el?: HTMLElement) {
  el?.focus({ preventScroll: true });
  el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
export function navigate(direction: 'up' | 'down' | 'left' | 'right') {
  const elements = focusable(),
    active = document.activeElement as HTMLElement;
  if (!elements.includes(active)) {
    focusElement(elements.find((e) => e.hasAttribute('data-pad-default')) ?? elements[0]);
    return;
  }
  if (active instanceof HTMLSelectElement) {
    const delta = direction === 'down' || direction === 'right' ? 1 : -1;
    let index = active.selectedIndex + delta;
    while (index >= 0 && index < active.options.length && active.options[index].disabled)
      index += delta;
    if (index >= 0 && index < active.options.length) {
      active.selectedIndex = index;
      active.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return;
  }
  if (active instanceof HTMLInputElement && ['number', 'range'].includes(active.type)) {
    if (direction === 'left') active.stepDown();
    else if (direction === 'right') active.stepUp();
    else {
      focusElement(
        elements[
          (elements.indexOf(active) + (direction === 'down' ? 1 : elements.length - 1)) %
            elements.length
        ],
      );
      return;
    }
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const r = active.getBoundingClientRect(),
    x = r.x + r.width / 2,
    y = r.y + r.height / 2;
  const vertical = direction === 'up' || direction === 'down',
    sign = direction === 'up' || direction === 'left' ? -1 : 1;
  const candidates = elements
    .filter((e) => e !== active)
    .map((e) => {
      const b = e.getBoundingClientRect(),
        dx = b.x + b.width / 2 - x,
        dy = b.y + b.height / 2 - y;
      const forward = (vertical ? dy : dx) * sign,
        side = Math.abs(vertical ? dx : dy);
      // Prefer controls in the same visual row/column before a diagonal jump.
      const beam = vertical
        ? Math.min(r.right, b.right) > Math.max(r.left, b.left)
        : Math.min(r.bottom, b.bottom) > Math.max(r.top, b.top);
      return { e, forward, beam, score: forward + side * 2.5 };
    })
    .filter((c) => c.forward > 4)
    .sort((a, b) => Number(b.beam) - Number(a.beam) || a.score - b.score);
  focusElement(candidates[0]?.e);
}
export function cycleFocus(delta: number) {
  const es = focusable(),
    index = es.indexOf(document.activeElement as HTMLElement);
  focusElement(es[(index + delta + es.length) % es.length]);
}
export function activateFocused() {
  const es = focusable();
  let el = document.activeElement as HTMLElement;
  if (!es.includes(el)) {
    el = es.find((e) => e.hasAttribute('data-pad-default')) ?? es[0];
    focusElement(el);
    return;
  }
  if (
    el instanceof HTMLButtonElement ||
    el.tagName === 'SUMMARY' ||
    (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type))
  )
    el.click();
}
