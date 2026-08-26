import express from 'express';
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlConversation } from './src/crawler.mjs';
import { buildSnapshot } from './src/snapshot.mjs';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const root = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(root, 'public')));

function validateShareUrl(input) {
  let u; try { u = new URL(input); } catch { throw new Error('Enter a valid URL.'); }
  if (u.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed.');
  if (!['chatgpt.com','www.chatgpt.com'].includes(u.hostname.toLowerCase())) throw new Error('Only chatgpt.com share URLs are allowed.');
  if (!u.pathname.startsWith('/share/')) throw new Error('Expected a ChatGPT conversation share URL under /share/.');
  u.hash=''; return u.toString();
}

app.post('/api/archive', async (req,res) => {
  let browser;
  try {
    const sourceUrl = validateShareUrl(req.body?.url);
    browser = await chromium.launch({ headless: true });
    const page = await (await browser.newContext({ viewport:{width:1440,height:1000}, javaScriptEnabled:true })).newPage();
    await page.goto(sourceUrl, { waitUntil:'domcontentloaded', timeout:60_000 });
    await page.waitForLoadState('networkidle', { timeout:12_000 }).catch(()=>{});
    const bodyText = (await page.locator('body').innerText().catch(()=>'' )).slice(0,6000);
    if (/page not found|conversation not found|link.*(expired|deleted)|access denied/i.test(bodyText)) throw new Error('The shared conversation could not be accessed. The link may be invalid, deleted, or restricted.');
    await crawlConversation(page);
    const snapshot = await buildSnapshot(page, sourceUrl);
    if (!snapshot.stats.turns) throw new Error('No conversation turns were captured. ChatGPT may have changed the shared-page DOM.');
    const filename = `chatgpt-share-${crypto.randomUUID().slice(0,8)}.html`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Archive-Turns',String(snapshot.stats.turns));
    res.setHeader('X-Archive-Expansions',String(snapshot.stats.expansions));
    res.setHeader('X-Archive-Failures',String(snapshot.stats.failures));
    res.setHeader('X-Archive-Pre-Blocks',String(snapshot.stats.preBlocks));
    res.send(snapshot.html);
  } catch (e) { res.status(400).json({ error:e?.message || 'Archive failed.' }); }
  finally { await browser?.close().catch(()=>{}); }
});

app.listen(PORT,()=>console.log(`ChatGPT Share Archiver: http://localhost:${PORT}`));
