const MAIN_IMAGE_STORE = Symbol.for('chatgpt-conversation-crawler.main-images');
const TURN_SELECTOR = 'section[data-testid^="conversation-turn-"]';
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;

function stateFor(page) {
  if (!page[MAIN_IMAGE_STORE]) {
    page[MAIN_IMAGE_STORE] = {
      records: new Map(),
      failures: new Map(),
      pending: new Set(),
      totalBytes: 0,
      listener: null
    };
  }
  return page[MAIN_IMAGE_STORE];
}

function declaredImageType(value) {
  const type = String(value || '').split(';')[0].trim().toLowerCase();
  return type.startsWith('image/') ? type : '';
}

function sniffImageType(buffer, declared = '') {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return '';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  const head12 = buffer.subarray(0, 12).toString('ascii');
  if (head12.startsWith('GIF87a') || head12.startsWith('GIF89a')) return 'image/gif';
  if (head12.startsWith('RIFF') && head12.slice(8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp';
  if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) return 'image/x-icon';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 32).toString('ascii').toLowerCase();
    if (/avif|avis/.test(brand)) return 'image/avif';
    if (/heic|heix|hevc|hevx|mif1|msf1/.test(brand)) return 'image/heic';
  }
  const text = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(text)) return 'image/svg+xml';
  return declaredImageType(declared);
}

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(String(dataUrl || ''));
  if (!match) throw new Error('invalid data URL');
  const declared = match[1] || '';
  const body = match[3] || '';
  const buffer = match[2] ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
  return { buffer, declared };
}

function aliasesForResponse(response) {
  const urls = new Set([response.url()]);
  let request = response.request();
  while (request) {
    urls.add(request.url());
    request = request.redirectedFrom();
  }
  return [...urls].filter(Boolean);
}

function storeBuffer(page, urls, buffer, declared, source) {
  const state = stateFor(page);
  const aliases = [...new Set((urls || []).filter(Boolean))];
  for (const url of aliases) {
    const existing = state.records.get(url);
    if (existing) return existing;
  }
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MiB limit`);
  if (state.totalBytes + buffer.length > MAX_CACHE_BYTES) throw new Error(`main-image retention cache exceeds ${MAX_CACHE_BYTES / 1024 / 1024} MiB`);
  const reportedType = declaredImageType(declared);
  const type = sniffImageType(buffer, reportedType);
  if (!type) throw new Error(`could not identify image bytes${declared ? ` (reported ${declared})` : ''}`);
  const record = {
    type,
    reportedType,
    mimeCorrected: Boolean(reportedType && reportedType !== type),
    size: buffer.length,
    dataUrl: `data:${type};base64,${buffer.toString('base64')}`,
    source
  };
  state.totalBytes += buffer.length;
  for (const url of aliases) {
    state.records.set(url, record);
    state.failures.delete(url);
  }
  return record;
}

async function flushPending(page) {
  const state = stateFor(page);
  for (let pass = 0; pass < 4 && state.pending.size; pass++) {
    await Promise.allSettled([...state.pending]);
  }
}

export function installMainImageCapture(page) {
  const state = stateFor(page);
  if (state.listener) return;

  state.listener = response => {
    let request;
    try { request = response.request(); } catch { return; }
    try {
      if (request.frame() !== page.mainFrame()) return;
    } catch { return; }

    const declared = response.headers()['content-type'] || '';
    if (request.resourceType() !== 'image' && !declaredImageType(declared)) return;
    if (!response.ok()) return;

    const task = (async () => {
      const aliases = aliasesForResponse(response);
      try {
        const body = await response.body();
        storeBuffer(page, aliases, body, declared, 'browser-response');
      } catch (error) {
        const message = error?.message || 'could not retain browser image response';
        for (const url of aliases) state.failures.set(url, message);
      }
    })();
    state.pending.add(task);
    void task.finally(() => state.pending.delete(task));
  };

  page.on('response', state.listener);
}

async function captureBlobUrl(page, url, source = 'mounted-blob') {
  const result = await page.evaluate(async ({ url, maxBytes }) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`blob fetch failed (${response.status})`);
    const blob = await response.blob();
    if (blob.size > maxBytes) throw new Error(`image exceeds ${Math.round(maxBytes / 1024 / 1024)} MiB limit`);
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('could not read blob image'));
      reader.readAsDataURL(blob);
    });
    return { dataUrl, type: blob.type || '' };
  }, { url, maxBytes: MAX_IMAGE_BYTES });
  const decoded = decodeDataUrl(result.dataUrl);
  return storeBuffer(page, [url], decoded.buffer, result.type || decoded.declared, source);
}

export async function captureMountedMainImages(page, { settleMs = 0 } = {}) {
  installMainImageCapture(page);
  const mounted = await page.evaluate(async ({ selector, settleMs }) => {
    const images = [...document.querySelectorAll(`${selector} img`)];
    for (const img of images) {
      try { img.loading = 'eager'; } catch {}
      try { img.fetchPriority = 'high'; } catch {}
      if (!img.complete) {
        try { void img.decode().catch(() => {}); } catch {}
      }
    }
    if (settleMs > 0) {
      const pending = images.filter(img => !img.complete).map(img => {
        try { return img.decode(); } catch { return Promise.resolve(); }
      });
      if (pending.length) {
        await Promise.race([
          Promise.allSettled(pending),
          new Promise(resolve => setTimeout(resolve, settleMs))
        ]);
      }
    }
    return [...new Set(images.map(img => img.currentSrc || img.src || '').filter(Boolean))];
  }, { selector: TURN_SELECTOR, settleMs }).catch(() => []);

  for (const url of mounted) {
    if (!/^blob:/i.test(url)) continue;
    const state = stateFor(page);
    if (state.records.has(url)) continue;
    try {
      await captureBlobUrl(page, url, 'mounted-blob');
    } catch (error) {
      state.failures.set(url, error?.message || 'mounted blob image could not be retained');
    }
  }

  await flushPending(page);
  const state = stateFor(page);
  return {
    mounted: mounted.length,
    retainedUrls: state.records.size,
    retainedBytes: state.totalBytes,
    failures: state.failures.size
  };
}

async function fetchSameOrigin(page, url) {
  const result = await page.evaluate(async ({ url, maxBytes }) => {
    const response = await fetch(url, { credentials: 'include', cache: 'force-cache' });
    if (!response.ok) throw new Error(`browser fetch HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.size > maxBytes) throw new Error(`image exceeds ${Math.round(maxBytes / 1024 / 1024)} MiB limit`);
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('could not read fetched image'));
      reader.readAsDataURL(blob);
    });
    return { dataUrl, type: response.headers.get('content-type') || blob.type || '' };
  }, { url, maxBytes: MAX_IMAGE_BYTES });
  const decoded = decodeDataUrl(result.dataUrl);
  return storeBuffer(page, [url], decoded.buffer, result.type || decoded.declared, 'final-browser-fetch');
}

async function fetchRequestContext(page, url) {
  const response = await page.context().request.get(url, {
    timeout: 20_000,
    failOnStatusCode: false,
    headers: {
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      referer: page.url()
    }
  });
  if (!response.ok()) throw new Error(`request fallback HTTP ${response.status()}`);
  const body = await response.body();
  return storeBuffer(page, [url], body, response.headers()['content-type'] || '', 'final-request-fetch');
}

export async function resolveMainImage(page, url) {
  installMainImageCapture(page);
  await flushPending(page);
  const state = stateFor(page);
  const cached = state.records.get(url);
  if (cached) return cached;

  const errors = [];
  if (/^blob:/i.test(url)) {
    try { return await captureBlobUrl(page, url, 'final-blob-fetch'); }
    catch (error) { errors.push(error?.message || 'final blob fetch failed'); }
  } else if (/^https?:/i.test(url)) {
    try {
      if (new URL(url).origin === new URL(page.url()).origin) return await fetchSameOrigin(page, url);
    } catch (error) {
      errors.push(error?.message || 'browser fetch failed');
    }
    try { return await fetchRequestContext(page, url); }
    catch (error) { errors.push(error?.message || 'request fallback failed'); }
  } else {
    errors.push('unsupported image URL scheme');
  }

  const earlier = state.failures.get(url);
  if (earlier) errors.unshift(`earlier retention: ${earlier}`);
  throw new Error([...new Set(errors)].join('; ') || 'image embedding failed');
}
