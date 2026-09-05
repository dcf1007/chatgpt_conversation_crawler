import { captureMountedAppBlocks } from './app-blocks.mjs';
import { crawlConversation as crawlConversationCore, installCrawler } from './crawler-core.mjs';

export { installCrawler };

export async function crawlConversation(page, { onProgress, shouldCancel } = {}) {
  const wrappedProgress = async patch => {
    let nextPatch = patch;
    const shouldCapture = Object.prototype.hasOwnProperty.call(patch || {}, 'scrollHeight')
      || patch?.phase === 'Preparing crawler'
      || patch?.scanComplete === true;

    if (shouldCapture) {
      const appState = await captureMountedAppBlocks(page).catch(() => null);
      if (appState) {
        nextPatch = {
          ...patch,
          appBlocks: appState.captured,
          appBlockCaptureFailures: appState.failures
        };
      }
    }

    await onProgress?.(nextPatch);
  };

  return crawlConversationCore(page, { onProgress: wrappedProgress, shouldCancel });
}
