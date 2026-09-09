import fs from 'node:fs';

function replaceExact(path, oldText, newText) {
  const text = fs.readFileSync(path, 'utf8');
  if (text.includes(newText)) return;
  if (!text.includes(oldText)) throw new Error(`expected patch anchor missing in ${path}`);
  fs.writeFileSync(path, text.replace(oldText, newText));
}

const snapshotOld = String.raw`      for (const button of [...section.querySelectorAll('button,[role="button"]')]) {
        const text = (button.textContent || '').replace(/\s+/g,' ').trim();
        const aria = (button.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
        const label = text || aria;
        if (/^(worked for|thought(?: for)?|thinking(?: for)?|reasoning(?: for)?)\b/i.test(label)) {
          const r = document.createElement('div'); r.className='archive-reasoning-label'; r.textContent=label; button.replaceWith(r);
        } else if (text && !/^(copy(?: code)?|copied!?|more actions|switch model)$/i.test(text)) {
          const r = document.createElement('span'); r.className='archive-inline-label'; r.textContent=text; button.replaceWith(r);
        } else button.remove();
      }
`;
const snapshotNew = String.raw`      for (const button of [...section.querySelectorAll('button,[role="button"]')]) {
        const text = (button.textContent || '').replace(/\s+/g,' ').trim();
        const aria = (button.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
        const label = text || aria;
        const preservedMedia = button.querySelector('img,video,audio,picture,object,embed');
        const uiOnly = /^(copy(?: code)?|copied!?|more actions|switch model)$/i.test(text) || /^run code$/i.test(aria);
        if (/^(worked for|thought(?: for)?|thinking(?: for)?|reasoning(?: for)?)\b/i.test(label)) {
          const r = document.createElement('div'); r.className='archive-reasoning-label'; r.textContent=label; button.replaceWith(r);
        } else if (preservedMedia) {
          const fragment = document.createDocumentFragment();
          while (button.firstChild) fragment.append(button.firstChild);
          button.replaceWith(fragment);
        } else if (text && !uiOnly) {
          const r = document.createElement('span'); r.className='archive-inline-label'; r.textContent=text; button.replaceWith(r);
        } else button.remove();
      }
`;
replaceExact('src/snapshot.mjs', snapshotOld, snapshotNew);

const imagesOld = [
  '  for (const record of records) {',
  '    if (record.image?.dataUrl) {',
  '      snapshot.html = snapshot.html.replaceAll(record.token, record.image.dataUrl);',
  '      embedded++;',
  "      if (record.image.source === 'browser-response' || record.image.source === 'mounted-blob') retainedDuringCrawl++;",
  '      else recoveredAtFinal++;',
  '      if (record.image.mimeCorrected) mimeCorrections++;',
  '    } else {',
  '      snapshot.html = snapshot.html.replaceAll(record.token, esc(record.url));',
  "      failures.push(`${record.url} — ${record.error || 'embedding failed'}`);",
  '    }',
  '  }',
  '',
  '  const parts = [`${embedded}/${records.length} embedded`, `${retainedDuringCrawl} retained during crawl`];',
  ''
].join('\n');
const imagesNew = [
  '  let referenced = 0;',
  '  let unreferenced = 0;',
  '  let referencedSourceBytes = 0;',
  '  for (const record of records) {',
  '    if (!snapshot.html.includes(record.token)) {',
  '      unreferenced++;',
  '      continue;',
  '    }',
  '    referenced++;',
  '    if (record.image?.dataUrl) {',
  '      snapshot.html = snapshot.html.replaceAll(record.token, record.image.dataUrl);',
  '      embedded++;',
  '      referencedSourceBytes += Number(record.image.size || 0);',
  "      if (record.image.source === 'browser-response' || record.image.source === 'mounted-blob') retainedDuringCrawl++;",
  '      else recoveredAtFinal++;',
  '      if (record.image.mimeCorrected) mimeCorrections++;',
  '    } else {',
  '      snapshot.html = snapshot.html.replaceAll(record.token, esc(record.url));',
  "      failures.push(`${record.url} — ${record.error || 'embedding failed'}`);",
  '    }',
  '  }',
  '',
  '  const parts = [`${embedded}/${referenced} embedded`, `${retainedDuringCrawl} retained during crawl`];',
  "  if (unreferenced) parts.push(`${unreferenced} retained source image${unreferenced === 1 ? '' : 's'} not referenced by sanitized content`);",
  ''
].join('\n');
replaceExact('src/main-images.mjs', imagesOld, imagesNew);

const statsOld = String.raw`    imagesTotal: records.length,
    imagesEmbedded: embedded,
    imageEmbeddingFailures: failures.length,
    imagesRetainedDuringCrawl: retainedDuringCrawl,
    imagesRecoveredAtFinalization: recoveredAtFinal,
    imageMimeCorrections: mimeCorrections,
    embeddedImageSourceBytes: prepared?.totalBytes || 0
`;
const statsNew = String.raw`    imagesTotal: referenced,
    imagesEmbedded: embedded,
    imageEmbeddingFailures: failures.length,
    imagesRetainedDuringCrawl: retainedDuringCrawl,
    imagesRecoveredAtFinalization: recoveredAtFinal,
    imagesUnreferencedAfterSanitization: unreferenced,
    imageMimeCorrections: mimeCorrections,
    embeddedImageSourceBytes: referencedSourceBytes,
    retainedImageSourceBytes: prepared?.totalBytes || 0
`;
replaceExact('src/main-images.mjs', statsOld, statsNew);

let index = fs.readFileSync('public/index.html', 'utf8');
if (!index.includes('sessionRefreshInFlight=false')) index = index.replace('let currentArchiveId=null,pollTimer=null,lastSession=null;', 'let currentArchiveId=null,pollTimer=null,lastSession=null,sessionRefreshInFlight=false;');
if (!index.includes("if(s.verificationWindowOpen)label='Checking session'")) index = index.replace("  if(s.loginWindowOpen)label=s.authenticated===true?'Signed in · login open':'Login window open';", "  if(s.verificationWindowOpen)label='Checking session';\n  else if(s.loginWindowOpen)label=s.authenticated===true?'Signed in · login open':'Login window open';");
const oldRefresh = "async function refreshSession(){try{const r=await fetch('/api/session/status',{cache:'no-store'}),s=await r.json().catch(()=>({}));if(!r.ok)throw new Error(s.error||`Session status failed (${r.status}).`);renderSession(s);setSessionError('')}catch(e){setSessionError(e.message)}}";
const newRefresh = "async function refreshSession(){if(sessionRefreshInFlight)return;sessionRefreshInFlight=true;try{const r=await fetch('/api/session/status',{cache:'no-store'}),s=await r.json().catch(()=>({}));if(!r.ok)throw new Error(s.error||`Session status failed (${r.status}).`);renderSession(s);setSessionError('')}catch(e){setSessionError(e.message)}finally{sessionRefreshInFlight=false}}";
if (!index.includes(newRefresh)) {
  if (!index.includes(oldRefresh)) throw new Error('refreshSession patch anchor missing');
  index = index.replace(oldRefresh, newRefresh);
}
const oldTimer = "refreshSession();setInterval(()=>{if(lastSession)renderSession(lastSession)},1000);";
const newTimer = "refreshSession();setInterval(()=>{if(lastSession&&(lastSession.busy||lastSession.loginWindowOpen||lastSession.verificationWindowOpen))void refreshSession();else if(lastSession)renderSession(lastSession)},1000);";
if (!index.includes(newTimer)) {
  if (!index.includes(oldTimer)) throw new Error('session timer patch anchor missing');
  index = index.replace(oldTimer, newTimer);
}
fs.writeFileSync('public/index.html', index);

fs.writeFileSync('tests/snapshot-media-control-smoke.mjs', String.raw`import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/snapshot.mjs',import.meta.url),'utf8');
const start=source.indexOf("for (const button of [...section.querySelectorAll('button,[role=\"button\"]')])");
assert.ok(start>=0,'snapshot sanitizer button pass must exist');
const end=source.indexOf("for (const el of [section, ...section.querySelectorAll('*')])",start);
assert.ok(end>start,'snapshot sanitizer button pass must end before attribute stripping');
const block=source.slice(start,end);
assert.match(block,/preservedMedia = button\.querySelector\('img,video,audio,picture,object,embed'\)/);
assert.match(block,/while \(button\.firstChild\) fragment\.append\(button\.firstChild\)/);
assert.match(block,/button\.replaceWith\(fragment\)/);
assert.ok(block.indexOf('preservedMedia')<block.indexOf("else if (text && !uiOnly)"));
assert.match(block,/\^run code\$\/i\.test\(aria\)/);
assert.match(source,/for \(const img of section\.querySelectorAll\('img'\)\)/);
console.log('snapshot media-control smoke test passed');
`);

fs.writeFileSync('tests/main-image-finalization-smoke.mjs', String.raw`import assert from 'node:assert/strict';
import { finalizeMainImages } from '../src/main-images.mjs';
const token='__ARCHIVE_MAIN_IMAGE_TEST__';
const prepared={totalBytes:3,records:[{token,url:'https://example.invalid/image.png',error:'',image:{dataUrl:'data:image/png;base64,AAEC',size:3,source:'browser-response',mimeCorrected:false}}]};
const referenced=finalizeMainImages({html:'<html><body><div><strong>Images</strong>pending</div><img src="'+token+'"></body></html>',stats:{}},prepared);
assert.equal(referenced.stats.imagesTotal,1);assert.equal(referenced.stats.imagesEmbedded,1);assert.equal(referenced.stats.imagesUnreferencedAfterSanitization,0);assert.equal(referenced.stats.embeddedImageSourceBytes,3);assert.equal(referenced.stats.retainedImageSourceBytes,3);assert.match(referenced.html,/data:image\/png;base64,AAEC/);assert.doesNotMatch(referenced.html,new RegExp(token));
const omitted=finalizeMainImages({html:'<html><body><div><strong>Images</strong>pending</div></body></html>',stats:{}},prepared);
assert.equal(omitted.stats.imagesTotal,0);assert.equal(omitted.stats.imagesEmbedded,0);assert.equal(omitted.stats.imagesUnreferencedAfterSanitization,1);assert.equal(omitted.stats.embeddedImageSourceBytes,0);assert.equal(omitted.stats.retainedImageSourceBytes,3);assert.match(omitted.html,/1 retained source image not referenced by sanitized content/);
console.log('main-image finalization smoke test passed');
`);

fs.writeFileSync('tests/session-state-refresh-smoke.mjs', String.raw`import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.match(html,/sessionRefreshInFlight=false/);assert.match(html,/if\(sessionRefreshInFlight\)return;sessionRefreshInFlight=true/);assert.match(html,/finally\{sessionRefreshInFlight=false\}/);assert.match(html,/lastSession&&\(lastSession\.busy\|\|lastSession\.loginWindowOpen\|\|lastSession\.verificationWindowOpen\)\)void refreshSession\(\)/);assert.doesNotMatch(html,/setInterval\(\(\)=>\{if\(lastSession\)renderSession\(lastSession\)\},1000\)/);assert.match(html,/if\(s\.verificationWindowOpen\)label='Checking session'/);
console.log('session state refresh smoke test passed');
`);
