import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const discussionsOnly = args.includes('--discussions-only');
const anchorsOnly = args.includes('--anchors-only');
const projectEntryOnly = args.includes('--project-entry-only');
const address = args.find(argument => !argument.startsWith('--'));
assert(address, 'Pass the running website URL');
assert(args.every(argument => argument === address || argument === '--anchors-only' || argument === '--project-entry-only' || argument === '--discussions-only'), 'Unknown verification option');
const base = address.endsWith('/') ? address : address + '/';
const onProject = new URL(base).pathname.includes('/projects/zynthian-edition/');
const checkpoint = onProject ? 'status' : 'projects';
const feedURL = 'https://raw.githubusercontent.com/Eurikon/RhizomeController/main/feed/discussions.json';
const shots = process.env.RHIZOME_WEBSITE_SHOTS;
if (shots) await mkdir(shots, {recursive: true});
const profile = await mkdtemp(path.join(tmpdir(), 'rhizome-website-'));
const browser = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'
], {stdio: 'ignore'});
const exited = new Promise(resolve => browser.once('exit', resolve));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
      break;
    } catch { await pause(100); }
  }
  assert(port, 'Website verification browser did not start');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once: true});
    socket.addEventListener('error', reject, {once: true});
  });
  let sequence = 0;
  const pending = new Map(), errors = [], contexts = new Map(), handlers = new Map();
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    if (response.method === 'Runtime.exceptionThrown' && !response.sessionId) errors.push(response.params.exceptionDetails.text);
    if (response.method === 'Runtime.executionContextCreated') {
      const context = response.params.context;
      contexts.set(`${response.sessionId || ''}:${context.id}`, {...context, sessionId: response.sessionId});
    }
    if (response.method === 'Runtime.executionContextDestroyed') {
      contexts.delete(`${response.sessionId || ''}:${response.params.executionContextId}`);
    }
    const handler = handlers.get(response.method);
    if (handler) Promise.resolve(handler(response.params, response.sessionId)).catch(error => errors.push(error.message));
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timeout);
    response.error ? request.reject(Error(JSON.stringify(response.error))) : request.resolve(response.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(Error(`Browser command timed out: ${method}`));
    }, 10000);
    pending.set(id, {resolve, reject, timeout});
    socket.send(JSON.stringify({id, method, params, sessionId}));
  });
  const evaluate = async (expression, context) => {
    const response = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true,
      ...(context ? {contextId: context.id} : {})}, context?.sessionId);
    assert(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const waitFor = async (condition, message, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await pause(50);
    }
    assert.fail(message);
  };
  const clickMenu = async id => {
    const point = await evaluate(`(() => {
      const link = document.querySelector('.navigation a[href="#${id}"]');
      link.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant',container:'nearest'});
      const r = link.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    await send('Input.dispatchMouseEvent', {type: 'mousePressed', ...point, button: 'left', clickCount: 1});
    await send('Input.dispatchMouseEvent', {type: 'mouseReleased', ...point, button: 'left', clickCount: 1});
  };
  const verifyAnchor = async id => {
    let state, stable = 0;
    for (let attempt = 0; attempt < 160; attempt++) {
      state = await evaluate(`(() => {
        const section=document.getElementById('${id}');
        const heading=document.getElementById(section.getAttribute('aria-labelledby'));
        const title=heading.getBoundingClientRect();
        const label=section.querySelector('.eyebrow').getBoundingClientRect();
        const headers=[...document.querySelectorAll('.sidebar,.toolbar')].filter(header=>{
          const r=header.getBoundingClientRect(),style=getComputedStyle(header);
          return ['sticky','fixed'].includes(style.position)&&r.height>0&&r.top<=1&&r.left<=label.left&&r.right>label.left;
        }).map(header=>header.getBoundingClientRect().bottom);
        const image=section.querySelector('.device-shot')?.getBoundingClientRect();
        const copy=section.querySelector('.hero-copy')?.getBoundingClientRect();
        const visual=section.querySelector('.hero-visual')?.getBoundingClientRect();
        return {top:image?Math.min(label.top,image.top):label.top,labelTop:label.top,labelBottom:label.bottom,
          titleTop:title.top,titleBottom:title.bottom,imageTop:image?.top,
          sideBySide:!!visual&&visual.left>=copy.right-2,headerBottom:Math.max(...headers),headers:headers.length,
          heading:heading.tagName,hash:location.hash,width:innerWidth,height:innerHeight,scroll:scrollY,
          max:document.documentElement.scrollHeight-innerHeight,
          active:document.querySelector('.navigation a.active')?.hash};
      })()`);
      const aligned = ['H1','H2'].includes(state.heading) && state.headers > 0
        && Math.abs(state.top - (state.headerBottom + 15)) <= 2
        && state.labelTop >= state.headerBottom - 2 && state.titleTop >= state.headerBottom - 2
        && state.labelBottom <= state.height && state.titleBottom <= state.height
        && (!state.sideBySide || Math.abs(state.labelTop - state.imageTop) <= 2)
        && state.hash === '#' + id && state.active === '#' + id;
      stable = aligned ? stable + 1 : 0;
      if (stable >= 3) return;
      await pause(25);
    }
    assert(['H1','H2'].includes(state.heading), `${id} must retain its section heading`);
    assert(state.headers > 0, `${id} has no visible sticky header`);
    assert.equal(state.hash, '#' + id);
    assert(Math.abs(state.top - (state.headerBottom + 15)) <= 2,
      `${id} anchor mismatch: ${JSON.stringify(state)}`);
    assert(state.labelTop >= state.headerBottom - 2 && state.titleTop >= state.headerBottom - 2
      && state.labelBottom <= state.height && state.titleBottom <= state.height,
      `${id} eyebrow or heading is covered: ${JSON.stringify(state)}`);
    assert(!state.sideBySide || Math.abs(state.labelTop - state.imageTop) <= 2,
      `Overview eyebrow and image are misaligned: ${JSON.stringify(state)}`);
    assert.equal(state.active, '#' + id, 'Menu highlight must match the anchored section');
  };
  const captureLanding = async (id, width) => {
    if (!shots) return;
    const shot = await send('Page.captureScreenshot', {format: 'png'});
    await writeFile(path.join(shots, `${id}-${width}.png`), Buffer.from(shot.data, 'base64'));
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', {url: base});
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("document.readyState==='complete'&&!!document.querySelector('.navigation')")) break;
    await pause(50);
  }
  await send('Page.bringToFront');
  if (projectEntryOnly) {
    assert(!onProject, 'Pass the community home URL for the project-entry check');
    for (const width of [1440, 390]) {
      await send('Emulation.setDeviceMetricsOverride', {width,height:1000,deviceScaleFactor:1,mobile:false});
      await send('Page.navigate', {url:base});
      await waitFor(()=>evaluate("document.readyState==='complete'&&!!document.querySelector('.current-project')"), 'Community home did not load');
      await clickMenu('projects');
      await verifyAnchor('projects');
      const point = await evaluate(`(() => {
        const image=document.querySelector('.current-project img');
        image.scrollIntoView({block:'center',behavior:'instant'});
        const r=image.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
      })()`);
      await send('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent', {type:'mouseReleased',...point,button:'left',clickCount:1});
      const destination = new URL('projects/zynthian-edition/#overview',base).href;
      await waitFor(()=>evaluate(`location.href===${JSON.stringify(destination)}&&document.readyState==='complete'&&!!document.querySelector('#hero-title')`),'Project thumbnail did not navigate to Overview');
      await verifyAnchor('overview');
      await captureLanding('project-entry',width);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: desktop/mobile project thumbnail opens Overview 15 px below the header');
  } else {
  const sectionIds = await evaluate(`[...document.querySelectorAll('.navigation a[href^="#"]')].map(link=>link.hash.slice(1))`);
  assert.deepEqual(sectionIds, onProject ? ['overview','story','interface','status','inside'] : ['overview','story','projects','discuss']);
  if (!onProject) {
    assert.equal(await evaluate("document.querySelector('#discuss-title').textContent"), 'Discussion');
    assert.equal(await evaluate("document.querySelector('.brand strong').textContent"), 'RHIZOME');
    assert.equal(await evaluate("document.querySelectorAll('.project-card').length"), 3);
  }
  if (!discussionsOnly) {
  for (const width of [1440, 390, 1024]) {
    await send('Emulation.setDeviceMetricsOverride', {width, height: 1000, deviceScaleFactor: 1, mobile: false});
    await pause(50);
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Horizontal overflow');
    assert.equal(await evaluate('document.querySelectorAll("h1").length'), 1);
    assert.equal(await evaluate('document.querySelectorAll("a[href*=readme],a[href*=README],a[href*=STATE],a[href*=AGENTS]").length'), 0);
    for (const id of [sectionIds.at(-1), ...sectionIds, sectionIds.at(-1)]) {
      await clickMenu(id);
      await verifyAnchor(id);
    }
    for (const id of [...sectionIds].reverse()) await clickMenu(id);
    await verifyAnchor(sectionIds[0]);
    if (!onProject) {
      await clickMenu('projects');
      const point = await evaluate(`(() => {const r=document.querySelector('.brand').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await send('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent', {type:'mouseReleased',...point,button:'left',clickCount:1});
      await verifyAnchor('overview');
    }
    if (shots && [1440, 390].includes(width)) {
      await captureLanding('overview', width);
      await clickMenu(checkpoint);await verifyAnchor(checkpoint);
      await captureLanding(checkpoint, width);
    }
  }
  for (const width of [1440, 390]) {
    await send('Emulation.setDeviceMetricsOverride', {width,height:1000,deviceScaleFactor:1,mobile:false});
    await pause(100);
    for (const id of [checkpoint,sectionIds.at(-1),checkpoint,checkpoint,'overview','overview',sectionIds.at(-1)]) await clickMenu(id);
    await verifyAnchor(sectionIds.at(-1));
    for (const id of ['overview',checkpoint,sectionIds.at(-1)]) {
      const url = new URL(base);
      url.searchParams.set('verify-anchor', `${width}-${id}`);
      url.hash = id;
      await send('Page.navigate', {url:url.href});
      await waitFor(()=>evaluate(`location.href===${JSON.stringify(url.href)}&&document.readyState==='complete'&&!!document.querySelector('.navigation')`), 'Direct hash page did not load');
      await verifyAnchor(id);
    }
    await clickMenu('story');await verifyAnchor('story');
    await clickMenu(checkpoint);await verifyAnchor(checkpoint);
    await evaluate('history.back()');await verifyAnchor('story');
    await evaluate('history.forward()');await verifyAnchor(checkpoint);
  }
  for (const width of [1440,390,768,1024]) {
    await send('Emulation.setDeviceMetricsOverride', {width,height:800,deviceScaleFactor:1,mobile:false});
    await verifyAnchor(checkpoint);
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Resize introduced horizontal overflow');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: eyebrow/header anchors, visible headings, Overview image alignment, responsive navigation, direct hashes, history, rapid clicks and anchored resize');
  }
  if (!anchorsOnly) {
    if (onProject) {
    assert.equal(await evaluate('document.querySelectorAll(".nav-number,.display-index").length'), 0);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-interface-view]')].map(button=>button.dataset.interfaceView)"),
      ['panel', 'mixer', 'chains', 'parameters', 'audition']);
    const clickChoice = async view => {
      const point = await evaluate(`(() => {
        const button=document.querySelector('[data-interface-view="${view}"]');
        button.scrollIntoView({block:'center',behavior:'instant'});
        const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
      })()`);
      await pause(50);
      await send('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent', {type:'mouseReleased',...point,button:'left',clickCount:1});
    };
    for (const width of [1440, 390, 768]) {
      await send('Emulation.setDeviceMetricsOverride', {width,height:1000,deviceScaleFactor:1,mobile:false});
      await pause(100);
      await clickMenu('interface');
      await verifyAnchor('interface');
      assert.equal(await evaluate("document.querySelector('[data-interface-view][aria-pressed=true]').dataset.interfaceView"), 'panel');
      for (const [view, top, bottom] of [['panel'], ['chains',696,904], ['parameters',910,1122], ['audition',1126,1398], ['mixer',350,692]]) {
        await clickChoice(view);
        const state=await evaluate(`(() => {
          const svg=document.querySelector('.interface-dimmer');
          const shot=document.querySelector('.interface-shot').getBoundingClientRect();
          const overlay=svg.getBoundingClientRect();
          return {selected:[...document.querySelectorAll('[data-interface-view][aria-pressed=true]')].map(button=>button.dataset.interfaceView),
            hidden:getComputedStyle(svg).display==='none',path:svg.querySelector('path').getAttribute('d'),
            aligned:Math.abs(shot.x-overlay.x)<1&&Math.abs(shot.y-overlay.y)<1&&Math.abs(shot.width-overlay.width)<1&&Math.abs(shot.height-overlay.height)<1};
        })()`);
        assert.deepEqual(state.selected,[view]);
        assert.equal(state.hidden,view==='panel');
        if(view!=='panel') {
          assert(state.aligned,'Spotlight must scale with the image');
          assert.equal(state.path,`M0 0H1920V1600H0Z M86 ${top}H1835V${bottom}H86Z`);
        }
      }
      await evaluate("document.querySelector('[data-interface-view=mixer]').focus({preventScroll:true})");
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      assert.equal(await evaluate("document.querySelector('[data-interface-view][aria-pressed=true]').dataset.interfaceView"),'mixer');
      await evaluate("document.querySelector('[data-interface-view=panel]').focus({preventScroll:true})");
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
      assert(await evaluate("document.querySelector('[data-interface-view=panel]').getAttribute('aria-pressed')==='true'"));
      await clickMenu('overview');await verifyAnchor('overview');
      await clickMenu('interface');await verifyAnchor('interface');
      assert.equal(await evaluate("document.querySelector('[data-interface-view][aria-pressed=true]').dataset.interfaceView"),'panel');
      assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Interface controls overflow');
      if(shots&&[1440,390].includes(width)) {
        await pause(250);
        const clip=await evaluate(`(() => {const r=document.querySelector('#interface').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()`);
        const shot=await send('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true});
        await writeFile(path.join(shots,`interface-${width}.png`),Buffer.from(shot.data,'base64'));
      }
    }
    assert(await evaluate(`(() => {
      const panel=document.querySelector('.development-details');
      return !panel.querySelector('details,summary')&&panel.querySelector('p').getBoundingClientRect().height>0
        &&panel.innerText.includes('currently in Alpha')&&panel.innerText.includes('open-sourced when it reaches a stable Beta');
    })()`));
    }
    if (onProject) {
    await evaluate(`document.querySelector('[data-open-image]').click();document.querySelector('.dialog-image img').decode()`);
    assert(await evaluate("document.querySelector('dialog').open"));
    await send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
    await send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await evaluate("!document.querySelector('dialog').open&&!document.body.classList.contains('image-open')")) break;
      await pause(50);
    }
    assert(await evaluate("!document.querySelector('dialog').open&&!document.body.classList.contains('image-open')"));
    const photos = await evaluate("[...document.querySelectorAll('.inside-photo button')].map(button=>button.dataset.imageSrc)");
    assert.equal(photos.length, 7);
    for (const source of photos) {
      await evaluate(`(async()=>{
        const button=[...document.querySelectorAll('.inside-photo button')].find(item=>item.dataset.imageSrc===${JSON.stringify(source)});
        button.click();await document.querySelector('.dialog-image img').decode();return true;
      })()`);
      assert.equal(await evaluate("document.querySelector('.dialog-image img').currentSrc"), new URL(source, base).href);
      await evaluate("document.querySelector('[data-close-image]').click()");
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await evaluate("!document.querySelector('dialog').open&&!document.body.classList.contains('image-open')")) break;
        await pause(50);
      }
      assert(await evaluate("!document.querySelector('dialog').open&&!document.body.classList.contains('image-open')"));
    }
    }
    assert.equal(await evaluate("document.querySelectorAll('.nav-displays i').length"), 4);
    assert.equal(await evaluate("document.querySelector('.upstream-credit a').href"), 'https://zynthian.org/');
    if (!onProject) {
    assert(await evaluate("!!document.querySelector('#discuss a[href=\"https://github.com/Eurikon/RhizomeController/discussions\"]')"));
    await clickMenu('discuss');
    await verifyAnchor('discuss');
    const liveResponse = await fetch(feedURL, {signal: AbortSignal.timeout(10000)});
    assert.equal(liveResponse.status, 200, 'Public discussion feed unavailable');
    const liveFeed = await liveResponse.json();
    assert.equal(liveFeed.version, 1);
    const liveThreads = [...liveFeed.discussions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.number - a.number).slice(0, 5);
    const announcement = liveThreads.find(item => item.number === 1 && item.author?.login === 'Eurikon');
    assert(announcement, 'Owner announcement missing from the live feed');
    const listNumbers = () => evaluate("[...document.querySelectorAll('.discussion-choice')].map(button=>Number(button.dataset.discussionNumber))");
    const postState = () => evaluate(`(() => {
      const view=document.querySelector('.discussion-view');
      const widget=document.querySelector('[data-discussion-widget]');
      return {number:Number(view.dataset.discussionNumber),title:document.querySelector('#discussion-post-title').textContent,
        html:document.querySelector('.discussion-post-body').innerHTML,text:document.querySelector('.discussion-post-body').textContent,
        link:document.querySelector('.discussion-thread-link').href,hidden:view.hidden,commentsHidden:widget.hidden,
        ready:widget.hasAttribute('data-ready'),commentsVisible:getComputedStyle(document.querySelector('.giscus')).visibility==='visible',
        status:document.querySelector('.discussion-status').textContent};
    })()`);
    const chooseThread = async number => {
      await evaluate(`document.querySelector('.discussion-choice[data-discussion-number="${number}"]').click()`);
      await waitFor(async () => (await postState()).number === number, `Discussion ${number} did not open`);
    };
    await waitFor(async () => (await listNumbers()).length > 0, 'Live discussion list did not load');
    assert.deepEqual(await listNumbers(), liveThreads.map(item => item.number));
    await chooseThread(announcement.number);
    const livePost = await postState();
    assert.equal(livePost.title, announcement.title);
    assert.equal(livePost.link, announcement.url);
    assert.equal(livePost.hidden, false);
    const announcementText = await evaluate(`new DOMParser().parseFromString(${JSON.stringify(announcement.bodyHTML)},'text/html').body.textContent`);
    const normalizeText = text => text.replace(/\s+/g, ' ').trim();
    assert.equal(normalizeText(livePost.text), normalizeText(announcementText), 'Live full post was truncated or stale');
    assert.deepEqual(await evaluate(`(() => {
      const config=document.querySelector('#discuss script[data-giscus-client]').dataset;
      return [config.repo,config.mapping,config.term,config.emitMetadata,config.theme];
    })()`), ['Eurikon/RhizomeController','number',String(announcement.number),'1',(['localhost','127.0.0.1'].includes(new URL(base).hostname) ? 'https://eurikon.github.io/RhizomeZynthianEdition/giscus-theme.css' : 'https://eurikon.github.io/RhizomeController/giscus-theme.css')]);
    await waitFor(async () => (await postState()).ready, 'Official giscus did not confirm the live announcement', 30000);
    console.log(`PASS: live discussion #${announcement.number} “${announcement.title}”, full post and official giscus metadata`);
    if(shots) {
      for(const width of [1440,390]) {
        await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
        await pause(100);
        await clickMenu('discuss');await verifyAnchor('discuss');
        assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Discussion panel overflows');
        const shot=await send('Page.captureScreenshot',{format:'png'});
        await writeFile(path.join(shots,`discuss-${width}.png`),Buffer.from(shot.data,'base64'));
      }
    }
    let giscusContext;
    const attached = new Set();
    await waitFor(async () => {
      giscusContext = [...contexts.values()].find(context => context.origin === 'https://giscus.app' && context.auxData?.isDefault);
      if (giscusContext) return true;
      const {targetInfos} = await send('Target.getTargets');
      for (const target of targetInfos.filter(item => item.type === 'iframe' && item.url.startsWith('https://giscus.app/'))) {
        if (attached.has(target.targetId)) continue;
        attached.add(target.targetId);
        const {sessionId} = await send('Target.attachToTarget', {targetId: target.targetId, flatten: true});
        await send('Runtime.enable', {}, sessionId);
      }
      return false;
    }, 'Unable to observe official giscus configuration messages');
    await evaluate(`(() => {
      window.__rhizomeConfigs=[];
      addEventListener('message',event=>{
        if(event.source===parent&&event.origin===${JSON.stringify(new URL(base).origin)}&&event.data?.giscus?.setConfig)
          window.__rhizomeConfigs.push(event.data.giscus.setConfig);
      });return true;
    })()`, giscusContext);
    const configs = () => evaluate('window.__rhizomeConfigs', giscusContext);
    const sendMetadata = (number, overrides = {}) => evaluate(`(() => {
      const iframe=document.querySelector('.giscus-frame');
      const discussion={url:'https://github.com/Eurikon/RhizomeController/discussions/${number}',repository:{nameWithOwner:'Eurikon/RhizomeController'}};
      const settings=${JSON.stringify(overrides)};
      if(settings.repository) discussion.repository.nameWithOwner=settings.repository;
      window.dispatchEvent(new MessageEvent('message',{origin:settings.origin||'https://giscus.app',
        source:settings.wrongSource?window:iframe.contentWindow,data:{giscus:{discussion}}}));
    })()`);
    let intercepted = 0, feedReply;
    const archiveURL = feedURL.replace('discussions.json', 'threads/');
    const archivedReplies = new Map();
    let archiveRequests = 0;
    handlers.set('Fetch.requestPaused', async ({requestId, request}) => {
      const url = new URL(request.url), expected = new URL(feedURL);
      if ((url.origin + url.pathname).startsWith(archiveURL)) {
        archiveRequests++;
        const match = /\/(\d+)\.json$/.exec(url.pathname);
        const payload = match && archivedReplies.get(Number(match[1]));
        return send('Fetch.fulfillRequest', {requestId,responseCode:payload?200:404,
          responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],
          body:Buffer.from(JSON.stringify(payload||{})).toString('base64')});
      }
      assert.equal(url.origin + url.pathname, expected.origin + expected.pathname, 'Unexpected intercepted URL');
      intercepted++;
      if (feedReply.error) return send('Fetch.failRequest', {requestId, errorReason: 'InternetDisconnected'});
      return send('Fetch.fulfillRequest', {requestId, responseCode: 200,
        responseHeaders: [{name:'Content-Type',value:'application/json'}, {name:'Access-Control-Allow-Origin',value:'*'},
          {name:'Cache-Control',value:'no-store'}], body:Buffer.from(JSON.stringify(feedReply)).toString('base64')});
    });
    const thread = number => ({number,title:`Synthetic discussion ${number}`,bodyHTML:`<p>Body ${number}</p>`,
      url:`https://github.com/Eurikon/RhizomeController/discussions/${number}`,
      updatedAt:new Date(Date.UTC(2026,10,9,12,number%1000)).toISOString(),category:{name:'Ideas'},
      author:{login:'SyntheticAuthor',url:'https://github.com/SyntheticAuthor',avatarUrl:''},comments:{totalCount:0}});
    const synthetic = [1004,1001,1007,1002,1006,1003,1005].map(thread);
    const fullPost = synthetic.find(item=>item.number===1007);
    fullPost.bodyHTML = '<h1>Full post heading</h1><p>BEGIN FULL POST</p>'
      + Array.from({length:24},(_,index)=>`<p>Complete paragraph ${index+1}, retained in the selected discussion.</p>`).join('')
      + '<p>END FULL POST</p>';
    const malicious = synthetic.find(item=>item.number===1005);
    malicious.bodyHTML = `<p>Safe text remains</p><script>window.__rhizomeUnsafe=true</script>
      <img src="https://eurikon.github.io/RhizomeZynthianEdition/verification-missing-image.png" onerror="window.__rhizomeUnsafe=true">
      <a href="javascript:window.__rhizomeUnsafe=true">unsafe-js</a><a href="data:text/html,unsafe">unsafe-data</a>
      <a href="https://user:password@example.com/">unsafe-credentials</a><a href="https://zynthian.org/">safe-link</a>
      <iframe srcdoc="<script>parent.__rhizomeUnsafe=true</script>"></iframe><svg onload="window.__rhizomeUnsafe=true"></svg>
      <style>body{display:none}</style><form><input name="discussion-post-title"><button>Unsafe control</button></form>`;
    feedReply = {version:1,generatedAt:new Date().toISOString(),discussions:synthetic};
    await send('Fetch.enable', {patterns:[{urlPattern:feedURL.replace('discussions.json','*'),requestStage:'Request'}]});
    const refresh = async () => {
      const before = intercepted;
      await evaluate("window.dispatchEvent(new Event('focus'))");
      await waitFor(()=>intercepted>before, 'Discussion refresh did not request its feed');
    };
    await refresh();
    await waitFor(async()=>JSON.stringify(await listNumbers())===JSON.stringify([1007,1006,1005,1004,1003]), 'Recent discussion ordering or five-item limit failed');
    assert.equal((await postState()).number, announcement.number, 'Refresh replaced an open post');
    await chooseThread(1007);
    let opened=await postState();
    assert.equal(opened.title,fullPost.title);
    assert(opened.text.includes('BEGIN FULL POST')&&opened.text.includes('Complete paragraph 24')&&opened.text.includes('END FULL POST'), 'Full post content was truncated');
    assert.equal(await evaluate("document.querySelectorAll('.discussion-post-body p').length"),26);
    assert.equal(await evaluate("document.querySelectorAll('h1').length"),1,'Post changed the page heading hierarchy');
    await waitFor(async()=>(await configs()).at(-1)?.number===1007,'Official giscus did not receive selected discussion number');
    assert.equal((await configs()).at(-1).repo,'Eurikon/RhizomeController');
    assert.equal(await evaluate("new URL(location.href).searchParams.get('discussion')"),'1007');
    assert.equal(await evaluate("document.querySelector('.discussion-choice[data-discussion-number=\"1007\"] .discussion-choice-category').textContent"),'Ideas');
    assert(await evaluate("document.querySelector('.discussion-choice time').dateTime.length>0"));
    assert.equal(await evaluate("document.querySelector('.discussion-actions a[href$=\"/discussions/new\"]').textContent.trim()"),'Start a discussion ↗');
    await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedDiscussion=text}}});document.querySelector('[data-copy-discussion]').click()`);
    await waitFor(()=>evaluate("window.__copiedDiscussion==='https://eurikon.github.io/RhizomeController/?discussion=1007#discuss'"),'Copy link did not use the public canonical address');

    await chooseThread(1005);
    const safe=await evaluate(`(() => {
      const body=document.querySelector('.discussion-post-body');
      const nodes=[...body.querySelectorAll('*')];
      for(const link of body.querySelectorAll('a:not([href])'))link.click();
      return {triggered:window.__rhizomeUnsafe===true,forbidden:body.querySelectorAll('script,iframe,svg,style,form,input,button,object,embed').length,
        handlers:nodes.some(node=>[...node.attributes].some(attribute=>/^on/i.test(attribute.name)||['srcdoc','style'].includes(attribute.name))),
        unsafeURLs:nodes.some(node=>['href','src'].some(name=>{const value=node.getAttribute(name);return value&&(!/^https?:/.test(value)||new URL(value).username||new URL(value).password)})),
        safeLink:[...body.querySelectorAll('a')].find(link=>link.textContent==='safe-link')?.outerHTML,text:body.textContent};
    })()`);
    assert.equal(safe.triggered,false);assert.equal(safe.forbidden,0);assert.equal(safe.handlers,false);assert.equal(safe.unsafeURLs,false);
    assert(safe.safeLink.includes('noopener noreferrer')&&safe.safeLink.includes('https://zynthian.org/'));
    assert(safe.text.includes('Safe text remains'));
    await chooseThread(1006);
    await waitFor(async()=>(await configs()).at(-1)?.number===1006,'Giscus failed to switch discussions');
    const awaiting=await postState();
    assert.equal(awaiting.ready,false);assert.equal(awaiting.commentsVisible,false,'Old comments stayed visible while switching');
    for(const [number,override] of [[1005,{}],[1006,{origin:'https://example.com'}],[1006,{wrongSource:true}],[1006,{repository:'Other/Repository'}]]) {
      await sendMetadata(number,override);
      assert.equal((await postState()).ready,false,'Stale or untrusted metadata revealed comments');
    }
    await sendMetadata(1006);
    assert.equal((await postState()).ready,true,'Selected-thread metadata was not accepted');
    await evaluate('history.back()');
    await waitFor(async()=>(await postState()).number===1005,'Back did not restore the previous discussion');
    await evaluate('history.forward()');
    await waitFor(async()=>(await postState()).number===1006,'Forward did not restore the next discussion');
    await waitFor(async()=>(await configs()).at(-1)?.number===1006,'History navigation did not update giscus');
    await sendMetadata(1006);
    const retained=await postState(), configCount=(await configs()).length;
    feedReply={version:1,generatedAt:new Date().toISOString(),discussions:[2003,2007,2001,2006,2005,2002,2004].map(thread)};
    await refresh();
    await waitFor(async()=>JSON.stringify(await listNumbers())===JSON.stringify([2007,2006,2005,2004,2003]),'Updated recent discussions did not refresh');
    const refreshed=await postState();
    assert.equal(refreshed.number,retained.number);assert.equal(refreshed.title,retained.title);assert.equal(refreshed.html,retained.html);
    assert.equal((await configs()).length,configCount,'Feed refresh unnecessarily switched comments');
    feedReply={error:true};
    await refresh();
    await waitFor(()=>evaluate("!document.querySelector('.discussion-feed-status').hidden&&document.querySelector('.discussion-feed-status').textContent.includes('unchanged')"),'Feed failure was not communicated');
    const offline=await postState();
    assert.equal(offline.number,retained.number);assert.equal(offline.title,retained.title);assert.equal(offline.html,retained.html);
    assert.equal(await evaluate('window.__rhizomeUnsafe===true'),false,'Delayed malicious content executed');
    assert.equal((await configs()).length,configCount,'Feed failure switched comments');
    feedReply={version:1,generatedAt:new Date().toISOString(),discussions:[2007,2006,2005,2004,2003].map(thread)};
    const older=thread(1002);
    older.title='Archived discussion outside the recent five';
    archivedReplies.set(1002,{version:1,discussions:[older]});
    const linked=new URL(base);linked.searchParams.set('discussion','1002');linked.hash='discuss';
    await send('Page.navigate',{url:linked.href});
    await waitFor(async()=>(await postState()).number===1002,'Shared older discussion did not load');
    assert.equal((await postState()).title,older.title);
    assert.deepEqual(await listNumbers(),[2007,2006,2005,2004,2003]);
    await verifyAnchor('discuss');
    await send('Page.reload');
    await waitFor(async()=>(await postState()).number===1002,'Reload did not restore the shared discussion');
    const missing=new URL(base);missing.searchParams.set('discussion','9999');missing.hash='discuss';
    await send('Page.navigate',{url:missing.href});
    await waitFor(()=>evaluate("!!document.querySelector('.discussion-feed-status a[href$=\"/discussions/9999\"]')"),'Unavailable shared discussion did not provide its GitHub link');
    assert.equal((await postState()).hidden,true,'Unavailable link showed a different discussion');
    const beforeInvalid=archiveRequests;
    const invalid=new URL(base);invalid.searchParams.set('discussion','../1002');invalid.hash='discuss';
    await send('Page.navigate',{url:invalid.href});
    await waitFor(async()=>(await postState()).number===2007,'Invalid thread parameter did not fall back safely');
    assert.equal(archiveRequests,beforeInvalid,'Invalid parameter reached the archive endpoint');
    console.log('PASS: compact topic metadata, public copy link, creation link, history, older-thread links, reload and missing/invalid thread handling');
    await send('Fetch.disable');
    handlers.delete('Fetch.requestPaused');
    console.log('PASS: synthetic five-thread ordering, full posts, inert HTML, giscus configuration and stale-message protection, preserved selection and offline refresh');
    }
    for (const route of ['readme.html', 'README.md']) assert.equal((await fetch(new URL(route, base))).status, 404);
    assert.deepEqual(errors, []);
    console.log(onProject ? 'PASS: Zynthian interface controls, image viewer, credits and version panel' : 'PASS: community hardware gallery, image viewer, credits and discussion feed');
  }
  }
} finally {
  socket?.close();
  browser.kill('SIGTERM');
  await exited;
  await rm(profile, {recursive: true, force: true});
}
