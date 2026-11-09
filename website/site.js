'use strict';

const assetBase = new URL('.', document.querySelector('script[src*="site.js"]').src);
const dialog = document.querySelector('.image-dialog');
if (dialog) {
  const image = dialog.querySelector('.dialog-image img');
  const title = dialog.querySelector('.dialog-toolbar > span');
  const caption = dialog.querySelector('p');
  const defaults = {titleNodes: [...title.childNodes].map(node => node.cloneNode(true)), caption: caption.textContent,
    alt: image.alt, label: dialog.getAttribute('aria-label')};
  document.querySelectorAll('[data-open-image]').forEach(button => {
    button.addEventListener('click', () => {
      image.src = button.dataset.imageSrc || new URL(image.dataset.defaultSrc || 'assets/rhizome-interface-full.png', assetBase).href;
      image.alt = button.dataset.imageSrc ? button.querySelector('img').alt : defaults.alt;
      if (button.dataset.imageTitle) title.textContent = button.dataset.imageTitle;
      else title.replaceChildren(...defaults.titleNodes.map(node => node.cloneNode(true)));
      caption.textContent = button.dataset.imageCaption || defaults.caption;
      dialog.setAttribute('aria-label', button.dataset.imageTitle || defaults.label);
      dialog.showModal();
      document.body.classList.add('image-open');
    });
  });
  dialog.querySelector('[data-close-image]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => document.body.classList.remove('image-open'));
}

const interfaceChoices = [...document.querySelectorAll('[data-interface-view]')];
const interfaceDimmer = document.querySelector('.interface-dimmer');
const interfaceRegions = {mixer: [350, 342], chains: [696, 208],
  parameters: [910, 212], audition: [1126, 272]};
const selectInterface = view => {
  if (!interfaceDimmer) return;
  for (const choice of interfaceChoices) {
    choice.setAttribute('aria-pressed', String(choice.dataset.interfaceView === view));
  }
  interfaceDimmer.toggleAttribute('hidden', view === 'panel');
  const region = interfaceRegions[view];
  if (region) {
    const [top, height] = region;
    interfaceDimmer.querySelector('path').setAttribute('d',
      `M0 0H1920V1600H0Z M86 ${top}H1835V${top + height}H86Z`);
  }
};
for (const choice of interfaceChoices) {
  choice.addEventListener('click', () => selectInterface(choice.dataset.interfaceView));
}
selectInterface('panel');

const contactStatus = document.querySelector('.contact-status');
if (contactStatus && new URLSearchParams(location.search).get('contact') === 'sent') {
  contactStatus.hidden = false;
}

const links = [...document.querySelectorAll('.navigation a[href^="#"]')];
const sections = links.map(link => ({link, section: document.getElementById(link.hash.slice(1))}))
  .filter(entry => entry.section)
  .map(entry => ({...entry, anchor: entry.section.querySelector('.eyebrow'), inset: 0}))
  .sort((a, b) => a.section.compareDocumentPosition(b.section) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
if (sections.length) {
  const root = document.documentElement;
  const sidebar = document.querySelector('.sidebar');
  const toolbar = document.querySelector('.toolbar');
  const overview = sections.find(entry => entry.section.id === 'overview');
  const copy = overview?.section.querySelector('.hero-copy');
  const shot = overview?.section.querySelector('.device-shot');
  let frame = 0;
  let activeSection = null;
  let anchoredSection = null;
  let navigationTarget = null;
  let navigationFrame = 0;
  let anchorOffset = 0;
  const anchorTop = entry => entry.section.getBoundingClientRect().top + entry.inset;
  const updateActive = () => {
    frame = 0;
    const boundary = anchorOffset + 2;
    let current = sections[0];
    for (const entry of sections) {
      if (anchorTop(entry) <= boundary) current = entry;
    }
    anchoredSection = Math.abs(anchorTop(current) - anchorOffset) <= 2 ? current : null;
    if (anchoredSection === navigationTarget) navigationTarget = null;
    if (current.section.id === 'interface' && activeSection !== 'interface') selectInterface('panel');
    activeSection = current.section.id;
    for (const entry of sections) {
      const active = entry === current;
      entry.link.classList.toggle('active', active);
      if (active) entry.link.setAttribute('aria-current', 'location');
      else entry.link.removeAttribute('aria-current');
    }
  };
  const queueUpdate = () => {
    if (!frame) frame = requestAnimationFrame(updateActive);
  };
  const updateOffset = () => {
    const retained = navigationTarget || anchoredSection;
    const header = getComputedStyle(sidebar).position === 'sticky' ? sidebar : toolbar;
    anchorOffset = header.getBoundingClientRect().height + 15;
    root.style.setProperty('--anchor-offset', `${anchorOffset}px`);
    let imageInset = Infinity;
    if (copy && shot) {
      copy.style.setProperty('--hero-copy-offset', '0px');
      if (getComputedStyle(overview.section).display === 'grid') {
        const previousTransform = shot.style.transform;
        const previousTransition = shot.style.transition;
        // Hover must not change the resting image's alignment point.
        shot.style.transition = 'none';
        shot.style.transform = getComputedStyle(shot).getPropertyValue('--resting-transform');
        const imageTop = shot.getBoundingClientRect().top;
        imageInset = imageTop - overview.section.getBoundingClientRect().top;
        shot.style.transform = previousTransform;
        shot.style.transition = previousTransition;
        copy.style.setProperty('--hero-copy-offset', `${imageTop - overview.anchor.getBoundingClientRect().top}px`);
      }
    }
    for (const entry of sections) {
      const labelInset = entry.anchor.getBoundingClientRect().top - entry.section.getBoundingClientRect().top;
      entry.inset = entry === overview ? Math.min(labelInset, imageInset) : labelInset;
      entry.section.style.setProperty('--anchor-inset', `${entry.inset}px`);
    }
    if (retained) retained.section.scrollIntoView({block: 'start', behavior: 'instant'});
    queueUpdate();
  };
  window.addEventListener('scroll', queueUpdate, {passive: true});
  window.addEventListener('resize', updateOffset);
  for (const entry of sections) {
    const triggers = entry === overview ? [entry.link, ...document.querySelectorAll('.brand[href="#overview"]')] : [entry.link];
    for (const trigger of triggers) trigger.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigationTarget = entry;
      anchoredSection = null;
      if (location.hash !== entry.link.hash) history.pushState(null, '', entry.link.hash);
      cancelAnimationFrame(navigationFrame);
      navigationFrame = requestAnimationFrame(() => {
        entry.section.scrollIntoView({block: 'start', behavior: 'auto'});
        queueUpdate();
      });
    });
  }
  window.addEventListener('hashchange', () => {
    navigationTarget = sections.find(entry => entry.link.hash === location.hash) || null;
    queueUpdate();
  });
  const releaseTarget = () => { navigationTarget = null; };
  window.addEventListener('wheel', releaseTarget, {passive: true});
  window.addEventListener('touchstart', releaseTarget, {passive: true});
  window.addEventListener('keydown', event => {
    if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) releaseTarget();
  });
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(updateOffset);
    observer.observe(sidebar);
    observer.observe(toolbar);
    for (const entry of sections) {
      observer.observe(entry.anchor);
      // Comments can expand after navigating to the section below them.
      observer.observe(entry.section);
    }
    if (shot) observer.observe(shot);
  }
  updateOffset();
  const initialTarget = sections.find(entry => entry.link.hash === location.hash);
  if (initialTarget) initialTarget.section.scrollIntoView({block: 'start', behavior: 'instant'});
}
