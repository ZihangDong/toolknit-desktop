import donationTemplate from './templates/donation.html?raw';
import updateDialogTemplate from './templates/update-dialog.html?raw';
import settingsTemplate from './templates/settings.html?raw';
import helpTemplate from './templates/help.html?raw';
import legalTemplate from './templates/legal.html?raw';
import feedbackTemplate from './templates/feedback.html?raw';
import aiKeyTemplate from './templates/ai-key.html?raw';
import dependencyManagersTemplate from './templates/dependency-managers.html?raw';
import globalDialogsTemplate from './templates/global-dialogs.html?raw';
import customToolsTemplate from './templates/custom-tools.html?raw';
import { mountTrustedTemplate } from './trusted-template-runtime.js';
import { toolTopbarMarkup } from '../shared/tool-page-shell.js';

const STATIC_TEMPLATE_SPECS = Object.freeze([
  Object.freeze({ name: 'custom-tools', markup: customToolsTemplate, rootSelector: '#customToolsOverlay' }),
  Object.freeze({
    name: 'donation',
    markup: donationTemplate,
    rootSelector: '#donationOverlay'
  }),
  Object.freeze({
    name: 'update-dialog',
    markup: updateDialogTemplate,
    rootSelector: '#updateDialog'
  }),
  Object.freeze({
    name: 'settings',
    markup: settingsTemplate,
    rootSelector: '#settingsOverlay'
  }),
  Object.freeze({
    name: 'help',
    markup: helpTemplate,
    rootSelector: '#helpOverlay'
  }),
  Object.freeze({
    name: 'legal',
    markup: legalTemplate.replace('<!-- legal-topbar -->', toolTopbarMarkup({
      tag: '<span id="legalTopTag">ToolKnit Program Declaration</span>',
      title: '',
      closeAttr: 'id="legalBackBtn" data-i18n-title="legal.back"'
    })),
    rootSelector: '#legalOverlay'
  }),
  Object.freeze({
    name: 'feedback',
    markup: feedbackTemplate,
    rootSelector: '#feedbackOverlay'
  }),
  Object.freeze({
    name: 'ai-key',
    markup: aiKeyTemplate.replace('<!-- ai-key-topbar -->', toolTopbarMarkup({
      tag: 'AI KEY SETTINGS · TOOL PAGE 3.2',
      title: 'AI Platform Keys',
      closeAttr: 'id="apiKeyBack" data-i18n-title="apiKey.backToSettings"'
    })),
    rootSelector: '#apiKeyOverlay'
  }),
  Object.freeze({
    name: 'dependency-managers',
    markup: dependencyManagersTemplate,
    rootSelector: '#transcriptionModelOverlay'
  }),
  Object.freeze({
    name: 'global-dialogs',
    markup: globalDialogsTemplate,
    rootSelector: '#dependencyGateOverlay'
  })
]);

function mountTemplate({ markup, rootSelector }, host = document.body) {
  if (!host || typeof markup !== 'string') return null;
  const existing = rootSelector ? document.querySelector(rootSelector) : null;
  if (existing) return existing;

  mountTrustedTemplate(markup, { root: document, host });
  return rootSelector ? document.querySelector(rootSelector) : null;
}

export function bootstrapStaticTemplates(host = document.body) {
  if (!host) return [];
  return STATIC_TEMPLATE_SPECS
    .map(spec => mountTemplate(spec, host))
    .filter(Boolean);
}

// main.js is loaded at the end of body, so synchronous mounting avoids a
// race with application initialization and keeps all template DOM contracts.
if (typeof document !== 'undefined' && document.body) bootstrapStaticTemplates();
