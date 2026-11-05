let selectId = 0;

function optionSignature(select) {
  return Array.from(select.options)
    .map(option => `${option.value}\u0000${option.textContent}\u0000${option.disabled}`)
    .join('\u0001');
}

function fieldLabel(select) {
  const label = select.closest('label');
  const labelText = label?.querySelector(':scope > span')?.textContent?.trim();
  return labelText || select.getAttribute('aria-label') || select.name || 'Select option';
}

export function enhanceToolSelect(select, config = {}) {
  if (!select || select.dataset.toolSelectReady === '1') return null;

  const doc = select.ownerDocument || document;
  const view = doc.defaultView || window;
  const boundary = config.boundary || null;
  const text = (value, fallback) => typeof value === 'function' ? value() : value || fallback;

  const id = `tool-custom-select-${++selectId}`;
  const listboxId = `${id}-listbox`;
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  const control = doc.createElement('div');
  const trigger = doc.createElement('button');
  const label = doc.createElement('span');
  const chevron = doc.createElement('i');
  const menu = doc.createElement('div');
  const search = config.searchable ? doc.createElement('input') : null;
  const listbox = search ? doc.createElement('div') : menu;
  const empty = search ? doc.createElement('p') : null;
  const nativeTabIndex = select.getAttribute('tabindex');
  const nativeAriaHidden = select.getAttribute('aria-hidden');
  let signature = '';
  let open = false;
  let disposed = false;
  let composing = false;
  let activeValue = null;

  control.className = 'tool-custom-select';
  if (config.controlClass) control.classList.add(config.controlClass);
  control.dataset.toolCustomSelect = id;
  trigger.className = 'tool-custom-select-trigger';
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', search ? 'dialog' : 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', search ? `${id}-menu` : listboxId);
  label.className = 'tool-custom-select-label';
  chevron.dataset.lucide = 'chevron-down';
  chevron.setAttribute('aria-hidden', 'true');
  trigger.append(label, chevron);
  control.append(trigger);

  menu.className = 'tool-custom-select-menu';
  if (config.menuClass) menu.classList.add(config.menuClass);
  menu.id = search ? `${id}-menu` : listboxId;
  menu.dataset.toolCustomSelectMenu = id;
  menu.setAttribute('role', search ? 'dialog' : 'listbox');
  menu.hidden = true;
  if (search) {
    menu.classList.add('is-searchable');
    search.type = 'text'; search.className = 'tool-custom-select-search';
    search.autocomplete = 'off'; search.spellcheck = false; search.maxLength = 256;
    search.setAttribute('role', 'combobox'); search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-controls', listboxId); search.setAttribute('aria-expanded', 'false');
    listbox.className = 'tool-custom-select-options'; listbox.id = listboxId; listbox.setAttribute('role', 'listbox');
    empty.className = 'tool-custom-select-empty'; empty.hidden = true; empty.setAttribute('role', 'status');
    menu.append(search, listbox, empty);
  }

  select.dataset.toolSelectReady = '1';
  select.classList.add('tool-custom-select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.insertAdjacentElement('afterend', control);
  (boundary || doc.body).append(menu);
  if (boundary) menu.style.position = 'absolute';

  function optionButtons() {
    return Array.from(listbox.querySelectorAll('[data-tool-select-value]'));
  }
  function visibleButtons() { return optionButtons().filter(item => !item.disabled && !item.hidden); }

  function selectedButton() {
    return optionButtons().find(item => item.dataset.toolSelectValue === select.value) || optionButtons()[0];
  }

  function positionMenu() {
    if (!open || menu.hidden) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const viewportPadding = 10;
    const bounds = boundary?.getBoundingClientRect() || { left: 0, top: 0, right: view.innerWidth, bottom: view.innerHeight, width: view.innerWidth };
    const availableBelow = bounds.bottom - rect.bottom - viewportPadding - gap;
    const availableAbove = rect.top - bounds.top - viewportPadding - gap;
    const naturalHeight = Math.min(menu.scrollHeight, 292);
    const placeAbove = availableBelow < Math.min(naturalHeight, 150) && availableAbove > availableBelow;
    const available = Math.max(32, placeAbove ? availableAbove : availableBelow);
    const height = Math.min(naturalHeight, available);
    const width = Math.min(Math.max(search ? 230 : 120, rect.width), Math.max(32, bounds.width - viewportPadding * 2));
    const left = Math.min(
      Math.max(bounds.left + viewportPadding, rect.left),
      Math.max(bounds.left + viewportPadding, bounds.right - width - viewportPadding)
    );
    const top = placeAbove ? Math.max(bounds.top + viewportPadding, rect.top - height - gap) : rect.bottom + gap;

    menu.style.left = `${Math.round(left - (boundary ? bounds.left + boundary.clientLeft : 0))}px`;
    menu.style.top = `${Math.round(top - (boundary ? bounds.top + boundary.clientTop : 0))}px`;
    menu.style.width = `${Math.round(width)}px`;
    menu.style.maxHeight = `${Math.floor(Math.min(292, available))}px`;
    menu.dataset.placement = placeAbove ? 'top' : 'bottom';
  }

  function close({ restoreFocus = false } = {}) {
    if (!open) return;
    open = false;
    if (restoreFocus && !trigger.disabled) trigger.focus({ preventScroll: true });
    else if (menu.contains(doc.activeElement)) doc.activeElement.blur();
    menu.hidden = true;
    composing = false;
    search?.setAttribute('aria-expanded', 'false');
    control.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  function show(focusDirection = 0) {
    if (open || trigger.disabled) return;
    open = true;
    menu.hidden = false;
    menu.style.visibility = 'hidden';
    control.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    if (search) { search.value = ''; activeValue = select.value; filterOptions(); search.setAttribute('aria-expanded', 'true'); }
    positionMenu();
    menu.style.visibility = '';
    if (search) search.focus({ preventScroll: true });
    else if (focusDirection) {
      const items = optionButtons().filter(item => !item.disabled);
      const target = focusDirection < 0 ? items.at(-1) : selectedButton() || items[0];
      target?.focus({ preventScroll: true });
    }
  }

  function rebuildOptions() {
    listbox.replaceChildren(...Array.from(select.options).map((option, index) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.id = `${id}-option-${index}`;
      button.dataset.toolSelectValue = option.value;
      button.setAttribute('role', 'option');
      button.textContent = option.textContent;
      button.disabled = option.disabled;
      if (search) button.tabIndex = -1;
      return button;
    }));
    filterOptions();
  }

  function filterOptions() {
    if (!search) return;
    const query = search.value.trim().replace(/^\./, '').toLocaleLowerCase();
    for (const button of optionButtons()) {
      button.hidden = Boolean(query) && !`${button.dataset.toolSelectValue} ${button.textContent}`.toLocaleLowerCase().includes(query);
    }
    const items = visibleButtons();
    const active = items.find(button => button.dataset.toolSelectValue === activeValue) || items[0];
    activeValue = active?.dataset.toolSelectValue ?? null;
    for (const button of optionButtons()) button.classList.toggle('is-active', button === active);
    if (active) search.setAttribute('aria-activedescendant', active.id); else search.removeAttribute('aria-activedescendant');
    empty.hidden = items.length > 0;
    if (open) positionMenu();
  }

  function refresh() {
    if (disposed) return;
    const nextSignature = optionSignature(select);
    if (nextSignature !== signature) {
      signature = nextSignature;
      rebuildOptions();
    }

    const selected = select.options[select.selectedIndex] || select.options[0];
    label.textContent = selected?.textContent || '';
    trigger.disabled = select.disabled;
    trigger.setAttribute('aria-label', `${fieldLabel(select)}：${label.textContent}`);
    menu.setAttribute('aria-label', fieldLabel(select));
    if (search) {
      search.placeholder = text(config.searchPlaceholder, fieldLabel(select)); search.setAttribute('aria-label', search.placeholder);
      empty.textContent = text(config.emptyLabel, fieldLabel(select)); listbox.setAttribute('aria-label', fieldLabel(select));
    }
    control.classList.toggle('is-disabled', select.disabled);
    optionButtons().forEach(button => {
      const isSelected = button.dataset.toolSelectValue === select.value;
      button.classList.toggle('is-selected', isSelected);
      button.setAttribute('aria-selected', String(isSelected));
    });
    if (select.disabled) close();
    else if (open) positionMenu();
  }

  function choose(button) {
    if (!button || button.disabled) return;
    select.value = button.dataset.toolSelectValue;
    refresh();
    close({ restoreFocus: true });
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  trigger.addEventListener('click', event => {
    event.preventDefault();
    if (open) close();
    else { doc.dispatchEvent(new CustomEvent('tool-select-opening', { detail: id })); show(); }
  }, options);

  trigger.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    doc.dispatchEvent(new CustomEvent('tool-select-opening', { detail: id }));
    show(event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1);
  }, options);

  menu.addEventListener('click', event => {
    const button = event.target.closest('[data-tool-select-value]');
    if (button) choose(button);
  }, options);

  menu.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229 || composing) { event.stopPropagation(); return; }
    if (event.target === search) {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); choose(visibleButtons().find(b => b.dataset.toolSelectValue === activeValue)); }
      else if (['ArrowDown','ArrowUp'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const items = visibleButtons(), at = items.findIndex(b => b.dataset.toolSelectValue === activeValue);
        const target = items[Math.max(0, Math.min(items.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
        activeValue = target?.dataset.toolSelectValue ?? null; filterOptions(); target?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Tab') close({ restoreFocus: true });
      return;
    }
    const button = event.target.closest('[data-tool-select-value]');
    if (!button) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(button);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    if (event.key === 'Tab') {
      // Continue from the trigger's place in the form, not the body portal.
      close({ restoreFocus: true });
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = optionButtons().filter(item => !item.disabled);
    let index = items.indexOf(button);
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = items.length - 1;
    else index = Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    items[index]?.focus({ preventScroll: true });
  }, options);

  select.addEventListener('change', refresh, options);
  search?.addEventListener('input', () => { if (!composing) { activeValue = null; filterOptions(); } }, options);
  search?.addEventListener('compositionstart', () => { composing = true; }, options);
  search?.addEventListener('compositionend', () => { composing = false; activeValue = null; filterOptions(); }, options);
  doc.addEventListener('tool-select-opening', event => { if (event.detail !== id) close(); }, options);
  doc.addEventListener('keydown', event => {
    if (!open || event.defaultPrevented || event.key !== 'Escape') return;
    if (event.isComposing || event.keyCode === 229 || composing) { event.stopPropagation(); return; }
    event.preventDefault();
    event.stopPropagation();
    close({ restoreFocus: true });
  }, { ...options, capture: true });
  doc.addEventListener('pointerdown', event => {
    if (!open || control.contains(event.target) || menu.contains(event.target)) return;
    close();
  }, { ...options, capture: true });
  view.addEventListener('resize', () => close(), options);
  doc.addEventListener('scroll', event => {
    if (!open || menu.contains(event.target)) return;
    close();
  }, { ...options, capture: true, passive: true });

  const observer = new MutationObserver(refresh);
  observer.observe(select, { attributes: true, childList: true, characterData: true, subtree: true });
  refresh();

  return {
    refresh,
    close,
    isOpen: () => open,
    dispose() {
      if (disposed) return;
      disposed = true;
      close();
      observer.disconnect();
      listeners.abort();
      menu.remove();
      control.remove();
      select.classList.remove('tool-custom-select-native');
      if (nativeTabIndex === null) select.removeAttribute('tabindex');
      else select.setAttribute('tabindex', nativeTabIndex);
      if (nativeAriaHidden === null) select.removeAttribute('aria-hidden');
      else select.setAttribute('aria-hidden', nativeAriaHidden);
      delete select.dataset.toolSelectReady;
    }
  };
}

export function enhanceToolSelects(selects) {
  return Array.from(selects || []).map(select => enhanceToolSelect(select)).filter(Boolean);
}
