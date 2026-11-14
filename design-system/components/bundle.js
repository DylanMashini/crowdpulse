/* @ds-bundle: {"format":4,"namespace":"TriageCam","components":[{"name":"Button"},{"name":"Switch"},{"name":"Field"},{"name":"Icon"},{"name":"StatusBadge"},{"name":"ProvenanceTag"},{"name":"ScoreChip"},{"name":"QualityMeter"},{"name":"Readout"},{"name":"TicketNumber"},{"name":"HandoffNote"},{"name":"PrivacyNote"},{"name":"SideNav"},{"name":"WorklistTable"},{"name":"PatientTile"},{"name":"ReferenceChart"},{"name":"TicketTimeline"},{"name":"WorklistCard"},{"name":"PushBanner"},{"name":"RolePicker"},{"name":"Viewfinder"},{"name":"SittingTimer"},{"name":"CaptureStatus"},{"name":"SittingSummary"},{"name":"ConsentSheet"}]} */
(function () {
  'use strict';
  var React = window.React;
  var h = React.createElement;
  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }
  function rest(props, omit) {
    var o = {};
    for (var k in props) if (omit.indexOf(k) < 0) o[k] = props[k];
    return o;
  }

  /* ---------- Icon ---------- */
  var GLYPHS = {
    clock: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
    flag: [['path', { d: 'M5 21V4h11l-2 4 2 4H5' }]],
    check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
    bell: [['path', { d: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z' }], ['path', { d: 'M10 21h4' }]],
    camera: [['path', { d: 'M4 8h3l1.5-2h7L17 8h3v11H4z' }], ['circle', { cx: 12, cy: 13.5, r: 3.5 }]],
    lock: [['rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }], ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }]],
    'no-reading': [['circle', { cx: 12, cy: 12, r: 9, strokeDasharray: '3 3' }], ['path', { d: 'M8 12h8' }]],
    pulse: [['path', { d: 'M3 12h4l2-6 4 12 2-6h6' }]],
    breath: [['path', { d: 'M4 9c3-3 5 3 8 0s5 3 8 0' }], ['path', { d: 'M4 15c3-3 5 3 8 0s5 3 8 0' }]],
    list: [['path', { d: 'M9 6h11M9 12h11M9 18h11' }], ['path', { d: 'M4.5 6h.01M4.5 12h.01M4.5 18h.01', strokeWidth: 2.5 }]],
    sliders: [['path', { d: 'M4 7h10M18 7h2M4 17h2M10 17h10' }], ['circle', { cx: 16, cy: 7, r: 2 }], ['circle', { cx: 8, cy: 17, r: 2 }]],
    chart: [['path', { d: 'M4 4v16h16' }], ['path', { d: 'M7 15l4-4 3 3 5-6' }]],
    ticket: [['path', { d: 'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z' }], ['path', { d: 'M14 6v12', strokeDasharray: '2 2.5' }]],
    draft: [['path', { d: 'M4 20l1-4L16 5l3 3L8 19z' }], ['path', { d: 'M14 7l3 3' }]],
    trash: [['path', { d: 'M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13' }]],
    scan: [['path', { d: 'M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3' }], ['circle', { cx: 12, cy: 10.5, r: 2.5 }], ['path', { d: 'M8 16.5c1-2.5 7-2.5 8 0' }]],
    user: [['circle', { cx: 12, cy: 8, r: 3.5 }], ['path', { d: 'M5 20c1-5 13-5 14 0' }]],
    video: [['rect', { x: 3, y: 7, width: 12, height: 10, rx: 2 }], ['path', { d: 'M15 11l6-3v8l-6-3' }]],
    thermal: [['path', { d: 'M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z' }]],
    chevron: [['path', { d: 'M9 6l6 6-6 6' }]],
    'eye-off': [['path', { d: 'M3 3l18 18' }], ['path', { d: 'M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 8.5 4 9.5 6-.4.8-1.2 2-2.4 3.1' }], ['path', { d: 'M6.5 7.7C4.5 9 3.1 10.8 2.5 12c1 2 4.5 6 9.5 6 1.3 0 2.5-.3 3.6-.7' }], ['path', { d: 'M9.9 10a3 3 0 0 0 4.2 4.2' }]]
  };
  function Icon(props) {
    var size = props.size || 20;
    var g = GLYPHS[props.name] || [];
    return h('svg', {
      className: cx('tc-icon', props.className), width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      role: props.label ? 'img' : undefined, 'aria-label': props.label, 'aria-hidden': props.label ? undefined : true
    }, g.map(function (p, i) { return h(p[0], Object.assign({ key: i }, p[1])); }));
  }
  Icon.names = Object.keys(GLYPHS);

  /* ---------- Actions ---------- */
  function Button(props) {
    var variant = props.variant || 'secondary', size = props.size || 'md';
    return h('button', Object.assign({ type: 'button' }, rest(props, ['variant', 'size', 'icon', 'block', 'className', 'children']), {
      className: cx('tc-btn', 'tc-btn-' + variant, 'tc-btn-' + size, props.block && 'tc-btn-block', props.className)
    }), props.icon ? h(Icon, { name: props.icon, size: size === 'touch' ? 20 : 18 }) : null, h('span', null, props.children));
  }

  function Switch(props) {
    return h('label', { className: cx('tc-switch', props.disabled && 'is-disabled') },
      h('span', { className: 'tc-switch-text' },
        h('span', { className: 'tc-switch-label' }, props.label),
        props.hint ? h('span', { className: 'tc-hint' }, props.hint) : null),
      h('button', {
        type: 'button', role: 'switch', 'aria-checked': !!props.checked, disabled: props.disabled,
        className: cx('tc-switch-track', props.checked && 'is-on'),
        onClick: function () { if (props.onChange) props.onChange(!props.checked); }
      }, h('span', { className: 'tc-switch-thumb' }), h('span', { className: 'tc-switch-state' }, props.checked ? 'On' : 'Off')));
  }

  function Field(props) {
    var id = props.id || 'tc-f-' + String(props.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return h('div', { className: cx('tc-field', props.size === 'touch' && 'tc-field-touch', props.error && 'has-error') },
      h('label', { className: 'tc-field-label', htmlFor: id }, props.label),
      h('div', { className: 'tc-field-box' },
        h('input', Object.assign({ id: id, className: 'tc-input' }, rest(props, ['label', 'hint', 'unit', 'error', 'size', 'id']))),
        props.unit ? h('span', { className: 'tc-field-unit' }, props.unit) : null),
      props.error ? h('p', { className: 'tc-field-error' }, props.error) : props.hint ? h('p', { className: 'tc-hint' }, props.hint) : null);
  }

  /* ---------- Status ---------- */
  function ageText(minutes) {
    if (minutes == null) return '';
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + ' min ago';
    var hrs = Math.floor(minutes / 60), m = minutes % 60;
    return hrs + ' h ' + (m ? m + ' min ' : '') + 'ago';
  }
  var STATES = {
    observed: { icon: 'clock', text: function (m) { return 'Observed ' + ageText(m); } },
    flag: { icon: 'flag', text: function () { return 'Trend flag'; } },
    overdue: { icon: 'clock', text: function (m) { return m != null ? 'Overdue, last seen ' + ageText(m) : 'Overdue'; } },
    'no-reading': { icon: 'no-reading', text: function () { return 'No reading'; } }
  };
  function StatusBadge(props) {
    var s = STATES[props.state] || STATES.observed;
    return h('span', { className: cx('tc-badge', 'tc-badge-' + props.state, props.className) },
      h(Icon, { name: s.icon, size: 16 }), h('span', null, props.children || s.text(props.minutes)));
  }

  var KINDS = {
    live: 'Live', recording: 'Recording', experimental: 'Experimental', 'ai-draft': 'AI draft', reference: 'Reference'
  };
  function ProvenanceTag(props) {
    return h('span', { className: cx('tc-tag', 'tc-tag-' + props.kind) },
      props.kind === 'live' ? h('span', { className: 'tc-tag-dot', 'aria-hidden': true }) : null,
      props.children || KINDS[props.kind]);
  }

  function ScoreChip(props) {
    var score = Math.max(0, Math.min(3, props.score || 0));
    var measured = props.measured == null ? 2 : props.measured;
    return h('span', { className: 'tc-score' },
      h('span', { className: cx('tc-score-chip', 'tc-score-' + score), 'aria-label': 'Partial score ' + score }, score),
      props.caption === false ? null : h('span', { className: 'tc-score-caption' }, measured + ' of 7 parameters'));
  }

  function QualityMeter(props) {
    var v = Math.max(0, Math.min(1, props.value || 0)), pct = Math.round(v * 100);
    var low = props.threshold != null && v < props.threshold;
    return h('div', { className: cx('tc-meter', low && 'is-low') },
      h('div', { className: 'tc-meter-head' },
        h('span', { className: 'tc-meter-label' }, props.label || 'Coverage'),
        h('span', { className: 'tc-meter-value' }, pct + '%' + (low ? ', below threshold' : ''))),
      h('div', { className: 'tc-meter-track', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': props.label || 'Coverage' },
        h('div', { className: 'tc-meter-fill', style: { width: pct + '%' } }),
        props.threshold != null ? h('div', { className: 'tc-meter-mark', style: { left: Math.round(props.threshold * 100) + '%' } }) : null));
  }

  /* ---------- Vitals ---------- */
  function Readout(props) {
    var state = props.state || 'valid', size = props.size || 'lg';
    var body;
    if (state === 'none') body = h('span', { className: 'tc-readout-none' }, 'No reading');
    else if (state === 'settling') body = h('span', { className: 'tc-readout-none' }, 'Settling');
    else body = [h('span', { key: 'v', className: 'tc-readout-value' }, props.value), h('span', { key: 'u', className: 'tc-readout-unit' }, props.unit)];
    var foot = state === 'stale' ? 'Stale, ' + (props.age || 'no recent reading') : state === 'settling' ? 'Waiting for three windows to agree' : state === 'none' ? (props.reason || 'Signal quality too low') : props.age;
    return h('div', { className: cx('tc-readout', 'tc-readout-' + size, 'is-' + state) },
      h('div', { className: 'tc-readout-head' },
        props.icon ? h(Icon, { name: props.icon, size: 18 }) : null,
        h('span', { className: 'tc-readout-label' }, props.label),
        props.tag ? h(ProvenanceTag, { kind: props.tag }) : null),
      h('div', { className: 'tc-readout-body' }, body),
      foot ? h('div', { className: 'tc-readout-foot' }, foot) : null);
  }

  function TicketNumber(props) {
    return h('span', { className: cx('tc-ticket', 'tc-ticket-' + (props.size || 'md')) },
      h('span', { className: 'tc-ticket-word' }, 'Ticket'), h('span', { className: 'tc-ticket-num' }, props.number));
  }

  function HandoffNote(props) {
    var ds = props.draftState || (props.draft ? 'ready' : 'none');
    var draft = null;
    if (ds === 'ready') draft = h('div', { className: 'tc-handoff-draft' },
      h('div', { className: 'tc-handoff-draft-head' }, h(ProvenanceTag, { kind: 'ai-draft' }), h('span', { className: 'tc-hint' }, 'Written from the values above. You decide.')),
      h('p', null, props.draft));
    else if (ds === 'withheld') draft = h('p', { className: 'tc-handoff-off' }, 'No draft: the latest reading is stale or low quality');
    else if (ds === 'unavailable') draft = h('p', { className: 'tc-handoff-off' }, 'Draft unavailable. The measured values above are complete.');
    return h('div', { className: 'tc-handoff' }, h('p', { className: 'tc-handoff-data' }, props.children), draft);
  }

  function PrivacyNote(props) {
    return h('p', { className: cx('tc-privacy', props.tone === 'plain' && 'tc-privacy-plain') },
      h(Icon, { name: props.icon || 'lock', size: 16 }), h('span', null, props.children));
  }

  /* ---------- Dashboard ---------- */
  function SideNav(props) {
    return h('nav', { className: 'tc-nav', 'aria-label': 'Dashboard' },
      h('div', { className: 'tc-nav-name' }, props.title || 'Crowdpulse'),
      h('ul', null, (props.items || []).map(function (it) {
        var on = it.id === props.active;
        return h('li', { key: it.id }, h('button', {
          type: 'button', className: cx('tc-nav-item', on && 'is-active'), 'aria-current': on ? 'page' : undefined,
          onClick: function () { if (props.onSelect) props.onSelect(it.id); }
        }, h(Icon, { name: it.icon, size: 18 }), h('span', { className: 'tc-nav-label' }, it.label),
          it.count != null ? h('span', { className: 'tc-nav-count' }, it.count) : null));
      })),
      props.footer ? h('div', { className: 'tc-nav-foot' }, props.footer) : null);
  }

  function Trend(props) {
    var v = props.v;
    if (!v || v.now == null) return h('span', { className: 'tc-trend tc-trend-none' }, 'No reading');
    var d = v.base != null ? v.now - v.base : 0;
    return h('span', { className: 'tc-trend' },
      h('span', { className: 'tc-trend-now' }, v.now),
      v.base != null ? h('span', { className: 'tc-trend-base' }, 'from ' + v.base + (d ? ' (' + (d > 0 ? '+' : '−') + Math.abs(d) + ')' : '')) : null);
  }

  function WorklistTable(props) {
    var rows = props.rows || [];
    return h('div', { className: 'tc-table-wrap' }, h('table', { className: 'tc-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col', className: 'tc-num' }, 'Rank'), h('th', { scope: 'col' }, 'Ticket'), h('th', { scope: 'col' }, 'State'),
        h('th', { scope: 'col' }, 'Pulse, bpm'), h('th', { scope: 'col' }, 'Breathing, per min'), h('th', { scope: 'col' }, 'Partial score'), h('th', { scope: 'col' }, 'Source'))),
      h('tbody', null, rows.map(function (r, i) {
        var sel = props.selected === r.ticket;
        return h('tr', {
          key: r.ticket, className: cx('tc-row', 'tc-row-' + r.state, sel && 'is-selected'), tabIndex: 0, 'aria-selected': sel,
          onClick: function () { if (props.onSelect) props.onSelect(r.ticket); },
          onKeyDown: function (e) { if (e.key === 'Enter' && props.onSelect) props.onSelect(r.ticket); }
        },
          h('td', { className: 'tc-num tc-rank' }, i + 1),
          h('td', null, h(TicketNumber, { number: r.ticket, size: 'sm' })),
          h('td', null, h(StatusBadge, { state: r.state, minutes: r.minutes })),
          h('td', null, h(Trend, { v: r.pulse })), h('td', null, h(Trend, { v: r.breathing })),
          h('td', null, r.score != null ? h(ScoreChip, { score: r.score, caption: false }) : h('span', { className: 'tc-trend-none' }, 'Not scored')),
          h('td', null, h(ProvenanceTag, { kind: r.source || 'live' })));
      }))));
  }

  function PatientTile(props) {
    return h('article', { className: cx('tc-tile', 'tc-tile-' + props.state) },
      h('header', { className: 'tc-tile-head' }, h(TicketNumber, { number: props.ticket, size: 'md' }), h(ProvenanceTag, { kind: props.source || 'live' })),
      h(StatusBadge, { state: props.state, minutes: props.minutes }),
      h('dl', { className: 'tc-tile-vitals' },
        h('div', null, h('dt', null, 'Pulse, bpm'), h('dd', null, h(Trend, { v: props.pulse }))),
        h('div', null, h('dt', null, 'Breathing, per min'), h('dd', null, h(Trend, { v: props.breathing })))),
      props.score != null ? h(ScoreChip, { score: props.score }) : null);
  }

  function ReferenceChart(props) {
    var est = props.estimate || [], ref = props.reference || [];
    var W = props.width || 640, H = props.height || 240, m = { t: 16, r: 84, b: 28, l: 40 };
    var n = Math.max(est.length, ref.length);
    var all = est.concat(ref).filter(function (v) { return v != null; });
    var lo = Math.floor((Math.min.apply(null, all) - 4) / 10) * 10, hi = Math.ceil((Math.max.apply(null, all) + 4) / 10) * 10;
    var x = function (i) { return m.l + (W - m.l - m.r) * (n > 1 ? i / (n - 1) : 0); };
    var y = function (v) { return m.t + (H - m.t - m.b) * (1 - (v - lo) / (hi - lo)); };
    var path = function (arr) {
      var d = '', pen = false;
      arr.forEach(function (v, i) { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; });
      return d;
    };
    var st = React.useState(null), hover = st[0], setHover = st[1];
    var tb = React.useState(false), table = tb[0], setTable = tb[1];
    var errs = [];
    for (var i = 0; i < n; i++) if (est[i] != null && ref[i] != null) errs.push(Math.abs(est[i] - ref[i]));
    var mae = errs.length ? errs.reduce(function (a, b) { return a + b; }, 0) / errs.length : null;
    var within = errs.length ? Math.round(100 * errs.filter(function (e) { return e <= 5; }).length / errs.length) : null;
    var ticks = []; for (var t = lo; t <= hi; t += 10) ticks.push(t);
    var xt = []; for (var s = 0; s < n; s += 10) xt.push(s);
    var lastOf = function (arr) { for (var j = arr.length - 1; j >= 0; j--) if (arr[j] != null) return { i: j, v: arr[j] }; return null; };
    var le = lastOf(est), lr = lastOf(ref);
    var ly = le && lr && Math.abs(y(le.v) - y(lr.v)) < 16 ? (le.v >= lr.v ? [-9, 9] : [9, -9]) : [0, 0];
    var move = function (e) {
      var box = e.currentTarget.getBoundingClientRect();
      var px = (e.clientX - box.left) * (W / box.width);
      var idx = Math.round((px - m.l) / (W - m.l - m.r) * (n - 1));
      setHover(Math.max(0, Math.min(n - 1, idx)));
    };
    return h('figure', { className: 'tc-chart' },
      h('figcaption', { className: 'tc-chart-head' },
        h('div', null, h('div', { className: 'tc-chart-title' }, props.title || 'Heart rate, camera estimate against reference'),
          h('div', { className: 'tc-chart-sub' }, mae != null ? 'Mean absolute error ' + mae.toFixed(1) + ' bpm. ' + within + '% of readings within 5 bpm.' : 'Waiting for both signals')),
        h('div', { className: 'tc-chart-legend' },
          h('span', null, h('i', { className: 'tc-key tc-key-est' }), 'Camera estimate'),
          h('span', null, h('i', { className: 'tc-key tc-key-ref' }), props.referenceName || 'Chest strap'),
          h('button', { type: 'button', className: 'tc-link', 'aria-pressed': table, onClick: function () { setTable(!table); } }, table ? 'Show chart' : 'Show table'))),
      table ? h('div', { className: 'tc-chart-table' }, h('table', { className: 'tc-table' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Second'), h('th', { scope: 'col' }, 'Camera, bpm'), h('th', { scope: 'col' }, 'Reference, bpm'), h('th', { scope: 'col' }, 'Difference'))),
        h('tbody', null, xt.concat(n - 1 > xt[xt.length - 1] ? [n - 1] : []).map(function (i2) {
          var a = est[i2], b = ref[i2];
          return h('tr', { key: i2 }, h('td', null, i2), h('td', null, a == null ? 'No reading' : a), h('td', null, b == null ? 'No reading' : b), h('td', null, a != null && b != null ? (a - b > 0 ? '+' : '') + (a - b) : ''));
        }))))
        : h('div', { className: 'tc-chart-plot' },
          h('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Line chart of camera estimate and reference heart rate over the sitting', onMouseMove: move, onMouseLeave: function () { setHover(null); } },
            ticks.map(function (tk) { return h('g', { key: tk }, h('line', { className: 'tc-grid', x1: m.l, x2: W - m.r, y1: y(tk), y2: y(tk) }), h('text', { className: 'tc-axis', x: m.l - 8, y: y(tk) + 4, textAnchor: 'end' }, tk)); }),
            xt.map(function (sx) { return h('text', { key: sx, className: 'tc-axis', x: x(sx), y: H - 8, textAnchor: 'middle' }, sx + ' s'); }),
            h('path', { className: 'tc-line-ref', d: path(ref) }), h('path', { className: 'tc-line-est', d: path(est) }),
            lr ? h('text', { className: 'tc-endlabel', x: x(lr.i) + 8, y: y(lr.v) + 4 + ly[1] }, 'Reference ' + lr.v) : null,
            le ? h('text', { className: 'tc-endlabel tc-endlabel-est', x: x(le.i) + 8, y: y(le.v) + 4 + ly[0] }, 'Camera ' + le.v) : null,
            hover != null ? h('g', null,
              h('line', { className: 'tc-cross', x1: x(hover), x2: x(hover), y1: m.t, y2: H - m.b }),
              ref[hover] != null ? h('circle', { className: 'tc-dot-ref', cx: x(hover), cy: y(ref[hover]), r: 4 }) : null,
              est[hover] != null ? h('circle', { className: 'tc-dot-est', cx: x(hover), cy: y(est[hover]), r: 4 }) : null) : null),
          hover != null ? h('div', { className: 'tc-tip', style: { left: (x(hover) / W * 100) + '%' } },
            h('div', { className: 'tc-tip-t' }, hover + ' s'),
            h('div', null, h('i', { className: 'tc-key tc-key-est' }), 'Camera ', h('b', null, est[hover] == null ? 'No reading' : est[hover])),
            h('div', null, h('i', { className: 'tc-key tc-key-ref' }), 'Reference ', h('b', null, ref[hover] == null ? 'No reading' : ref[hover]))) : null));
  }

  function TicketTimeline(props) {
    return h('ol', { className: 'tc-timeline' }, (props.items || []).map(function (it, i) {
      return h('li', { key: i, className: cx('tc-tl-item', 'tc-tl-' + (it.state || 'observed')) },
        h('span', { className: 'tc-tl-time' }, it.time),
        h('span', { className: 'tc-tl-mark', 'aria-hidden': true }),
        h('div', { className: 'tc-tl-body' },
          h('div', { className: 'tc-tl-title' }, h('span', null, it.title),
            it.state && it.state !== 'observed' ? h(StatusBadge, { state: it.state }) : null,
            it.source && it.source !== 'live' ? h(ProvenanceTag, { kind: it.source }) : null),
          it.pulse != null || it.breathing != null ? h('div', { className: 'tc-tl-vals' },
            h('span', null, h('b', null, it.pulse != null ? it.pulse : 'No reading'), ' bpm'),
            h('span', null, h('b', null, it.breathing != null ? it.breathing : 'No reading'), ' breaths per min'),
            it.score != null ? h(ScoreChip, { score: it.score, caption: false }) : null) : null,
          it.note ? h('p', { className: 'tc-tl-note' }, it.note) : null));
    }));
  }

  /* ---------- Nurse app ---------- */
  function WorklistCard(props) {
    return h('button', { type: 'button', className: cx('tc-wcard', 'tc-wcard-' + props.state), onClick: props.onPress },
      h('span', { className: 'tc-wcard-rank' }, props.rank),
      h('span', { className: 'tc-wcard-main' },
        h('span', { className: 'tc-wcard-top' }, h(TicketNumber, { number: props.ticket, size: 'md' }), h(StatusBadge, { state: props.state, minutes: props.minutes })),
        h('span', { className: 'tc-wcard-vals' },
          h('span', { className: 'tc-wcard-k' }, 'Pulse'), h(Trend, { v: props.pulse }),
          h('span', { className: 'tc-wcard-k' }, 'Breathing'), h(Trend, { v: props.breathing })),
        props.source && props.source !== 'live' ? h('span', null, h(ProvenanceTag, { kind: props.source })) : null),
      h(Icon, { name: 'chevron', size: 20, className: 'tc-wcard-go' }));
  }

  function PushBanner(props) {
    return h('div', { className: cx('tc-push', props.acknowledged && 'is-ack'), role: 'status' },
      h('div', { className: 'tc-push-head' }, h(Icon, { name: props.acknowledged ? 'check' : 'flag', size: 18 }),
        h('span', { className: 'tc-push-title' }, props.title || 'Trend flag, ticket ' + props.ticket), h('span', { className: 'tc-push-time' }, props.time)),
      h('p', { className: 'tc-push-body' }, props.children),
      h('div', { className: 'tc-push-actions' },
        props.acknowledged ? h('span', { className: 'tc-push-done' }, 'Acknowledged' + (props.by ? ' by ' + props.by : ''))
          : h(Button, { variant: 'primary', size: 'touch', onClick: props.onAcknowledge }, 'Acknowledge'),
        h(Button, { variant: 'quiet', size: 'touch', onClick: props.onOpen }, 'Open ticket')));
  }

  function RolePicker(props) {
    var roles = props.roles || [
      { id: 'camera', icon: 'camera', label: 'Camera', hint: 'Mounted phone. Measures a seated patient.' },
      { id: 'nurse', icon: 'list', label: 'Nurse', hint: 'Worklist and flag notifications' },
      { id: 'patient', icon: 'video', label: 'Patient', hint: 'Measure on your own phone during a video visit' }
    ];
    return h('div', { className: 'tc-roles', role: 'radiogroup', 'aria-label': 'Role' }, roles.map(function (r) {
      var on = props.value === r.id;
      return h('button', { key: r.id, type: 'button', role: 'radio', 'aria-checked': on, className: cx('tc-role', on && 'is-on'), onClick: function () { if (props.onChange) props.onChange(r.id); } },
        h(Icon, { name: r.icon, size: 20 }),
        h('span', { className: 'tc-role-text' }, h('span', { className: 'tc-role-label' }, r.label), h('span', { className: 'tc-hint' }, r.hint)),
        h('span', { className: 'tc-role-radio', 'aria-hidden': true }));
    }));
  }

  /* ---------- Camera app (always dark) ---------- */
  var VF = {
    searching: 'Looking for a face. Sit 0.6 to 0.9 m from the phone.',
    locking: 'Face found. Locking exposure, keep still.',
    measuring: 'Measuring. Keep still and breathe normally.',
    lost: 'No reading. Face not in view.'
  };
  function Viewfinder(props) {
    var state = props.state || 'searching', on = state === 'measuring' || state === 'locking';
    return h('div', { className: cx('tc-vf', 'is-' + state), 'data-theme': 'dark' },
      h('svg', { viewBox: '0 0 320 400', className: 'tc-vf-art', 'aria-hidden': true },
        h('path', { className: 'tc-vf-frame', d: 'M24 56V24h32M264 24h32v32M296 344v32h-32M56 376H24v-32' }),
        on ? h('g', { className: 'tc-vf-regions' },
          h('rect', { x: 122, y: 84, width: 76, height: 26, rx: 6 }), h('rect', { x: 104, y: 150, width: 36, height: 30, rx: 6 }), h('rect', { x: 180, y: 150, width: 36, height: 30, rx: 6 }),
          h('rect', { className: 'tc-vf-chest', x: 88, y: 268, width: 144, height: 72, rx: 6 })) : h('ellipse', { className: 'tc-vf-guide', cx: 160, cy: 140, rx: 62, ry: 80 }),
        on ? h('g', { className: 'tc-vf-labels' }, h('text', { x: 204, y: 101 }, 'Forehead'), h('text', { x: 222, y: 169 }, 'Cheeks'), h('text', { x: 160, y: 360, textAnchor: 'middle' }, 'Chest motion')) : null),
      h('div', { className: 'tc-vf-msg', role: 'status' }, props.children || VF[state]),
      h('div', { className: 'tc-vf-note' }, h(Icon, { name: 'eye-off', size: 16 }), 'Outlines only. The picture is not shown or stored.'));
  }

  function SittingTimer(props) {
    var total = props.total || 60, el = Math.max(0, Math.min(total, props.elapsed || 0));
    var phases = props.phases || [{ until: 5, label: 'Settle' }, { until: 20, label: 'Heart rate' }, { until: 60, label: 'Breathing and beats' }];
    var start = 0;
    return h('div', { className: 'tc-timer', 'data-theme': 'dark' },
      h('div', { className: 'tc-timer-head' },
        h('span', { className: 'tc-timer-left' }, el >= total ? 'Done' : (total - el) + ' s left'),
        h('span', { className: 'tc-timer-phase' }, el >= total ? 'Baseline saved' : (phases.filter(function (p) { return el < p.until; })[0] || phases[phases.length - 1]).label)),
      h('div', { className: 'tc-timer-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': el },
        phases.map(function (p, i) {
          var from = start, span = p.until - from; start = p.until;
          var fill = Math.max(0, Math.min(1, (el - from) / span));
          return h('div', { key: i, className: 'tc-timer-seg', style: { flexGrow: span } }, h('div', { className: 'tc-timer-fill', style: { width: (fill * 100) + '%' } }));
        })));
  }

  function CaptureStatus(props) {
    var items = [
      ['Frame rate', (props.fps != null ? props.fps : 60) + ' fps', false],
      ['Dropped frames', String(props.dropped || 0), (props.dropped || 0) > 30],
      ['Exposure', props.exposureLocked ? 'Locked' : 'Settling', !props.exposureLocked],
      ['Phone temperature', props.thermal || 'Normal', props.thermal && props.thermal !== 'Normal']
    ];
    return h('div', { className: 'tc-capture', 'data-theme': 'dark' },
      h('dl', null, items.map(function (it) { return h('div', { key: it[0], className: cx(it[2] && 'is-warn') }, h('dt', null, it[0]), h('dd', null, it[2] ? h(Icon, { name: 'flag', size: 14 }) : null, it[1])); })),
      h(PrivacyNote, null, props.note || 'No video leaves this phone. Only numbers are sent.'));
  }

  function SittingSummary(props) {
    return h('div', { className: 'tc-summary', 'data-theme': props.theme },
      h('div', { className: 'tc-summary-head' }, h(TicketNumber, { number: props.ticket, size: 'lg' }),
        h('span', { className: 'tc-summary-saved' }, h(Icon, { name: 'check', size: 18 }), 'Baseline saved')),
      h('div', { className: 'tc-summary-grid' }, (props.items || []).map(function (it, i) {
        return h('div', { key: i, className: 'tc-summary-item' },
          h(Readout, { label: it.label, icon: it.icon, value: it.value, unit: it.unit, state: it.value == null ? 'none' : 'valid', reason: it.reason, tag: it.experimental ? 'experimental' : null, size: 'lg' }),
          it.coverage != null ? h(QualityMeter, { value: it.coverage, threshold: it.threshold }) : null);
      })),
      props.children);
  }

  function ConsentSheet(props) {
    return h('div', { className: 'tc-sheet', role: 'dialog', 'aria-labelledby': 'tc-consent-h' },
      h('h2', { id: 'tc-consent-h', className: 'tc-sheet-title' }, props.title || 'Use face match for re-checks?'),
      h('p', { className: 'tc-sheet-lead' }, 'Face match lets you sit down again without typing your ticket number. It is optional.'),
      h('ul', { className: 'tc-sheet-list' },
        h('li', null, h(Icon, { name: 'scan', size: 20 }), h('span', null, 'Used only to match you to ticket ' + (props.ticket || ''))),
        h('li', null, h(Icon, { name: 'trash', size: 20 }), h('span', null, 'Deleted when you are discharged')),
        h('li', null, h(Icon, { name: 'ticket', size: 20 }), h('span', null, 'Your ticket number always works instead'))),
      h('div', { className: 'tc-sheet-actions' },
        h(Button, { variant: 'secondary', size: 'touch', block: true, onClick: props.onDecline }, 'Use my ticket number'),
        h(Button, { variant: 'secondary', size: 'touch', block: true, onClick: props.onAccept }, 'Turn on face match')));
  }

  window.TriageCam = Object.assign(window.TriageCam || {}, {
    Button: Button, Switch: Switch, Field: Field, Icon: Icon, StatusBadge: StatusBadge, ProvenanceTag: ProvenanceTag,
    ScoreChip: ScoreChip, QualityMeter: QualityMeter, Readout: Readout, TicketNumber: TicketNumber, HandoffNote: HandoffNote,
    PrivacyNote: PrivacyNote, SideNav: SideNav, WorklistTable: WorklistTable, PatientTile: PatientTile, ReferenceChart: ReferenceChart,
    TicketTimeline: TicketTimeline, WorklistCard: WorklistCard, PushBanner: PushBanner, RolePicker: RolePicker, Viewfinder: Viewfinder,
    SittingTimer: SittingTimer, CaptureStatus: CaptureStatus, SittingSummary: SittingSummary, ConsentSheet: ConsentSheet
  });
})();
