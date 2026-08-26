/**
 * JSON Vision — background service worker.
 *
 * Responsible only for seeding default preferences on install. It never
 * makes network requests, never reads page content, and never talks to
 * any external service — all state lives in chrome.storage.local on the
 * user's own machine.
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  theme: 'auto', // 'auto' | 'light' | 'dark'
};

/**
 * Populate chrome.storage.local with default settings the first time
 * the extension is installed. Existing settings are never overwritten,
 * so updates preserve whatever the user already configured.
 */
async function initializeDefaults() {
  try {
    const current = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    const missing = {};
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!(key in current)) {
        missing[key] = value;
      }
    }
    if (Object.keys(missing).length > 0) {
      await chrome.storage.local.set(missing);
    }
  } catch (error) {
    console.error('[JSON Vision] Failed to initialize default settings:', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  initializeDefaults();
});
