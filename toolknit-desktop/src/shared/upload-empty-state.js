// All arguments are static template configuration, never file names or user input.
export function uploadEmptyStateMarkup({ id, className = '', icon, title, description, pickId, pick, limit }) {
  return `<div id="${id}" class="tk-empty-hero tk-upload-empty ${className}">
    <div class="tk-empty-hero-icon" aria-hidden="true"><i data-lucide="${icon}"></i></div>
    <span class="tk-empty-hero-kicker">LOCAL PDF WORKSPACE</span>
    <h2 data-i18n="${title}"></h2><p class="tk-empty-hero-description" data-i18n="${description}"></p>
    <button id="${pickId}" class="tk-upload-empty-pick" type="button"><i data-lucide="upload"></i><span data-i18n="${pick}"></span></button>
    <small data-i18n="${limit}"></small></div>`;
}
