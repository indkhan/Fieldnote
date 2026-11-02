// Pure rules for in-app updates, kept separate from the DOM code so they can be tested.

export function installBlockReason({ recordingActive, saveState, propertySaveState }) {
  if (recordingActive) return 'Stop recording before installing an update.';
  if (saveState === 'error' || propertySaveState === 'error') return 'Some changes are not saved. Retry saving before installing an update.';
  if (saveState === 'pending' || saveState === 'saving' || propertySaveState === 'pending' || propertySaveState === 'saving') {
    return 'Changes are still being saved. Try again in a moment.';
  }
  return null;
}

export function downloadPercent(downloaded, total) {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.floor((downloaded / total) * 100));
}
