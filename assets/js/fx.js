// REACH signature components. Original vanilla code, no dependencies beyond scroll-kit.
import { onScrub, pinProgress, reduced, finePointer, clamp, smoothstep, $, $$ } from './scroll-kit.js';

const inView = (el, cb, margin = '10% 0px') => {
  if (!('IntersectionObserver' in window)) { cb(true); return; }
  new IntersectionObserver((e) => cb(e[0].isIntersecting), { rootMargin: margin }).observe(el);
};
/** Like onScrub, but the job only runs while `el` is near the screen. */
export function whenVisible(el, job, margin = '25% 0px') {
  let on = false;
  inView(el, (v) => { on = v; if (v) job(); }, margin);
  onScrub(() => { if (on) job(); });
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255);

/* Dithered energy field: ordered-dither WebGL, rendered at low resolution so the dots stay crisp. canvas.energy = 0..1 */
const DITHER_FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uR; uniform float uT,uE; uniform vec3 c0,c1,c2,c3;
float b2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);}
float b4(vec2 a){return b2(.5*a)*.25+b2(a);}
float b8(vec2 a){return b4(.5*a)*.25+b2(a);}
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fb(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p=p*2.02+11.3;a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/uR; vec2 p=vec2(uv.x*uR.x/uR.y,uv.y)*1.7;
  float w=fb(p+vec2(uT*.035,-uT*.02));
  float v=fb(p*1.1+1.6*w+vec2(-uT*.025,uT*.03));
  v=smoothstep(.24,.76,v)*.56+.08+uE*.34-uv.y*.1;
  v=clamp(v,0.,.999)*3.;
  float k=floor(v)+step(b8(gl_FragCoord.xy)+.001,fract(v));
  vec3 c=k<.5?c0:k<1.5?c1:k<2.5?c2:c3;
  gl_FragColor=vec4(c,1.);
}`;
function initDither() {
  for (const c of $$('canvas[data-dither]')) {
    const gl = c.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) { c.remove(); continue; }
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, DITHER_FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { c.remove(); continue; }
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.bindAttribLocation(pr, 0, 'a'); gl.vertexAttribPointer(gl.getAttribLocation(pr, 'a'), 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(gl.getAttribLocation(pr, 'a'));
    const U = (n) => gl.getUniformLocation(pr, n);
    (c.dataset.colors || '#07263C,#0A3E5E,#0F6895,#128A93').split(',').forEach((col, i) => gl.uniform3fv(U('c' + i), hex(col)));
    const uR = U('uR'), uT = U('uT'), uE = U('uE');
    const px = Number(c.dataset.px) || 3;
    let raf = 0, last = 0, vis = false, shown = 0; c.energy = c.energy || 0;
    const seed = Math.random() * 40;
    const draw = (t) => {
      shown += (c.energy - shown) * 0.08;
      gl.uniform1f(uT, seed + t / 1000); gl.uniform1f(uE, shown);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const size = () => {
      const w = Math.max(2, Math.ceil(c.clientWidth / px)), h = Math.max(2, Math.ceil(c.clientHeight / px));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; gl.viewport(0, 0, w, h); gl.uniform2f(uR, w, h); }
      draw(performance.now());
    };
    const loop = (t) => {
      raf = 0;
      if (!vis || document.hidden) return;
      if (t - last > 55) { last = t; draw(t); }
      raf = requestAnimationFrame(loop);
    };
    const kick = () => { if (!raf && vis && !reduced.matches && !document.hidden) raf = requestAnimationFrame(loop); };
    new ResizeObserver(size).observe(c);
    size();
    inView(c, (v) => { vis = v; if (v) { size(); kick(); } });
    document.addEventListener('visibilitychange', kick);
  }
}

/* Split-flap board, like a station departures display */
const FLAP_SEQ = ' .0123456789';
function flapCell(host) {
  const el = document.createElement('span');
  el.className = 'fc';
  el.innerHTML = '<b class="fc__t"><i></i></b><b class="fc__b"><i></i></b><b class="fc__ft"><i></i></b><b class="fc__fb"><i></i></b>';
  host.append(el);
  const [t, b, ft, fb] = $$('i', el);
  let cur = ' ', target = ' ', busy = false;
  const paint = (c) => { t.textContent = c; b.textContent = c; ft.textContent = c; fb.textContent = c; };
  const step = async () => {
    busy = true;
    while (cur !== target) {
      const idx = FLAP_SEQ.indexOf(cur);
      const left = (FLAP_SEQ.indexOf(target) - idx + FLAP_SEQ.length) % FLAP_SEQ.length;
      const next = left > 3 ? FLAP_SEQ[(FLAP_SEQ.indexOf(target) - 3 + FLAP_SEQ.length) % FLAP_SEQ.length] : FLAP_SEQ[(idx + 1) % FLAP_SEQ.length];
      t.textContent = next; ft.textContent = cur; fb.textContent = next; b.textContent = cur;
      el.classList.add('is-flip');
      await ft.parentElement.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }], { duration: 62, easing: 'ease-in', fill: 'forwards' }).finished;
      await fb.parentElement.animate([{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }], { duration: 62, easing: 'ease-out', fill: 'forwards' }).finished;
      b.textContent = next; cur = next;
      el.classList.remove('is-flip');
    }
    paint(cur);
    busy = false;
  };
  return {
    set(c, instant) {
      target = c;
      if (instant) { cur = c; paint(c); return; }
      if (!busy) step();
    },
  };
}
export function makeFlap(root, cells = 3) {
  const host = $('.flap__cells', root), unit = $('.flap__unit', root);
  const list = Array.from({ length: cells }, () => flapCell(host));
  return {
    set(value, u) {
      const s = String(value).padStart(cells, ' ').slice(-cells);
      list.forEach((c, i) => { if (reduced.matches) c.set(s[i], true); else setTimeout(() => c.set(s[i]), i * 45); });
      if (unit) unit.textContent = u;
    },
  };
}

/* Words carried along a charging cable, moved only by scrolling */
function initCable() {
  const svg = $('[data-cable]');
  if (!svg) return;
  const tp = $('textPath', svg), core = $('.cable__core', svg), probe = $('.cable__probe', svg);
  let L = 0;
  const measure = () => { L = probe.getComputedTextLength(); };
  measure();
  if (document.fonts?.ready) document.fonts.ready.then(measure);
  whenVisible(svg, () => {
    const y = scrollY;
    tp.setAttribute('startOffset', L ? (((y * 0.72) % L) - L).toFixed(1) : '0');
    core.style.strokeDashoffset = (-y * 1.5).toFixed(0);
  });
}

/* Curved wall of six sites: the visitor stands at the centre of a cylinder */
function initArc() {
  const root = $('[data-arc]');
  if (!root) return;
  const cards = $$('.site', root), ring = $('.arc__ring', root), scene = $('.arc__scene', root), num = $('[data-arc-n]', root), bar = $('.arc__bar u', root);
  const n = cards.length;
  for (const c of cards) for (const s of $$('svg path, svg rect, svg circle', c)) s.setAttribute('pathLength', '1');
  let R = 1200, step = 0.36;
  const layout = () => {
    const w = cards[0].offsetWidth;
    R = Math.max(innerWidth < 760 ? 620 : 800, innerWidth * (innerWidth < 760 ? 1.6 : 0.58));
    step = (w + (innerWidth < 760 ? 18 : 30)) / R;
    scene.style.perspective = R + 'px';
    ring.style.transform = `translateZ(${R}px)`;
  };
  layout();
  addEventListener('resize', layout);
  if (document.fonts?.ready) document.fonts.ready.then(layout);
  let cur = -1;
  whenVisible(root, () => {
    const pos = pinProgress(root) * (n - 1);
    cards.forEach((c, i) => {
      const d = i - pos, a = -d * step;
      if (Math.abs(a) > 1.2) { c.style.visibility = 'hidden'; return; }
      c.style.visibility = 'visible';
      c.style.transform = `translate(-50%,-50%) rotateY(${a.toFixed(4)}rad) translateZ(${-R}px)`;
      c.style.setProperty('--draw', (1 - smoothstep(1.1, 2.1, Math.abs(d))).toFixed(3));
    });
    const k = Math.round(pos);
    if (k !== cur) {
      cur = k;
      cards.forEach((c, i) => c.classList.toggle('is-focus', i === k));
      if (num) num.textContent = String(k + 1).padStart(2, '0');
    }
    if (bar) bar.style.transform = `scaleX(${((pos + 1) / n).toFixed(3)})`;
  });
  cards.forEach((c, i) => c.addEventListener('focusin', () => {
    const span = root.offsetHeight - innerHeight;
    scrollTo({ top: root.offsetTop + span * (i / (n - 1)), behavior: 'auto' });
  }));
}

/* Rolling digits for a meter reading */
export function setOdometer(el, str) {
  const shape = str.replace(/\d/g, '0');
  if (el.dataset.shape !== shape) {
    el.dataset.shape = shape;
    let i = 0;
    el.innerHTML = [...str].map((c) => (/\d/.test(c)
      ? `<span class="od" style="--i:${i++}"><span class="od__s">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<b>${d}</b>`).join('')}</span></span>`
      : `<span class="od__x">${c}</span>`)).join('');
    el.offsetWidth; // the new columns start at 0, then roll
  }
  const cols = $$('.od__s', el);
  const digits = str.replace(/\D/g, '');
  cols.forEach((s, i) => { s.style.transform = `translateY(${-Number(digits[i]) * 10}%)`; });
}

/* Cumulative payback chart: one series, one axis, a reference line for the hardware cost */
export function makePayback(root) {
  const cols = $('.pb__cols', root), line = $('.pb__line', root), lineLabel = $('span', line), tip = $('.pb__tip', root), table = $('[data-pb-table]', root), note = $('.pb__note', root);
  const N = 24;
  cols.innerHTML = Array.from({ length: N }, (_, i) => `<div class="pb__col" style="--i:${i}"><i></i></div>`).join('');
  const bars = $$('.pb__col', cols);
  const inr = (v) => '₹' + Math.round(v).toLocaleString('en-IN');
  let vals = [];
  const update = (margin, hardware) => {
    vals = Array.from({ length: N }, (_, i) => Math.max(0, margin) * (i + 1));
    const top = Math.max(hardware, vals[N - 1]) * 1.08 || 1;
    const month = margin > 0 ? Math.ceil(hardware / margin) : 0;
    bars.forEach((b, i) => {
      b.style.setProperty('--h', (vals[i] / top).toFixed(4));
      b.classList.toggle('is-paid', month > 0 && i + 1 >= month);
      b.classList.toggle('is-month', month === i + 1);
    });
    line.style.bottom = (hardware / top * 100).toFixed(2) + '%';
    lineLabel.textContent = 'Listed hardware ' + inr(hardware);
    note.textContent = month > 0 && month <= N ? `Pays back in month ${month}` : month > N ? `Pays back after month ${N}, around month ${month}` : 'No margin at these rates';
    table.innerHTML = [6, 12, 18, 24].map((m) => `<tr><th scope="row">Month ${m}</th><td>${inr(vals[m - 1])}</td></tr>`).join('');
  };
  const hover = (e) => {
    const r = cols.getBoundingClientRect();
    const i = clamp(Math.floor((e.clientX - r.left) / r.width * N), 0, N - 1);
    tip.hidden = false;
    tip.textContent = `Month ${i + 1}: ${inr(vals[i])}`;
    tip.style.left = clamp(((i + 0.5) / N) * 100, 16, 84) + '%';
    bars.forEach((b, k) => b.classList.toggle('is-hover', k === i));
  };
  cols.addEventListener('pointermove', hover);
  cols.addEventListener('pointerdown', hover);
  cols.addEventListener('pointerleave', () => { tip.hidden = true; bars.forEach((b) => b.classList.remove('is-hover')); });
  return update;
}

/* Magnetic field lines: at rest they point at the action; a pointer pulls them away */
function initField() {
  for (const c of $$('canvas[data-field]')) {
    const sec = c.parentElement, target = $('[data-field-target]', sec), ctx = c.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    let W = 0, H = 0, tx = 0, ty = 0, gx = 0, gy = 0, raf = 0, pts = [];
    const home = () => {
      const a = sec.getBoundingClientRect(), b = target.getBoundingClientRect();
      gx = b.left + b.width / 2 - a.left; gy = b.top + b.height / 2 - a.top;
    };
    const size = () => {
      W = sec.clientWidth; H = sec.clientHeight;
      c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = W < 760 ? 30 : 26;
      pts = [];
      for (let y = g / 2; y < H; y += g) for (let x = g / 2; x < W; x += g) pts.push(x, y);
      home(); tx = gx; ty = gy; draw();
    };
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round'; ctx.lineWidth = 1.5;
      const reach = Math.max(W, H) * 0.42;
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i], y = pts[i + 1], dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy) || 1;
        const near = clamp(1 - d / reach), len = 5 + near * near * 13, ux = dx / d * len / 2, uy = dy / d * len / 2;
        ctx.strokeStyle = `rgba(255,255,255,${(0.16 + near * 0.62).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(x - ux, y - uy); ctx.lineTo(x + ux, y + uy); ctx.stroke();
      }
    };
    const tick = () => {
      raf = 0;
      tx += (gx - tx) * 0.12; ty += (gy - ty) * 0.12;
      draw();
      if (Math.hypot(gx - tx, gy - ty) > 0.4) raf = requestAnimationFrame(tick);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    size();
    addEventListener('resize', size);
    if (document.fonts?.ready) document.fonts.ready.then(size);
    if (reduced.matches) continue;
    sec.addEventListener('pointermove', (e) => { const a = sec.getBoundingClientRect(); gx = e.clientX - a.left; gy = e.clientY - a.top; kick(); });
    sec.addEventListener('pointerleave', () => { home(); kick(); });
  }
}

/* Circuit map: every partner trace runs to the REACH chip */
function initBeam() {
  const root = $('[data-beam]');
  if (!root) return;
  const svg = $('svg', root), chip = $('.beam__chip', root), tiles = $$('.beam__tile', root);
  const NS = 'http://www.w3.org/2000/svg';
  const chamfer = (pts, c = 9) => {
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
      const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by), r = Math.min(c, l1 / 2, l2 / 2);
      d += `L${bx - (bx - ax) / (l1 || 1) * r} ${by - (by - ay) / (l1 || 1) * r}L${bx + (cx - bx) / (l2 || 1) * r} ${by + (cy - by) / (l2 || 1) * r}`;
    }
    const e = pts[pts.length - 1];
    return d + `L${e[0]} ${e[1]}`;
  };
  const traces = [];
  const build = () => {
    svg.innerHTML = ''; traces.length = 0;
    const a = root.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${a.width} ${a.height}`);
    const c = chip.getBoundingClientRect();
    const box = (r) => ({ l: r.left - a.left, r: r.right - a.left, t: r.top - a.top, b: r.bottom - a.top, m: (r.top + r.bottom) / 2 - a.top });
    const C = box(c);
    const stacked = c.width > a.width * 0.6;
    const left = tiles.filter((t) => t.getBoundingClientRect().right <= c.left + 1);
    const right = tiles.filter((t) => t.getBoundingClientRect().left >= c.right - 1);
    tiles.forEach((t, i) => {
      const B = box(t.getBoundingClientRect());
      let pts;
      if (stacked) {
        const mid = (C.l + C.r) / 2, onLeft = (B.l + B.r) / 2 < mid;
        pts = [[onLeft ? B.r : B.l, B.m], [mid, B.m], [mid, C.b]];
      } else {
        const side = left.includes(t) ? -1 : 1, group = side < 0 ? left : right, k = group.indexOf(t), count = group.length;
        const edge = side < 0 ? C.l : C.r, start = side < 0 ? B.r : B.l, gapMid = (start + edge) / 2;
        const off = (k - (count - 1) / 2) * 11, bus = gapMid + off * side * (B.m < C.m ? 1 : -1);
        const py = C.t + ((k + 1) / (count + 1)) * (C.b - C.t);
        pts = [[start, B.m], [bus, B.m], [bus, py], [edge, py]];
      }
      const d = chamfer(pts);
      const base = document.createElementNS(NS, 'path'); base.setAttribute('d', d); base.setAttribute('class', 'beam__t');
      const pulse = document.createElementNS(NS, 'path'); pulse.setAttribute('d', d); pulse.setAttribute('class', 'beam__p'); pulse.setAttribute('pathLength', '100');
      pulse.style.animationDelay = `${(-i * 0.73).toFixed(2)}s`;
      svg.append(base, pulse);
      traces[i] = base;
    });
  };
  build();
  addEventListener('resize', build);
  addEventListener('load', build);
  if (document.fonts?.ready) document.fonts.ready.then(build);
  tiles.forEach((t, i) => {
    t.addEventListener('pointerenter', () => traces[i]?.classList.add('is-hot'));
    t.addEventListener('pointerleave', () => traces[i]?.classList.remove('is-hot'));
  });
  inView(root, (v) => root.classList.toggle('is-off', !v));
}

/* Certificates: three sheets that fan open as they arrive; a hovered row lifts its sheet */
function initCerts() {
  const root = $('[data-certs]');
  if (!root) return;
  const sheets = $$('.sheet', root), rows = $$('.cert-row', root);
  whenVisible(root, () => {
    const r = root.getBoundingClientRect();
    root.style.setProperty('--spread', smoothstep(0, 0.55, clamp((innerHeight - r.top) / (innerHeight + r.height * 0.4))).toFixed(3));
  });
  const up = (i) => { sheets.forEach((s, k) => s.classList.toggle('is-up', k === i)); rows.forEach((s, k) => s.classList.toggle('is-up', k === i)); };
  [...sheets, ...rows].forEach((el) => el.addEventListener('pointerenter', () => up(Number(el.dataset.i))));
  root.addEventListener('pointerleave', () => up(-1));
}

/* Photos thrown onto a table as you scroll; scrolling back picks them up again */
function initScatter() {
  const root = $('[data-scatter]');
  if (!root) return;
  const figs = $$('.print', root), table = $('.scatter__table', root), cap = $('[data-cap]', root);
  const n = figs.length;
  const out = (t) => 1 - Math.pow(1 - t, 3);
  let last = -2;
  whenVisible(root, () => {
    const p = pinProgress(root) * (n + 0.35), W = table.clientWidth, H = table.clientHeight;
    let top = -1;
    figs.forEach((f, i) => {
      const t = clamp((p - i) / 0.85);
      if (t <= 0) { f.style.visibility = 'hidden'; return; }
      if (t > 0.45) top = i;
      const e = out(t), rx = Number(f.dataset.x) / 100 * W, ry = Number(f.dataset.y) / 100 * H, r = Number(f.dataset.r), side = i % 2 ? 1 : -1;
      const x = rx + (1 - e) * side * W * 0.5, y = ry + (1 - e) * innerHeight * 1.05, rot = r + (1 - e) * side * 34, s = 1 + (1 - e) * 0.22;
      f.style.visibility = 'visible';
      f.style.transform = `translate(-50%,-50%) translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) scale(${s.toFixed(3)})`;
    });
    if (top !== last && cap) { last = top; cap.textContent = top >= 0 ? figs[top].querySelector('img').alt : ''; cap.parentElement.style.setProperty('--seen', `${(top + 1) / n}`); }
  });
}

/* Letters that roll as the pointer passes over a name */
function initRoll() {
  for (const el of $$('[data-roll]')) {
    const text = el.textContent;
    el.setAttribute('aria-label', text);
    el.textContent = '';
    [...text].forEach((c, i) => {
      const s = document.createElement('span');
      s.className = 'rl'; s.setAttribute('aria-hidden', 'true'); s.style.setProperty('--i', i);
      const inner = document.createElement('i'); inner.textContent = c === ' ' ? ' ' : c;
      s.append(inner); el.append(s);
    });
  }
  for (const b of $$('.btn, .nav-pill__cta')) {
    if (b.children.length) continue;
    const t = b.textContent.trim();
    b.textContent = '';
    const w = document.createElement('span'); w.className = 'btn__t';
    const i = document.createElement('i'); i.textContent = t;
    w.append(i); b.append(w);
  }
}

function initTilt() {
  if (reduced.matches || !finePointer.matches) return;
  for (const el of $$('[data-tilt]')) {
    const max = Number(el.dataset.tilt) || 6;
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--ry', (x * max * 2).toFixed(2) + 'deg');
      el.style.setProperty('--rx', (-y * max * 2).toFixed(2) + 'deg');
      el.classList.add('is-tilt');
    });
    el.addEventListener('pointerleave', () => { el.classList.remove('is-tilt'); el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
  }
}

/* Products menu: a picture of whatever you point at */
function initMenuView() {
  const view = $('.menu__view');
  if (!view) return;
  const items = $$('.mv', view);
  const fill = () => $$('img[data-src]', view).forEach((im) => { im.src = im.dataset.src; im.removeAttribute('data-src'); });
  const host = view.closest('.has-menu');
  host.addEventListener('pointerenter', fill, { once: true });
  host.addEventListener('focusin', fill, { once: true });
  const show = (i) => items.forEach((m, k) => m.classList.toggle('on', k === i));
  $$('.menu__list a', host).forEach((a) => {
    const i = Number(a.dataset.view);
    a.addEventListener('pointerenter', () => show(i));
    a.addEventListener('focus', () => show(i));
  });
}

function initTabs() {
  for (const root of $$('[data-tabs]')) {
    const tabs = $$('[role=tab]', root), pill = $('.tabs__pill', root), groups = $$('[data-group]');
    const go = (i) => {
      tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); t.tabIndex = k === i ? 0 : -1; });
      groups.forEach((g, k) => { g.hidden = k !== i; });
      pill.style.width = tabs[i].offsetWidth + 'px';
      pill.style.transform = `translateX(${tabs[i].offsetLeft}px)`;
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => go(i));
      t.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) { const k = (i + d + tabs.length) % tabs.length; go(k); tabs[k].focus(); }
      });
    });
    go(0);
    addEventListener('resize', () => go(tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true')));
    if (document.fonts?.ready) document.fonts.ready.then(() => go(tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true')));
  }
}

/* A charge bar that fills as the form's required details are completed */
function initFormMeter() {
  for (const form of $$('form[data-enquiry]')) {
    const req = $$('[required]', form);
    const m = document.createElement('div');
    m.className = 'meter full'; m.setAttribute('aria-hidden', 'true');
    m.innerHTML = '<span class="meter__t"></span><i><u></u></i>';
    form.prepend(m);
    const t = $('.meter__t', m), u = $('u', m);
    const run = () => {
      const done = req.filter((f) => f.value.trim() && f.checkValidity()).length;
      u.style.transform = `scaleX(${(done / req.length).toFixed(3)})`;
      t.textContent = done === req.length ? 'Fully charged. Ready to send.' : `Charge ${Math.round(done / req.length * 100)}%`;
    };
    form.addEventListener('input', run);
    run();
  }
}

/* QiX: the phone walks through scan, pay, charge */
function initQix() {
  const root = $('[data-qix]');
  if (!root) return;
  const steps = $$('.qx-step', root), screens = $$('.scr', root), ring = $('.scr__ring', root), pct = $('[data-qix-pct]', root);
  let cur = -1;
  whenVisible(root, () => {
    const p = pinProgress(root), f = clamp(p * 3, 0, 2.999), i = Math.floor(f);
    if (i !== cur) {
      cur = i;
      steps.forEach((s, k) => s.classList.toggle('on', k === i));
      screens.forEach((s, k) => { s.classList.toggle('on', k === i); s.classList.toggle('past', k < i); });
    }
    const c = clamp((p - 0.66) / 0.3);
    ring.style.setProperty('--c', c.toFixed(3));
    pct.textContent = Math.round(c * 100);
  });
}

function initFooter() {
  const foot = $('.foot'), mark = $('.foot__mark');
  if (!foot || !mark) return;
  whenVisible(foot, () => {
    const r = foot.getBoundingClientRect();
    mark.style.setProperty('--fill', clamp((innerHeight - r.top) / Math.max(1, r.height)).toFixed(3));
  });
}

export function initFx() {
  initRoll(); initDither(); initCable(); initArc(); initField(); initBeam(); initCerts();
  initScatter(); initTilt(); initMenuView(); initTabs(); initFormMeter(); initQix(); initFooter();
}
