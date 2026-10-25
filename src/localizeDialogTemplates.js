import { JSComponent } from './toolkit';

/**
 * Remplace les placeholders @{Class.key} dans les templates de dialogue du DOM.
 * Conserve le HTML source pour pouvoir relocaliser après chargement IndexedDB / changement de langue.
 * @param {UserPreferences} preferences
 */
export function localizeDialogTemplates(preferences) {
  if (preferences == null || typeof document === "undefined") {
    return;
  }
  const templates = document.querySelectorAll(".dialog-template");
  for (let i = 0; i < templates.length; i++) {
    const el = templates[i];
    el.setAttribute("aria-hidden", "true");
    el.hidden = true;
    if (!el.dataset.localeSource && el.innerHTML) {
      el.dataset.localeSource = el.innerHTML;
    }
    const source = el.dataset.localeSource || el.innerHTML;
    if (source && source.indexOf("@{") >= 0) {
      el.innerHTML = JSComponent.substituteWithLocale(preferences, source);
    }
  }
}
