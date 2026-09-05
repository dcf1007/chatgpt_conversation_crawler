import crypto from 'node:crypto';

const APP_BLOCK_STORE = Symbol.for('chatgpt-conversation-crawler.app-blocks');
const APP_BLOCK_ROOT_SELECTOR = '[data-app-block-preview="true"]';
const TURN_SELECTOR = 'section[data-testid^="conversation-turn-"]';
const MAX_APP_BLOCKS = 50;
const MAX_APP_BLOCK_HTML_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_APP_BLOCK_HTML_BYTES = 64 * 1024 * 1024;
const MAX_APP_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_APP_ASSET_BYTES = 256 * 1024 * 1024;
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
  'background-color','background-image','background-size','background-position','background-repeat','color',
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

const SAFE_SVG_TAGS = new Set([
  'svg','g','path','rect','circle','ellipse','line','polyline','polygon','text','tspan',
  'defs','lineargradient','radialgradient','stop','clippath','mask','pattern','marker',
  'use','image','title','desc'
]);
const SAFE_SVG_ATTRS = new Set([
  'id','viewbox','preserveaspectratio','width','height','x','y','x1','y1','x2','y2',
  'cx','cy','r','rx','ry','d','points','fill','fill-opacity','fill-rule','stroke',
  'stroke-opacity','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray',
  'stroke-dashoffset','opacity','transform','transform-origin','vector-effect',
  'font-family','font-size','font-weight','font-style','text-anchor','dominant-baseline',
  'dx','dy','offset','stop-color','stop-opacity','gradientunits','gradienttransform',
  'spreadmethod','patternunits','patterncontentunits','patterntransform','markerwidth',
  'markerheight','markerunits','refx','refy','orient','clippathunits','maskunits',
  'maskcontentunits','clip-path','mask','marker-start','marker-mid','marker-end',
  'href','xlink:href','role','aria-label','aria-labelledby','aria-describedby','style'
]);
const SAFE_SVG_STYLE = new Set([
  'display','width','height','max-width','max-height','overflow','opacity','transform','transform-origin',
  'fill','fill-opacity','fill-rule','stroke','stroke-opacity','stroke-width','stroke-linecap',
  'stroke-linejoin','stroke-dasharray','stroke-dashoffset','vector-effect','color',
  'font-family','font-size','font-weight','font-style','text-anchor','dominant-baseline'
]);

const esc = value => String(value).replace(/[&<>"']/g, char => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[char]));

function appState(page) {
  if (!page[APP_BLOCK_STORE]) {
    page[APP_BLOCK_STORE] = {
      blocks: new Map(),
      failures: new Map(),
      assetFailures: new Map(),
      assetCache: new Map(),
      sequence: 0,
      totalHtmlBytes: 0,
      totalAssetBytes: 0,
      lastAttemptAt: new Map()
    };
  }
  return page[APP_BLOCK_STORE];
}

function absoluteUrl(value, base) {
  if (!value) return '';
  try { return new URL(value, base).href; } catch { return String(value); }
}

function appKey(turnId, ordinal, sourceUrl) {
  return `${turnId || 'unknown-turn'}|${Number(ordinal || 0)}|${sourceUrl || ''}`;
}

async function dataUrlForAsset(page, frame, url, state) {
  if (!url) return '';
  if (/^data:image\//i.test(url)) return url;
  const cached = state.assetCache.get(url);
  if (cached) return cached.dataUrl || '';

  let type = '';
  let size = 0;
  let dataUrl = '';
  try {
    if (/^https?:/i.test(url)) {
      const response = await page.context().request.get(url, { timeout: 20_000, failOnStatusCode: false });
      if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
      type = (response.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!type.startsWith('image/')) throw new Error(`unexpected content type ${type || 'unknown'}`);
      const body = await response.body();
      size = body.length;
      dataUrl = `data:${type};base64,${body.toString('base64')}`;
    } else if (/^blob:/i.test(url)) {
      const target = frame || page.mainFrame();
      const result = await target.evaluate(async assetUrl => {
        const response = await fetch(assetUrl);
        if (!response.ok) throw new Error(`blob fetch failed (${response.status})`);
        const blob = await response.blob();
        const type = String(blob.type || '').split(';')[0].trim().toLowerCase();
        if (!type.startsWith('image/')) throw new Error(`unexpected blob content type ${type || 'unknown'}`);
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error || new Error('could not read blob image'));
          reader.readAsDataURL(blob);
        });
        return { type, size: blob.size, dataUrl };
      }, url);
      type = result.type;
      size = result.size;
      dataUrl = result.dataUrl;
    } else {
      throw new Error('unsupported image URL scheme');
    }

    if (size > MAX_APP_ASSET_BYTES) throw new Error(`image exceeds ${MAX_APP_ASSET_BYTES / 1024 / 1024} MiB limit`);
    if (state.totalAssetBytes + size > MAX_TOTAL_APP_ASSET_BYTES) {
      throw new Error(`embedded app/SVG image budget exceeds ${MAX_TOTAL_APP_ASSET_BYTES / 1024 / 1024} MiB`);
    }
    state.totalAssetBytes += size;
    state.assetCache.set(url, { dataUrl, size, type });
    state.assetFailures.delete(url);
    return dataUrl;
  } catch (error) {
    state.assetFailures.set(url, error?.message || 'image embedding failed');
    return '';
  }
}

async function replaceAssetTokens(page, frame, html, assets, state, { embed = true } = {}) {
  let output = html;
  for (const asset of assets || []) {
    let replacement = asset.url;
    if (embed) replacement = await dataUrlForAsset(page, frame, asset.url, state) || asset.url;
    output = output.replaceAll(asset.token, replacement);
  }
  return output;
}

async function snapshotFrameTree(frame, state, depth = 0) {
  if (!frame || depth > MAX_FRAME_DEPTH) return null;

  const iframeHandles = await frame.$$('iframe').catch(() => []);
  const childFrames = [];
  for (const handle of iframeHandles) childFrames.push(await handle.contentFrame().catch(() => null));
  const tokens = childFrames.map(() => `__ARCHIVE_APP_FRAME_${++state.sequence}__`);
  const assetPrefix = `__ARCHIVE_APP_ASSET_${crypto.randomUUID().replaceAll('-', '')}_`;

  const captured = await frame.evaluate(({ styleProperties, tokens, assetPrefix }) => {
    const body = document.body;
    if (!body) return null;

    const assets = [];
    let assetIndex = 0;
    const assetToken = (url, kind) => {
      const token = `${assetPrefix}${String(assetIndex++).padStart(5, '0')}__`;
      assets.push({ token, url, kind });
      return token;
    };
    const resolve = value => {
      if (!value) return '';
      try { return new URL(value, location.href).href; } catch { return String(value); }
    };

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
          let value = computed.getPropertyValue(property);
          if (!value) continue;
          if (property === 'background-image' && /url\(/i.test(value)) {
            value = value.replace(/url\((['"]?)(.*?)\1\)/gi, (_all, _quote, raw) => {
              const url = resolve(raw);
              if (!url || /^data:/i.test(url)) return `url("${url || raw}")`;
              return `url("${assetToken(url, 'background-image')}")`;
            });
          }
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

    const originalImages = [...body.querySelectorAll('img')];
    const clonedImages = [...clone.querySelectorAll('img')];
    clonedImages.forEach((img, i) => {
      const original = originalImages[i];
      const url = resolve(original?.currentSrc || original?.src || img.getAttribute('src') || '');
      if (url && !/^data:/i.test(url)) img.setAttribute('src', assetToken(url, 'img'));
      else if (url) img.setAttribute('src', url);
      img.removeAttribute('srcset');
      img.setAttribute('loading', 'eager');
    });

    const originalSvgImages = [...body.querySelectorAll('svg image')];
    const clonedSvgImages = [...clone.querySelectorAll('svg image')];
    clonedSvgImages.forEach((image, i) => {
      const original = originalSvgImages[i];
      const raw = original?.getAttribute('href') || original?.getAttribute('xlink:href') || image.getAttribute('href') || image.getAttribute('xlink:href') || '';
      const url = resolve(raw);
      if (!url) return;
      image.removeAttribute('xlink:href');
      image.setAttribute('href', /^data:/i.test(url) ? url : assetToken(url, 'svg-image'));
    });

    const clonedIframes = [...clone.querySelectorAll('iframe')];
    clonedIframes.forEach((iframe, i) => {
      const placeholder = document.createElement('div');
      placeholder.textContent = tokens[i] || '[Nested app frame unavailable]';
      placeholder.setAttribute('data-archive-app-frame-placeholder', '');
      iframe.replaceWith(placeholder);
    });

    clone.querySelectorAll('script,noscript,style,object,embed,form,input,textarea,select,option,link,meta,base,source').forEach(el => el.remove());

    for (const a of clone.querySelectorAll('a[href]')) {
      try {
        const url = new URL(a.getAttribute('href'), location.href);
        if (!/^https?:$/i.test(url.protocol)) a.removeAttribute('href');
        else a.setAttribute('href', url.href);
      } catch { a.removeAttribute('href'); }
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
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
      assets,
      textLength: (body.innerText || body.textContent || '').length,
      svgCount: body.querySelectorAll('svg').length,
      imageCount: body.querySelectorAll('img,svg image').length,
      canvasCount: body.querySelectorAll('canvas').length
    };
  }, { styleProperties: STYLE_PROPERTIES, tokens, assetPrefix }).catch(() => null);

  if (!captured) return null;

  const structuralBytes = Buffer.byteLength(captured.html, 'utf8');
  if (structuralBytes > MAX_APP_BLOCK_HTML_BYTES) {
    throw new Error(`App frame exceeds ${MAX_APP_BLOCK_HTML_BYTES / 1024 / 1024} MiB structural HTML limit.`);
  }

  let html = await replaceAssetTokens(frame.page(), frame, captured.html, captured.assets, state, { embed: true });
  let frameCount = 1;
  let svgCount = captured.svgCount || 0;
  let imageCount = captured.imageCount || 0;
  let canvasCount = captured.canvasCount || 0;
  let textLength = captured.textLength || 0;
  let totalStructuralBytes = structuralBytes;

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
      totalStructuralBytes += child.structuralBytes || 0;
    }
  }

  return { html, frameCount, svgCount, imageCount, canvasCount, textLength, structuralBytes: totalStructuralBytes };
}

export async function captureMountedAppBlocks(page) {
  const state = appState(page);
  const roots = await page.locator(APP_BLOCK_ROOT_SELECTOR).elementHandles().catch(() => []);

  for (const root of roots.slice(0, MAX_APP_BLOCKS)) {
    let key = '';
    try {
      const meta = await root.evaluate((element, { rootSelector, turnSelector }) => {
        const turn = element.closest(turnSelector);
        const turnId = turn?.getAttribute('data-testid') || 'unknown-turn';
        const siblings = turn ? [...turn.querySelectorAll(rootSelector)] : [...document.querySelectorAll(rootSelector)];
        const ordinal = Math.max(0, siblings.indexOf(element));
        const iframe = element.querySelector('iframe');
        return { turnId, ordinal, sourceUrl: iframe?.src || iframe?.getAttribute('src') || '' };
      }, { rootSelector: APP_BLOCK_ROOT_SELECTOR, turnSelector: TURN_SELECTOR });

      const sourceUrl = absoluteUrl(meta.sourceUrl, page.url());
      if (!sourceUrl) continue;
      key = appKey(meta.turnId, meta.ordinal, sourceUrl);

      const now = Date.now();
      const lastAttempt = state.lastAttemptAt.get(key) || 0;
      if (state.blocks.has(key) && now - lastAttempt < 1500) continue;
      state.lastAttemptAt.set(key, now);

      const iframeHandle = await root.$('iframe');
      const rootFrame = await iframeHandle?.contentFrame().catch(() => null);
      if (!rootFrame) {
        state.failures.set(key, 'App block iframe is mounted but its frame is not ready yet.');
        continue;
      }

      const snapshot = await snapshotFrameTree(rootFrame, state);
      if (!snapshot?.html) {
        state.failures.set(key, 'App block frame returned no serializable content.');
        continue;
      }

      const structuralBytes = snapshot.structuralBytes || Buffer.byteLength(snapshot.html, 'utf8');
      if (structuralBytes > MAX_APP_BLOCK_HTML_BYTES) {
        state.failures.set(key, `App block exceeds ${MAX_APP_BLOCK_HTML_BYTES / 1024 / 1024} MiB structural HTML limit.`);
        continue;
      }

      const previous = state.blocks.get(key);
      const score = (snapshot.frameCount || 0) * 10_000_000
        + (snapshot.svgCount || 0) * 1_000_000
        + (snapshot.imageCount || 0) * 100_000
        + (snapshot.canvasCount || 0) * 100_000
        + (snapshot.textLength || 0) * 10
        + Math.min(structuralBytes, 99_999);

      if (!previous || score > previous.score || (score === previous.score && structuralBytes > previous.structuralBytes)) {
        const projectedTotal = state.totalHtmlBytes - (previous?.structuralBytes || 0) + structuralBytes;
        if (projectedTotal > MAX_TOTAL_APP_BLOCK_HTML_BYTES) {
          state.failures.set(key, `Total app-block structural HTML budget exceeds ${MAX_TOTAL_APP_BLOCK_HTML_BYTES / 1024 / 1024} MiB.`);
          continue;
        }
        state.totalHtmlBytes = projectedTotal;
        state.blocks.set(key, {
          key,
          turnId: meta.turnId,
          ordinal: meta.ordinal,
          sourceUrl,
          html: snapshot.html,
          score,
          structuralBytes,
          frameCount: snapshot.frameCount || 0,
          svgCount: snapshot.svgCount || 0,
          imageCount: snapshot.imageCount || 0,
          canvasCount: snapshot.canvasCount || 0,
          textLength: snapshot.textLength || 0,
          capturedAt: new Date().toISOString()
        });
      }
      state.failures.delete(key);
    } catch (error) {
      if (key) state.failures.set(key, error?.message || 'App block capture failed.');
    }
  }

  return {
    captured: state.blocks.size,
    failures: state.failures.size + state.assetFailures.size,
    structuralBytes: state.totalHtmlBytes,
    embeddedAssetBytes: state.totalAssetBytes,
    embeddedAssets: [...state.assetCache.values()].filter(item => item.dataUrl).length
  };
}

export function getCapturedAppBlocks(page) {
  const state = appState(page);
  return {
    blocks: [...state.blocks.values()].map(block => ({ ...block })),
    failures: [...state.failures.entries()].map(([key, message]) => ({ key, message })),
    assetFailures: [...state.assetFailures.entries()].map(([url, message]) => ({ url, message })),
    structuralBytes: state.totalHtmlBytes,
    embeddedAssetBytes: state.totalAssetBytes,
    embeddedAssets: [...state.assetCache.values()].filter(item => item.dataUrl).length
  };
}

export async function prepareEmbeddedContent(page, { embedSvgImages = true } = {}) {
  await captureMountedAppBlocks(page).catch(() => {});
  const retainedApps = getCapturedAppBlocks(page);
  const prefix = crypto.randomUUID().replaceAll('-', '');
  const blockTokens = Object.create(null);
  const sourceFallback = Object.create(null);
  retainedApps.blocks.forEach((block, index) => {
    const token = `__ARCHIVE_APP_BLOCK_${prefix}_${String(index).padStart(5, '0')}__`;
    blockTokens[block.key] = token;
    if (!sourceFallback[block.sourceUrl]) sourceFallback[block.sourceUrl] = token;
    else sourceFallback[block.sourceUrl] = '';
  });

  const rewrite = await page.evaluate(({ blockTokens, sourceFallback, prefix, rootSelector }) => {
    const turns = window.__archiveCrawler?.state?.turns;
    if (!turns) return { originals: [], appUses: [], missingApps: [], svgs: [] };
    const originals = [];
    const appUses = [];
    const missingApps = [];
    const svgs = [];
    let svgIndex = 0;

    for (const turn of Object.values(turns)) {
      if (!turn?.id || !turn?.html) continue;
      const holder = document.createElement('div');
      holder.innerHTML = turn.html;
      let changed = false;

      const roots = [...holder.querySelectorAll(rootSelector)];
      roots.forEach((root, ordinal) => {
        const iframe = root.querySelector('iframe');
        const raw = iframe?.getAttribute('src') || '';
        let source = raw;
        try { source = raw ? new URL(raw, location.href).href : ''; } catch {}
        const key = `${turn.id}|${ordinal}|${source}`;
        const token = blockTokens[key] || sourceFallback[source] || '';
        if (token) {
          const placeholder = document.createElement('span');
          placeholder.textContent = token;
          root.replaceWith(placeholder);
          appUses.push({ token, key, source });
        } else {
          const fallback = document.createElement('div');
          fallback.className = 'archive-app-block-fallback';
          fallback.textContent = 'App block preview could not be captured';
          root.replaceWith(fallback);
          missingApps.push({ key, source });
        }
        changed = true;
      });

      for (const svg of [...holder.querySelectorAll('svg')]) {
        if (svg.closest('[role="math"]')) continue;
        if (svg.closest('button,[role="button"],[data-app-widget-download-exclude="true"]')) continue;
        const hidden = svg.getAttribute('aria-hidden') === 'true';
        const label = svg.getAttribute('aria-label') || svg.querySelector('title')?.textContent || '';
        if (hidden && !label) continue;
        const token = `__ARCHIVE_MAIN_SVG_${prefix}_${String(svgIndex++).padStart(5, '0')}__`;
        const clone = svg.cloneNode(true);
        svgs.push({ token, html: clone.outerHTML, turnId: turn.id });
        const placeholder = document.createElement('span');
        placeholder.textContent = token;
        svg.replaceWith(placeholder);
        changed = true;
      }

      if (changed) {
        originals.push({ id: turn.id, html: turn.html });
        turn.html = holder.innerHTML;
      }
    }
    return { originals, appUses, missingApps, svgs };
  }, { blockTokens, sourceFallback, prefix, rootSelector: APP_BLOCK_ROOT_SELECTOR });

  const state = appState(page);
  const svgRecords = [];
  for (let i = 0; i < rewrite.svgs.length; i++) {
    const record = rewrite.svgs[i];
    const sanitized = await page.evaluate(({ html, safeTags, safeAttrs, safeStyle, baseUrl, assetPrefix }) => {
      const holder = document.createElement('div'); holder.innerHTML = html;
      const svg = holder.querySelector('svg'); if (!svg) return null;
      const tags = new Set(safeTags), attrs = new Set(safeAttrs), styles = new Set(safeStyle);
      const assets = []; let n = 0;
      const assetToken = (url, kind) => { const token = `__ARCHIVE_MAIN_SVG_ASSET_${assetPrefix}_${String(n++).padStart(5,'0')}__`; assets.push({ token, url, kind }); return token; };
      for (const el of [...svg.querySelectorAll('*')].reverse()) if (!tags.has(el.localName.toLowerCase())) el.remove();
      for (const el of [svg, ...svg.querySelectorAll('*')]) {
        for (const attr of [...el.attributes]) {
          const name = attr.name.toLowerCase();
          if (/^on/i.test(attr.name) || !attrs.has(name)) { el.removeAttribute(attr.name); continue; }
          if (name === 'style') {
            const kept = [];
            for (const property of [...el.style]) {
              if (!styles.has(property)) continue;
              const value = el.style.getPropertyValue(property);
              if (/expression\s*\(|javascript:/i.test(value)) continue;
              if (/url\(/i.test(value) && !/^\s*url\(\s*['"]?#[-\w:.]+['"]?\s*\)\s*$/i.test(value)) continue;
              kept.push(`${property}:${value}`);
            }
            if (kept.length) el.setAttribute('style', kept.join(';')); else el.removeAttribute('style');
          }
        }
      }
      for (const image of svg.querySelectorAll('image')) {
        const raw = image.getAttribute('href') || image.getAttribute('xlink:href') || '';
        if (!raw) continue;
        let url = raw; try { url = new URL(raw, baseUrl).href; } catch {}
        image.removeAttribute('xlink:href');
        if (/^data:image\//i.test(url)) image.setAttribute('href', url);
        else if (/^(?:https?:|blob:)/i.test(url)) image.setAttribute('href', assetToken(url, 'svg-image'));
        else image.removeAttribute('href');
      }
      for (const use of svg.querySelectorAll('use[href],use[xlink\\:href]')) {
        const raw = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
        use.removeAttribute('xlink:href');
        if (raw.startsWith('#')) use.setAttribute('href', raw);
        else { try { const url = new URL(raw, baseUrl); if (/^https?:$/i.test(url.protocol)) use.setAttribute('href', url.href); else use.removeAttribute('href'); } catch { use.removeAttribute('href'); } }
      }
      return { html: svg.outerHTML, assets };
    }, {
      html: record.html,
      safeTags: [...SAFE_SVG_TAGS],
      safeAttrs: [...SAFE_SVG_ATTRS],
      safeStyle: [...SAFE_SVG_STYLE],
      baseUrl: page.url(),
      assetPrefix: `${prefix}_${i}`
    }).catch(() => null);
    if (!sanitized) continue;
    const html = await replaceAssetTokens(page, page.mainFrame(), sanitized.html, sanitized.assets, state, { embed: embedSvgImages });
    svgRecords.push({ token: record.token, html, turnId: record.turnId, assetCount: sanitized.assets.length });
  }

  const blockMap = new Map(retainedApps.blocks.map(block => [block.key, block]));
  const tokenToBlock = new Map(Object.entries(blockTokens).map(([key, token]) => [token, blockMap.get(key)]));
  return { rewrite, retainedApps, tokenToBlock, svgRecords };
}

export async function restoreEmbeddedContent(page, prepared) {
  const originals = prepared?.rewrite?.originals || [];
  if (!originals.length) return;
  await page.evaluate(items => {
    const turns = window.__archiveCrawler?.state?.turns;
    if (!turns) return;
    for (const item of items) if (turns[item.id]) turns[item.id].html = item.html;
  }, originals).catch(() => {});
}

const APP_BLOCK_CSS = `
.archive-app-block{margin:18px 0;padding:12px;border:1px solid color-mix(in srgb,CanvasText 16%,transparent);border-radius:12px;overflow:auto;background:color-mix(in srgb,CanvasText 2%,Canvas)}
.archive-app-block-label{margin:0 0 10px;font-size:12px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;opacity:.58}
.archive-app-block-content{position:relative;min-width:0;max-width:100%;overflow:auto;isolation:isolate}
.archive-app-block-content img,.archive-app-block-content svg,.archive-turn-content svg{max-width:100%;height:auto}
.archive-app-frame{position:relative;min-width:0;max-width:100%;overflow:auto}
.archive-app-frame-missing,.archive-app-block-fallback{padding:10px;border:1px dashed color-mix(in srgb,CanvasText 20%,transparent);border-radius:8px;opacity:.7}
`;

function injectCss(html) {
  if (html.includes('.archive-app-block{')) return html;
  return html.replace('</style>', `${APP_BLOCK_CSS}</style>`);
}

function injectDiagnostics(html, messages) {
  if (!messages.length) return html;
  const diagnostic = `<details class="archive-diagnostics"><summary>${messages.length} embedded-content issue(s)</summary><ul>${messages.slice(0, 30).map(message => `<li>${esc(message)}</li>`).join('')}</ul>${messages.length > 30 ? `<p>${messages.length - 30} additional issue(s) omitted.</p>` : ''}</details>`;
  return html.replace('</div></body></html>', `${diagnostic}</div></body></html>`);
}

export function finalizeEmbeddedContent(snapshot, prepared) {
  const usedBlocks = [];
  for (const use of prepared?.rewrite?.appUses || []) {
    const block = prepared.tokenToBlock.get(use.token);
    if (!block) continue;
    const markup = `<section class="archive-app-block" data-app-block-source="${esc(block.sourceUrl)}"><div class="archive-app-block-label">App block preview</div><div class="archive-app-block-content">${block.html}</div></section>`;
    snapshot.html = snapshot.html.replaceAll(use.token, markup);
    usedBlocks.push(block);
  }
  for (const svg of prepared?.svgRecords || []) snapshot.html = snapshot.html.replaceAll(svg.token, svg.html);

  const uniqueBlocks = [...new Map(usedBlocks.map(block => [block.key, block])).values()];
  const frameCount = uniqueBlocks.reduce((sum, block) => sum + (block.frameCount || 0), 0);
  const appSvgCount = uniqueBlocks.reduce((sum, block) => sum + (block.svgCount || 0), 0);
  const appImageCount = uniqueBlocks.reduce((sum, block) => sum + (block.imageCount || 0), 0);
  const canvasCount = uniqueBlocks.reduce((sum, block) => sum + (block.canvasCount || 0), 0);
  const retainedApps = prepared?.retainedApps || { failures: [], assetFailures: [], embeddedAssets: 0, embeddedAssetBytes: 0 };

  snapshot.html = injectCss(snapshot.html);
  snapshot.html = snapshot.html.replace(
    '<div><strong>Expansion clicks</strong>',
    `<div><strong>App blocks</strong>${usedBlocks.length} rendered (${uniqueBlocks.length} unique; ${frameCount} flattened frame${frameCount === 1 ? '' : 's'}; ${appSvgCount} SVG${appSvgCount === 1 ? '' : 's'}; ${appImageCount} raster/SVG-image reference${appImageCount === 1 ? '' : 's'})</div><div><strong>Main-chat SVG</strong>${prepared?.svgRecords?.length || 0} retained</div><div><strong>Expansion clicks</strong>`
  );

  const issues = [
    ...(prepared?.rewrite?.missingApps || []).map(item => `No retained app-block snapshot matched ${item.key || item.source || 'unknown app block'}.`),
    ...(retainedApps.failures || []).map(item => `${item.key}: ${item.message}`),
    ...(retainedApps.assetFailures || []).map(item => `${item.url}: ${item.message}`)
  ];
  snapshot.html = injectDiagnostics(snapshot.html, [...new Set(issues)]);
  snapshot.stats = {
    ...snapshot.stats,
    appBlocksRendered: usedBlocks.length,
    appBlocksCaptured: uniqueBlocks.length,
    appBlockFrames: frameCount,
    appBlockSvgs: appSvgCount,
    appBlockImages: appImageCount,
    appBlockCanvases: canvasCount,
    appBlockEmbeddedAssets: retainedApps.embeddedAssets || 0,
    appBlockEmbeddedAssetBytes: retainedApps.embeddedAssetBytes || 0,
    appBlockCaptureFailures: issues.length,
    mainChatSvgs: prepared?.svgRecords?.length || 0
  };
  return snapshot;
}
