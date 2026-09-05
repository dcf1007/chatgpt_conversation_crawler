const APP_BLOCK_STORE = Symbol.for('chatgpt-conversation-crawler.app-blocks');
const APP_BLOCK_SELECTOR = '[data-app-block-preview="true"] iframe[title="App block preview"]';
const MAX_APP_BLOCKS = 50;
const MAX_APP_BLOCK_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_APP_BLOCK_BYTES = 32 * 1024 * 1024;
const MAX_FRAME_DEPTH = 8;

const STYLE_PROPERTIES = [
  'display','position','box-sizing',
  'width','min-width','max-width','height','min-height','max-height',
  'margin-top','margin-right','margin-bottom','margin-left',
  'padding-top','padding-right','padding-bottom','padding-left',
  'gap','row-gap','column-gap',
  'grid-template-columns','grid-template-rows','grid-auto-flow','grid-column','grid-row',
  'flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis',
  'align-items','align-content','align-self','justify-content','justify-items','justify-self',
  'overflow','overflow-x','overflow-y',
  'background-color','color',
  'border-top-width','border-right-width','border-bottom-width','border-left-width',
  'border-top-style','border-right-style','border-bottom-style','border-left-style',
  'border-top-color','border-right-color','border-bottom-color','border-left-color',
  'border-radius','box-shadow',
  'font-family','font-size','font-weight','font-style','line-height','letter-spacing',
  'text-align','text-decoration','text-transform','white-space','word-break','overflow-wrap',
  'opacity','transform','transform-origin',
  'fill','fill-opacity','stroke','stroke-opacity','stroke-width','stroke-dasharray',
  'stroke-dashoffset','stroke-linecap','stroke-linejoin','vector-effect'
];

function appState(page) {
  if (!page[APP_BLOCK_STORE]) {
    page[APP_BLOCK_STORE] = {
      blocks: new Map(),
      failures: new Map(),
      sequence: 0,
      totalBytes: 0,
      lastAttemptAt: new Map()
    };
  }
  return page[APP_BLOCK_STORE];
}

function absoluteUrl(value, base) {
  if (!value) return '';
  try { return new URL(value, base).href; } catch { return String(value); }
}

async function snapshotFrameTree(frame, state, depth = 0) {
  if (!frame || depth > MAX_FRAME_DEPTH) return null;

  const iframeHandles = await frame.$$('iframe').catch(() => []);
  const childFrames = [];
  for (const handle of iframeHandles) {
    childFrames.push(await handle.contentFrame().catch(() => null));
  }
  const tokens = childFrames.map(() => `__ARCHIVE_APP_FRAME_${++state.sequence}__`);

  const captured = await frame.evaluate(({ styleProperties, tokens }) => {
    const body = document.body;
    if (!body) return null;

    const originalElements = [body, ...body.querySelectorAll('*')];
    const clone = body.cloneNode(true);
    const clonedElements = [clone, ...clone.querySelectorAll('*')];

    for (let i = 0; i < Math.min(originalElements.length, clonedElements.length); i++) {
      const original = originalElements[i];
      const copied = clonedElements[i];
      copied.removeAttribute('class');
      copied.removeAttribute('style');

      let computed;
      try { computed = getComputedStyle(original); } catch { computed = null; }
      if (computed) {
        for (const property of styleProperties) {
          const value = computed.getPropertyValue(property);
          if (!value) continue;
          try { copied.style.setProperty(property, value); } catch {}
        }
      }

      for (const attribute of [...copied.attributes]) {
        if (/^on/i.test(attribute.name) || ['nonce','integrity','srcdoc'].includes(attribute.name.toLowerCase())) {
          copied.removeAttribute(attribute.name);
        }
      }
    }

    const originalCanvases = [...body.querySelectorAll('canvas')];
    const clonedCanvases = [...clone.querySelectorAll('canvas')];
    clonedCanvases.forEach((canvas, i) => {
      const original = originalCanvases[i];
      let dataUrl = '';
      try { dataUrl = original?.toDataURL?.('image/png') || ''; } catch {}
      if (dataUrl) {
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = original?.getAttribute('aria-label') || original?.getAttribute('title') || 'Canvas from app block preview';
        img.setAttribute('style', canvas.getAttribute('style') || '');
        canvas.replaceWith(img);
      } else {
        const fallback = document.createElement('div');
        fallback.textContent = '[Canvas content could not be serialized]';
        fallback.setAttribute('style', canvas.getAttribute('style') || '');
        canvas.replaceWith(fallback);
      }
    });

    const clonedIframes = [...clone.querySelectorAll('iframe')];
    clonedIframes.forEach((iframe, i) => {
      const placeholder = document.createElement('div');
      placeholder.textContent = tokens[i] || '[Nested app frame unavailable]';
      placeholder.setAttribute('data-archive-app-frame-placeholder', '');
      iframe.replaceWith(placeholder);
    });

    clone.querySelectorAll('script,noscript,style,object,embed,form,input,textarea,select,option,link,meta,base').forEach(el => el.remove());

    for (const a of clone.querySelectorAll('a[href]')) {
      try {
        const url = new URL(a.getAttribute('href'), location.href);
        if (!/^https?:$/i.test(url.protocol)) a.removeAttribute('href');
        else a.setAttribute('href', url.href);
      } catch {
        a.removeAttribute('href');
      }
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }

    for (const img of clone.querySelectorAll('img')) {
      const raw = img.getAttribute('src') || '';
      if (raw && !/^data:/i.test(raw)) {
        try { img.setAttribute('src', new URL(raw, location.href).href); } catch {}
      }
      img.removeAttribute('srcset');
      img.setAttribute('loading', 'eager');
    }

    for (const source of clone.querySelectorAll('source[src]')) {
      try { source.setAttribute('src', new URL(source.getAttribute('src'), location.href).href); } catch {}
      source.removeAttribute('srcset');
    }

    for (const use of clone.querySelectorAll('svg use[href],svg use[xlink\\:href]')) {
      const attr = use.hasAttribute('href') ? 'href' : 'xlink:href';
      const raw = use.getAttribute(attr) || '';
      if (raw && !raw.startsWith('#')) {
        try { use.setAttribute(attr, new URL(raw, location.href).href); } catch {}
      }
    }

    return {
      html: clone.innerHTML,
      textLength: (body.innerText || body.textContent || '').length,
      svgCount: body.querySelectorAll('svg').length,
      imageCount: body.querySelectorAll('img').length,
      canvasCount: body.querySelectorAll('canvas').length
    };
  }, { styleProperties: STYLE_PROPERTIES, tokens }).catch(() => null);

  if (!captured) return null;

  let html = captured.html;
  let frameCount = 1;
  let svgCount = captured.svgCount || 0;
  let imageCount = captured.imageCount || 0;
  let canvasCount = captured.canvasCount || 0;
  let textLength = captured.textLength || 0;

  for (let i = 0; i < childFrames.length; i++) {
    const child = await snapshotFrameTree(childFrames[i], state, depth + 1).catch(() => null);
    const replacement = child
      ? `<div class="archive-app-frame">${child.html}</div>`
      : '<div class="archive-app-frame archive-app-frame-missing">[Nested app frame could not be captured]</div>';
    html = html.replaceAll(tokens[i], replacement);
    if (child) {
      frameCount += child.frameCount || 0;
      svgCount += child.svgCount || 0;
      imageCount += child.imageCount || 0;
      canvasCount += child.canvasCount || 0;
      textLength += child.textLength || 0;
    }
  }

  return { html, frameCount, svgCount, imageCount, canvasCount, textLength };
}

export async function captureMountedAppBlocks(page) {
  const state = appState(page);
  const handles = await page.locator(APP_BLOCK_SELECTOR).elementHandles().catch(() => []);

  for (const handle of handles.slice(0, MAX_APP_BLOCKS)) {
    let sourceUrl = '';
    try {
      const raw = await handle.getAttribute('src');
      sourceUrl = absoluteUrl(raw, page.url());
      if (!sourceUrl) continue;

      const now = Date.now();
      const lastAttempt = state.lastAttemptAt.get(sourceUrl) || 0;
      if (state.blocks.has(sourceUrl) && now - lastAttempt < 1500) continue;
      state.lastAttemptAt.set(sourceUrl, now);

      const rootFrame = await handle.contentFrame();
      if (!rootFrame) {
        state.failures.set(sourceUrl, 'App block iframe is mounted but its frame is not ready yet.');
        continue;
      }

      const snapshot = await snapshotFrameTree(rootFrame, state);
      if (!snapshot?.html) {
        state.failures.set(sourceUrl, 'App block frame returned no serializable content.');
        continue;
      }

      const bytes = Buffer.byteLength(snapshot.html, 'utf8');
      if (bytes > MAX_APP_BLOCK_BYTES) {
        state.failures.set(sourceUrl, `App block exceeds ${MAX_APP_BLOCK_BYTES / 1024 / 1024} MiB capture limit.`);
        continue;
      }

      const previous = state.blocks.get(sourceUrl);
      const score = (snapshot.frameCount || 0) * 10_000_000
        + (snapshot.svgCount || 0) * 1_000_000
        + (snapshot.imageCount || 0) * 100_000
        + (snapshot.canvasCount || 0) * 100_000
        + (snapshot.textLength || 0) * 10
        + Math.min(bytes, 99_999);

      if (!previous || score > previous.score || (score === previous.score && bytes > previous.bytes)) {
        const projectedTotal = state.totalBytes - (previous?.bytes || 0) + bytes;
        if (projectedTotal > MAX_TOTAL_APP_BLOCK_BYTES) {
          state.failures.set(sourceUrl, `Total app-block capture budget exceeds ${MAX_TOTAL_APP_BLOCK_BYTES / 1024 / 1024} MiB.`);
          continue;
        }
        state.totalBytes = projectedTotal;
        state.blocks.set(sourceUrl, {
          sourceUrl,
          html: snapshot.html,
          score,
          bytes,
          frameCount: snapshot.frameCount || 0,
          svgCount: snapshot.svgCount || 0,
          imageCount: snapshot.imageCount || 0,
          canvasCount: snapshot.canvasCount || 0,
          textLength: snapshot.textLength || 0,
          capturedAt: new Date().toISOString()
        });
      }
      state.failures.delete(sourceUrl);
    } catch (error) {
      if (sourceUrl) state.failures.set(sourceUrl, error?.message || 'App block capture failed.');
    }
  }

  return {
    captured: state.blocks.size,
    failures: state.failures.size,
    bytes: state.totalBytes
  };
}

export function getCapturedAppBlocks(page) {
  const state = appState(page);
  return {
    blocks: [...state.blocks.values()].map(block => ({ ...block })),
    failures: [...state.failures.entries()].map(([sourceUrl, message]) => ({ sourceUrl, message })),
    bytes: state.totalBytes
  };
}
