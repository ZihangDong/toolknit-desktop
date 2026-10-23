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

export function enhanceToolSelect(select) {
  if (!select || select.dataset.toolSelectReady === '1') return null;

  const id = `tool-custom-select-${++selectId}`;
  const listboxId = `${id}-listbox`;
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  const control = document.createElement('div');
  const trigger = document.createElement('button');
  const label = document.createElement('span');
  const chevron = document.createElement('i');
  const menu = document.createElement('div');
  const nativeTabIndex = select.getAttribute('tabindex');
  const nativeAriaHidden = select.getAttribute('aria-hidden');
  let signature = '';
  let open = false;
  let disposed = false;

  control.className = 'tool-custom-select';
  control.dataset.toolCustomSelect = id;
  trigger.className = 'tool-custom-select-trigger';
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', listboxId);
  label.className = 'tool-custom-select-label';
  chevron.dataset.lucide = 'chevron-down';
  chevron.setAttribute('aria-hidden', 'true');
  trigger.append(label, chevron);
  control.append(trigger);

  menu.className = 'tool-custom-select-menu';
  menu.id = listboxId;
  menu.dataset.toolCustomSelectMenu = id;
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  select.dataset.toolSelectReady = '1';
  select.classList.add('tool-custom-select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.insertAdjacentElement('afterend', control);
  document.body.append(menu);

  function optionButtons() {
    return Array.from(menu.querySelectorAll('[data-tool-select-value]'));
  }

  function selectedButton() {
    return optionButtons().find(item => item.dataset.toolSelectValue === select.value) || optionButtons()[0];
  }

  function positionMenu() {
    if (!open || menu.hidden) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const viewportPadding = 10;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
    const availableAbove = rect.top - viewportPadding - gap;
    const naturalHeight = Math.min(menu.scrollHeight, 292);
    const placeAbove = availableBelow < Math.min(naturalHeight, 150) && availableAbove > availableBelow;
    const available = Math.max(96, placeAbove ? availableAbove : availableBelow);
    const height = Math.min(naturalHeight, available);
    const width = Math.max(120, rect.width);
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
    );
    const top = placeAbove ? Math.max(viewportPadding, rect.top - height - gap) : rect.bottom + gap;

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.width = `${Math.round(width)}px`;
    menu.style.maxHeight = `${Math.floor(available)}px`;
    menu.dataset.placement = placeAbove ? 'top' : 'bottom';
  }

  function close({ restoreFocus = false } = {}) {
    if (!open) return;
    open = false;
    menu.hidden = true;
    control.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && !trigger.disabled) trigger.focus({ preventScroll: true });
  }

  function show(focusDirection = 0) {
    if (open || trigger.disabled) return;
    open = true;
    menu.hidden = false;
    menu.style.visibility = 'hidden';
    control.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    positionMenu();
    menu.style.visibility = '';
    if (focusDirection) {
      const items = optionButtons().filter(item => !item.disabled);
      const target = focusDirection < 0 ? items.at(-1) : selectedButton() || items[0];
      target?.focus({ preventScroll: true });
    }
  }

  function rebuildOptions() {
    menu.replaceChildren(...Array.from(select.options).map((option, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `${id}-option-${index}`;
      button.dataset.toolSelectValue = option.value;
      button.setAttribute('role', 'option');
      button.textContent = option.textContent;
      button.disabled = option.disabled;
      return button;
    }));
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
    else show();
  }, options);

  trigger.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    show(event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1);
  }, options);

  menu.addEventListener('click', event => {
    const button = event.target.closest('[data-tool-select-value]');
    if (button) choose(button);
  }, options);

  menu.addEventListener('keydown', event => {
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
  document.addEventListener('keydown', event => {
    if (!open || event.defaultPrevented || event.key !== 'Escape') return;
    event.preventDefault();
    close({ restoreFocus: true });
  }, options);
  document.addEventListener('pointerdown', event => {
    if (!open || control.contains(event.target) || menu.contains(event.target)) return;
    close();
  }, { ...options, capture: true });
  window.addEventListener('resize', () => close(), options);
  document.addEventListener('scroll', event => {
    if (!open || menu.contains(event.target)) return;
    close();
  }, { ...options, capture: true, passive: true });

  const observer = new MutationObserver(refresh);
  observer.observe(select, { attributes: true, childList: true, characterData: true, subtree: true });
  refresh();

  return {
    refresh,
    close,
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
  return Array.from(selects || []).map(enhanceToolSelect).filter(Boolean);
}
