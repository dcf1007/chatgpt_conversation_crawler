export async function installCrawler(page) {
  await page.evaluate(() => {
    const state = { turns:Object.create(null), attempts:Object.create(null), failures:Object.create(null), clickCount:0, successfulExpansions:0 };
    const turnSelector='section[data-testid^="conversation-turn-"]';
    const turns=()=>[...document.querySelectorAll(turnSelector)];
    const turnId=el=>el.closest(turnSelector)?.getAttribute('data-testid')||'unknown-turn';
    const label=el=>[el.getAttribute('aria-label'),el.textContent,el.getAttribute('title')].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    function isDisclosure(el){
      if(!(el instanceof HTMLElement)||el.getAttribute('aria-expanded')!=='false')return false;
      if(el.matches('[aria-haspopup],[role="menuitem"]'))return false;
      if(el.getAttribute('aria-controls'))return true;
      return /^(worked for|thought(?: for)?|thinking(?: for)?|reasoning(?: for)?)\b/i.test(label(el));
    }
    const keyFor=el=>[turnId(el),el.getAttribute('aria-controls')||'',label(el).slice(0,240)].join('|');
    function scrollRoot(){
      let el=document.querySelector('#thread')||document.querySelector('main#main')||document.querySelector('main');
      while(el&&el!==document.documentElement){const s=getComputedStyle(el);if(/(auto|scroll)/.test(s.overflowY)&&el.scrollHeight>el.clientHeight+32)return el;el=el.parentElement;}
      return document.scrollingElement||document.documentElement;
    }
    function metrics(){const r=scrollRoot();const d=r===document.scrollingElement||r===document.documentElement||r===document.body;return{top:d?scrollY:r.scrollTop,height:r.scrollHeight,client:d?innerHeight:r.clientHeight};}
    function setTop(top){const r=scrollRoot();const d=r===document.scrollingElement||r===document.documentElement||r===document.body;if(d)scrollTo(0,top);else r.scrollTop=top;}
    function capture(){
      for(const section of turns()){
        const id=section.getAttribute('data-testid');if(!id)continue;
        for(const d of section.querySelectorAll('details'))d.open=true;
        const clone=section.cloneNode(true);
        const oi=[...section.querySelectorAll('img')];[...clone.querySelectorAll('img')].forEach((img,i)=>{const src=oi[i]?.currentSrc||oi[i]?.src||img.src;if(src)try{img.src=new URL(src,location.href).href}catch{}img.removeAttribute('srcset');img.loading='eager';});
        const oa=[...section.querySelectorAll('a[href]')];[...clone.querySelectorAll('a[href]')].forEach((a,i)=>{const href=oa[i]?.href||a.href;if(href)try{a.href=new URL(href,location.href).href}catch{}});
        const remaining=[...section.querySelectorAll('[aria-expanded="false"]')].filter(isDisclosure).length+section.querySelectorAll('details:not([open])').length;
        const preCount=section.querySelectorAll('pre').length,codeCount=section.querySelectorAll('code').length,textLength=(section.innerText||section.textContent||'').length,html=clone.outerHTML;
        const score=(remaining===0?1e9:0)+preCount*1e6+codeCount*1e5+textLength*10+Math.min(html.length,99999),previous=state.turns[id];
        if(!previous||score>previous.score||(score===previous.score&&html.length>previous.html.length))state.turns[id]={id,role:section.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role')||'',score,preCount,codeCount,html};
      }
    }
    function expandOne(){
      for(const section of turns()){const d=section.querySelector('details:not([open])');if(d){d.open=true;state.successfulExpansions++;return{kind:'details'};}}
      for(const section of turns())for(const el of section.querySelectorAll('[aria-expanded="false"]')){
        if(!isDisclosure(el))continue;const key=keyFor(el),attempts=state.attempts[key]||0;if(attempts>=3)continue;state.attempts[key]=attempts+1;
        try{el.scrollIntoView({block:'center'});el.click();state.clickCount++;}catch(e){state.failures[key]=e?.message||'click failed';}return{kind:'click',key};
      }
      return null;
    }
    function confirm(key){if(!key)return;const collapsed=turns().some(section=>[...section.querySelectorAll('[aria-expanded="false"]')].some(el=>isDisclosure(el)&&keyFor(el)===key));if(!collapsed){state.successfulExpansions++;delete state.failures[key];}else if((state.attempts[key]||0)>=3)state.failures[key]=`Could not expand after 3 attempts: ${key}`;}
    function stats(){const values=Object.values(state.turns);return{turns:values.length,expanded:state.successfulExpansions,clicks:state.clickCount,failures:Object.keys(state.failures).length,preBlocks:values.reduce((n,t)=>n+(t.preCount||0),0),codeBlocks:values.reduce((n,t)=>n+(t.codeCount||0),0)};}
    window.__archiveCrawler={state,capture,expandOne,confirm,metrics,setTop,stats};capture();
  });
}

async function report(page,onProgress,extra={}){const s=await page.evaluate(()=>window.__archiveCrawler.stats());const m=await page.evaluate(()=>window.__archiveCrawler.metrics());await onProgress?.({...s,scrollTop:m.top,scrollHeight:m.height,scrollClient:m.client,...extra});}
async function expandMounted(page,max,onProgress,shouldCancel){
  for(let i=0;i<max;i++){if(shouldCancel?.())throw new Error('Archive cancelled.');const result=await page.evaluate(()=>window.__archiveCrawler.expandOne());if(!result)break;await page.waitForTimeout(result.kind==='details'?40:180);if(result.key)await page.evaluate(key=>window.__archiveCrawler.confirm(key),result.key);await page.evaluate(()=>window.__archiveCrawler.capture());if(i%8===0)await report(page,onProgress,{detail:`Expanding mounted disclosures (${i+1})`});}
}
async function scan(page,direction,pass,onProgress,shouldCancel,maxSteps=260){
  const first=await page.evaluate(()=>window.__archiveCrawler.metrics());await page.evaluate(top=>window.__archiveCrawler.setTop(top),direction==='down'?0:Math.max(0,first.height-first.client));await page.waitForTimeout(250);
  let stable=0,previous='';
  for(let step=0;step<maxSteps;step++){
    if(shouldCancel?.())throw new Error('Archive cancelled.');await expandMounted(page,180,onProgress,shouldCancel);await page.evaluate(()=>window.__archiveCrawler.capture());
    const m=await page.evaluate(()=>window.__archiveCrawler.metrics()),maxTop=Math.max(0,m.height-m.client),atEnd=direction==='down'?m.top>=maxTop-4:m.top<=4;
    const s=await page.evaluate(()=>window.__archiveCrawler.stats()),sig=`${Math.round(m.top)}|${m.height}|${s.turns}|${s.clicks}`;
    await onProgress?.({...s,phase:'Scanning conversation',detail:`Pass ${pass}/3 — ${direction}`,pass,direction,step:step+1,scrollTop:m.top,scrollHeight:m.height,scrollClient:m.client});
    if(atEnd&&sig===previous)stable++;else if(atEnd)stable=Math.max(stable,1);else stable=0;if(atEnd&&stable>=3)break;previous=sig;
    const stepSize=Math.max(420,Math.floor(m.client*.65)),next=direction==='down'?Math.min(maxTop,m.top+stepSize):Math.max(0,m.top-stepSize);await page.evaluate(top=>window.__archiveCrawler.setTop(top),next);await page.waitForTimeout(180);
  }
}
export async function crawlConversation(page,{onProgress,shouldCancel}={}){
  await installCrawler(page);await report(page,onProgress,{phase:'Preparing crawler',detail:'Installed page-side capture helpers'});
  await scan(page,'down',1,onProgress,shouldCancel);await scan(page,'up',2,onProgress,shouldCancel);await scan(page,'down',3,onProgress,shouldCancel);
  await onProgress?.({phase:'Final expansion sweep',detail:'Opening remaining mounted disclosures'});await expandMounted(page,300,onProgress,shouldCancel);await page.evaluate(()=>window.__archiveCrawler.capture());await report(page,onProgress,{phase:'Final expansion sweep',detail:'Capture stabilized'});
}
