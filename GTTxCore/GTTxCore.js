// ᝯㄝₓ Core - the shared half of the ᝯㄝₓ plugins.
//
// Every other plugin in this repo used to carry its own copy of the blocks below: the
// hover card, the tag tooltip, the custom-field mark, the Reload UI button, the button
// placement and ordering rules, the lease protocol's shared object, the one
// MutationObserver. Byte-identity across eight files was pinned by a test and copied by
// hand, and the copies still could not be proved *runnable* - one of them spelled a
// helper differently and threw a ReferenceError that no fixture reached.
//
// So they live here once, and the others bind them at load. Stash makes that safe:
// `ui: requires:` in a plugin's `.yml` is topologically sorted by `plugins.tsx`, and
// `useScript` sets `script.async = false`, so this script has finished running before
// any plugin that names it begins. See "Reference: a UI plugin can depend on another"
// in the repo-root AGENTS.md.
//
// It also carries the features that belong to no single plugin: the Scene Tagger's
// duration mismatch, and the developer switches.
(function () {
  'use strict';

  var PLUGIN_ID = 'GTTxCore';
  var PLUGIN_NAME = 'ᝯㄝₓ Core';
  var PLUGIN_SHORT_NAME = 'ᝯㄝₓ Core';
  var PLUGIN_VERSION = '5.1.1';
  var README_URL = 'https://github.com/gregttx/GTTxStashPluginsRelease/blob/main/GTTxCore/README.md';
  var README_LINK_ID = 'gttxcore-readme-link';
  var DESC_TOGGLE_ID = 'gttxcore-desc-toggle';
  var STALE_ID = 'gttxcore-stale-notice';
  var STYLE_ID = 'gttxcore-style';
  var SETTINGS_TTL_MS = 10000;
  var OBSERVE_MS = 100;
  var TICK_MS = 1000;

  function log(msg) { if (window.console && console.info) console.info(msg); }
  log('[gttxcore] GTTxCore.js ' + PLUGIN_VERSION + ' loaded. This is the running ' +
    "script's own version - the settings page reads the manifest instead, which can be " +
    'newer than the script your browser has cached.');

  // ── Installed once, replaceable by a newer evaluation ─────────────────────
  //
  // A second evaluation of this script into one page is not something Stash's Reload
  // plugins does - measured, and recorded in the repo-root AGENTS.md - but the suites do
  // it on purpose, and a library that latched would leave every caller bound to the
  // previous release's closures while the console reported the new version. So the newest
  // evaluation always wins: it overwrites the export, and the older one stops here rather
  // than registering a second observer and a second timer.
  var ns = window.__GTTx__;
  if (!ns || typeof ns !== 'object') ns = window.__GTTx__ = {};
  var _previous = ns.core;

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  // "3 scenes", "1 scene" - the count is always known where it is printed, so the "(s)"
  // these plugins used to write everywhere was never carrying information. An irregular
  // plural passes its own; everything else takes an "s".
  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  // A "name contains" setting is a list of substrings, and a tag is excluded when its
  // name contains any one of them. Whitespace separates them by default, which costs
  // the ability to write a substring containing a space; `sep` buys it back by
  // separating on something the user's tag names never contain instead.
  //
  // Split on a *string*, never a RegExp: `.` and `|` are plausible separators and
  // would otherwise have to be escaped by the user. Each term is trimmed, so a list
  // written as "a, b" does not carry a leading space into the match, and empty terms
  // are dropped - a setting of nothing but separators must leave an empty list, never
  // a term matching every tag in the library.
  function splitTerms(value, sep) {
    var raw = String(value == null ? '' : value);
    var out = [];
    (sep ? raw.split(sep) : raw.split(/\s+/)).forEach(function (term) {
      var t = term.trim();
      if (t) out.push(t);
    });
    return out;
  }

  // The term the name contains, or null - a term rather than a boolean so a log can
  // say which one did it.
  function nameMatchesAny(name, terms) {
    for (var i = 0; i < terms.length; i++) {
      if (name.indexOf(terms[i]) !== -1) return terms[i];
    }
    return null;
  }

  // "..." is what a *caption* promises; a title quotes the caption inside a sentence,
  // where trailing dots are punctuation in the middle of one. Three plugins wanted this
  // one line, which is the whole rule for what lives here.

  // ── Picking the form control a staged change goes into ────────────────────
  //
  // `TagSelect` and `PerformerSelect` are used all over Stash, so a plugin that stages
  // into one has to pick the capture belonging to the form in front of the user. Two
  // requirements pull against each other, and each was a live bug when the other was
  // solved alone:
  //
  //  - **Newest alone picks the wrong control.** A second multi-select rendered after the
  //    edit form wins, and the staged tags go into someone else's box - which is the worse
  //    of the two failures, because it writes somewhere the user was not looking.
  //  - **Matching the expected contents alone goes stale.** Staging mutates the capture's
  //    own `values`, so the capture we wrote to keeps matching for ever; the moment the
  //    user edits the box by hand the plugin diffs against a list the form no longer
  //    holds and reports nothing to do.
  //
  // One rule covers both, and it is shorter than either: **newest first, skipping any
  // capture that shares nothing with what the form is expected to hold.** Recency decides,
  // and the contents are used only to recognise a stranger. A hand edit leaves an overlap
  // and is followed; a decoy shares nothing and is skipped; a second click with no
  // re-render in between finds the capture we mutated, which overlaps itself.
  //
  // **Preferring an exact match is the trap**, and it is the one both siblings were in: the
  // capture we staged into matches exactly for ever, so it beats the newer capture that
  // actually reflects the user's edit. The remaining gap is a hand edit that empties the
  // box completely, where there is nothing left to recognise - and no rule without a real
  // discriminator can do better than the newest of ours.
  //
  // `isMine(capture)` is the caller's own test for "this page's control", since each keys
  // its captures differently.
  function pickControl(captures, isMine, expectedIds) {
    var want = {};
    var any = false;
    (expectedIds || []).forEach(function (id) { want[String(id)] = true; any = true; });
    var newest = null;
    for (var i = captures.length - 1; i >= 0; i--) {
      var c = captures[i];
      if (!isMine(c)) continue;
      if (!newest) newest = c;
      if (!any) return c;
      var ids = (c.values || []).map(function (t) { return String(t.id); });
      for (var k = 0; k < ids.length; k++) {
        if (want[ids[k]]) return c;
      }
    }
    return newest;
  }

  function stripEllipsis(label) {
    return String(label).replace(/\.+$/, '');
  }

  function hasClass(node, name) {
    return (' ' + String((node && node.className) || '') + ' ').indexOf(' ' + name + ' ') !== -1;
  }

  // `cls` taken off `node`, and put back on where `on`; the node's other classes are left as
  // they are. Not `classList`: the suites' fake DOM has none.
  function toggleClass(node, cls, on) {
    var c = String(node.className || '').replace(new RegExp('\\s*\\b' + cls + '\\b', 'g'), '');
    node.className = (on ? c + ' ' + cls : c).replace(/^\s+/, '');
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function byClass(root, name) {
    if (!root || typeof root.querySelector !== 'function') return null;
    try { return root.querySelector('.' + name) || null; } catch (e) { return null; }
  }

  // The user's own browser session is the credential; no token is needed.
  function gqlRequest(query, variables) {
    return fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, variables: variables }),
    })
      .then(function (resp) { return resp.json(); })
      .then(function (json) {
        if (json.errors) throw new Error(json.errors.map(function (e) { return e.message; }).join('; '));
        return json.data;
      });
  }

  // **The plugin id is a parameter here where it was a constant in every copy.** These
  // two find a *caller's* settings row, not this plugin's, so the one thing that made the
  // block plugin-specific becomes the one thing the caller passes.
  function settingElement(pluginId, key) {
    return document.getElementById('plugin-' + pluginId + '-' + key);
  }

  function settingRow(pluginId, key) {
    var node = settingElement(pluginId, key);
    for (var d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting')) return node;
    }
    return null;
  }


  // The plugins' shared state, under the one global this repo takes. Never read off or written
  // to a bare `window.StashPluginCoop`: that name is anybody's, and adopting an object found
  // there would hand a stranger our leases.
  function coopObject() {
    var ns = window.__GTTx__;
    if (!ns || typeof ns !== 'object') ns = window.__GTTx__ = {};
    var c = ns.StashPluginCoop;
    if (!c || typeof c !== 'object') c = ns.StashPluginCoop = {};
    return c;
  }

  // **Every field, not the subset one caller happens to use.** The plugins each brought
  // the object into a slightly different shape - `order` in the three that place buttons,
  // `api` in the two that publish one - and whichever loaded first decided which fields
  // the next one found. One owner means one shape.
  function coop() {
    var c = coopObject();
    if (!c.leases) c.leases = [];          // [{ owner, label, until }]
    if (!c.respecters) c.respecters = {};  // { pluginId: true }
    if (!c.declares) c.declares = {};      // { pluginId: [pathId, ...] }
    if (!c.order) c.order = {};            // { pluginId: priority }
    if (!c.api) c.api = {};                // { pluginId: <what it answers for others> }
    if (!c.staleUI) c.staleUI = {};        // { pluginId: true } - and the Dev Mods demo
    if (!c.settling) c.settling = {};      // { 'type:id': [{ promise, done }] } - see `settle`
    if (!c.waiting) c.waiting = {};        // { 'type:id': [{ owner, until }] } - see `settled`
    return c;
  }

  // ── A save settles: reactions say so, and a watcher of the same save waits ──
  //
  // Two plugins can answer one save of one entity: one reacts to it by writing more
  // onto the entity, another reads what the save changed and offers to copy it
  // elsewhere. The second cannot see the first's write - it comes later, under a
  // lease, as a bulk mutation - so it offered the save's own changes and nothing a
  // sibling added. `settle(type, id)` is a reacting plugin saying "I am about to act
  // on this entity", registered synchronously in its fetch wrapper the moment it sees
  // the save, and returns the release to call when the reaction is over - written,
  // cancelled or failed. `settled(type, ids, timeoutMs)` is the watcher waiting for
  // every registration on those ids before it reads the entity again; it resolves
  // true when they all released and false on the timeout, and at once when nothing
  // registered. A reaction that asks the user first holds its registration through
  // the question, which is the point: the watcher's offer comes after the answer.
  // `who`, where given, names the reaction, so a watcher that reacts too can wait for everyone but
  // itself (`settled`'s `owner`).
  function settle(type, id, who) {
    var c = coop(), key = type + ':' + id;
    var entry = { who: who || '' };
    entry.promise = new Promise(function (res) { entry.done = res; });
    (c.settling[key] = c.settling[key] || []).push(entry);
    var released = false;
    return function () {
      if (released) return;
      released = true;
      var list = c.settling[key] || [];
      var i = list.indexOf(entry);
      if (i !== -1) list.splice(i, 1);
      if (!list.length) delete c.settling[key];
      entry.done();
    };
  }

  function settled(type, ids, timeoutMs, owner) {
    var c = coop(), waits = [], keys = [];
    (ids || []).forEach(function (id) {
      var key = type + ':' + id;
      var list = (c.settling[key] || []).filter(function (e) { return !owner || !e.who || e.who !== owner; });
      list.forEach(function (e) { waits.push(e.promise); });
      if (list.length) keys.push(key);
    });
    if (!waits.length) return Promise.resolve(true);
    // Who waits, and until when, on `coop().waiting` under the same keys - so the
    // reaction holding the save can say so in its dialog, and say when the wait ran out.
    var ms = timeoutMs || 30000;
    var w = { owner: owner || '', until: Date.now() + ms };
    keys.forEach(function (k) { (c.waiting[k] = c.waiting[k] || []).push(w); });
    function forget() {
      keys.forEach(function (k) {
        var l = c.waiting[k] || [], i = l.indexOf(w);
        if (i !== -1) l.splice(i, 1);
        if (!l.length) delete c.waiting[k];
      });
    }
    return new Promise(function (res) {
      var t = setTimeout(function () { forget(); res(false); }, ms);
      Promise.all(waits).then(function () { clearTimeout(t); forget(); res(true); });
    });
  }

  // The waiter with the least time left on any of these ids, `{ owner, until }`, or null.
  function waitingOn(type, ids) {
    var c = coop(), best = null;
    (ids || []).forEach(function (id) {
      (c.waiting[type + ':' + id] || []).forEach(function (w) {
        if (!best || w.until < best.until) best = w;
      });
    });
    return best;
  }

  // **The two-argument shape, which is what seven of the eight callers used.**
  // `NormalizeParentTags` passed a button and two captions and did the flash in here; the
  // rest passed a callback and did their own, which is the one that composes - a caller
  // that wants to say something other than "Copied" can, and a caller with no button at
  // all still works.
  //
  // Stash is commonly served over plain HTTP on a LAN, where the async clipboard API does
  // not exist at all, so the textarea fallback is what makes this work for the users most
  // likely to press the button.
  // ── A run's log, bounded ──────────────────────────────────────────────────
  //
  // The log a run keeps is for Copy log, so it grows with the run rather than with the
  // screen: every dialog here renders only its last thousand lines and held all of
  // them. A library-wide pass can write millions - one Normalize Parent Tags run over
  // 100,000 scenes and 1,000,000 images kept 9.8 million, gigabytes of strings, next to
  // a plan that was already the largest thing in the page.
  //
  // So the array is bounded and says what it dropped, which the copy then says too. The
  // oldest tenth goes at once rather than a line per line, so a run pays for the trim
  // once every `cap / 10` lines instead of on every one of them.
  var LOG_KEEP = 200000;
  var LOG_KEEP_MIN = 1000;
  var LOG_KEEP_MAX = 5000000;

  // The setting, when it has been read and is a number in range; the default until then.
  // Read off the cache rather than awaited: this is called once per line written, and a
  // cap that starts at the default and moves on the next settings read is what a caller
  // can afford.
  function logKeep() {
    var n = parseInt(settings().a5LogLinesKept, 10);
    if (isNaN(n)) return LOG_KEEP;
    return Math.max(LOG_KEEP_MIN, Math.min(LOG_KEEP_MAX, n));
  }

  function keepLog(lines, cap) {
    var max = cap || logKeep();
    if (lines.length <= max) return 0;
    var drop = Math.max(1, Math.round(max / 10));
    lines.splice(0, drop);
    return drop;
  }

  // The line a copy opens with when the oldest lines are gone, or ''.
  function droppedLine(dropped, kind) {
    if (!dropped) return '';
    return '[' + (kind || 'INFO') + '] The first ' + dropped + ' lines of this log were dropped to keep it ' +
      'within ᝯㄝₓ Core\'s Maximum Log Lines Kept, so this copy begins after them.';
  }

  function copyToClipboard(text, done) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        if (ta.select) ta.select();
        var ok = document.execCommand ? document.execCommand('copy') : false;
        document.body.removeChild(ta);
        return ok;
      } catch (e) {
        return false;
      }
    }
    var nav = window.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      nav.clipboard.writeText(text).then(function () { done(true); },
        function () { done(fallback()); });
      return;
    }
    done(fallback());
  }


  // **A button keeps its size through a temporary caption.** "Copied" is narrower than
  // "Copy log" and "Working…" wider than "Add Tags", and either moves every button after
  // it in the row for as long as the caption stays - under a pointer that has just
  // clicked there, with Delete two buttons along. Called before the caption changes, it
  // pins `min-width` to the laid-out width, once; a zero width is a button not laid out
  // yet and is not pinned. A caption longer than the label still grows the button, so a
  // caller keeps those short - a sign and a count, one word.
  // **Custom Fields Bulk Editor's Locked Custom Fields list**, asked for every plugin that
  // writes a custom field. A lock means a field's name, description, presence and value
  // cannot change; adding it where an entity has none is allowed. Resolves to that
  // plugin's worker `{ names, isLocked(name) }`, to null where nothing publishes one -
  // nothing is locked, and a caller says so - or to false where the publisher is there and
  // could not answer, which a caller treats as every custom field locked: a lock that
  // could not be read is not one to guess past. The rule stays with its owner; this is
  // only the asking.
  function fieldLocks() {
    var api = coop().api && coop().api.CustomFieldsBulkEditor;
    if (!api || typeof api.locks !== 'function') return Promise.resolve(null);
    return Promise.resolve().then(function () { return api.locks(); })
      .then(function (w) { return w && typeof w.isLocked === 'function' ? w : false; },
        function () { return false; });
  }

  function holdWidth(btn) {
    if (btn && btn.style && !btn.style.minWidth && btn.offsetWidth > 0) {
      btn.style.minWidth = btn.offsetWidth + 'px';
    }
  }

  function domBus() {
    var ns = window.__GTTx__;
    if (!ns || typeof ns !== 'object') ns = window.__GTTx__ = {};
    var bus = ns.domBus;
    if (bus && typeof bus.subscribe === 'function') return bus;
    bus = ns.domBus = { subs: [], observing: false };
    bus.notify = function () {
      for (var i = 0; i < bus.subs.length; i++) {
        try { bus.subs[i](); } catch (e) { /* one subscriber must not silence the rest */ }
      }
    };
    bus.subscribe = function (fn) {
      if (bus.subs.indexOf(fn) === -1) bus.subs.push(fn);
      if (bus.observing || typeof MutationObserver !== 'function') return bus.observing;
      var root = document.getElementById('root') || document.body || document.documentElement;
      if (!root) return false;
      try {
        new MutationObserver(bus.notify).observe(root, { childList: true, subtree: true });
        bus.observing = true;
      } catch (e) {
        bus.observing = false;
      }
      return bus.observing;
    };
    return bus;
  }

  var TIP_BOX_ID = 'gttx-tipbox';
  var _tagTipImages = {};        // tag id -> Promise of a usable image url, or null

  function tagTipImage(id) {
    if (hasOwn(_tagTipImages, id)) return _tagTipImages[id];
    _tagTipImages[id] = gqlRequest(
      'query GTTxTagImage($id: ID!) { findTag(id: $id) { id image_path } }', { id: String(id) }
    ).then(function (d) {
      var p = ((d || {}).findTag || {}).image_path;
      // Stash answers for a tag with no image of its own as well - with a placeholder,
      // marked `default=true` on the url its own builder writes. The same generic icon on
      // every tooltip in the library is noise, so that answer counts as no image.
      return p && !/[?&]default=true/.test(String(p)) ? String(p) : null;
    }, function () { return null; });      // a picture is not worth an error
    return _tagTipImages[id];
  }

  // The number a rating banner shows: the 5-star value `rating100` holds, with one
  // decimal where the rating has one.
  function tipRatingBadge(r) {
    if (r == null) return null;
    return '\u2605 ' + (Math.round(r / 2) / 10);
  }

  // One box for the page, not one per node: a log renders thousands of lines, and a
  // hidden box on each of them is the page-that-stops-responding the render cap exists to
  // prevent. Shared with any sibling drawing the same box, which is what the unprefixed
  // id says - and one built by a copy too old to hold an image is replaced rather than
  // reused, since what tells them apart is what is inside them.
  function tipBox() {
    var box = document.getElementById(TIP_BOX_ID);
    if (box && (!box._gttxImg || !box._gttxRate) && box.parentNode) { box.parentNode.removeChild(box); box = null; }
    if (!box) {
      box = el('div', 'gttx-tipbox');
      box.id = TIP_BOX_ID;
      box._gttxImg = el('img');
      box._gttxText = el('div');
      box.appendChild(box._gttxImg);
      box.appendChild(box._gttxText);
      // The rating banner and the organized mark, laid over the picture's top corners.
      // The box itself is `position:fixed`, so it is already the containing block -
      // no wrapper, which is what keeps the img the box's first child for everything
      // that reads one back. Shown only over a picture; the text lines carry both
      // facts for a card without one.
      box._gttxRate = el('span', 'gttx-tip-rating');
      box._gttxOrg = el('span', 'gttx-tip-organized', '\ud83d\udce6');
      box.appendChild(box._gttxRate);
      box.appendChild(box._gttxOrg);
      (document.body || document.documentElement).appendChild(box);
    }
    return box;
  }

  // Beside the node, flipped above it where there is no room below and clamped onto the
  // page either way - the same arithmetic every fixed box in this repo uses. Measured
  // after the box is shown, since a `display:none` box has no size, and again when the
  // image lands, since until then the box is the height of its text alone.
  function tipPlace(node) {
    var box = tipBox();
    if (!node.getBoundingClientRect || !box.getBoundingClientRect) return;
    var a = node.getBoundingClientRect();
    var b = box.getBoundingClientRect();
    var vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
    var top = a.bottom + 6;
    if (top + b.height > vh - 8) top = Math.max(8, a.top - b.height - 6);
    box.style.top = top + 'px';
    box.style.left = Math.min(Math.max(8, a.left), Math.max(8, vw - b.width - 8)) + 'px';
  }

  // Fills the shared box and puts it beside the node. `img` may be null - a card with no
  // picture is still the answer to "which one is that", and only `tagTip` treats an
  // absent picture as a reason not to open at all.
  function tipOpen(node, text, img, extra) {
    var box = tipBox();
    box._gttxFor = node;
    var rate = tipRatingBadge((extra || {}).rating100);
    box._gttxRate.textContent = rate || '';
    box._gttxRate.style.display = img && rate ? '' : 'none';
    box._gttxOrg.style.display = img && (extra || {}).organized ? '' : 'none';
    // Last child of the body, every time. The box outlives the dialog it was first
    // opened over, and a backdrop appended after it paints above it wherever the two
    // carry the same z-index - which is how a tooltip could work once per page and
    // never again, the dialog having been closed and reopened in between. The z-index
    // above every modal here is the real fix; this is what makes it not depend on one.
    var host = document.body || document.documentElement;
    if (host && box.parentNode !== host) host.appendChild(box);
    else if (host && host.lastChild !== box) host.appendChild(box);
    box._gttxText.textContent = text;
    box._gttxImg.style.display = img ? '' : 'none';
    if (img) {
      // Placed again when the picture lands, since until then the box is the height of
      // its text alone - one measurement puts it in the wrong place exactly when it has
      // a picture in it. A picture that fails to load is taken back out rather than left
      // as a broken frame: a scene with no generated screenshot answers with a url that
      // does not resolve.
      box._gttxImg.onload = function () { if (box._gttxFor === node) tipPlace(node); };
      box._gttxImg.onerror = function () {
        box._gttxImg.style.display = 'none';
        box._gttxRate.style.display = 'none';
        box._gttxOrg.style.display = 'none';
        if (box._gttxFor === node) tipPlace(node);
      };
      box._gttxImg.src = img;
    }
    box.className = 'gttx-tipbox gttx-tip-open';
    tipPlace(node);
  }

  function tipClose() {
    var box = document.getElementById(TIP_BOX_ID);
    if (box) box.className = 'gttx-tipbox';
  }

  // `text` is the tooltip the node would otherwise carry, and it is passed in rather than
  // read back off the `title` because the ticks that draw these nodes re-assign it every
  // second: a block reading the node would be handed the browser's own tooltip back, on
  // top of the open box, one tick after opening it. So the text lives here, and the
  // `title` carries it for exactly as long as the box does not.
  // Hover and keyboard focus open the same thing, and leaving either closes it.
  function hoverFocus(n, on, off) {
    n.addEventListener('mouseenter', on);
    n.addEventListener('mouseleave', off);
    n.addEventListener('focus', on);
    n.addEventListener('blur', off);
  }

  function tagTip(node, id, text) {
    if (!node || !id || !text || !node.addEventListener) return;
    node._gttxTagTipText = text;
    if (!node._gttxTagTipOn) node.title = text;
    if (node._gttxTagTip) return;
    node._gttxTagTip = true;
    var open = function () {
      node._gttxTagTipOn = true;
      // A stale answer arriving after the pointer has moved on must not open the box,
      // which is the same guard the propagate dialog's hover card keeps.
      tagTipImage(id).then(function (src) {
        if (!src || !node._gttxTagTipOn) return;
        node.title = '';
        tipOpen(node, node._gttxTagTipText, src);
      });
    };
    var shut = function () {
      node._gttxTagTipOn = false;
      node.title = node._gttxTagTipText;
      tipClose();
    };
    hoverFocus(node, open, shut);
  }


  // ── Glossary tooltips ─────────────────────────────────────────────────────
  //
  // An uncommon term gets a dotted underline and the shared tip box with its meaning, once
  // per scope: each ᝯㄝₓ group on Settings → Plugins and Settings → Tasks, and the head of
  // each ᝯㄝₓ dialog. The dialogs need nothing of their own - they all build the same
  // `<prefix>-modal` / `<prefix>-head` chrome, so the tick finds them the way it finds the
  // settings groups. Only where the word carries the glossary's meaning: a dashed compound
  // matches anywhere, a single word only inside a phrase GLOSSARY.src.yml lists for it, and
  // never inside a plugin's name - "Normalize Parent Tags" is not about a parent. Opens on
  // hover, focus and tap; a second tap, or a tap anywhere else, closes it.
  //
  // `glossaryFind` is the whole matcher and holds no DOM, so `.tools/build.js` loads this
  // file and runs the same function over the READMEs: one set of rules for every place a
  // tooltip is drawn.
  //
  // The terms are not in this file. `glossary.gen.js`, generated from GLOSSARY.src.yml, puts
  // them on `window.__GTTx__.glossary` and does nothing else, and this reads them when it
  // first needs them - so neither file cares which of the two Stash runs first. A table in
  // a format this copy does not know, which is a browser holding one of the two files from
  // an older release, draws no tooltips rather than wrong ones.
  var GLOSSARY_FORMAT = 1;


  var GLOSS_CLASS = 'gttx-gloss';
  var GLOSS_PREFIXES = ['gttxcore', 'npt', 'cpt2s', 'ptp2re', 'cfbe', 'enm', 'fretc', 'sfm', 'svr', 'tbc', 'dsp'];
  var GLOSS_SKIP_TAGS = /^(A|BUTTON|INPUT|TEXTAREA|SELECT|OPTION|LABEL|H1|H2|H3|H4|H5|H6|CODE|PRE|SCRIPT|STYLE)$/;
  // The setting row's hover box and its ⓘ mark, a dialog's title and log, and a mark
  // already drawn. `-tip` is matched whole, so a row's `-tipped` summary is still read.
  var GLOSS_SKIP_CLASS = /(^|\s)(gttx-gloss|[a-z0-9]+-(tipbox|tip|title|log))(\s|$)/;
  var _gloss = null, _glossFrom = null;

  // The compiled table, or null while there is none this copy can read. Compiled again
  // only when a different table arrives.
  function glossaryCompiled() {
    var data = (window.__GTTx__ || {}).glossary;
    if (!data || data.format !== GLOSSARY_FORMAT || !data.terms || !data.names) return null;
    if (_gloss && _glossFrom === data) return _gloss;
    _glossFrom = data;
    // A name broken across two lines of a README is still the name.
    var names = data.names.map(function (n) { return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'); });
    _gloss = {
      // Case-sensitive: "Propagate" is the plugin, "propagate" the term.
      names: names.length ? new RegExp(names.join('|'), 'g') : null,
      terms: data.terms.map(function (t) {
        return {
          id: t.id, tip: t.tip, res: t.re.map(function (src) { return new RegExp(src, 'i'); }),
          not: (t.not || []).map(function (src) { return new RegExp(src, 'gi'); }),
        };
      }),
    };
    return _gloss;
  }

  // The earliest place in `text` where a term not yet in `used` carries its meaning:
  // `{ id, tip, start, end }`, or null. Plugin names are blanked first, same length, so
  // what is found still indexes the text as given.
  function glossaryFind(text, used) {
    var g = glossaryCompiled();
    if (!g) return null;
    var t = String(text == null ? '' : text);
    if (g.names) t = t.replace(g.names, function (m) { return new Array(m.length + 1).join('\u0001'); });
    var best = null;
    var blank = function (m) { return new Array(m.length + 1).join('\u0001'); };
    g.terms.forEach(function (term) {
      if (used && used[term.id]) return;
      var tt = t;
      term.not.forEach(function (re) { tt = tt.replace(re, blank); });
      term.res.forEach(function (re) {
        var m = re.exec(tt);
        if (!m) return;
        var start = m.index + m[1].length + m[2].length;
        if (!best || start < best.start) best = { id: term.id, tip: term.tip, start: start, end: start + m[3].length };
      });
    });
    return best;
  }

  function glossarySkip(node) {
    return !!node && node.nodeType !== 3 &&
      (GLOSS_SKIP_TAGS.test(String(node.tagName || '')) || GLOSS_SKIP_CLASS.test(String(node.className || '')));
  }

  function glossaryOpen(mark) {
    tipOpen(mark, mark._gttxGlossTip, null);
  }

  function glossaryIsOpen(mark) {
    var box = document.getElementById(TIP_BOX_ID);
    return !!box && box._gttxFor === mark && hasClass(box, 'gttx-tip-open');
  }

  function glossaryNode(hit, word) {
    var mark = el('span', GLOSS_CLASS, word);
    mark.setAttribute('data-gloss', hit.id);
    mark._gttxGlossTip = hit.tip;
    mark.tabIndex = 0;
    hoverFocus(mark, function () { glossaryOpen(mark); }, tipClose);
    // A tap: no hover on a touch screen, so the tap is what opens it - and it goes no
    // further, since the term can sit inside a row whose own click does something.
    mark.addEventListener('click', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      if (glossaryIsOpen(mark)) tipClose(); else glossaryOpen(mark);
    });
    return mark;
  }

  // One text node: every term still unused in the scope, earliest first, each split out
  // into a mark with the text either side left as text nodes.
  function glossaryMarkText(node, used) {
    var n = 0;
    while (node && node.parentNode) {
      var text = node.textContent || '';
      var hit = glossaryFind(text, used);
      if (!hit) break;
      var parent = node.parentNode;
      var after = document.createTextNode(text.slice(hit.end));
      parent.insertBefore(document.createTextNode(text.slice(0, hit.start)), node);
      parent.insertBefore(glossaryNode(hit, text.slice(hit.start, hit.end)), node);
      parent.insertBefore(after, node);
      parent.removeChild(node);
      used[hit.id] = true;
      n++;
      node = after;
    }
    return n;
  }

  function glossaryMarkNode(node, used) {
    if (!node || glossarySkip(node)) return 0;
    if (node.nodeType === 3) return glossaryMarkText(node, used);
    var kids = node.childNodes || [];
    // An element holding only text and no nodes - the text lives on the element itself
    // rather than in a child - is given a text node of its own first.
    if (!kids.length) {
      var own = node.textContent || '';
      if (!own || !glossaryFind(own, used)) return 0;       // nothing to mark: left as it is
      node.textContent = '';
      return glossaryMarkText(node.appendChild(document.createTextNode(own)), used);
    }
    var list = [];
    for (var i = 0; i < kids.length; i++) list.push(kids[i]);
    var n = 0;
    for (var j = 0; j < list.length; j++) n += glossaryMarkNode(list[j], used);
    return n;
  }

  function glossaryUsed(node, used) {
    if (!node || node.nodeType === 3) return used;
    if (hasClass(node, GLOSS_CLASS) && node.getAttribute) used[node.getAttribute('data-gloss')] = true;
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) glossaryUsed(kids[i], used);
    return used;
  }

  // One scope: what is already marked in it counts as used, so a term is marked once
  // however many ticks pass. A root whose text has not changed since it was last read is
  // not read again - the matcher over every description, every second, is the cost this
  // avoids - and one that was re-rendered is, which is how a mark comes back after a
  // description is redrawn.
  function glossaryMark(scope, roots) {
    if (!scope || !glossaryCompiled()) return 0;
    var used = glossaryUsed(scope, {});
    var n = 0;
    for (var i = 0; roots && i < roots.length; i++) {
      var root = roots[i];
      var text = root && root.textContent;
      if (!root || root._gttxGlossRead === text) continue;
      n += glossaryMarkNode(root, used);
      root._gttxGlossRead = root.textContent;
    }
    return n;
  }

  function glossaryTick() {
    if (!document.querySelectorAll || !glossaryCompiled()) return;
    var prefix = PLUGIN_NAME.split(' ')[0];
    var groups = document.querySelectorAll('.setting-group');
    for (var i = 0; i < groups.length; i++) {
      var h3 = groups[i].querySelector ? groups[i].querySelector('h3') : null;
      var name = String(h3 ? h3.textContent : '').replace(/^\s+/, '');
      if (name.indexOf(prefix) === 0) glossaryMark(groups[i], groups[i].querySelectorAll('.sub-heading'));
    }
    GLOSS_PREFIXES.forEach(function (p) {
      var modals = document.querySelectorAll('.' + p + '-modal');
      for (var j = 0; j < modals.length; j++) glossaryMark(modals[j], modals[j].querySelectorAll('.' + p + '-head'));
    });
  }

  // A tap anywhere but the term closes a glossary tip it opened; any other tip is left.
  function glossaryOutsideTap(e) {
    var box = document.getElementById(TIP_BOX_ID);
    if (box && box._gttxFor && hasClass(box._gttxFor, GLOSS_CLASS) && e && e.target !== box._gttxFor) tipClose();
  }

  // ── The tooltip a resolved tag's link carries ─────────────────────────────
  //
  // The link answers "does this name anything at all"; the tooltip answers "is it the one
  // you meant", which a name alone cannot settle in a library holding three tags called
  // something similar. So it says what the tag *is*: its aliases, where it sits in the
  // hierarchy, and what it says about itself.
  //
  // Two caps, for the same reason the dialogs' own tag tooltips have them. A native
  // `title` is the browser's - no scrollbar, nowhere to put an overflow - so a tag with
  // forty children would push the description off the bottom of the screen.
  //
  // `note` is the caller's own second line, and it is what keeps this identical in four
  // plugins that have different things to say there: which alias matched, that several
  // tags answer to the name, or that this one is found by a mark rather than by the name
  // in the box. Keep this and `tipText`/`tagTipNames` byte-identical across the
  // plugins, like the CSS; `.tests/style.test.js` pins them.
  // Shared by the tag tooltip and the custom-field mark: both are about a native
  // `title`, which is why neither this nor `tipText` wears a `tag` in its name.
  var TIP_DESC_CHARS = 240;   // characters of a description an excerpt carries
  var TAG_TIP_NAMES = 8;      // names listed before the rest become a count

  function tipText(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  }

  function tagTipNames(list) {
    var names = [];
    for (var i = 0; list && i < list.length; i++) {
      var n = tipText(list[i] && list[i].name != null ? list[i].name : list[i]);
      if (n) names.push(n);
    }
    if (names.length <= TAG_TIP_NAMES) return names.join(', ');
    return names.slice(0, TAG_TIP_NAMES).join(', ') + ', +' +
      plural(names.length - TAG_TIP_NAMES, 'more', 'more');
  }

  function tagLinkTitle(tag, note) {
    var lines = ['Tag "' + tipText(tag.name) + '" (' + tag.id + ')'];
    if (note) lines.push(note);
    var aliases = tagTipNames(tag.aliases);
    if (aliases) lines.push('Aliases: ' + aliases);
    var parents = tagTipNames(tag.parents);
    if (parents) lines.push('Parents: ' + parents);
    var kids = tagTipNames(tag.children);
    if (kids) lines.push('Children: ' + kids);
    var desc = tipText(tag.description);
    if (desc) {
      lines.push('Description: ' +
        (desc.length > TIP_DESC_CHARS ? desc.slice(0, TIP_DESC_CHARS) + '…' : desc));
    }
    lines.push(linkTarget() ? 'Click to open it in a new tab.' : 'Click to open it.');
    return lines.join('\n');
  }

  // ── A tag named in a run's log ────────────────────────────────────────────
  //
  // The tooltip on a tag a run dialog's recap or a tree row names: what a name and an id
  // cannot say - the aliases and description that tell two similarly named tags apart.
  // Unlike `tagLinkTitle` it opens with the name and id, since a tree row cuts a long
  // name off, and it caps the alias list by width as well as by count.
  var TIP_ALIASES = 8;        // aliases named in a tooltip before the rest are a count
  var TIP_ALIAS_CHARS = 120;  // and the width that can cut the list shorter still

  // Cut on the last space before the limit so a word is never sliced in half - unless
  // the only space is near the start, where honouring it would throw most of the
  // excerpt away and say less than the blunt cut would.
  function excerpt(text, max) {
    var s = tipText(text);
    if (s.length <= max) return s;
    var cut = s.slice(0, max);
    var space = cut.lastIndexOf(' ');
    if (space > max * 0.6) cut = cut.slice(0, space);
    return cut.replace(/[\s,;:.\-]+$/, '') + '…';
  }

  function aliasList(t) {
    return (((t && t.aliases) || []).map(tipText)).filter(function (a) { return !!a; });
  }

  // Whether a tag has anything to say beyond its name and id. A recap's spans already
  // carry both, so a tooltip there would open on a hover and repeat the line underneath
  // it - and since nothing marks which tags have one, every hover that does open had
  // better say something new.
  function tagHasDetail(t) {
    return !!(aliasList(t).length || tipText(t && t.description));
  }

  // Both lists are capped rather than rendered whole, and the tail is counted rather than
  // dropped, so a truncated list still says there is more. `unnamed` is what a tag with
  // no name is called: each caller keeps the word its own log uses.
  function tagTooltip(t, id, unnamed) {
    var lines = [tipText((t && t.name) || unnamed), 'tag id ' + id];

    var aliases = aliasList(t);
    if (aliases.length) {
      var shown = [], used = 0;
      for (var i = 0; i < aliases.length; i++) {
        // The first alias is always named, excerpted if it has to be: "and 3 more"
        // on its own would leave the tooltip listing nothing at all.
        if (shown.length && (shown.length >= TIP_ALIASES || used + aliases[i].length > TIP_ALIAS_CHARS)) break;
        shown.push(shown.length ? aliases[i] : excerpt(aliases[i], TIP_ALIAS_CHARS));
        used += aliases[i].length + 2;
      }
      var rest = aliases.length - shown.length;
      lines.push('Aliases: ' + shown.join(', ') + (rest > 0 ? ', and ' + rest + ' more' : ''));
    }

    var desc = tipText(t && t.description);
    if (desc) lines.push('Description: ' + excerpt(desc, TIP_DESC_CHARS));
    return lines.join('\n');
  }

  // Compare ids as numbers where both parse, so 9 sorts below 10, and fall back to a
  // string compare so the order is total whatever Stash hands over.
  function lowerId(a, b) {
    var na = parseInt(a, 10), nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na < nb;
    return String(a) < String(b);
  }

  // A log line built as parts, as the plain text Copy log hands over.
  function partsText(parts) {
    return parts.map(function (p) { return p.text; }).join('');
  }

  // ── The card an entity's name opens ───────────────────────────────────────
  //
  // A listing here names entities the user has not opened - a scene by its title, a
  // performer by name, an id in brackets - and "which one is that" is the question a tag
  // tooltip already answers, asked about the rest of the library. For a scene or a
  // performer the picture is more of the answer than any field on the card.
  //
  // One entry point: `entityTip(node, type, id)` fetches on hover, fills the shared box
  // with the entity's image above a few lines about it, and hands the node its own
  // `title` back on the way out. **A tag gets exactly the tooltip every other plugin here
  // draws for one** - `tagLinkTitle` builds it - so there is one answer in this repo to
  // "what is this tag" rather than a second one that drifts.
  //
  // It opens with no picture where there is none, which is where it differs from
  // `tagTip`: that one is decorating a `title` the caller already wrote, so a tag with no
  // image has nothing to add and is left alone. Here the text itself is what the hover
  // is for.
  //
  // Scene markers are deliberately absent. Stash has no `findSceneMarker(id)` - checked
  // against the schema, not guessed - and a marker has no page of its own either, so
  // there is nothing to open and nothing to ask.
  //
  // Cached per type and id for the life of the page. An entity renamed in another tab
  // keeps the card it had; the alternative is a query per hover, and this is a hover.
  //
  // Keep this block byte-identical across the plugins, like the CSS and `tagLinkTitle`;
  // `.tests/style.test.js` pins it.
  function entityTipStars(r) { return r == null ? null : Math.round(r / 20) + '/5'; }

  // What to call an entity that has no title of its own. Stash's own lists fall back to
  // the primary file's name and so does every listing in this repo, so a card reading
  // `Scene "untitled" (12)` beside a row naming the file is the card being wrong alone.
  function entityTipName(o) {
    if (o.title) return o.title;
    var files = o.files || o.visual_files || [];
    if (files.length && files[0] && files[0].basename) return files[0].basename;
    return (o.folder || {}).basename || '';
  }

  // Stash shows a country's name rather than the ISO code the field holds, through
  // `i18n-iso-countries` with the English locale - `getName` answers the first spelling
  // that list holds per code. This is that list.
  //
  // `Intl.DisplayNames` was the first answer here and is the wrong one by a hair that
  // matters: it says "United States" where Stash says "United States of America", so a
  // card would name a country differently from the performer page it links to. Carrying
  // the table is 3.7KB and no judgement; matching Stash is the whole job.
  //
  // One string rather than an object literal - 250 quoted keys is several times the
  // bytes - split on the first country a card actually names, and never at load.
  var _countryTable = null;
  function entityTipCountry(code) {
    var raw = String(code == null ? '' : code);
    var c = raw.toUpperCase();
    if (c.length !== 2) return raw || null;
    if (!_countryTable) {
      _countryTable = {};
      var rows = (
    'AD:Andorra|AE:United Arab Emirates|AF:Afghanistan|AG:Antigua and Barbuda|AI:Anguilla|' +
    'AL:Albania|AM:Armenia|AO:Angola|AQ:Antarctica|AR:Argentina|AS:American Samoa|' +
    'AT:Austria|AU:Australia|AW:Aruba|AX:Åland Islands|AZ:Azerbaijan|' +
    'BA:Bosnia and Herzegovina|BB:Barbados|BD:Bangladesh|BE:Belgium|BF:Burkina Faso|' +
    'BG:Bulgaria|BH:Bahrain|BI:Burundi|BJ:Benin|BL:Saint Barthélemy|BM:Bermuda|' +
    'BN:Brunei Darussalam|BO:Bolivia|BQ:Bonaire, Sint Eustatius and Saba|BR:Brazil|' +
    'BS:Bahamas|BT:Bhutan|BV:Bouvet Island|BW:Botswana|BY:Belarus|BZ:Belize|CA:Canada|' +
    'CC:Cocos (Keeling) Islands|CD:Democratic Republic of the Congo|' +
    'CF:Central African Republic|CG:Republic of the Congo|CH:Switzerland|CI:Cote d\'Ivoire|' +
    'CK:Cook Islands|CL:Chile|CM:Cameroon|CN:People\'s Republic of China|CO:Colombia|' +
    'CR:Costa Rica|CU:Cuba|CV:Cape Verde|CW:Curaçao|CX:Christmas Island|CY:Cyprus|' +
    'CZ:Czech Republic|DE:Germany|DJ:Djibouti|DK:Denmark|DM:Dominica|' +
    'DO:Dominican Republic|DZ:Algeria|EC:Ecuador|EE:Estonia|EG:Egypt|EH:Western Sahara|' +
    'ER:Eritrea|ES:Spain|ET:Ethiopia|FI:Finland|FJ:Fiji|FK:Falkland Islands (Malvinas)|' +
    'FM:Micronesia, Federated States of|FO:Faroe Islands|FR:France|GA:Gabon|' +
    'GB:United Kingdom|GD:Grenada|GE:Georgia|GF:French Guiana|GG:Guernsey|GH:Ghana|' +
    'GI:Gibraltar|GL:Greenland|GM:Republic of The Gambia|GN:Guinea|GP:Guadeloupe|' +
    'GQ:Equatorial Guinea|GR:Greece|GS:South Georgia and the South Sandwich Islands|' +
    'GT:Guatemala|GU:Guam|GW:Guinea-Bissau|GY:Guyana|HK:Hong Kong|' +
    'HM:Heard Island and McDonald Islands|HN:Honduras|HR:Croatia|HT:Haiti|HU:Hungary|' +
    'ID:Indonesia|IE:Ireland|IL:Israel|IM:Isle of Man|IN:India|' +
    'IO:British Indian Ocean Territory|IQ:Iraq|IR:Islamic Republic of Iran|IS:Iceland|' +
    'IT:Italy|JE:Jersey|JM:Jamaica|JO:Jordan|JP:Japan|KE:Kenya|KG:Kyrgyzstan|KH:Cambodia|' +
    'KI:Kiribati|KM:Comoros|KN:Saint Kitts and Nevis|KP:North Korea|KR:South Korea|' +
    'KW:Kuwait|KY:Cayman Islands|KZ:Kazakhstan|LA:Lao People\'s Democratic Republic|' +
    'LB:Lebanon|LC:Saint Lucia|LI:Liechtenstein|LK:Sri Lanka|LR:Liberia|LS:Lesotho|' +
    'LT:Lithuania|LU:Luxembourg|LV:Latvia|LY:Libya|MA:Morocco|MC:Monaco|' +
    'MD:Moldova, Republic of|ME:Montenegro|MF:Saint Martin (French part)|MG:Madagascar|' +
    'MH:Marshall Islands|MK:The Republic of North Macedonia|ML:Mali|MM:Myanmar|' +
    'MN:Mongolia|MO:Macao|MP:Northern Mariana Islands|MQ:Martinique|MR:Mauritania|' +
    'MS:Montserrat|MT:Malta|MU:Mauritius|MV:Maldives|MW:Malawi|MX:Mexico|MY:Malaysia|' +
    'MZ:Mozambique|NA:Namibia|NC:New Caledonia|NE:Niger|NF:Norfolk Island|NG:Nigeria|' +
    'NI:Nicaragua|NL:Netherlands|NO:Norway|NP:Nepal|NR:Nauru|NU:Niue|NZ:New Zealand|' +
    'OM:Oman|PA:Panama|PE:Peru|PF:French Polynesia|PG:Papua New Guinea|PH:Philippines|' +
    'PK:Pakistan|PL:Poland|PM:Saint Pierre and Miquelon|PN:Pitcairn|PR:Puerto Rico|' +
    'PS:State of Palestine|PT:Portugal|PW:Palau|PY:Paraguay|QA:Qatar|RE:Reunion|' +
    'RO:Romania|RS:Serbia|RU:Russian Federation|RW:Rwanda|SA:Saudi Arabia|' +
    'SB:Solomon Islands|SC:Seychelles|SD:Sudan|SE:Sweden|SG:Singapore|SH:Saint Helena|' +
    'SI:Slovenia|SJ:Svalbard and Jan Mayen|SK:Slovakia|SL:Sierra Leone|SM:San Marino|' +
    'SN:Senegal|SO:Somalia|SR:Suriname|SS:South Sudan|ST:Sao Tome and Principe|' +
    'SV:El Salvador|SX:Sint Maarten (Dutch part)|SY:Syrian Arab Republic|SZ:Eswatini|' +
    'TC:Turks and Caicos Islands|TD:Chad|TF:French Southern Territories|TG:Togo|' +
    'TH:Thailand|TJ:Tajikistan|TK:Tokelau|TL:Timor-Leste|TM:Turkmenistan|TN:Tunisia|' +
    'TO:Tonga|TR:Türkiye|TT:Trinidad and Tobago|TV:Tuvalu|TW:Taiwan, Province of China|' +
    'TZ:United Republic of Tanzania|UA:Ukraine|UG:Uganda|' +
    'UM:United States Minor Outlying Islands|US:United States of America|UY:Uruguay|' +
    'UZ:Uzbekistan|VA:Holy See (Vatican City State)|VC:Saint Vincent and the Grenadines|' +
    'VE:Venezuela|VG:Virgin Islands, British|VI:Virgin Islands, U.S.|VN:Vietnam|' +
    'VU:Vanuatu|WF:Wallis and Futuna|WS:Samoa|XK:Kosovo|YE:Yemen|YT:Mayotte|' +
    'ZA:South Africa|ZM:Zambia|ZW:Zimbabwe'
      ).split('|');
      for (var i = 0; i < rows.length; i++) {
        var at = rows[i].indexOf(':');
        _countryTable[rows[i].slice(0, at)] = rows[i].slice(at + 1);
      }
    }
    return hasOwn(_countryTable, c) ? _countryTable[c] : raw;
  }

  // `TRANSGENDER_FEMALE` is what the API answers and not what anyone calls it. Stash's
  // own labels are the enum title-cased, with the one hyphen it spells by hand.
  function entityTipGender(g) {
    var s = String(g == null ? '' : g);
    if (!s) return null;
    if (s === 'NON_BINARY') return 'Non-Binary';
    return s.toLowerCase().split('_').map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  // The head line and the rows under it, in the shape `tagLinkTitle` writes so the two
  // kinds of card read as one design. A row whose value is absent or empty says nothing
  // rather than saying nothing twice.
  function entityTipLines(label, name, id, rows) {
    var lines = [label + ' "' + (tipText(name) || 'untitled') + '" (' + id + ')'];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][1] == null || rows[i][1] === '') continue;
      lines.push(rows[i][0] + ': ' + tipText(rows[i][1]));
    }
    lines.push(linkTarget() ? 'Click to open it in a new tab.' : 'Click to open it.');
    return lines.join('\n');
  }

  // A scene's card and an image's say the same things.
  function mediaTipText(label) {
    return function (o, id) {
      return entityTipLines(label, entityTipName(o), id, [
        ['Date', o.date], ['Studio', (o.studio || {}).name],
        ['Performers', tagTipNames(o.performers)], ['Tags', tagTipNames(o.tags)],
        ['Rating', entityTipStars(o.rating100)],
        ['Organized', o.organized ? 'yes' : null]]);
    };
  }

  // Keyed by the plural Stash puts in a URL, which is what every plugin here already
  // calls a type. `fields` is read off `graphql/schema/types/*` rather than guessed: a
  // wrong name fails the whole query for that type, and an absent card is indistinguish-
  // able from an entity that has nothing to say.
  var ENTITY_TIPS = {
    scenes: {
      one: 'findScene',
      fields: 'title date rating100 organized studio { name } performers { name } ' +
        'tags { name } files { basename } paths { screenshot }',
      img: function (o) { return (o.paths || {}).screenshot; },
      text: mediaTipText('Scene'),
    },
    images: {
      one: 'findImage',
      fields: 'title date rating100 organized studio { name } performers { name } ' +
        'tags { name } visual_files { ... on ImageFile { basename } ' +
        '... on VideoFile { basename } } paths { thumbnail }',
      img: function (o) { return (o.paths || {}).thumbnail; },
      text: mediaTipText('Image'),
    },
    galleries: {
      one: 'findGallery',
      fields: 'title date rating100 organized image_count studio { name } ' +
        'performers { name } tags { name } files { basename } folder { basename } ' +
        'paths { cover }',
      img: function (o) { return (o.paths || {}).cover; },
      text: function (o, id) {
        return entityTipLines('Gallery', entityTipName(o), id, [
          ['Date', o.date], ['Studio', (o.studio || {}).name],
          ['Images', o.image_count], ['Performers', tagTipNames(o.performers)],
          ['Tags', tagTipNames(o.tags)], ['Rating', entityTipStars(o.rating100)],
          ['Organized', o.organized ? 'yes' : null]]);
      },
    },
    performers: {
      one: 'findPerformer',
      fields: 'name disambiguation gender birthdate country favorite rating100 ' +
        'scene_count alias_list tags { name } image_path',
      img: function (o) { return o.image_path; },
      text: function (o, id) {
        return entityTipLines('Performer',
          o.name + (o.disambiguation ? ' (' + o.disambiguation + ')' : ''), id, [
            ['Gender', entityTipGender(o.gender)], ['Born', o.birthdate],
            ['Country', entityTipCountry(o.country)],
            ['Scenes', o.scene_count], ['Rating', entityTipStars(o.rating100)],
            ['Favorite', o.favorite ? 'yes' : null],
            ['Aliases', tagTipNames(o.alias_list)], ['Tags', tagTipNames(o.tags)]]);
      },
    },
    studios: {
      one: 'findStudio',
      fields: 'name aliases favorite rating100 scene_count parent_studio { name } ' +
        'tags { name } image_path',
      img: function (o) { return o.image_path; },
      text: function (o, id) {
        return entityTipLines('Studio', o.name, id, [
          ['Aliases', tagTipNames(o.aliases)], ['Parent', (o.parent_studio || {}).name],
          ['Scenes', o.scene_count], ['Rating', entityTipStars(o.rating100)],
          ['Favorite', o.favorite ? 'yes' : null], ['Tags', tagTipNames(o.tags)]]);
      },
    },
    groups: {
      one: 'findGroup',
      fields: 'name aliases date director rating100 scene_count studio { name } ' +
        'tags { name } front_image_path',
      img: function (o) { return o.front_image_path; },
      text: function (o, id) {
        // `aliases` is a plain string on a Group and a list on a Studio, which is why
        // neither of them is read out of a table of field names.
        return entityTipLines('Group', o.name, id, [
          ['Aliases', o.aliases], ['Date', o.date], ['Studio', (o.studio || {}).name],
          ['Director', o.director], ['Scenes', o.scene_count],
          ['Rating', entityTipStars(o.rating100)], ['Tags', tagTipNames(o.tags)]]);
      },
    },
    tags: {
      one: 'findTag',
      fields: 'name description aliases parents { name } children { name } image_path',
      img: function (o) { return o.image_path; },
      text: function (o, id) { o.id = id; return tagLinkTitle(o, null); },
    },
  };

  var _entityTips = {};        // 'type:id' -> Promise of { text, img } or null

  function entityTipDetail(type, id) {
    var key = type + ':' + id;
    if (hasOwn(_entityTips, key)) return _entityTips[key];
    var spec = ENTITY_TIPS[type];
    _entityTips[key] = gqlRequest('query GTTxEntityTip($id: ID!) { ' + spec.one +
      '(id: $id) { id ' + spec.fields + ' } }', { id: String(id) }).then(function (d) {
      var o = (d || {})[spec.one];
      if (!o) return null;
      var img = spec.img(o);
      return { text: spec.text(o, id), rating100: o.rating100, organized: !!o.organized,
        // Stash answers for an entity with no image of its own as well - with a
        // placeholder it marks `default=true`. The same generic icon on every card is
        // noise, so that answer counts as no image.
        img: img && !/[?&]default=true/.test(String(img)) ? String(img) : null };
    }, function () { return null; });        // a card is not worth an error
    return _entityTips[key];
  }

  function entityTip(node, type, id) {
    if (!node || !id || !hasOwn(ENTITY_TIPS, type) || node._gttxEntTip ||
        !node.addEventListener) return;
    node._gttxEntTip = true;
    var open = function () {
      node._gttxEntTipOn = true;
      // A stale answer arriving after the pointer has moved on must not open the box.
      entityTipDetail(type, id).then(function (d) {
        if (!d || !node._gttxEntTipOn) return;
        // Whatever the caller put there - "Open this scene in a new tab" - is worth
        // keeping for the hover that has no answer yet and for every page where this
        // query fails.
        if (node.title) node._gttxEntTipTitle = node.title;
        node.title = '';
        tipOpen(node, d.text, d.img, d);
      });
    };
    var shut = function () {
      node._gttxEntTipOn = false;
      if (node._gttxEntTipTitle) node.title = node._gttxEntTipTitle;
      tipClose();
    };
    hoverFocus(node, open, shut);
  }


  // ── The tooltip a custom-field setting carries ────────────────────────────
  //
  // A setting that names a custom field names a string in a flat, unowned map, and the
  // page says nothing at all about it: not what it is for, and not whether anything in
  // the library carries it. Both are things a user checks by leaving the settings page.
  // So the mark beside the value answers them where the question is asked.
  //
  // **Hover-lazy, which is the whole reason this is affordable.** The carriers come from
  // seven `custom_fields: NOT_NULL` filters - one aliased round trip, and every
  // `*FilterType` carries that criterion - but a NOT_NULL match is a scan over a JSON
  // column, seven times. `CustomFieldsBulkEditor`'s own dropdown filter makes the same
  // query and its comment already prices it: affordable once per page, not on a timer.
  // The settings tick runs every second, so it draws the mark and nothing else, and the
  // read happens on the first pointer that comes near it. Cached per field name for the
  // page afterwards.
  //
  // **The description is free.** `CustomFieldsBulkEditor` publishes it through
  // `coop().api`, answered from a store it has already read; an absent or older sibling
  // simply contributes no line, which is the same degradation `describeField` has. That
  // plugin calls its own entry here rather than reaching inside itself, so this block
  // stays byte-identical in all five - pinned by `.tests/style.test.js`, like the CSS.
  //
  // **Ten carriers in total, not ten per type.** Seventy names in a native `title` is a
  // wall nobody reads, and the count says the rest. Each is named with its type, because
  // "Beach day" alone does not say what it is.
  var CF_TIP_HITS = 10;      // carriers named before the rest become a count
  var CF_TIP_MARK = 'ⓕ';     // circled Latin small letter f - the custom-field glyph, as on the cards' counter

  // `id` and what names a row per type, and the filter argument each `find*` takes.
  // The alias is the list field's own name, so `data.scenes.scenes` is the rows and
  // `data.scenes.count` is how many there are altogether. A scene, image or gallery
  // with no title is named by its file, as the card is (`entityTipName`): "untitled"
  // says nothing about which one it is.
  var CF_FILE_NAMES = {
    scenes: 'title files { basename }',
    images: 'title visual_files { ... on ImageFile { basename } ... on VideoFile { basename } }',
    galleries: 'title files { basename } folder { basename }',
  };
  var CF_TIP_TYPES = [
    { label: 'Scene', plural: 'Scenes', list: 'scenes', arg: 'scene_filter', name: 'title' },
    { label: 'Image', plural: 'Images', list: 'images', arg: 'image_filter', name: 'title' },
    { label: 'Gallery', plural: 'Galleries', list: 'galleries', arg: 'gallery_filter', name: 'title' },
    { label: 'Performer', plural: 'Performers', list: 'performers', arg: 'performer_filter', name: 'name' },
    { label: 'Studio', plural: 'Studios', list: 'studios', arg: 'studio_filter', name: 'name' },
    { label: 'Group', plural: 'Groups', list: 'groups', arg: 'group_filter', name: 'name' },
    { label: 'Tag', plural: 'Tags', list: 'tags', arg: 'tag_filter', name: 'name' },
  ];

  var _cfCarriers = {};

  function cfTipCarriers(field) {
    if (hasOwn(_cfCarriers, field)) return _cfCarriers[field];
    var parts = CF_TIP_TYPES.map(function (t) {
      return t.list + ': find' + t.plural + '(filter: { per_page: ' + CF_TIP_HITS + ' }, ' +
        t.arg + ': { custom_fields: [{ field: ' + JSON.stringify(field) +
        ', modifier: NOT_NULL }] }) { count ' + t.list + ' { id ' + (CF_FILE_NAMES[t.list] || t.name) + ' } }';
    });
    _cfCarriers[field] = gqlRequest('query GTTxCarriers { ' + parts.join(' ') + ' }', null)
      .then(function (data) {
        var total = 0;
        var names = [];
        CF_TIP_TYPES.forEach(function (t) {
          var block = (data && data[t.list]) || {};
          total += block.count || 0;
          (block[t.list] || []).forEach(function (o) {
            if (names.length >= CF_TIP_HITS) return;
            var name = CF_FILE_NAMES[t.list] ? entityTipName(o) : o[t.name];
            names.push(t.label + ' "' + (tipText(name) || 'untitled') + '" (' + o.id + ')');
          });
        });
        return { total: total, names: names };
      }, function () { return null; });   // a tooltip is not worth an error
    return _cfCarriers[field];
  }

  function cfTipTitle(field, desc, hits) {
    var lines = ['Custom field "' + field + '"'];
    var text = tipText(desc);
    if (text) {
      lines.push(text.length > TIP_DESC_CHARS ? text.slice(0, TIP_DESC_CHARS) + '…' : text);
    }
    if (!hits) {
      lines.push('What carries it could not be read.');
    } else if (!hits.total) {
      lines.push('Nothing in your library carries it.');
    } else {
      lines.push('Carried by ' + plural(hits.total, 'entity', 'entities') + ':');
      lines.push(hits.names.join(', ') + (hits.total > hits.names.length
        ? ', +' + plural(hits.total - hits.names.length, 'more', 'more') : ''));
    }
    return lines.join('\n');
  }

  function cfTipLoad(node) {
    var field = node._gttxCfField;
    if (!field || node._gttxCfLoaded === field) return;
    node._gttxCfLoaded = field;
    var api = coop().api && coop().api.CustomFieldsBulkEditor;
    var described = api && typeof api.descriptions === 'function'
      ? api.descriptions().then(null, function () { return {}; })
      : Promise.resolve({});
    Promise.all([described, cfTipCarriers(field)]).then(function (both) {
      // The box may have moved on while the two were in flight.
      if (node._gttxCfField !== field) return;
      node._gttxCfBox.textContent = cfTipTitle(field, (both[0] || {})[field], both[1]);
    });
  }

  // Above the mark by preference, because that is the half of the page the help cursor is
  // not in; below it where there is no room above, and clamped horizontally so the whole
  // box is on screen either way. Measured after it is shown, since a `display:none` box
  // has no size. Re-measured on every open: the panel scrolls.
  function cfTipPlace(node) {
    var box = node._gttxCfBox;
    var mark = node._gttxCfMark || node.firstChild;
    if (!box || !mark || !mark.getBoundingClientRect || !box.getBoundingClientRect) return;
    var a = mark.getBoundingClientRect();
    var b = box.getBoundingClientRect();
    var vw = window.innerWidth || 1024;
    var vh = window.innerHeight || 768;
    var top = a.top - b.height - 6;
    if (top < 8) top = Math.min(a.bottom + 6, Math.max(8, vh - b.height - 8));
    // Right-aligned to the mark, which sits at the right-hand end of the row - then
    // pulled back onto the page if that puts either edge off it.
    var left = Math.min(Math.max(8, a.right - b.width), Math.max(8, vw - b.width - 8));
    box.style.top = top + 'px';
    box.style.left = left + 'px';
  }

  function cfTipOpen(node, on) {
    toggleClass(node, 'gttx-cftip-open', on);
    if (on) cfTipPlace(node);
  }

  // The row is wired as well as the mark, and only for the lead time: the box is filled
  // when the read lands, so loading on the mark alone would show the bare name for as
  // long as the round trip takes. Entering the row happens a moment earlier, which is
  // usually enough for the box to be complete before it is opened. The flag is on the row
  // rather than on us because React hands back its own element on every re-render, and
  // the listener goes with it.
  function cfTipArm(node, row) {
    if (!node._gttxCfArmed) {
      node._gttxCfArmed = true;
      hoverFocus(node, function () { cfTipLoad(node); cfTipOpen(node, true); },
        function () { cfTipOpen(node, false); });
    }
    if (row && !row._gttxCfArmed) {
      row._gttxCfArmed = true;
      row.addEventListener('mouseenter', function () { cfTipLoad(node); });
    }
  }

  // The id is built from the plugin id and the setting key, so five plugins can carry
  // this block byte-identically and still never collide - the same reasoning the shared
  // Reload UI button's id follows.
  //
  // `field` may be a list - a setting naming several fields, Custom Fields Bulk Editor's
  // Locked Custom Fields - and then every name gets a mark of its own, drawn after the
  // name so it is plain which one it describes, the names separated by commas as the
  // box is, and Stash's own text of the value hidden under `.gttx-cflisted` rather than
  // shown twice. The first mark carries the bare id and the rest `-2`, `-3`, …, so a
  // list that shrinks takes its spare marks off.
  function cfTipTick(pluginId, key, field) {
    var row = settingRow(pluginId, key);
    var named = Array.isArray(field);   // not instanceof: a list from another realm is a list
    var list = named ? field.filter(Boolean) : field ? [field] : [];
    var base = 'gttx-cffield-' + pluginId + '-' + key;
    if (row) toggleClass(row, 'gttx-cflisted', named && list.length > 0);
    for (var i = 0; ; i++) {
      var id = i ? base + '-' + (i + 1) : base;
      var node = document.getElementById(id);
      if (!row || i >= list.length) {
        if (!node) break;
        if (node.parentNode) node.parentNode.removeChild(node);
        continue;
      }
      cfTipNode(node, id, row, list[i], named, i);
    }
  }

  function cfTipShell(node) {
    var mark = el('span', 'gttx-cftip', CF_TIP_MARK);
    // Reachable without a mouse, like the setting descriptions' own mark.
    mark.tabIndex = 0;
    node.appendChild(mark);
    node._gttxCfMark = mark;
    node._gttxCfBox = el('span', 'gttx-cftipbox', '');
    node.appendChild(node._gttxCfBox);
    return node;
  }

  // The same mark and box for a custom field named anywhere but a settings row - a
  // plugin's own dialog, or a summary line it draws. A field named always shows its ⓕ, as a
  // tag its icon: with the box where Custom Fields Bulk Editor holds a description of it, and
  // plain, saying so on hover, where it holds none, is not installed, or could not be read.
  // Resolves to the node to place after the name, or null for no field at all.
  // The mark beside a box naming a tag: 🔗, linked to the tag and carrying its hover card, when a
  // tag has that name or alias; a big red ? when none has. Null for an empty box.
  // The tag icon Stash draws on its cards, as a mark in the Highlighted Text Color: after a tag's
  // name in a summary, inside the quotes, and after a box that names one, as ⓕ follows a field's.
  var TAG_SVG = '<svg viewBox="0 0 448 512" aria-hidden="true" focusable="false"><path d="M0 80V229.5c0 17 6.7 33.3 ' +
    '18.7 45.3l176 176c25 25 65.5 25 90.5 0L418.7 317.3c25-25 25-65.5 0-90.5l-176-176c-12-12-28.3-18.7-45.3-18.7H48C21.5 ' +
    '32 0 53.5 0 80zm112 32a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"/></svg>';
  function tagGlyph() {
    injectStyle();
    var g = el('span', 'gttx-tagglyph');
    g.innerHTML = TAG_SVG;
    g.title = 'The name or an alias of a tag';
    return g;
  }

  // `withGlyph`: the tag icon before the link, for a box no field of Core's draws (`tag: true` there).
  function tagMark(name, withGlyph) {
    var n = String(name == null ? '' : name).replace(/^\s+|\s+$/g, '');
    if (!n) return Promise.resolve(null);
    return gqlRequest('query GTTxTagMark($n: String!) { byName: findTags(tag_filter: { name: { value: $n, modifier: EQUALS } }) ' +
      '{ tags { id name } } byAlias: findTags(tag_filter: { aliases: { value: $n, modifier: EQUALS } }) { tags { id name } } }',
    { n: n }).then(function (d) {
      var tag = ((d.byName || {}).tags || [])[0] || ((d.byAlias || {}).tags || [])[0];
      injectStyle();
      if (!tag) {
        var none = el('span', 'gttx-tagmark gttx-tagmark-none', '?');
        none.title = 'No tag is named "' + n + '", by its name or an alias.';
        return none;
      }
      var node = el('a', 'gttx-tagmark', '🔗');
      node.href = '/tags/' + tag.id;
      node.target = linkTarget();
      node.rel = 'noopener noreferrer';
      entityTip(node, 'tags', String(tag.id));
      if (!withGlyph) return node;
      var both = el('span', 'gttx-tagmarks');
      both.appendChild(tagGlyph());
      both.appendChild(node);
      return both;
    }, function () { return null; });
  }

  function cfTipMark(field) {
    if (!field) return Promise.resolve(null);
    var api = coop().api && coop().api.CustomFieldsBulkEditor;
    function plain() {
      injectStyle();
      var node = el('span', 'gttx-cftip gttx-cfinline', CF_TIP_MARK);
      node.title = 'Custom field "' + field + '"' + (api ? ' - no description of it in Custom Fields Bulk Editor yet.' : '.');
      return node;
    }
    if (!api || typeof api.descriptions !== 'function') return Promise.resolve(plain());
    return api.descriptions().then(function (d) {
      if (!d || !tipText(d[field])) return plain();
      injectStyle();
      var node = cfTipShell(el('span', 'gttx-cftipped gttx-cfinline'));
      node._gttxCfField = field;
      node._gttxCfBox.textContent = 'Custom field "' + field + '"';
      cfTipArm(node, null);
      return node;
    }, plain);
  }

  function cfTipNode(node, id, row, field, named, index) {
    if (!node) {
      // A wrapper holding the mark and the box: it carries the id and the open-state
      // class, and nothing else - the box is fixed to the viewport, so it is not
      // positioned against this.
      node = el('span', 'gttx-cftipped');
      node.id = id;
      if (named) {
        if (index) node.appendChild(el('span', 'gttx-cfsep', ', '));
        node._gttxCfName = el('span', 'gttx-cfname', '');
        node.appendChild(node._gttxCfName);
      }
      cfTipShell(node);
    }
    if (node._gttxCfField !== field) {
      node._gttxCfField = field;
      if (node._gttxCfName) node._gttxCfName.textContent = field;
      // Honest until the read lands rather than a promise about what is coming: the
      // name is the one thing known without asking anything.
      node._gttxCfBox.textContent = 'Custom field "' + field + '"';
    }
    cfTipArm(node, row);
    // At the end of Stash's own `.value`, so the mark is on the same line as the name it
    // describes and to the left of the Edit button - the placement the reference note in
    // the repo-root AGENTS.md settles for every one of these.
    var host = byClass(row, 'value') || row;
    if (node.parentNode !== host) host.appendChild(node);
  }


  // The banner says to reload, and until now nothing inside the dialog did it: the
  // Reload UI button lives on Settings → Plugins, which is not where someone reading a
  // dialog is. Same red, same tooltip, one per dialog - deliberately *not* wearing
  // `RELOAD_UI_ID`, which names the settings page's single shared button. Appended
  // after the text, because the text is set with `textContent` and would wipe it.
  function staleReloadButton(box) {
    var b = reloadButton('btn btn-danger btn-sm', 'margin-left:.6rem;');
    box.appendChild(b);
    return b;
  }

  // The red Reload UI button, both kinds: it reloads the page.
  function reloadButton(cls, style) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = 'Reload UI';
    b.title = RELOAD_UI_TIP;
    b.style = style;
    b.addEventListener('click', function () {
      if (window.location && window.location.reload) window.location.reload();
    });
    return b;
  }

  var RELOAD_UI_ID = 'gttx-reload-ui';
  var RELOAD_UI_TIP = '⚠ This page is running a mismatching version of plugin/s ' +
    'installed. Press to solve issue. Every other opened tab on Stash may require a ' +
    'similar UI refresh. Press Ctrl+Shift+R (⌘+Shift+R on a Mac) if you still see ' +
    'this afterward.';

  // One flag per plugin rather than one shared boolean: a plugin that has caught up
  // must be able to say so without clearing a sibling's claim.
  function anyStale() {
    var m = coop().staleUI, k;
    for (k in m) if (hasOwn(m, k) && m[k]) return true;
    return false;
  }

  // Stash's own Reload plugins button, found by *where* it is rather than by its
  // caption, which is translated - the last button in our section that is not inside a
  // plugin's own group. Two shapes have to match: a released Stash puts it in a
  // `.setting` row of its own, and `develop` puts it in a flex row beside a filter box
  // whose clear button is a second button in that row. "Outside any `.setting-group`"
  // is what both have in common, and taking the last one is what keeps the filter box's
  // clear button from winning. Scoping to our own section is what keeps the
  // package-manager sections above it from matching at all.
  function reloadUiAnchor(group) {
    var sec = group;
    while (sec && !hasClass(sec, 'setting-section')) sec = sec.parentNode;
    if (!sec || !sec.querySelectorAll) return null;
    var all = sec.querySelectorAll('button'), i, p, b = null;
    for (i = 0; i < all.length; i++) {
      if (all[i].id === RELOAD_UI_ID) continue;
      for (p = all[i].parentNode; p && p !== sec; p = p.parentNode) {
        if (hasClass(p, 'setting-group')) break;
      }
      if (p === sec) b = all[i];
    }
    return b;
  }

  // Re-added rather than tracked, like everything else this tick puts on the page:
  // React drops it on the next render of the panel.
  function ensureReloadUiButton(pluginId, group, stale) {
    coop().staleUI[pluginId] = !!stale;
    var node = document.getElementById(RELOAD_UI_ID);
    var anchor = anyStale() ? reloadUiAnchor(group) : null;
    if (!anchor) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      return;
    }
    if (node && node.parentNode === anchor.parentNode) return;
    if (node && node.parentNode) node.parentNode.removeChild(node);
    // `margin-left:auto` rather than a class: the row is `justify-content-between`, so
    // a third child would otherwise sit alone in the middle of it. This puts our
    // button and Stash's together at the right, with the filter box still at the left.
    var b = reloadButton('btn btn-danger', 'margin-left:auto;margin-right:.5rem;');
    b.id = RELOAD_UI_ID;
    anchor.parentNode.insertBefore(b, anchor);
  }


  function computedStyleOf(node) {
    if (typeof window.getComputedStyle !== 'function' || !node) return null;
    try { return window.getComputedStyle(node) || null; } catch (e) { return null; }
  }

  function findActionByLabel(root, label) {
    var kids = root.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if ((k.tagName === 'BUTTON' || k.tagName === 'A') &&
          (k.textContent || '').trim() === label) return k;
      var found = findActionByLabel(k, label);
      if (found) return found;
    }
    return null;
  }

  function insertOrdered(container, button, anchor) {
    if (!anchor) { container.appendChild(button); return; }
    var order = coop().order;
    // **The priority comes off the button, not off an ambient plugin id.** Every plugin
    // already stamps `_coopOwner` on the element before inserting it - it is what a
    // sibling's scan reads back - so the inserting plugin is a property of the thing
    // being inserted. It had to be: this function is Core's now, and Core's own id is
    // not the id of whoever is placing a button.
    var myPriority = (button && button._coopOwner ? order[button._coopOwner] : 0) || 0;
    var ref = anchor;
    var scan = anchor.previousSibling;
    while (scan) {
      var ownerPriority = scan._coopOwner ? (order[scan._coopOwner] || 0) : null;
      if (ownerPriority === null || ownerPriority <= myPriority) break;
      ref = scan;
      scan = scan.previousSibling;
    }
    container.insertBefore(button, ref);
  }

  function applyButtonSpacing(container, button) {
    // `align-self:flex-start` first, and the assignment unconditional, so this is the
    // same three lines as the two sibling plugins: it opts the button out of a flex
    // row's `align-items: stretch`, and a row that spaces its own children with
    // `column-gap` still needs it even though it needs no margin from us.
    var parts = ['align-self:flex-start'];
    var cs = computedStyleOf(container);
    if (!cs || !nonZeroLength(cs.columnGap)) {
      var m = stashButtonMargins(container);
      if (m) parts = parts.concat(fillNeighbourGaps(container, button, m));
      else if (!hasClass(button, SPACING_CLASS)) button.className += ' ' + SPACING_CLASS;
    }
    if (container._cpt2sBlockRow) parts.push('margin-bottom:' + ROW_GAP);
    button.style = parts.join(';') + ';';
  }

  function insertBeforeImportantAction(container, button) {
    var node = container.querySelector('button.delete')
            || findActionByLabel(container, 'Delete')
            || findActionByLabel(container, 'Save');
    while (node && node.parentNode !== container) node = node.parentNode;
    ensureRowSpacing(container);
    insertOrdered(container, button, node);
    applyButtonSpacing(container, button);
  }

  // The edit form's own button row, on any entity page. `.edit-buttons` is Scene's row,
  // confirmed live. Every other page checked so far renders its edit form inside
  // `.details-edit` instead, a container Stash swaps between two states: a detail-view
  // navbar carrying a Delete button, and the edit form itself carrying Cancel/Save in its
  // place. The edit-form instance is the one wanted, so a `.details-edit` carrying a
  // Delete is skipped. Null where no edit form is open.
  function findEditContainer() {
    var c = document.querySelector('.edit-buttons');
    if (c) return c;
    var candidates = document.querySelectorAll('.details-edit');
    for (var i = 0; i < candidates.length; i++) {
      if (!candidates[i].querySelector('button.delete')) return candidates[i];
    }
    return null;
  }


  // ── The Scene Tagger's duration mismatch ──────────────────────────────────
  //
  // Stash's tagger prints "Duration off by at least Ns" as a plain sentence among the
  // other result fields, in the same weight and color as everything beside it - and it
  // is the one line on that card that decides whether a match is the right file. Read off
  // `ui/v2.5/src/components/Tagger/scenes/StashSearchResult.tsx`: `getDurationStatus`
  // returns a wrapped, bolded, icon-carrying element when the duration *matches*, and a
  // **bare `FormattedMessage`** when it does not - so the failing case is the one with no
  // element and no class of its own to style.
  //
  // Off by default, because it changes a page this plugin does not own.
  var DUR_RE = /Duration off by at least (\d+)s/;
  var DUR_CLASS = 'gttx-durwarn';

  // Red past five seconds, orange above one. Both bands are the user's, and the upper one
  // is where Stash's own threshold already sits: `getDurationStatus` takes the match
  // branch as soon as any fingerprint is within 5s, so in practice a printed number below
  // 5 is rare and 5 itself is the orange band's whole population. Stated as asked rather
  // than narrowed to what today's Stash can produce - the bands are about the seconds,
  // not about which branch printed them.
  function durationBand(n) {
    if (!(n >= 0)) return null;
    if (n > 5) return 'red';
    if (n > 1) return 'orange';
    return null;
  }

  // Every text node under `node` that says it, without a TreeWalker: the fake DOM the
  // suites run on has no node types, and a plain recursion is what both can walk.
  function durationTextNodes(root, out) {
    if (!root || !root.childNodes) return out;
    for (var i = 0; i < root.childNodes.length; i++) {
      var kid = root.childNodes[i];
      if (kid.nodeType === 3) {
        if (DUR_RE.test(String(kid.nodeValue || ''))) out.push(kid);
      } else if (kid.nodeType === 1 && !hasClass(kid, DUR_CLASS)) {
        durationTextNodes(kid, out);
      }
    }
    return out;
  }

  // **React's own node is never moved and never removed.** Wrapping the text node would
  // put our element where React expects to find a text node and throw on its next
  // reconcile - the `modeFieldTick` self-append bug in a subtree we own even less. So a
  // span of ours is inserted *before* it carrying the emphasised copy, and React's node
  // is blanked in place.
  //
  // Returns whether the sentence ended up emphasised, so the caller knows whether to keep
  // the record.
  function durationPaint(e) {
    var band = durationBand(parseInt((DUR_RE.exec(e.text) || [])[1], 10));
    if (!band) {
      if (e.span && e.span.parentNode) e.span.parentNode.removeChild(e.span);
      if (e.node.nodeValue === '') e.node.nodeValue = e.text;
      e.node._gttxDur = null;
      e.span = null;
      return false;
    }
    if (!e.span || e.span.parentNode !== e.node.parentNode) {
      // **Here, because this is the first place on the tagger that needs it.** The
      // stylesheet used to be injected only from the settings tick and the dialog, which
      // are the two places this plugin draws something *of its own* - and the tagger is
      // neither. So the span appeared with both its classes and no rules behind them, and
      // the sentence came back in the page's ordinary white. `injectStyle` is idempotent,
      // and a page that emphasises nothing still pays for no stylesheet.
      injectStyle();
      e.span = el('span', DUR_CLASS);
      e.node.parentNode.insertBefore(e.span, e.node);
    }
    e.span.className = DUR_CLASS + ' ' + DUR_CLASS + '-' + band;
    e.span.textContent = e.text;
    e.node.nodeValue = '';
    e.node._gttxDur = e.span;
    return true;
  }

  // What has been emphasised, and the sentence each one displaced. Held as records rather
  // than found again by class, so that turning the feature off puts every sentence back
  // exactly as Stash wrote it.
  var _durSpans = [];

  function durationClear() {
    for (var i = 0; i < _durSpans.length; i++) {
      var e = _durSpans[i];
      if (e.node && e.node.nodeValue === '') e.node.nodeValue = e.text;
      if (e.node) e.node._gttxDur = null;
      if (e.span && e.span.parentNode) e.span.parentNode.removeChild(e.span);
    }
    _durSpans = [];
  }

  // `cards` is passed rather than found again: the tick has already asked, because whether
  // any exist is what decides that the settings are worth reading at all. The class is
  // Stash's own (`scene-metadata` in `StashSearchResult.tsx`) and it is the smallest
  // container that holds the sentence.
  //
  // **The records are what carry an emphasised sentence between ticks, not the scan.**
  // This tick rescanned every time and dropped any span whose text node no longer
  // matched - which is every span it had just made, because blanking the node is how the
  // emphasis works. One tick emphasised the sentence and the next deleted it *and* left
  // the node blank, so the line vanished from the card. The scan now only finds what is
  // not already ours; everything already emphasised is kept or dropped on its own
  // evidence.
  function durationTick(cards) {
    if (!settings().a1TaggerDuration) {
      if (_durSpans.length) durationClear();
      return;
    }
    var live = [];
    var i;
    for (i = 0; i < _durSpans.length; i++) {
      var e = _durSpans[i];
      // React dropped the card, or the sentence with it.
      if (!e.node.parentNode || !e.span || e.span.parentNode !== e.node.parentNode) {
        if (e.span && e.span.parentNode) e.span.parentNode.removeChild(e.span);
        continue;
      }
      // React re-rendered and wrote the sentence back - possibly a different number.
      var now = String(e.node.nodeValue || '');
      if (now && DUR_RE.test(now)) {
        e.text = now;
        if (!durationPaint(e)) continue;
      }
      live.push(e);
    }
    for (var c = 0; c < cards.length; c++) {
      var found = durationTextNodes(cards[c], []);
      for (var k = 0; k < found.length; k++) {
        if (found[k]._gttxDur) continue;
        var fresh = { node: found[k], span: null, text: String(found[k].nodeValue) };
        if (durationPaint(fresh)) live.push(fresh);
      }
    }
    _durSpans = live;
  }

  // ── Dev Mods ──────────────────────────────────────────────────────────────
  //
  // Switches that change no behaviour of their own: each one sets a flag on the shared
  // object that the other plugins already read, or that this one does. They are a
  // *setting* rather than a console incantation because the console line was the thing
  // nobody could remember - but they are all off by default and none of them is meant to
  // be left on. The first three are about the plugins' chrome; the rest are each plugin's
  // console logging, which was a row of that plugin's own group until the groups were
  // made smaller - five rows of the same switch, for working on a plugin rather than using it.
  //
  // Stored as one string in one key, the shape `NormalizeParentTags` settled on for its
  // own modes: parsing forgives - any order, any spacing, unknown names carried through
  // untouched - and formatting is strict.
  // The console logs first - why each control shows or hides, then each plugin's own - and the
  // two switches that change what the page shows last, so the logs read as one group.
  var LOG_BUTTON_VIS = { key: 'LOG_BUTTON_VIS', flag: 'logButtonVisInfo',
    label: 'Log Button Visibility to the Browser Console',
    tip: 'Print to the browser console why each control a ᝯㄝₓ plugin draws into Stash’s pages - ' +
      'its buttons, and Scene Variants’ Variants tab - is shown or hidden, under each plugin’s ' +
      '[<prefix> gate] prefix.\n\nOne line per control, and again only when its answer changes. Read ' +
      'at call time, so it takes effect on the next tick. __GTTx__.StashPluginCoop.logButtonVisInfo = ' +
      'true does the same from the console. It says why a control is there or not, never what a ' +
      'plugin wrote: that is each plugin’s own switch below.' };
  var DEV_MODS = [
    { key: 'LAYOUT', flag: 'layoutEdit', label: 'Layout edit mode',
      tip: 'Outlines every control these plugins have injected into Stash’s own ' +
        'chrome and labels it with the plugin that put it there. For working out which ' +
        'plugin owns a button in a row that holds several.\n\nOn: as well, the System view of ' +
        'Propagate Tags and Performers’ Paths dialog can be rearranged - drag a box or a toggle - ' +
        'with Copy layout and Reset layout under it; the layout is kept in this browser.' },
    { key: 'STALEDEMO', flag: 'staleDemo', label: 'Stale UI demo',
      tip: 'Pretends a plugin’s script is out of date, so the red Reload UI button ' +
        'appears beside Stash’s own Reload plugins without waiting for a real ' +
        'mismatch. Nothing else changes, and no plugin’s own banner is affected.' },
  ];
  // Each plugin's console logging. `legacy` is the plugin's own setting it replaced, read
  // while Dev Mods has never been saved with this switch in it.
  var LOG_MODS = [
    { key: 'LOG_PTP2RE', plugin: 'PropagateTagsAndPerformers', legacy: 'g1LogToConsole',
      label: 'Log Propagate Tags and Performers to the Browser Console',
      tip: 'Log each tag and performer Propagate Tags and Performers copies to the browser\'s ' +
        'JavaScript console, at Info level.\n\nThat is F12 - Console, not the Stash server log or the ' +
        'Logs page.' },
    { key: 'LOG_SVR', plugin: 'SceneVariants', legacy: 'b1LogToConsole',
      label: 'Log Scene Variants to the Browser Console',
      tip: 'Print each variant lookup Scene Variants makes to the browser console.\n\nIt names the ' +
        'scene, how many variants were found and what they were matched on, under the [svr] prefix. ' +
        'A failed variant query is always reported, with or without this switch.' },
    { key: 'LOG_MPTTS', plugin: 'MergePerformerTagsToScenes', legacy: 'd1LogMergesToConsole',
      label: 'Log Merge Performer Tags to the Browser Console',
      tip: 'Log each performer tag Merge Performer Tags merges to the browser\'s JavaScript console, ' +
        'at Info level.\n\nThat is F12 - Console, not the Stash server log or the Logs page.' },
    { key: 'LOG_ENM', plugin: 'EntityNameMaintainer', legacy: 'd1LogToConsole',
      label: 'Log Entity Name Maintainer to the Browser Console',
      tip: 'Print every message the Entity Name Maintainer dialog shows to the browser console as ' +
        'well.\n\nThe lines are the same ones the dialog logs, under the [enm] prefix, so a session can ' +
        'be read back after the dialog has been closed. It is separate from Copy log, which hands over ' +
        'the counters, the whole listing and the messages as text.' },
    { key: 'LOG_TBC', plugin: 'TagBundleClipboard', legacy: 'b1LogToConsole',
      label: 'Log Tag Bundle Clipboard to the Browser Console',
      tip: 'Print each copy and each paste Tag Bundle Clipboard makes to the browser console.\n\nIt ' +
        'names the entity, the number of tags and which bundle was used, under the [tbc] prefix, so a ' +
        'session can be read back after the dialog has been closed. It is separate from the log inside ' +
        'the dialog, which Copy log hands over as text.' },
    { key: 'LOG_DSP', plugin: 'DeSpicer',
      label: 'Log De-Spicer to the Browser Console',
      tip: 'Print every message the De-Spicer dialog shows to the browser console as well.\n\nThe ' +
        'lines are the same ones the dialog logs, under the [dsp] prefix, so a long run can be read ' +
        'back after the dialog has been closed. It is separate from Copy log, which hands over the ' +
        'dialog\'s log as text.' },
  ];
  DEV_MODS = [LOG_BUTTON_VIS].concat(LOG_MODS, DEV_MODS);
  // Every plugin's stored settings, as the last read of them found them: where a log switch
  // falls back to the plugin's own setting it replaced.
  var _pluginsRaw = {};

  function parseDevMods(raw) {
    var out = {}, named = {};
    DEV_MODS.forEach(function (m) { out[m.key] = false; });
    String(raw == null ? '' : raw).split(',').forEach(function (piece) {
      var bits = piece.split('=');
      if (bits.length !== 2) return;
      var k = bits[0].replace(/\s+/g, '').toUpperCase();
      if (hasOwn(out, k)) { out[k] = bits[1].replace(/\s+/g, '').toUpperCase() === 'ON'; named[k] = true; }
    });
    // COMPAT: each plugin's own "Log to the Browser Console" setting (since GTTxCore 4.4.0);
    // remove when every plugin's map has been through a Dev Mods save, which names every switch.
    LOG_MODS.forEach(function (m) {
      if (!named[m.key]) out[m.key] = truthy((_pluginsRaw[m.plugin] || {})[m.legacy]);
    });
    // COMPAT: `DEBUG`, this switch's name when it was "Debug mode" (since GTTxCore 4.4.6);
    // remove when every stored Dev Mods string has been saved since, which names the new key.
    if (!named.LOG_BUTTON_VIS) {
      var old = /(?:^|,)\s*DEBUG\s*=\s*ON\s*(?:,|$)/i.test(String(raw == null ? '' : raw));
      if (old) out.LOG_BUTTON_VIS = true;
    }
    return out;
  }

  function formatDevMods(state) {
    return DEV_MODS.map(function (m) {
      return m.key + '=' + (state[m.key] ? 'ON' : 'OFF');
    }).join(', ');
  }

  // **One flag, `logButtonVisInfo`.** It was `debugButtons`, then `debugMode` as well, and
  // "debug" said nothing about what it does - log why each control shows or hides - nor that
  // it is not the plugins' own logging. Neither old name is read or written any more.
  function applyDevMods(state) {
    var c = coop();
    c.logButtonVisInfo = !!state.LOG_BUTTON_VIS;
    c.layoutEdit = !!state.LAYOUT;
    // A key in the same map every plugin's `anyStale` already scans, so the demo needs no
    // plugin to know about it: one entry that is not a plugin id, cleared when it is off.
    if (state.STALEDEMO) c.staleUI.demo = true;
    else delete c.staleUI.demo;
    c.logConsole = {};
    LOG_MODS.forEach(function (m) { c.logConsole[m.plugin] = !!state[m.key]; });
  }

  // The log switches from every plugin's settings as read, on whichever read brings them:
  // Core reads its own only on a page that draws something of its own, and a plugin logging
  // on a scene page must not wait for one. Every plugin's settings read comes through
  // `pluginConfig`, so the switches are as fresh as the plugin's own settings.
  function applyLogMods(plugins) {
    _pluginsRaw = plugins || {};
    applyColors(_pluginsRaw[PLUGIN_ID] || {});
    var state = parseDevMods((_pluginsRaw[PLUGIN_ID] || {}).b1DevMods), c = coop();
    c.logConsole = {};
    LOG_MODS.forEach(function (m) { c.logConsole[m.plugin] = !!state[m.key]; });
  }

  // **The UI Customizations colors**: the Highlighted Text Color - the glyphs (ⓕ, 🖬, ⸎) and
  // the highlighted text and warnings every ᝯㄝₓ plugin draws - and the result and background
  // colors beside it. Each is one CSS variable on the page's root, which every plugin's CSS
  // reads as `var(--gttx-highlight,#ffc107)` and so on, so a plugin needs nothing of Core's
  // for them and a page where the settings are not read yet shows the defaults. The highlight
  // keeps the key it was first stored under. Anything but `#rrggbb` is the default.
  var HIGHLIGHT_DEFAULT = '#ffc107';
  var COLORS = [
    { key: 'a9HighlightColour', css: '--gttx-highlight', dflt: HIGHLIGHT_DEFAULT },
    { key: 'd1GoodColor', css: '--gttx-good', dflt: '#84d68a' },
    { key: 'd2AverageColor', css: '--gttx-average', dflt: '#ffb648' },
    { key: 'd3BadColor', css: '--gttx-bad', dflt: '#ff7b72' },
    { key: 'd6AccentColor', css: '--gttx-accent', dflt: '#7cc4ff' },
    { key: 'd4ErrorBgColor', css: '--gttx-error-bg', dflt: '#7a3b3b' },
    { key: 'd5MatchBgColor', css: '--gttx-match-bg', dflt: '#3f6b46' },
  ];
  function colorOf(v, dflt) {
    v = String(v == null ? '' : v).replace(/^\s+|\s+$/g, '');
    return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : dflt;
  }
  function applyColors(s) {
    var st = document.documentElement && document.documentElement.style;
    if (!st || typeof st.setProperty !== 'function') return;
    COLORS.forEach(function (c) {
      var v = colorOf(s[c.key], c.dflt);
      if (typeof st.getPropertyValue !== 'function' || st.getPropertyValue(c.css) !== v) st.setProperty(c.css, v);
    });
  }

  // **The grays, from the Stash theme**, where Follow the Stash Theme is on. Stash publishes
  // no theme color to read, and a theme restyles through selectors, so Core asks the page: a
  // hidden sample of Stash's own dialog, card and muted text, read with `getComputedStyle`
  // under whatever theme is active, and the grays every plugin's CSS reads as
  // `var(--gttx-bg,#202b33)` and so on derived from it and put on the page root. Off, the
  // variables are taken away, so every site shows its own hex. Read every tick, so a theme
  // switched live follows within a second; written only when a value moves. The sample sits
  // in `<body>`, outside `#root`, where the shared observer does not look.
  var THEME_VARS = ['--gttx-bg', '--gttx-fg', '--gttx-fg2', '--gttx-muted', '--gttx-dim', '--gttx-card',
    '--gttx-sunken', '--gttx-raised', '--gttx-border', '--gttx-border-faint', '--gttx-border-strong'];
  var _probe = null, _themeKey = '';
  function rgbOf(v) {
    var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(String(v || ''));
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;   // transparent, or near it
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  function hexOf(c) {
    return '#' + c.map(function (v) {
      var x = Math.round(Math.max(0, Math.min(255, v))).toString(16);
      return x.length < 2 ? '0' + x : x;
    }).join('');
  }
  function mixOf(a, b, t) { return [0, 1, 2].map(function (i) { return a[i] + (b[i] - a[i]) * t; }); }
  function lumOf(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
  function followsTheme() {
    var raw = _pluginsRaw[PLUGIN_ID];
    return truthy(raw && hasOwn(raw, 'd7FollowTheme') ? raw.d7FollowTheme : settings().d7FollowTheme);
  }
  function themeTick() {
    var st = document.documentElement && document.documentElement.style;
    if (!st || typeof st.setProperty !== 'function') return;
    if (!followsTheme() || !document.body || typeof window.getComputedStyle !== 'function') {
      if (_probe && _probe.parentNode) _probe.parentNode.removeChild(_probe);
      _probe = null;
      if (_themeKey && typeof st.removeProperty === 'function') THEME_VARS.forEach(function (k) { st.removeProperty(k); });
      _themeKey = '';
      return;
    }
    if (!_probe || !_probe.parentNode) {
      _probe = el('div', 'gttx-probe');
      _probe.setAttribute('aria-hidden', 'true');
      _probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:40px;visibility:hidden;pointer-events:none;';
      // Nested as Stash's own dialogs are: a theme colors `.modal .modal-body`, and Stash's own
      // leaves `.modal-content` transparent. `.modal` is display:none, which computes colors all
      // the same.
      var content = _probe.appendChild(el('div', 'modal')).appendChild(el('div', 'modal-dialog'))
        .appendChild(el('div', 'modal-content'));
      _probe._content = content;
      _probe._modal = content.appendChild(el('div', 'modal-body'));
      _probe._muted = _probe._modal.appendChild(el('span', 'text-muted', 'x'));
      _probe._card = _probe.appendChild(el('div', 'card'));
      document.body.appendChild(_probe);
    }
    var cs = function (n) { return window.getComputedStyle(n) || {}; };
    var body = cs(document.body), modal = cs(_probe._modal), card = cs(_probe._card);
    var bg = rgbOf(modal.backgroundColor) || rgbOf(card.backgroundColor) || rgbOf(body.backgroundColor) || [32, 43, 51];
    var fg = rgbOf(modal.color) || rgbOf(body.color) || [245, 248, 250];
    var cardBg = rgbOf(card.backgroundColor) || mixOf(bg, fg, 0.08);
    var border = rgbOf(cs(_probe._content).borderTopColor);
    // A border that is the text color is `currentColor`, not a border a theme chose.
    if (!border || hexOf(border) === hexOf(bg) || hexOf(border) === hexOf(fg)) border = mixOf(bg, fg, 0.2);
    var muted = rgbOf(cs(_probe._muted).color) || mixOf(fg, bg, 0.3);
    var light = lumOf(bg) > 0.5;
    var vals = [bg, fg, mixOf(fg, bg, 0.15), muted, mixOf(muted, bg, 0.35), cardBg,
      // A log pane sits below the dialog: darker on a dark theme, a shade darker on a light one.
      mixOf(bg, [0, 0, 0], light ? 0.06 : 0.4), mixOf(cardBg, fg, 0.1),
      border, mixOf(bg, fg, 0.1), mixOf(bg, fg, 0.3)].map(hexOf);
    var key = vals.join();
    if (key === _themeKey) return;
    _themeKey = key;
    THEME_VARS.forEach(function (k, i) { st.setProperty(k, vals[i]); });
  }

  // **ᝯㄝₓ in a font that has it.** A theme that asks first for a font claiming these three
  // characters with an empty box (Pulsar asks for Helvetica, and some installed Helvetica does)
  // leaves the browser nothing to fall back from, so the name shows as boxes. Core carries the
  // three glyphs itself - Noto Sans Tagbanwa's ᝯ, Noto Sans TC's ㄝ and Noto Sans' ₓ, each cut
  // to its one character and renamed GTTx Brand (`.tools/cut-fonts.py brand`; SIL Open Font
  // License 1.1, `OFL.txt`) - as a family whose faces cover those three code points and nothing
  // else, put first wherever the name is drawn: every other character keeps the theme's font.
  var BRAND_FONT = {
    ta: 'd09GMgABAAAAAANQAAsAAAAAB2AAAAMEAAIAQgAAAAAAAAAAAAAAAAAAAAAAAAAABmAANBEICoEYgS4BNgIkAwgLBgAEIAWJRAcgG68GyB4HzukrRrxIhU4UXlK/gudpv19n7puPi1aShEL0BFW0mWXTBElEduMSyopfruUWbIWjLdGRLDCHDh6yN0nuUVWZGln98pUvUAzvvgAgwgHSrP5eNaViBDYFH2A0ohErpd4EI1QqvXDpILEG9Csl3SyxjMcgABrf69eJ9RFZ+jyqK3nOTJ45ewIthw1jAumVBkD19maqUVQREGuTaJMW0QAAOACA8jvfh447uZOO/fcKOlaFAigA8ZATEAAAAQzARR8KcNFPAECjUeD+/v8X5mMUBRBV17Q9eBk0oIB0QBUoggAq3br3RvU8qqB13/2B78H40olV751W6B475x+rbwXonvSwmphRPXsP/ySje7eVbhOdOGVKa29Vum1H62tnoT/7P1ufLMPTy3Gs9pItJ4EfYQPr9n4tIY36sSJs6bzsMBz8Ljgpus7DR8FDZy63AZ8nbeEAAAoQiv7J1y9N9jlfLfqMD8B9wr8zAHzOfi6CM2A4SBfADAFAAbuYsWqieXrQJkCkwVsJdE+nExqip+zZw0BpS2AaKhQuviDYsQaDAh1oQgImvAqBGUHlwZySmmFBVIuwJKILWFHUN1iTNxmwIWfaYKuCZO2V7EjbO8VIrsnIJFIOigQiEXQjpaAzxCHogkFKFMFBmwpOihgWmpFynJy1xOdLZK+/eYHzCKTKpxGHxIjmWD6HSXCMVsfM2nfjRgPaYjCadEVJFCoYM43Cxeco7J5hFTi7uTOLsncUw8rUNRTxBAKhhMWDxV5LNmMhBgUMRlKq3l3LEImf30dIokJBhzTBc4pYNTTlTR90/ERGSz7RDuVan+y+oTDVxqcUCXFNiLpLo0t7AQckXt/nPIn33phtCRWOexw+yFWN+2HWcgpSVr+RckzujQ2ha3bk1FmmFWm5ioygaPaP0aJqpJVJusEWuHboBDpnyOuu/AmsWRg8CJrQdwSSMtwyHLusGiZTwfB4k/VkEGIzbbqs250lmCOyREoFco7lsTp9Cw8xEr5ze06AfB/q7f+kJAA=',
    e: 'd09GMk9UVE8AAAZgAA8AAAAADXQAAAYMAAIBBgAAAAAAAAAAAAAAAAAAAAAAAAAAGYFSDYMmGyAcQgZgDggANAE2AiQDBgQGBZBCByAXJBgGG2cMEcXEJvhDgXaEZRfmHcUjgpNujdBq/9Go77qB1cURqcCxM6oU+KPII47op6xub2IUfAmeaoz9273DVULCE0MUbWrVG0PVRmhE74SG/3//x7xbRdF/o49bg0aJDSStOKlK1+ITrODhY+335759mGTR0DwRJXkVsek0PDE0Kpko9l1K0ekmO3Xz8e31d+EQzArksaFhlwWYyNhA4dbesGW2u2270dOujBMPPKIPMfFI27Xv9DPXSai6lnNroD+3r4s5iZI4w8qT9RdgR3ABoZ26+WsWRRAlmvWBB7wGZpFlHIZd1tbJOX676LcLZdQCS+I0gxJZltn//8vU/DNAA5jyUnDOgi1iLHf+1ruFkr5V/wmV1rx7wHqnVoAWKAIdNBgQiT/t1cztv5D1hIhDCLFI29s+9U0hwNmAAhbHjq6pDjxTR64COsdYBnTeOBt4lowzgWfZiAsoRwDKihQr0S4OAMNy583fIkwXmNTCdMQSyC5MpdH5zhCbIDHVjtN7an4wkZl3dx0gJoPNICG+Sa0Pz1b0x68yofeU8jd7nCLLW8in1NMc2Sf2HwfmYfNqq4ltCVByPHC3muH/aRpelfTVitxvhvjXIOcY4ug5uPKUX+rzf26r3+1E3IQzPnq4AyvBervD4x2OetzHZVU7M7qThODfQLr3F1/c0F+gyXouVldBmCOn1cY4rzvlbOyHSw3VlNIQ35+K/UMBhjh8zFwhjvsQGqLjpb9oTeru1wMHrMLyLz/a0G/rl4xb/de5f9DN1KuoZvhKOWH3zxvbR1G7vaXLlSPn+kb6ycX/A5TR3/4744euq54/y8L4sixfTHdi+/W3+Sp+pPfO4vB98easeMVL0RAXn7eBxPY7zE8z3aPxjvI7b6/qiwOBAFfhIokjruKxgP8/ALS5laodYxGLWMQikxGI4nKTPMYhNvQgkwK0pSfLqGA0AC1ygBPBGbRr6lsMglCjmOfETKQjsHthAxCA1jLeIJojgVkHgAID/BmS2la0ss0FOdX/04XHuw8CcF8NR7bP7wO//QET8w68bo5G0qbx9MAniYYjXwE/ALv3f8V80SmRnEAnISG8ZlocdAMFXu4wSdYF6AdtIvz1i/I0Jka1kljxrsTBkIs4io1KcVIf4+LMNc7FJfZjJa7hamrFTWW2XdzlZ1fFI3OYPV3HU35evymbXNly5OP6sQidj58LWhIkgsBnOSEa90Kh/VlKMdTfXomRWugLZUDTDkAbM5zEGspsVQxeTAZj8Ntz9P4J8LYiHhJfMM6fEPMsXbEhtVSn9Q9yPGOC2QFny5BKDz5z60HNKCG5ZQodIOjkK8q1K9dOXcjpt/Dyo38hTssDBpA1JPKVZSVAXw0GCMlUEBhxYsqSpmtHpMQ+Z25kY2jkr0cTLbBfuLnOUDxlKewg4zsQIY1R4AOEH6eQUk+y3UWNnPfFA7BkCrkIdClgaMsRvJoaYbllzwGGUIm+quOIWZWKFWOjG5VI/SBDEms4Jhp8feJ48GDTXx9uK9pzeeh8BxlCfuiA7NtkwFjL3AA8Hy5+hkLi44woOiA22bU4Dfyf7s6mgeliPVEF1ZCeGT0JIW7SHMY7qgxmRMv3vugqxQmkHkxlRpMKek2DkQKKCWCwWM6SPnDCeB6NiILXCSCmesetSlpMWbKDWKuquezE1p+h9VczepVpfAFD2fLuVQtrIzBnpy2Z2meSB8cNyzFDaTedL2ERy7w9cM+s2ETI1clshVFD0awlCml5fSX6yKn5GyTlXvMEAqL2JURDaZX47erKgMghpOnIFFgwTXQME6cg9X3QqFFnOJ89EMgktQU3RrZEpkbTJM63WjbAiG/jD+1YqO8H/zKiDS080mPTsrb2v9FGeghYjxoMLXpVFwS06b3qI49/PM0RFRwJZFUit+YfNJi+BFKvbdX1FbujKnn5Eeq7EqTIGvpcE7PSjBSoqjhhZJZYjaohMBAqOoC0D1zSJBI61bK6Sjg2YHTYQIq95f0xPVMxdzLl6D/QizGrITzFsyoKYZnQQt/UcyBtnDtpGuVOvv43H0zKO6hIcoGoSMKDAAAA',
    x: 'd09GMgABAAAAAANMAA4AAAAACAQAAAL8AAID1wAAAAAAAAAAAAAAAAAAAAAAAAAAGhQbIBw2BmAANBEICjBOATYCJAMICwYABCAFijQHIBspBxGVnHoEXyZwmyp8Vg9U1HF8vMXWtoNOCJ1WY5d+BDXNe83xEL/ftzPz7oo6EDWp1bWEeSompZBFE3lDQTUUiPxLncolHNYfg3LiAlCIpvYMMgQkn/QO8LRkagDk5O05bMCFiWLiww3A5Tg9/0E57ftL9S5dDziz428CdMQRq8U3BeiDpFS6YGsgsQCHS7NMyL4FLBSwjMe2GTb4S0MRESJHhMhzeEagFRD6Gs1GjYt9B3I10qhADQRswY02K580fHoku2T2vGQdMnvFRE5mnY9Byd1xh2yS19ZaOLpqFsdsjD1kS12WupJZAAFwsFj8IK/ApJL+v3ImrhMiIAdzjUkFiQq9KoFexSSKIpi8X6PinIB0nM4dgwSFbGp9iB4QrSvL+0sr+4tLe8uLe1dfBqun1qg1ehqu5v9Pv4u/xSMBgaxer511x4+3/XW7+oOPy893uxzU1nK+EfUSBDFLuWoKaI25k0MdmauOaU0Fcs1Tu2MdXq6L0oSnZIfQ6ylSuzVUdpE3KGZjEHUWtW2oNx130GCf9hCNNsQ/NFmXk2h2Yu0QWuzIB2i1LX+hLaarae3bbS37ZryIcCQDz0cwMoYBNZ9BQaCAkhRtZiM8RegLqSDmI4bqWte9AP3Iorbo6Rz8r7uCo9K7JgY87UnGOml7JINuN7DjH7XaEJ6lyZ0K86KuKY3D4FuAWEChIkttj3GMbDCpguc5GDSTPbsBRNeMUPj92wixfpZe0lN6kT5zzqyWlBFp6X5cBgpMaJSmw3rCDmQs4UMI7xiDXO6F5sVPcBQasl+ArPes9OCL2wMcfGXR3d7+GjN7x3cxB6wRYOyOF0NT8CUZoRHasv1aROmKaXYwLVAvZDdjlseSrE2iQxy9F3tBUmHkBJEqxBLPvzNLqKZMHKReYWCMcaoYV2kw4sGVBCzVoepXDoph77ngzIGMVH/amKVzrKSD7ncTwr5Zn4ppkZAflJJg3udTebcbr6HCvwFlyyBERVXQpUJ6evE95+b6EE4GAA==',
  };
  var BRAND_CHARS = /[\u176F\u311D\u2093]/;
  var BRAND_PREFIXES = ['gttxcore', 'cfbe', 'enm', 'fretc', 'cpt2s', 'npt', 'ptp2re', 'sfm', 'svr', 'tbc', 'dsp'];
  var _brandBody = null;
  function brandFont(ff) { return '"GTTx Brand", ' + (ff || 'sans-serif'); }
  // Our own dialogs and tooltips read the page's fonts behind GTTx Brand from a variable, so one
  // opened between ticks has it at once; Stash's own text holding the name - on the settings
  // pages, where the plugins' names and descriptions are - takes it on the element, once.
  function brandTick() {
    if (typeof window.getComputedStyle !== 'function' || !document.body) return;
    injectStyle();                        // the faces and the dialogs' rule, whoever opens first
    var root = document.documentElement, st = root && root.style;
    var ff = (window.getComputedStyle(document.body) || {}).fontFamily || '';
    if (ff !== _brandBody && st && typeof st.setProperty === 'function') {
      _brandBody = ff;
      st.setProperty('--gttx-brand-font', brandFont(ff));
    }
    if (!/^\/settings\b/.test(String((window.location || {}).pathname || ''))) return;
    var app = document.getElementById('root');
    if (app) brandWalk(app);
  }
  function brandMark(el) {
    if (!el || el._gttxBrand || !el.style) return;
    var have = (window.getComputedStyle(el) || {}).fontFamily || '';
    if (have.indexOf('GTTx Brand') === -1) el.style.fontFamily = brandFont(have);
    el._gttxBrand = true;
  }
  function brandWalk(node) {
    var kids = node.childNodes || [];
    // An element whose text is its own, with no nodes under it, is read by its text.
    if (!kids.length && node.tagName && BRAND_CHARS.test(node.textContent || '')) brandMark(node);
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType === 3) { if (BRAND_CHARS.test(k.nodeValue || '')) brandMark(k.parentNode); }
      else if (k.tagName && k.tagName !== 'SCRIPT' && k.tagName !== 'STYLE') brandWalk(k);
    }
  }

  // **The plugins' own glyphs, where the machine has no font for them.** Their defaults write
  // ᱜ, 🞮, 🛈 and 🖫 into custom field and tag names, Stash's pages show them, and the plugins draw
  // ⓕ, 🖬, ⸎ and ⮺: Windows has them all, a Mac or a Linux desktop without Noto may not. Core
  // carries them as GTTx Symbols - cut from Noto Sans Symbols 2, Ol Chiki, Symbols and Sans
  // (`.tools/cut-fonts.py symbols`; `OFL.txt`) - and names it last after the page's fonts and
  // the marks' monospace, so it only fills a gap: every character a font before it has keeps
  // that font. Off Windows only: there the fonts are known to be there, and the family named
  // last with no face behind it is skipped, so nothing on a Windows screen changes.
  var SYMBOL_FONT = {
    sym2: 'd09GMgABAAAAAASwAA4AAAAACiwAAAReAAICDAAAAAAAAAAAAAAAAAAAAAAAAAAAGyAcIAZgAIEQCoREg3kBNgIkAxgLDgAEIAWJUgcgFyQYDhveCBHFzCP4cRi7oRfCtXGtA4MTDaNNY9TqW7oHD71OfR9MkhwvAaXx5RSGMpNdWnEiwIkQKKLd7HkqIUYpCCXK+H1zeWVjvyxu0qi+c2W0wVkITZYOlD+nerZmdrcsV8jSFNUJ2SpbY5hk2QFaAnWnS6rxdRTfB0AjUNh/xUKheSLRTMv8WyJiTp2aqn3Uf3sIwCBIPKJGrQYt8KIB/v8HALa/VpXFInaQIdkGqO9nE50oFNVQIMHhydZu3Li2OJq1//9/nfM3hM6RowABIG21DThIQAMKSAY0UAOFAJJRGEANNA6g0Qggm92pr9RHAGAB0AAAcEHmjxouxNcN6tCIrxvVoRDfzqqDQHzf3AwJgJt+dCRwAHwDANoLBRrPqpGRpra8OmBFxGil6HW7ddfQNSKmXidm+CphyhXSKnydiKnXiBG6QphytaRzaL+YegAt597bRpmydSuDWqIWJ29V1xXAwNSjAiKiZ/jCDjF1+3kjdHZrf6KlGRaH3QjtlJO2bOWaesQMhA+xphw0BpliqukPA8SuA6WljBCrvV9ZLYVJC3vyNqYwaitT+KWBwlQWbfzCEEbL+2V/m3ZeVWvSpFqrOne2eq+PmDrHyzq1bDirbK9eZWc1bCh60QtTQzlpg5hoHYxPjCxVEIystXxIzyFsjh8//oIKjRvnSsefv3D+/Phx9dgkv32zqKBCQcIJJ2ZlTMOjTqXHjvOokuOXPXLyq1XLuuiJixt5mmQ71kWOGlU6mBgcHCwMDomT0pSUMUdtO6oIj/a17SGpxpWvVa533TptTupce27ltvYb+3Vh7KrYlQX2dXvxgwa7GpBy9e27q0Vx35GxY4++WW3ff93pm9C88DwACEBKa8W3r3weqPDVq9QLgCsfqoQBDxtd+UjR/83qnKoBuJHd5t/cr/5AAorM31aVccs2dC4B+aU5CJpZ3AKlh2zxomUdtM7qQKf9FLF84EEEgm0DUoSdoNTwD1p6bnApUS64pVYHPGo0gldm28EnvTtgqDa7YKo0tcBSYWaAv0R59KlGKLU9co1N1hxD0QLIpDIZ+KEReMMCBh8c1iK1AC5FgcYcDw5ZekMx8eaSsGLAg6KKUGODxEj+rxIbBV7CWxtUWM87cu/HjxX4Bl7eF6JEvZKDmdBG4XAeZS+q+PEERyzqH+J45oARZIRU6kLtVLWctT6DanhQQrVTapABVe4Akxe/x5jSI/BoVBNe8RKjaxNgJCxeMUaqI3yDpmCr6T9Iabh9LtKAyho4mg03+MTbm6traUYENUdrAohCLUnoRUKhDY9oJ1G9IGqY6A+9Us9dosLwvcZwsFwrJjO4Uc+okZGf1xEj3GDnCZmv/vboBbwPp48D6C8kdNo5GejcaM071HV8awYcC3GZhHiqt/Ysd8ZcsncufUaTgzlsWNir99c17REWRupXITBHSby789Id2qF0/huFXr+Lrfez1ItjhZeTrCf/H+0B/uqWbHK/xtkA',
    olck: 'd09GMgABAAAAAANsAAsAAAAAB+QAAAMfAAIAxQAAAAAAAAAAAAAAAAAAAAAAAAAABmAANBEICoEwgUYBNgIkAwgLBgAEIAWKLgcgGzEHEYWUUfxMiMccTSUIxswvFCu/u/euj6eHk727/U2TIAginAVBnEQcJxClEmXQft9m34mZxasiJpgmGkR+AGzq8ttOi8ZHOwWemPeADAErZ8lJ/n/u5+sibRO4C3yAG+lEMjGaI4uTdny8442RFCk6m+YH+m9TSmrPCIew1iREQjzELUx1SQ1W6JsKBtxGv/KELrHFGDRwvXs5YUc8vHnRa/x/B3oXogAI0BN1BhcABQs4gg4BZnrSgAkmcA6n0Qri2yACyMhCwyWxmAEBO3hAGQzZY8qenkjuMw5mK398FPFvGts6Yy17QApyHrk19Pl+ngycsP7VsbHhxb6B1+W3/VzIpId9qTCWmIIo+8EUN5kCh4RUExfbGB0z+/RgfnpxXmU5U3dD9UDeRG1DQfJg/t46pgrW0vTroq03Yup2agoOiiYGNt6iSpPuayrFsipMsmK2vEUNzyEKWbahCfoABNTh9IefdFFc5n+Zueh+g98T73fwN/L5qEP7R2VTj7ChAAF3tf1ySNDoBIEJaIMRWYQ6GmsP88NMB2tYkGEBfGAChDC6gMJpCejYOwB6yoQZGPhHGxgpkgJgYp8xYKZK/gAL5woDK9tGAxtLqg/YmVOfgSOydOIPz8mQ3hJ2cOq30VsncJAdHMCvQ3gnIfiMVGMpcJXEUWSYO5GeL7S2XlwqVEmdDrL3NhSENbWb0vnGLx5+fyf42XYF89X4G21q83jVA3YnzO0wcyq4O7IQQv5jZL9vgAOVZYeXIGLyJHQbg6h7D/vqjJCPmE83x1VVcUC+zmaTfT7SM+SQGPMKOyZzA2R2fyCyLcJTKNUb+W/e9mv+fv+tD5ZvvEXzWBv7i3m3BvQrevxLhrfyIRnjcfdZWEGxBRXWCi8aFSphV4xPh7Ims6NFtSiJWCNaoqY7IVcGyZIqz8+A0JrqPqpU+HEYGV1Ho5A3rfUlBjZrTMGYIloSpinx5+kVPrRrg3ztqwxqnT9wqH0+EaazoHp2QBxD7uNjLNq1akyjsDrur74mveUCsitjQMf/QS+s2LeKotUf96+7xj3kROs4AAAA',
    sym: 'd09GMgABAAAAAAN4AA8AAAAACFgAAAMjAAIAxQAAAAAAAAAAAAAAAAAAAAAAAAAAGhYbIAZgADQRCAqBJIFDATYCJAMICwYABCAFigwHIBckGAYbbAdRVEh+UvxIsG3RpytEHwjVq3vx8P7a57lvZgtAEE8kfyuJ3NY2ja9C1ADoiGZ/um9aM57SbzKd644EqaUPQiUAri7VlIYHmrIp+IAhjsimNvvJzXuw2pdG/5xGGU8oYB0bYANt45WUs8jucsQSb0agGiCQhBCoopkWYtyEafNUkkNRAPJsSRxQRtqVFmFqOGGs0CfGkKqWpbwsTykHcgATZ86c6EK7O66l7Ma/a7irpCEISI3SLbQCCRnqyQSJzLVC3hu0u1MUmPGom4B8NFRrQnjJkTMMi8AtkNWLyepdd0nsuEeq7r5DlG7XF+wuRRKvr1fZRepKuLkwqxJTKbZl+/c67o+hqirpy4D5R0euXz/y6PwFI48UsAJx4Ugle2TB/AbEliMLBk4pDVi9ekBpypQMFrDCbAq9ydqlWoOab6qzfU3LYx437jam/pw+c2oBgeRqz2cbmq6sOexbpZrZe7j97fYbeH7hkLKouJkdyAIVJBAcLQ7BLh6LLJQxDyktsgKn5uGGyYZr051qOiUTeWWUUwGhkXJIajgJmXEuQa5TVIAy86IHVNAhdkJF4+IEVNIlPkNlnVIDqGJMGgFVjUglqGZYOgfVo036/V/XMCBvZqzF1E0xOM+wmC0W8OsR3okJPiOVqBmuMnuKCU48c5cOReEC+6yEpqZoiclSy6lIU6OoTqcPv78j/DS/3ze6XMvY1QzkOJzsJjJllSbDp0D0H3f7RIFaWIjZbHkEZiszkw8tw0k/FzuxEtvLtVkroSVMLrFy/cyQQAI/SoNNx8gKyF7vgcjVCK+vN+KNWuKpQ3gaXnTrtbrZT63uTm9x93Y3/xdl0/QqNKAmAIk2Tq6KN5MSxSEZE24XypdDHCpeUD8FhKFZgxqGmTibwP36Ey3fv0QKP6dIeTjVKp75tjpobNNu87nCYkgs81/h/zy9wsfcxhbe+ApjudB+UZZ5IpP6e7qzK1/Atl6GWqqbLg9/jYKk9OqrYjof4GfSpP99sft/FhERavELoisYM00wbSiViWMW5X2cI2qJr/+rZe9J139HWUEAgGhu/E/XAQAA',
    sans: 'd09GMgABAAAAAAQMAA0AAAAACOgAAAO7AAID1wAAAAAAAAAAAAAAAAAAAAAAAAAAGyAcNgZgADQRCAqCKIISATYCJAMICwYABCAFikQHIBvpBxGVnJxkPw9jY+XhkVD3Hcny8seuSHQvB/F8XVbv9x+2AnYmycK98IlWzwK+wkcZdx0zqJN1D0LRgYuKWC/niuQbs/IwPQLFLH8m2HI6yeZAm3fq/+dyer+tZ3nvN+gWUMSJzI33fuP5ATU23WmTel4UUIdNoA24gSINSDNdbi5PYGI3s6ZnI0CcBEVIi1YdehBFA6RSANDnqE1dtJ43fO60CZQbPW3k+Ng+YeiMSb1GA/u1aiqbCIFaowa0j9fKIGpLM1BmSOmQVh4nAOC9aN25c2suV3eqO7payTvoEbIWEACVp+4CpdCAAgwgCwMBstCUAjQagepOKmUKnvwRQELq17gAKAA0YAKjgRmgAVWmo7VOmKZ+W3d+sje3CfbvJ4j/RA8xGSI2E8RlSPKS2QWCbVk21vbtBOc7114UuZbYOyoG2eZOcaSme4jgsNlRkRPfBoHL2Lpi0iPoIfckeeBAGT/ady/HCzMvdp7oleqasPuMz6hYLf9rwQr/pN9wqX/T77jef+kfauc1z/fqeJEG2ef8c9kNIvl1vfwW+U7/O/6d/g/ST1c5ne6UcQp5ol3WjzsV/+hC2xVIYGLy5hwfeNL313WaWFCqacLuMyA9c3qW9xUABFDGq40v93qD3Qb/ohHjN8CH4NkvwLfhl0/hlnw+Q3+rxAdhCoDge+LfY+OGgc5MUevj15AKUEb7GSD0Q66zDHIx4CQEijx/qDgeoqGFf9QqVQpDetQGwyq0DyNadBWjqiyMMZVWE+OGrA+aGu00WhrsP9qVMWr/U0f962FCy70ZIV8AgYaahgZwFZDAnoY0cGRoEYlDYMRBAc2wQEEAoZw14PH4QijgMASnpTwZDWmKlkGWJ0GhUKbKZ0hSrIof7ddLJEJc0cLV1Qu4eEsxWsI6k3xOgjIjtMCdBoXLeVoOY2eDirjwTjKs8PgMaCBq6tqGAEIK5SAtiFO45RUPdUQP0UJ0VbUJbUzcy9Co6p2HFoYsQEG9QQlS2k8xeGYhWNA0/5AEtrYmiB39GfSWt6ZWUMo/JPiLVzJ8FE3JKxv95VcSlbZ8SxIA8waotzCjtAKsGJLA/aIsF1QcQrCwk3rmU4R/sU6asT4Zo9swPFCVHqsbFlrIEcLSVfDImTltCVweltDzoUGGe8NUDR4/Yx8g4QQIMBlkVv3FyhY4bKjOFlVvYaj0JBnUg2WYqf227CQFPVAOlSj2+ZknM8OUUeZGTmI+GgAek8VZKOdQsISlBGH+Kvg8B3NbgHzLfKX2qQ0AAA=='
  };
  var SYMBOL_RANGES = { sym2: 'U+1F7AE,U+1F6C8,U+1F5AB,U+1F5AC,U+2BBA', olck: 'U+1C5C', sym: 'U+24D5', sans: 'U+2E0E' };
  var SYMBOLS = '"GTTx Symbols"';
  var SYMBOLS_ON = !/^win/i.test(String((window.navigator || {}).platform || ''));
  var SYMBOL_FACES = SYMBOLS_ON ? Object.keys(SYMBOL_RANGES).map(function (k) {
    return '@font-face{font-family:"GTTx Symbols";font-display:block;unicode-range:' + SYMBOL_RANGES[k] + ';' +
      'src:url(data:font/woff2;base64,' + SYMBOL_FONT[k] + ') format("woff2");}';
  }).join('') : '';
  var _symbolsLoading = false;
  // Stash's page font, from `<body>`, with GTTx Symbols after it - once: the theme's fonts are
  // read as the page loads, and a change of them shows after a reload. The faces are loaded
  // outright, once: Chrome loads a face named after an installed font only when that face is
  // asked for first, so behind monospace or a theme's font it stayed unloaded and the gap a box.
  function symbolsTick() {
    var b = document.body, fonts = document.fonts;
    if (!SYMBOLS_ON || typeof window.getComputedStyle !== 'function' || !b || !b.style) return;
    if (!_symbolsLoading && fonts && typeof fonts.load === 'function') {
      _symbolsLoading = true;
      injectStyle();
      fonts.load('1em ' + SYMBOLS, '\u1C5C\uD83D\uDFAE\uD83D\uDEC8\uD83D\uDDAB\uD83D\uDDAC\u2BBA\u24D5\u2E0E')
        .then(null, function () {});
    }
    if (String(b.style.fontFamily || '').indexOf('GTTx Symbols') !== -1) return;
    b.style.fontFamily = ((window.getComputedStyle(b) || {}).fontFamily || 'sans-serif') + ', ' + SYMBOLS;
  }

  // Whether `pluginId`'s Dev Mods switch has it log to the browser console. Read at call time.
  function logsToConsole(pluginId) {
    var l = coop().logConsole;
    return !!(l && l[pluginId]);
  }

  // Outline what these plugins put on the page, and say whose it is. `_coopOwner` is
  // already on every button they inject, for the ordering protocol; this reads it back.
  function layoutTick() {
    var on = !!coop().layoutEdit;
    var marked = document.querySelectorAll ?
      document.querySelectorAll('[data-gttx-owner]') : [];
    for (var i = 0; i < marked.length; i++) {
      if (!on) {
        marked[i].removeAttribute('data-gttx-owner');
        toggleClass(marked[i], 'gttx-layoutmark', false);
      }
    }
    if (!on || !document.querySelectorAll) return;
    injectStyle();     // the same reason: nothing else on this page draws ours
    var all = document.querySelectorAll('button, a, span, div');
    for (var k = 0; k < all.length; k++) {
      var owner = all[k]._coopOwner;
      if (!owner || all[k].getAttribute('data-gttx-owner')) continue;
      all[k].setAttribute('data-gttx-owner', owner);
      toggleClass(all[k], 'gttx-layoutmark', true);
    }
  }


  // ── Right-click Paste in a Tags / Performers / Groups box ─────────────────
  //
  // stashapp/stash#7139: those boxes offer no **Paste** in the browser's context menu,
  // while Title and Details do. Ctrl+V works from the same box, which is the whole clue -
  // there is a real `<input>` in there and the paste reaches it.
  //
  // **The input is a sliver, and the right-click misses it.** react-select v5 sizes the
  // search input to what has been typed: `.react-select__input-container` is a grid whose
  // second column is `min-content`, so with nothing typed the input is about two pixels
  // wide. Right-clicking "in the field" lands on the value container - a `div` - and a
  // browser offers Paste on editable elements only. Nothing was removed; the pointer
  // never reaches the input.
  //
  // So the fix is one rule widening that column, and the paste then goes down the exact
  // path Ctrl+V already uses. **No clipboard read and no menu of our own**: a custom item
  // would need `navigator.clipboard.readText()` behind a permission prompt, and then a
  // write into React's controlled input through the native value setter - machinery to
  // reproduce something the browser does correctly the moment the pointer is over an
  // input. The chips are flex siblings *before* the container, so the widened input takes
  // the empty tail of the row and never covers a chip's remove button.
  //
  // `classNamePrefix: "react-select"` is set in `Shared/Select.tsx` and
  // `Shared/FilterSelect.tsx`, so the class is Stash's own and stable; the rule is
  // theirs to break, not ours, which is why it is a toggle and off by default.
  var PASTE_CLASS = 'gttx-selectpaste';

  // On `documentElement` rather than a node inside the app: React owns everything under
  // `#root` and would drop a class of ours on its next render, and this one has to hold
  // for as long as the setting does.
  function selectPasteTick(boxes) {
    var root = document.documentElement;
    if (!root) return;
    var on = !!(boxes.length && settings().a2SelectPaste);
    if (on === hasClass(root, PASTE_CLASS)) return;
    if (on) injectStyle();     // nothing else on a Scene edit page draws ours
    toggleClass(root, PASTE_CLASS, on);
  }

  // ── The counts on the Tags, Performers and Custom Fields headings ─────────
  //
  // "Tags" above a tag list says nothing about how long the list is, and on a scene
  // carrying forty the number is what is worth knowing before reading them. With the
  // one setting on, the heading reads `Tags (40)`: Stash's own word, the count in
  // brackets after it, on the details view and the edit form of every entity that has
  // one - and the same for `Performers (3)` and `Custom Fields (5)`.
  //
  // Three shapes, read off Stash's source (.docs/stash-reference.md):
  //   Scene, Gallery, Image details    `<h6>Tags</h6>` with the `.tag-item` badges as
  //                                    its following siblings; `<h6>Performers</h6>` with
  //                                    a `.row` of `.performer-card`s after it
  //   Performer, Studio, Group details `DetailItem id="tags"`: `.detail-item.tags`
  //                                    holding `.detail-item-title` and `.detail-item-value`
  //                                    (nothing there lists performers)
  //   Tag details                      `DetailItem id="parent_tags"` and `id="sub_tags"`,
  //                                    the same badges - a tag's own two lists count
  //                                    under the tags setting
  //   every edit form                  `renderField("tag_ids" | "performer_ids" |
  //                                    "parent_ids" | "child_ids", …)`: a `.form-group`
  //                                    with `data-field`, its `<label>`, and the select
  //                                    whose chips are `.react-select__multi-value`
  //   Custom Fields, details           `.custom-fields`, a `CollapseButton` whose word is
  //                                    the `<span>` in `.collapse-button`, over one
  //                                    `DetailItem` per field
  //   Custom Fields, edit form         `.custom-fields-input`, the same button, over one
  //                                    `.custom-fields-row` per field plus the empty
  //                                    `.custom-fields-new` row for the next one
  //
  // **The count is read off the page, never off the server.** This plugin reads no
  // library, and the page already holds everything it is about to count: a badge or a
  // card in the details, a chip in the form. A tag badge is `TagLink`'s
  // `SortNameLinkComponent`, the one `.tag-item` that carries `data-sort-name`; a
  // performer's or a group's badge is the same class without it. **Not the link's
  // target**: on a scene a tag badge links to the scenes list filtered by that tag,
  // `/scenes?…`, and a first version that looked for `/tags/` in the href counted
  // nothing there - seen live. An `<h6>` is the tags heading because tag badges follow
  // it, and the performers heading because performer cards do - never by what it says,
  // so the locale does not matter.
  //
  // **The text node is edited, never replaced.** React holds the text node it rendered
  // and writes the next value into that same node; `textContent = …` on the heading
  // would swap it for one React does not know, and Stash's next update - "Tag" becoming
  // "Tags" as a second one is picked - would land in a node no longer on the page. So
  // the first text node's `nodeValue` is rewritten, the base text is kept on the node,
  // and a value that is neither the base nor what was last written is React's and
  // becomes the new base. A DetailItem's trailing colon is a text node of its own, so
  // `Tags:` reads `Tags (3):`.
  var TAG_BADGE = '.tag-item[data-sort-name]';

  function isTagBadge(node) {
    return node.nodeType === 1 && hasClass(node, 'tag-item') &&
      node.getAttribute && node.getAttribute('data-sort-name') != null;
  }

  function countIn(root, sel) {
    return root.querySelectorAll ? root.querySelectorAll(sel).length : 0;
  }

  // One row per heading counted, all under the one setting: the edit form's field, how
  // many of its things one sibling after an `<h6>` holds (none where no page draws it as
  // an `<h6>`), and the DetailItem that lists them where one does - or, for a heading
  // that is neither, the `box` holding it, the `head` inside it and how to `count` it.
  // A tag's parents and sub-tags are tag lists; custom fields count their rows.
  var HEAD_COUNTS = [
    { field: 'tag_ids', item: '.detail-item.tags', itemSel: TAG_BADGE,
      after: function (s) { return isTagBadge(s) ? 1 : 0; } },
    { field: 'parent_ids', item: '.detail-item.parent_tags', itemSel: TAG_BADGE },
    { field: 'child_ids', item: '.detail-item.sub_tags', itemSel: TAG_BADGE },
    { field: 'performer_ids',
      after: function (s) { return s.nodeType === 1 ? countIn(s, '.performer-card') : 0; } },
    { box: '.custom-fields', head: '.collapse-button span',
      count: function (b) { return countIn(b, '.detail-item'); } },
    { box: '.custom-fields-input', head: '.collapse-button span',
      count: function (b) { return countIn(b, '.custom-fields-row') - countIn(b, '.custom-fields-new'); } },
  ];

  var _headCountNodes = [];

  function headCountLabel(base, n) { return base.replace(/\s*$/, '') + ' (' + n + ')'; }

  function firstTextNode(node) {
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3 && /\S/.test(c.nodeValue || '')) return c;
    }
    return null;
  }

  // `{ node, n }` for every counted heading on the page. Cheap, and asked before the
  // settings are read: a page with none of these needs no answer (§8).
  function headCountTargets() {
    if (!document.querySelectorAll) return [];
    var out = [], i, j, c;
    var h6 = document.querySelectorAll('h6');
    for (i = 0; i < h6.length; i++) {
      for (j = 0; j < HEAD_COUNTS.length; j++) {
        c = HEAD_COUNTS[j];
        if (!c.after) continue;
        var n = 0;
        for (var s = h6[i].nextSibling; s && s.tagName !== 'H6'; s = s.nextSibling) n += c.after(s);
        if (n) { out.push({ node: h6[i], n: n }); break; }
      }
    }
    for (j = 0; j < HEAD_COUNTS.length; j++) {
      c = HEAD_COUNTS[j];
      if (c.item) {
        var items = document.querySelectorAll(c.item);
        for (i = 0; i < items.length; i++) {
          var title = items[i].querySelector('.detail-item-title');
          var value = items[i].querySelector('.detail-item-value');
          if (title && value) out.push({ node: title, n: countIn(value, c.itemSel) });
        }
      }
      if (c.field) {
        var groups = document.querySelectorAll('.form-group[data-field="' + c.field + '"]');
        for (i = 0; i < groups.length; i++) {
          var label = groups[i].querySelector('label');
          if (label) out.push({ node: label, n: countIn(groups[i], '.react-select__multi-value') });
        }
      }
      if (c.box) {
        var boxes = document.querySelectorAll(c.box);
        for (i = 0; i < boxes.length; i++) {
          var head = boxes[i].querySelector(c.head);
          if (head) out.push({ node: head, n: c.count(boxes[i]) });
        }
      }
    }
    return out;
  }

  // Returns the text node written, or null where the heading has none.
  function headCountPaint(node, n) {
    var t = firstTextNode(node);
    if (!t) return null;
    var cur = String(t.nodeValue);
    if (t._gttxHeadBase == null || (cur !== t._gttxHeadBase && cur !== t._gttxHeadLast)) {
      t._gttxHeadBase = cur;
    }
    var want = headCountLabel(t._gttxHeadBase, n);
    if (cur !== want) t.nodeValue = want;
    t._gttxHeadLast = want;
    return t;
  }

  // Stash's own word back, only where the node still says what this wrote.
  function headCountRestore(t) {
    if (t._gttxHeadBase != null && t.nodeValue === t._gttxHeadLast) t.nodeValue = t._gttxHeadBase;
    t._gttxHeadBase = null;
    t._gttxHeadLast = null;
  }

  function headCountClear() {
    _headCountNodes.forEach(headCountRestore);
    _headCountNodes = [];
  }

  function headCountTick(targets) {
    if (!settings().a4HeadingCounts) {
      if (_headCountNodes.length) headCountClear();
      return;
    }
    var live = [];
    targets.forEach(function (tg) {
      var t = headCountPaint(tg.node, tg.n);
      if (t) live.push(t);
    });
    // A node React dropped went with its page; one still on the page but no longer
    // over a list gets its word back.
    _headCountNodes.forEach(function (t) {
      if (live.indexOf(t) === -1) headCountRestore(t);
    });
    _headCountNodes = live;
  }

  // ── Undo History: the journal's store ─────────────────────────────────────
  //
  // What a write changed, kept in this browser's IndexedDB so it can be undone after the
  // dialog that wrote it has closed. The design is in `NOTES.md` §12; this is its store: a run per Proceed or per save, an entry
  // per entity and field, trimmed oldest first by age and by size.
  //
  // Two object stores. `runs` is small - one row per Proceed or hand save - and is read
  // whole to trim and to count, which keeps every total exact without a running tally a
  // crashed tab could leave wrong. `entries` is keyed `<run>:<n>`, so an import merges by
  // id, and indexed by run (to drop one) and by entity (to undo newest first per entity).
  //
  // Sizes are the entry's JSON length, an estimate of what the browser stores and the
  // number the limits and the history's heading both use - browsers report only a whole
  // site's usage, never one store's.
  var JOURNAL_DB = 'gttx-journal';
  var JOURNAL_DB_VERSION = 1;
  var JOURNAL_KEEP_DAYS = 90;
  var JOURNAL_SIZE_MB = 256;
  var DAY_MS = 86400000;
  var _journalDb = null;
  // Orders runs recorded in the same millisecond - a save and its capture, two quick saves.
  var _journalSeq = 0;
  function journalOrder(a, b) { return (a.at - b.at) || ((a.seq || 0) - (b.seq || 0)); }

  function idbRequest(req) {
    return new Promise(function (ok, no) {
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { no(req.error); };
    });
  }

  function idbDone(tx) {
    return new Promise(function (ok, no) {
      tx.oncomplete = function () { ok(); };
      tx.onerror = tx.onabort = function () { no(tx.error || new Error('the journal write was aborted')); };
    });
  }

  function journalDb() {
    if (_journalDb) return _journalDb;
    var idb = window.indexedDB;
    if (!idb) return Promise.reject(new Error('this browser offers no IndexedDB'));
    _journalDb = new Promise(function (ok, no) {
      var req = idb.open(JOURNAL_DB, JOURNAL_DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        db.createObjectStore('runs', { keyPath: 'id' });
        var entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('run', 'run');
        entries.createIndex('entity', 'entity');
      };
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { _journalDb = null; no(req.error); };
    });
    return _journalDb;
  }

  // The limits in force, off the settings: Keep for is 1 to 999 days, or Forever (also
  // 0), and anything else is the default; the size is 16 MB to 4 GB, clamped. `since` is
  // the last backup's time when Only since the last backup is on, else 0.
  function truthy(v) { return v === true || v === 'true'; }
  function journalLimits() {
    var s = settings();
    var d = String(s.c1JournalKeepDays == null ? '' : s.c1JournalKeepDays).trim();
    var days = /^(forever|0)$/i.test(d) ? 0 : parseInt(d, 10);
    if (days !== 0) days = isNaN(days) ? JOURNAL_KEEP_DAYS : Math.max(1, Math.min(999, days));
    var mb = parseInt(s.c2JournalSizeMB, 10);
    mb = isNaN(mb) ? JOURNAL_SIZE_MB : Math.max(16, Math.min(4096, mb));
    return { days: days, bytes: mb * 1048576, imageRuns: truthy(s.c5JournalImageRuns),
      since: truthy(s.c3JournalSinceBackup) ? stampAt(JOURNAL_BACKUP_KEY) : 0 };
  }

  // When this browser last saw something happen, or 0. Per browser, like the journal.
  function stampAt(key) {
    try { return parseInt(window.localStorage.getItem(key), 10) || 0; } catch (e) { return 0; }
  }
  function stampSaw(key, at) {
    try { window.localStorage.setItem(key, String(at)); } catch (e) { /* per page, then */ }
  }
  // A backup finishing; and the history saved to a file - what Clear History asks about
  // before it deletes runs no file holds.
  var JOURNAL_BACKUP_KEY = 'gttx-journal-backup';
  var JOURNAL_EXPORT_KEY = 'gttx-journal-export';

  // `run` is { plugin, label, source ('plugin' | 'hand'), libraryWide }; each entry is
  // { type ('scenes', 'tags', …), id, name, field, action ('update' | 'create' |
  // 'delete' | 'rename'), before, after, updatedAt } - `updatedAt` the entity's own time
  // right after this write, which is what an undo checks it against. Resolves to
  // { recorded, run, bytes }, or { recorded: 0, tooLarge } for a run that would fill
  // more than half the size limit, which is not kept.
  function journalRecord(run, entries) {
    return loadSettings(false).then(function () { return journalRecordNow(run, entries); },
      function () { return journalRecordNow(run, entries); });
  }

  // A run's time is strictly after the last one this page recorded: its entries carry the
  // time and no sequence, and two runs in one millisecond - a save and the automatic pass
  // it set off - would otherwise tie, and an undo could not tell which came first.
  var _journalLastAt = 0;
  function journalHead(run) {
    var at = Math.max(Date.now(), _journalLastAt + 1);
    _journalLastAt = at;
    return { id: at.toString(36) + '-' + Math.random().toString(36).slice(2, 8), at: at, seq: ++_journalSeq,
      source: run.source === 'hand' || run.source === 'undo' ? run.source : 'plugin',
      plugin: run.plugin || null, label: String(run.label || ''), note: String(run.note || ''),
      count: 0, bytes: 0, remap: run.remap || null };
  }

  function journalRow(id, at, i, x) {
    var row = {
      id: id + ':' + i, run: id, at: at,
      type: String(x.type), eid: String(x.id), entity: x.type + ':' + x.id,
      name: x.name == null ? null : String(x.name), field: x.field == null ? null : String(x.field),
      action: x.action || 'update',
      before: x.before === undefined ? null : x.before,
      after: x.after === undefined ? null : x.after,
      updatedAt: x.updatedAt || null,
    };
    if (x.undoes) row.undoes = String(x.undoes);
    if (x.folder != null) row.folder = String(x.folder);
    // A delete or a merge keeps what it takes to put the entity back (`journalSnapshot`).
    if (x.snapshot) row.snapshot = x.snapshot;
    if (x.carriers) row.carriers = x.carriers;
    if (x.merge) row.merge = x.merge;
    if (x.lost) row.lost = String(x.lost);
    if (x.split) row.split = true;   // a merge put back, which a redo cannot merge again (`journalUndo`)
    // A custom field that was, or is, not there at all - distinct from one holding null.
    if (x.before === undefined && x.action !== 'create') row.beforeAbsent = true;
    if (x.after === undefined && x.action !== 'create') row.afterAbsent = true;
    row.bytes = JSON.stringify(row).length;
    return row;
  }

  // A run's head and rows, in one transaction.
  function journalPut(head, rows) {
    return journalDb().then(function (db) {
      var tx = db.transaction(['runs', 'entries'], 'readwrite');
      tx.objectStore('runs').put(head);
      var store = tx.objectStore('entries');
      rows.forEach(function (r) { store.put(r); });
      return idbDone(tx);
    });
  }

  function journalRecordNow(run, entries) {
    run = run || {};
    var limits = journalLimits();
    var list = (entries || []).filter(function (x) { return x && x.type && x.id != null; });
    if (run.libraryWide && !limits.imageRuns) {
      list = list.filter(function (x) { return x.type !== 'images'; });
    }
    if (!list.length) return Promise.resolve({ recorded: 0 });
    var head = journalHead(run), id = head.id, at = head.at, bytes = 0;
    var rows = list.map(function (x, i) {
      var row = journalRow(id, at, i, x);
      bytes += row.bytes;
      return row;
    });
    if (bytes > limits.bytes / 2) return Promise.resolve({ recorded: 0, tooLarge: true, bytes: bytes });
    head.count = rows.length;
    head.bytes = bytes;
    return journalPut(head, rows).then(function () {
      journalChanged(true);
      journalProtect();
      return journalTrim();
    }).then(function () { return { recorded: rows.length, run: id, bytes: bytes }; });
  }

  function journalRunsOf(db) {
    return idbRequest(db.transaction('runs').objectStore('runs').getAll());
  }

  // Oldest first, while a run is past the age limit, older than the last backup where
  // only what came after it is kept, or the whole is past the size limit. An imported run
  // is kept past the age limit and the backup: it was brought back on purpose, to be
  // undone, so the trim steps past it to the newer runs rather than stopping there.
  // Passes still being written, which a trim leaves whole: a backup taken mid-pass would otherwise
  // drop the head and the chunks so far, the later chunks then landing on their own. This tab's
  // are in `_openPasses`; another tab's say so in their head (`open`, written with every chunk and
  // cleared by `finish`), honored for a day past the last chunk, so a closed tab's pass still goes.
  var _openPasses = {};
  function journalTrim() {
    var limits = journalLimits(), cutoff = Date.now() - limits.days * DAY_MS;
    return journalDb().then(function (db) {
      return journalRunsOf(db).then(function (runs) {
        runs.sort(journalOrder);
        var total = 0, drop = [];
        runs.forEach(function (r) { total += r.bytes; });
        for (var i = 0; i < runs.length; i++) {
          var r = runs[i], full = total > limits.bytes;
          // A pass that ran on past the backup is not in it: the backup is weighed against its last write.
          var old = (limits.days && r.at < cutoff) || (limits.since && (r.end || r.at) < limits.since);
          if (!old && !full) break;
          if (r.imported && !full) continue;
          if (_openPasses[r.id] || (r.open && Date.now() - (r.end || r.at) < DAY_MS)) continue;
          drop.push(r.id);
          total -= r.bytes;
        }
        return drop.length ? journalDropRuns(db, drop) : 0;
      });
    });
  }

  // A run and every entry it holds, inside the caller's transaction.
  function dropRunRows(runs, entries, id) {
    runs.delete(id);
    var keys = entries.index('run').getAllKeys(id);
    keys.onsuccess = function () { keys.result.forEach(function (k) { entries.delete(k); }); };
  }

  function journalDropRuns(db, ids) {
    var tx = db.transaction(['runs', 'entries'], 'readwrite');
    var runs = tx.objectStore('runs'), entries = tx.objectStore('entries');
    ids.forEach(function (id) { dropRunRows(runs, entries, id); });
    return idbDone(tx).then(function () { journalChanged(); return ids.length; });
  }

  // Takes whole runs and single changes out of the history; nothing in the library changes.
  // A run left with no changes goes with them, and one left with some is recounted.
  function journalRemove(runIds, entries) {
    return journalDb().then(function (db) {
      var tx = db.transaction(['runs', 'entries'], 'readwrite');
      var runs = tx.objectStore('runs'), store = tx.objectStore('entries'), touched = {};
      runIds.forEach(function (id) { dropRunRows(runs, store, id); });
      entries.forEach(function (e) {
        e = e._orig || e;
        store.delete(e.id);
        if (runIds.indexOf(e.run) === -1) touched[e.run] = true;
      });
      Object.keys(touched).forEach(function (rid) {
        var g = runs.get(rid), left = store.index('run').getAll(rid);
        left.onsuccess = function () {
          if (!g.result) return;
          if (!left.result.length) { runs.delete(rid); return; }
          g.result.count = left.result.length;
          g.result.bytes = left.result.reduce(function (n, x) { return n + (x.bytes || 0); }, 0);
          runs.put(g.result);
        };
      });
      return idbDone(tx);
    }).then(journalChanged);
  }

  // Newest first, which is the order the history lists them in.
  function journalRuns() {
    return journalDb().then(journalRunsOf).then(function (runs) {
      return runs.sort(function (a, b) { return journalOrder(b, a); });
    });
  }

  function journalEntries(runId) {
    return journalDb().then(function (db) {
      return idbRequest(db.transaction('entries').objectStore('entries').index('run').getAll(runId));
    });
  }

  // What the history's heading says: how many, how much, since when.
  function journalStats() {
    return journalRuns().then(function (runs) {
      var s = { runs: runs.length, entries: 0, bytes: 0, oldest: null };
      runs.forEach(function (r) {
        s.entries += r.count;
        s.bytes += r.bytes;
        if (s.oldest == null || r.at < s.oldest) s.oldest = r.at;
      });
      return s;
    });
  }

  function journalClear() {
    return journalDb().then(function (db) {
      var tx = db.transaction(['runs', 'entries'], 'readwrite');
      tx.objectStore('runs').clear();
      tx.objectStore('entries').clear();
      return idbDone(tx);
    }).then(journalChanged);
  }

  // Asked once a page, on the first write, while Protect the journal's storage is on. The
  // answer is the browser's to give - Chrome grants it quietly to a site in use, Firefox
  // asks, Safari may ignore it - and the history says which it was.
  var _journalProtectAsked = false;
  function journalProtect() {
    if (_journalProtectAsked || !truthy(settings().c6JournalProtect)) return;
    _journalProtectAsked = true;
    try {
      var st = window.navigator && window.navigator.storage;
      if (st && typeof st.persist === 'function') st.persist().then(null, function () {});
    } catch (e) { /* the history reports the state it finds */ }
  }

  // Every tab of this Stash shares the store; a history open in another one redraws
  // when this one writes. Where the channel is missing it redraws on its next open.
  // `recorded`: a change to the library was recorded, not the history tidied - which is
  // what marks another tab's Rescan (`watchOtherTabs`). `from` tells this page's own
  // messages apart: a channel hears every other one of its name, in this tab too.
  var _journalChannel = null;
  var PAGE_ID = Math.random().toString(36).slice(2);
  function journalChanged(recorded) {
    try {
      if (!_journalChannel && typeof window.BroadcastChannel === 'function') {
        _journalChannel = new window.BroadcastChannel(JOURNAL_DB);
      }
      if (_journalChannel) _journalChannel.postMessage({ changed: Date.now(), recorded: recorded === true, from: PAGE_ID });
    } catch (e) { /* another tab catches up on its next open */ }
  }

  // A change another tab recorded, while a ᝯㄝₓ dialog is open here: what it lists was read
  // before, so its Rescan - Refresh, in Find & Replace - says so, bold in the highlight and breathing,
  // until it is pressed. Found by the class every dialog gives it, `<prefix>-rescan`.
  var STALE_TIP = 'Another tab of this Stash changed your library after this listing was read, ' +
    'so what it shows may be out of date. Press this to read it again.';
  function markRescans() {
    var all = document.querySelectorAll ? document.querySelectorAll('button') : [];
    var hit = Array.prototype.slice.call(all).filter(function (b) {
      return /(^|\s)[a-z0-9]+-(rescan|refresh)(\s|$)/.test(String(b.className || '')) && !hasClass(b, 'gttx-stale-rescan');
    });
    if (!hit.length) return;
    injectStyle();
    hit.forEach(function (b) {
      b._gttxTitle = b.title || '';
      b.title = STALE_TIP + (b._gttxTitle ? '\n\n' + b._gttxTitle : '');
      toggleClass(b, 'gttx-stale-rescan', true);
      var clear = function () {
        toggleClass(b, 'gttx-stale-rescan', false);
        b.title = b._gttxTitle;
        b.removeEventListener('click', clear);
      };
      b.addEventListener('click', clear);
    });
  }
  function watchOtherTabs() {
    if (typeof window.BroadcastChannel !== 'function') return;
    try {
      var ch = new window.BroadcastChannel(JOURNAL_DB);
      ch.onmessage = function (ev) {
        var m = ev && ev.data;
        if (m && m.recorded && m.from !== PAGE_ID) markRescans();
      };
    } catch (e) { /* no channel: no mark */ }
  }

  // ── Undo History: the entity-types, and reading a field the way it is written ──
  //
  // A change is recorded, and undone, in the shape of the update input that makes it:
  // `tag_ids` as a sorted list of ids, `studio_id` as one id or null, a custom field by
  // its own name. So an undo is the same mutation with `before` in it, and "is it still
  // what we wrote" is one comparison of the current value, read in that same shape.
  //
  // Only the fields listed here are recorded. Anything else a save sends - an image, a
  // cover, a stash-id - is left out and the run says which, so nothing claims an undo it
  // cannot give. Each read selects only the fields the input named, and every one of
  // those exists on the entity under the same name, read off Stash's schema.
  var JOURNAL_TYPES = {
    scenes: { label: 'Scene', labels: 'Scenes', one: 'findScene', update: 'sceneUpdate',
      input: 'SceneUpdateInput', name: 'title', destroy: 'sceneDestroy', destroyInput: 'SceneDestroyInput',
      destroyArgs: { delete_file: false, delete_generated: false } },
    images: { label: 'Image', labels: 'Images', one: 'findImage', update: 'imageUpdate',
      input: 'ImageUpdateInput', name: 'title', destroy: 'imageDestroy', destroyInput: 'ImageDestroyInput',
      destroyArgs: { delete_file: false, delete_generated: false } },
    galleries: { label: 'Gallery', labels: 'Galleries', one: 'findGallery', update: 'galleryUpdate',
      input: 'GalleryUpdateInput', name: 'title', destroy: 'galleryDestroy', destroyInput: 'GalleryDestroyInput',
      destroyArgs: { delete_file: false, delete_generated: false }, destroyIds: true },
    performers: { label: 'Performer', labels: 'Performers', one: 'findPerformer', update: 'performerUpdate',
      input: 'PerformerUpdateInput', name: 'name', destroy: 'performerDestroy', destroyInput: 'PerformerDestroyInput' },
    studios: { label: 'Studio', labels: 'Studios', one: 'findStudio', update: 'studioUpdate',
      input: 'StudioUpdateInput', name: 'name', destroy: 'studioDestroy', destroyInput: 'StudioDestroyInput' },
    groups: { label: 'Group', labels: 'Groups', one: 'findGroup', update: 'groupUpdate',
      input: 'GroupUpdateInput', name: 'name', destroy: 'groupDestroy', destroyInput: 'GroupDestroyInput' },
    tags: { label: 'Tag', labels: 'Tags', one: 'findTag', update: 'tagUpdate',
      input: 'TagUpdateInput', name: 'name', destroy: 'tagDestroy', destroyInput: 'TagDestroyInput' },
    // A plugin's settings, by its id: read and written as the whole map `configurePlugin`
    // replaces (`journalRead`, `journalUndo`), each key a field `settings.<key>`.
    settings: { label: 'Plugin settings', labels: 'Plugin settings', name: 'id', settings: true },
  };

  var JOURNAL_RELATIONS = { tag_ids: 'tags', performer_ids: 'performers', gallery_ids: 'galleries',
    scene_ids: 'scenes', parent_ids: 'parents', child_ids: 'children' };
  var JOURNAL_SCALARS = ['title', 'code', 'details', 'director', 'date', 'rating100', 'organized',
    'name', 'disambiguation', 'gender', 'birthdate', 'death_date', 'country', 'ethnicity',
    'eye_color', 'hair_color', 'height_cm', 'weight', 'measurements', 'fake_tits',
    'penis_length', 'circumcised', 'career_length', 'tattoos', 'piercings', 'favorite',
    'ignore_auto_tag', 'description', 'sort_name', 'duration', 'photographer', 'urls',
    'alias_list', 'aliases', 'synopsis', 'career_start', 'career_end', 'o_counter', 'play_count',
    'resume_time'];

  function sortedIds(list) {
    return (list || []).map(function (x) { return String(x.id); }).sort();
  }

  // `{ sel, read }` for an update input key: what to select, and the value read back in
  // the input's own shape. Null for a key that is not recorded.
  function journalField(key) {
    if (hasOwn(JOURNAL_RELATIONS, key)) {
      var rel = JOURNAL_RELATIONS[key];
      return { sel: rel + ' { id }', read: function (o) { return sortedIds(o[rel]); } };
    }
    if (key === 'studio_id') {
      return { sel: 'studio { id }', read: function (o) { return o.studio ? String(o.studio.id) : null; } };
    }
    if (key === 'parent_id') {
      return { sel: 'parent_studio { id }',
        read: function (o) { return o.parent_studio ? String(o.parent_studio.id) : null; } };
    }
    if (key === 'groups') {
      return { sel: 'groups { group { id } scene_index }', read: function (o) {
        return (o.groups || []).map(function (g) {
          return { group_id: String(g.group.id), scene_index: g.scene_index == null ? null : g.scene_index };
        }).sort(function (a, b) { return a.group_id < b.group_id ? -1 : a.group_id > b.group_id ? 1 : 0; });
      } };
    }
    if (JOURNAL_SCALARS.indexOf(key) !== -1) {
      return { sel: key, read: function (o) {
        var v = o[key];
        return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : (v === undefined ? null : v);
      } };
    }
    return null;
  }

  // One text for "the same value": lists of ids are already sorted, so JSON is enough.
  function journalSame(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // Reads each id's fields, fifty aliased lookups a request. `send` is the fetch to go
  // through - the one under every wrapper, for the capture, so a read is never mistaken
  // for a save by another plugin's wrapper. Resolves to { id: entity or null }.
  function journalRead(send, type, ids, fields, customFields, files) {
    var t = JOURNAL_TYPES[type];
    if (t.settings) {
      return pluginConfig(true).then(function (d) {
        var all = ((d || {}).configuration || {}).plugins || {}, out = {};
        ids.forEach(function (id) { out[id] = { id: id, settings: all[id] || {} }; });
        return out;
      });
    }
    var sel = ['id', 'updated_at', t.name].concat(fields.map(function (k) { return journalField(k).sel; }));
    if (customFields) sel.push('custom_fields');
    // A file renamed is `files.<file id>`; an image's files are read under the same name.
    if (files) {
      sel.push(type === 'images' ? 'files: visual_files { ... on ImageFile { id basename } ... on VideoFile { id basename } }'
        : 'files { id basename }');
    }
    var out = {}, chunks = [];
    for (var i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    return chunks.reduce(function (p, chunk) {
      return p.then(function () {
        var q = 'query GTTxJournalRead { ' + chunk.map(function (id, n) {
          return 'e' + n + ': ' + t.one + '(id: ' + JSON.stringify(String(id)) + ') { ' + sel.join(' ') + ' }';
        }).join(' ') + ' }';
        return send('/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, variables: {} }) })
          .then(function (r) { return r.json(); })
          .then(function (json) {
            if (json.errors) throw new Error(json.errors.map(function (e) { return e.message; }).join('; '));
            chunk.forEach(function (id, n) { out[String(id)] = (json.data || {})['e' + n] || null; });
          });
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  // The changes between two reads of one entity, over the fields an input named: one
  // entry a field whose value moved, and one a custom field added, changed or removed.
  function journalDiff(type, id, before, after, fields, customFields) {
    var entries = [];
    var name = (after && after[JOURNAL_TYPES[type].name]) || (before && before[JOURNAL_TYPES[type].name]) || '';
    var stamp = after ? after.updated_at : null;
    fields.forEach(function (k) {
      var f = journalField(k), b = before ? f.read(before) : null, a = after ? f.read(after) : null;
      if (!journalSame(b, a)) {
        entries.push({ type: type, id: id, name: name, field: k, before: b, after: a, updatedAt: stamp });
      }
    });
    if (customFields) {
      var bc = (before && before.custom_fields) || {}, ac = (after && after.custom_fields) || {};
      var keys = Object.keys(bc).concat(Object.keys(ac).filter(function (k) { return !hasOwn(bc, k); }));
      keys.forEach(function (k) {
        var had = hasOwn(bc, k), has = hasOwn(ac, k);
        if (had && has && journalSame(bc[k], ac[k])) return;
        entries.push({ type: type, id: id, name: name, field: 'custom_fields.' + k,
          before: had ? bc[k] : undefined, after: has ? ac[k] : undefined, updatedAt: stamp });
      });
    }
    return entries;
  }

  // **What a plugin hands the journal, from what it already keeps.** Every writing dialog
  // here keeps, per entity, the input it wrote and the input that puts it back, for its
  // own Undo. This turns that pair into entries - one a field, in the shape `journalField`
  // reads - so a plugin records with one call and no second model of its writes. A key
  // either input cannot state as a whole value (`{ ids, mode }`, an image) is left out;
  // `skipped` names them. A custom field is read off `partial` / `remove` / `full`, the
  // last being the whole map, where a key it lacks was absent.
  function journalFromInputs(type, id, name, forward, undo, updatedAt) {
    var out = { entries: [], skipped: [] };
    forward = forward || {};
    undo = undo || {};
    var keys = Object.keys(forward).concat(Object.keys(undo).filter(function (k) { return !hasOwn(forward, k); }));
    var isList = function (v) { return Object.prototype.toString.call(v) === '[object Array]'; };
    var norm = function (k, v) {
      if (v === undefined) return undefined;
      if (hasOwn(JOURNAL_RELATIONS, k)) return isList(v) ? v.map(String).sort() : undefined;
      if (k === 'studio_id' || k === 'parent_id') return v == null || v === '' ? null : String(v);
      if (k === 'groups') {
        return isList(v) ? v.map(function (g) {
          return { group_id: String(g.group_id), scene_index: g.scene_index == null ? null : g.scene_index };
        }).sort(function (a, b) { return a.group_id < b.group_id ? -1 : a.group_id > b.group_id ? 1 : 0; }) : undefined;
      }
      return v;
    };
    var cfSide = function (cf, k) {
      if (!cf) return undefined;
      if (cf.full && typeof cf.full === 'object') return hasOwn(cf.full, k) ? cf.full[k] : JOURNAL_ABSENT;
      if (cf.partial && hasOwn(cf.partial, k)) return cf.partial[k];
      if (cf.remove && cf.remove.indexOf(k) !== -1) return JOURNAL_ABSENT;
      return undefined;
    };
    keys.forEach(function (k) {
      if (k === 'id' || k === 'ids') return;
      if (k === 'custom_fields') {
        var f = forward.custom_fields || {}, u = undo.custom_fields || {}, names = [];
        [f.partial, u.partial, f.full, u.full].forEach(function (m) {
          if (m) Object.keys(m).forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });
        });
        [f.remove, u.remove].forEach(function (l) {
          (l || []).forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });
        });
        names.forEach(function (n) {
          var a = cfSide(f, n), b = cfSide(u, n);
          if (a === undefined || b === undefined || journalSame(a, b)) return;
          out.entries.push({ type: type, id: String(id), name: name, field: 'custom_fields.' + n,
            before: b === JOURNAL_ABSENT ? undefined : b, after: a === JOURNAL_ABSENT ? undefined : a,
            updatedAt: updatedAt || null });
        });
        return;
      }
      // A relation given as ids added or taken away - a bulk input's `{ ids, mode }` - is
      // that delta already, whatever the other side says.
      var fk = forward[k];
      if (hasOwn(JOURNAL_RELATIONS, k) && fk && !isList(fk) && isList(fk.ids) &&
          (fk.mode === 'ADD' || fk.mode === 'REMOVE')) {
        var ids = fk.ids.map(String).sort();
        out.entries.push({ type: type, id: String(id), name: name, field: k,
          before: fk.mode === 'ADD' ? [] : ids, after: fk.mode === 'ADD' ? ids : [], updatedAt: updatedAt || null });
        return;
      }
      var after = journalField(k) ? norm(k, forward[k]) : undefined;
      var before = journalField(k) ? norm(k, undo[k]) : undefined;
      if (after === undefined || before === undefined) {
        if (out.skipped.indexOf(k) === -1) out.skipped.push(k);
        return;
      }
      if (journalSame(after, before)) return;
      out.entries.push({ type: type, id: String(id), name: name, field: k, before: before, after: after,
        updatedAt: updatedAt || null });
    });
    return out;
  }

  // One pass of a plugin's dialog, recorded as it writes: `add(type, id, name, forward,
  // undo)` after each write that landed, `entries(list)` for ones already in the journal's
  // shape, and `finish()` once, which resolves to a sentence for the dialog's log - or ''.
  //
  // **Written in chunks as it goes, never held whole.** A library-wide pass is a million
  // entries; kept until the end they were a second copy of the plan in memory, and
  // gathered by copying the list at each batch they took minutes. So every
  // `JOURNAL_CHUNK` entries go to the store in one transaction, the run's head with them,
  // and a pass holds one chunk at a time. Past half the size limit it stops, drops what it
  // wrote, and says so: a run is recorded whole or not at all. Recording never fails the
  // pass: a failure is the sentence.
  //
  // **A dialog's own Undo is recorded from the history, not from memory.** `reverse(run,
  // type, id)` names an entity whose writes in an earlier pass - `pass.id` - this pass
  // put back; `finish` reads that pass's entries from the store, records them reversed,
  // and marks them undone there. `reverse(run, type, id, field)` names one field of it
  // alone, for an Undo that put back only part of what an entity had in that pass - the
  // rest stays done, and says so (`journal.reversesFields` tells a plugin it may). A field named
  // once reverses that field's newest entry not yet undone, named twice its two newest, and so on:
  // one call a write, so where a pass wrote a field twice and the Undo put back one, the other
  // stays done. So a plugin keeps nothing extra for it: keeping each
  // forward input on the dialog's Undo list cost hundreds of megabytes on a large pass.
  // `drain()` resolves once everything handed over so far is written, for a caller that
  // feeds a large pass in slices.
  var JOURNAL_CHUNK = 2000;
  function journalPass(run) {
    var buf = [], skipped = [], head = journalHead(run), n = 0, over = false, failed = null;
    var written = false, reversals = {}, marked = [];
    _openPasses[head.id] = true;
    head.open = true;
    var ready = loadSettings(false).then(null, function () { return null; });
    var chain = ready;
    var flush = function () {
      if (!buf.length || over || failed) return chain;
      var list = buf;
      buf = [];
      chain = chain.then(function () {
        if (over || failed) return null;
        var limits = journalLimits();
        if (run.libraryWide && !limits.imageRuns) list = list.filter(function (x) { return x.type !== 'images'; });
        list = list.filter(function (x) { return x && x.type && x.id != null; });
        if (!list.length) return null;
        written = true;
        var rows = list.map(function (x) { return journalRow(head.id, head.at, n++, x); });
        rows.forEach(function (r) { head.bytes += r.bytes; });
        head.count += rows.length;
        if (head.bytes > limits.bytes / 2) { over = true; return null; }
        head.note = skipped.length ? 'not recorded: ' + skipped.join(', ') : '';
        head.end = Date.now();   // the last write: what a backup taken since holds, or does not
        return journalPut(head, rows);
      }).then(null, function (e) { failed = e; });
      return chain;
    };
    // A chunk is cut inside the loop, so one large hand-over - a dialog's Undo of a big pass - is
    // written as chunks too, not as one transaction.
    var push = function (list) {
      for (var i = 0; i < list.length; i++) {
        buf.push(list[i]);
        if (buf.length >= JOURNAL_CHUNK) flush();
      }
    };
    // Each earlier pass named in `reverse`, read back, its entities' entries swapped and
    // handed over in chunks; the originals are marked undone by this run only once every chunk
    // of it is written, so a run that is then dropped leaves none marked by it.
    // ponytail: each earlier pass is read whole (`journalEntries`); a cursor in pages is the
    // upgrade if one pass's entries ever outgrow memory on their own.
    var reverseAll = function () {
      var runs = Object.keys(reversals), toMark = [];
      reversals = {};
      var swap = function (e) {
        return { type: e.type, id: e.eid, name: e.name, field: e.field, folder: e.folder,
          action: e.action === 'create' ? 'delete' : e.action,
          before: e.afterAbsent ? undefined : e.after, after: e.beforeAbsent ? undefined : e.before,
          undoes: e.id };
      };
      return runs.reduce(function (p, runId) {
        var keys = reversalsOf[runId];
        return p.then(function () {
          return journalEntries(runId).then(function (entries) {
            // Newest first, so each field's count takes its newest entries; kept in the run's order.
            var n = function (e) { return +e.id.slice(e.id.lastIndexOf(':') + 1); };
            var left = {}, take = {};
            entries.slice().sort(function (a, b) { return n(b) - n(a); }).forEach(function (e) {
              var w = keys[e.entity];
              if (!w || e.undone) return;
              if (w === true) { take[e.id] = true; return; }
              var f = String(e.field), k = e.entity + '\n' + f;
              if (!hasOwn(w, f)) return;
              if (!hasOwn(left, k)) left[k] = w[f];
              if (left[k]-- > 0) take[e.id] = true;
            });
            var mine = entries.filter(function (e) { return take[e.id]; });
            for (var i = 0; i < mine.length; i += JOURNAL_CHUNK) push(mine.slice(i, i + JOURNAL_CHUNK).map(swap));
            if (mine.length) toMark.push(mine);
            return flush();
          });
        });
      }, Promise.resolve()).then(function () {
        if (over || failed) return null;
        return toMark.reduce(function (p, mine) {
          return p.then(function () { return journalMark(mine, head.id); })
            .then(function (cleared) { marked.push({ list: mine, cleared: cleared }); });
        }, Promise.resolve());
      });
    };
    var reversalsOf = {};
    return {
      id: head.id,
      // A bulk input names its entities in `ids`; each gets the same entries.
      add: function (type, id, name, forward, undo) {
        var ids = forward && Object.prototype.toString.call(forward.ids) === '[object Array]'
          ? forward.ids : [id];
        for (var i = 0; i < ids.length; i++) {
          var r = journalFromInputs(type, ids[i], name, forward, undo);
          push(r.entries);
          for (var k = 0; k < r.skipped.length; k++) {
            if (skipped.indexOf(r.skipped[k]) === -1) skipped.push(r.skipped[k]);
          }
        }
      },
      entries: function (more) { push(more || []); },
      reverse: function (runId, type, id, field) {
        if (!runId) return;
        reversals[runId] = true;
        var of = reversalsOf[runId] = reversalsOf[runId] || {}, k = type + ':' + id;
        // The whole entity once named whole; otherwise the fields named so far, each with how often.
        if (field == null) of[k] = true;
        else if (of[k] !== true) { var fs = of[k] = of[k] || {}, fk = String(field); fs[fk] = (fs[fk] || 0) + 1; }
      },
      drain: function () { return window.indexedDB ? flush() : Promise.resolve(); },
      finish: function () {
        // A browser with no IndexedDB has no history to add to, so there is nothing to say.
        if (!window.indexedDB) { buf = []; delete _openPasses[head.id]; return Promise.resolve(''); }
        // A pass not recorded whole is not recorded at all: the chunks it did write go.
        var drop = function (why) {
          delete _openPasses[head.id];
          return marked.reduce(function (p, m) { return p.then(function () { return journalUnmark(m.list, m.cleared); }); }, Promise.resolve())
            .then(function () { return journalDb(); }).then(function (db) { return journalDropRuns(db, [head.id]); })
            .then(null, function () {}).then(function () { return 'Not recorded in Undo History: ' + why; });
        };
        return flush().then(reverseAll).then(function () {
          delete _openPasses[head.id];
          if (failed) return drop((failed.message || String(failed)) + '.');
          if (over) {
            return drop('this pass is more than half its size limit. Its Undo here still works while this dialog is open.');
          }
          if (!written) return '';
          delete head.open;
          return journalPut(head, []).then(function () {
            journalChanged(true);
            journalProtect();
            return journalTrim();
          }).then(function () {
            return 'Recorded in Undo History: ' + plural(head.count, 'change') +
              (head.note ? ' (' + head.note + ')' : '') + '.';
          });
        }).then(null, function (e) {
          return drop((e && e.message ? e.message : String(e)) + '.');
        });
      },
    };
  }

  // ── Undo History: recording the edits Stash's own pages save ────────────────
  //
  // Stash's pages send every save through Apollo, which names the operation in the body;
  // no ᝯㄝₓ plugin does - they send `query` and `variables` alone and record their own
  // writes. So a request is Stash's own save exactly when its `operationName` is one of
  // these, and nothing else is looked at.
  var JOURNAL_OPS = {};
  [['Scene', 'scenes', 'Scenes'], ['Image', 'images', 'Images'], ['Gallery', 'galleries', 'Galleries'],
    ['Performer', 'performers', 'Performers'], ['Studio', 'studios', 'Studios'],
    ['Group', 'groups', 'Groups'], ['Tag', 'tags', 'Tags']].forEach(function (t) {
    JOURNAL_OPS[t[0] + 'Update'] = { type: t[1], mode: 'one' };
    JOURNAL_OPS['Bulk' + t[0] + 'Update'] = { type: t[1], mode: 'bulk' };
    JOURNAL_OPS[t[2] + 'Update'] = { type: t[1], mode: 'many' };
    JOURNAL_OPS[t[0] + 'Create'] = { type: t[1], mode: 'create', field: t[0].charAt(0).toLowerCase() + t[0].slice(1) + 'Create' };
    JOURNAL_OPS[t[0] + 'Destroy'] = { type: t[1], mode: 'destroy' };
    JOURNAL_OPS[t[2] + 'Destroy'] = { type: t[1], mode: 'destroy' };
  });
  JOURNAL_OPS.TagsMerge = { type: 'tags', mode: 'merge' };
  JOURNAL_OPS.SceneMerge = { type: 'scenes', mode: 'merge' };

  // The saves in one request body, as { op, type, mode, inputs, ids, fields, customFields }.
  function journalSaves(init) {
    if (!init || typeof init.body !== 'string') return [];
    var parsed;
    try { parsed = JSON.parse(init.body); } catch (e) { return []; }
    var ops = Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [parsed];
    var out = [];
    ops.forEach(function (o) {
      var spec = o && o.operationName && hasOwn(JOURNAL_OPS, o.operationName) ? JOURNAL_OPS[o.operationName] : null;
      var input = spec && o.variables ? o.variables.input : null;
      // A delete names its ids as the input or, for the bulk ones, as bare variables; a
      // merge its sources and its destination either way.
      if (spec && (spec.mode === 'destroy' || spec.mode === 'merge')) {
        var v = (o.variables && (o.variables.input || o.variables)) || {};
        var gone = spec.mode === 'merge' ? [].concat(v.source || [])
          : v.ids ? [].concat(v.ids) : v.id != null ? [v.id] : [];
        if (!gone.length) return;
        out.push({ op: o.operationName, spec: spec, type: spec.type, ids: gone.map(String), fields: [],
          skipped: [], customFields: false, into: spec.mode === 'merge' ? String(v.destination) : null,
          filesGone: !!v.delete_file });
        return;
      }
      if (!input) return;
      var inputs = spec.mode === 'many' ? [].concat(input) : [input];
      var ids = spec.mode === 'bulk' ? (input.ids || []).map(String)
        : spec.mode === 'create' ? [] : inputs.map(function (x) { return String(x.id); });
      var fields = [], skipped = [], customFields = false;
      inputs.forEach(function (x) {
        Object.keys(x).forEach(function (k) {
          if (k === 'id' || k === 'ids') return;
          if (k === 'custom_fields') { customFields = true; return; }
          if (journalField(k)) { if (fields.indexOf(k) === -1) fields.push(k); }
          else if (skipped.indexOf(k) === -1) skipped.push(k);
        });
      });
      out.push({ op: o.operationName, spec: spec, type: spec.type, ids: ids, fields: fields,
        skipped: skipped, customFields: customFields });
    });
    return out;
  }

  function journalLabel(save) {
    var t = JOURNAL_TYPES[save.type];
    if (save.spec.mode === 'create') return t.label + ' created';
    if (save.spec.mode === 'destroy') return (save.ids.length > 1 ? t.labels : t.label) + ' deleted';
    if (save.spec.mode === 'merge') return t.labels + ' merged';
    if (save.spec.mode === 'bulk') return t.labels + ' edited in bulk';
    return (save.ids.length > 1 ? t.labels : t.label) + ' edited';
  }

  // Around one save: read what it will change, let it through, read again, record the
  // difference. A read that fails never holds the save back: it goes through and the
  // history shows a gap there instead.
  // A plugin's settings saved - on Stash's settings page, or from a plugin's own dialog -
  // recorded key by key, where Record Settings Changes is on: the map as it was, read just
  // before, against the map the save sends, which is the whole of it. Not a seeded default
  // written on first load, not a plugin's own state - an operation named `…State`, such as De-Spicer's
  // salt and its record of the pseudonyms it wrote, which an undo would only corrupt - and not an
  // undo's own write, which its run already records.
  function journalSettingsSave(send, input, init, op) {
    var v = {};
    try { v = JSON.parse(init.body).variables || {}; } catch (e) { v = {}; }
    var pid = v.plugin_id || v.id, next = v.input;
    var record = pid && next && typeof next === 'object' && !/mutation\s+\w*(Seed|State|GTTxUndo)/.test(op);
    // Its own query, not the shared read: the save about to go out drops that anyway.
    var prior = !record ? Promise.resolve(null) : gqlRequest('query GTTxSettingsBefore { configuration { plugins } }', null).then(function (d) {
      var all = ((d || {}).configuration || {}).plugins || {}, core = all[PLUGIN_ID] || {};
      var on = hasOwn(core, 'c9JournalSettings') ? truthy(core.c9JournalSettings) : DEFAULTS.c9JournalSettings;
      return on ? all[pid] || {} : null;
    }, function () { return null; });
    return prior.then(function (was) {
      var sent = send(input, init);
      sent.then(configChanged, configChanged);
      if (was) {
        sent.then(function (resp) {
          if (!resp || resp.ok === false) return null;
          var copy = typeof resp.clone === 'function' ? resp.clone() : null;
          return (copy ? copy.json() : Promise.resolve({})).then(function (j) {
            if (j && j.errors && j.errors.length) return null;
            var keys = {}, entries = [];
            Object.keys(was).concat(Object.keys(next)).forEach(function (k) { keys[k] = true; });
            Object.keys(keys).sort().forEach(function (k) {
              var b = hasOwn(was, k) ? was[k] : undefined, a = hasOwn(next, k) ? next[k] : undefined;
              if (JSON.stringify(b) === JSON.stringify(a)) return;
              entries.push({ type: 'settings', id: pid, name: pid, field: 'settings.' + k, before: b, after: a });
            });
            return entries.length ? journalRecord({ source: 'hand', label: pid + ' settings changed' }, entries) : null;
          });
        }).then(null, function () { /* a settings save is never held back by its record */ });
      }
      return sent;
    });
  }

  function journalCapture(send, input, init) {
    // A settings write is no save of the library, but it is what makes the shared read of
    // every plugin's settings stale (`pluginConfig`).
    // The operation, not the body: a save whose text mentions it is still a save.
    var op = null;
    try { op = init && typeof init.body === 'string' ? JSON.parse(init.body).query : null; } catch (e) { op = null; }
    if (typeof op === 'string' && /\bconfigurePlugin\b/.test(op)) {
      configChanged();
      return journalSettingsSave(send, input, init, op);
    }
    var saves = journalSaves(init);
    if (!saves.length) return send(input, init);
    var removal = saves.some(function (sv) { return sv.spec.mode === 'destroy' || sv.spec.mode === 'merge'; });
    return loadSettings(false).then(function (s) {
      return truthy(removal ? s.c7JournalDeletes : s.c4JournalHandEdits);
    }, function () { return true; }).then(function (on) {
      if (!on) return send(input, init);
      if (removal) return journalCaptureRemoval(send, input, init, saves);
      // Stash's upload link aborts its request once it has read the answer, which also
      // cuts off the copy a create's new id is read from - so a create goes without it.
      var sendInit = init;
      if (init.signal && saves.some(function (sv) { return sv.spec.mode === 'create'; })) {
        sendInit = {};
        for (var k in init) if (k !== 'signal') sendInit[k] = init[k];
      }
      return Promise.all(saves.map(function (sv) {
        return sv.ids.length ? journalRead(send, sv.type, sv.ids, sv.fields, sv.customFields) : {};
      })).then(function (befores) {
        var p = send(input, sendInit);
        p.then(function (resp) { journalAfterSave(send, saves, befores, resp); }, function () {});
        return p;
      }, function (e) {
        var p = send(input, init);
        p.then(function () { journalGap(saves, e); }, function () {});
        return p;
      });
    });
  }

  function journalAfterSave(send, saves, befores, resp) {
    if (!resp || !resp.ok) return;
    // A create names its new entity only in the answer, so that answer is read - a clone
    // of it, which leaves Stash's own read of the body untouched. The one body this
    // capture reads; every update is judged by reading the entity again instead.
    var created = saves.some(function (sv) { return sv.spec.mode === 'create'; })
      ? resp.clone().json().then(function (j) { return j && !j.errors ? j.data || {} : null; })
      : Promise.resolve(null);
    created.then(function (data) {
      return Promise.all(saves.map(function (sv, i) {
        if (sv.spec.mode === 'create') {
          var made = data && data[sv.spec.field];
          if (!made || made.id == null) return [];
          return journalRead(send, sv.type, [String(made.id)], [], false).then(function (m) {
            var o = m[String(made.id)] || {};
            return [{ type: sv.type, id: String(made.id), name: o[JOURNAL_TYPES[sv.type].name] || '',
              action: 'create', updatedAt: o.updated_at || null }];
          });
        }
        return journalRead(send, sv.type, sv.ids, sv.fields, sv.customFields).then(function (afters) {
          var entries = [];
          sv.ids.forEach(function (id) {
            entries = entries.concat(journalDiff(sv.type, id, befores[i][id], afters[id], sv.fields, sv.customFields));
          });
          return entries;
        });
      })).then(function (lists) {
        saves.forEach(function (sv, i) {
          if (!lists[i].length) return;
          journalRecord({ source: 'hand', label: journalLabel(sv),
            note: sv.skipped.length ? 'not recorded: ' + sv.skipped.join(', ') : '' }, lists[i]).then(null, function () {});
        });
      });
    }).then(null, function (e) { journalGap(saves, e); });
  }

  // A save that went through unrecorded still leaves a line, so the gap is visible.
  function journalGap(saves, e) {
    saves.forEach(function (sv) {
      var ids = sv.ids.length ? sv.ids : ['?'];
      journalRecord({ source: 'hand', label: journalLabel(sv),
        note: 'not recorded: ' + (e && e.message ? e.message : String(e)) },
        ids.map(function (id) { return { type: sv.type, id: id, action: 'gap' }; })).then(null, function () {});
    });
  }

  // ── Undo History: deletes and merges ──────────────────────────────────────
  //
  // A delete takes the entity away, so what brings it back is read just before: every
  // field its create input takes - asked of the schema, so a field this Stash lacks is
  // not asked for - and the ids of everything carrying it. The undo creates it again,
  // under a new id, reattaches what still exists of those carriers, and maps the old id
  // to the new one for every older entry that names it (`remap` on the undo's run).
  //
  // A merge is a delete of each source plus what the destination gained: the undo puts
  // each source back and takes the destination off what carried only a source. Images
  // and galleries come back by rescanning their files, a scene deleted with its files
  // cannot come back, and a scene merge moves files between scenes - all three are
  // recorded, and the review says why they are not undone.
  var JOURNAL_CREATE = {
    tags: { type: 'Tag', input: 'TagCreateInput', create: 'tagCreate' },
    performers: { type: 'Performer', input: 'PerformerCreateInput', create: 'performerCreate' },
    studios: { type: 'Studio', input: 'StudioCreateInput', create: 'studioCreate' },
    groups: { type: 'Group', input: 'GroupCreateInput', create: 'groupCreate' },
    scenes: { type: 'Scene', input: 'SceneCreateInput', create: 'sceneCreate' },
  };
  // Where a create input's relation is read from, and how it is written back.
  var SNAP_RELS = {
    tag_ids: 'tags { id }', performer_ids: 'performers { id }', gallery_ids: 'galleries { id }',
    parent_ids: 'parents { id }', child_ids: 'children { id }', file_ids: 'files { id }',
    studio_id: 'studio { id }', parent_id: 'parent_studio { id }',
    groups: 'groups { group { id } scene_index }', stash_ids: 'stash_ids { endpoint stash_id }',
    containing_groups: 'containing_groups { group { id } description }',
    sub_groups: 'sub_groups { group { id } description }', custom_fields: 'custom_fields',
  };
  var SNAP_READ = {
    tag_ids: 'tags', performer_ids: 'performers', gallery_ids: 'galleries', parent_ids: 'parents',
    child_ids: 'children', file_ids: 'files',
  };
  // What carries an entity of each type: the list, its filter, and the field that names it.
  var JOURNAL_CARRIERS = {
    tags: [['scenes', 'findScenes', 'scene_filter', 'tags', 'tag_ids'], ['images', 'findImages', 'image_filter', 'tags', 'tag_ids'],
      ['galleries', 'findGalleries', 'gallery_filter', 'tags', 'tag_ids'], ['performers', 'findPerformers', 'performer_filter', 'tags', 'tag_ids'],
      ['groups', 'findGroups', 'group_filter', 'tags', 'tag_ids'], ['studios', 'findStudios', 'studio_filter', 'tags', 'tag_ids'],
      // Its children: Stash drops a deleted tag from their parents, and a merge moves them.
      ['tags', 'findTags', 'tag_filter', 'parents', 'parent_ids']],
    performers: [['scenes', 'findScenes', 'scene_filter', 'performers', 'performer_ids'],
      ['images', 'findImages', 'image_filter', 'performers', 'performer_ids'],
      ['galleries', 'findGalleries', 'gallery_filter', 'performers', 'performer_ids']],
    studios: [['scenes', 'findScenes', 'scene_filter', 'studios', 'studio_id'], ['images', 'findImages', 'image_filter', 'studios', 'studio_id'],
      ['galleries', 'findGalleries', 'gallery_filter', 'studios', 'studio_id'], ['groups', 'findGroups', 'group_filter', 'studios', 'studio_id'],
      ['studios', 'findStudios', 'studio_filter', 'parents', 'parent_id']],
    groups: [['scenes', 'findScenes', 'scene_filter', 'groups', 'groups']],
  };
  var _snapFields = {};

  function unwrapKind(t) {
    while (t && (t.kind === 'NON_NULL' || t.kind === 'LIST') && t.ofType) t = t.ofType;
    return t ? t.kind : null;
  }

  // The selection that reads back everything the type's create input takes, from the
  // schema, once a page: { sel, fields }.
  function journalSnapFields(type) {
    var c = JOURNAL_CREATE[type];
    if (_snapFields[type]) return _snapFields[type];
    var shape = '{ name kind ofType { name kind ofType { name kind ofType { name kind } } } }';
    _snapFields[type] = gqlRequest('query GTTxSnapSchema { i: __type(name: "' + c.input + '") { inputFields { name type ' +
      shape + ' } } o: __type(name: "' + c.type + '") { fields { name type ' + shape + ' } } }', null).then(function (d) {
      var has = {};
      ((d.o || {}).fields || []).forEach(function (f) { has[f.name] = unwrapKind(f.type); });
      var sel = ['id'], fields = [];
      ((d.i || {}).inputFields || []).forEach(function (f) {
        if (hasOwn(SNAP_RELS, f.name)) {
          var root = SNAP_RELS[f.name].split(' ')[0];
          if (!hasOwn(has, root)) return;
          sel.push(SNAP_RELS[f.name]);
          fields.push(f.name);
        } else if (has[f.name] === 'SCALAR' || has[f.name] === 'ENUM') {
          sel.push(f.name);
          fields.push(f.name);
        }
      });
      return { sel: sel.join(' '), fields: fields };
    }, function (e) { delete _snapFields[type]; throw e; });
    return _snapFields[type];
  }

  function snapIds(list) { return (list || []).map(function (x) { return String(x.id); }); }

  // The create input a snapshot gives back.
  function journalSnapInput(fields, o) {
    var input = {};
    fields.forEach(function (f) {
      if (hasOwn(SNAP_READ, f)) { input[f] = snapIds(o[SNAP_READ[f]]); return; }
      if (f === 'studio_id') { if (o.studio) input.studio_id = String(o.studio.id); return; }
      if (f === 'parent_id') { if (o.parent_studio) input.parent_id = String(o.parent_studio.id); return; }
      if (f === 'groups') {
        input.groups = (o.groups || []).map(function (g) { return { group_id: String(g.group.id), scene_index: g.scene_index }; });
        return;
      }
      if (f === 'containing_groups' || f === 'sub_groups') {
        input[f] = (o[f] || []).map(function (g) { return { group_id: String(g.group.id), description: g.description }; });
        return;
      }
      if (o[f] !== undefined && o[f] !== null) input[f] = o[f];
    });
    return input;
  }

  function journalCarriersOf(type, id) {
    var out = {};
    return (JOURNAL_CARRIERS[type] || []).reduce(function (p, c) {
      return p.then(function () {
        var list = c[1].replace(/^find/, '').replace(/^./, function (x) { return x.toLowerCase(); });
        var crit = c[3] === 'performers' || c[3] === 'parents' ? '{ value: [' + JSON.stringify(id) + '], modifier: INCLUDES }'
          : '{ value: [' + JSON.stringify(id) + '], modifier: INCLUDES, depth: 0 }';
        var sel = c[4] === 'groups' ? 'id groups { group { id } scene_index }' : 'id';
        return gqlRequest('query GTTxCarriers { r: ' + c[1] + '(' + c[2] + ': { ' + c[3] + ': ' + crit + ' }, ' +
          'filter: { per_page: -1 }) { ' + list + ' { ' + sel + ' } } }', null).then(function (d) {
          var rows = ((d.r || {})[list]) || [];
          if (!rows.length) return;
          out[c[0] + '.' + c[4]] = rows.map(function (r) {
            if (c[4] !== 'groups') return String(r.id);
            var g = (r.groups || []).filter(function (x) { return String(x.group.id) === String(id); })[0];
            return [String(r.id), g ? g.scene_index : null];
          });
        });
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  // One entry a removed entity, with what brings it back.
  function journalSnapshot(save, id) {
    var t = JOURNAL_TYPES[save.type];
    var base = { type: save.type, id: id, action: save.spec.mode === 'merge' ? 'merge' : 'delete' };
    if (!hasOwn(JOURNAL_CREATE, save.type)) {
      return journalRead(function (i, o) { return window.fetch(i, o); }, save.type, [id], [], false).then(function (m) {
        base.name = ((m[id] || {})[t.name]) || '';
        base.lost = save.type === 'scenes' ? 'scene' : 'rescan';
        return base;
      });
    }
    return journalSnapFields(save.type).then(function (sf) {
      return gqlRequest('query GTTxSnapshot { o: ' + t.one + '(id: ' + JSON.stringify(id) + ') { ' + sf.sel + ' ' + t.name + ' } }', null)
        .then(function (d) {
          var o = d.o;
          if (!o) return null;
          base.name = o[t.name] || '';
          base.snapshot = { fields: sf.fields, o: o };
          if (save.type === 'scenes' && (save.filesGone || save.spec.mode === 'merge')) {
            base.lost = save.spec.mode === 'merge' ? 'scene-merge' : 'files';
            return base;
          }
          return journalCarriersOf(save.type, id).then(function (cr) { base.carriers = cr; return base; });
        });
    });
  }

  function journalCaptureRemoval(send, input, init, saves) {
    return Promise.all(saves.map(function (sv) {
      var reads = sv.ids.map(function (id) { return journalSnapshot(sv, id); });
      // A merge also notes what carried the destination, and its aliases, before.
      if (sv.into) {
        reads.push(journalCarriersOf(sv.type, sv.into).then(function (cr) {
          return gqlRequest('query GTTxMergeInto { o: ' + JOURNAL_TYPES[sv.type].one + '(id: ' + JSON.stringify(sv.into) + ') { ' +
            (sv.type === 'tags' ? 'aliases ' : '') + JOURNAL_TYPES[sv.type].name + ' } }', null).then(function (d) {
            return { into: sv.into, carriers: cr, aliases: d.o && d.o.aliases, name: d.o ? d.o[JOURNAL_TYPES[sv.type].name] : '' };
          });
        }));
      }
      return Promise.all(reads);
    })).then(function (all) {
      var p = send(input, init);
      p.then(function (resp) {
        if (!resp || !resp.ok) return;
        saves.forEach(function (sv, i) {
          var list = all[i].slice(0, sv.ids.length).filter(Boolean);
          var into = sv.into ? all[i][sv.ids.length] : null;
          // Recorded only once the entity is really gone: a refused delete leaves no line.
          journalRead(function (a, b) { return send(a, b); }, sv.type, sv.ids, [], false).then(function (now) {
            var gone = list.filter(function (e) { return !now[e.id]; });
            if (!gone.length) return;
            if (into) gone.forEach(function (e) { e.merge = into; });
            return journalRecord({ source: 'hand', label: journalLabel(sv) }, gone);
          }).then(null, function (e) { journalGap([sv], e); });
        });
      }, function () {});
      return p;
    }, function (e) {
      var p = send(input, init);
      p.then(function () { journalGap(saves, e); }, function () {});
      return p;
    });
  }

  // Old id to new, per type, off every undo that recreated something; followed through
  // a chain, so an entity deleted, put back, deleted and put back again resolves to now.
  function journalRemaps() {
    return journalRuns().then(function (runs) {
      var m = {};
      runs.slice().sort(function (a, b) { return a.at - b.at; }).forEach(function (r) {
        Object.keys(r.remap || {}).forEach(function (t) {
          m[t] = m[t] || {};
          Object.keys(r.remap[t]).forEach(function (old) { m[t][old] = String(r.remap[t][old]); });
        });
      });
      return function (type, id) {
        var seen = 0, cur = String(id), t = m[type] || {};
        while (hasOwn(t, cur) && seen++ < 50) cur = t[cur];
        return cur;
      };
    }, function () { return function (type, id) { return String(id); }; });
  }

  var LOST_REASON = {
    rescan: 'an image or gallery comes back by rescanning its files',
    files: 'its files were deleted with it',
    scene: 'this Stash cannot create a scene from here',
    'scene-merge': 'a scene merge moved its files, and is not undone here',
  };

  // Puts a removed entity back: create, reattach, and for a merge take the destination
  // off what only a source carried. Resolves to the new id.
  function journalRecreate(w) {
    var e = w.entries[0], c = JOURNAL_CREATE[e.type], snap = e.snapshot;
    var into = e.merge, t = JOURNAL_TYPES[e.type];
    var first = into && into.aliases && e.type === 'tags'
      ? gqlRequest('mutation GTTxUndoAliases($input: TagUpdateInput!) { tagUpdate(input: $input) { id } }',
        { input: { id: w.intoId, aliases: into.aliases } }).then(null, function () {})
      : Promise.resolve();
    return first.then(function () {
      var input = journalSnapInput(snap.fields, snap.o);
      if (w.remap) Object.keys(input).forEach(function (k) {
        if (k === 'tag_ids' || k === 'parent_ids' || k === 'child_ids') input[k] = input[k].map(function (x) { return w.remap('tags', x); });
        if (k === 'performer_ids') input[k] = input[k].map(function (x) { return w.remap('performers', x); });
        if (k === 'studio_id' || k === 'parent_id') input[k] = w.remap('studios', input[k]);
      });
      return gqlRequest('mutation GTTxUndoCreate($input: ' + c.input + '!) { ' + c.create + '(input: $input) { id } }', { input: input });
    }).then(function (d) {
      var made = String(((d || {})[c.create] || {}).id);
      return journalCarry(w, made).then(function () { return made; });
    });
  }

  // The recreated entity put back on what carried it, and for a merge the destination taken
  // off what only the source carried.
  function journalCarry(w, made) {
    var e = w.entries[0], into = e.merge;
    var before = into ? into.carriers || {} : {};
    return Object.keys(e.carriers || {}).reduce(function (p, key) {
      return p.then(function () {
        var parts = key.split('.'), ct = parts[0], field = parts[1];
        var ids = e.carriers[key].map(function (x) { return x; });
        return journalReattach(ct, field, ids, made, e.type, w.remap, w.renew).then(function () {
          if (!into || field === 'groups') return;
          // Both sides through the same remap: a carrier recreated earlier in this undo is
          // compared under its new id, or the destination was taken off what had it all along.
          var had = (before[key] || []).map(function (x) { return w.remap(ct, String(x)); });
          var only = ids.map(function (x) { return w.remap(ct, String(x)); }).filter(function (x) { return had.indexOf(x) === -1; });
          return journalDetach(ct, field, only, w.intoId, w.renew);
        });
      });
    }, Promise.resolve());
  }

  var BULK = { scenes: ['bulkSceneUpdate', 'BulkSceneUpdateInput'], images: ['bulkImageUpdate', 'BulkImageUpdateInput'],
    galleries: ['bulkGalleryUpdate', 'BulkGalleryUpdateInput'], performers: ['bulkPerformerUpdate', 'BulkPerformerUpdateInput'],
    groups: ['bulkGroupUpdate', 'BulkGroupUpdateInput'], tags: ['bulkTagUpdate', 'BulkTagUpdateInput'] };

  // `renew` is the undo's lease, renewed before each chunk.
  function journalChunks(ids, fn, renew) {
    var chunks = [];
    for (var i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    return chunks.reduce(function (p, ch) {
      return p.then(function () { if (renew) renew(); return fn(ch); });
    }, Promise.resolve());
  }

  // Each carrier still there gets the recreated entity back. A relation list goes back in
  // bulk; a studio's tags, a studio's parent and a scene's place in a group are one update
  // each, since those carry more than an id.
  function journalReattach(ct, field, list, made, type, remap, renew) {
    var ids = list.map(function (x) { return remap(ct, String(Array.isArray(x) ? x[0] : x)); });
    var one = function (id, input) {
      if (renew) renew();
      input.id = id;
      return gqlRequest('mutation GTTxUndoAttach($input: ' + JOURNAL_TYPES[ct].input + '!) { ' + JOURNAL_TYPES[ct].update +
        '(input: $input) { id } }', { input: input }).then(null, function () {});
    };
    if (field === 'groups') {
      return list.reduce(function (p, x, k) {
        return p.then(function () {
          return journalRead(function (i, o) { return window.fetch(i, o); }, 'scenes', [ids[k]], ['groups'], false).then(function (m) {
            if (!m[ids[k]]) return;
            var g = journalField('groups').read(m[ids[k]]).concat([{ group_id: made, scene_index: x[1] }]);
            return one(ids[k], { groups: g });
          });
        });
      }, Promise.resolve());
    }
    if (ct === 'studios') {
      return ids.reduce(function (p, id) {
        return p.then(function () {
          if (field === 'parent_id') return one(id, { parent_id: made });
          return journalRead(function (i, o) { return window.fetch(i, o); }, 'studios', [id], ['tag_ids'], false).then(function (m) {
            if (m[id]) return one(id, { tag_ids: journalField('tag_ids').read(m[id]).concat([made]) });
          });
        });
      }, Promise.resolve());
    }
    var b = BULK[ct];
    return journalChunks(ids, function (ch) {
      var input = { ids: ch };
      input[field] = field === 'studio_id' ? made : { ids: [made], mode: 'ADD' };
      var q = 'mutation GTTxUndoBulk($input: ' + b[1] + '!) { ' + b[0] + '(input: $input) { id } }';
      // A carrier deleted since fails the whole request, so the chunk goes one by one then.
      return gqlRequest(q, { input: input }).then(null, function () {
        return ch.reduce(function (p, id) {
          return p.then(function () {
            var solo = { ids: [id] };
            solo[field] = input[field];
            return gqlRequest(q, { input: solo }).then(null, function () {});
          });
        }, Promise.resolve());
      });
    }, renew);
  }

  function journalDetach(ct, field, ids, dest, renew) {
    if (!ids.length || !dest || !BULK[ct] || field === 'studio_id') return Promise.resolve();
    var b = BULK[ct];
    return journalChunks(ids, function (ch) {
      var input = { ids: ch };
      input[field] = { ids: [dest], mode: 'REMOVE' };
      return gqlRequest('mutation GTTxUndoDetach($input: ' + b[1] + '!) { ' + b[0] + '(input: $input) { id } }', { input: input })
        .then(null, function () {});
    }, renew);
  }

  // One wrapper per page, installed once; a newer evaluation replaces only the handler
  // it calls, so the wrapper never stacks and never latches onto old closures.
  function installJournalCapture() {
    var ns = window.__GTTx__;
    ns.journalHandle = journalCapture;
    if (ns.journalFetch && window.fetch === ns.journalFetch) return;
    if (typeof window.fetch !== 'function') return;
    var orig = window.fetch;
    ns.journalFetch = window.fetch = function (input, init) {
      var fn = ns.journalHandle;
      return fn ? fn(function (i, o) { return orig(i, o); }, input, init) : orig(input, init);
    };
  }

  // ── Undo History: undoing ─────────────────────────────────────────────────
  //
  // **Checked against what the entity holds now, field by field.** An entry is undone
  // only when the field still holds exactly what that write left; anything else - a later
  // edit by hand, by another browser, by a server task - makes it "changed since", and it
  // is skipped rather than overwritten. Per entity the entries go newest first, each
  // check made against what the newer ones will have put back, so undoing a whole run -
  // or a run and the one after it - never trips over its own changes. This is stricter
  // than comparing `updated_at`, which moves when any field does: a later edit to another
  // field does not stop an undo here, and a later edit to this one always does.
  //
  // Locked custom fields hold (ᝯㄝₓ Custom Fields Bulk Editor): an undo that would change
  // or remove one is refused, and one that puts a removed field back is allowed, the
  // same add-where-missing the lock always permits.
  var JOURNAL_ABSENT = { __absent: true };

  function entryBefore(e) { return e.beforeAbsent ? JOURNAL_ABSENT : e.before; }
  function entryAfter(e) { return e.afterAbsent ? JOURNAL_ABSENT : e.after; }

  function journalCurrent(o, field) {
    if (field.indexOf('files.') === 0) {
      var fid = field.slice(6), files = (o && o.files) || [];
      for (var i = 0; i < files.length; i++) if (String(files[i].id) === fid) return files[i].basename;
      return JOURNAL_ABSENT;
    }
    if (field.indexOf('custom_fields.') === 0) {
      var cf = (o && o.custom_fields) || {}, k = field.slice(14);
      return hasOwn(cf, k) ? cf[k] : JOURNAL_ABSENT;
    }
    if (field.indexOf('settings.') === 0) {
      var map = (o && o.settings) || {}, key = field.slice(9);
      return hasOwn(map, key) ? map[key] : JOURNAL_ABSENT;
    }
    return journalField(field).read(o);
  }

  // What a relation entry did: the ids its `after` has that its `before` lacks, and the
  // reverse. A plugin that only knows what it added may record `before: []`.
  function journalDelta(e) {
    var b = (e.before || []).map(String), a = (e.after || []).map(String);
    return { added: a.filter(function (x) { return b.indexOf(x) === -1; }),
      removed: b.filter(function (x) { return a.indexOf(x) === -1; }) };
  }

  function entryNewestFirst(a, b) {
    return (b.at - a.at) || (Number(b.id.split(':')[1]) - Number(a.id.split(':')[1])) ||
      (a.run < b.run ? 1 : a.run > b.run ? -1 : 0);
  }

  // Resolves to { items: [{ entry, status, reason }], writes: [{ type, id, input } |
  // { type, id, destroy: true }] }. Status is 'ok', 'changed', 'gone', 'undone',
  // 'locked' or 'unrecorded'.
  // An entry as it reads now: an entity put back since under a new id, and the related
  // ids in a relation, followed to that id. A copy, so the stored entry is left as it was.
  var REMAP_REL = { tag_ids: 'tags', parent_ids: 'tags', child_ids: 'tags', performer_ids: 'performers',
    gallery_ids: 'galleries', scene_ids: 'scenes', studio_id: 'studios', parent_id: 'studios' };
  function journalRemapped(e, remap) {
    var r = {}, k;
    for (k in e) if (hasOwn(e, k)) r[k] = e[k];
    r._orig = e;
    r.eid = remap(e.type, e.eid);
    r.entity = e.type + ':' + r.eid;
    if (hasOwn(REMAP_REL, e.field)) {
      var rt = REMAP_REL[e.field], m = function (v) {
        return Array.isArray(v) ? v.map(function (x) { return remap(rt, x); }) : v == null ? v : remap(rt, v);
      };
      r.before = m(e.before);
      r.after = m(e.after);
    }
    return r;
  }

  // An undo ticked with the change it undid cancels out: the two leave the library as it
  // was before either, so neither is written - which is what undoing the history back to
  // a point needs, where a change and its undo are both newer than the point.
  function journalPlan(entries) {
    return journalRemaps().then(function (remap) {
      var picked = {}, gone = {}, cancelled = [];
      entries.forEach(function (e) { picked[e.id] = e; });
      entries.forEach(function (e) {
        var o = e.undoes && picked[e.undoes];
        if (!o || o.undone !== e.run) return;
        gone[e.id] = gone[o.id] = true;
      });
      var rest = entries.filter(function (e) {
        if (!gone[e.id]) return true;
        cancelled.push(e);
        return false;
      });
      return journalPlanNow(rest.map(function (e) { return journalRemapped(e, remap); }), remap).then(function (plan) {
        plan.items = cancelled.map(function (e) {
          return { entry: e, status: 'cancelled', reason: 'undone and undone again in what is ticked, so nothing changes' };
        }).concat(plan.items);
        plan.cancelled = cancelled;
        // What `journalUndo` checks again once the deletes in it are put back.
        plan.entries = rest;
        plan.remap = remap;
        return plan;
      });
    });
  }

  function journalPlanNow(entries, remap) {
    var items = [], groups = {}, order = [], removals = [];
    entries.forEach(function (e) {
      if (e.undone) { items.push({ entry: e, status: 'undone', reason: 'already undone' }); return; }
      if (e.action === 'gap') { items.push({ entry: e, status: 'unrecorded', reason: 'this save was not recorded' }); return; }
      if (!hasOwn(JOURNAL_TYPES, e.type)) {
        items.push({ entry: e, status: 'unrecorded', reason: 'this kind of entity cannot be undone here yet' });
        return;
      }
      if (e.action === 'delete' || e.action === 'merge') {
        if (e.lost || !e.snapshot) {
          items.push({ entry: e, status: 'unrecorded', reason: LOST_REASON[e.lost] || 'nothing was kept to put it back' });
        } else {
          removals.push(e);
        }
        return;
      }
      if (e.action !== 'update' && e.action !== 'create') {
        items.push({ entry: e, status: 'unrecorded', reason: 'a ' + e.action + ' cannot be undone yet' });
        return;
      }
      if (!hasOwn(groups, e.entity)) { groups[e.entity] = []; order.push(e.entity); }
      groups[e.entity].push(e);
    });
    var byType = {};
    order.forEach(function (key) {
      var g = groups[key], t = g[0].type;
      byType[t] = byType[t] || { ids: [], fields: [], custom: false, files: false };
      byType[t].ids.push(g[0].eid);
      g.forEach(function (e) {
        if (!e.field) return;
        if (e.field.indexOf('custom_fields.') === 0) byType[t].custom = true;
        else if (e.field.indexOf('files.') === 0) byType[t].files = true;
        else if (journalField(e.field) && byType[t].fields.indexOf(e.field) === -1) byType[t].fields.push(e.field);
      });
    });
    var send = function (i, o) { return window.fetch(i, o); };
    var gone = {};
    removals.forEach(function (e) { (gone[e.type] = gone[e.type] || []).push(e.eid); });
    return Promise.all([fieldLocks(), Promise.all(Object.keys(byType).map(function (t) {
      return journalRead(send, t, byType[t].ids, byType[t].fields, byType[t].custom, byType[t].files)
        .then(function (m) { return [t, m]; });
    })), Promise.all(Object.keys(gone).map(function (t) {
      return journalRead(send, t, gone[t], [], false).then(function (m) { return [t, m]; });
    }))]).then(function (both) {
      var locks = both[0], now = {}, exists = {};
      var since = removals.length ? 'changed since - checked again once what was deleted is back' : 'changed since';
      both[1].forEach(function (pair) { now[pair[0]] = pair[1]; });
      both[2].forEach(function (pair) { exists[pair[0]] = pair[1]; });
      var writes = [];
      // Put back first, so whatever follows in the same undo finds them there - and what
      // follows is checked again then (`journalUndo`), against the new ids.
      removals.forEach(function (e) {
        if (exists[e.type][e.eid]) { items.push({ entry: e, status: 'undone', reason: 'it exists again' }); return; }
        items.push({ entry: e, status: 'ok', reason: e.action === 'merge' ? 'put back, and split off the tag it was merged into'
          : 'created again under a new id, and put back on what still carries it' });
        writes.push({ type: e.type, id: e.eid, name: e.name || '', recreate: true, entries: [e], remap: remap,
          intoId: e.merge ? remap(e.type, e.merge.into) : null });
      });
      order.forEach(function (key) {
        var g = groups[key].sort(entryNewestFirst), t = g[0].type, id = g[0].eid;
        var cur = now[t][id];
        if (!cur) {
          g.forEach(function (e) {
            items.push({ entry: e, status: 'gone', reason: 'it no longer exists' });
          });
          return;
        }
        if (g.some(function (e) { return e.action === 'create' && e.split; })) {
          g.forEach(function (e) {
            items.push({ entry: e, status: 'unrecorded', reason: 'a merge put back is merged again in Stash - deleting it ' +
              'here would leave what only it carried with neither tag' });
          });
          return;
        }
        if (g.some(function (e) { return e.action === 'create'; })) {
          g.forEach(function (e) {
            items.push({ entry: e, status: 'ok', reason: e.action === 'create' ? 'deleted again' : 'goes with the delete' });
          });
          writes.push({ type: t, id: id, name: cur[JOURNAL_TYPES[t].name] || '', destroy: true, entries: g });
          return;
        }
        var state = {}, touched = [], done = [];
        g.forEach(function (e) {
          if (!hasOwn(state, e.field)) state[e.field] = journalCurrent(cur, e.field);
          // A relation - tags, performers, galleries - is undone as the ids it added and
          // took away: still there and still gone is enough, whatever else joined since.
          if (hasOwn(JOURNAL_RELATIONS, e.field)) {
            var d = journalDelta(e), now = state[e.field] || [];
            var intact = d.added.every(function (x) { return now.indexOf(x) !== -1; }) &&
              d.removed.every(function (x) { return now.indexOf(x) === -1; });
            if (!intact) { items.push({ entry: e, status: 'changed', reason: since }); return; }
            state[e.field] = now.filter(function (x) { return d.added.indexOf(x) === -1; })
              .concat(d.removed).sort();
            if (touched.indexOf(e.field) === -1) touched.push(e.field);
            done.push(e);
            items.push({ entry: e, status: 'ok', reason: '' });
            return;
          }
          if (!journalSame(state[e.field], entryAfter(e))) {
            items.push({ entry: e, status: 'changed', reason: since });
            return;
          }
          if (e.field.indexOf('custom_fields.') === 0) {
            var name = e.field.slice(14);
            var locked = locks === false || !!(locks && locks.isLocked(name));
            var addingBack = state[e.field] === JOURNAL_ABSENT && entryBefore(e) !== JOURNAL_ABSENT;
            if (locked && !addingBack) {
              items.push({ entry: e, status: 'locked', reason: '"' + name + '" is locked' +
                (locks === false ? ' - the locks could not be read' : '') });
              return;
            }
          }
          state[e.field] = entryBefore(e);
          if (touched.indexOf(e.field) === -1) touched.push(e.field);
          done.push(e);
          items.push({ entry: e, status: 'ok', reason: '' });
        });
        if (!touched.length) return;
        if (JOURNAL_TYPES[t].settings) {
          var patch = {};
          touched.forEach(function (f) { patch[f.slice(9)] = state[f]; });
          writes.push({ type: t, id: id, name: id, entries: done, settings: patch });
          return;
        }
        var input = { id: id }, partial = null, remove = [];
        // A file goes back by moving it, in its own folder, under the name it had.
        touched.filter(function (f) { return f.indexOf('files.') === 0; }).forEach(function (f) {
          var mine = done.filter(function (e) { return e.field === f; });
          writes.push({ type: t, id: id, name: cur[JOURNAL_TYPES[t].name] || '', entries: mine,
            move: { ids: [f.slice(6)], destination_folder_id: mine[0].folder, destination_basename: state[f] } });
        });
        done = done.filter(function (e) { return e.field.indexOf('files.') !== 0; });
        touched = touched.filter(function (f) { return f.indexOf('files.') !== 0; });
        if (!touched.length) return;
        touched.forEach(function (f) {
          if (f.indexOf('custom_fields.') === 0) {
            if (state[f] === JOURNAL_ABSENT) remove.push(f.slice(14));
            else { partial = partial || {}; partial[f.slice(14)] = state[f]; }
          } else {
            input[f] = state[f];
          }
        });
        if (partial || remove.length) {
          input.custom_fields = {};
          if (partial) input.custom_fields.partial = partial;
          if (remove.length) input.custom_fields.remove = remove;
        }
        writes.push({ type: t, id: id, name: cur[JOURNAL_TYPES[t].name] || '', input: input, entries: done });
      });
      return { items: items, writes: writes };
    });
  }

  // Writes a plan, one mutation an entity, under a lease; `line(kind, text, write)` hears
  // each. The undo is recorded as a run of its own - so it can itself be undone, which is
  // redo - and the entries it undid are marked. Resolves to { written, failed, run }.
  function journalUndo(plan, line, opts) {
    line = line || function () {};
    var c = coop();
    var lease = { owner: PLUGIN_ID, label: 'Undo History', until: 0 };
    // Renewed per write and per re-attach chunk, and put back when a respecter has
    // dropped it as expired: undoing the delete of a tag on 30,000 scenes outlives 60 s.
    var renew = function () {
      lease.until = Date.now() + 60000;
      if (c.leases.indexOf(lease) === -1) c.leases.push(lease);
    };
    var release = function () {
      var i = c.leases.indexOf(lease);
      if (i !== -1) c.leases.splice(i, 1);
    };
    renew();
    var written = [], failed = 0, made = {};
    // Old id to now: the past undos' remaps, then this undo's own recreations as they land -
    // a tag put back a step ago is the one the next step re-attaches to, and a merge's
    // destination recreated first is the tag the split works on.
    var live = function (type, id) {
      var r = plan.remap ? plan.remap(type, id) : String(id);
      return made[type] && hasOwn(made[type], r) ? made[type][r] : r;
    };
    var write = function (p, w) {
      return p.then(function () {
        renew();
        var t = JOURNAL_TYPES[w.type], q, vars;
        if (w.recreate) {
          w.renew = renew;
          w.remap = live;
          if (w.entries[0].merge) w.intoId = live(w.type, w.entries[0].merge.into);
          return journalRecreate(w).then(function (id) {
            w.made = id;
            (made[w.type] = made[w.type] || {})[w.id] = id;
            written.push(w);
            line('UNDO', 'put back as ' + t.label.toLowerCase() + ' ' + id, w);
          }, function (e) {
            failed++;
            line('ERROR', 'it could not be put back: ' + (e && e.message ? e.message : e), w);
          });
        }
        if (w.settings) {
          // The map as it is now, the keys put back, and the whole of it sent: a plugin's
          // settings are one value to `configurePlugin`, which replaces what it is given.
          return gqlRequest('query GTTxUndoSettingsRead { configuration { plugins } }', null).then(function (d) {
            var map = {}, cur = (((d || {}).configuration || {}).plugins || {})[w.id] || {};
            Object.keys(cur).forEach(function (k) { map[k] = cur[k]; });
            Object.keys(w.settings).forEach(function (k) {
              if (w.settings[k] === JOURNAL_ABSENT) delete map[k]; else map[k] = w.settings[k];
            });
            return gqlRequest('mutation GTTxUndoSettings($plugin_id: ID!, $input: Map!) { ' +
              'configurePlugin(plugin_id: $plugin_id, input: $input) }', { plugin_id: w.id, input: map });
          }).then(function () {
            written.push(w);
            line('UNDO', plural(w.entries.length, 'setting') + ' put back', w);
          }, function (e) {
            failed++;
            line('ERROR', 'the undo failed: ' + (e && e.message ? e.message : e), w);
          });
        }
        if (w.move) {
          q = 'mutation GTTxUndoMove($input: MoveFilesInput!) { moveFiles(input: $input) }';
          vars = { input: w.move };
        } else if (w.destroy) {
          var input = {};
          if (t.destroyIds) input.ids = [w.id]; else input.id = w.id;
          Object.keys(t.destroyArgs || {}).forEach(function (k) { input[k] = t.destroyArgs[k]; });
          q = 'mutation GTTxUndoDelete($input: ' + t.destroyInput + '!) { ' + t.destroy + '(input: $input) }';
          vars = { input: input };
        } else {
          q = 'mutation GTTxUndo($input: ' + t.input + '!) { ' + t.update + '(input: $input) { id updated_at } }';
          vars = { input: w.input };
        }
        return gqlRequest(q, vars).then(function (data) {
          w.updatedAt = w.destroy || w.move ? null : ((data || {})[t.update] || {}).updated_at || null;
          written.push(w);
          line('UNDO', w.destroy ? 'deleted again' : w.move ? 'renamed back to "' + w.move.destination_basename + '"'
            : plural(w.entries.length, 'change') + ' put back', w);
        }, function (e) {
          failed++;
          line('ERROR', 'the undo failed: ' + (e && e.message ? e.message : e), w);
        });
      });
    };
    var puts = plan.writes.filter(function (w) { return w.recreate; });
    var rest = plan.writes.filter(function (w) { return !w.recreate; });
    // In the order the history happened, newest first: each delete or merge put back only
    // once every edit newer than it is undone, and each run of edits checked against the
    // library as it is then, with the ids recreated so far followed. A relation is undone as
    // a delta, so an edit newer than a merge, undone after the split, would put back what the
    // split took off; and an edit older than a delete, checked before the tag is back, reads
    // as "changed since" - as a studio changed then deleted would be written back as the dead
    // id. A check that fails keeps that run of edits out, as reviewed.
    var edits = (plan.entries || []).filter(function (e) { return e.action !== 'delete' && e.action !== 'merge'; });
    var backs = plan.entries ? puts.slice().sort(function (a, b) { return journalOrder(b.entries[0], a.entries[0]); }) : [];
    var edited = function (list) {
      if (!list.length) return Promise.resolve();
      var who = function (e) { return { type: e.type, id: e.eid, name: e.name, entries: [e] }; };
      return journalPlanNow(list.map(function (e) { return journalRemapped(e, live); }), live)
        .then(function (p) {
          // What the check keeps out is said, with its reason, as the review said it.
          p.items.forEach(function (it) {
            if (it.status !== 'ok' && it.status !== 'undone') line('SKIP', it.reason || it.status, who(it.entry));
          });
          return p.writes;
        }, function (e) {
          failed++;
          line('ERROR', plural(list.length, 'change') + ' could not be checked again, so ' +
            (list.length === 1 ? 'it was' : 'they were') + ' not undone: ' + (e && e.message ? e.message : e), who(list[0]));
          return [];
        })
        .then(function (writes) { return writes.reduce(write, Promise.resolve()); });
    };
    var left = edits;
    // A plan with no entries to check again is written as reviewed: put-backs, then the rest.
    var steps = !plan.entries ? puts.concat(rest).reduce(write, Promise.resolve())
      : !backs.length ? rest.reduce(write, Promise.resolve()) : backs.reduce(function (p, w) {
      var at = w.entries[0];
      return p.then(function () {
        var now = left.filter(function (e) { return journalOrder(e, at) > 0; });
        left = left.filter(function (e) { return journalOrder(e, at) <= 0; });
        return edited(now);
      }).then(function () { return write(Promise.resolve(), w); });
    }, Promise.resolve()).then(function () { return edited(left); });
    return steps.then(release, function (e) { release(); throw e; }).then(function () {
      var entries = [], undid = [], remap = null;
      written.forEach(function (w) {
        if (w.recreate) {
          var e = w.entries[0];
          undid.push(e);
          remap = remap || {};
          (remap[w.type] = remap[w.type] || {})[e.eid] = w.made;
          // `split`: a merge put back. Deleting it again would not put the surviving tag back on what
          // only the merged one carried, so a redo of it is refused, to be merged again in Stash.
          entries.push({ type: w.type, id: w.made, name: w.name, action: 'create', undoes: e.id, split: e.action === 'merge' || undefined });
          return;
        }
        w.entries.forEach(function (e) {
          undid.push(e);
          entries.push({ type: e.type, id: e.eid, name: w.name || e.name, field: e.field,
            action: e.action === 'create' ? 'delete' : 'update',
            before: e.afterAbsent ? undefined : e.after, after: e.beforeAbsent ? undefined : e.before,
            updatedAt: w.updatedAt, undoes: e.id, folder: e.folder });
        });
      });
      if (opts && opts.pop) {
        var out = undid.concat(plan.cancelled || []);
        if (!out.length) return { written: 0, failed: failed, run: null, popped: 0 };
        return journalPop(out, remap).then(function () {
          return { written: written.length, failed: failed, run: null, popped: out.length };
        });
      }
      if (!entries.length) return { written: 0, failed: failed, run: null };
      return journalRecord({ source: 'undo', label: 'Undo of ' + plural(undid.length, 'change'), remap: remap }, entries)
        .then(function (res) {
          // An undo record too large to keep is not kept, and then nothing is marked undone by it:
          // the changes still review as done, which is what the library holds.
          if (!res.run) return { written: written.length, failed: failed, run: null, tooLarge: !!res.tooLarge };
          return journalMark(undid, res.run).then(function () {
            return { written: written.length, failed: failed, run: res.run };
          });
        });
    });
  }

  // A pop: what was undone leaves the history instead of an undo joining it. An undo
  // popped puts the changes it had undone back in play, as a redo does; and a delete put
  // back under a new id hands its remap to the newest run still here, which is where older
  // entries naming the old id find it.
  // ponytail: that run is the remap's only holder, so deleting it by hand loses the remap.
  function journalPop(undid, remap) {
    var redone = undid.filter(function (e) { return (e._orig || e).undoes; });
    if (!redone.length && !remap) return journalRemove([], undid);
    return journalRemove([], undid).then(journalDb).then(function (db) {
      var tx = db.transaction(['runs', 'entries'], 'readwrite');
      var runs = tx.objectStore('runs'), store = tx.objectStore('entries');
      redone.forEach(function (e) {
        e = e._orig || e;
        var g = store.get(e.undoes);
        g.onsuccess = function () { if (g.result) { delete g.result.undone; store.put(g.result); } };
      });
      if (remap) {
        var all = runs.getAll();
        all.onsuccess = function () {
          var newest = all.result.sort(journalOrder).pop();
          if (!newest) return;
          newest.remap = newest.remap || {};
          Object.keys(remap).forEach(function (t) {
            newest.remap[t] = newest.remap[t] || {};
            Object.keys(remap[t]).forEach(function (old) { newest.remap[t][old] = remap[t][old]; });
          });
          runs.put(newest);
        };
      }
      return idbDone(tx);
    }).then(journalChanged);
  }

  // An undone entry is marked with the run that undid it; undoing that undo - a redo -
  // clears the mark on the entry it had undone, so it can be undone again.
  // Marks a run made and then lost - dropped by a later step - taken off again, and the marks its
  // redo cleared (`cleared`, what `journalMark` resolved to) put back where nothing marked them
  // since, so the history reviews as it was before.
  function journalUnmark(list, cleared) {
    return journalDb().then(function (db) {
      var tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries');
      list.forEach(function (e) { e = e._orig || e; delete e.undone; store.put(e); });
      (cleared || []).forEach(function (c) {
        var g = store.get(c.id);
        g.onsuccess = function () { if (g.result && !g.result.undone) { g.result.undone = c.undone; store.put(g.result); } };
      });
      return idbDone(tx);
    }).then(journalChanged);
  }

  // Resolves to the marks a redo cleared, `{ id, undone }` each.
  function journalMark(undid, runId) {
    var cleared = [];
    return journalDb().then(function (db) {
      var tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries');
      undid.forEach(function (e) {
        e = e._orig || e;
        e.undone = runId || true;
        store.put(e);
        if (e.undoes) {
          var g = store.get(e.undoes);
          g.onsuccess = function () {
            if (!g.result) return;
            if (g.result.undone) cleared.push({ id: g.result.id, undone: g.result.undone });
            delete g.result.undone;
            store.put(g.result);
          };
        }
      });
      return idbDone(tx);
    }).then(journalChanged).then(function () { return cleared; });
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  var LINES_DRAWN_DEFAULT = 1000;   // Lines Drawn at Once, where nothing is stored (`linesDrawn`)
  // **Busy Cursor**, in UI Customizations: what turns while a ᝯㄝₓ dialog works - every run log's
  // and Undo History's. `[value, name, frames, ms a frame]`, no frames for the CSS ring. Every
  // one turns clockwise and so has a backward, which Undo History runs (`busyCursor`).
  var BUSY_CURSORS = [
    ['ring', 'Ring', null, 0],
    ['blocks', 'Blocks', '▙▛▜▟', 125],
    ['quarters', 'Quarter Clock', '◴◷◶◵', 125],
    ['moon', 'Half Moon', '◐◓◑◒', 125],
    ['braille', 'Braille', '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏', 80],
    ['dense', 'Dense Braille', '⣾⣷⣯⣟⡿⢿⣻⣽', 80],
  ];
  var BUSY_DEFAULT = 'blocks';
  var DEFAULTS = {
    a1TaggerDuration: false,
    a2SelectPaste: false,
    a3SameTab: false,
    a4HeadingCounts: false,
    a4bFoldGroups: false,
    a5LogLinesKept: '',
    a6CaseSensitive: false,
    a7CardFieldCount: true,
    a8CardFileCount: true,
    a9HighlightColour: '',
    a9bLinesDrawn: '',
    a9cBusyCursor: '',
    d1GoodColor: '',
    d2AverageColor: '',
    d3BadColor: '',
    d4ErrorBgColor: '',
    d5MatchBgColor: '',
    d6AccentColor: '',
    d7FollowTheme: false,
    b1DevMods: '',
    // Undo History. An absent key reads as the default here, and the Plugins tab writes
    // the defaults in once (`seedSettings`) so its boxes show them - which is how two
    // switches can default to on when Stash shows an unset one as off.
    c1JournalKeepDays: '',
    c2JournalSizeMB: '',
    c3JournalSinceBackup: false,
    c4JournalHandEdits: true,
    c5JournalImageRuns: false,
    c6JournalProtect: true,
    c7JournalDeletes: true,
    c9JournalSettings: true,
    // What the review's "Take it out of the history" box starts as; the box still decides.
    c8JournalUndoTakesOut: false,
  };
  var _settings = null;
  var _settingsAt = 0;
  var _settingsInFlight = null;

  function settings() { return _settings || DEFAULTS; }

  // **Where every link these plugins draw opens, answered in one place.** Nine plugins
  // set `target` on an anchor and all of them ask this rather than naming `_blank`, so
  // the switch is one setting rather than nine.
  //
  // The read is fired from here rather than from `start()`, because §8 holds for this
  // too: a page drawing none of our links must ask nothing, and most tabs draw none.
  // It is fired only while nothing has been read yet - the settings page's own tick is
  // what refreshes it, which is the page the switch is thrown on - so a library-sized
  // log costs one query rather than one per ten seconds of drawing.
  //
  // The answer is synchronous, so the first link built on a page is drawn from the
  // default while that read is in flight: `_blank`, which is what every one of these
  // anchors said before this setting existed.
  function linkTarget() {
    if (!_settings && !_settingsInFlight) {
      try { loadSettings(false); } catch (e) { /* a settings read is never fatal */ }
    }
    return settings().a3SameTab ? '' : '_blank';
  }

  // **Where every text search's Case-sensitive box starts**, one setting for every plugin
  // that has such a box. Read fresh, because it is changed on Stash's settings page, which
  // nothing here hears, often just before the dialog it steers is opened. An unreadable
  // setting is the default: off.
  function caseSensitive() {
    return loadSettings(true).then(function (s) { return truthy(s.a6CaseSensitive); });
  }

  // `toLowerCase()` made length-preserving, for text searches that record positions in
  // the folded string and slice the original at them. 'İ' (U+0130) lower-cases to 'i' plus
  // a combining dot - two units for one - so it is taken to a plain 'i' first; checked
  // against every code point, it is the only one. A caller still compares lengths, for an
  // engine whose case tables say otherwise.
  function fold(text) {
    return String(text).replace(/\u0130/g, 'i').toLowerCase();
  }

  // ── Every plugin's settings, read once for all of them ────────────────────
  //
  // `configuration { plugins }` cannot be scoped to one plugin, and each plugin re-reads its
  // own every ten seconds: an idle page with all of them installed asked the same question
  // eighteen times a minute. They ask here instead, and one answer serves every caller for
  // `SETTINGS_TTL_MS`. A `configurePlugin` passing through `fetch` - Stash's settings page, a
  // plugin's own write, a seeded default - drops the answer as it goes out and again as it
  // lands (`configChanged`), so a read after a save is the saved map, and a read already in
  // flight when the save went out is handed to whoever asked before it but not kept. Each
  // caller gets a copy of its own, since some adjust what they read. `fresh` - a task or a
  // dialog opening - goes past the shared answer (and renews it): a change another tab saved
  // a moment ago is one no save here dropped. A write's read of the map it is about to send
  // back stays a query of its own, never this: a value another tab changed is one it would
  // otherwise write back over.
  var _config = null, _configAt = 0, _configWait = null, _configGen = 0;
  function configCopy(d) { return JSON.parse(JSON.stringify(d)); }
  function pluginConfig(fresh) {
    if (!fresh && _config && Date.now() - _configAt < SETTINGS_TTL_MS) return Promise.resolve(configCopy(_config));
    if (!_configWait) {
      var gen = _configGen;
      var wait = _configWait = gqlRequest('query GTTxPluginConfig { configuration { plugins } }', null).then(function (d) {
        if (_configWait === wait) _configWait = null;
        if (gen === _configGen) { _config = d; _configAt = Date.now(); }
        applyLogMods((d && d.configuration || {}).plugins);
        return d;
      }, function (e) {
        if (_configWait === wait) _configWait = null;
        throw e;
      });
    }
    return _configWait.then(configCopy);
  }
  // Core's own settings too, and a read of them already in flight is not kept.
  function configChanged() {
    _configGen++; _config = null; _configWait = null;
    _settingsAt = 0; _settingsInFlight = null;
  }

  function loadSettings(force) {
    var now = Date.now();
    if (!force && _settings && now - _settingsAt < SETTINGS_TTL_MS) {
      return Promise.resolve(_settings);
    }
    if (_settingsInFlight) return _settingsInFlight;
    var gen = _configGen;
    var wait = _settingsInFlight = pluginConfig(force)
      .then(function (data) {
        _pluginsRaw = (data.configuration || {}).plugins || {};
        var raw = _pluginsRaw[PLUGIN_ID] || {};
        var out = {}, k;
        for (k in DEFAULTS) if (hasOwn(DEFAULTS, k)) out[k] = hasOwn(raw, k) ? raw[k] : DEFAULTS[k];
        // The one heading-counts switch replaced two, `a4TagCount` and `a5PerformerCount`,
        // the day after they shipped. A map that has either on and has never had the new
        // key written reads as on; the old keys are left where they are.
        if (!hasOwn(raw, 'a4HeadingCounts') && (raw.a4TagCount || raw.a5PerformerCount)) {
          out.a4HeadingCounts = true;
        }
        // Kept only where no settings save went out meanwhile (`configChanged`).
        if (gen === _configGen) { _settings = out; _settingsAt = Date.now(); }
        if (_settingsInFlight === wait) _settingsInFlight = null;
        applyDevMods(parseDevMods(out.b1DevMods));
        seedSettings(raw, out);
        return out;
      }, function () {
        if (_settingsInFlight === wait) _settingsInFlight = null;
        return settings();
      });
    return wait;
  }

  // Every box is written once with its default - the switches, the log cap and Undo
  // History's limits - so the settings page shows what is in force rather than an empty
  // box or a switch that was never set. Only keys
  // that are absent, and only from the Plugins tab, where the boxes are, since §8 holds:
  // a page drawing none of ours writes nothing. Sent with the whole map, since
  // `configurePlugin` replaces it; the settings page reads through Stash's Apollo cache,
  // so the cached root field is evicted for it to show the seeded values.
  var _seeded = false;

  // **Stash's settings page copies the stored settings once, when it opens, and never
  // again** (`initialRef` in its Settings context). So a default seeded while it is open
  // shows only on the next visit, and the next switch flipped there saves the page's copy
  // - without it. So every read of Apollo's cached `configuration` also carries, for each
  // plugin registered here, the defaults its stored map lacks: `fill(raw, all)` returns
  // them by that plugin's own seed rules, and only absent keys are taken. Plugins load
  // before Stash draws a page (`PluginsLoader`), so the page draws what is in force from
  // its first paint, and its first save writes it. Nothing is sent for this.
  function showDefaults(pluginId, fill) {
    var ns = window.__GTTx__;
    ns.shownDefaults = ns.shownDefaults || {};
    ns.shownDefaults[pluginId] = fill;
    ns.shownRev = (ns.shownRev || 0) + 1;
    var cache = window.__APOLLO_CLIENT__ && window.__APOLLO_CLIENT__.cache;
    if (!cache || !cache.policies || !cache.policies.addTypePolicies) return;
    try {
      if (!ns.shownPolicy) {
        ns.shownPolicy = true;
        var memo = {};
        cache.policies.addTypePolicies({ Query: { fields: { configuration: { read: function (c) {
          if (!c || !c.plugins) return c;
          if (memo.c === c && memo.rev === ns.shownRev) return memo.out;
          var plugins = {}, id, k, changed = false;
          for (id in c.plugins) if (hasOwn(c.plugins, id)) plugins[id] = c.plugins[id];
          for (id in ns.shownDefaults) {
            if (!hasOwn(ns.shownDefaults, id)) continue;
            var raw = plugins[id] || {}, add = null, merged = null;
            try { add = ns.shownDefaults[id](raw, c.plugins); } catch (e) { add = null; }
            for (k in add || {}) {
              if (!hasOwn(add, k) || hasOwn(raw, k)) continue;
              if (!merged) { merged = {}; for (var r in raw) if (hasOwn(raw, r)) merged[r] = raw[r]; }
              merged[k] = add[k];
            }
            if (merged) { plugins[id] = merged; changed = true; }
          }
          var out = c;
          if (changed) { out = {}; for (k in c) if (hasOwn(c, k)) out[k] = c[k]; out.plugins = plugins; }
          memo = { c: c, rev: ns.shownRev, out: out };
          return out;
        } } } } });
      }
      // A read Apollo already answered is kept as it was; this makes the next one ask.
      if (cache.gc) cache.gc({ resetResultCache: true });
    } catch (e) { /* the page shows the stored map, as Stash alone would */ }
  }

  function onPluginsTab() {
    var l = window.location;
    return !!l && /^\/settings\b/.test(String(l.pathname || '')) &&
      /\btab=plugins\b/.test(String(l.pathname || '') + String(l.search || ''));
  }
  // `DEFAULTS`, less Dev Mods, with a number where an empty box means one - so the seeded
  // boxes show what is in force.
  var SEEDS = {};
  (function () {
    for (var k in DEFAULTS) if (hasOwn(DEFAULTS, k) && k !== 'b1DevMods') SEEDS[k] = DEFAULTS[k];
    SEEDS.a5LogLinesKept = LOG_KEEP;
    SEEDS.c1JournalKeepDays = String(JOURNAL_KEEP_DAYS);
    SEEDS.c2JournalSizeMB = JOURNAL_SIZE_MB;
    SEEDS.a9bLinesDrawn = String(LINES_DRAWN_DEFAULT);
    SEEDS.a9cBusyCursor = BUSY_DEFAULT;
    COLORS.forEach(function (c) { SEEDS[c.key] = c.dflt; });
  }());
  // What each absent key is seeded with: its default, but the heading-counts switch on
  // where either old key was, as `loadSettings` reads it. `showDefaults` shows the same.
  function seedValues(raw) {
    var out = {}, k;
    for (k in SEEDS) if (hasOwn(SEEDS, k)) out[k] = SEEDS[k];
    if (raw.a4TagCount || raw.a5PerformerCount) out.a4HeadingCounts = true;
    return out;
  }

  function seedSettings(raw, out) {
    if (_seeded || !onPluginsTab()) return;
    var missing = Object.keys(SEEDS).filter(function (k) { return !hasOwn(raw, k); });
    if (!missing.length) return;
    _seeded = true;
    var input = {}, k;
    for (k in raw) if (hasOwn(raw, k)) input[k] = raw[k];
    // A switch takes what `out` already reads, which is the migrated heading-counts value.
    var seeds = seedValues(raw);
    missing.forEach(function (key) { input[key] = out[key] = seeds[key]; });
    gqlRequest('mutation GTTxCoreSeedSettings($plugin_id: ID!, $input: Map!) { ' +
      'configurePlugin(plugin_id: $plugin_id, input: $input) }',
      { plugin_id: PLUGIN_ID, input: input }).then(function () {
        var client = window.__APOLLO_CLIENT__;
        if (!client || !client.cache || !client.cache.evict) return;
        try {
          client.cache.evict({ id: 'ROOT_QUERY', fieldName: 'configuration' });
          if (client.cache.gc) client.cache.gc();
        } catch (e) { /* the box fills on the next visit instead */ }
      }, function () { _seeded = false; });
  }

  // **`configurePlugin` replaces a plugin's settings; it never merges.** So the stored map
  // is read per write and sent back whole - see the repo-root AGENTS.md. Read from the
  // server rather than from the cache above, because a value another tab changed is a
  // value this write would otherwise put back.
  // Any plugin's: `op` names the two operations (`<op>Config`, `<op>Configure`), which each
  // plugin's suites and logs know it by. A key patched to `undefined` is taken out.
  function writePluginSettings(pluginId, patch, op) {
    return gqlRequest('query ' + op + 'Config { configuration { plugins } }', null)
      .then(function (data) {
        var raw = ((data.configuration || {}).plugins || {})[pluginId] || {};
        var input = {}, k;
        for (k in raw) if (hasOwn(raw, k)) input[k] = raw[k];
        for (k in patch) {
          if (!hasOwn(patch, k)) continue;
          if (patch[k] === undefined) delete input[k]; else input[k] = patch[k];
        }
        return gqlRequest(
          'mutation ' + op + 'Configure($plugin_id: ID!, $input: Map!) { ' +
          'configurePlugin(plugin_id: $plugin_id, input: $input) }',
          { plugin_id: pluginId, input: input });
      });
  }

  function writeOwnSettings(patch) {
    return writePluginSettings(PLUGIN_ID, patch, 'GTTxCore').then(function () { return loadSettings(true); });
  }

  // ── The Undo History settings, in a dialog of their own ───────────────────
  //
  // Nine settings about one thing made the group read as a wall, so they are one row of it -
  // what they say now, and a button opening them - the way Scene Variants keeps its title
  // rules. Nothing in the `.yml` names them any more (`.tests/version.test.js` lists them as
  // dialog-only); they are stored under their keys as before, the seed still writes their
  // defaults, and the dialog writes the whole map back like every settings write here.
  var JOURNAL_FIELDS = [
    { key: 'c1JournalKeepDays', label: 'Keep For (1 to 999 Days, or Forever)', text: true, dflt: JOURNAL_KEEP_DAYS,
      tip: 'How long Undo History keeps what was changed, in days: 1 to 999, or Forever. Default ' +
        '90.\n\nOlder runs are dropped, oldest first, the next time anything is recorded. A run ' +
        'you imported back from a file is kept past this, since you brought it back to undo it. ' +
        'Whichever limit is reached first - this one or the size - drops the oldest.' },
    { key: 'c2JournalSizeMB', label: 'Size Limit (16 to 4096 MB)', number: true, dflt: JOURNAL_SIZE_MB,
      tip: 'The most space Undo History may use in this browser, in MB: 16 to 4096. Default ' +
        '256.\n\n256 MB holds roughly half a million to a million changes - a couple of ' +
        'library-wide runs and years of edits by hand. Past it the oldest runs are dropped. A ' +
        'single run that would fill more than half of it is not recorded at all, and the dialog ' +
        'that wrote it says so; its own Undo still works while it is open.' },
    { key: 'c3JournalSinceBackup', label: 'Only Since the Last Backup',
      tip: 'Keep only what changed after the last database backup this browser saw. Off by ' +
        'default.\n\nA backup is the way back to anything older, so with this on the history ' +
        'holds just what the backup does not. A run you imported back from a file is kept, since ' +
        'you brought it back to undo it. This browser sees a backup when you take one with Back ' +
        'Up and Export in the Undo History dialog.' },
    { key: 'c4JournalHandEdits', label: 'Record Edits Made in Stash\'s Pages',
      tip: 'Record the edits you make in Stash\'s own pages in this browser, so they can be undone ' +
        'later too. On by default.\n\nTo record one, the entity is read just before Stash saves ' +
        'it and again just after, so a save waits for one small read - a large bulk edit in a ' +
        'list view pauses a moment. If that read fails, the save still goes through, unrecorded, ' +
        'and the history shows a gap there. Edits made in another browser, on another device, by ' +
        'Stash\'s own tasks (Scan, Identify, Auto Tag, Clean) or by scripts are never recorded. ' +
        'Deletes and tag merges have a switch of their own, Record Deletes and Merges, which ' +
        'works with this one off.' },
    { key: 'c7JournalDeletes', label: 'Record Deletes and Merges',
      tip: 'Keep what a delete or a tag merge takes away, so it can be put back. On by ' +
        'default.\n\nJust before Stash deletes a tag, performer, studio, group or scene, its ' +
        'fields and the ids of everything carrying it are read and kept; the undo creates it ' +
        'again - under a new id, since Stash never reuses one - and puts it back on what still ' +
        'exists of those. A tag merge is undone the same way, and the tag it was merged into is ' +
        'taken off what only the merged tag carried. Not brought back: a scene\'s play history ' +
        'and O-count, markers, pictures, and images, galleries and scenes whose files were ' +
        'deleted with them - those are recorded and the review says so. A delete of something ' +
        'large reads a lot first, and waits for it.' },
    { key: 'c9JournalSettings', label: 'Record Settings Changes',
      tip: 'Record the plugin settings you save in this browser - on Stash\'s settings page or in a ' +
        'ᝯㄝₓ plugin\'s own dialog - so a change can be undone later. On by default.\n\nEach ' +
        'setting that changed is a change of its own, the value before and after; undoing it ' +
        'puts that value back, the plugin\'s other settings left as they are then. The defaults ' +
        'a plugin writes in when it first loads are not recorded.' },
    { key: 'c5JournalImageRuns', label: 'Record Library-Wide Image Writes',
      tip: 'Record the image changes a ᝯㄝₓ plugin writes across the whole library. Off by ' +
        'default.\n\nOne such pass over a million images is up to a million changes and could ' +
        'push everything else out of the size limit. Off: those image changes are left out of ' +
        'the history - the dialog\'s own Undo still covers them while it is open - and images ' +
        'you edit yourself are always recorded.' },
    { key: 'c6JournalProtect', label: 'Protect Its Storage',
      tip: 'Ask the browser not to clear Undo History when the disk is nearly full. On by ' +
        'default.\n\nChrome and Edge grant it quietly to a site you use often, Firefox asks you ' +
        'once, and Safari may ignore it; the Undo History dialog says which. Nothing protects it ' +
        'from clearing this site\'s data yourself, or from a private window closing.' },
    { key: 'c8JournalUndoTakesOut', label: 'Undo Takes It Out of the History', warn: true,
      tip: 'Start the undo review with "Take it out of the history" ticked. Off by default.\n\nRISK ' +
        'OF HISTORY LOSS: ticked, what an undo puts back leaves Undo History instead of an undo ' +
        'being recorded beside it. Nothing is kept of it: that undo cannot itself be undone, and ' +
        'the changes it took out cannot be redone, found or exported again. Leave it off unless ' +
        'you mean the history to work as a stack.\n\nUnticked, the undo is recorded and can ' +
        'itself be undone. This only sets where the box starts: the review screen still shows it ' +
        'beside Proceed, and changing it there decides for that undo alone.' },
  ];
  function journalSummary(s) {
    var days = String(s.c1JournalKeepDays == null || s.c1JournalKeepDays === '' ? JOURNAL_KEEP_DAYS : s.c1JournalKeepDays);
    var mb = String(s.c2JournalSizeMB == null || s.c2JournalSizeMB === '' ? JOURNAL_SIZE_MB : s.c2JournalSizeMB);
    var on = function (k) { return truthy(s[k]); };
    var records = ['edits made in Stash\'s pages', 'deletes and merges', 'settings changes', 'library-wide image writes']
      .filter(function (x, i) { return on(['c4JournalHandEdits', 'c7JournalDeletes', 'c9JournalSettings', 'c5JournalImageRuns'][i]); });
    var text = 'Kept ' + (/^forever$/i.test(days) ? 'forever' : days + ' days') + ', up to ' + mb + ' MB' +
      (on('c3JournalSinceBackup') ? ', only since the last backup' : '') + '. Records ' +
      (records.length ? records.join(', ') : 'nothing from Stash\'s pages') + '.';
    // The one setting here that loses history, in its level while it is on.
    return on('c8JournalUndoTakesOut') ? [text + ' ', { text: 'An undo takes what it undid out of the history.', hl: true }] : text;
  }

  // One settings dialog for a list of fields in `JOURNAL_FIELDS`' shape - a box a field,
  // its label, the tip's first paragraphs under it - and `spec` saying what it is called and
  // what it says once read. `spec.open` is the one open now. Where the fields are not keys of
  // their own, `spec.read(settings)` gives their values and `spec.write(values)` the patch.
  // Core's own settings unless `spec.load()` and `spec.save(patch)` say whose: that is how a
  // plugin's `settingsDialog` uses it. A field is a switch, or a box with `text` or `number`;
  // `wide` gives a box room for a name or a list, and `mark(value)` - a node, a promise of one,
  // or null - is drawn after the box as it opens and again as it is typed into: what the name
  // resolves to, the way a row of Stash's page would have said it.
  // A color at work: lines as the plugins draw them, in the color the box holds, so a pick
  // shows before Save does - the default while the settings are still being read. A sample
  // is its parts: plain words, `{ dim }` in the gray the plugins give asides, and `{ hl }`
  // in the color, as text or, for a `bg` field, as the background behind it.
  function drawDemo(f, box, demos) {
    var col = el('div', 'gttxcore-demo');
    col.title = 'How the ᝯㄝₓ plugins draw with this color, in the one in the box. Made-up samples.';
    var spans = [];
    f.demo.forEach(function (sample) {
      var line = col.appendChild(el('div', 'gttxcore-demoline'));
      sample.forEach(function (p) {
        if (typeof p === 'string') markGlyphs(line.appendChild(el('span')), p, true);
        else if (p.dim != null) line.appendChild(el('span', 'gttxcore-demodim', p.dim));
        else spans.push(line.appendChild(el('span', p.cls || (f.bg ? 'gttxcore-demomark' : null), p.hl)));
      });
    });
    demos.push(function () {
      var c = box.disabled ? f.dflt : box.value;
      spans.forEach(function (n) { n.style[f.bg ? 'backgroundColor' : 'color'] = c; });
    });
    return col;
  }

  // Busy Cursor's sample: the style in its box, in the color in the Highlighted Text Color box,
  // 3 s forward, 0.2 s still, 3 s back and 0.2 s still again, so both ways show - and words
  // saying what each way means: a run planning, Undo History undoing.
  var BUSY_WORDS = { up: 'Planning 1204 changes…', down: 'Undoing 1204 changes…' };
  function drawBusyDemo(box, boxes, demos) {
    var col = el('div', 'gttxcore-demo'), line = col.appendChild(el('div', 'gttxcore-demoline'));
    col.title = 'The busy cursor in the box, both ways round: forward in a ᝯㄝₓ run, backward in Undo History.';
    var shown = null, node = null;
    demos.push(function () {
      var c = busyStyle(box.disabled ? BUSY_DEFAULT : box.value), hb = boxes.a9HighlightColour;
      if (c !== shown) {
        shown = c;
        line.textContent = '';   // the old cursor's timer finds it gone and stops
        node = line.appendChild(el('span', 'gttxcore-demobusy' + (c[2] ? '' : ' gttxcore-spinner gttxcore-spinner-both')));
        swing(node, line.appendChild(el('span')), c);
      }
      node.style.color = hb && !hb.disabled ? hb.value : HIGHLIGHT_DEFAULT;
    });
    // One timer for the frames and the words, started with the ring's own animation.
    function swing(n, words, c) {
      var f = c[2] ? c[2].split('') : null, t0 = Date.now();
      function tick() {
        var ms = Date.now() - t0, say = BUSY_WORDS[busyPhase(ms)];
        if (f) n.textContent = f[busySwing(ms, c[3]) % f.length];
        if (words.textContent !== say) words.textContent = say;
      }
      tick();
      var t = setInterval(function () {
        if (n.isConnected === false || !n.parentNode) { clearInterval(t); return; }
        tick();
      }, c[3] || 100);
    }
    return col;
  }
  // Which way the sample's 6.4 s loop is going, `ms` into it: `up` for the 3 s forward and the
  // pause after, `down` for the 3 s back and the pause after - a pause keeps the words before it.
  function busyPhase(ms) {
    return ms % 6400 < 3200 ? 'up' : 'down';
  }
  // How many frames on from the first the sample is, `ms` into its loop at `frame` ms a frame:
  // counting up for 3 s, held for 0.2 s, counting back down for 3 s, held at the first for 0.2 s.
  function busySwing(ms, frame) {
    var p = ms % 6400, top = Math.floor(3000 / frame);
    return p < 3000 ? Math.floor(p / frame) : p < 3200 ? top : p < 6200 ? top - Math.floor((p - 3200) / frame) : 0;
  }
  // A style as its dropdown shows it, right of its name: its frames side by side, or the ring still.
  function busyMark(c) {
    return el('span', 'gttxcore-busy gttxcore-busymark' + (c[2] ? '' : ' gttxcore-spinner gttxcore-spinner-still'), c[2]);
  }

  function openFieldsDialog(spec) {
    if (spec.open) { if (spec.open.modal.scrollIntoView) spec.open.modal.scrollIntoView(); return; }
    injectStyle();
    var backdrop = el('div', 'gttxcore-backdrop');
    var modal = el('div', 'gttxcore-modal gttxcore-narrow');
    backdrop.appendChild(modal);
    var head = el('div', 'gttxcore-head');
    head.appendChild(el('div', 'gttxcore-title', (spec.shortName || PLUGIN_SHORT_NAME) + ' - ' + spec.title));
    var note = el('div', 'gttxcore-note', 'Reading the current settings…');
    head.appendChild(note);
    modal.appendChild(head);
    var body = el('div', 'gttxcore-body');
    var boxes = {}, demos = [];
    // A heading (`fieldHeading`) parts the fields after it from those before, its switches with an
    // All On and All Off of their own where it has `allToggles`; every other loop reads `fields`.
    var fields = spec.fields.filter(function (f) { return !f.heading; }), sections = [], section = null;
    // The last line of a section has no rule under it: the next heading, or the footer, draws one.
    // Two rows where it is a line of two halves.
    var lineRows = [];
    function endSection() {
      var n = 0;
      for (var i = lineRows.length - 1; i >= 0 && hasClass(lineRows[i], 'gttxcore-half'); i--) n++;
      lineRows.slice(n && n % 2 === 0 ? -2 : -1).forEach(function (r) { r.className += ' gttxcore-devrow-end'; });
      lineRows = [];
    }
    spec.fields.forEach(function (f) {
      if (f.heading) {
        endSection();
        var hrow = body.appendChild(el('div', 'gttxcore-fieldhead'));
        var hname = hrow.appendChild(el('span', 'gttxcore-fieldheadname', f.heading));
        hname.title = f.tip || '';
        section = { f: f, ticks: [] };
        sections.push(section);
        if (f.allToggles) {
          hrow.appendChild(el('div', 'gttxcore-footgap'));
          var sec = section;
          [['on', 'All On', true], ['off', 'All Off', false]].forEach(function (p) {
            var b = sec[p[0]] = hrow.appendChild(button(p[1], 'gttxcore-section' + p[0]));
            b.disabled = true;
            b.addEventListener('click', function () {
              if (b.disabled) return;
              sec.ticks.forEach(function (k) { boxes[k].checked = p[2]; });
              refreshSave();
            });
          });
        }
        if (f.tip) body.appendChild(valueProse(el('div', 'gttxcore-devhelp gttxcore-fieldheadhelp'), f.tip.split('\n\n')[0]));
        return;
      }
      // `half`: a switch of a set that reads alike, two to a line, its description on hover alone.
      var row = el('div', 'gttxcore-devrow' + (f.demo ? ' gttxcore-demorow' : '') + (f.half ? ' gttxcore-half' : ''));
      // A field with samples: its line and help on the left, the samples beside them.
      var main = f.demo ? row.appendChild(el('div', 'gttxcore-devmain')) : row;
      var label = markLevel(el('label', 'gttxcore-devlabel' + (f.warn ? ' gttxcore-warnlabel' : '')), f.warn);
      label.title = f.tip;
      // `choices` - [[value, label, mark?], ...] - is a dropdown; the rest are one input each. A
      // `mark()` is a node drawn at the right of its label, in the box and in the list, where the
      // browser draws a dropdown's options as HTML (`appearance:base-select`); elsewhere it reads
      // as text after the label.
      var box;
      if (f.choices) {
        box = document.createElement('select');
        box.className = 'gttxcore-jbox gttxcore-choicebox';
        if (f.choices.some(function (c) { return c[2]; })) {
          box.className += ' gttxcore-richchoice';
          box.appendChild(el('button')).appendChild(document.createElement('selectedcontent'));
        }
        f.choices.forEach(function (c) {
          var o = document.createElement('option');
          o.value = c[0];
          if (!c[2]) o.textContent = c[1];
          else {
            o.appendChild(el('span', null, c[1]));
            o.appendChild(document.createTextNode(' '));
            o.appendChild(c[2]());
          }
          box.appendChild(o);
        });
      } else {
        box = document.createElement('input');
        box.type = f.color ? 'color' : f.text || f.number ? 'text' : 'checkbox';
        box.className = f.color ? 'gttxcore-colorbox'
          : f.text || f.number ? 'gttxcore-jbox' + (f.wide ? ' gttxcore-wide' : '') : 'gttxcore-devbox';
      }
      box.disabled = true;
      box.addEventListener(box.type === 'checkbox' || f.choices ? 'change' : 'input', function () { refreshSave(); });
      boxes[f.key] = box;
      if (section && box.type === 'checkbox') section.ticks.push(f.key);
      var name = markGlyphs(el('span', 'gttxcore-devname'), f.label, spec.plainNames);
      if (box.type === 'checkbox') { label.appendChild(box); label.appendChild(name); }
      else if (!f.color) { label.appendChild(name); label.appendChild(box); }
      // The label and its mark on one line: beside the label rather than in it, so a click on
      // the mark is not a click on the box, and in a line of their own so the mark follows the
      // box rather than wrapping under it.
      var line = main.appendChild(el('div', 'gttxcore-devline'));
      // A color has no empty box to fall back from, so its default is a button away. Box and
      // button lead, left-aligned like the switches whatever the name's length; the button stays
      // out of the label, so the label names the box by id.
      if (f.color) {
        box.id = 'gttxcore-field-' + f.key;
        label.htmlFor = box.id;
        label.appendChild(name);
        line.appendChild(box);
        var reset = line.appendChild(button('Default', 'gttxcore-colorreset'));
        reset.title = 'Put the default, ' + f.dflt + ', back in the box. Nothing is written until you press Save.';
        reset.addEventListener('click', function () { if (!box.disabled) { box.value = f.dflt; refreshSave(); } });
      }
      line.appendChild(label);
      if (f.tag) line.appendChild(tagGlyph());   // a box naming a tag, as ⓕ follows a field's
      if (f.mark) {
        var slot = line.appendChild(el('span', 'gttxcore-fieldmark'));
        var asked = 0, wait = null;
        box._mark = function () {
          var ask = ++asked;
          Promise.resolve(f.mark(String(box.value).replace(/^\s+|\s+$/g, ''))).then(function (node) {
            if (ask !== asked) return;                            // typed on while it was asked
            while (slot.firstChild) slot.removeChild(slot.firstChild);
            if (node) slot.appendChild(node);
          }, function () {});
        };
        box.addEventListener('input', function () { clearTimeout(wait); wait = setTimeout(box._mark, 400); });
      }
      // The description stays plain: the level is on the name, its box and its tick.
      if (!f.half) main.appendChild(valueProse(el('div', 'gttxcore-devhelp'), f.tip.split('\n\n').slice(0, 2).join(' ')));
      if (f.demo) row.appendChild(typeof f.demo === 'function' ? f.demo(box, boxes, demos) : drawDemo(f, box, demos));
      body.appendChild(row);
      lineRows.push(row);
    });
    endSection();
    modal.appendChild(body);
    var foot = el('div', 'gttxcore-foot');
    var saveBtn = button('Save', 'gttxcore-save');
    // Stash's blue: it writes a setting, never the library.
    saveBtn.className = saveBtn.className.replace('btn-secondary', 'btn-primary');
    var closeBtn = button('Close', 'gttxcore-close');
    closeBtn.title = 'Close without saving.';
    foot.appendChild(saveBtn);
    foot.appendChild(closeBtn);
    // Every field back to its default in its box, written only by Save like any other change:
    // Close, and the dialog opened again, gives back what is stored.
    var resetBtn = null;
    if (spec.resetAll) {
      resetBtn = foot.appendChild(button('Set All to Default', 'gttxcore-resetall'));
      resetBtn.disabled = true;
      resetBtn.title = 'Still reading the current settings.';
    }
    // Every switch of the dialog on or off at once, at the right end - written only by Save. The
    // dialog says in each button's tooltip what the two ends mean (`allToggles: { onTip, offTip }`).
    var allOn = null, allOff = null;
    if (spec.allToggles) {
      foot.appendChild(el('div', 'gttxcore-footgap'));
      allOn = foot.appendChild(button('All On', 'gttxcore-allon'));
      allOff = foot.appendChild(button('All Off', 'gttxcore-alloff'));
      [[allOn, true], [allOff, false]].forEach(function (p) {
        p[0].disabled = true;
        p[0].addEventListener('click', function () {
          if (p[0].disabled) return;
          fields.forEach(function (f) { var b = boxes[f.key]; if (b.type === 'checkbox') b.checked = p[1]; });
          refreshSave();
        });
      });
    }
    modal.appendChild(foot);
    var run = { modal: modal, backdrop: backdrop, closeBtn: closeBtn, stored: null };
    var values = function () {
      var out = {};
      fields.forEach(function (f) {
        var b = boxes[f.key];
        out[f.key] = b.type === 'checkbox' ? !!b.checked
          : f.number && /^\s*\d+\s*$/.test(b.value) ? Number(b.value) : String(b.value).trim();
      });
      return out;
    };
    function refreshSave() {
      demos.forEach(function (d) { d(); });
      var v = values(), s = run.stored, moved = false;
      if (s) fields.forEach(function (f) { if (String(v[f.key]) !== String(s[f.key])) moved = true; });
      saveBtn.disabled = !s || !moved;
      saveBtn.title = !s ? 'Still reading the current settings.' : !moved ? 'Nothing has changed since this opened.'
        : spec.saveTip;
      // Each held back where pressing it would change nothing.
      sections.forEach(function (sec) {
        if (!sec.on) return;
        sec.on.disabled = !s || sec.ticks.every(function (k) { return boxes[k].checked; });
        sec.off.disabled = !s || sec.ticks.every(function (k) { return !boxes[k].checked; });
        sec.on.title = (sec.on.disabled && s ? 'Every switch under ' + sec.f.heading + ' is on already. ' : '') + sec.f.allToggles.onTip;
        sec.off.title = (sec.off.disabled && s ? 'Every switch under ' + sec.f.heading + ' is off already. ' : '') + sec.f.allToggles.offTip;
      });
      if (allOn) {
        var ticks = fields.filter(function (f) { return boxes[f.key].type === 'checkbox'; });
        allOn.disabled = !s || ticks.every(function (f) { return boxes[f.key].checked; });
        allOff.disabled = !s || ticks.every(function (f) { return !boxes[f.key].checked; });
        allOn.title = (allOn.disabled && s ? 'Every switch here is on already. ' : '') + spec.allToggles.onTip;
        allOff.title = (allOff.disabled && s ? 'Every switch here is off already. ' : '') + spec.allToggles.offTip;
      }
    }
    refreshSave();
    function shut() {
      unwireEscape(run);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      spec.open = null;
    }
    closeBtn.addEventListener('click', shut);
    function store() {
      saveBtn.disabled = true;
      closeBtn.disabled = true;
      if (resetBtn) resetBtn.disabled = true;
      note.textContent = 'Saving…';
      (spec.save || writeOwnSettings)(spec.write ? spec.write(values()) : values()).then(shut, function (e) {
        closeBtn.disabled = false;
        if (resetBtn) resetBtn.disabled = false;
        note.textContent = 'The settings could not be saved: ' + (e && e.message ? e.message : e);
        refreshSave();
      });
    }
    saveBtn.addEventListener('click', function () { if (!saveBtn.disabled) store(); });
    if (resetBtn) resetBtn.addEventListener('click', function () {
      if (resetBtn.disabled) return;
      fields.forEach(function (f) {
        var b = boxes[f.key];
        if (b.type === 'checkbox') b.checked = !!SEEDS[f.key];
        else b.value = f.dflt == null ? '' : String(f.dflt);
      });
      refreshSave();
    });
    spec.open = run;
    wireEscape(run, 'gttxcore', closeOnly);
    document.body.appendChild(backdrop);
    (spec.load ? spec.load() : loadSettings(true)).then(function (s) {
      if (spec.open !== run) return;
      if (spec.read) s = spec.read(s);
      run.stored = {};
      fields.forEach(function (f) {
        var b = boxes[f.key], v = s[f.key];
        if (f.color) v = colorOf(v, f.dflt);
        if (b.type === 'checkbox') b.checked = truthy(v);
        else b.value = v == null || v === '' ? (f.dflt == null ? '' : String(f.dflt)) : String(v);
        run.stored[f.key] = b.type === 'checkbox' ? b.checked : (f.number && /^\d+$/.test(b.value) ? Number(b.value) : b.value);
        b.disabled = false;
        if (b._mark) b._mark();
      });
      note.textContent = spec.ready;
      if (resetBtn) {
        resetBtn.disabled = false;
        resetBtn.title = 'Put every setting here back to its default. Nothing is written until you press ' +
          'Save; Close leaves the settings as they were.';
      }
      refreshSave();
    }, function (e) {
      if (spec.open !== run) return;
      note.textContent = 'The current settings could not be read (' + (e && e.message ? e.message : e) +
        '), so Save stays off: saving would replace them with whatever the boxes hold.';
    });
  }

  var JOURNAL_DIALOG = { title: 'Undo History Settings', fields: JOURNAL_FIELDS, open: null,
    ready: 'What Undo History keeps and records, in this browser. Hover a line for all it does.',
    saveTip: 'Store these settings. They apply from the next thing recorded.' };
  function openJournalSettings() { openFieldsDialog(JOURNAL_DIALOG); }

  // Dev Mods: its switches stored as one string. Save applies them before the write lands
  // as well as after it: the flags are what it was pressed for, and a round trip is not a
  // reason to wait for them.
  var DEV_DIALOG = { title: 'Dev Mods', fields: DEV_MODS, open: null,
    ready: 'Switches for working on these plugins, not for using them. Each one sets a flag ' +
      'on the object the ᝯㄝₓ plugins share, so it reaches them at once and none of them ' +
      'writes anything because of it. All are off by default; the logs may be left on, the last ' +
      'two are not meant to be.',
    saveTip: 'Store these switches and apply them now.',
    read: function (s) { return parseDevMods(s.b1DevMods); },
    write: function (v) { applyDevMods(v); return { b1DevMods: formatDevMods(v) }; } };
  function openDevMods() { openFieldsDialog(DEV_DIALOG); }

  // **How much a setting can do on its own, in three levels of one color.** A field's `warn`,
  // a summary piece's `hl`: `'semi'` for what only decides what the writes below touch (a
  // filter, a path, a title rule) - the Highlighted Text Color blended toward the text; `true`
  // for what writes on its own, skips the review, renames files or has another large side
  // effect - the color itself; `'strong'` for what writes on its own with no dialog at all -
  // red, the Bad Result Text Color for now. A setting's name wears its level always, its
  // summary piece only while it is on, a switch its tick, an edit box its border, never its
  // description; a row wears its settings' highest level
  // on its heading, `'strong'` counting as `true`, and any level makes its button orange.
  var LEVEL_COLOR = {
    semi: 'color-mix(in srgb,var(--gttx-highlight,#ffc107) 55%,var(--gttx-fg,#f5f8fa))',
    hl: 'var(--gttx-highlight,#ffc107)',
    strong: 'var(--gttx-bad,#ff7b72)',
  };
  function levelOf(w) { return w === 'semi' || w === 'strong' ? w : w ? 'hl' : ''; }
  function parentLevel(list) {
    var ls = (list || []).map(levelOf);
    return ls.indexOf('hl') !== -1 || ls.indexOf('strong') !== -1 ? 'hl' : ls.indexOf('semi') !== -1 ? 'semi' : '';
  }
  // `node` in `w`'s level, and in no other: its class alone moves, so a tick repeating it
  // changes nothing on the page. Returns `node`.
  function markLevel(node, w) {
    if (!node) return node;
    var lv = levelOf(w), had = String(node.className || '');
    var cls = had.replace(/(^|\s)gttx-lv-\w+/g, '').replace(/^\s+|\s+$/g, '');
    if (lv) cls = (cls ? cls + ' ' : '') + 'gttx-lv-' + lv;
    if (cls !== had) node.className = cls;
    return node;
  }
  // Summary pieces - words, `{ text }`, `{ cf }` - every one in `w`'s level: what a setting
  // says while it is on.
  function atLevel(pieces, w) {
    return (pieces || []).map(function (p) {
      if (typeof p === 'string') return { text: p, hl: w };
      var q = {};
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) q[k] = p[k];
      q.hl = w;
      return q;
    });
  }
  // A row's heading in its level and its button - ours, never Stash's hidden Edit - orange
  // for any level: a row of Stash's own a plugin took over, or one Core draws. Idempotent.
  function levelRow(row, w, btn) {
    if (!row || !row.querySelector) return;
    var lv = parentLevel([w]);
    markLevel(row.querySelector('h3'), lv);
    if (!btn) return;
    var had = String(btn.className || '');
    var want = had.replace(/(^|\s)btn-(primary|warning)(?=\s|$)/, '$1' + (lv ? 'btn-warning' : 'btn-primary'));
    if (want !== had) btn.className = want;
  }

  // ⓕ, 🖬 and Scene Variants' ⸎ in the Highlighted Text Color wherever a summary or a dialog
  // names them, as on the cards (`CARD_HIGHLIGHT`); `plain` leaves the color off, as a row's
  // description does. The three are in monospace at one size wherever they are drawn
  // (`.gttx-glyph`, as the custom-field mark `.gttx-cftip` and the card counters are), so they
  // look the same whatever font is around them. Appended to `node`, which is returned.
  var CARD_MARKS = /(ⓕ|🖬|⸎)/;
  // A description's prose, a switch's value drawn in the value font, as a summary draws a quoted
  // one: "On:" or "Off:" opening a sentence (or "On by default"), and a capital On or Off inside one
  // ("set to Off", "Off, Prune or Roll-Up"). A sentence opening "On the Edit tab" is prose. Appended
  // to `node`, which is returned.
  var SWITCH_VALUE = /(^|[.!?]\s+|\n\s*)(On|Off)(?=:| by default\b)|([a-z,;:(] )(On|Off)\b(?![-'])/g;
  function valueProse(node, text, plain) {
    var t = String(text == null ? '' : text), last = 0, m;
    SWITCH_VALUE.lastIndex = 0;
    while ((m = SWITCH_VALUE.exec(t)) !== null) {
      var lead = m[1] != null ? m[1] : m[3], word = m[2] || m[4];
      var at = m.index + lead.length;
      if (at > last) markGlyphs(node, t.slice(last, at), plain);
      node.appendChild(el('span', 'gttx-switchval', word));
      last = at + word.length;
    }
    if (last < t.length) markGlyphs(node, t.slice(last), plain);
    return node;
  }

  function markGlyphs(node, text, plain) {
    String(text).split(CARD_MARKS).forEach(function (part, i) {
      if (!part) return;
      var cls = i % 2 ? (plain ? '' : 'gttxcore-hl-mark ') + 'gttx-glyph' : '';
      node.appendChild(el('span', cls || null, part));
    });
    return node;
  }

  // A summary's words: a setting's own value - what stands between a pair of double quotes -
  // in the value font the row inherits (`.gttx-lit`), and the words around it, the quotes with
  // them, in the page's sans-serif at the same size (`.gttx-prose`), so a value reads apart
  // from what is said about it.
  function summaryText(node, text) {
    String(text).split(/("[^"]*")/).forEach(function (part, i) {
      if (!part) return;
      if (i % 2) {
        node.appendChild(el('span', 'gttx-prose', '"'));
        // A value's own characters, plain: a ⸎ in a tag's name is part of the name, not a mark.
        markGlyphs(node.appendChild(el('span', 'gttx-lit')), part.slice(1, -1), true);
        node.appendChild(el('span', 'gttx-prose', '"'));
      } else valueProse(node.appendChild(el('span', 'gttx-prose')), part);   // "On: …", "Every switch: Off"
    });
    return node;
  }

  // A row's summary: a string, or a list of pieces - a string; `{ text, hl, mark }`, where
  // `hl` colors it as the dialog colors a switch that writes on its own, and `mark()` gives
  // the node to put after it (a node, a promise of one, or null): a tag's 🔗 with the tooltip
  // it carries in the dialog; or `{ cf }`, a custom field's name, quoted with its ⓕ inside the
  // quotes, the mark being part of the name; or `{ swatch }`, a `#rrggbb` color, quoted, after a
  // square of it. `summaryKey` is what says it changed.
  function summaryKey(sum) {
    if (typeof sum === 'string') return sum;
    return (sum || []).map(function (p) {
      return typeof p === 'string' ? p : p.cf != null ? '#' + levelOf(p.hl) + '#' + p.cf : p.swatch != null ? '%' + p.swatch
        : (p.hl ? '!' + levelOf(p.hl) : '') + (p.mark ? '@' : '') + p.text;
    }).join('\u0000');
  }
  // Where the pieces are the same pieces - the same count, each colored or not, a field or
  // not and marked or not as before - only a piece whose words moved is drawn again, inside its
  // own span, and only it asks for its mark again: a piece taken out and put back is a flicker
  // under the pointer.
  function drawSummary(node, sum) {
    injectStyle();                        // a plugin's own row can be the first thing drawn
    if (typeof sum === 'string') sum = [sum];
    var want = (sum || []).map(function (p) {
      if (typeof p === 'string') return { text: p };
      if (p.cf != null) return { text: String(p.cf), cf: true, hl: levelOf(p.hl), mark: function () { return cfTipMark(p.cf); } };
      if (p.swatch != null) return { text: String(p.swatch), swatch: true };
      return { text: p.text, hl: levelOf(p.hl), mark: p.mark || null, tag: !!p.tag };
    });
    var had = node._pieces;
    var same = !!had && had.length === want.length && had.every(function (h, i) {
      return h.hl === (want[i].hl || '') && h.cf === !!want[i].cf && h.swatch === !!want[i].swatch && h.mark === !!want[i].mark;
    });
    var fillMark = function (piece, p) {
      var slot = piece.slot, asked = piece.asked = (piece.asked || 0) + 1;
      Promise.resolve(p.mark()).then(function (m) {
        if (m && piece.asked === asked && slot.parentNode) slot.appendChild(m);
      }, function () {});
    };
    var fill = function (piece, p) {
      var span = piece.span;
      while (span.firstChild) span.removeChild(span.firstChild);
      piece.text = p.text;
      piece.tag = !!p.tag;
      if (p.cf) {
        span.appendChild(el('span', 'gttx-prose', '"'));
        markGlyphs(span.appendChild(el('span', 'gttx-lit')), p.text, true);
        piece.slot = span.appendChild(el('span', 'gttxcore-cfslot'));
        span.appendChild(el('span', 'gttx-prose', '"'));
      } else if (p.tag) {
        // A tag's name, its icon inside the quotes as a field's ⓕ is, and its link close after them.
        span.appendChild(el('span', 'gttx-prose', '"'));
        markGlyphs(span.appendChild(el('span', 'gttx-lit')), String(p.text).replace(/^"|"$/g, ''), true);
        span.appendChild(tagGlyph());
        span.appendChild(el('span', 'gttx-prose', '"'));
        if (p.mark) piece.slot = span.appendChild(el('span', 'gttxcore-summark gttxcore-tagslot'));
      } else {
        // A color's code is its value, quoted like any other; the square before the quotes.
        if (p.swatch) span.appendChild(el('span', 'gttxcore-swatch')).style.backgroundColor = p.text;
        summaryText(span, p.swatch ? '"' + p.text + '"' : p.text);
        if (p.mark) piece.slot = span.appendChild(el('span', 'gttxcore-summark'));
      }
      if (p.mark) fillMark(piece, p);
    };
    if (same) {
      // A tag named or cleared is that piece's own words changing, not the summary's shape.
      want.forEach(function (p, i) { if (had[i].text !== p.text || had[i].tag !== !!p.tag) fill(had[i], p); });
      return;
    }
    while (node.firstChild) node.removeChild(node.firstChild);
    node._pieces = want.map(function (p) {
      var piece = { hl: p.hl || '', cf: !!p.cf, swatch: !!p.swatch, mark: !!p.mark, tag: !!p.tag,
        span: node.appendChild(el('span', p.hl === 'hl' ? 'gttxcore-hl-mark' : p.hl ? 'gttx-lv-' + p.hl : null)) };
      fill(piece, p);
      return piece;
    });
  }

  function dialogRowTick(group, r) {
    var P = r.prefix || 'gttxcore';
    var id = P + '-' + r.key + '-row', had = document.getElementById(id);
    var sum = r.summary(r.settings ? r.settings() : settings()), text = summaryKey(sum);
    if (had) {
      if (had._text !== text) { had._text = text; drawSummary(had._sum, sum); }
      return;
    }
    // The group's own heading is a `.setting` too, beside the `.collapsible-section` of the rest.
    var rows = group.querySelectorAll ? group.querySelectorAll('.setting') : [], first = null;
    for (var i = 0; i < rows.length && !first; i++) if (rows[i].parentNode !== group) first = rows[i];
    var row = el('div', 'setting gttxcore-dialog-row ' + P + '-' + r.key + '-row');
    row.id = id;
    var left = el('div');
    left.appendChild(el('h3', null, r.heading));
    // The row's description plain, its summary below it colored: the marks are what the summary
    // says is on, not what the description is about.
    left.appendChild(markGlyphs(el('div', 'sub-heading'), r.line, true));
    row._text = text;
    row._sum = left.appendChild(el('div', 'value ' + P + '-' + r.key + '-sum'));
    drawSummary(row._sum, sum);
    row.appendChild(left);
    var right = el('div');
    var btn = settingButton(r.button, P + '-' + r.key + '-btn');
    btn._coopOwner = r.owner || PLUGIN_ID;
    btn.title = r.title;
    btn.addEventListener('click', function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (ev && ev.stopPropagation) ev.stopPropagation();
      r.open();
    });
    right.appendChild(btn);
    row.appendChild(right);
    levelRow(row, r.level, btn);
    var last = rows.length ? rows[rows.length - 1] : null;
    if (r.at === 'end' && last && last.parentNode !== group) last.parentNode.insertBefore(row, last.nextSibling);
    else if (first && first.parentNode) first.parentNode.insertBefore(row, first);
    else (childByClass(group, 'collapsible-section') || group).appendChild(row);
  }
  // A plugin with no setting of its own still has Stash's `.collapsible-section`, empty: its rows go
  // in it, so they fold with the group (`fold`) rather than stand below it.
  function childByClass(node, c) {
    var kids = (node && node.childNodes) || [];
    for (var i = 0; i < kids.length; i++) if (hasClass(kids[i], c)) return kids[i];
    return null;
  }

  // ── A plugin's settings as one row of its group, and a dialog ─────────────
  //
  // What Core does for its own UI Customizations and Undo History, for any plugin: settings
  // that made the group read as a wall become one row - a heading, a line saying what is
  // inside, what they say now, and a button - and a dialog holding them, each with its full
  // description on hover. They leave the plugin's `.yml` and keep their keys, so what is
  // stored does not move and config.yml still edits them; the plugin still seeds their
  // defaults. `o`:
  //   id, shortName, prefix   the plugin's id, short name, and CSS prefix (the row's id)
  //   key, title, line        the row: a key for its id, the heading, the line under it
  //   fields                  `{ key, label, tip, text | number, wide, dflt }` - a switch without
  //                           `text` or `number`; `tip` is the setting's whole description - and
  //                           any `fieldHeading(...)`, parting one row's dialog into sections;
  //                           `half` draws a switch two to a line, its description on hover
  //   summary(s)              what the settings say now, from the plugin's settings `s`
  //   settings()              the plugin's settings as last read (the row's summary)
  //   load()                  a promise of them read fresh (the dialog, as it opens)
  //   saved(patch)            called once a save lands, to re-read them
  // Returns `{ tick(group), open() }`; a plugin calls `tick` from its own settings tick, and
  // rows land in the group in the order they are ticked, after its own settings.
  // A section of a settings dialog: its heading, a line under it from `tip`'s first paragraph (the
  // whole of it on hover), and an All On and All Off for its switches where `allToggles` -
  // `{ onTip, offTip }` - says what the two ends mean.
  function fieldHeading(title, tip, allToggles) { return { heading: title, tip: tip || '', allToggles: allToggles || null }; }
  function settingsDialog(o) {
    // A setting's name draws ⓕ, 🖬 and ⸎ plain, as UI Customizations' do: the highlight is for what
    // a setting holds or does, not for the words naming it.
    var spec = { title: o.title, fields: o.fields, open: null, shortName: o.shortName, load: o.load,
      allToggles: o.allToggles, plainNames: true,
      ready: o.ready || 'Hover a line for all it does. Nothing is written until you press Save.',
      saveTip: 'Store these settings. They apply from the next thing they decide.',
      save: function (patch) {
        return writePluginSettings(o.id, patch, o.prefix + 'Dialog').then(function () { return o.saved ? o.saved(patch) : null; });
      } };
    var row = { key: o.key, prefix: o.prefix, owner: o.id, at: 'end', heading: o.title, line: o.line,
      level: parentLevel(o.fields.map(function (f) { return f.warn; })),
      summary: o.summary, settings: o.settings, button: o.title + '...',
      title: 'Open the ' + o.title + ' settings. Nothing is written until you press Save there.',
      // A dialog of the plugin's own in place of the fields one (`open`), for what no field holds.
      open: function () { if (o.open) o.open(); else openFieldsDialog(spec); } };
    return {
      open: row.open,
      tick: function (group) { if (group) dialogRowTick(group, row); },
    };
  }

  var JOURNAL_ROW = { key: 'journal', heading: 'Undo History', summary: journalSummary,
    level: parentLevel(JOURNAL_FIELDS.map(function (f) { return f.warn; })),
    line: 'How long Undo History keeps what was changed and what it records: edits in Stash\'s pages, ' +
      'deletes and merges, settings changes, library-wide image writes. Nine settings, in a dialog.',
    button: 'Undo History Settings...', open: openJournalSettings,
    title: 'Open the Undo History settings. Nothing is written until you press Save there.' };
  function journalRowTick(group) { dialogRowTick(group, JOURNAL_ROW); }

  // ── UI Customizations: the rest of Core's settings, in a dialog of their own ─
  //
  // Settings about many different things made the group read as a wall with Undo History and
  // Dev Mods lost in it, so they are one row as Undo History's are, and the group shows UI
  // Customizations, Undo History, Maximum Log Lines Kept, Case-Sensitive Matching and Dev Mods
  // (the log cap is a `.yml` NUMBER: not a look). Stored under their keys
  // as before (`version.test.js`' `DIALOG_ONLY`), seeded and read as before.
  var GLOBAL_FIELDS = [
    { key: 'a1TaggerDuration', label: 'Emphasize a Tagger Duration Mismatch',
      tip: 'Emphasize the Scene Tagger\'s duration mismatch. Off by default.\n\nStash\'s tagger prints ' +
        '"Duration off by at least Ns" among the other fields on a search result, in the same weight and ' +
        'color as everything beside it - and it is the one line there that decides whether a match is the ' +
        'right file. With this on, that sentence is drawn larger, capitalised and in the Bad Result Text ' +
        'Color when the gap is more than five seconds, and in the Highlighted Text Color when it is more ' +
        'than one; anything closer is left alone.\n\nIt ' +
        'restyles a page this plugin does not own, and only how the sentence looks: nothing is hidden, ' +
        'reordered, acted on or written.' },
    { key: 'a2SelectPaste', label: 'Right-Click Paste in Tags and Performers Boxes',
      tip: 'Add a right-click Paste to the Tags, Performers and Groups boxes. Off by default.\n\nThose ' +
        'boxes offer no Paste in the browser\'s context menu, while Title and Details do. There is a real ' +
        'text input in them, but it is sized to what has been typed, so the right-click lands beside it. ' +
        'This widens it to fill the rest of the row, so the browser offers its own Paste, which goes down ' +
        'the same path Ctrl+V already uses.\n\nIt stands in for stashapp/stash issue 7139 and nothing ' +
        'more: when a Stash release fixes that, it changes nothing you can see.' },
    { key: 'a3SameTab', label: 'Open Links in the Same Tab',
      tip: 'Open every link the ᝯㄝₓ plugins draw in the tab you are already in. Off by default, which ' +
        'is a new tab.\n\nTheir dialogs, listings and hover cards name entities as links, and every one ' +
        'of them opens a new tab, which keeps the dialog you are reading open behind it. On: they all ' +
        'open in the current tab, the way Stash\'s own links do - every ᝯㄝₓ plugin at once, from the ' +
        'next link drawn.' },
    { key: 'a4HeadingCounts', label: 'Show Counts on Headings',
      tip: 'Put the number of things after the word above every Tags, Performers and Custom Fields ' +
        'list. Off by default.\n\nOn the details view and the edit form of a scene, image, gallery, ' +
        'performer, studio, group or tag, the heading reads Tags (12), Performers (3) or Custom Fields (5) ' +
        'instead of the bare word, counted off what the page shows. It changes only the heading\'s text, ' +
        'and nothing is read from your library for it.' },
    { key: 'a4bFoldGroups', label: 'Fold Every ᝯㄝₓ Plugin\'s Settings',
      tip: 'Give every ᝯㄝₓ plugin\'s group on Settings → Plugins a chevron that folds its settings away, ' +
        'folded to start. Off by default.\n\nOn: every group with settings to hide folds, on any Stash - its ' +
        'heading clicks it open and shut, as Stash\'s own folding groups do; a plugin with no settings gets ' +
        'none. Off: a group folds only where Stash folds the plugin groups around it - a Stash that folds ' +
        'only plugins with a setting of their own in the .yml - so it does not stand open among them. From ' +
        'the next time the page is drawn.' },
    { key: 'a7CardFieldCount', label: 'Show ⓕ Custom Field Count on Cards',
      tip: 'Put ⓕ and the number of custom fields an entity holds last in the row of counters under its ' +
        'card. On by default.\n\nOn scene, image, gallery, performer, studio, group and tag cards, where ' +
        'it holds at least one; its tooltip lists them, name and value. The fields are read once for a ' +
        'page of cards at a time.' },
    { key: 'a8CardFileCount', label: 'Show 🖬 File Count on Scene Cards',
      tip: 'Put 🖬 and the number of files last in the row of counters under a scene\'s card, where the ' +
        'scene has more than one file. On by default.\n\nIts tooltip names them, the first being the one ' +
        'Stash plays and names the scene by. Nothing is read from your library for it.' },
    { key: 'a9bLinesDrawn', label: 'Lines Drawn at Once (100 to 10000)', number: true, dflt: LINES_DRAWN_DEFAULT,
      tip: 'How many lines a ᝯㄝₓ dialog draws at once - a log, a listing of results or changes, a list to pick ' +
        'from: 1000 by default, 100 to 10000.\n\nEvery line is kept whatever this says - Copy log copies them all, ' +
        'and a listing pages through the rest - so a larger number shows more at once for more of the browser\'s ' +
        'time and memory, and a library with tens of thousands of lines draws fastest at the default.' },
    { key: 'd7FollowTheme', label: 'Follow the Stash Theme',
      tip: 'Draw the ᝯㄝₓ dialogs, tooltips and panes in the grays of the Stash theme you run. Off by ' +
        'default, which keeps their own dark grays.\n\nThe grays are read off a hidden sample of Stash\'s ' +
        'own dialog under the active theme - its background, its text and its muted text - and the ' +
        'borders and shades are worked out from those, so a theme that restyles Stash\'s dialogs restyles ' +
        'these too, within a second of switching. The colors below keep their own values either way, ' +
        'and links always take the theme\'s link color.' },
    { key: 'a9cBusyCursor', label: 'Busy Cursor', dflt: BUSY_DEFAULT, demo: drawBusyDemo,
      choices: BUSY_CURSORS.map(function (c) { return [c[0], c[1], function () { return busyMark(c); }]; }),
      tip: 'What turns while a ᝯㄝₓ dialog works - under a run\'s log, and beside Undo History\'s progress - ' +
        'drawn in the Highlighted Text Color. Blocks ▙▛▜▟ by default.\n\nEvery style turns clockwise, and ' +
        'backwards in Undo History, that being the dialog that undoes; one that stands still means the ' +
        'page has stopped. A change shows from the next run.' },
    { key: 'a9HighlightColour', label: 'Highlighted Text Color', color: true, dflt: HIGHLIGHT_DEFAULT,
      tip: 'The color of the ⓕ, 🖬 and ⸎ marks, of the text a ᝯㄝₓ plugin highlights - a switch that ' +
        'writes without a review or risks losing history, a match in another case, a Rescan that another ' +
        'tab made stale, the ↶ in the top bar - of the busy cursor and of warnings. Default #ffc107, a yellow.\n\nPick it in ' +
        'the box, or press Default to go back. Every color here applies on every page as soon as it is ' +
        'saved, and on a page opened later once the ᝯㄝₓ settings are read.',
      demo: [
        [{ hl: 'ⓕ', cls: 'gttx-glyph' }, ' 4\u2003', { hl: '🖬', cls: 'gttx-glyph' }, ' 2\u2003', { hl: '⸎', cls: 'gttx-glyph' }, ' 3'],
        [{ hl: 'Duration off by at least 3s', cls: 'gttx-durwarn gttx-durwarn-orange' }],
        ['On: ', { hl: 'Auto-Merge on Performer Save' }],
        ['"beach" also found ', { hl: 'BEACH' }, ' and ', { hl: 'Beach' }],
        [{ hl: 'Rescan', cls: 'btn btn-secondary btn-sm gttxcore-demorescan' }, { dim: '  another tab renamed 12 tags' }],
        [{ hl: 'Over 5000 tags: the scan may take a while' }],
      ] },
    { key: 'd1GoodColor', label: 'Good Result Text Color', color: true, dflt: '#84d68a',
      tip: 'The color of a good result: Scene Variants\' lowest drift-score, and the added lines in Undo ' +
        'History and in Normalize Parent Tags\' log. Default #84d68a, a green.',
      demo: [
        ['⸎ Summer Pool Party ', { dim: '· 4 files' }, ' ', { hl: '1', cls: 'gttxcore-demobold' }],
        ['tags: ', { hl: '+', cls: 'gttxcore-hplus' }, 'Sunset, ', { hl: '+', cls: 'gttxcore-hplus' }, 'Golden Hour'],
        [{ hl: 'ADD  Scene Picnic at Dawn - Tag Meadow' }],
        [{ hl: 'ADD  Image IMG_0042 - Tag Suspiciously Fluffy' }],
      ] },
    { key: 'd2AverageColor', label: 'Average Result Text Color', color: true, dflt: '#ffb648',
      tip: 'The color of an average result: Scene Variants\' medium drift-score. Default #ffb648, an orange.',
      demo: [
        ['⸎ Lighthouse Keeper ', { dim: '· 3 files' }, ' ', { hl: '46', cls: 'gttxcore-demobold' }],
        ['⸎ Rooftop Tango (Take 2) ', { dim: '· 2 files' }, ' ', { hl: '38', cls: 'gttxcore-demobold' }],
      ] },
    { key: 'd3BadColor', label: 'Bad Result Text Color', color: true, dflt: '#ff7b72',
      tip: 'The color of a bad result: Scene Variants\' high drift-score, and the Scene Tagger\'s duration ' +
        'mismatch past five seconds when Emphasize a Tagger Duration Mismatch is on. Default #ff7b72, a red.',
      demo: [
        [{ hl: 'Duration off by at least 42s', cls: 'gttx-durwarn gttx-durwarn-red' }],
        ['⸎ The Long Goodbye ', { dim: '· 5 files' }, ' ', { hl: '187', cls: 'gttxcore-demobold' }],
      ] },
    { key: 'd6AccentColor', label: 'Accent Color', color: true, dflt: '#7cc4ff',
      tip: 'The color of what a ᝯㄝₓ plugin sets apart without judging it: Normalize Parent Tags\' ' +
        'removed lines, Propagate Tags and Performers\' performer lines and paths, what Scene Variants ' +
        'marks as differing, the show-more under a description, and the bundle Tag Bundle Clipboard has ' +
        'active. Default #7cc4ff, a light blue.\n\nLinks are not among them: they take the link color ' +
        'of Stash or of its theme.',
      demo: [
        [{ hl: 'REMOVE  Scene Rainy Tuesday - Tag Sunshine' }],
        [{ hl: 'PERF  Gallery Harbour Lights - Captain Obvious' }],
        ['Differs: ', { hl: 'date, studio, rating' }],
        [{ dim: 'Keeps a tag bundle a click away… ' }, { hl: 'Show more', cls: 'gttxcore-demotoggle' }],
      ] },
    { key: 'd4ErrorBgColor', label: 'Error Message Background Color', color: true, dflt: '#7a3b3b',
      tip: 'The background a Custom Fields Bulk Editor value flashes when copying it to the clipboard ' +
        'failed. Default #7a3b3b, a dark red.', bg: true,
      demo: [
        ['Mood: ', { hl: 'Suspiciously Calm', cls: 'gttxcore-demopill' }, { dim: '  copy failed' }],
        ['Catchphrase: ', { hl: 'We\'ll fix it in post', cls: 'gttxcore-demopill' }, { dim: '  copy failed' }],
      ] },
    { key: 'd5MatchBgColor', label: 'Match Background Color', color: true, dflt: '#3f6b46',
      tip: 'The background behind the text a search found, in Entity Name Maintainer\'s and Find & Replace ' +
        'Entities by Text Content\'s listings, and behind a Custom Fields Bulk Editor value copied to the ' +
        'clipboard. Default #3f6b46, a dark green.', bg: true,
      demo: [
        ['Scene: Moonlit ', { hl: 'Beach' }, ' Bonfire'],
        ['Details: …a picnic on the ', { hl: 'beach' }, ', then rain…'],
        ['Mood: ', { hl: 'Suspiciously Calm', cls: 'gttxcore-demopill' }, { dim: '  copied' }],
      ] },
  ];

  function globalsSummary(s) {
    var on = GLOBAL_FIELDS.filter(function (f) { return !f.color && !f.number && !f.choices && truthy(s[f.key]); })
      .map(function (f) { return f.label; });
    var busy = busyStyle(s.a9cBusyCursor);
    var out = [(on.length ? 'On: ' + on.join(', ') : 'Every switch: Off') + '. Lines drawn at once "' + linesDrawn(s) +
      '". Busy cursor "' + busy[1] + '"', busy[2] ? ' ' : '', busy[2] ? { text: busy[2], hl: true } : '', '. Colors: '];
    COLORS.forEach(function (c, i) { out.push(i ? ', ' : '', { swatch: colorOf(s[c.key], c.dflt) }); });
    return out.concat('.');
  }

  var GLOBALS_DIALOG = { title: 'UI Customizations', fields: GLOBAL_FIELDS, open: null, plainNames: true, resetAll: true,
    ready: 'Settings that reach every ᝯㄝₓ plugin, or a page none of them owns. Hover a line for all it does.',
    saveTip: 'Store these settings. They apply from the next thing drawn; the colors at once.' };
  function openGlobals() { openFieldsDialog(GLOBALS_DIALOG); }

  var GLOBALS_ROW = { key: 'globals', heading: 'UI Customizations', summary: globalsSummary,
    line: 'The tagger emphasis, right-click Paste, where links open, counts on headings, folding the plugins\' ' +
      'settings, the ⓕ and 🖬 counters on cards, how many lines a dialog draws, the busy cursor, whether the dialogs ' +
      'follow the Stash theme, and the text and background colors every ᝯㄝₓ plugin draws in. Seventeen settings, in a dialog.',
    button: 'UI Customizations...', open: openGlobals,
    title: 'Open the settings every ᝯㄝₓ plugin shares. Nothing is written until you press Save there.' };
  // Drawn after Undo History's row, so it lands above it.
  function globalsRowTick(group) { dialogRowTick(group, GLOBALS_ROW); }

  function button(label, className) {
    var b = el('button', 'btn btn-secondary btn-sm ' + (className || ''), label);
    b.type = 'button';
    return b;
  }

  // The button of a row on Settings → Plugins, drawn as Stash draws its own Edit there: a
  // bare react-bootstrap `<Button>`, so `btn-primary` at the normal size.
  // `owner`, the plugin's id: what layout edit mode labels the button with (`_coopOwner`).
  function settingButton(label, className, owner) {
    var b = el('button', 'btn btn-primary ' + (className || ''), label);
    if (owner) b._coopOwner = owner;
    b.type = 'button';
    return b;
  }

  // A summary line of a row of Stash's own that a plugin took over, placed after the
  // description, where every row says what its settings are. Stash draws its `.value` - the
  // raw string, hidden by the caller - above the description. The row itself where there is
  // neither, never `row.childNodes[0]`: on the second tick that is the line itself.
  function afterDescription(row, line) {
    var sub = byClass(row, 'sub-heading'), slot = byClass(row, 'value');
    var after = sub || (slot !== line ? slot : null);
    var host = after ? after.parentNode : row;
    if (line.parentNode !== host || (after && line.previousSibling !== after)) {
      if (after) host.insertBefore(line, after.nextSibling);
      else host.appendChild(line);
    }
  }

  // Core's own dialogs close on Escape through Close alone - Cancel on them is not a way out.
  function closeOnly(run) {
    var b = run.closeBtn;
    return b && !b.disabled ? b : null;
  }


  // ── Undo History: export and import ───────────────────────────────────────
  //
  // One file, a line of JSON each: a header, then every run, then every entry. Lines
  // rather than one document so a file of hundreds of megabytes is written in pieces and
  // read a line at a time, and so two files can simply be merged. Import puts every line
  // back by its id - an entry already here is the same entry - and marks the runs it
  // brings as imported, which keeps them past the age limit.
  //
  // ponytail: one file for the whole history, saved through the browser's download. One
  // file per month with an index, and loading a month back on demand, come later; so does
  // a folder of its own where the browser offers one (Chrome, Edge).
  function journalExport() {
    var at = Date.now();
    return journalDb().then(function (db) {
      var tx = db.transaction(['runs', 'entries']);
      return Promise.all([idbRequest(tx.objectStore('runs').getAll()),
        idbRequest(tx.objectStore('entries').getAll())]);
    }).then(function (both) {
      var parts = [JSON.stringify({ kind: 'gttx-undo-history', version: 1, exported: Date.now(),
        runs: both[0].length, entries: both[1].length }) + '\n'];
      both[0].sort(journalOrder).forEach(function (r) { parts.push(JSON.stringify({ kind: 'run', run: r }) + '\n'); });
      both[1].forEach(function (e) { parts.push(JSON.stringify({ kind: 'entry', entry: e }) + '\n'); });
      var name = 'gttx-undo-history-' + historyWhen(Date.now()).replace(' ', '-').replace(':', '') + '.ndjson';
      var blob = new window.Blob(parts, { type: 'application/x-ndjson' });
      var a = document.createElement('a');
      a.href = window.URL.createObjectURL(blob);
      a.download = name;
      a.rel = 'noopener';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        try { window.URL.revokeObjectURL(a.href); } catch (e) { /* the page lets it go */ }
      }, 0);
      stampSaw(JOURNAL_EXPORT_KEY, at);
      return { runs: both[0].length, entries: both[1].length, name: name };
    });
  }

  // `texts` are the files' contents. Resolves to { runs, entries, skipped } - skipped
  // being lines that were not ours, or not JSON.
  function journalImport(texts) {
    var runs = [], entries = [], skipped = 0;
    texts.forEach(function (text) {
      String(text || '').split('\n').forEach(function (line) {
        if (!/\S/.test(line)) return;
        var o;
        try { o = JSON.parse(line); } catch (e) { skipped++; return; }
        if (o && o.kind === 'run' && o.run && o.run.id) { o.run.imported = true; runs.push(o.run); }
        else if (o && o.kind === 'entry' && o.entry && o.entry.id && o.entry.run) entries.push(o.entry);
        else if (!(o && o.kind === 'gttx-undo-history')) skipped++;
      });
    });
    if (!runs.length && !entries.length) return Promise.resolve({ runs: 0, entries: 0, skipped: skipped });
    // Only what the history does not hold already: a run or entry here keeps its own state - an
    // undo since the export, the trims it is subject to - rather than the file's older copy.
    var added = { runs: 0, entries: 0 };
    return journalDb().then(function (db) {
      var tx = db.transaction(['runs', 'entries'], 'readwrite');
      var rs = tx.objectStore('runs'), es = tx.objectStore('entries');
      var addNew = function (store, o, k) {
        var g = store.get(o.id);
        g.onsuccess = function () { if (!g.result) { store.put(o); added[k]++; } };
      };
      runs.forEach(function (r) { addNew(rs, r, 'runs'); });
      entries.forEach(function (e) { addNew(es, e, 'entries'); });
      return idbDone(tx);
    }).then(function () {
      journalChanged();
      return { runs: added.runs, entries: added.entries, skipped: skipped };
    });
  }

  function journalDropBefore(at) {
    return journalDb().then(function (db) {
      return journalRunsOf(db).then(function (runs) {
        var ids = runs.filter(function (r) { return r.at < at; }).map(function (r) { return r.id; });
        return ids.length ? journalDropRuns(db, ids) : 0;
      });
    });
  }

  // Stash's own backup, taken on the server where Settings - Tasks takes it.
  // Resolves to the folder the backup went to, or '' when it cannot be told: Stash answers
  // the mutation with nothing, and writes to the backup folder set in Settings - System, or
  // beside the database when none is.
  function journalBackup() {
    return gqlRequest('mutation GTTxBackup { backupDatabase(input: { download: false }) }', null)
      .then(function () {
        return gqlRequest('query GTTxBackupWhere { configuration { general { databasePath backupDirectoryPath } } }', null)
          .then(function (d) {
            var g = (d.configuration || {}).general || {};
            if (g.backupDirectoryPath) return g.backupDirectoryPath;
            var db = String(g.databasePath || '');
            return db.slice(0, Math.max(db.lastIndexOf('/'), db.lastIndexOf('\\')));
          }, function () { return ''; });
      });
  }

  // ── Undo History: the dialog ──────────────────────────────────────────────
  //
  // The history, newest first, a run a line: when, who - you, a plugin, or an undo - what,
  // and how many changes; a run opens to its changes. Tick runs or changes and Undo
  // Selected... works out what can still be undone and lists it before anything is
  // written, the review every writing dialog here shows; Proceed writes it.
  //
  // It draws a page of runs at a time. With a filter on type or text it reads the runs'
  // entries newest first until a page matches, so a search over a large history costs
  // what it finds, not what is kept.
  var HISTORY_TASK = 'Undo History...';
  var HISTORY_PAGE = 100;
  var _history = null;

  function historyWho(r) {
    return r.source === 'hand' ? 'Your edit' : r.source === 'undo' ? 'Undo' : (r.plugin || 'A plugin');
  }

  function historyWhen(at) {
    var d = new Date(at), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function historyValue(v, absent) {
    if (absent) return '(none)';
    if (v === null || v === undefined || v === '') return '(empty)';
    if (Object.prototype.toString.call(v) === '[object Array]') {
      return v.length ? v.map(function (x) { return typeof x === 'object' ? JSON.stringify(x) : String(x); }).join(', ') : '(none)';
    }
    var t = typeof v === 'object' ? JSON.stringify(v) : typeof v === 'string' ? '"' + v + '"' : String(v);
    return t.length > 80 ? t.slice(0, 79) + '…' : t;
  }

  function historyChange(e) {
    if (e.action === 'create') return 'created';
    if (e.action === 'delete') return 'deleted' + (e.lost ? ' (' + LOST_REASON[e.lost] + ')' : '');
    if (e.action === 'gap') return 'not recorded';
    if (hasOwn(JOURNAL_RELATIONS, e.field)) {
      var d = journalDelta(e);
      return e.field + ': ' + [].concat(d.added.map(function (x) { return '+' + x; }),
        d.removed.map(function (x) { return '\u2212' + x; })).join(', ');
    }
    return (e.field || '').replace(/^custom_fields\./, 'custom field ').replace(/^files\.(.*)$/, 'file $1 name') + ': ' +
      historyValue(e.before, e.beforeAbsent) + ' → ' + historyValue(e.after, e.afterAbsent);
  }

  // The entity as a link to its page, with the hover card every listing here draws.
  function historyEntity(e) {
    var t = JOURNAL_TYPES[e.type] || { label: e.type };
    if (t.settings) {
      var set = el('a', 'gttxcore-elink', t.label + ' "' + e.eid + '"');
      set.href = '/settings?tab=plugins';
      set.target = linkTarget();
      set.rel = 'noopener noreferrer';
      return set;
    }
    var a = el('a', 'gttxcore-elink', t.label + ' "' + (e.name || 'untitled') + '" [' + e.eid + ']');
    if (e.eid !== '?') {
      a.href = '/' + e.type + '/' + e.eid;
      a.target = linkTarget();
      a.rel = 'noopener noreferrer';
      entityTip(a, e.type, e.eid);
    }
    return a;
  }

  // ── Related entities by name ──────────────────────────────────────────────
  //
  // A relation is stored by id - the input's own shape - so a line reads "Blonde (105)"
  // only once the name is read: fifty to a request, cached for the page, the link drawn
  // at once with its id and named when the answer lands. Each is a link with the hover
  // card every listing here draws.
  // The relations a merge remaps, and a scene's groups.
  var HISTORY_REL_TYPES = { groups: 'groups' };
  (function () { for (var k in REMAP_REL) if (hasOwn(REMAP_REL, k)) HISTORY_REL_TYPES[k] = REMAP_REL[k]; }());
  var _histNames = {};

  // A request that fails names nothing - the link keeps its id - and is not cached, so the next
  // draw or Find asks again.
  function historyNames(type, ids) {
    var cache = _histNames[type] = _histNames[type] || {}, seen = {};
    var want = ids.filter(function (id) {
      if (hasOwn(cache, id) || hasOwn(seen, id)) return false;
      return (seen[id] = true);
    });
    var t = JOURNAL_TYPES[type];
    for (var i = 0; t && i < want.length; i += 50) {
      (function (chunk) {
        var parts = chunk.map(function (id, k) {
          return 'n' + k + ': ' + t.one + '(id: ' + JSON.stringify(String(id)) + ') { ' + t.name + ' }';
        });
        var asked = gqlRequest('query GTTxHistoryNames { ' + parts.join(' ') + ' }', null).then(function (d) {
          var out = {};
          chunk.forEach(function (id, k) {
            var o = d && d['n' + k];
            out[id] = o ? (o[t.name] || 'untitled') : null;
          });
          return out;
        }, function () {
          chunk.forEach(function (id) { delete cache[id]; });
          return {};
        });
        chunk.forEach(function (id) {
          cache[id] = asked.then(function (out) { return out[id]; });
        });
      })(want.slice(i, i + 50));
    }
    return cache;
  }

  function historyRelLink(type, id, names) {
    var a = el('a', 'gttxcore-elink', '(' + id + ')');
    a.href = '/' + type + '/' + id;
    a.target = linkTarget();
    a.rel = 'noopener noreferrer';
    entityTip(a, type, id);
    if (names[id]) {
      names[id].then(function (name) {
        if (name === undefined) return;   // not read: the id alone
        a.textContent = name === null ? '(' + id + ', deleted)' : name + ' (' + id + ')';
      });
    }
    return a;
  }

  // A custom field's name, blue, carrying the box every custom field named here opens:
  // its description where Custom Fields Bulk Editor keeps one, and what carries it.
  function historyCfName(field) {
    var node = el('span', 'gttx-cftipped');
    var name = el('span', 'gttxcore-hcfname', field);
    name.tabIndex = 0;
    node.appendChild(name);
    node._gttxCfMark = name;
    node._gttxCfBox = el('span', 'gttx-cftipbox', 'Custom field "' + field + '"');
    node.appendChild(node._gttxCfBox);
    node._gttxCfField = field;
    cfTipArm(node, null);
    return node;
  }

  // The change an undo makes: the recorded one turned round, so the review and its result
  // say what is about to happen - `−Blonde` for a tag the change added - while the history
  // itself says what happened.
  function historyInverse(e) {
    var r = {}, k;
    for (k in e) if (hasOwn(e, k)) r[k] = e[k];
    r.before = e.after; r.after = e.before;
    r.beforeAbsent = e.afterAbsent; r.afterAbsent = e.beforeAbsent;
    if (e.action === 'create') r.action = 'delete';
    else if (e.action === 'delete') r.action = 'create';
    else if (e.action === 'merge') r.action = 'split';
    return r;
  }

  // What a change says, drawn: related entities as named links, the rest as text.
  function historyChangeNode(e) {
    var span = el('span', null, '');
    if (/^settings\./.test(e.field || '')) {
      span.textContent = 'setting ' + e.field.slice(9) + ': ' + historyValue(e.before, e.beforeAbsent) + ' \u2192 ' +
        historyValue(e.after, e.afterAbsent);
      return span;
    }
    if (/^custom_fields\./.test(e.field || '') && e.action !== 'gap') {
      span.appendChild(el('span', null, 'custom field '));
      span.appendChild(historyCfName(e.field.slice(14)));
      span.appendChild(el('span', null, ': ' + historyValue(e.before, e.beforeAbsent) + ' → ' +
        historyValue(e.after, e.afterAbsent)));
      return span;
    }
    // The destination drawn like the entity itself: named, with its id, a link and its card.
    if (e.action === 'merge' || e.action === 'split') {
      span.appendChild(el('span', null, e.action === 'merge' ? 'merged into ' : 'split back out of '));
      span.appendChild(historyEntity({ type: e.type, name: e.merge && e.merge.name, eid: (e.merge && e.merge.into) || '?' }));
      if (e.action === 'merge' && e.lost) span.appendChild(el('span', null, ' (' + LOST_REASON[e.lost] + ')'));
      return span;
    }
    var type = historyRelType(e);
    if (!type) { span.textContent = historyChange(e); return span; }
    var before = historyRelIds(e.before), after = historyRelIds(e.after);
    var names = historyNames(type, before.concat(after));
    var text = function (t) { span.appendChild(el('span', null, t)); };
    text(e.field + ': ');
    if (hasOwn(JOURNAL_RELATIONS, e.field) || e.field === 'groups') {
      var added = after.filter(function (x) { return before.indexOf(x) === -1; });
      var removed = before.filter(function (x) { return after.indexOf(x) === -1; });
      var first = true;
      var item = function (id, sign, cls) {
        if (!first) text(', ');
        first = false;
        span.appendChild(el('span', cls, sign));
        span.appendChild(historyRelLink(type, id, names));
      };
      added.forEach(function (id) { item(id, '+', 'gttxcore-hplus'); });
      removed.forEach(function (id) { item(id, '\u2212', 'gttxcore-hminus'); });
      if (first) text(e.field === 'groups' ? 'scene numbers only' : '(no change)');
      return span;
    }
    if (before.length) span.appendChild(historyRelLink(type, before[0], names)); else text('(none)');
    text(' → ');
    if (after.length) span.appendChild(historyRelLink(type, after[0], names)); else text('(none)');
    return span;
  }

  // A change to a relation names other entities by id; the line draws their names.
  function historyRelType(e) {
    return hasOwn(HISTORY_REL_TYPES, e.field) && e.action !== 'create' && e.action !== 'delete' &&
      e.action !== 'gap' ? HISTORY_REL_TYPES[e.field] : null;
  }
  function historyRelIds(v) {
    var idOf = function (x) { return x && typeof x === 'object' ? String(x.group_id) : String(x); };
    return v == null ? [] : Object.prototype.toString.call(v) === '[object Array]' ? v.map(idOf) : [idOf(v)];
  }

  // The entries a Find keeps, in order: its text in the entity's own name, the field or a value
  // (`historyMatches`) - and, for a change to a relation, in the names of the entities it adds or
  // removes, read as the lines draw them, so a performer's name finds the scenes she was added to
  // and not only the lines about her. The ids are gathered across the entries first, one
  // `historyNames` call a type, so a run's new ids go fifty to a query.
  // ponytail: a Find over a long history asks the names of every relation it reaches that matched
  // nothing else; a server-side name index if that is ever slow.
  function historyFilter(H, es) {
    var keep = es.map(function (e) { return historyMatches(H, e); });
    var kept = function () { return es.filter(function (e, i) { return keep[i]; }); };
    if (!H.find) return Promise.resolve(kept());
    var rel = [], ids = {}, hit = {};
    es.forEach(function (e, i) {
      var t = !keep[i] && (!H.type || e.type === H.type) && historyRelType(e);
      if (!t) return;
      var list = historyRelIds(e.before).concat(historyRelIds(e.after)), seen = ids[t] = ids[t] || {};
      rel.push({ i: i, t: t, ids: list });
      for (var k = 0; k < list.length; k++) seen[list[k]] = true;
    });
    if (!rel.length) return Promise.resolve(kept());
    return Promise.all(Object.keys(ids).map(function (t) {
      var want = Object.keys(ids[t]), names = historyNames(t, want), of = hit[t] = {};
      return Promise.all(want.map(function (id) { return names[id]; })).then(function (ns) {
        want.forEach(function (id, k) { of[id] = ns[k] != null && String(ns[k]).toLowerCase().indexOf(H.find) !== -1; });
      });
    })).then(function () {
      rel.forEach(function (r) { if (r.ids.some(function (id) { return hit[r.t][id]; })) keep[r.i] = true; });
      return kept();
    });
  }

  function historyMatches(H, e) {
    if (H.type && e.type !== H.type) return false;
    if (!H.find) return true;
    return [e.name, e.field, JSON.stringify(e.before), JSON.stringify(e.after)].join('\n')
      .toLowerCase().indexOf(H.find) !== -1;
  }

  function openHistory() {
    if (_history) { if (_history.modal.scrollIntoView) _history.modal.scrollIntoView(); return; }
    injectStyle();
    var H = { selRuns: {}, selEntries: {}, shownRuns: [], open: {}, entries: {}, byId: {}, shown: HISTORY_PAGE,
      mode: 'list', plan: null, find: '', type: '', source: '', from: 0, to: 0, drawing: 0 };
    var backdrop = el('div', 'gttxcore-backdrop');
    var modal = el('div', 'gttxcore-modal gttxcore-history');
    backdrop.appendChild(modal);
    H.backdrop = backdrop;
    H.modal = modal;

    var head = el('div', 'gttxcore-head');
    head.appendChild(el('div', 'gttxcore-title', PLUGIN_SHORT_NAME + ' - Undo History'));
    head.appendChild(el('div', 'gttxcore-warn',
      'Backing up your database before proceeding is strongly recommended. An undo writes to your ' +
      'library like any other edit, and is recorded here so it can be undone in turn.'));
    H.noteEl = el('div', 'gttxcore-note', 'Reading the history…');
    head.appendChild(H.noteEl);
    H.alertEl = el('div', 'gttxcore-warn gttxcore-hidden', '');
    head.appendChild(H.alertEl);
    head.appendChild(el('div', 'gttxcore-legend',
      'What ᝯㄝₓ plugins wrote, and the edits you saved in Stash’s own pages in this ' +
      'browser, newest first. Tick a run or a change and press Undo Selected... to see what ' +
      'can still be undone before anything is written: a change is undone only while the ' +
      'field still holds what was written, so a later edit is never overwritten. Not recorded: ' +
      'edits made in another browser or on another device, Stash’s own tasks (Scan, ' +
      'Identify, Auto Tag, Clean) and scripts. A deleted tag, performer, studio, group or scene ' +
      'comes back under a new id; a deleted image or gallery comes back by rescanning. ' +
      'Tags, performers and other related entities are shown by name and id, each with its hover card.'));
    modal.appendChild(head);

    var bar = el('div', 'gttxcore-hfilter');
    var find = el('input', 'gttxcore-hfind');
    find.type = 'search';
    find.placeholder = 'Find a name, a field or a value';
    find.title = 'Show only the runs with a change whose entity name, field or value holds this text - ' +
      'or the name of a tag, performer or other entity the change added or removed.';
    var typeSel = el('select', 'gttxcore-hselect');
    [['', 'Every type']].concat(Object.keys(JOURNAL_TYPES).map(function (k) {
      return [k, JOURNAL_TYPES[k].labels];
    })).forEach(function (o) {
      var opt = el('option', null, o[1]);
      opt.value = o[0];
      typeSel.appendChild(opt);
    });
    typeSel.title = 'Show only the runs that changed this kind of entity.';
    var sourceSel = el('select', 'gttxcore-hselect');
    sourceSel.title = 'Show only your own edits in Stash’s pages, only what the plugins wrote, or only undos.';
    [['', 'Everything'], ['hand', 'Your edits'], ['plugin', 'Plugin writes'], ['undo', 'Undos']].forEach(function (o) {
      var opt = el('option', null, o[1]);
      opt.value = o[0];
      sourceSel.appendChild(opt);
    });
    var from = el('input', 'gttxcore-hdate');
    from.type = 'date';
    from.title = 'Show only the runs from this day on.';
    var to = el('input', 'gttxcore-hdate');
    to.type = 'date';
    to.title = 'Show only the runs up to and including this day.';
    [find, typeSel, sourceSel, from, to].forEach(function (n) { bar.appendChild(n); });
    modal.appendChild(bar);
    function refilter() {
      H.find = String(find.value || '').toLowerCase();
      H.type = typeSel.value || '';
      H.source = sourceSel.value || '';
      H.from = from.value ? new Date(from.value + 'T00:00:00').getTime() : 0;
      H.to = to.value ? new Date(to.value + 'T00:00:00').getTime() + DAY_MS : 0;
      H.shown = HISTORY_PAGE;
      if (H.mode === 'list') historyDraw(H);
    }
    find.addEventListener('input', refilter);
    [typeSel, sourceSel, from, to].forEach(function (n) { n.addEventListener('change', refilter); });

    H.progressEl = el('div', 'gttxcore-progress', '');
    modal.appendChild(H.progressEl);
    H.listEl = el('div', 'gttxcore-log gttxcore-hlist');
    modal.appendChild(H.listEl);

    var foot = el('div', 'gttxcore-foot');
    var orange = function (b) { b.className = b.className.replace('btn-secondary', 'btn-warning'); return b; };
    H.undoBtn = orange(button('Undo Selected...', 'gttxcore-hundo'));
    H.deleteBtn = button('Delete Selected...', 'gttxcore-hdelete');
    H.unselAllBtn = button('Unselect All', 'gttxcore-hunselall');
    H.selAllBtn = button('Select All', 'gttxcore-hselall');
    H.popLabel = el('label', 'gttxcore-hpop gttxcore-hidden');
    H.popBox = el('input', 'gttxcore-hbox gttxcore-hpopbox');
    H.popBox.type = 'checkbox';
    H.popLabel.appendChild(H.popBox);
    H.popLabel.appendChild(el('span', null, ' Take it out of the history'));
    H.popLabel.title = 'Ticked, what is undone leaves the history instead of an undo joining it - the ' +
      'history goes back to where it was, as a stack does. It cannot then be redone from here. ' +
      'Unticked, the undo is recorded and can be undone in turn. It starts as the Undo Takes It ' +
      'Out of the History setting says, and this box decides for this undo.';
    H.popBox.addEventListener('change', function () { historyFoot(H); });
    H.proceedBtn = orange(button('Proceed', 'gttxcore-hproceed gttxcore-hidden'));
    H.backBtn = button('Back', 'gttxcore-hback gttxcore-hidden');
    H.exportBtn = button('Export', 'gttxcore-hexport');
    H.importBtn = button('Import...', 'gttxcore-himport');
    H.backupBtn = button('Back Up and Export', 'gttxcore-hbackup');
    H.dropBtn = button('Drop What the Backup Holds...', 'gttxcore-hdrop gttxcore-hidden');
    H.clearBtn = button('Clear History...', 'gttxcore-hclear');
    H.closeBtn = button('Close', 'gttxcore-close');
    H.undoBtn.title = 'Work out what the ticked runs and changes can still undo, and list it. ' +
      'Nothing is written until Proceed.';
    H.deleteBtn.title = 'Delete the ticked runs and changes from this browser’s history - test runs, ' +
      'say. Nothing in your library changes, and what is deleted can no longer be undone from here. ' +
      'Asks for a second press.';
    H.exportBtn.title = 'Save the whole history to a file, which Import... can bring back here or ' +
      'into another browser.';
    H.importBtn.title = 'Bring back histories saved with Export. Changes already here are not doubled.';
    H.backupBtn.title = 'Take a backup of the Stash database, as Settings - Tasks does, and save ' +
      'the history to a file with it.';
    H.clearBtn.title = 'Delete the whole history from this browser. Nothing in your library changes. ' +
      'Asks for a second press - or, where runs were recorded since the last export, warns first ' +
      'and offers to export them.';
    H.dropBtn.title = 'Delete from this browser’s history every run recorded before the backup just ' +
      'taken: the backup holds your library as it was, and the file just saved holds those runs. ' +
      'Nothing in your library changes. Asks for a second press.';
    H.unselAllBtn.title = 'Untick every run and change, including any the filter hides.';
    H.selAllBtn.title = 'Tick every run the list shows.';
    H.proceedBtn.title = 'Undo the changes listed above. The undo is recorded, so it can be undone in turn.';
    H.backBtn.title = 'Back to the history, with nothing written.';
    H.closeBtn.title = 'Close Undo History.';
    // The selection pair at the right end, where every sibling's dialog has it.
    [H.undoBtn, H.deleteBtn, H.popLabel, H.proceedBtn, H.backBtn, H.exportBtn, H.importBtn, H.backupBtn, H.dropBtn,
      H.clearBtn, H.closeBtn, H.unselAllBtn, H.selAllBtn].forEach(function (b) { foot.appendChild(b); });
    modal.appendChild(foot);

    H.undoBtn.addEventListener('click', function () { historyReview(H); });
    H.proceedBtn.addEventListener('click', function () { historyProceed(H); });
    H.backBtn.addEventListener('click', function () {
      H.mode = 'list'; H.plan = null; H.done = false; historyDraw(H); historyFoot(H);
    });
    H.exportBtn.addEventListener('click', function () {
      historyBusy(H, true);
      historyWorking(H, 'Saving the history…');
      journalExport().then(function (r) {
        H.progressEl.textContent = 'Saved ' + plural(r.entries, 'change') + ' in ' + plural(r.runs, 'run') +
          ' to ' + r.name + '.';
      }, function (e) { H.progressEl.textContent = 'The export failed: ' + (e && e.message ? e.message : e); })
        .then(function () { historyBusy(H, false); });
    });
    H.importBtn.addEventListener('click', function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.ndjson,.jsonl,.json,.txt';
      input.addEventListener('change', function () {
        var files = [];
        for (var i = 0; i < (input.files || []).length; i++) files.push(input.files[i]);
        if (!files.length) return;
        historyBusy(H, true);
        historyWorking(H, 'Reading ' + plural(files.length, 'file') + '…');
        Promise.all(files.map(function (f) { return f.text(); })).then(journalImport).then(function (r) {
          H.progressEl.textContent = 'Imported ' + plural(r.entries, 'change') + ' in ' + plural(r.runs, 'run') +
            (r.skipped ? '; ' + plural(r.skipped, 'line') + ' that were not an Undo History export were skipped' : '') + '.';
          historyStats(H);
          return historyDraw(H, true);
        }, function (e) { H.progressEl.textContent = 'The import failed: ' + (e && e.message ? e.message : e); })
          .then(function () { historyBusy(H, false); });
      });
      input.click();
    });
    H.backupBtn.addEventListener('click', function () {
      historyBusy(H, true);
      historyWorking(H, 'Backing up the database - this can take a few minutes on a large library…');
      var at = Date.now(), where = '';
      journalBackup().then(function (w) {
        where = w;
        stampSaw(JOURNAL_BACKUP_KEY, at);
        historyWorking(H, 'Saving the history…');
        return journalExport();
      }).then(function (r) {
        H.backupAt = at;
        H.progressEl.textContent = 'Backed up the database' + (where ? ' to ' + where : '') +
          ', and saved ' + plural(r.entries, 'change') + ' to ' + r.name + ' in your downloads. ' +
          'What came before this backup can now be dropped from the history.';
        historyShow(H.dropBtn, true);
      }, function (e) {
        H.progressEl.textContent = 'The backup and export failed: ' + (e && e.message ? e.message : e);
      }).then(function () { historyBusy(H, false); });
    });
    historyConfirm(H.dropBtn, 'Press again to drop it', function () {
      return journalDropBefore(H.backupAt || 0).then(function (n) {
        H.progressEl.textContent = 'Dropped ' + plural(n, 'run') + ' from before the backup.';
        historyShow(H.dropBtn, false);
      });
    }, H);
    historyConfirm(H.deleteBtn, 'Press again to delete', function () {
      var runs = Object.keys(H.selRuns), n = historySelected(H);
      var entries = Object.keys(H.selEntries).map(function (id) { return H.byId[id]; }).filter(Boolean);
      return journalRemove(runs, entries).then(function () {
        H.selRuns = {};
        H.selEntries = {};
        H.entries = {};
        H.progressEl.textContent = 'Deleted ' + plural(n, 'ticked run or change', 'ticked runs and changes') +
          ' from the history. Nothing in your library changed.';
      });
    }, H);
    historyConfirm(H.clearBtn, 'Press again to clear', function () {
      return journalClear().then(function () { H.progressEl.textContent = 'The history is cleared.'; });
    }, H, historyClearGate(H));
    H.closeBtn.addEventListener('click', function () { historyClose(H); });
    // Unselect All clears what the filter hides too: a tick nobody can see would still
    // be undone or deleted.
    H.unselAllBtn.addEventListener('click', function () {
      H.selRuns = {};
      H.selEntries = {};
      historyDraw(H, true);
    });
    H.selAllBtn.addEventListener('click', function () {
      // A run ticked whole: its changes ticked singly go, or the count says them twice.
      H.shownRuns.forEach(function (id) {
        H.selRuns[id] = true;
        Object.keys(H.selEntries).forEach(function (k) { if (k.indexOf(id + ':') === 0) delete H.selEntries[k]; });
      });
      historyDraw(H, true);
    });

    // Another tab recording something redraws the list here, when it is showing.
    try {
      if (typeof window.BroadcastChannel === 'function') {
        H.channel = new window.BroadcastChannel(JOURNAL_DB);
        H.channel.onmessage = function () {
          // The runs read so far may have changed there; a ticked change stays ticked.
          var keep = {};
          Object.keys(H.selEntries).forEach(function (id) { if (H.byId[id]) keep[id] = H.byId[id]; });
          H.entries = {};
          H.byId = keep;
          historyStats(H);
          if (H.mode === 'list' && !H.busy) historyDraw(H, true);
        };
      }
    } catch (e) { /* redrawn on the next open */ }

    _history = H;
    wireEscape(H, 'gttxcore', closeOnly);
    document.body.appendChild(backdrop);
    historyFoot(H);
    historyStats(H);
    historyDraw(H);
    return H;
  }

  function historyShow(node, on) {
    toggleClass(node, 'gttxcore-hidden', !on);
  }

  // A line with the busy cursor before it, for as long as the work runs; the next line written
  // to the progress replaces it. Undo History's turns backwards, this being the dialog that undoes.
  function historyWorking(H, text) {
    H.progressEl.textContent = '';
    H.progressEl.appendChild(busyCursor('span', 'gttxcore-histbusy', true));
    H.progressEl.appendChild(el('span', null, text));
  }

  function historyBusy(H, on) {
    H.busy = on;
    historyFoot(H);
  }

  // A press that deletes history asks twice: the first press changes the caption, a
  // second within five seconds does it.
  // `gate`, where given, is asked before the first press arms: it resolves true to arm as
  // usual, or false having taken the question over itself - handed `go` to act with.
  function historyConfirm(btn, ask, act, H, gate) {
    var label = btn.textContent, armed = null;
    function go() {
      historyBusy(H, true);
      return act().then(function () { historyStats(H); return historyDraw(H, true); }, function (e) {
        H.progressEl.textContent = 'That failed: ' + (e && e.message ? e.message : e);
      }).then(function () { historyBusy(H, false); });
    }
    function arm() {
      holdWidth(btn);
      btn.textContent = ask;
      armed = setTimeout(function () { armed = null; btn.textContent = label; }, 5000);
    }
    btn.addEventListener('click', function () {
      if (!armed) {
        if (gate) gate(go).then(function (ok) { if (ok) arm(); });
        else arm();
        return;
      }
      clearTimeout(armed);
      armed = null;
      btn.textContent = label;
      go();
    });
  }

  // Clear History with runs recorded since the last export - or never exported - asks in
  // a dialog of its own rather than by a second press: those runs are in no file, and
  // clearing them is the one step here that nothing can take back. Imported runs came from
  // a file, so they do not count.
  function historyClearGate(H) {
    return function (go) {
      return journalRuns().then(function (runs) {
        var since = stampAt(JOURNAL_EXPORT_KEY);
        var fresh = runs.filter(function (r) { return !r.imported && (r.at || 0) > since; });
        if (!fresh.length) return true;
        historyClearAsk(H, fresh, since, go);
        return false;
      }, function () { return true; });
    };
  }

  function historyClearAsk(H, fresh, since, go) {
    var changes = 0;
    fresh.forEach(function (r) { changes += r.count || 0; });
    var what = plural(fresh.length, 'run') + ' holding ' + plural(changes, 'change');
    var backdrop = el('div', 'gttxcore-backdrop');
    var modal = el('div', 'gttxcore-modal gttxcore-narrow');
    backdrop.appendChild(modal);
    var head = el('div', 'gttxcore-head');
    head.appendChild(el('div', 'gttxcore-title', PLUGIN_SHORT_NAME + ' - Clear History'));
    modal.appendChild(head);
    modal.appendChild(el('div', 'gttxcore-body gttxcore-clearask', (since
      ? what + ' were recorded after the history was last exported, on ' + new Date(since).toLocaleString() + '.'
      : 'The history has never been exported from this browser, and it holds ' + what + '.') +
      ' Clearing deletes them from this browser, and nothing can bring them back: Undo History ' +
      'could no longer undo them. Nothing in your library changes.'));
    var foot = el('div', 'gttxcore-foot');
    var exportBtn = button('Export, Then Clear', 'gttxcore-clearexport');
    exportBtn.className = exportBtn.className.replace('btn-secondary', 'btn-warning');
    var clearBtn = button('Clear Without Exporting', 'gttxcore-clearnow');
    var closeBtn = button('Cancel', 'gttxcore-close');
    exportBtn.title = 'Save the whole history to a file first, as Export does, then clear it. If the ' +
      'export fails, nothing is cleared.';
    clearBtn.title = 'Delete the whole history from this browser now, with no file of it. Nothing ' +
      'in your library changes.';
    closeBtn.title = 'Back to Undo History, with nothing deleted.';
    [exportBtn, clearBtn, closeBtn].forEach(function (b) { foot.appendChild(b); });
    modal.appendChild(foot);
    var run = { modal: modal, backdrop: backdrop, closeBtn: closeBtn };
    function shut() {
      unwireEscape(run);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }
    closeBtn.addEventListener('click', shut);
    clearBtn.addEventListener('click', function () { shut(); go(); });
    exportBtn.addEventListener('click', function () {
      shut();
      historyBusy(H, true);
      historyWorking(H, 'Saving the history…');
      journalExport().then(function (r) {
        H.progressEl.textContent = 'Saved ' + plural(r.entries, 'change') + ' in ' + plural(r.runs, 'run') +
          ' to ' + r.name + '.';
        return go();
      }, function (e) {
        H.progressEl.textContent = 'The export failed, so nothing was cleared: ' + (e && e.message ? e.message : e);
        historyBusy(H, false);
      });
    });
    wireEscape(run, 'gttxcore', closeOnly);
    document.body.appendChild(backdrop);
  }

  function historySelected(H) {
    return Object.keys(H.selRuns).length + Object.keys(H.selEntries).length;
  }

  // The one place that says what can be pressed. Close is green once a review has
  // nothing left to write, or an undo has run clean.
  function historyFoot(H) {
    var list = H.mode === 'list', review = H.mode === 'review', done = H.mode === 'done';
    historyShow(H.undoBtn, list);
    historyShow(H.deleteBtn, list);
    historyShow(H.popLabel, review);
    historyShow(H.proceedBtn, review);
    historyShow(H.backBtn, !list);
    H.undoBtn.disabled = H.deleteBtn.disabled = !!H.busy || !historySelected(H);
    historyShow(H.unselAllBtn, list);
    historyShow(H.selAllBtn, list);
    H.unselAllBtn.disabled = !!H.busy || !historySelected(H);
    H.selAllBtn.disabled = !!H.busy || H.shownRuns.every(function (id) { return H.selRuns[id]; });
    H.popBox.disabled = !!H.busy;
    // A pop has work to do even where nothing is written: what cancels out leaves the history.
    H.proceedBtn.disabled = !!H.busy || !(H.plan && (H.plan.writes.length ||
      (H.popBox.checked && H.plan.cancelled && H.plan.cancelled.length)));
    H.backBtn.disabled = !!H.busy;
    // With nothing recorded there is nothing to save or clear; Import is how one arrives.
    var empty = H.recorded === 0;
    [H.exportBtn, H.importBtn, H.backupBtn, H.dropBtn, H.clearBtn].forEach(function (b) {
      if (!b._tip) b._tip = b.title;
      var none = empty && b !== H.importBtn;
      b.disabled = !!H.busy || !list || none;
      b.title = none ? 'Nothing is recorded yet. ' + b._tip : b._tip;
    });
    H.closeBtn.disabled = !!H.busy && H.mode === 'writing';
    var clean = (review && H.plan && H.proceedBtn.disabled && !H.busy) || (done && !H.failed);
    H.closeBtn.className = H.closeBtn.className.replace(/\bbtn-(secondary|success)\b/, clean ? 'btn-success' : 'btn-secondary');
  }

  function historyStats(H) {
    var limits = journalLimits(), st = window.navigator && window.navigator.storage;
    return Promise.all([
      journalStats(),
      st && typeof st.persisted === 'function' ? st.persisted().then(null, function () { return null; }) : Promise.resolve(null),
      st && typeof st.estimate === 'function' ? st.estimate().then(null, function () { return null; }) : Promise.resolve(null),
    ]).then(function (r) {
      var s = r[0], persisted = r[1], est = r[2], alerts = [];
      H.recorded = s.entries;
      historyFoot(H);
      var mb = function (b) { return (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB'; };
      var days = s.oldest == null ? 0 : Math.floor((Date.now() - s.oldest) / DAY_MS);
      H.noteEl.textContent = plural(s.entries, 'change') + ' in ' + plural(s.runs, 'run') + ', ' +
        mb(s.bytes) + ' of ' + mb(limits.bytes) +
        (s.oldest == null ? '' : ', the oldest ' + plural(days, 'day') + ' old') + '; kept ' +
        (limits.days ? 'for ' + plural(limits.days, 'day') : 'for ever') + '. ' +
        (persisted === true ? 'The browser protects this storage.'
          : persisted === false ? 'The browser has not agreed to protect this storage, so it may clear it when the disk is nearly full.'
            : 'This browser cannot say whether it protects this storage.');
      if (s.bytes >= limits.bytes * 0.8) {
        alerts.push('The history is past 80% of its size limit, so the oldest runs are dropped next. ' +
          'Back Up and Export keeps them in a file first.');
      }
      if (limits.days && s.oldest != null && days >= limits.days - 7) {
        alerts.push('The oldest runs are within a week of the ' + plural(limits.days, 'day') + ' limit. ' +
          'Back Up and Export keeps them in a file first.');
      }
      if (est && est.quota && est.quota - est.usage < est.quota * 0.1) {
        alerts.push('This browser is short of space for Stash’s site, which is when it starts clearing ' +
          'sites’ storage. Back Up and Export keeps the history in a file.');
      }
      H.alertEl.textContent = alerts.join(' ');
      historyShow(H.alertEl, alerts.length > 0);
    }, function (e) {
      H.noteEl.textContent = 'The history cannot be read in this browser: ' + (e && e.message ? e.message : e);
    });
  }

  // The runs that pass the filter, newest first, a page of them.
  function historyDraw(H, keepOpen) {
    var token = ++H.drawing;
    if (!keepOpen) H.open = {};
    return journalRuns().then(function (runs) {
      var cheap = runs.filter(function (r) {
        return (!H.source || r.source === H.source) && (!H.from || r.at >= H.from) && (!H.to || r.at < H.to);
      });
      var deep = !!(H.find || H.type), kept = [], i = 0;
      function more() {
        if (token !== H.drawing) return null;
        while (i < cheap.length && kept.length <= H.shown) {
          var r = cheap[i++];
          if (!deep) { kept.push(r); continue; }
          if (H.find && !H.type && (String(r.label).toLowerCase().indexOf(H.find) !== -1 ||
              String(r.plugin || '').toLowerCase().indexOf(H.find) !== -1)) { kept.push(r); continue; }
          return historyEntriesOf(H, r.id).then(function (es) { return historyFilter(H, es); }).then(function (run) {
            return function (es) {
              if (es.length) kept.push(run);
              return more();
            };
          }(r));
        }
        return null;
      }
      return Promise.resolve(more()).then(function () {
        if (token !== H.drawing) return;
        historyRender(H, kept.slice(0, H.shown), cheap.length, kept.length > H.shown || i < cheap.length);
      });
    }, function (e) {
      H.progressEl.textContent = 'The history cannot be read: ' + (e && e.message ? e.message : e);
    });
  }

  function historyEntriesOf(H, runId) {
    if (hasOwn(H.entries, runId)) return Promise.resolve(H.entries[runId]);
    return journalEntries(runId).then(function (es) {
      H.entries[runId] = es;
      es.forEach(function (e) { H.byId[e.id] = e; });
      return es;
    });
  }

  function historyRender(H, runs, total, more) {
    var list = H.listEl;
    H.shownRuns = runs.map(function (r) { return r.id; });
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!runs.length) list.appendChild(el('div', 'gttxcore-line', total ? 'Nothing matches the filter.' : 'Nothing is recorded yet.'));
    runs.forEach(function (r) {
      var block = el('div', 'gttxcore-hrun');
      var row = el('div', 'gttxcore-hhead');
      // Its own kind for Shift-click ranges: runs with runs, changes with changes.
      // A run and its changes tick like a tree: the run ticks every change, a change taken
      // out of a ticked run leaves the rest ticked, every change ticked is the run ticked,
      // and some of them is a run partly ticked. Changes are keyed `<run>:<n>`, so a closed
      // run knows its own. Updated in place, never redrawn, so a Shift-click range keeps
      // the box it started from.
      var box = el('input', 'gttxcore-hbox gttxcore-hrunbox');
      box.type = 'checkbox';
      var ebs = [];
      var mine = function () {
        return Object.keys(H.selEntries).filter(function (k) { return k.indexOf(r.id + ':') === 0; });
      };
      var runState = function () {
        box.checked = !!H.selRuns[r.id];
        box.indeterminate = !box.checked && mine().length > 0;
      };
      runState();
      box.addEventListener('change', function () {
        if (box.checked) H.selRuns[r.id] = true; else delete H.selRuns[r.id];
        mine().forEach(function (k) { delete H.selEntries[k]; });
        ebs.forEach(function (b) { b.checked = box.checked; });
        runState();
        historyFoot(H);
      });
      var toggle = el('span', 'gttxcore-htoggle', (H.open[r.id] ? '▾ ' : '▸ ') + historyWhen(r.at) +
        ' · ' + historyWho(r) + ' · ' + (r.label || 'a write') + ' · ' + plural(r.count, 'change') +
        (r.imported ? ' · imported' : '') + (r.note ? ' · ' + r.note : ''));
      toggle.addEventListener('click', function () {
        if (H.open[r.id]) delete H.open[r.id]; else H.open[r.id] = true;
        historyDraw(H, true);
      });
      var back = el('a', 'gttxcore-hbackto', 'back to here');
      back.href = '#';
      back.title = 'Tick this run and every newer one, whatever the filter shows, so Undo Selected... ' +
        'takes the history back to before this run.';
      back.addEventListener('click', function (ev) {
        ev.preventDefault();
        journalRuns().then(function (all) {
          H.selRuns = {};
          H.selEntries = {};
          for (var k = 0; k < all.length; k++) {
            H.selRuns[all[k].id] = true;
            if (all[k].id === r.id) break;
          }
          historyDraw(H, true);
        });
      });
      row.appendChild(box);
      row.appendChild(toggle);
      row.appendChild(back);
      block.appendChild(row);
      if (H.open[r.id]) {
        var inner = el('div', 'gttxcore-hentries', 'Reading…');
        block.appendChild(inner);
        historyEntriesOf(H, r.id).then(function (es) {
          return H.find || H.type ? historyFilter(H, es) : es;
        }).then(function (es) {
          inner.textContent = '';
          es.forEach(function (e) {
            var line = el('div', 'gttxcore-hentry' + (e.undone ? ' gttxcore-hundone' : ''));
            var eb = el('input', 'gttxcore-hbox gttxcore-hentrybox');
            eb.type = 'checkbox';
            eb.checked = !!H.selEntries[e.id] || !!H.selRuns[r.id];
            ebs.push(eb);
            eb.addEventListener('change', function () {
              if (H.selRuns[r.id]) {
                delete H.selRuns[r.id];
                es.forEach(function (x) { if (x.id !== e.id) H.selEntries[x.id] = true; });
              } else if (eb.checked) H.selEntries[e.id] = true;
              else delete H.selEntries[e.id];
              if (es.every(function (x) { return H.selEntries[x.id]; })) {
                es.forEach(function (x) { delete H.selEntries[x.id]; });
                H.selRuns[r.id] = true;
              }
              runState();
              historyFoot(H);
            });
            line.appendChild(eb);
            line.appendChild(historyEntity(e));
            line.appendChild(el('span', null, ' – '));
            line.appendChild(historyChangeNode(e));
            if (e.undone) line.appendChild(el('span', null, ' (undone)'));
            inner.appendChild(line);
          });
        });
      }
      list.appendChild(block);
    });
    if (more) {
      var next = button('Show More', 'gttxcore-hmore');
      next.addEventListener('click', function () { H.shown += HISTORY_PAGE; historyDraw(H, true); });
      list.appendChild(next);
    }
    H.progressEl.textContent = (H.find || H.type || H.source || H.from || H.to
      ? 'Showing ' + plural(runs.length, 'run') + ' that match' + (more ? ', and there are more' : '') + '.'
      : 'Showing ' + runs.length + ' of ' + plural(total, 'run') + '.') +
      (historySelected(H) ? ' ' + historySelected(H) + ' ticked.' : '');
    historyFoot(H);
  }

  function historyLine(H, kind, e, reason) {
    var line = el('div', 'gttxcore-line gttxcore-h' + kind);
    line.appendChild(el('span', null, '[' + kind + '] '));
    line.appendChild(historyEntity(e));
    line.appendChild(el('span', null, ' – '));
    line.appendChild(historyChangeNode(historyInverse(e)));
    if (reason) line.appendChild(el('span', null, ' – ' + reason));
    H.listEl.appendChild(line);
  }

  // Everything ticked, read and checked against what the library holds now.
  function historyReview(H) {
    if (H.busy || !historySelected(H)) return;
    historyBusy(H, true);
    H.progressEl.textContent = 'Checking what can still be undone…';
    Promise.all(Object.keys(H.selRuns).map(function (id) { return historyEntriesOf(H, id); })).then(function (lists) {
      var seen = {}, entries = [];
      lists.forEach(function (es) { es.forEach(function (e) { if (!seen[e.id]) { seen[e.id] = 1; entries.push(e); } }); });
      Object.keys(H.selEntries).forEach(function (id) {
        if (!seen[id] && H.byId[id]) { seen[id] = 1; entries.push(H.byId[id]); }
      });
      // The setting read fresh, not from the copy this page loaded with: it is changed on
      // Stash's settings page, which nothing here hears, often just before an undo.
      var fresh = loadSettings(true).then(null, function () { return settings(); });
      return Promise.all([journalPlan(entries), fresh]);
    }).then(function (both) {
      var plan = both[0];
      H.plan = plan;
      H.mode = 'review';
      H.popBox.checked = truthy((both[1] || settings()).c8JournalUndoTakesOut);
      var list = H.listEl;
      while (list.firstChild) list.removeChild(list.firstChild);
      var ok = 0;
      plan.items.forEach(function (i) {
        if (i.status === 'ok') ok++;
        historyLine(H, i.status === 'ok' ? 'PLAN' : 'SKIP', i.entry, i.reason);
      });
      var gone = (plan.cancelled || []).length;
      H.progressEl.textContent = plural(ok, 'change') + ' can be undone' +
        (plan.items.length - gone > ok ? ', and ' + plural(plan.items.length - gone - ok, 'change') + ' will be skipped' : '') +
        (gone ? '; ' + plural(gone, 'change') + ' cancel out, undone and undone again in what is ticked' : '') +
        '. Nothing has been written.';
    }, function (e) {
      H.progressEl.textContent = 'The check failed: ' + (e && e.message ? e.message : e);
    }).then(function () { historyBusy(H, false); });
  }

  function historyProceed(H) {
    if (H.busy || !H.plan || H.proceedBtn.disabled) return;
    H.mode = 'writing';
    historyBusy(H, true);
    var list = H.listEl, pop = !!H.popBox.checked;
    while (list.firstChild) list.removeChild(list.firstChild);
    journalUndo(H.plan, function (kind, text, w) {
      var line = el('div', 'gttxcore-line gttxcore-h' + kind);
      line.appendChild(el('span', null, '[' + kind + '] '));
      line.appendChild(historyEntity({ type: w.type, eid: w.id, name: w.name }));
      line.appendChild(el('span', null, ' – ' + text));
      // What was put back, field by field, the way the review said it would be.
      if (kind === 'UNDO' && !w.destroy && !w.move) {
        (w.entries || []).forEach(function (e) {
          line.appendChild(el('span', null, '; '));
          line.appendChild(historyChangeNode(historyInverse(e)));
        });
      }
      list.appendChild(line);
    }, { pop: pop }).then(function (res) {
      H.failed = res.failed;
      if (res.written) H.wrote = true;
      H.progressEl.textContent = 'Undone: ' + plural(res.written, 'entity', 'entities') + ' written' +
        (res.failed ? ', ' + plural(res.failed, 'failure') : '') + '. ' + (pop
        ? plural(res.popped, 'change') + ' taken out of the history; what was skipped or failed is still there.'
        : res.run ? 'The undo is in the history, where it can be undone in turn.'
          : res.tooLarge ? 'The undo itself is not in the history: it is more than half its size limit, so it cannot be undone in turn.'
            : '');
    }, function (e) {
      H.failed = 1;
      H.wrote = true;   // it may have written before it failed
      H.progressEl.textContent = 'The undo failed: ' + (e && e.message ? e.message : e);
    }).then(function () {
      H.plan = null;
      H.selRuns = {};
      H.selEntries = {};
      H.entries = {};
      H.popBox.checked = false;
      H.mode = 'done';
      historyBusy(H, false);
      historyStats(H);
    });
  }

  function historyClose(H) {
    if (H.busy && H.mode === 'writing') return;
    unwireEscape(H);
    try { if (H.channel) H.channel.close(); } catch (e) { /* gone with the page */ }
    if (H.backdrop.parentNode) H.backdrop.parentNode.removeChild(H.backdrop);
    _history = null;
    if (H.wrote) refreshPage();
  }

  // What Stash's page shows, asked again: every query it has on screen, refetched through
  // Apollo, so an undo - which can touch entities no notice names, the scenes a restored
  // tag goes back on - is on the page behind the dialog once it closes. Apollo 3.4 names
  // it `refetchQueries`; an older one, `reFetchObservableQueries`. Without Apollo the page
  // stays as it is until the next navigation.
  function refreshPage() {
    var client = window.__APOLLO_CLIENT__;
    try {
      var p = client && typeof client.refetchQueries === 'function' ? client.refetchQueries({ include: 'active' })
        : client && typeof client.reFetchObservableQueries === 'function' ? client.reFetchObservableQueries() : null;
      // A refetch that fails - Stash gone meanwhile - leaves the page as it was, said nowhere.
      if (p && typeof p.then === 'function') p.then(null, function () {});
    } catch (e) {
      console.error('[gttxcore] refreshing the page after an undo:', e);
    }
  }

  // ── Undo History: where it opens from ─────────────────────────────────────
  //
  // Settings - Tasks lists it, since the yml declares it; a capture-phase listener takes
  // the click before Stash would queue a job, and only when the button sits under our own
  // heading. The top bar gets a button of its own beside Stash's Settings and Help, so the
  // history is one click from any page.
  function ownHistoryTask(btn) {
    if (String(btn.textContent || '').trim() !== HISTORY_TASK) return false;
    for (var node = btn, d = 0; node && d < 8; d++, node = node.parentElement) {
      var h3 = node.querySelector ? node.querySelector('h3') : null;
      if (h3 && headingIsOurs(h3.textContent)) return true;
      if (hasClass(node, 'setting-group')) return false;
    }
    return false;
  }

  function historyTaskTick() {
    var nodes = document.querySelectorAll ? document.querySelectorAll('button') : [];
    for (var i = 0; i < nodes.length; i++) {
      var b = nodes[i];
      if (ownHistoryTask(b) && !hasClass(b, 'btn-warning')) {
        b.className = String(b.className || '').replace(/\bbtn-(primary|secondary|info)\b/, '') + ' btn-warning';
      }
    }
  }

  var HISTORY_NAV_ID = 'gttxcore-undo-nav';
  function historyNavTick() {
    var bar = document.querySelector ? document.querySelector('.navbar-buttons') : null;
    if (!bar) return;
    var btn = document.getElementById(HISTORY_NAV_ID);
    if (btn && btn.parentNode === bar) return;
    if (!btn) {
      injectStyle();     // its size and its ink; nothing else of ours may be on this page
      btn = el('button', 'btn btn-primary minimal nav-utility gttxcore-navbtn', '↶');
      btn.id = HISTORY_NAV_ID;
      btn.type = 'button';
      btn.title = 'Undo History';
      btn.setAttribute('aria-label', 'Undo History');
      btn.addEventListener('click', function () { openHistory(); });
    }
    // Before Stash's Settings link, else before the menu toggle, else at the end. The link
    // is found by reading each anchor's `href`, an exact value rather than a selector.
    var anchor = null, links = bar.querySelectorAll ? bar.querySelectorAll('a') : [];
    for (var i = 0; i < links.length && !anchor; i++) {
      if (String(links[i].getAttribute('href') || '') === '/settings') anchor = links[i];
    }
    while (anchor && anchor.parentNode && anchor.parentNode !== bar) anchor = anchor.parentNode;
    if (!anchor || anchor.parentNode !== bar) anchor = bar.querySelector('.nav-menu-toggle');
    if (anchor && anchor.parentNode === bar) bar.insertBefore(btn, anchor);
    else bar.appendChild(btn);
  }

  if (document.addEventListener) {
    document.addEventListener('click', function (event) {
      var t = event.target;
      var btn = t && t.closest ? t.closest('button') : null;
      if (!btn || !ownHistoryTask(btn)) return;
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      openHistory();
    }, true);
  }

  // ── Shift-click ranges in every ᝯㄝₓ dialog ───────────────────────────────
  //
  // A click on a checkbox is the anchor; a Shift-click sets every box between the anchor
  // and it to the state it just took. One listener for all the plugins' dialogs: a dialog
  // here is a `<prefix>-modal` inside a `<prefix>-backdrop` (Stash's own Bootstrap modals
  // sit in `.modal`, so they are never touched). Only boxes of the anchor's own class
  // count, so a footer switch never joins a range of lines; disabled boxes and boxes under
  // a hidden section are skipped. Each box moves by a real `click()`, so whatever the
  // plugin listens for - `click` or `change` - sees it exactly as a click of its own.
  function rangeModal(node) {
    for (var n = node; n && n.parentNode; n = n.parentNode) {
      var own = /(^|\s)[a-z0-9]+-modal(\s|$)/.test(String(n.className || ''));
      if (own && /(^|\s)[a-z0-9]+-backdrop(\s|$)/.test(String(n.parentNode.className || ''))) return n;
    }
    return null;
  }
  function rangeHidden(box, modal) {
    for (var n = box; n && n !== modal; n = n.parentNode) {
      if (/(^|\s)([a-z0-9]+-)?hidden(\s|$)/.test(String(n.className || ''))) return true;
    }
    return false;
  }
  var _ranging = false;
  function rangeClick(event) {
    var box = event.target;
    if (_ranging || !box || box.tagName !== 'INPUT' || box.type !== 'checkbox') return;
    var modal = rangeModal(box);
    if (!modal) return;
    var anchor = modal._gttxAnchor;
    modal._gttxAnchor = box;
    if (!event.shiftKey || !anchor || anchor === box || anchor.className !== box.className ||
        rangeModal(anchor) !== modal) return;
    var all = modal.querySelectorAll('input'), boxes = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].type === 'checkbox' && all[i].className === box.className) boxes.push(all[i]);
    }
    var a = boxes.indexOf(anchor), b = boxes.indexOf(box);
    if (a < 0 || b < 0) return;
    var to = box.checked;
    _ranging = true;
    try {
      for (var j = Math.min(a, b); j <= Math.max(a, b); j++) {
        var x = boxes[j];
        if (x !== box && !x.disabled && x.checked !== to && !rangeHidden(x, modal)) x.click();
      }
    } finally { _ranging = false; }
  }
  if (document.addEventListener) {
    document.addEventListener('click', rangeClick);
    // Shift held on a box or its label would otherwise highlight the text between the two.
    document.addEventListener('mousedown', function (event) {
      if (!event.shiftKey || !event.target || !rangeModal(event.target)) return;
      var t = event.target;
      var onBox = (t.tagName === 'INPUT' && t.type === 'checkbox') ||
        (t.closest && t.closest('label') && t.closest('label').querySelector('input[type="checkbox"]'));
      if (onBox && event.preventDefault) event.preventDefault();
    });
  }

  // ── The settings page ─────────────────────────────────────────────────────
  //
  // The same treatment every ᝯㄝₓ plugin gives its own group - the description
  // split into a summary and a hover box, the group's own description behind
  // **Show more**, a labelled README link, and the red banner when the script
  // running here is not the one installed.
  var CORE_TASKS = ['Undo History...'];
  var CORE_PAGE = settingsPage({
    id: PLUGIN_ID, name: PLUGIN_NAME, shortName: PLUGIN_SHORT_NAME, version: PLUGIN_VERSION,
    prefix: 'gttxcore', keys: Object.keys(DEFAULTS), tasks: CORE_TASKS,
    readmeUrl: README_URL, readmeLabel: 'GTTxCore/README.md', injectStyle: injectStyle,
  });


  function headingIsOurs(text) {
    var t = String(text == null ? '' : text).trim();
    if (t === PLUGIN_NAME) return true;
    t = t.replace(/\s*\([^()]*\)$/, '').replace(/\s+undefined$/, '').trim();
    return t === PLUGIN_NAME;
  }

  function hide(node) {
    if (node && node.style) node.style.display = 'none';
  }

  function foreignButton(node) {
    if (!node) return null;
    if (node.tagName === 'BUTTON') return node._nptOwn ? null : node;
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var found = foreignButton(kids[i]);
      if (found) return found;
    }
    return null;
  }

  var ROW_GAP = '.25rem';


  var SPACING_CLASS       = 'mx-1';


  function ensureRowSpacing(container) {
    if (!container) return;
    // A real element's `.style` is always a live CSSStyleDeclaration, never absent -
    // this guard only ever fires in the test harness, whose fake elements have no
    // `.style` until something sets one.
    if (!container.style) container.style = {};
    var cs = computedStyleOf(container);
    var display = (cs && cs.display) || '';
    var flexish = !display || display.indexOf('flex') !== -1 || display.indexOf('grid') !== -1;
    container._cpt2sBlockRow = !flexish;
    container.style.rowGap = flexish ? ROW_GAP : '';
  }

  function fillNeighbourGaps(container, button, m) {
    var step = Math.max(pxOf(m.left), pxOf(m.right));
    // Nothing on a side means our button is at that end of the row, where Stash's own
    // convention is the whole answer: `margin: 0 10px 0 0`, so no left margin to push it
    // off the edge its first button sits on, and a right margin to trail the last.
    return [
      'margin-left:' + sideMargin(neighbourGap(container, button, false), step, m.left) + 'px',
      'margin-right:' + sideMargin(neighbourGap(container, button, true), step, m.right) + 'px'
    ];
  }

  function nonZeroLength(value) {
    return !!value && value !== 'normal' && parseFloat(value) > 0;
  }

  function stashButtonMargins(container) {
    var kids = container.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k._coopOwner || !hasClass(k, 'btn')) continue;
      var cs = computedStyleOf(k);
      if (!cs) return null;
      if (nonZeroLength(cs.marginLeft) || nonZeroLength(cs.marginRight)) {
        return { left: cs.marginLeft || '0px', right: cs.marginRight || '0px' };
      }
    }
    return null;
  }

  function pxOf(value) {
    var n = parseFloat(value);
    return n > 0 ? n : 0;
  }

  function sideMargin(info, step, own) {
    if (!info) return pxOf(own);
    if (info.gap === null) return 0;
    return Math.max(0, step - info.gap);
  }

  function neighbourGap(container, button, forward) {
    var kids = container.childNodes || [], idx = -1, i;
    for (i = 0; i < kids.length; i++) { if (kids[i] === button) { idx = i; break; } }
    if (idx === -1) return null;
    var near = forward ? 'marginLeft' : 'marginRight';
    var far = forward ? 'marginRight' : 'marginLeft';
    var dir = forward ? 1 : -1;
    var total = 0, seen = false;
    for (i = idx + dir; i >= 0 && i < kids.length; i += dir) {
      var k = kids[i];
      if (!k || !k.tagName) continue;
      seen = true;
      var cs = computedStyleOf(k);
      total += pxOf(cs && cs[near]);
      var action = borderingAction(k, !forward);
      if (action) {
        // A wrapper with a margin *and* an inset button is rare, but summing the two is
        // closer to the truth than picking one, and both are usually zero.
        if (action !== k) total += pxOf((computedStyleOf(action) || {})[near]);
        return { gap: total };
      }
      total += pxOf(cs && cs[far]);
    }
    return seen ? { gap: null } : null;
  }


  function borderingAction(node, fromEnd) {
    if (!node) return null;
    if (hasClass(node, 'btn')) return node;
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[fromEnd ? kids.length - 1 - i : i];
      if (!k || !k.tagName) continue;
      var found = borderingAction(k, fromEnd);
      if (found) return found;
    }
    return null;
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  //
  // The unprefixed `gttx-` rules - the hover card's box and the custom-field mark - are
  // this plugin's now, since the code that draws them is. Every caller still carries its
  // own copy of them for the moment; they are identical, so a duplicate rule costs
  // nothing, and removing them is a separate edit to eight pinned stylesheets.
  var CSS =
    '@font-face{font-family:"GTTx Brand";font-display:block;unicode-range:U+176F;' +
    'src:url(data:font/woff2;base64,' + BRAND_FONT.ta + ') format("woff2");}' +
    '@font-face{font-family:"GTTx Brand";font-display:block;unicode-range:U+311D;' +
    'src:url(data:font/woff2;base64,' + BRAND_FONT.e + ') format("woff2");}' +
    '@font-face{font-family:"GTTx Brand";font-display:block;unicode-range:U+2093;' +
    'src:url(data:font/woff2;base64,' + BRAND_FONT.x + ') format("woff2");}' +
    SYMBOL_FACES +
    '.gttx-tipbox{display:none;position:fixed;left:0;top:0;z-index:1700;' +
    'width:20rem;max-width:90vw;padding:.5rem .65rem;background:var(--gttx-bg,#202b33);color:var(--gttx-fg2,#d6dee4);' +
    'border:1px solid var(--gttx-border-strong,#425a6b);border-radius:3px;font-size:.8rem;line-height:1.45;' +
    'white-space:pre-wrap;pointer-events:none;text-align:left;font-family:inherit;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.gttx-tipbox.gttx-tip-open{display:block;}' +
    '.gttx-gloss{text-decoration:underline dotted;text-underline-offset:2px;cursor:help;}' +
    '.gttx-tipbox img{display:block;width:100%;max-height:14rem;object-fit:contain;' +
    'margin-bottom:.4rem;border-radius:3px;background:var(--gttx-sunken,#111a20);}' +
    // Over the picture's top corners, positioned against the fixed box itself - the
    // .7rem/.85rem insets are the box's own padding plus a step inside the picture.
    '.gttx-tip-rating{position:absolute;top:.7rem;left:.85rem;background:#ffb648;' +
    'color:#1b2429;font-weight:600;font-size:.75rem;line-height:1.4;padding:0 .35rem;' +
    'border-radius:3px;}' +
    '.gttx-tip-organized{position:absolute;top:.7rem;right:.85rem;font-size:.85rem;' +
    'line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.8));}' +
    // stashapp/stash#7139. react-select v5 gives the input container
    // `grid-template-columns:0 min-content`, so the search input is as wide as what has
    // been typed - two pixels with nothing in it - and a right-click in the box lands on
    // the value container instead. `1fr` gives the input the rest of the row, so the
    // pointer is over an input and the browser offers its own Paste. The sizer
    // pseudo-element shares the column and is unharmed; a long entry now scrolls inside
    // the input rather than widening the row, which is the better of the two anyway.
    '.gttx-selectpaste .react-select__input-container{grid-template-columns:0 1fr;}' +
    // ⓕ, after a field's name wherever one is named: one small gap, monospace at one size
    // (`monospace` twice, or the browser shrinks a relative size set in monospace alone).
    '.gttx-cftip{margin-left:.2em;font-family:monospace,monospace;font-size:1.25em;line-height:1;' +
    'color:var(--gttx-highlight,#ffc107);cursor:help;}' +
    '.gttx-glyph{font-family:monospace,monospace;font-size:1.25em;line-height:1;}' +
    // A summary: the words about a setting in the page's sans-serif, its values as the row has them.
    '.gttx-prose{font-family:var(--font-family-sans-serif,var(--bs-font-sans-serif,sans-serif));}' +
    // A listed setting: our names stand in for Stash's text of the value, each with
    // its mark close behind it.
    '.gttx-cflisted .value > span:not(.gttx-cftipped){display:none;}' +
    '.gttx-cftipbox{display:none;position:fixed;left:0;top:0;' +
    'z-index:1600;width:max-content;max-width:min(48rem,60vw);padding:.5rem .65rem;' +
    'background:var(--gttx-bg,#202b33);color:var(--gttx-fg2,#d6dee4);border:1px solid var(--gttx-border-strong,#425a6b);border-radius:3px;' +
    'font-size:.92rem;line-height:1.45;white-space:pre-wrap;pointer-events:none;' +
    'text-align:left;box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.gttx-cftipped.gttx-cftip-open .gttx-cftipbox{display:block;}' +

    // **The duration warning.** The Bad Result Text Color past five seconds, the Highlighted
    // Text Color past one - UI Customizations' colors, so the bands follow what the user
    // picked there; the size and the capitals are what this adds. `inherit` on the family so it stays the card's own typeface.
    '.gttx-durwarn{font-family:inherit;text-transform:uppercase;letter-spacing:.02em;}' +
    '.gttx-durwarn-red{font-size:1.25em;font-weight:700;color:var(--gttx-bad,#ff7b72);}' +
    '.gttx-durwarn-orange{color:var(--gttx-highlight,#ffc107);font-weight:600;}' +

    // Layout edit mode. An outline rather than a border, so nothing moves when it comes
    // on, and the owner's id in a corner label drawn from the attribute itself. Magenta,
    // which nothing else draws in, so an outlined control is never taken for a plugin's own.
    '.gttx-layoutmark{outline:1px dashed #ff00ff !important;outline-offset:1px;' +
    'position:relative;}' +
    '.gttx-layoutmark::after{content:attr(data-gttx-owner);position:absolute;' +
    'left:0;bottom:100%;font-size:.6rem;line-height:1;padding:1px 3px;' +
    'background:#ff00ff;color:#0b1116;border-radius:2px;pointer-events:none;' +
    'white-space:nowrap;z-index:5;}' +

    // ── The shared chrome and the settings page ──────────────────────────
    //
    // **Taken from a sibling's stylesheet rather than written**, which is what these
    // rules were missing for one release: this plugin sat outside the comparison in
    // `.tests/style.test.js`, so hand-written approximations of them drifted with
    // nothing to notice - and **Show more** came out with the browser's default button
    // chrome, a white box, because the rule lacked `padding:0;border:0;background:none`.
    // It is in that comparison now, against all eight.
    '.gttxcore-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;' +
    'background:rgba(0,0,0,.6);z-index:1600;display:flex;align-items:center;' +
    'justify-content:center;}' +
    '.gttxcore-modal{background:var(--gttx-bg,#202b33);color:var(--gttx-fg,#f5f8fa);border:1px solid var(--gttx-border,#394b59);' +
    'border-radius:4px;width:min(100rem,94vw);max-height:88vh;display:flex;' +
    'flex-direction:column;}' +
    '.gttxcore-head{padding:.75rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);}' +
    '.gttxcore-title{font-size:1.1rem;font-weight:600;}' +
    '.gttxcore-warn{color:var(--gttx-highlight,#ffc107);margin-top:.35rem;}' +
    '.gttxcore-note{color:var(--gttx-muted,#a7b6c2);margin-top:.35rem;}' +
    '.gttxcore-legend{color:var(--gttx-dim,#7d8f9c);margin-top:.35rem;font-size:.8rem;}' +
    '.gttxcore-progress{padding:.5rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);' +
    'color:var(--gttx-muted,#a7b6c2);white-space:pre-wrap;}' +
    '.gttxcore-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;' +
    'font-family:monospace;font-size:.8rem;line-height:1.35;min-height:14rem;}' +
    '.gttxcore-line{white-space:pre-wrap;word-break:break-word;}' +
    '.gttxcore-foot{padding:.75rem 1rem;border-top:1px solid var(--gttx-border,#394b59);display:flex;' +
    'gap:.5rem;flex-wrap:wrap;align-items:center;}' +
    '.gttxcore-hunselall{margin-left:auto;}' +
    '.gttxcore-resetall{margin-left:auto;}' +
    // **`!important`, because a hidden utility that loses a cascade is not one.** Every
    // one of these rules is a single class, so the last one written wins - and this one
    // is written before the strips and rows that set their own `display`. A `-hidden` on
    // one of those did nothing at all, which is how Find & Replace shipped a row that
    // stayed on screen with the checkbox that reveals it switched off.
    '.gttxcore-hidden{display:none !important;}' +
    '.gttxcore-busy{color:var(--gttx-highlight,#ffc107);}' +
    '.gttxcore-histbusy:not(.gttxcore-spinner){display:inline-block;min-width:1em;margin-right:.45em;}' +
    '.gttxcore-spinner{display:inline-block;width:.9em;height:.9em;margin-right:.45em;' +
    'vertical-align:-.1em;border:2px solid currentColor;border-right-color:transparent;' +
    'border-radius:50%;animation:gttxcore-turn .8s linear infinite;}' +
    '@keyframes gttxcore-turn{to{transform:rotate(360deg);}}' +
    '.gttxcore-spinner-back{animation-direction:reverse;}' +
    // The sample's ring at the real one's 0.8 s a turn: 3.75 turns in 3 s, still for 0.2 s, back, still again.
    '.gttxcore-spinner-both{animation:gttxcore-both 6.4s linear infinite;}' +
    '@keyframes gttxcore-both{0%{transform:rotate(0deg);}46.875%,50%{transform:rotate(1350deg);}' +
    '96.875%,100%{transform:rotate(0deg);}}' +
    '.gttxcore-demobusy:not(.gttxcore-spinner){display:inline-block;min-width:1em;margin-right:.45em;}' +
    // A dropdown whose options carry a mark (`choices`' third): the label left, the mark right, in
    // the box and in the list. Each `::picker`/`::checkmark` rule alone, so a browser that knows
    // neither drops just those and keeps its native dropdown, the mark after the label.
    '.gttxcore-richchoice{min-width:13em;}' +
    '.gttxcore-richchoice,.gttxcore-richchoice::picker(select){appearance:base-select;}' +
    '.gttxcore-richchoice::picker(select){background:var(--gttx-card,#30404d);color:var(--gttx-fg,#f5f8fa);' +
    'border:1px solid var(--gttx-border,#394b59);border-radius:3px;padding:2px 0;}' +
    '.gttxcore-richchoice option::checkmark{display:none;}' +
    '.gttxcore-richchoice option,.gttxcore-richchoice selectedcontent{display:flex;justify-content:space-between;' +
    'align-items:center;gap:1.5em;}' +
    '.gttxcore-richchoice option{padding:2px 8px;}' +
    '.gttxcore-richchoice option:hover,.gttxcore-richchoice option:focus{background:var(--gttx-border,#394b59);}' +
    '.gttxcore-richchoice button{display:flex;flex:1;}' +
    '.gttxcore-richchoice selectedcontent{flex:1;}' +
    '.gttxcore-busymark{letter-spacing:.15em;}' +
    '.gttxcore-spinner-still{animation:none;width:.8em;height:.8em;margin-right:0;}' +
    '.gttxcore-own-group .gttxcore-sub-heading{white-space:pre-wrap;}' +
    '.gttxcore-own-group .gttxcore-sub-heading .gttxcore-p{margin:0 0 .35em;}' +
    '.gttxcore-own-group .gttxcore-sub-heading .gttxcore-p:last-child{' +
    'margin-bottom:0;}' +
    '.gttxcore-desc-collapsed .gttxcore-p:not(:first-child){display:none;}' +
    '.gttxcore-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:var(--gttx-accent,#7cc4ff);font-size:.8rem;cursor:pointer;' +
    'text-decoration:underline;}' +
    '.gttxcore-stale{margin:.5rem 0;padding:.6rem .75rem;' +
    'border-left:4px solid #ff7373;background:rgba(255,115,115,.14);color:#ff7373;' +
    'font-size:.95rem;line-height:1.45;font-weight:600;}' +
    '.gttxcore-tipped{position:relative;}' +
    '.gttxcore-tip{margin-left:.35rem;cursor:pointer;opacity:.65;font-style:normal;' +
    'font-size:1.05em;}' +
    '.gttxcore-tip:hover,.gttxcore-tip:focus{opacity:1;outline:none;}' +
    '.gttxcore-tipbox{display:none;position:absolute;left:0;' +
    'bottom:calc(100% + .35rem);z-index:1500;width:max-content;max-width:100%;' +
    'padding:.5rem .65rem;background:var(--gttx-bg,#202b33);color:var(--gttx-fg2,#d6dee4);border:1px solid var(--gttx-border-strong,#425a6b);' +
    'border-radius:3px;font-size:.92rem;line-height:1.45;white-space:pre-wrap;' +
    'pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.gttxcore-tipped.gttxcore-tip-open .gttxcore-tipbox{display:block;}' +
    '.gttxcore-readme{font-size:.8rem;margin-top:.35rem;' +
    'display:inline-block;}' +
    // This plugin's own: the dialog has no log and no counters, so it has a body and
    // three rows instead.
    // The shared modal is 100rem wide because the other dialogs hold monospace log
    // lines naming an entity, an id and two values. This one holds a few switches and
    // a sentence each, so at that width the text is a thin strip against the left edge
    // and the box reads as off-centre. A plugin-local modifier beside the pinned rule,
    // the way `.cfbe-tall` adds a height, rather than an edit to what eight share.
    //
    // The width is `PropagateTagsAndPerformers`' own, not a second opinion:
    // `.narrow` already exists there and means the same thing - a dialog with no log
    // does not need the width the log lines earned - so it takes the sibling's value
    // the way `.tall` was settled. The extra height is on the body instead, which is
    // this plugin's alone, so the modifier stays byte-identical with the sibling's.
    '.gttxcore-modal.gttxcore-narrow{width:min(58rem,94vw);}' +
    '.gttxcore-body{padding:.75rem 1rem;overflow:auto;min-height:16rem;}' +
    '.gttxcore-devrow{padding:.5rem 0;border-bottom:1px solid var(--gttx-border-faint,#2b3a45);}' +
    '.gttxcore-devlabel{display:flex;align-items:center;gap:.5rem;margin:0;' +
    'cursor:pointer;font-weight:600;}' +
    '.gttxcore-devname{font-size:.95rem;}' +
    '.gttxcore-devhelp{font-size:.82rem;color:var(--gttx-muted,#a7b6c2);margin-top:.25rem;' +
    'margin-left:1.6rem;}' +
    // Undo History Settings: a text box beside its caption; the one setting that can lose
    // history highlighted, caption and help, as a warning is everywhere here.
    '.gttxcore-jbox.gttxcore-wide{width:min(24rem,60vw);}' +
    '.gttxcore-devline{display:flex;align-items:center;flex-wrap:wrap;}' +
    '.gttxcore-fieldmark{margin-left:.4rem;}' +
    // A plugin's own link (`svr-tagicon` and the like) keeps the slot's spacing, not its margin too.
    '.gttxcore-fieldmark>a{margin-left:0!important;}' +
    // A switch's value opening a sentence of a description - "On:", "Off:" - in the value font.
    // A touch larger than the prose around it, so a switch's two answers stand out at a glance.
    '.gttx-switchval{font-family:"Courier New",Courier,monospace;font-size:1.15em;font-weight:600;}' +
    // A dropdown field is a box like the others, sized to what it says.
    '.gttxcore-jbox.gttxcore-choicebox{width:auto;max-width:min(24rem,60vw);}' +
    // All On and All Off at the right end of a settings dialog's footer.
    '.gttxcore-footgap{flex:1 1 auto;}' +
    // A section's heading in a settings dialog: a rule above it, its All On and All Off at the right.
    '.gttxcore-fieldhead{display:flex;align-items:center;gap:.4rem;margin:.9rem 0 0;padding-top:.5rem;' +
    'border-top:1px solid var(--gttx-border,#394b59);font-weight:600;}' +
    '.gttxcore-fieldhead:first-child{margin-top:0;padding-top:0;border-top:0;}' +
    '.gttxcore-fieldheadhelp{margin-bottom:.2rem;}' +
    '.gttxcore-devrow-end{border-bottom:0;}' +
    '.gttxcore-half{display:inline-block;width:50%;vertical-align:top;box-sizing:border-box;padding-right:.5rem;}' +
    // A tag's mark beside its box: linked plain, or the Highlighted Text Color where no tag is named so.
    '.gttx-tagmark{text-decoration:none;cursor:pointer;}' +
    // No tag by that name or alias: a big red question mark, set in Courier New, the Bad Result color.
    '.gttx-tagmark-none{color:var(--gttx-bad,#ff7b72);cursor:help;font-family:"Courier New",Courier,monospace;' +
    'font-weight:700;font-size:1.35em;line-height:1;vertical-align:-.05em;}' +
    // A dialog's or a summary's ⓕ and 🔗 at the size the settings rows and the cards draw them.
    '.gttxcore-fieldmark,.gttxcore-summark{font-size:1.25em;line-height:1;}' +
    '.gttxcore-summark{margin-left:.3rem;}' +
    // A tag's 🔗 close after its closing quote: none of the margin a plugin gives its link beside a box.
    '.gttxcore-summark.gttxcore-tagslot{margin-left:.05rem;}' +
    '.gttxcore-summark.gttxcore-tagslot>*{margin-left:0!important;}' +
    // The tag icon: Stash's card icon, in the Highlighted Text Color, in proportion to the tag name it
    // goes with - in em, so the same proportion wherever it is drawn: a summary, a dialog's line (a
    // box takes the line's font from Stash's Bootstrap) and Stash's own value of a native setting.
    '.gttx-tagglyph{display:inline-block;width:1.2em;height:1.344em;margin:0 .05em 0 .15em;vertical-align:-.27em;' +
    'color:var(--gttx-highlight,#ffc107);}' +
    '.gttx-tagglyph svg{display:block;width:100%;height:100%;fill:currentColor;}' +
    // A settings group Core folds (`fold`), drawn as Stash draws the groups it folds itself.
    '.setting-group.gttx-folded>.collapsible-section{display:none!important;}' +
    '.setting-group.gttx-foldable>.setting{cursor:pointer;}' +
    '.setting-group:not(.gttx-folded) .gttx-fold-btn svg{transform:rotate(180deg);}' +
    // A mark that resolved to nothing leaves no gap before the words after it.
    '.gttxcore-summark:empty{display:none;}' +
    // A color in a summary: a square of it before its code, outlined in black so a color close to
    // the page's own still reads as a square.
    '.gttxcore-swatch{display:inline-block;width:.8em;height:.8em;margin-right:.3em;vertical-align:-.05em;' +
    'border:1px solid #000;border-radius:1px;}' +
    // Those two are at the marks' size already, so a ⓕ in one is not made larger again.
    '.gttxcore-fieldmark .gttx-cftip,.gttxcore-summark .gttx-cftip{font-size:1em;margin-left:0;}' +
    '.gttxcore-colorbox{width:3rem;height:1.6rem;padding:0 .1rem;background:var(--gttx-card,#30404d);' +
    'border:1px solid var(--gttx-border,#394b59);border-radius:3px;vertical-align:middle;cursor:pointer;}' +
    '.gttxcore-colorreset{margin:0 .5rem;}' +
    // UI Customizations' samples: a column on the right of each color's row, lined up with it,
    // under the row's text at a narrow width. The marks and pills as ENM's and CFBE's are.
    '.gttxcore-demorow{display:flex;gap:1rem;flex-wrap:wrap;align-items:center;}' +
    '.gttxcore-devmain{flex:1 1 22rem;min-width:0;}' +
    '.gttxcore-demo{flex:0 1 21rem;min-width:14rem;padding:.35rem .6rem;border:1px solid var(--gttx-border,#394b59);' +
    'border-radius:3px;font-size:.82rem;line-height:1.6;}' +
    '.gttxcore-demoline{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.gttxcore-demodim{color:var(--gttx-muted,#a7b6c2);}' +
    '.gttxcore-demobold{font-weight:600;}' +
    '.gttxcore-demomark{border-radius:2px;padding:0 .1rem;}' +
    '.gttxcore-demopill{border-radius:3px;padding:0 .3rem;background:var(--gttx-card,#30404d);}' +
    '.gttxcore-demotoggle{font-size:.8rem;text-decoration:underline;}' +
    // The stale Rescan's own breathing, in the box's color rather than its !important one;
    // inline-block with a margin, so the line's overflow does not clip the glow.
    '.gttxcore-demorescan{display:inline-block;margin:4px 4px 4px 3px;padding:0 .45rem;font-size:inherit;' +
    'font-weight:700;cursor:default;pointer-events:none;animation:gttx-breathe 1s ease-in-out infinite;}' +
    '.gttxcore-jbox{margin-left:.5rem;width:7rem;background:var(--gttx-card,#30404d);color:var(--gttx-fg,#f5f8fa);border:1px solid var(--gttx-border,#394b59);' +
    'border-radius:3px;padding:.1rem .35rem;}' +
    // The three levels (`levelOf`): text in the level, a box's tick too. `:root` outranks
    // Stash's own `.setting h3` and a plugin's label color.
    ':root .gttx-lv-semi{color:' + LEVEL_COLOR.semi + '}:root .gttx-lv-hl{color:' + LEVEL_COLOR.hl + '}' +
    ':root .gttx-lv-strong{color:' + LEVEL_COLOR.strong + '}' +
    ':root .gttx-lv-semi input[type=checkbox]{accent-color:' + LEVEL_COLOR.semi + '}' +
    ':root .gttx-lv-hl input[type=checkbox]{accent-color:' + LEVEL_COLOR.hl + '}' +
    ':root .gttx-lv-strong input[type=checkbox]{accent-color:' + LEVEL_COLOR.strong + '}' +
    // An edit box its border, in the same level.
    ':root .gttx-lv-semi input[type=text]{border-color:' + LEVEL_COLOR.semi + '}' +
    ':root .gttx-lv-hl input[type=text]{border-color:' + LEVEL_COLOR.hl + '}' +
    ':root .gttx-lv-strong input[type=text]{border-color:' + LEVEL_COLOR.strong + '}' +
    // ⓕ and 🖬 in the UI Customizations row, in the highlight as on the cards.
    '.gttxcore-hl-mark{color:var(--gttx-highlight,#ffc107);}' +
    // A Rescan whose listing another tab has since changed: bold, in the Highlighted Text
    // Color, breathing white and green about once a second.
    '@keyframes gttx-breathe{0%,100%{box-shadow:0 0 0 2px var(--gttx-fg,#f5f8fa);border-color:var(--gttx-fg,#f5f8fa);}' +
    '50%{box-shadow:0 0 0 3px #28a745;border-color:#28a745;}}' +
    '.gttx-stale-rescan{font-weight:700 !important;color:var(--gttx-highlight,#ffc107) !important;' +
    'animation:gttx-breathe 1s ease-in-out infinite;}' +
    // Undo History: the list, a run a row, its changes indented under it.
    '.gttxcore-modal.gttxcore-history{width:min(100rem,94vw);}' +
    '.gttxcore-hfilter{padding:.35rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;font-size:.8rem;}' +
    '.gttxcore-hfind{flex:1 1 14rem;min-width:8rem;background:var(--gttx-bg,#1f2b33);color:var(--gttx-fg,#f5f8fa);' +
    'border:1px solid var(--gttx-border,#394b59);border-radius:3px;padding:.15rem .4rem;}' +
    '.gttxcore-hselect,.gttxcore-hdate{background:var(--gttx-bg,#1f2b33);color:var(--gttx-fg,#f5f8fa);border:1px solid var(--gttx-border,#394b59);' +
    'border-radius:3px;padding:.1rem .3rem;}' +
    // Whole pixels down the list: at .8rem the text's own line height is a fraction of a
    // pixel, rows land on fractional offsets, and a native checkbox snapped there draws a
    // pixel taller on every third row or so. So the line height, the paddings and the box
    // are all in px.
    '.gttxcore-hlist{font-family:monospace;font-size:.8rem;min-height:16rem;line-height:20px;}' +
    '.gttxcore-hrun{padding:2px 0;border-bottom:1px solid var(--gttx-border-faint,#2b3a45);}' +
    // A run's line and a change's line are text that flows, not flex columns: as columns
    // a long name wrapped inside a column of its own and the change beside it in another.
    // The box is inline, its margins summing to the 20px line, and a hanging indent
    // starts every wrapped line after it.
    '.gttxcore-hhead{padding-left:19px;text-indent:-19px;}' +
    '.gttxcore-hplus{color:var(--gttx-good,#84d68a);font-weight:600;}.gttxcore-hminus{color:#ff7b72;font-weight:600;}' +
    '.gttxcore-hcfname{color:#48aff0;cursor:help;}' +
    '.gttxcore-hbackto{margin-left:.75rem;font-size:.8rem;color:var(--gttx-muted,#a7b6c2);white-space:nowrap;}' +
    '.gttxcore-hpop{margin:0 .5rem;align-self:center;cursor:pointer;}' +
    '.gttxcore-htoggle{cursor:pointer;white-space:pre-wrap;word-break:break-word;}' +
    '.gttxcore-hentries{padding:2px 0 4px 26px;color:var(--gttx-muted,#a7b6c2);}' +
    '.gttxcore-hentry{padding-left:19px;text-indent:-19px;white-space:pre-wrap;word-break:break-word;}' +
    // An undone change dims its words, not its box: a dim box reads as disabled.
    '.gttxcore-hlist .gttxcore-hbox{width:13px;height:13px;margin:4px 6px 3px 0;vertical-align:top;}' +
    '.gttxcore-hundone>:not(.gttxcore-hbox){opacity:.55;}' +
    '.gttxcore-elink{text-decoration:none;}' +
    '.gttxcore-elink:hover{text-decoration:underline;}' +
    '.gttxcore-hSKIP{color:var(--gttx-highlight,#ffc107);} .gttxcore-hERROR{color:#ff7373;} .gttxcore-hUNDO{color:#84d68a;}' +
    '.gttxcore-hmore{margin-top:.5rem;}' +
    '.gttxcore-navbtn{font-size:1.15rem;line-height:1;}' +
    // In the Highlighted Text Color, as a mark of something that writes: an Undo does. By id, because Stash's
    // own `button.minimal:hover:not(:disabled)` outranks any class selector, and every state
    // is named since Stash sets the color on each. Its hover background stays Stash's.
    '#gttxcore-undo-nav,#gttxcore-undo-nav:hover,#gttxcore-undo-nav:focus,' +
    '#gttxcore-undo-nav:active{color:var(--gttx-highlight,#ffc107);}' +
    // Every ᝯㄝₓ dialog and tooltip: GTTx Brand before the page's own fonts (`brandTick`), above
    // any plugin's own `font-family:inherit` there. Unset, the variable leaves them inheriting.
    BRAND_PREFIXES.map(function (p) { return ':root .' + p + '-modal,:root .' + p + '-tipbox'; }).join(',') +
    ',:root .gttx-tipbox,:root .gttx-cftipbox{font-family:var(--gttx-brand-font);}' +
    // The marks' monospace with GTTx Symbols after it, above each plugin's copy of `.gttx-cftip`.
    ':root .gttx-cftip,:root .gttx-glyph{font-family:monospace,monospace,' + SYMBOLS + ';}';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = el('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // ── The Dev Mods setting row, taken over by the dialog that edits it ──────
  //
  // Stash renders a STRING setting as a value span and an Edit button opening a one-line
  // text modal - which for eight flags spelled `LOG_BUTTON_VIS=ON, LOG_PTP2RE=OFF, …` is a
  // place to make a typo in. The value is replaced with the switches in words and Stash's
  // own button with one opening the dialog; both of Stash's are hidden rather than
  // removed, because React owns them and the setting must stay editable if this script
  // ever stops running.
  var DEV_LINE_ID = 'gttxcore-devmods-line';
  var DEV_BTN_ID = 'gttxcore-devmods-button';

  // What the switches say now, the way UI Customizations' row says its own: the ones on, or that
  // none is. The logs' shared "to the Browser Console" is left off, or three of them on would
  // read as a paragraph.
  function devSummary(state) {
    var on = DEV_MODS.filter(function (m) { return state[m.key]; })
      .map(function (m) { return m.label.replace(/ to the Browser Console$/, ''); });
    return on.length ? 'On: ' + on.join(', ') + '.' : 'Every switch: Off.';
  }

  function devFieldTick() {
    var row = settingRow(PLUGIN_ID, 'b1DevMods');
    if (!row) return;
    var slot = byClass(row, 'value');
    var line = document.getElementById(DEV_LINE_ID);
    if (!line) {
      // The element the rows Core draws itself carry their summary in, so it reads as theirs.
      line = el('div', 'value gttxcore-devmods-sum');
      line.id = DEV_LINE_ID;
    }
    var text = devSummary(parseDevMods(settings().b1DevMods));
    if (line._sumText !== text) { line._sumText = text; drawSummary(line, text); }
    afterDescription(row, line);
    if (slot && slot !== line) hide(slot);

    var btn = document.getElementById(DEV_BTN_ID);
    if (!btn) {
      btn = settingButton('Dev Mods...', 'gttxcore-devbtn');
      btn.id = DEV_BTN_ID;
      btn._coopOwner = PLUGIN_ID;
      btn.title = 'Switches for working on these plugins, and each plugin\'s console logging. ' +
        'Nothing here changes your library, and all are off by default.';
      btn.addEventListener('click', function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        openDevMods();
      });
    }
    var edit = foreignButton(row);
    if (edit) hide(edit);
    var btnHost = edit ? edit.parentNode : row;
    if (btn.parentNode !== btnHost) btnHost.appendChild(btn);
  }

  // ── Ticks ─────────────────────────────────────────────────────────────────

  // **Nothing is asked until something on the page depends on the answer.** This script
  // is loaded into every page of every Stash that has any ᝯㄝₓ plugin installed, and a
  // settings query per tab at boot is a query for a feature most tabs never reach. The
  // two things that need the settings are the tagger's duration sentence and this
  // plugin's own settings group, and both announce themselves in the DOM.
  function tick() {
    var group = CORE_PAGE.group();
    var cards = document.querySelectorAll ?
      document.querySelectorAll('.scene-metadata') : [];
    var boxes = document.querySelectorAll ?
      document.querySelectorAll('.react-select__input-container') : [];
    var heads = headCountTargets();
    if (group || cards.length || boxes.length || heads.length) {
      try { loadSettings(false); } catch (e) { /* a settings read is never fatal */ }
    }
    try { themeTick(); } catch (e) { fail(e); }
    try { symbolsTick(); } catch (e) { fail(e); }   // before brandTick, which reads the fonts it sets
    try { brandTick(); } catch (e) { fail(e); }
    try { durationTick(cards); } catch (e) { fail(e); }
    try { selectPasteTick(boxes); } catch (e) { fail(e); }
    try { headCountTick(heads); } catch (e) { fail(e); }
    try { layoutTick(); } catch (e) { fail(e); }
    try { historyNavTick(); } catch (e) { fail(e); }
    try { historyTaskTick(); } catch (e) { fail(e); }
    if (group) { try { settingsTick(group); } catch (e) { fail(e); } }
    // Last, so it reads the descriptions after the ticks above have split and folded them.
    try { glossaryTick(); } catch (e) { fail(e); }
  }

  function fail(e) { if (window.console && console.error) console.error('[gttxcore]', e); }

  // ── Counters on the cards ─────────────────────────────────────────────────
  //
  // Last in the row of counters Stash draws under a card - tags, performers, groups: ⓕ and
  // the number of custom fields, on the card of every entity that has them and holds at
  // least one, and on a scene card 🖬 and its number of files where it has more than one.
  // The files are in what the card was drawn from. The custom fields are too on a performer,
  // tag, group or studio card, and on the others are asked for a page of cards at once -
  // the cards mounting together join one batch per type - and kept a short while.
  // Registered at load, before the cards first render, through Stash's component patching.
  var CARD_TYPES = [
    { patch: 'SceneCard.Popovers', prop: 'scene', find: 'findScenes', node: 'scenes', files: true },
    { patch: 'ImageCard.Popovers', prop: 'image', find: 'findImages', node: 'images' },
    { patch: 'GalleryCard.Popovers', prop: 'gallery', find: 'findGalleries', node: 'galleries' },
    { patch: 'PerformerCard.Popovers', prop: 'performer', find: 'findPerformers', node: 'performers' },
    { patch: 'TagCard.Popovers', prop: 'tag', find: 'findTags', node: 'tags' },
    // No counter row of their own to patch: the whole card, whose `popovers` it is handed.
    { patch: 'GroupCard', prop: 'group', find: 'findGroups', node: 'groups', whole: true },
    { patch: 'StudioCard', prop: 'studio', find: 'findStudios', node: 'studios', whole: true },
  ];
  var CARD_SHARE_MS = 30000, CARD_BATCH_MS = 50, CARD_TIP_LINES = 10;
  var _cardFields = {}, _cardBatch = {};

  // One entity's custom fields: `{ name: value }`, from its batch.
  function cardFields(t, id) {
    var key = t.node + ':' + id, hit = _cardFields[key];
    if (hit && Date.now() - hit.at < CARD_SHARE_MS) return hit.p;
    if (!_cardBatch[t.node]) {
      var batch = _cardBatch[t.node] = { ids: [] };
      batch.p = new Promise(function (done) { setTimeout(done, CARD_BATCH_MS); }).then(function () {
        _cardBatch[t.node] = null;
        return gqlRequest('query GTTxCardFields($ids: [ID!]) { ' + t.find + '(ids: $ids, filter: { per_page: -1 }) { ' +
          t.node + ' { id custom_fields } } }', { ids: batch.ids });
      }).then(function (d) {
        var out = {};
        ((((d || {})[t.find]) || {})[t.node] || []).forEach(function (e) { out[String(e.id)] = e.custom_fields || {}; });
        return out;
      }, function () { return {}; });
    }
    _cardBatch[t.node].ids.push(id);
    var p = _cardBatch[t.node].p.then(function (map) { return map[id] || {}; });
    _cardFields[key] = { at: Date.now(), p: p };
    return p;
  }

  function cardValueText(v) {
    var t = typeof v === 'string' ? v : JSON.stringify(v);
    t = String(t).replace(/\s+/g, ' ');
    return t.length > 60 ? t.slice(0, 59) + '\u2026' : t;
  }
  function cardFieldTip(fields) {
    var names = Object.keys(fields).sort(), more = names.length - CARD_TIP_LINES;
    return plural(names.length, 'custom field') + ':\n' + names.slice(0, CARD_TIP_LINES).map(function (n) {
      return n + ': ' + cardValueText(fields[n]);
    }).join('\n') + (more > 0 ? '\n...and ' + more + ' more' : '');
  }
  function cardFileTip(files) {
    var more = files.length - CARD_TIP_LINES;
    return plural(files.length, 'file') + ', the first the one Stash plays and names the scene by:\n' +
      files.slice(0, CARD_TIP_LINES).map(function (f) { return f.basename || f.path || f.id; }).join('\n') +
      (more > 0 ? '\n...and ' + more + ' more' : '');
  }

  // The counters, drawn like Stash's own: a minimal button in a wrapper div, the mark where
  // their icon is. `own` draws the rule and the group too, for a card Stash drew none on.
  // The highlight, as Scene Variants' ⸎ beside them is.
  var CARD_HIGHLIGHT = { color: 'var(--gttx-highlight,#ffc107)' };
  // A circled letter sits inside the cap height, so at the button's own size ⓕ read smaller
  // than the icons beside it and than the same ⓕ on the settings page. Scaled up to match that
  // one; line-height 1 keeps the counter row its height. The number to tune if it looks off.
  // ⓕ and 🖬 alike, and as Scene Variants' ⸎ counter (`.svr-vcount-mark`): monospace at one size.
  var CARD_MARK = { marginRight: '7px', fontSize: '1.25em', lineHeight: 1, fontFamily: 'monospace, monospace, ' + SYMBOLS };
  function CardCounts(React, Bootstrap) {
    return function (props) {
      var t = props.t, ent = props.ent;
      var st = React.useState(null), fields = st[0], setFields = st[1];
      var on = React.useState(settings()), s = on[0], setS = on[1];
      React.useEffect(function () {
        var live = true;
        loadSettings(false).then(function (now) {
          if (!live) return null;
          setS(now);
          if (!truthy(now.a7CardFieldCount)) return null;
          return ent.custom_fields ? ent.custom_fields : cardFields(t, String(ent.id));
        }).then(function (f) { if (live && f) setFields(f); }, function () {});
        return function () { live = false; };
      }, [ent.id]);
      var kids = [];
      var counter = function (cls, title, mark, count) {
        kids.push(React.createElement('div', { key: cls, className: cls, title: title },
          React.createElement(Bootstrap.Button, { className: 'minimal', style: CARD_HIGHLIGHT },
            React.createElement('span', { className: 'gttx-card-mark', style: CARD_MARK }, mark),
            React.createElement('span', null, String(count)))));
      };
      var n = fields && truthy(s.a7CardFieldCount) ? Object.keys(fields).length : 0;
      if (n) counter('gttx-cfields', cardFieldTip(fields), '\u24d5', n);
      var files = t.files && truthy(s.a8CardFileCount) ? ent.files || [] : [];
      if (files.length > 1) counter('gttx-cfiles', cardFileTip(files), '\ud83d\uddac', files.length);
      if (!kids.length) return null;
      if (!props.own) return React.createElement(React.Fragment, null, kids);
      return React.createElement(React.Fragment, null, React.createElement('hr', { key: 'gttx-card-hr' }),
        React.createElement(Bootstrap.ButtonGroup, { key: 'gttx-card-group', className: 'card-popovers' }, kids));
    };
  }

  // The card's `card-popovers` group, found in what Stash rendered and rebuilt with `extra`
  // as its last child; null where it has none.
  function intoCardPopovers(React, el, extra) {
    if (!React.isValidElement(el)) return null;
    var kids = el.props && el.props.children;
    if (/(^|\s)card-popovers(\s|$)/.test(String((el.props && el.props.className) || ''))) {
      return React.cloneElement(el, null, React.Children.toArray(kids).concat([extra]));
    }
    if (kids == null) return null;
    var arr = React.Children.toArray(kids);
    for (var i = 0; i < arr.length; i++) {
      var placed = intoCardPopovers(React, arr[i], extra);
      if (placed) { arr[i] = placed; return React.cloneElement(el, null, arr); }
    }
    return null;
  }

  var _cardsPatched = false;
  function installCardCounts() {
    var api = window.PluginApi;
    if (_cardsPatched || !api || !api.patch || typeof api.patch.after !== 'function') return;
    var React = api.React, Bootstrap = (api.libraries || {}).Bootstrap;
    if (!React || !React.cloneElement || !Bootstrap || !Bootstrap.Button || !Bootstrap.ButtonGroup) return;
    _cardsPatched = true;
    var Counts = CardCounts(React, Bootstrap);
    CARD_TYPES.forEach(function (t) {
      api.patch.after(t.patch, function (props) {
        var result = arguments[arguments.length - 1];
        try {
          var ent = props && props[t.prop];
          // A compact card draws no counters of its own, so it gets none of ours either.
          if (!ent || ent.id == null || props.compact) return result;
          var mine = function (own) { return React.createElement(Counts, { key: 'gttx-card-counts', t: t, ent: ent, own: own }); };
          if (!t.whole) {
            return intoCardPopovers(React, result, mine(false)) || React.createElement(React.Fragment, null, result, mine(true));
          }
          if (!React.isValidElement(result) || !result.props || !('popovers' in result.props)) return result;
          var pop = result.props.popovers;
          return React.cloneElement(result, { popovers: (pop && intoCardPopovers(React, pop, mine(false))) ||
            React.createElement(React.Fragment, null, pop, mine(!pop)) });
        } catch (e) {
          fail(e);
          return result;
        }
      });
    });
  }

  function settingsTick(group) {
    CORE_PAGE.decorate(group);
    devFieldTick();
    journalRowTick(group);
    globalsRowTick(group);
  }

  // ── Every plugin's own chrome ─────────────────────────────────────────────
  //
  // What each ᝯㄝₓ plugin used to carry a copy of - near-identical copies that had
  // drifted only in renamed locals and inlined helpers: its settings group, its task
  // buttons on Settings → Tasks, Escape on its dialogs, the bulk-edit lease, its
  // installed version, its console gate, and the two fetch-interception helpers. Each takes
  // the caller's identity - id, name, class prefix, tasks - so the classes and ids on the
  // page are exactly the ones each plugin's own CSS and suites already use.

  var BTN_VARIANTS = /\bbtn-(secondary|primary|success|info|light|dark|link|warning)\b/g;
  var LEASE_TTL_MS = 300000;      // a lease lapses on its own, so a crashed run cannot hold the others off

  // `o`: { id, name, shortName, version, prefix, keys, tasks, readmeUrl, readmeLabel,
  // injectStyle, headingText }. `headingText(h3)` is what the group's heading says, for a
  // plugin that puts a node of its own inside that h3; the raw text by default. `keys` are the plugin's setting keys, which find its group by id; with
  // none (a plugin that has no settings) the group is found by its heading alone. `tasks`
  // are its task captions, which tell Settings → Tasks - headed with the same name - apart.
  // Returns `group()`, the plugin's settings group or null, and `decorate(group)`: the
  // description split into paragraphs with the rest behind Show more, each multi-paragraph
  // setting reduced to its summary with the rest in a hover box, the red banner when the
  // script running is not the one installed, and the labelled README link.
  function settingsPage(o) {
    var P = o.prefix;
    var keys = o.keys || [];
    var tasks = o.tasks || [];
    var cls = function (n) { return P + '-' + n; };
    var headingText = o.headingText || function (h3) {
      return h3 && h3.textContent != null ? String(h3.textContent) : '';
    };

    function headingIsOurs(text) {
      var t = String(text == null ? '' : text).trim();
      if (t === o.name) return true;
      return t.replace(/\s*\([^()]*\)$/, '').replace(/\s+undefined$/, '').trim() === o.name;
    }

    // Settings → Tasks heads its group with the same name; the task buttons are what say
    // which page this is.
    function hasTaskButton(node) {
      var buttons = node && node.querySelectorAll ? node.querySelectorAll('button') : [];
      for (var i = 0; i < buttons.length; i++) {
        if (tasks.indexOf(String(buttons[i].textContent || '').trim()) !== -1) return true;
      }
      return false;
    }

    function group() {
      // Every key rather than one named one: a release can rename every setting a plugin
      // has, and a single named anchor is exactly what such a rename breaks.
      var node = null, d, i;
      for (i = 0; i < keys.length && !node; i++) node = settingElement(o.id, keys[i]);
      for (d = 0; node && d < 10; d++, node = node.parentElement) {
        if (hasClass(node, 'setting-group')) return node;
      }
      // A Stash that sets no setting ids, or a plugin with no settings: the group headed
      // with the plugin's name that is not the Tasks page's. Every such heading, not the
      // first: Settings → Tasks can be in the document too, ahead of ours, and stopping at
      // it left a plugin with no settings - found by its heading alone - decorating nothing.
      var heads = document.querySelectorAll ? document.querySelectorAll('h3') : [];
      for (i = 0; i < heads.length; i++) {
        if (!headingIsOurs(headingText(heads[i]))) continue;
        for (node = heads[i], d = 0; node && d < 10 && !hasClass(node, 'setting-group'); d++) node = node.parentElement;
        var g = node && hasClass(node, 'setting-group') ? node : heads[i].parentElement;
        if (g && !hasTaskButton(g)) return g;
      }
      return null;
    }

    function split(g) {
      var sub = byClass(g, 'sub-heading');
      if (!sub) return;
      var kids = sub.childNodes || [];
      if (kids.length && hasClass(kids[0], cls('p'))) return;           // already split
      var text = sub.textContent || '';
      if (text.indexOf('\n') === -1) return;                            // nothing to split
      sub.textContent = '';
      text.split(/\n{2,}/).forEach(function (para) {
        var t = tipText(para);
        if (t) sub.appendChild(valueProse(el('div', cls('p')), t, true));
      });
    }

    function collapse(g) {
      var sub = byClass(g, 'sub-heading');
      if (!sub) return;
      var kids = sub.childNodes || [], paras = 0;
      for (var i = 0; i < kids.length; i++) if (hasClass(kids[i], cls('p'))) paras++;
      if (paras < 2 || document.getElementById(cls('desc-toggle'))) return;
      // A re-render drops the button and the class together, so the description returns
      // to collapsed rather than to a half-state with no way out of it.
      toggleClass(sub, cls('desc-collapsed'), true);
      var btn = el('button', cls('desc-toggle'), 'Show more');
      btn.id = cls('desc-toggle');
      btn.type = 'button';
      btn.addEventListener('click', function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        var open = hasClass(sub, cls('desc-collapsed'));
        toggleClass(sub, cls('desc-collapsed'), !open);
        btn.textContent = open ? 'Show less' : 'Show more';
      });
      sub.appendChild(btn);
    }

    function tipTrigger(node, row) {
      if (!node || node._gttxTipWired) return;
      node._gttxTipWired = true;
      var toggle = function (on) { var sub = byClass(row, 'sub-heading'); if (sub) toggleClass(sub, cls('tip-open'), on); };
      hoverFocus(node, function () { toggle(true); }, function () { toggle(false); });
    }

    // A setting with more than one paragraph shows its first on the row; the rest opens in
    // a box from the ⓘ mark, the summary, or the setting's name.
    function tip(key) {
      var row = settingRow(o.id, key);
      var sub = row && byClass(row, 'sub-heading');
      if (!sub) return;
      var kids = sub.childNodes || [];
      if (kids.length && hasClass(kids[0], cls('sum'))) return;         // already ours
      var text = sub.textContent || '';
      var cut = text.indexOf('\n\n');
      if (cut === -1) {
        // One paragraph: nothing to hide, but a switch's value in it is drawn as one.
        SWITCH_VALUE.lastIndex = 0;
        if (!SWITCH_VALUE.test(text) || (kids.length && hasClass(kids[0], cls('one')))) return;
        sub.textContent = '';
        sub.appendChild(valueProse(el('span', cls('one')), tipText(text), true));
        return;
      }
      var summary = tipText(text.slice(0, cut));
      var detail = text.slice(cut + 2).split(/\n{2,}/).map(tipText).filter(function (p) { return !!p; }).join('\n\n');
      if (!summary || !detail) return;
      sub.textContent = '';
      toggleClass(sub, cls('tipped'), true);
      var sum = valueProse(el('span', cls('sum')), summary, true);
      sub.appendChild(sum);
      // tabIndex, so the box can be reached and read without a mouse. A sibling of the
      // mark rather than a child, which would inherit an inline span's clipping.
      var mark = el('span', cls('tip'), 'ⓘ');
      mark.tabIndex = 0;
      sub.appendChild(mark);
      sub.appendChild(valueProse(el('span', cls('tipbox')), detail, true));
      tipTrigger(mark, row);
      tipTrigger(sum, row);
      tipTrigger(row.querySelector ? row.querySelector('h3') : null, row);
    }

    function installedFromHeading(g) {
      var h3 = g && g.querySelector ? g.querySelector('h3') : null;
      var m = /\(([^()]+)\)$/.exec(headingText(h3).trim());
      return m ? m[1].trim() : null;
    }

    function stale(g) {
      var installed = installedFromHeading(g);
      var node = document.getElementById(cls('stale-notice'));
      ensureReloadUiButton(o.id, g, !!installed && installed !== o.version);
      // No parenthesised version on the heading means Settings → Tasks, which heads its
      // group with the bare name - not a mismatch, and nothing to say.
      if (!installed || installed === o.version) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
        return;
      }
      var sub = byClass(g, 'sub-heading');
      var parent = sub && sub.parentNode ? sub.parentNode : g;
      var before = sub && sub.parentNode ? sub : g.firstChild;
      if (node && node.parentNode === parent) return;
      if (node && node.parentNode) node.parentNode.removeChild(node);
      var box = el('div', cls('stale'), '⚠ This page is still running ' + o.shortName + ' ' + o.version + ', but ' +
        installed + ' is installed. Press Ctrl+Shift+R (⌘+Shift+R on a Mac) to reload it: your browser has cached ' +
        'the older script, and everything this plugin does until then is that older code.');
      box.id = cls('stale-notice');
      parent.insertBefore(box, before);
    }

    function readme(g) {
      if (document.getElementById(cls('readme-link'))) return;
      var link = el('a', cls('readme'), o.readmeLabel);
      link.id = cls('readme-link');
      link.href = o.readmeUrl;
      link.target = linkTarget();
      link.rel = 'noreferrer';
      link.title = 'Open this plugin\'s documentation for the version it was published at';
      link.style = 'display:inline-block;margin-top:.35rem;font-size:.8rem;';
      var sub = byClass(g, 'sub-heading');
      if (sub && sub.parentNode) { sub.parentNode.insertBefore(link, sub.nextSibling); return; }
      var header = byClass(g, 'setting');
      var box = header && header.childNodes && header.childNodes[0];
      (box || g).appendChild(link);
    }

    // Every tick, not only when something is missing: React re-renders this panel on any
    // settings change, and the class is what makes the paragraph breaks visible.
    function decorate(g) {
      if (!g) return;
      if (o.injectStyle) o.injectStyle();
      if (!hasClass(g, cls('own-group'))) toggleClass(g, cls('own-group'), true);
      split(g);
      collapse(g);          // after the split: it counts the paragraphs
      fold(g);
      keys.forEach(tip);
      stale(g);             // before the README link, which outlives it
      readme(g);
    }

    // A Stash that folds plugin groups folds only those with a setting or hook of their own in the
    // `.yml`; a plugin whose every setting is in a dialog got no chevron and stood open among
    // folded siblings. One with no settings at all has nothing to fold and gets none. Fold Every
    // ᝯㄝₓ Plugin's Settings (`a4bFoldGroups`) folds every group with settings, on any Stash. Such a group is given Stash's own chevron and click, folded to start as
    // theirs are - and only where some other group on the page folds, so a Stash that folds none
    // is left alone. The fold is a class on the group: React leaves a class it did not set.
    function fold(g) {
      var head = childByClass(g, 'setting'), section = childByClass(g, 'collapsible-section');
      if (!head || !section || document.getElementById(cls('fold'))) return;
      if (!childByClass(section, 'setting')) return;     // nothing to fold: a plugin with no settings at all
      if (hasClass(g, 'collapsible')) return;
      // Fired here, as `linkTarget` fires it: a page with no other reason to read Core's settings would
      // read the switch off forever. The fold comes on the tick after the read.
      if (!_settings && !_settingsInFlight) {
        try { loadSettings(false); } catch (e) { /* a settings read is never fatal */ }
      }
      // Its sibling plugin groups only: Settings → Tasks folds groups of its own (Scan, Generate) and
      // can be in the document too, which on 0.31 gave one plugin a chevron among unfolded groups.
      var groups = (g.parentNode && g.parentNode.childNodes) || [], folds = truthy(settings().a4bFoldGroups);
      for (var i = 0; i < groups.length && !folds; i++) folds = groups[i] !== g && hasClass(groups[i], 'collapsible');
      if (!folds) return;
      injectStyle();
      var btn = el('button', 'btn btn-minimal setting-group-collapse-button gttx-fold-btn');
      btn.id = cls('fold');
      btn.type = 'button';
      btn.innerHTML = CHEVRON_SVG;
      var set = function (folded) {
        toggleClass(g, 'gttx-folded', folded);
        btn.title = folded ? 'Show this plugin\'s settings' : 'Hide this plugin\'s settings';
      };
      btn.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        set(!hasClass(g, 'gttx-folded'));
      });
      // The heading's click as Stash's: anywhere on it but a button or a link.
      head.addEventListener('click', function (ev) {
        for (var t = ev && ev.target; t && t !== head; t = t.parentNode) {
          var n = String(t.nodeName || '').toLowerCase();
          if (n === 'button' || n === 'a') return;
        }
        set(!hasClass(g, 'gttx-folded'));
      });
      toggleClass(g, 'gttx-foldable', true);
      var right = head.childNodes && head.childNodes.length > 1 ? head.childNodes[head.childNodes.length - 1] : head;
      right.appendChild(btn);
      set(true);
    }

    return { group: group, decorate: decorate, tip: tip, installedFromHeading: installedFromHeading };
  }

  // Font Awesome's chevron-down, which Stash's own fold button draws; turned up while open.
  var CHEVRON_SVG = '<svg class="svg-inline--fa fa-fw" viewBox="0 0 512 512" aria-hidden="true" focusable="false" ' +
    'style="height:1em;"><path fill="currentColor" d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 ' +
    '12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"/></svg>';

  // The bulk-edit lease: a plugin writing across the library holds one, and the others'
  // reactions to its writes stand down until it is released or lapses.
  function lease(owner, label, ttl) {
    var c = coop();
    var ms = ttl || LEASE_TTL_MS;
    var held = { owner: owner, label: label, until: Date.now() + ms };
    c.leases.push(held);
    return {
      // Put back where a lapse swept it: a pass that stalled past the TTL - a slow server, a laptop
      // asleep - would otherwise run unleased to its end, and every sibling react to its writes.
      renew: function () {
        held.until = Date.now() + ms;
        if (c.leases.indexOf(held) === -1) c.leases.push(held);
      },
      release: function () { var i = c.leases.indexOf(held); if (i !== -1) c.leases.splice(i, 1); },
    };
  }

  // A live lease held by any plugin but `owner`, lapsed ones swept first; else null.
  function foreignLease(owner) {
    var c = coop();
    var now = Date.now();
    for (var i = c.leases.length - 1; i >= 0; i--) if (c.leases[i].until <= now) c.leases.splice(i, 1);
    for (var j = 0; j < c.leases.length; j++) if (c.leases[j].owner !== owner) return c.leases[j];
    return null;
  }

  // The version Stash has installed, read fresh - the manifest's, which can be newer than
  // the script this browser is running. Null when it cannot be read.
  function installedVersion(pluginId, opName) {
    return gqlRequest('query ' + opName + ' { plugins { id version } }', null).then(function (data) {
      var list = (data && data.plugins) || [];
      for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].id) === pluginId) return list[i].version || null;
      return null;
    }, function () { return null; });
  }

  // The `[<prefix> gate]` console channel Dev Mods' Log Button Visibility switch opens: `log`
  // every line, `once` a line only when it differs from the last on its channel.
  function gate(prefix) {
    var last = {};
    var on = function () { return !!coop().logButtonVisInfo; };
    return {
      log: function (line) { if (on()) console.info('[' + prefix + ' gate] ' + line); },
      once: function (channel, line) {
        if (!on()) { last = {}; return; }
        if (last[channel] === line) return;
        last[channel] = line;
        console.info('[' + prefix + ' gate] ' + line);
      },
    };
  }

  // A task button's caption if it is one of `tasks` in `pluginName`'s own group on Settings →
  // Tasks, else null. Answered from the button's own SettingGroup and no further: climbing
  // past it reaches the panel holding every plugin's group, whose first h3 is whichever
  // plugin is listed first - how a same-named task of another plugin was once hijacked. A
  // Stash that puts no `setting-group` on that box gets the any-ancestor walk, the behaviour
  // every release before the group check shipped.
  function ownTaskName(btn, pluginName, tasks) {
    var label = (btn.textContent || '').trim();
    if (tasks.indexOf(label) === -1) return null;
    var fallback = null;
    for (var node = btn, depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      var heading = node.querySelector ? node.querySelector('h3') : null;
      var ours = !!heading && (heading.textContent || '').trim() === pluginName;
      if (hasClass(node, 'setting-group')) return ours ? label : null;
      if (ours) fallback = label;
    }
    return fallback;
  }

  function paintButton(btn, variant) {
    if (hasClass(btn, variant)) return;                                  // already ours
    var c = String(btn.className || '').replace(BTN_VARIANTS, '');
    btn.className = c.replace(/\s+/g, ' ').trim() + ' ' + variant;
  }

  // Every task button of the plugin's own, painted `variantFor(caption)` - orange for a task
  // that writes, blue for one that only reads.
  function paintTaskButtons(pluginName, tasks, variantFor) {
    var nodes = document.querySelectorAll ? document.querySelectorAll('button') : [];
    for (var i = 0; i < nodes.length; i++) {
      var name = ownTaskName(nodes[i], pluginName, tasks);
      if (name) paintButton(nodes[i], variantFor(name));
    }
  }

  // Escape on a dialog clicks the button `pick(run)` names - by default whichever of Close
  // and Cancel is shown and enabled - and nothing else: mid-write, where both are hidden,
  // the key does nothing. Only the topmost of a plugin's dialogs answers, so a warning
  // opened over another closes alone. The listener is on `document`, since the modal is not
  // focusable. `prefix` names the plugin's `-hidden` and `-backdrop` classes.
  function wireEscape(run, prefix, pick) {
    var choose = pick || function (r) {
      var order = [r.closeBtn, r.cancelBtn];
      for (var i = 0; i < order.length; i++) {
        var b = order[i];
        if (b && !b.disabled && !hasClass(b, prefix + '-hidden')) return b;
      }
      return null;
    };
    run._onEscape = function (ev) {
      if (!ev || (ev.key !== 'Escape' && ev.keyCode !== 27)) return;
      if (run.backdrop && document.querySelectorAll) {
        var all = document.querySelectorAll('.' + prefix + '-backdrop');
        if (all.length && all[all.length - 1] !== run.backdrop) return;
      }
      var b = choose(run);
      if (!b) return;
      if (ev.preventDefault) ev.preventDefault();
      b.click();
    };
    document.addEventListener('keydown', run._onEscape);
  }

  function unwireEscape(run) {
    if (run._onEscape) document.removeEventListener('keydown', run._onEscape);
    run._onEscape = null;
  }

  // ── A run dialog's log ──────────────────────────────────────────────────────
  //
  // The log of a task dialog that plans and writes: `spin`, `log`, `scheduleFlush`,
  // `flush`, `disarmUndo` and `focus`, installed on the dialog's prototype. They read the
  // instance's `logEl`, `lines`, `pending`, `undoBtn` and `modal`, and `flush` ends in the
  // instance's own `renderProgress`. `prefix` names the classes each line carries, so the
  // plugin's own CSS styles them; `own` lists the methods a plugin keeps a copy of its own.
  // `linesDrawn` is exported beside it, for the progress line that says how much is shown, and
  // the spinner's frames and period, for a dialog that keeps a log of its own.
  // COMPAT: plugins before their busyCursor release draw their own cursor from these (since Core 5.1.0); remove when every plugin's floor is busyCursor.
  var RUN_SPIN_FRAMES = ['▙', '▛', '▜', '▟'];
  var RUN_SPIN_MS = 125;          // one four-frame cycle at 2Hz
  // **The busy cursor**: a `tag` with `cls` and `gttxcore-busy`, in the Busy Cursor style (or
  // `style`, a `BUSY_CURSORS` value) and the Highlighted Text Color, turning until it leaves the
  // page - so whoever drew it only has to take it out. `back` runs it the other way. Put it on
  // the page as it is made: a frame change finding it detached stops it.
  function busyCursor(tag, cls, back, style) {
    var c = busyStyle(style), node = el(tag, (cls ? cls + ' ' : '') + 'gttxcore-busy');
    if (!c[2]) {
      node.className += ' gttxcore-spinner' + (back ? ' gttxcore-spinner-back' : '');
      return node;
    }
    var f = c[2].split(''), i = 0;
    if (back) f.reverse();
    node.textContent = f[0];
    var t = setInterval(function () {
      if (node.isConnected === false || !node.parentNode) { clearInterval(t); return; }
      node.textContent = f[++i % f.length];
    }, c[3]);
    return node;
  }
  // The `BUSY_CURSORS` entry for `v`, the setting's where none is given; the default for any other.
  function busyStyle(v) {
    if (v == null) v = settings().a9cBusyCursor;
    for (var i = 0; i < BUSY_CURSORS.length; i++) if (BUSY_CURSORS[i][0] === v) return BUSY_CURSORS[i];
    return busyStyle(BUSY_DEFAULT);
  }
  var RUN_FLUSH_MS = 100;
  // How many lines a dialog draws at once - every plugin's log, listing and pick list - from UI
  // Customizations' Lines Drawn at Once, the rest kept in memory. Read at the moment it is used.
  // Read on first use, as `linkTarget` is: the first call answers the default while the read is in flight.
  function linesDrawn(s) {
    if (!s && !_settings && !_settingsInFlight) {
      try { loadSettings(false); } catch (e) { /* a settings read is never fatal */ }
    }
    var n = parseInt(String((s || settings()).a9bLinesDrawn), 10);
    if (!(n > 0)) return LINES_DRAWN_DEFAULT;
    return Math.max(100, Math.min(10000, n));
  }

  function runLog(proto, prefix, own) {
    var P = prefix;
    var methods = {
      // A cursor cycling under the last log line for as long as work is in flight, and
      // gone the moment it is not. A sibling of the lines rather than part of one, so it
      // survives a flush that appends under it - `flush` moves it back to the end - and
      // it carries no `-line` class, since it is not a log line and must not be read back
      // as one. The dialog's state is what says whether it runs.
      spin: function (on) {
        if (!on) {
          if (this.spinEl && this.spinEl.parentNode) this.spinEl.parentNode.removeChild(this.spinEl);
          this.spinEl = null;
          return;
        }
        if (!this.spinEl) this.spinEl = busyCursor('div', P + '-spin');
        this.logEl.appendChild(this.spinEl);
      },
      // `parts` is optional: a line passed as parts is rendered as spans, so each name can
      // carry its own tooltip. `lines` keeps the plain string either way - Copy log hands
      // over text, and a tooltip is not text.
      log: function (kind, message, parts) {
        var line = '[' + kind + '] ' + message;
        this.logged = (this.logged || 0) + 1;
        this.lines.push(line);
        // Bounded, because the copy buffer is what a library-wide pass grows without limit.
        this.logDropped = (this.logDropped || 0) + keepLog(this.lines);
        this.pending.push({ kind: kind, line: line, parts: parts || null });
        this.scheduleFlush();
      },
      scheduleFlush: function () {
        var self = this;
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(function () {
          self.flushTimer = null;
          self.flush();
        }, RUN_FLUSH_MS);
      },
      // Only the tail is rendered: a first run on a large library can plan six figures of
      // changes, and one node per change is a page that stops responding.
      flush: function () {
        if (!this.pending.length) return;
        var pending = this.pending;
        this.pending = [];
        // Out of the way while the lines land, so the cursor is neither counted against
        // the render cap nor left in the middle of the log.
        if (this.spinEl && this.spinEl.parentNode) this.logEl.removeChild(this.spinEl);
        pending.forEach(function (p) {
          var node = el('div', P + '-line ' + P + '-' + p.kind, p.parts ? null : p.line);
          // The line looks exactly like every other one: the spans exist to hang a title
          // on, and carry no styling of their own. An underline and a help cursor were
          // tried and read as decoration on a log that has none elsewhere.
          if (p.parts) {
            node.appendChild(el('span', null, '[' + p.kind + '] '));
            p.parts.forEach(function (seg) {
              var span;
              if (seg.href) {
                span = el('a', P + '-elink', seg.text);
                span.href = seg.href;
                span.target = linkTarget();
                span.rel = 'noopener noreferrer';
              } else {
                span = el('span', null, seg.text);
              }
              if (seg.title) span.title = seg.title;
              // A segment naming a tag opens the box with the tag's image above the same
              // text; one with no image of its own keeps the `title` it already had.
              if (seg.tip) tagTip(span, seg.tip, seg.title);
              // Anything else with a page of its own opens a card that says which one it is.
              if (seg.ent) entityTip(span, seg.ent.type, seg.ent.id);
              node.appendChild(span);
            });
          }
          this.logEl.appendChild(node);
        }, this);
        while (this.logEl.childNodes && this.logEl.childNodes.length > linesDrawn()) {
          this.logEl.removeChild(this.logEl.firstChild);
        }
        if (this.spinEl) this.logEl.appendChild(this.spinEl);
        if (typeof this.logEl.scrollHeight === 'number') this.logEl.scrollTop = this.logEl.scrollHeight;
        this.renderProgress();
      },
      disarmUndo: function () {
        if (this.undoTimer) { clearTimeout(this.undoTimer); this.undoTimer = null; }
        this.undoArmed = false;
        if (this.undoBtn) this.undoBtn.textContent = 'Undo';
      },
      focus: function () {
        if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
      },
    };
    for (var name in methods) {
      if (hasOwn(methods, name) && (own || []).indexOf(name) === -1) proto[name] = methods[name];
    }
  }

  // What an entity is called: its title or name, else its first file's name, else its folder's.
  function firstBasename(files) {
    return (files && files.length && files[0].basename) || '';
  }

  function displayName(ent) {
    return ent.title || ent.name || firstBasename(ent.files) || firstBasename(ent.visual_files) ||
      (ent.folder && ent.folder.basename) || null;
  }

  // A response for a request a plugin answers itself instead of sending.
  function fakeOk(payload) {
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Whether a mutation's response says it landed: an ok status and no `errors` in the body.
  // A body that cannot be read is taken as landed, as the status already said.
  function mutationSucceeded(p) {
    return p.then(function (resp) {
      if (!resp || !resp.ok) return false;
      var clone;
      try { clone = resp.clone(); } catch (e) { return true; }
      return clone.json().then(function (json) { return !json || !json.errors; }, function () { return true; });
    }, function () { return false; });
  }

  // ── The seven entity-types, and the text on them ──────────────────────────
  //
  // For a plugin that reads every text field of every entity-type - Entity Name
  // Maintainer's scan for an old name, Find Entities by Text Content's search. `fields` is
  // a list of *candidates*, not a promise: which of them the running Stash actually has is
  // settled by one introspection query (`describeFields`). A schema guessed wrong would
  // otherwise fail the whole query and report as "nothing found", which is the one
  // failure mode a search must not have.
  //
  //   nameField  the field a rename moves
  //   extra      the display fields that are not searchable text - a file's basename, a
  //              gallery's folder - so a hit can name an entity with no title
  //   mutation   the single-entity update, and `input` its input type; there is no bulk
  //              input carrying free text
  var ENTITY_TYPES = {
    scenes: {
      key: 'scenes', label: 'Scene', plural: 'Scenes', gqlType: 'Scene',
      find: 'findScenes', list: 'scenes', one: 'findScene', route: '/scenes/',
      mutation: 'sceneUpdate', input: 'SceneUpdateInput', nameField: 'title',
      extra: 'files { basename }',
      fields: ['title', 'code', 'details', 'director', 'urls', 'custom_fields'],
    },
    images: {
      key: 'images', label: 'Image', plural: 'Images', gqlType: 'Image',
      find: 'findImages', list: 'images', one: 'findImage', route: '/images/',
      mutation: 'imageUpdate', input: 'ImageUpdateInput', nameField: 'title',
      extra: 'visual_files { ... on ImageFile { basename } ... on VideoFile { basename } }',
      fields: ['title', 'code', 'details', 'photographer', 'urls', 'custom_fields'],
    },
    galleries: {
      key: 'galleries', label: 'Gallery', plural: 'Galleries', gqlType: 'Gallery',
      find: 'findGalleries', list: 'galleries', one: 'findGallery', route: '/galleries/',
      mutation: 'galleryUpdate', input: 'GalleryUpdateInput', nameField: 'title',
      extra: 'files { basename } folder { basename }',
      fields: ['title', 'code', 'details', 'photographer', 'urls', 'custom_fields'],
    },
    performers: {
      key: 'performers', label: 'Performer', plural: 'Performers', gqlType: 'Performer',
      find: 'findPerformers', list: 'performers', one: 'findPerformer', route: '/performers/',
      mutation: 'performerUpdate', input: 'PerformerUpdateInput', nameField: 'name',
      extra: '',
      fields: ['name', 'disambiguation', 'alias_list', 'details', 'urls', 'tattoos',
        'piercings', 'measurements', 'career_length', 'custom_fields'],
    },
    studios: {
      key: 'studios', label: 'Studio', plural: 'Studios', gqlType: 'Studio',
      find: 'findStudios', list: 'studios', one: 'findStudio', route: '/studios/',
      mutation: 'studioUpdate', input: 'StudioUpdateInput', nameField: 'name',
      extra: '',
      fields: ['name', 'aliases', 'details', 'urls', 'custom_fields'],
    },
    groups: {
      key: 'groups', label: 'Group', plural: 'Groups', gqlType: 'Group',
      find: 'findGroups', list: 'groups', one: 'findGroup', route: '/groups/',
      mutation: 'groupUpdate', input: 'GroupUpdateInput', nameField: 'name',
      extra: '',
      fields: ['name', 'aliases', 'synopsis', 'director', 'urls', 'custom_fields'],
    },
    tags: {
      key: 'tags', label: 'Tag', plural: 'Tags', gqlType: 'Tag',
      find: 'findTags', list: 'tags', one: 'findTag', route: '/tags/',
      mutation: 'tagUpdate', input: 'TagUpdateInput', nameField: 'name',
      extra: '',
      fields: ['name', 'aliases', 'description', 'custom_fields'],
    },
  };
  var ENTITY_ORDER = ['scenes', 'images', 'galleries', 'performers', 'studios', 'groups', 'tags'];

  // The label a filter row and a hit line both wear. One label per *concept*, shared
  // across types on purpose: Details means the same thing on a Scene and on a Performer,
  // and a user turning it off means both.
  var ENTITY_FIELD_LABEL = {
    title: 'Title', name: 'Name', code: 'Code', details: 'Details',
    description: 'Description', synopsis: 'Synopsis', director: 'Director',
    photographer: 'Photographer', urls: 'URLs', aliases: 'Aliases',
    alias_list: 'Aliases', disambiguation: 'Disambiguation', tattoos: 'Tattoos',
    piercings: 'Piercings', measurements: 'Measurements', career_length: 'Career length',
  };

  var MATCH_CONTEXT = 48;     // characters of surrounding text shown either side of a hit
  var MATCH_ELLIPSIS = '…';

  function unwrapType(t) {
    // NON_NULL and LIST wrappers carry the real type in `ofType`. `[String!]!` is four
    // deep - NON_NULL, LIST, NON_NULL, SCALAR - which is what the query has to ask for.
    var kind = null;
    while (t) {
      if (t.kind === 'LIST') kind = 'list';
      if (t.kind === 'SCALAR' || t.kind === 'OBJECT' || t.kind === 'ENUM') {
        return { kind: kind || (t.name === 'Map' ? 'map' : 'string'), name: t.name };
      }
      t = t.ofType;
    }
    return { kind: kind || 'string', name: null };
  }

  // One plugin's copy of the table, and the queries it sends. `op` is the prefix of every
  // operation name (`ENM`, `FRETC`), which is what the plugin's suites answer on. The
  // table is the caller's own copy, so a type a plugin adds to it is its alone. `request`
  // sends them, Core's `gqlRequest` by default: a plugin that wraps `fetch` passes the
  // one that marks a request as its own, so its wrapper does not read its own reads.
  // Returns { types, order, fieldLabel, introspect, describeFields, pageQuery, cachedFields }.
  function entityTypes(op, request) {
    var send = request || gqlRequest;
    var types = {};
    ENTITY_ORDER.forEach(function (k) {
      var spec = {}, p;
      for (p in ENTITY_TYPES[k]) if (hasOwn(ENTITY_TYPES[k], p)) spec[p] = ENTITY_TYPES[k][p];
      spec.fields = spec.fields.slice();
      types[k] = spec;
    });
    // Cached for the life of the page: the schema cannot change without a restart.
    var shapes = null;

    // One aliased `__type` query over the seven types: `typeProp` names the type in the
    // table (`gqlType` or `input`), `listProp` the list asked of it (`fields`, or
    // `inputFields` for an input type, which has no `fields`). Answers
    // `{typeKey: {fieldName: {kind, name}}}`.
    function introspect(typeProp, listProp, opName) {
      var parts = ENTITY_ORDER.map(function (k) {
        return k + ': __type(name: "' + types[k][typeProp] + '") { ' + listProp + ' { name type ' +
          '{ kind name ofType { kind name ofType { kind name ofType { kind name } } } } } }';
      });
      return send('query ' + opName + ' { ' + parts.join(' ') + ' }', null)
        .then(function (data) {
          var out = {};
          ENTITY_ORDER.forEach(function (k) {
            var known = {};
            ((data[k] || {})[listProp] || []).forEach(function (f) { known[f.name] = unwrapType(f.type); });
            out[k] = known;
          });
          return out;
        });
    }

    // Per type, the candidate fields this Stash has as text: `[{name, kind}]`, kind
    // `string`, `list` or `map`.
    function describeFields() {
      if (shapes) return Promise.resolve(shapes);
      return introspect('gqlType', 'fields', op + '_Shapes').then(function (known) {
        var out = {};
        ENTITY_ORDER.forEach(function (k) {
          var keep = [];
          types[k].fields.forEach(function (name) {
            if (!hasOwn(known[k], name)) return;
            var shape = known[k][name];
            // A String scalar, a list of them, or the custom-field Map. Anything else
            // wearing a name asked for - a date, a number, an object - is not text.
            if (name === 'custom_fields') {
              if (shape.name === 'Map') keep.push({ name: name, kind: 'map' });
              return;
            }
            if (shape.name !== 'String') return;
            keep.push({ name: name, kind: shape.kind === 'list' ? 'list' : 'string' });
          });
          out[k] = keep;
        });
        shapes = out;
        return out;
      });
    }

    function pageQuery(spec, fieldShapes) {
      var sel = ['id'];
      fieldShapes.forEach(function (f) { sel.push(f.name); });
      // `extra` holds only the display fields that are *not* in the table, so nothing is
      // ever selected twice - which GraphQL refuses outright.
      if (spec.extra) sel.push(spec.extra);
      return 'query ' + op + '_Scan($f: FindFilterType) { ' + spec.find + '(filter: $f) { count ' +
        spec.list + ' { ' + sel.join(' ') + ' } } }';
    }

    return {
      types: types, order: ENTITY_ORDER.slice(), fieldLabel: ENTITY_FIELD_LABEL,
      introspect: introspect, describeFields: describeFields, pageQuery: pageQuery,
      // What `describeFields` last answered, for a write that follows a scan.
      cachedFields: function () { return shapes; },
    };
  }

  // Where `needle` occurs in `text`, as offsets. Case is folded by `fold`, which keeps the
  // length - but **a field whose fold still changes length is refused rather than
  // searched**: an offset into the folded string would not point at the same character in
  // the original, and everything downstream slices the *original* at those offsets - the
  // context on a hit line, and the splice a replacement writes back. A refused field comes
  // back empty and marked `refused`. `cased` compares the text as it is, which folds
  // nothing and so refuses nothing.
  function occurrences(text, needle, cased) {
    var out = [];
    if (!needle) return out;
    var raw = String(text);
    var hay = cased ? raw : fold(raw);
    if (hay.length !== raw.length) { out.refused = true; return out; }
    var n = cased ? String(needle) : fold(needle);
    var i = 0;
    while ((i = hay.indexOf(n, i)) !== -1) {
      out.push(i);
      i += n.length;
    }
    return out;
  }

  // The three pieces a hit line is drawn from. Whitespace is collapsed but nothing
  // trimmed: a details field is prose with newlines in it, a line is one line, and the
  // space either side of a match is part of what the line shows.
  function matchContext(text, at, len) {
    var flat = function (t) { return t.replace(/\s+/g, ' '); };
    var s = String(text);
    var from = Math.max(0, at - MATCH_CONTEXT);
    var to = Math.min(s.length, at + len + MATCH_CONTEXT);
    return {
      pre: (from > 0 ? MATCH_ELLIPSIS : '') + flat(s.slice(from, at)),
      hit: flat(s.slice(at, at + len)),
      post: flat(s.slice(at + len, to)) + (to < s.length ? MATCH_ELLIPSIS : ''),
    };
  }

  // ── The export other plugins bind ─────────────────────────────────────────
  //
  // One object, replaced outright by a newer evaluation. Callers bind the functions they
  // want at load - `ui: requires:` guarantees this script has finished by then - so a
  // call site reads exactly as it did when the block was local.
  //
  // `version` is a floor for a log line rather than a handshake, the same rule
  // `coop().api` follows: a caller feature-detects what it needs and names this number
  // when something is missing.
  var api = {
    version: PLUGIN_VERSION,
    hasOwn: hasOwn, hasClass: hasClass, el: el, stripEllipsis: stripEllipsis,
    pickControl: pickControl,
    byClass: byClass, gqlRequest: gqlRequest, pluginConfig: pluginConfig, settingElement: settingElement,
    settingRow: settingRow, coopObject: coopObject, coop: coop, settle: settle, settled: settled, settleWho: true, waitingOn: waitingOn,
    domBus: domBus, plural: plural, copyToClipboard: copyToClipboard,
    keepLog: keepLog, droppedLine: droppedLine, logKeep: logKeep,
    splitTerms: splitTerms, nameMatchesAny: nameMatchesAny,
    linkTarget: linkTarget, caseSensitive: caseSensitive, fold: fold, holdWidth: holdWidth, fieldLocks: fieldLocks,
    tagTipImage: tagTipImage, tipBox: tipBox, tipPlace: tipPlace, tipRatingBadge: tipRatingBadge,
    tipOpen: tipOpen, tipClose: tipClose, tagTip: tagTip,
    tipText: tipText, tagTipNames: tagTipNames, tagLinkTitle: tagLinkTitle,
    tagHasDetail: tagHasDetail, tagTooltip: tagTooltip, lowerId: lowerId, partsText: partsText,
    entityTipStars: entityTipStars, entityTipName: entityTipName, entityTipCountry: entityTipCountry,
    entityTipGender: entityTipGender, entityTipLines: entityTipLines, entityTipDetail: entityTipDetail,
    entityTip: entityTip, cfTipCarriers: cfTipCarriers, cfTipTitle: cfTipTitle,
    cfTipLoad: cfTipLoad, cfTipPlace: cfTipPlace, cfTipOpen: cfTipOpen,
    cfTipArm: cfTipArm, cfTipTick: cfTipTick, cfTipMark: cfTipMark, anyStale: anyStale,
    reloadUiAnchor: reloadUiAnchor, ensureReloadUiButton: ensureReloadUiButton, staleReloadButton: staleReloadButton,
    computedStyleOf: computedStyleOf, findActionByLabel: findActionByLabel, borderingAction: borderingAction,
    pxOf: pxOf, sideMargin: sideMargin, neighbourGap: neighbourGap,
    nonZeroLength: nonZeroLength, stashButtonMargins: stashButtonMargins, fillNeighbourGaps: fillNeighbourGaps,
    ensureRowSpacing: ensureRowSpacing, applyButtonSpacing: applyButtonSpacing, insertOrdered: insertOrdered,
    insertBeforeImportantAction: insertBeforeImportantAction, findEditContainer: findEditContainer,
    showDefaults: showDefaults,
    settingsPage: settingsPage, settingsDialog: settingsDialog, fieldHeading: fieldHeading, tagMark: tagMark, tagGlyph: tagGlyph, valueProse: valueProse, drawSummary: drawSummary, settingButton: settingButton, levelOf: levelOf, parentLevel: parentLevel, atLevel: atLevel, markLevel: markLevel, levelRow: levelRow, LEVEL_COLOR: LEVEL_COLOR, afterDescription: afterDescription, logsToConsole: logsToConsole, lease: lease, foreignLease: foreignLease, installedVersion: installedVersion,
    gate: gate, ownTaskName: ownTaskName, paintButton: paintButton, paintTaskButtons: paintTaskButtons,
    wireEscape: wireEscape, unwireEscape: unwireEscape, firstBasename: firstBasename, displayName: displayName,
    fakeOk: fakeOk, mutationSucceeded: mutationSucceeded, writePluginSettings: writePluginSettings, button: button,
    runLog: runLog, linesDrawn: function () { return linesDrawn(); }, runSpinFrames: RUN_SPIN_FRAMES, runSpinMs: RUN_SPIN_MS,
    busyCursor: busyCursor,
    entityTypes: entityTypes, occurrences: occurrences, matchContext: matchContext,
  };
  ns.core = api;
  // The surface this plugin's own suite drives, beside the one its callers bind. Separate
  // because they answer different questions: `core` is the contract eight plugins depend
  // on, this is the inside of the two features that are only this plugin's.
  ns.gttxcore = {
    busySwing: busySwing, busyPhase: busyPhase,
    durationBand: durationBand, durationTick: durationTick, durationClear: durationClear,
    selectPasteTick: selectPasteTick,
    glossary: function () { return (window.__GTTx__ || {}).glossary || null; }, glossaryFind: glossaryFind, glossaryMark: glossaryMark,
    glossaryTick: glossaryTick,
    headCountTick: headCountTick, headCountTargets: headCountTargets, headCountClear: headCountClear,
    parseDevMods: parseDevMods, formatDevMods: formatDevMods, applyDevMods: applyDevMods,
    devMods: DEV_MODS, openDevMods: openDevMods, openJournalSettings: openJournalSettings, openGlobals: openGlobals,
    journalSummary: journalSummary, globalsSummary: globalsSummary, tick: tick,
    settings: function () { return settings(); },
    // Forced, because the tick only reads them when the page shows something that
    // depends on the answer - which a suite driving the dialog directly does not.
    load: function () { return loadSettings(true); },
    // For a suite that changes the stored map behind the page's back.
    configChanged: configChanged,
  };
  if (_previous) {
    log('[gttxcore] replacing the ' + (_previous.version || 'unknown') +
      ' evaluation already on this page.');
  }

  coop();          // bring the shared object into its full shape whoever loads first

  // Replaced outright, like the export: a newer evaluation's closures are the ones called.
  coop().journal = {
    record: journalRecord, runs: journalRuns, entries: journalEntries,
    stats: journalStats, clear: journalClear,
    plan: journalPlan, undo: journalUndo, remove: journalRemove, open: openHistory, fromInputs: journalFromInputs,
    pass: journalPass, reversesFields: true,
    exportAll: journalExport, importTexts: journalImport,
  };
  installJournalCapture();
  showDefaults(PLUGIN_ID, seedValues);

  var _timer = null;
  function start() {
    if (_timer) clearInterval(_timer);
    _timer = setInterval(tick, TICK_MS);
    var bus = domBus();
    if (bus && bus.subscribe) bus.subscribe(onMutation);
    tick();
  }

  var _pending = null;
  function onMutation() {
    if (_pending) return;
    _pending = setTimeout(function () { _pending = null; tick(); }, OBSERVE_MS);
  }

  // Compiled at load where the table is already here, and otherwise by the first tick that
  // finds it - either way as part of the page, not by whichever dialog first shows a term.
  // Run once over nothing as well: V8 compiles a pattern's code the first time it runs, not
  // when the RegExp is made, and that code stays with the page. Left to the first dialog to
  // run them, it was counted as what that dialog kept after closing.
  glossaryFind('', {});
  document.addEventListener('click', glossaryOutsideTap);
  window.addEventListener('load', function () { installCardCounts(); start(); });
  window.addEventListener('popstate', tick);
  installCardCounts();
  watchOtherTabs();
  start();
}());
