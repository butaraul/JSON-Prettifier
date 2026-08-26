/**
 * JSON Vision — popup script.
 * Reads and writes the user's preferences (enabled/theme) to
 * chrome.storage.local. No network requests, no analytics.
 */
(function () {
  'use strict';

  const enabledToggle = document.getElementById('jv-enabled-toggle');
  const themeSelect = document.getElementById('jv-theme-select');
  const statusEl = document.getElementById('jv-popup-status');

  let statusTimer = null;

  function showStatus(message) {
    statusEl.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusEl.textContent = '';
    }, 1500);
  }

  async function loadSettings() {
    try {
      const { enabled = true, theme = 'auto' } = await chrome.storage.local.get(['enabled', 'theme']);
      enabledToggle.checked = enabled !== false;
      themeSelect.value = theme;
    } catch (err) {
      console.error('[JSON Vision] Failed to load settings:', err);
      showStatus('Could not load settings');
    }
  }

  async function saveSetting(partial) {
    try {
      await chrome.storage.local.set(partial);
      showStatus('Saved');
    } catch (err) {
      console.error('[JSON Vision] Failed to save settings:', err);
      showStatus('Could not save settings');
    }
  }

  enabledToggle.addEventListener('change', () => {
    saveSetting({ enabled: enabledToggle.checked });
  });

  themeSelect.addEventListener('change', () => {
    saveSetting({ theme: themeSelect.value });
  });

  loadSettings();
})();
