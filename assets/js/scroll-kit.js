// scroll-kit.js — small, dependency-free helpers for scroll-driven brand sites (plain ES module, no build step).
//
//   import { initScrollKit } from './scroll-kit.js';
//   initScrollKit();                      // wires everything below from data-attributes
//
// Markup contract (all optional; pair with scroll-kit.css):
//   [data-pin]            tall section (height set in CSS, e.g. 250vh) holding a .pin__stage that sticks.
//                         Sets  --p  (0..1 raw scroll progress)  and  --pe  (same, eased) on the element.
//                         Style anything with them:  transform: translateX(calc(var(--pe) * -80vw));
//   [data-rail]           pinned section whose [data-rail-track] slides sideways as you scroll (swipe row on phones).
//   video[data-hero-video] hero clip that PLAYS ONLY AS YOU SCROLL. data-src, data-from, data-to (seconds).
//                         Lives inside a [data-pin]. If it cannot load, html gets .no-scrub and the still shows.
//   [data-reveal]         fades/slides in once (stagger with style="--d:2"). data-reveal="clip": watch the parent instead.
//   [data-split]          headline whose words rise one by one when it comes into view.
//   [data-parallax="0.2"] drifts against the scroll by that fraction (uses the `translate` property).
//   [data-spot]           card with a pointer-following spotlight (colour from --accent); wrap siblings in [data-spot-group]
//                         and the others soften while one is lit.
//   [data-magnetic]       button that leans toward the pointer.
//   [data-nav]            gets .is-scrolled after 40px. <a href="#id"> links inside get aria-current for the section on screen.
//   :root --page          0..1 page progress (use it for a progress line: transform: scaleX(var(--page))).
//
// AMORE-style first page (the signature opening; see references/amore-home-sequence.md and assets/kit/demo-amore.html):
//   [data-hero-reveal]    pinned hero: the full-screen [data-hero-stage] shrinks into a rounded window (scale 1 -> 0.4, radius 12px)
//                         while [data-hero-marquee] (giant type, two rows moving opposite ways) fades in behind it; then the
//                         next section (.hero-over) slides up over the pinned hero. Length = --hero-run screens (1.4; 1 on phones).
//   [data-loop]           seamless endless track (clones its children to fill the screen, then once more for the -50% loop);
//                         data-speed="40" px/s, data-loop="reverse". Paused while off-screen.
//   [data-band="left|right"]  moving headline band: slides sideways while it crosses the screen (needs .band-track > 3 x .band-set).
//   [data-chase]          two side posters ([data-chase-image], is-left / is-right) slide in from beyond the screen edges while the
//                         two [data-chase-content] columns drift into place.
//   [data-fan]            tiles stacked at first, spring open into a fan when it arrives; hover pulls one forward.
//
// AURELLO-style first page (the second signature; see references/aurello-opening.md and assets/kit/demo-aurello.html):
//   .hero-clip[data-pin]  pinned hero (270vh): copy on the left, a scrubbed clip masked into the background on the right,
//                         "scroll to pour" cue fading with --p (all CSS; the clip itself is video[data-hero-video], above).
//   .story-slide[data-pin] two giant headline lines slide across a line-art scene as --p runs (pure CSS from --p).
//   [data-chapters]       pinned colour chapters: .scene children, each later scene wipes up over the previous one
//                         (--wipe), its ring turns (--fr) and its text arrives (.on).
//   [data-dock]           floating-pill nav links that swell with a spring as the pointer nears ([data-dock-item]);
//                         data-proximity="122" data-spring=".19" data-damping=".7"; mouse only, wide screens only.
//   [data-nav-toggle]     hamburger for the pill nav on narrow screens (Escape and link clicks close it).
//
// Reduced motion: motion that is 1:1 with the visitor's own scroll (the scrubbed clip, --p) keeps working, because
// nothing moves unless they scroll. Ambient or decorative motion (easing/damping, parallax, split/reveal animation,
// magnetic buttons, cursor ring) is switched off and content is shown in its final state.

export const reduced = matchMedia('(prefers-reduced-motion: reduce)');
export const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
export const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** 0 when a tall section's top reaches the top of the screen, 1 when its bottom reaches the bottom of the screen. */
export function pinProgress(el) {
  const span = el.offsetHeight - innerHeight;
  return span > 0 ? clamp(-el.getBoundingClientRect().top / span) : 0;
}

/** 0 when an element's top enters the bottom of the screen, 1 when its bottom leaves the top. */
export function passProgress(el) {
  const r = el.getBoundingClientRect();
  return clamp((innerHeight - r.top) / (innerHeight + r.height));
}

/** 0 when the section's top is 90% down the screen, 1 when it has passed just above the top (a section "arriving"). */
export function windowProgress(el) {
  const start = innerHeight * 0.9;
  const end = -innerHeight * 0.0355;
  return clamp((start - el.getBoundingClientRect().top) / (start - end));
}

// jobs that run once per frame while the page scrolls or resizes (initScrollKit owns the frame loop)
const scrubbers = new Set();
let request = () => {};
/** Run `job` now and then once per frame while the page scrolls or resizes. Returns an unsubscribe function. */
export function onScrub(job) { scrubbers.add(job); job(); return () => scrubbers.delete(job); }

/* ───────────────────────────── hero clip driven by scroll ─────────────────────────────
   Why a blob: servers without HTTP Range support (python -m http.server, some hosts) cannot seek a normal <video>,
   so scrubbing snaps to 0. A blob: URL always seeks. Encode the clip scrub-friendly (a keyframe every 12 frames):
   ffmpeg -i in.mp4 -an -c:v libx264 -crf 23 -g 12 -bf 0 -pix_fmt yuv420p -movflags +faststart hero.mp4            */
function heroScrub(video) {
  const root = document.documentElement;
  const conn = navigator.connection || {};
  if (conn.saveData) { root.classList.add('no-scrub'); return null; }
  const from = Number(video.dataset.from) || 0;
  const to = Number(video.dataset.to) || 0;
  const src = video.dataset.src;
  let target = from;
  let shown = from;
  let raf = 0;
  let ready = false;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  const fail = () => { cancelAnimationFrame(raf); root.classList.add('no-scrub'); };
  const step = () => {
    raf = 0;
    const d = target - shown;
    if (Math.abs(d) < 0.005) {
      shown = target;
      if (!video.seeking && Math.abs(video.currentTime - shown) > 0.008) video.currentTime = shown;
      return;
    }
    shown += d * (reduced.matches ? 1 : 0.24);
    if (!video.seeking) video.currentTime = shown; // one seek at a time keeps frames flowing
    raf = requestAnimationFrame(step);
  };
  const seek = (p) => {
    target = lerp(from, to || video.duration || from, p);
    if (ready && !raf) raf = requestAnimationFrame(step);
  };

  const giveUp = setTimeout(fail, 25000);
  video.addEventListener('loadeddata', () => {
    ready = true;
    clearTimeout(giveUp);
    video.classList.add('is-ready');
    shown = target;
    video.currentTime = shown;
    if (matchMedia('(pointer: coarse)').matches) { // iOS only decodes frames after a first play()
      const p = video.play();
      const back = () => { video.pause(); video.currentTime = shown; };
      if (p && p.then) p.then(back).catch(() => {}); else back();
    }
    seek((video.__p ?? 0));
  }, { once: true });
  video.addEventListener('error', () => { clearTimeout(giveUp); fail(); }, { once: true });

  const load = location.protocol === 'file:'
    ? Promise.resolve(src)
    : fetch(src).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); }).then((b) => URL.createObjectURL(b)).catch(() => src);
  load.then((url) => { if (!root.classList.contains('no-scrub')) video.src = url; });
  return seek;
}

/* ───────────────────────────── the init ───────────────────────────── */
export function initScrollKit({ cursor = false } = {}) {
  const root = document.documentElement;
  root.classList.add('js');

  const pins = $$('[data-pin]').map((el) => ({ el, p: 0, pe: 0, video: $('video[data-hero-video]', el), seek: null }));
  for (const pin of pins) if (pin.video) pin.seek = heroScrub(pin.video);

  const rails = $$('[data-rail]').map((el) => ({ el, track: $('[data-rail-track]', el), overflow: 0, on: false }));
  const parallax = $$('[data-parallax]').map((el) => ({ el, k: Number(el.dataset.parallax) || 0.15 }));
  const nav = $('[data-nav]');

  function layout() {
    for (const rail of rails) {
      const min = Number(rail.el.dataset.railMin) || 821;
      rail.on = innerWidth >= min;
      rail.el.classList.toggle('rail--on', rail.on);
      if (!rail.on) { rail.el.style.height = ''; rail.track.style.transform = ''; rail.overflow = 0; continue; }
      rail.overflow = Math.max(0, rail.track.scrollWidth - innerWidth);
      rail.el.style.height = innerHeight + rail.overflow + 'px';
    }
  }

  let queued = false;
  function frame() {
    queued = false;
    let moving = false;
    for (const job of scrubbers) job();

    const maxScroll = document.documentElement.scrollHeight - innerHeight;
    (nav?.querySelector('.batt') || root).style.setProperty('--page', (maxScroll > 0 ? clamp(scrollY / maxScroll) : 0).toFixed(4));
    if (nav) nav.classList.toggle('is-scrolled', scrollY > 40);

    for (const pin of pins) {
      pin.p = pinProgress(pin.el);
      if (reduced.matches) pin.pe = pin.p;
      else {
        const next = pin.pe + (pin.p - pin.pe) * 0.14;
        pin.pe = Math.abs(pin.p - next) < 0.0006 ? pin.p : next;
        if (pin.pe !== pin.p) moving = true;
      }
      pin.el.style.setProperty('--p', pin.p.toFixed(4));
      pin.el.style.setProperty('--pe', pin.pe.toFixed(4));
      pin.el.classList.toggle('is-pinned', pin.p > 0 && pin.p < 1);
      if (pin.video) { pin.video.__p = pin.p; if (pin.seek) pin.seek(pin.p); }
    }
    for (const rail of rails) if (rail.on) rail.track.style.transform = `translate3d(${(-rail.overflow * pinProgress(rail.el)).toFixed(1)}px,0,0)`;
    if (!reduced.matches) for (const { el, k } of parallax) el.style.translate = `0 ${((innerHeight / 2 - (el.getBoundingClientRect().top + el.offsetHeight / 2)) * k).toFixed(1)}px`;

    if (moving) request();
  }
  request = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };

  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', () => { layout(); request(); });
  addEventListener('load', () => { layout(); request(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); request(); });
  layout();
  request();

  initLoops();
  initHeroReveal();
  initBands();
  initChase();
  initFan();
  initChapters();
  initDock();
  initNavToggle();
  initReveal();
  initSplit();
  initSpotlight();
  initMagnetic();
  initNavSpy();
  if (cursor) initCursor();
}

/* ───────────────────────────── details ───────────────────────────── */
export function initReveal() {
  const items = $$('[data-reveal]');
  if (reduced.matches || !('IntersectionObserver' in window)) { items.forEach((e) => e.classList.add('is-in')); return; }
  const watched = new Map(); // a clip-pathed element never reports as visible, so "clip" reveals watch the parent
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { watched.get(entry.target).classList.add('is-in'); io.unobserve(entry.target); }
  }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });
  for (const el of items) {
    const target = el.dataset.reveal === 'clip' ? el.parentElement : el;
    watched.set(target, el);
    io.observe(target);
  }
}

export function initSplit() {
  const heads = $$('[data-split]');
  if (!heads.length || reduced.matches) return;
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('is-in'); io.unobserve(entry.target); }
  }, { threshold: 0.4 });
  for (const head of heads) {
    const text = head.textContent.trim();
    head.setAttribute('aria-label', text);
    head.textContent = '';
    text.split(/\s+/).forEach((word, i, all) => {
      const outer = document.createElement('span');
      outer.className = 'split-word';
      outer.setAttribute('aria-hidden', 'true');
      outer.style.setProperty('--i', String(i));
      const inner = document.createElement('span');
      inner.textContent = word;
      outer.append(inner);
      head.append(outer);
      if (i < all.length - 1) head.append(' ');
    });
    head.classList.add('is-split');
    io.observe(head);
  }
}

export function initSpotlight() {
  if (reduced.matches || !finePointer.matches) return;
  let lit = null;
  let group = null;
  let timer = 0;
  const off = () => { clearTimeout(timer); timer = 0; lit?.classList.remove('is-lit'); group?.classList.remove('is-focusing'); lit = group = null; };
  document.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const card = event.target.closest?.('[data-spot]');
    if (card && card !== lit) {
      off();
      lit = card;
      card.classList.add('is-lit');
      group = card.closest('[data-spot-group]');
      group?.classList.add('is-focusing');
    }
    if (card) {
      clearTimeout(timer); timer = 0;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (event.clientX - r.left).toFixed(1) + 'px');
      card.style.setProperty('--my', (event.clientY - r.top).toFixed(1) + 'px');
    } else if (lit && !timer) timer = setTimeout(off, 240); // the gap between two cards must not flicker the group
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', off);
}

export function initMagnetic() {
  if (reduced.matches || !finePointer.matches) return;
  for (const el of $$('[data-magnetic]')) {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.translate = `${((e.clientX - r.left - r.width / 2) * 0.28).toFixed(1)}px ${((e.clientY - r.top - r.height / 2) * 0.28).toFixed(1)}px`;
    });
    el.addEventListener('pointerleave', () => { el.style.translate = ''; });
  }
}

export function initNavSpy() {
  const links = $$('[data-nav] nav a[href^="#"]').filter((a) => a.getAttribute('href').length > 1);   // only the section links (not the brand link, which would be underlined at the top)
  const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const sections = [...map.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  if (!sections.length || !('IntersectionObserver' in window)) return;
  const live = new Set();   // the sections currently crossing the middle band of the screen
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) (e.isIntersecting ? live.add(e.target.id) : live.delete(e.target.id));
    links.forEach((a) => a.removeAttribute('aria-current'));
    const current = sections.filter((s) => live.has(s.id)).pop();   // none above the first linked section: nothing is highlighted
    if (current) map.get(current.id)?.setAttribute('aria-current', 'true');
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => io.observe(s));
}

export function initCursor() {
  if (reduced.matches || !finePointer.matches) return;
  const ring = document.createElement('div');
  ring.className = 'cursor-ring';
  ring.setAttribute('aria-hidden', 'true');
  document.body.append(ring);
  let x = -100, y = -100, tx = -100, ty = -100, frame = 0, seen = false;
  const tick = () => {
    x += (tx - x) * 0.22; y += (ty - y) * 0.22;
    ring.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    frame = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 ? requestAnimationFrame(tick) : 0;
  };
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    tx = e.clientX; ty = e.clientY;
    if (!seen) { seen = true; x = tx; y = ty; }
    ring.classList.add('is-on');
    ring.classList.toggle('is-link', !!e.target.closest?.('a, button, input, select, [role="button"]'));
    if (!frame) frame = requestAnimationFrame(tick);
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => ring.classList.remove('is-on'));
}

/* ───────────────────────────── AURELLO-style first page ───────────────────────────── */

/** Colour chapters: one pinned stage, N full-screen `.scene` children. Scene k (k >= 1) wipes up over the previous one
 *  (`--wipe` 100% -> 0, eased, over 0.2 of the pin) centred on progress 0.72/(N-1)*k; each scene's ring turns with `--fr`
 *  (progress x 70deg) and gets `.on` (its text arrives) from just before its wipe finishes until the next one takes over.
 *  Numbers are Aurello's three chapters (wipes at 0.26 and 0.62), generalised to any N >= 2. */
export function initChapters() {
  for (const root of $$('[data-chapters]')) {
    const scenes = $$('.scene', root);
    const n = scenes.length;
    if (n < 2) continue;
    const mid = (k) => (0.72 / (n - 1)) * k;
    onScrub(() => {
      const cp = pinProgress(root);
      scenes.forEach((scene, k) => {
        const start = k ? mid(k) - 0.1 : 0;
        if (k) scene.style.setProperty('--wipe', ((1 - ease(clamp((cp - start) / 0.2))) * 100).toFixed(2) + '%');
        scene.style.setProperty('--fr', ((cp - start) * 70).toFixed(1) + 'deg');
        const from = k ? mid(k) - 0.02 : 0.03;
        const to = k === n - 1 ? 2 : mid(k + 1) - 0.02;
        scene.classList.toggle('on', cp > from && cp < to);
      });
    });
  }
}

/** Dock: links swell as the pointer approaches, each on its own spring (original implementation of a proximity dock).
 *  target = smoothstep(1 - distance/proximity); velocity += (target - value) * spring; velocity *= damping.
 *  Only transforms change (scale + a small lift), so the bar never changes size. Off for touch, reduced motion and narrow screens. */
export function initDock() {
  for (const dock of $$('[data-dock]')) {
    const items = $$('[data-dock-item]', dock).map((el) => ({ el, v: 0, vel: 0, target: 0 }));
    if (!items.length) continue;
    const proximity = Number(dock.dataset.proximity) || 122;
    const spring = Number(dock.dataset.spring) || 0.19;
    const damping = Number(dock.dataset.damping) || 0.7;
    const grow = Number(dock.dataset.grow) || 0.14;
    const lift = Number(dock.dataset.lift) || 2;
    const on = () => !reduced.matches && finePointer.matches && innerWidth > 980;
    let raf = 0;
    const tick = () => {
      raf = 0;
      let moving = false;
      for (const it of items) {
        it.vel = (it.vel + (it.target - it.v) * spring) * damping;
        it.v += it.vel;
        const settled = Math.abs(it.vel) < 0.0008 && Math.abs(it.target - it.v) < 0.0008;
        if (settled) { it.v = it.target; it.vel = 0; } else moving = true;
        it.el.style.transform = it.v ? `translate3d(0,${(-lift * it.v).toFixed(2)}px,0) scale(${(1 + grow * it.v).toFixed(4)})` : '';
        it.el.dataset.dockNear = it.v > 0.08 ? 'true' : 'false';
      }
      if (moving) raf = requestAnimationFrame(tick);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    dock.addEventListener('pointermove', (e) => {
      if (!on() || e.pointerType !== 'mouse') return;
      for (const it of items) {
        const r = it.el.getBoundingClientRect();
        const x = clamp(1 - Math.abs(e.clientX - (r.left + r.width / 2)) / proximity);
        it.target = x * x * (3 - 2 * x);
      }
      kick();
    });
    dock.addEventListener('pointerleave', () => { items.forEach((it) => { it.target = 0; }); kick(); });
    dock.addEventListener('focusin', (e) => { // keyboard: the focused link swells, its neighbours a little
      if (!on()) return;
      const i = items.findIndex((it) => it.el === e.target.closest('[data-dock-item]'));
      if (i < 0) return;
      items.forEach((it, k) => { it.target = k === i ? 1 : Math.abs(k - i) === 1 ? 0.24 : 0; });
      kick();
    });
    dock.addEventListener('focusout', () => { items.forEach((it) => { it.target = 0; }); kick(); });
  }
}

/** Hamburger for the pill nav on narrow screens: toggles `.open` on [data-nav]; Escape and link clicks close it. */
export function initNavToggle() {
  const nav = $('[data-nav]');
  const toggle = nav && $('[data-nav-toggle]', nav);
  if (!toggle) return;
  const set = (open) => { nav.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open)); };
  toggle.addEventListener('click', () => set(!nav.classList.contains('open')));
  $$('a', nav).forEach((a) => a.addEventListener('click', () => set(false)));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { set(false); toggle.focus(); } });
}

/* ───────────────────────────── AMORE-style first page ───────────────────────────── */

/** Endless tracks: clone the children until they fill the screen, then once more so translateX(-50%) loops with no seam.
 *  Give the items `margin-right` (not flex `gap`) so both halves are exactly equal. Speed is px/s, so it feels the same on every screen. */
export function initLoops() {
  const tracks = $$('[data-loop]');
  if (!tracks.length) return;
  const copy = (node, decorative) => {
    const k = node.cloneNode(true);
    if (decorative) { k.setAttribute('aria-hidden', 'true'); k.removeAttribute('id'); }
    return k;
  };
  const build = (el) => {
    if (!el.__orig) el.__orig = [...el.children];
    el.replaceChildren(...el.__orig.map((c) => copy(c, false)));
    for (let guard = 0; el.scrollWidth < innerWidth * 1.05 && guard < 12; guard++) el.append(...el.__orig.map((c) => copy(c, true)));
    el.append(...[...el.children].map((c) => copy(c, true)));
    el.style.setProperty('--loop-dur', (el.scrollWidth / 2 / (Number(el.dataset.speed) || 40)).toFixed(1) + 's');
  };
  const run = () => tracks.forEach(build);
  run();
  addEventListener('load', run);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(run);
  let timer = 0;
  let width = innerWidth;
  addEventListener('resize', () => { if (innerWidth === width) return; width = innerWidth; clearTimeout(timer); timer = setTimeout(run, 200); });
  if ('IntersectionObserver' in window) { // no need to animate what nobody sees
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.target.classList.toggle('is-off', !e.isIntersecting)));
    tracks.forEach((el) => io.observe(el));
  }
}

/** The pinned hero reveal. p runs 0 -> 1 over `--hero-run` screens (1.4 desktop, 1 phones; set in CSS):
 *  stage scale = 1 - shrink*p (0.60 | 0.45 phone) · radius = 12px*p (8 phone) · marquee opacity = 0 until p=.12, 1 at p=.40.
 *  Scroll-linked 1:1, so it stays on under reduced motion (only the CSS drift animations stop). */
export function initHeroReveal() {
  const section = $('[data-hero-reveal]');
  if (!section) return;
  const pin = $('[data-hero-pin]', section) || section.firstElementChild;
  const stage = $('[data-hero-stage]', section);
  const marquee = $('[data-hero-marquee]', section);
  const small = matchMedia('(max-width: 768px)');
  let run = 1.4;
  const readRun = () => { run = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hero-run')) || 1.4; };
  readRun();
  addEventListener('resize', readRun);
  onScrub(() => {
    const p = clamp(-section.getBoundingClientRect().top / (run * pin.offsetHeight));
    const shrink = Number(section.dataset.shrink) || (small.matches ? 0.45 : 0.6);
    const radius = Number(section.dataset.radius) || (small.matches ? 8 : 12);
    stage.style.transform = `translate3d(0,0,0) scale(${(1 - shrink * p).toFixed(4)})`;
    stage.style.borderRadius = `${(radius * p).toFixed(2)}px`;
    if (marquee) marquee.style.opacity = clamp((p - 0.12) / 0.28).toFixed(3);
    section.style.setProperty('--hero-p', p.toFixed(4));
  });
}

/** Moving headline bands: each slides sideways while it crosses the screen. data-band="left" travels 0 -> -travel, "right" -travel -> 0;
 *  travel = one set of the text (a third of the track, so keep 3 identical .band-set), at most 1.1 screens. */
export function initBands() {
  for (const band of $$('[data-band]')) {
    const track = $('.band-track', band);
    if (!track) continue;
    const toward = band.dataset.band === 'right' ? 1 : -1;
    onScrub(() => {
      if (reduced.matches) return;
      const travel = Math.min(track.offsetWidth / 3, innerWidth * 1.1);
      const rect = band.getBoundingClientRect();
      const t = clamp((innerHeight - rect.top) / (innerHeight + rect.height));
      track.style.transform = `translate3d(${(toward < 0 ? -t * travel : -(1 - t) * travel).toFixed(1)}px,0,0)`;
    });
  }
}

/** Side posters chase in: they start 80% beyond their edge and slide to rest as the section arrives; the two text columns drift
 *  inward by 2.95% of the screen width. remaining = 1 - windowProgress. */
export function initChase() {
  const section = $('[data-chase]');
  if (!section) return;
  const left = $('.is-left [data-chase-image]', section);
  const right = $('.is-right [data-chase-image]', section);
  const [textL, textR] = $$('[data-chase-content]', section);
  onScrub(() => {
    if (reduced.matches) return;
    const remaining = 1 - windowProgress(section);
    const drift = 0.0295 * innerWidth * remaining;
    if (left) left.style.transform = `translate3d(${-80 * remaining}%,0,0)`;
    if (right) right.style.transform = `translate3d(${80 * remaining}%,0,0)`;
    if (textL) textL.style.transform = `translate3d(${-drift}px,0,0)`;
    if (textR) textR.style.transform = `translate3d(${drift}px,0,0)`;
  });
}

// fan pose by distance d from the middle tile (anchors measured on the reference fan; interpolated, extended past the last)
const FAN = { tx: [0, 116, 231, 315, 399], ty: [0, 14, 42, 77, 112], rot: [0, 7, 14, 21, 28], sc: [1, 0.9346, 0.8498, 0.7756, 0.7014] };
const along = (list, a) => { const i = Math.min(Math.floor(a), list.length - 2); return list[i] + (list[i + 1] - list[i]) * (a - i); };
/** { tx, ty, rot, sc } for a tile `d` steps from the middle (negative = left of it). Pure maths, easy to unit-test. */
export function fanPose(d) {
  const a = Math.abs(d);
  const s = Math.sign(d);
  return { tx: s * along(FAN.tx, a), ty: along(FAN.ty, a), rot: s * along(FAN.rot, a), sc: along(FAN.sc, a) };
}

/** A fan of tiles: stacked at first, springs open (CSS transition does the spring) when it first arrives; hovering one pulls it
 *  forward and nudges the others aside. Narrower on tablets/phones. Tiles read --tx --ty --rot --sc --z (see scroll-kit.css). */
export function initFan() {
  const fan = $('[data-fan]');
  if (!fan) return;
  const tiles = $$('.fan-tile', fan);
  const middle = (tiles.length - 1) / 2;
  let open = false;
  let hover = -1;
  const apply = () => {
    const k = innerWidth <= 768 ? 0.4 : innerWidth <= 991 ? 0.7 : 1;
    tiles.forEach((tile, i) => {
      const pose = fanPose(i - middle);
      let tx = open ? pose.tx * k : 0;
      let ty = open ? pose.ty * k : 0;
      let sc = open ? pose.sc : 1;
      if (open && hover >= 0) {
        const d = i - hover;
        if (d === 0) { ty = Math.max(0, ty - 32 * k); sc = Math.min(1, sc + 0.14); }
        else tx += Math.sign(d) * 70 * k * Math.max(0, 1.1 - (Math.abs(d) - 1) * 0.25);
      }
      tile.style.setProperty('--tx', tx.toFixed(1) + 'px');
      tile.style.setProperty('--ty', ty.toFixed(1) + 'px');
      tile.style.setProperty('--rot', (open ? pose.rot : 0) + 'deg');
      tile.style.setProperty('--sc', sc.toFixed(4));
      tile.style.setProperty('--z', String(Math.round(20 - Math.abs(i - middle) * 2)));
      tile.classList.toggle('is-front', i === (hover >= 0 ? hover : Math.floor(middle)));
    });
  };
  const watch = $('[data-fan-section]') || fan;
  if ('IntersectionObserver' in window && !reduced.matches) {
    new IntersectionObserver((entries, io) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      open = true; apply(); io.disconnect();
    }, { threshold: 0.35 }).observe(watch);
  } else open = true;
  tiles.forEach((tile, i) => tile.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hover = i; apply(); } }));
  fan.addEventListener('pointerleave', () => { hover = -1; apply(); });
  addEventListener('resize', apply);
  apply();
}
