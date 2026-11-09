'use strict';

(() => {
  const section = document.getElementById('discuss');
  if (!section) return;
  const repository = 'Eurikon/RhizomeController';
  const themeURL = 'https://eurikon.github.io/RhizomeController/giscus-theme.css';
  const discussionBase = `https://github.com/${repository}/discussions/`;
  const feedURL = `https://raw.githubusercontent.com/${repository}/main/feed/discussions.json`;
  const archiveBase = `https://raw.githubusercontent.com/${repository}/main/feed/threads/`;
  const list = section.querySelector('.discussion-list');
  const feedStatus = section.querySelector('.discussion-feed-status');
  const view = section.querySelector('.discussion-view');
  const title = section.querySelector('#discussion-post-title');
  const category = section.querySelector('.discussion-category');
  const metadata = section.querySelector('.discussion-meta');
  const body = section.querySelector('.discussion-post-body');
  const widget = section.querySelector('[data-discussion-widget]');
  const container = widget.querySelector('.giscus');
  const commentStatus = section.querySelector('.discussion-status');
  const threadLink = section.querySelector('.discussion-thread-link');
  const copyLink = section.querySelector('[data-copy-discussion]');
  const copyStatus = section.querySelector('.discussion-copy-status');
  const canonical = document.querySelector('link[rel="canonical"]').href;
  const dateFormat = new Intl.DateTimeFormat('en-GB', {day: '2-digit', month: '2-digit', year: 'numeric'});
  const allowedTags = new Set(['p', 'strong', 'b', 'em', 'i', 'del', 's', 'br', 'hr', 'blockquote',
    'pre', 'code', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'details', 'summary', 'kbd', 'sub', 'sup']);
  const discardedTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
    'form', 'input', 'button', 'textarea', 'select', 'option', 'link', 'meta', 'base', 'template']);
  let discussions = [];
  let selected = null;
  let pendingFetch = false;
  let visible = false;
  let started = false;
  let frameLoaded = false;
  let frame = null;
  let selectionVersion = 0;
  let commentTimeout;
  let routeVersion = 0;
  const readRequestedNumber = () => {
    const value = new URL(location.href).searchParams.get('discussion') || '';
    return /^[1-9]\d{0,14}$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : 0;
  };
  let requestedNumber = readRequestedNumber();
  const discussionURL = number => {
    const url = new URL(canonical);
    url.searchParams.set('discussion', String(number));
    url.hash = 'discuss';
    return url.href;
  };
  const unavailableDiscussion = () => {
    feedStatus.hidden = false;
    feedStatus.textContent = 'This discussion is unavailable here. ';
    if (requestedNumber) {
      const link = document.createElement('a');
      link.href = discussionBase + requestedNumber;
      link.textContent = 'View on GitHub ↗';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      feedStatus.appendChild(link);
    }
  };

  const readableDate = value => dateFormat.format(new Date(value)).replaceAll('/', '-');
  const safeURL = (value, image = false) => {
    if (!value.trim()) return null;
    try {
      const url = new URL(value, discussionBase);
      if (!['https:', ...(image ? [] : ['http:'])].includes(url.protocol) || url.username || url.password) return null;
      return url.href;
    } catch { return null; }
  };
  const sanitizedBody = html => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const copy = node => {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
      if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
      const tag = node.localName.toLowerCase();
      if (discardedTags.has(tag)) return document.createDocumentFragment();
      const elementTag = /^h[1-6]$/.test(tag) ? `h${Math.min(6, Number(tag[1]) + 3)}` : tag;
      const result = allowedTags.has(tag) ? document.createElement(elementTag) : document.createDocumentFragment();
      if (tag === 'a') {
        const href = safeURL(node.getAttribute('href') || '');
        if (href) {
          result.href = href;
          result.target = '_blank';
          result.rel = 'noopener noreferrer';
        }
      }
      if (tag === 'img') {
        const source = safeURL(node.getAttribute('src') || '', true);
        if (!source) return document.createTextNode(node.getAttribute('alt') || '');
        result.src = source;
        result.alt = node.getAttribute('alt') || '';
        result.loading = 'lazy';
        result.referrerPolicy = 'no-referrer';
      }
      if (tag === 'ol' && /^\d{1,5}$/.test(node.getAttribute('start') || '')) result.start = Number(node.getAttribute('start'));
      for (const child of node.childNodes) result.appendChild(copy(child));
      return result;
    };
    const fragment = document.createDocumentFragment();
    for (const child of parsed.body.childNodes) fragment.appendChild(copy(child));
    return fragment;
  };
  const parseFeed = data => {
    if (data?.version !== 1 || !Array.isArray(data.discussions)) throw Error('Invalid discussion feed');
    const seen = new Set();
    const result = data.discussions.filter(item => {
      if (!Number.isSafeInteger(item?.number) || item.number < 1 || seen.has(item.number) ||
          typeof item.title !== 'string' || typeof item.bodyHTML !== 'string' ||
          item.url !== discussionBase + item.number || !Number.isFinite(Date.parse(item.updatedAt))) return false;
      seen.add(item.number);
      return true;
    }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.number - a.number).slice(0, 5);
    if (data.discussions.length && !result.length) throw Error('Invalid discussion feed');
    return result;
  };
  const showCommentFallback = version => {
    if (version !== selectionVersion) return;
    clearTimeout(commentTimeout);
    widget.hidden = true;
    commentStatus.hidden = false;
    commentStatus.textContent = 'Comments are temporarily unavailable here. You can still read the full post above.';
  };
  const beginCommentLoad = () => {
    clearTimeout(commentTimeout);
    widget.hidden = false;
    delete widget.dataset.ready;
    container.setAttribute('aria-hidden', 'true');
    commentStatus.hidden = false;
    commentStatus.textContent = 'Loading comments…';
    const version = selectionVersion;
    commentTimeout = setTimeout(() => showCommentFallback(version), 20000);
  };
  const sendSelection = () => {
    if (!frameLoaded || !frame || !selected) return;
    frame.contentWindow.postMessage({giscus: {setConfig: {
      number: selected.number, repo: repository, repoId: 'R_kgDOVoQfXQ',
      reactionsEnabled: true, emitMetadata: true, inputPosition: 'top', lang: 'en'
    }}}, 'https://giscus.app');
  };
  const startComments = () => {
    if (section.querySelector('script[data-giscus-client]')) {
      sendSelection();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://giscus.app/client.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    Object.assign(script.dataset, {
      giscusClient: '', repo: repository, repoId: 'R_kgDOVoQfXQ', mapping: 'number',
      term: String(selected.number), reactionsEnabled: '1', emitMetadata: '1',
      inputPosition: 'top', lang: 'en',
      theme: themeURL
    });
    script.addEventListener('load', () => {
      frame = container.querySelector('iframe.giscus-frame');
      if (!frame) return;
      frame.addEventListener('load', () => {
        frameLoaded = true;
        sendSelection();
      });
    }, {once: true});
    script.addEventListener('error', () => showCommentFallback(selectionVersion), {once: true});
    widget.appendChild(script);
  };
  window.addEventListener('message', event => {
    const currentFrame = container.querySelector('iframe.giscus-frame');
    if (event.origin !== 'https://giscus.app' || !currentFrame || event.source !== currentFrame.contentWindow) return;
    const discussion = event.data?.giscus?.discussion;
    if (view.hidden || !selected || !discussion || discussion.url !== discussionBase + selected.number ||
        discussion.repository?.nameWithOwner !== repository) return;
    frame = currentFrame;
    frameLoaded = true;
    clearTimeout(commentTimeout);
    widget.hidden = false;
    widget.dataset.ready = '';
    container.removeAttribute('aria-hidden');
    commentStatus.hidden = true;
  });
  const renderPost = () => {
    if (!selected) return;
    view.hidden = false;
    title.textContent = selected.title;
    category.textContent = typeof selected.category?.name === 'string' ? selected.category.name : 'Discussion';
    const author = typeof selected.author?.login === 'string' ? selected.author.login : 'Community';
    metadata.textContent = `${author} · Updated ${readableDate(selected.updatedAt)}`;
    body.replaceChildren(sanitizedBody(selected.bodyHTML));
    threadLink.href = selected.url;
    view.dataset.discussionNumber = String(selected.number);
    copyLink.disabled = false;
    copyStatus.textContent = '';
  };
  const updateSelection = () => {
    for (const button of list.querySelectorAll('[data-discussion-number]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.discussionNumber) === selected?.number));
    }
  };
  const selectDiscussion = discussion => {
    if (selected?.number === discussion.number) return;
    selected = discussion;
    selectionVersion++;
    renderPost();
    updateSelection();
    beginCommentLoad();
    startComments();
  };
  const restoreDiscussion = async () => {
    const version = ++routeVersion;
    const number = requestedNumber;
    const recent = number ? discussions.find(item => item.number === number) : discussions[0];
    if (recent) {
      selectDiscussion(recent);
      feedStatus.hidden = true;
      return;
    }
    if (!number) return;
    if (selected?.number === number) return;
    selected = null;
    selectionVersion++;
    clearTimeout(commentTimeout);
    view.hidden = true;
    widget.hidden = true;
    copyLink.disabled = true;
    updateSelection();
    feedStatus.hidden = false;
    feedStatus.textContent = 'Loading discussion…';
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 12000);
    try {
      const response = await fetch(archiveBase + number + '.json', {
        signal: abort.signal, credentials: 'omit', cache: 'no-cache'
      });
      if (!response.ok) throw Error('Discussion unavailable');
      const discussion = parseFeed(await response.json()).find(item => item.number === number);
      if (!discussion) throw Error('Discussion unavailable');
      if (version !== routeVersion) return;
      selectDiscussion(discussion);
      feedStatus.hidden = true;
    } catch {
      if (version === routeVersion) unavailableDiscussion();
    } finally {
      clearTimeout(timeout);
    }
  };
  copyLink.addEventListener('click', async () => {
    if (!selected) return;
    const number = selected.number;
    try {
      await navigator.clipboard.writeText(discussionURL(number));
      if (selected?.number === number) copyStatus.textContent = 'Link copied';
    } catch {
      if (selected?.number === number) copyStatus.textContent = 'Could not copy link';
    }
  });
  const renderList = () => {
    const activeNumber = document.activeElement?.closest('.discussion-choice')?.dataset.discussionNumber;
    const fragment = document.createDocumentFragment();
    for (const discussion of discussions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'discussion-choice';
      button.dataset.discussionNumber = String(discussion.number);
      button.setAttribute('aria-controls', 'discussion-post-title');
      const label = document.createElement('span');
      label.className = 'discussion-choice-title';
      label.textContent = discussion.title;
      const detail = document.createElement('span');
      detail.className = 'discussion-choice-meta';
      const topic = document.createElement('span');
      topic.className = 'discussion-choice-category';
      topic.textContent = typeof discussion.category?.name === 'string' ? discussion.category.name : 'Discussion';
      const count = Number.isSafeInteger(discussion.comments?.totalCount) && discussion.comments.totalCount >= 0 ? discussion.comments.totalCount : 0;
      const comments = document.createElement('span');
      comments.textContent = `${count} ${count === 1 ? 'comment' : 'comments'}`;
      detail.append(topic, comments);
      const updated = document.createElement('time');
      updated.className = 'discussion-choice-date';
      updated.dateTime = discussion.updatedAt;
      updated.textContent = readableDate(discussion.updatedAt);
      updated.title = `Last active ${readableDate(discussion.updatedAt)}`;
      label.title = discussion.title;
      detail.insertBefore(updated, comments);
      button.append(label, detail);
      button.addEventListener('click', () => {
        routeVersion++;
        requestedNumber = discussion.number;
        const url = new URL(location.href);
        url.searchParams.set('discussion', String(discussion.number));
        url.hash = 'discuss';
        if (url.href !== location.href) history.pushState(null, '', url.href);
        selectDiscussion(discussion);
        feedStatus.hidden = true;
      });
      fragment.appendChild(button);
    }
    list.replaceChildren(fragment);
    updateSelection();
    if (activeNumber) list.querySelector(`[data-discussion-number="${activeNumber}"]`)?.focus({preventScroll: true});
  };
  const refreshFeed = async () => {
    if (pendingFetch || document.hidden) return;
    pendingFetch = true;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 12000);
    try {
      const url = new URL(feedURL);
      url.searchParams.set('minute', String(Math.floor(Date.now() / 60000)));
      const response = await fetch(url, {signal: abort.signal, credentials: 'omit', cache: 'no-cache'});
      if (!response.ok) throw Error('Discussion feed unavailable');
      discussions = parseFeed(await response.json());
      const updated = discussions.find(item => item.number === selected?.number);
      if (updated) {
        const changed = updated.title !== selected.title || updated.bodyHTML !== selected.bodyHTML ||
          updated.updatedAt !== selected.updatedAt || updated.category?.name !== selected.category?.name ||
          updated.author?.login !== selected.author?.login;
        selected = updated;
        if (changed) renderPost();
      }
      renderList();
      feedStatus.textContent = discussions.length ? '' : 'No discussions yet.';
      feedStatus.hidden = discussions.length > 0;
      if (!selected && (discussions.length || requestedNumber)) await restoreDiscussion();
    } catch {
      if (requestedNumber && !selected) await restoreDiscussion();
      else {
        feedStatus.hidden = false;
        feedStatus.textContent = selected ? 'Recent discussions could not refresh. Your open discussion is unchanged.' : 'Discussions could not load. Please try again shortly.';
      }
    } finally {
      clearTimeout(timeout);
      pendingFetch = false;
    }
  };
  const start = () => {
    if (started) return;
    started = true;
    refreshFeed();
    setInterval(() => {
      if (visible && !document.hidden) refreshFeed();
    }, 60000);
  };
  window.addEventListener('popstate', () => {
    requestedNumber = readRequestedNumber();
    if (started) restoreDiscussion();
    else if (location.hash === '#discuss') start();
  });
  if ('IntersectionObserver' in window) {
    const nearby = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      nearby.disconnect();
      start();
    }, {rootMargin: '240px'});
    nearby.observe(section);
    const visibility = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible) {
        start();
        if (!selected) refreshFeed();
      }
    });
    visibility.observe(section);
  } else {
    visible = true;
    start();
  }
  const refreshOnReturn = () => {
    if (started && visible && !document.hidden) refreshFeed();
  };
  window.addEventListener('focus', refreshOnReturn);
  document.addEventListener('visibilitychange', refreshOnReturn);
})();
