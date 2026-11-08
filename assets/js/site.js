// Site behaviour on top of scroll-kit: nav menu, battery meter, power ladder, calculator, forms, filters, logo intro.
import { initScrollKit, onScrub, pinProgress, reduced, clamp, $, $$ } from './scroll-kit.js';
import { SITE } from './config.js';
import { initFx, makeFlap, setOdometer, makePayback, whenVisible } from './fx.js';

initScrollKit();
initFx();

/* Logo intro: under a second, once per visit */
const intro = $('.intro');
if (intro && document.documentElement.classList.contains('show-intro')) {
  try { sessionStorage.setItem('reach-intro', '1'); } catch (e) { /* private mode */ }
  setTimeout(() => intro.classList.add('out'), 640);
  setTimeout(() => { document.documentElement.classList.remove('show-intro'); }, 930);
}

/* Battery meter */
const pct = $('.batt__pct');
if (pct) onScrub(() => { const max = document.documentElement.scrollHeight - innerHeight; const v = Math.round((max > 0 ? clamp(scrollY / max) : 0) * 100) + '%'; if (pct.textContent !== v) pct.textContent = v; });

/* Products menu: hover for mouse, click for everyone, Escape closes */
const menu = $('.has-menu');
if (menu) {
  const btn = $('button', menu);
  const set = (o) => { menu.classList.toggle('open', o); btn.setAttribute('aria-expanded', String(o)); };
  btn.addEventListener('click', () => set(!menu.classList.contains('open')));
  const hover = matchMedia('(hover: hover) and (min-width: 1081px)');
  menu.addEventListener('pointerenter', () => { if (hover.matches) set(true); });
  menu.addEventListener('pointerleave', () => { if (hover.matches) set(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.classList.contains('open')) { set(false); btn.focus(); } });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) set(false); });
}

/* Power ladder: one pinned stage, each rung takes over as the scale climbs */
const ladder = $('[data-ladder]');
if (ladder) {
  const rungs = $$('.rung', ladder), arts = $$('.rung-art', ladder), ticks = $$('.scale__tick', ladder);
  const ys = rungs.map((r) => Number(r.dataset.y));
  const n = rungs.length;
  const board = makeFlap($('[data-flap]', ladder));
  const dither = $('canvas[data-dither]', ladder);
  let cur = -1;
  whenVisible(ladder, () => {
    const p = pinProgress(ladder);
    const f = clamp(p * n, 0, n - 0.0001);
    const i = Math.floor(f);
    const a = ys[i], b = ys[Math.min(i + 1, n - 1)];
    const local = clamp((f - i - 0.62) / 0.38);
    ladder.style.setProperty('--y', (a + (b - a) * local).toFixed(4));
    ladder.style.setProperty('--lp', p.toFixed(3));
    if (dither) dither.energy = a + (b - a) * local;
    if (i !== cur) {
      cur = i;
      board.set(rungs[i].dataset.kw, rungs[i].dataset.unit);
      rungs.forEach((r, k) => { r.classList.toggle('on', k === i); r.setAttribute('aria-hidden', String(k !== i)); });
      arts.forEach((r, k) => { r.classList.toggle('on', k === i); r.classList.toggle('past', k < i); });
      ticks.forEach((t, k) => t.classList.toggle('on', k <= i));
    }
  });
}

/* Earnings calculator. Every number comes from what the visitor enters. */
const calc = $('[data-calc]');
if (calc) {
  const num = (id) => Number($('#' + id, calc).value);
  const inr = (v) => '₹' + Math.round(v).toLocaleString('en-IN');
  const out = (k, v) => { $(`[data-out="${k}"]`, calc).textContent = v; };
  const odo = $('[data-odo]', calc);
  const payback = makePayback($('[data-payback]', calc));
  const run = () => {
    const opt = $('#c-model', calc).selectedOptions[0];
    const kw = Number(opt.dataset.kw), price = Number(opt.dataset.price);
    const qty = num('c-qty'), sessions = num('c-sessions'), kwh = num('c-kwh'), tariff = num('c-tariff'), cost = num('c-cost');
    $$('input[type=range]', calc).forEach((r) => { const o = calc.querySelector(`output[for="${r.id}"]`); if (o) o.textContent = r.dataset.prefix ? r.dataset.prefix + r.value : r.value; r.style.setProperty('--f', ((r.value - r.min) / (r.max - r.min) * 100).toFixed(1) + '%'); });
    const daily = sessions * kwh;
    const capacity = kw * 24;
    const energy = daily * qty * 30;
    const revenue = energy * tariff;
    const margin = energy * (tariff - cost);
    const hardware = price * qty;
    const months = margin > 0 ? hardware / margin : Infinity;
    out('margin', inr(margin));
    setOdometer(odo, inr(margin));
    payback(margin, hardware);
    out('revenue', inr(revenue));
    out('energy', Math.round(energy).toLocaleString('en-IN') + ' kWh');
    out('hardware', inr(hardware));
    out('payback', Number.isFinite(months) ? (months < 1 ? 'under 1 month' : months.toFixed(1) + ' months') : 'no margin at these rates');
    out('use', Math.round((daily / capacity) * 100) + '%');
    $('[data-warn]', calc).hidden = daily <= capacity;
  };
  calc.addEventListener('input', run);
  run();
}

/* Product filter */
const filter = $('[data-filter]');
if (filter) {
  const cards = $$('[data-cat]');
  $$('button', filter).forEach((b) => b.addEventListener('click', () => {
    $$('button', filter).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const c = b.dataset.value;
    cards.forEach((card) => { card.hidden = c !== 'all' && card.dataset.cat !== c; });
  }));
}

/* Forms: validated here; delivered to an endpoint if one is set, otherwise a pre-filled email or WhatsApp to REACH */
for (const form of $$('form[data-enquiry]')) {
  const params = new URLSearchParams(location.search);
  const product = params.get('product');
  const prod = $('[name="product"]', form);
  if (product && prod) prod.value = product;
  const showErr = (f, msg) => {
    const wrap = f.closest('.field'); const e = $('.err', wrap);
    wrap.classList.toggle('bad', !!msg); f.setAttribute('aria-invalid', String(!!msg)); e.textContent = msg || '';
  };
  const check = (f) => {
    const label = $('label', f.closest('.field')).childNodes[0].textContent.trim();
    if (f.validity.valueMissing) return `Please enter your ${label.toLowerCase()}.`;
    if (f.type === 'email' && f.validity.typeMismatch) return 'Please enter an email like name@company.com.';
    if (f.type === 'tel' && f.validity.patternMismatch) return 'Please enter a 10-digit mobile number.';
    if (f.validity.patternMismatch) return `Please check your ${label.toLowerCase()}.`;
    return '';
  };
  $$('input, select, textarea', form).forEach((f) => f.addEventListener('blur', () => showErr(f, check(f))));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const via = ev.submitter?.dataset.send || 'email';
    let bad = null;
    $$('input, select, textarea', form).forEach((f) => { const m = check(f); showErr(f, m); if (m && !bad) bad = f; });
    if (bad) { bad.focus(); return; }
    const data = [...new FormData(form).entries()].filter(([, v]) => v);
    const subject = form.dataset.subject;
    const lines = data.map(([k, v]) => `${k[0].toUpperCase() + k.slice(1)}: ${v}`).join('\n');
    const done = $('.form__done', form);
    done.hidden = false;
    if (SITE.preview) { done.textContent = 'Preview only, so nothing was sent. On the live site this goes straight to the REACH team.'; return; }
    if (SITE.formEndpoint) {
      done.textContent = 'Sending...';
      try {
        const r = await fetch(SITE.formEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject, ...Object.fromEntries(data) }) });
        if (!r.ok) throw new Error(r.status);
        done.textContent = 'Thank you. The REACH team will get back to you shortly.';
        form.reset();
      } catch (e) { done.textContent = `That did not go through. Please call ${SITE.phone} or email ${SITE.email}.`; }
      return;
    }
    if (via === 'whatsapp') {
      window.open(`https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(subject + '\n' + lines)}`, '_blank', 'noopener');
      done.textContent = 'WhatsApp has opened with your details. Press send to reach the team.';
    } else {
      location.href = `mailto:${SITE.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines)}`;
      done.textContent = 'Your email app has opened with your details. Press send to reach the team.';
    }
  });
}

if (reduced.matches) document.documentElement.classList.add('reduced');
