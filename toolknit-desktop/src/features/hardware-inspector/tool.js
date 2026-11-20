import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { getLang, onLangChange, t } from '../../i18n.js';
import { createHardwareSnapshotController } from './controller.js';
import { createCpuMemoryDefinition } from './cpu-memory.js';
import { createGpuDisplayDefinition } from './gpu-display.js';
import { createHardwareOverviewDefinition } from './overview.js';
import { createMainboardDefinition } from './mainboard.js';
import { createPowerSensorsDefinition } from './power-sensors.js';
import { createStorageDefinition } from './storage.js';
import { createNetworkDevicesDefinition } from './network-devices.js';
import {
  hardwareCpuMemoryTemplate,
  hardwareGpuDisplayTemplate,
  hardwareMainboardTemplate,
  hardwareNetworkDevicesTemplate,
  hardwareOverviewTemplate,
  hardwarePowerSensorsTemplate,
  hardwareStorageTemplate
} from './templates.js';
import './hardware-inspector.css';
import './hardware-inspector-overrides.css';


const WEBSITE_URL = 'https://toolknit.com';

function initHardwareSnapshotTool({
  overlay,
  template,
  createDefinition,
  isTauri,
  notify,
  refreshIcons = () => {},
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = disposer => disposer?.(),
  openSettings = () => {},
  openSupport = () => {},
  openExternalUrl = () => {},
  handleWindowAction = () => {}
}) {
  if (!overlay) throw new Error('hardware-inspector:missing-overlay');
  overlay.innerHTML = template();
  refreshIcons();

  const lifecycle = createLifecycleScope();
  const definition = createDefinition({ t, getLang });
  const controller = createHardwareSnapshotController({
    overlay,
    definition,
    isTauri,
    onLangChange,
    notify
  });
  let opened = false;
  let disposed = false;
  let plasma = null;

  const api = {
    open() {
      if (disposed || opened) return;
      opened = true;
      overlay.classList.add('visible');
      overlay.setAttribute('aria-hidden', 'false');
      plasma = initStandardToolPlasma(overlay.querySelector('.pdf-merge-v2-bg'));
      controller.open();
      refreshIcons();
    },
    close() {
      if (!opened) return;
      opened = false;
      controller.close();
      disposeStandardToolPlasma(plasma);
      plasma = null;
      overlay.classList.remove('visible');
      overlay.setAttribute('aria-hidden', 'true');
    },
    dispose() {
      if (disposed) return;
      api.close();
      disposed = true;
      controller.dispose();
      lifecycle.dispose();
      overlay.replaceChildren();
    }
  };

  lifecycle.event(overlay.querySelector('.settings-v2-back'), 'click', () => api.close());
  lifecycle.event(overlay.querySelector('[data-home-link="website"]'), 'click', event => {
    event.preventDefault();
    void openExternalUrl(WEBSITE_URL);
  });
  lifecycle.event(overlay.querySelector('[data-open-support]'), 'click', () => openSupport());
  lifecycle.event(overlay.querySelector('[id$="V2Settings"]'), 'click', () => openSettings());
  overlay.querySelectorAll('.ctrl-btn[data-action]').forEach(button => {
    lifecycle.event(button, 'pointerdown', event => event.stopPropagation(), { capture: true });
    lifecycle.event(button, 'mousedown', event => event.stopPropagation(), { capture: true });
    lifecycle.event(button, 'click', event => {
      event.preventDefault();
      event.stopPropagation();
      void handleWindowAction(button.dataset.action);
    });
  });
  return api;
}

export function initHardwareOverviewTool(context) {
  return initHardwareSnapshotTool({ ...context, template: hardwareOverviewTemplate, createDefinition: createHardwareOverviewDefinition });
}

export function initHardwareCpuMemoryTool(context) {
  return initHardwareSnapshotTool({ ...context, template: hardwareCpuMemoryTemplate, createDefinition: createCpuMemoryDefinition });
}

export function initHardwareGpuDisplayTool(context) {
  return initHardwareSnapshotTool({ ...context, template: hardwareGpuDisplayTemplate, createDefinition: createGpuDisplayDefinition });
}

export function initHardwareMainboardTool(context) {
  return initHardwareSnapshotTool({ ...context, template: hardwareMainboardTemplate, createDefinition: createMainboardDefinition });
}

export function initHardwareStorageTool(context) {
  return initHardwareSnapshotTool({ ...context, template: hardwareStorageTemplate, createDefinition: createStorageDefinition });
}

export function initHardwareNetworkDevicesTool(context) {
  return initHardwareSnapshotTool({ ...context, template: hardwareNetworkDevicesTemplate, createDefinition: createNetworkDevicesDefinition });
}

export function initHardwarePowerSensorsTool(context) {
  return initHardwareSnapshotTool({ ...context, template: hardwarePowerSensorsTemplate, createDefinition: createPowerSensorsDefinition });
}
