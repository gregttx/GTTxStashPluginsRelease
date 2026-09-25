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
  var PLUGIN_VERSION = '3.3.0';
  var README_URL = 'https://github.com/gregttx/GTTxStashPluginsRelease/blob/main/GTTxCore/README.md';
  var README_LINK_ID = 'gttxcore-readme-link';
  var DESC_TOGGLE_ID = 'gttxcore-desc-toggle';
  var STALE_ID = 'gttxcore-stale-notice';
  var STYLE_ID = 'gttxcore-style';
  // Amber for a control of ours that writes, teal for one that only reads. Nothing in
  // this plugin writes to the library at all, so every control it draws is teal.
  var PLUGIN_BTN_VARIANT = 'btn-info';
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


  function coopObject() {
    var ns = window.__GTTx__;
    if (!ns || typeof ns !== 'object') ns = window.__GTTx__ = {};
    var c = ns.StashPluginCoop || window.StashPluginCoop;
    if (!c || typeof c !== 'object') c = {};
    ns.StashPluginCoop = c;
    if (window.StashPluginCoop !== c) window.StashPluginCoop = c;
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
  function settle(type, id) {
    var c = coop(), key = type + ':' + id;
    var entry = {};
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
      var key = type + ':' + id, list = c.settling[key] || [];
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
    return '[' + (kind || 'INFO') + '] The first ' + dropped + ' lines of this log are not ' +
      'kept, so this copy begins after them. The last ' + logKeep() + ' are here - ' +
      'ᝯㄝₓ Core\'s Maximum Log Lines Kept setting says how many.';
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
    node.addEventListener('mouseenter', open);
    node.addEventListener('mouseleave', shut);
    node.addEventListener('focus', open);
    node.addEventListener('blur', shut);
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
  // plugins, like the CSS; `tests/style.test.js` pins them.
  // Shared by the tag tooltip and the custom-field mark: both are about a native
  // `title`, which is why neither this nor `tipText` wears a `tag` in its name.
  var TIP_DESC_CHARS = 240;   // characters of a description an excerpt carries
  var TAG_TIP_NAMES = 8;      // names listed before the rest become a count

  function tipText(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/^ | $/g, '');
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
  // `tests/style.test.js` pins it.
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
      text: function (o, id) {
        return entityTipLines('Scene', entityTipName(o), id, [
          ['Date', o.date], ['Studio', (o.studio || {}).name],
          ['Performers', tagTipNames(o.performers)], ['Tags', tagTipNames(o.tags)],
          ['Rating', entityTipStars(o.rating100)],
          ['Organized', o.organized ? 'yes' : null]]);
      },
    },
    images: {
      one: 'findImage',
      fields: 'title date rating100 organized studio { name } performers { name } ' +
        'tags { name } visual_files { ... on ImageFile { basename } ' +
        '... on VideoFile { basename } } paths { thumbnail }',
      img: function (o) { return (o.paths || {}).thumbnail; },
      text: function (o, id) {
        return entityTipLines('Image', entityTipName(o), id, [
          ['Date', o.date], ['Studio', (o.studio || {}).name],
          ['Performers', tagTipNames(o.performers)], ['Tags', tagTipNames(o.tags)],
          ['Rating', entityTipStars(o.rating100)],
          ['Organized', o.organized ? 'yes' : null]]);
      },
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
            ['Favourite', o.favorite ? 'yes' : null],
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
          ['Favourite', o.favorite ? 'yes' : null], ['Tags', tagTipNames(o.tags)]]);
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
    node.addEventListener('mouseenter', open);
    node.addEventListener('mouseleave', shut);
    node.addEventListener('focus', open);
    node.addEventListener('blur', shut);
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
  // stays byte-identical in all five - pinned by `tests/style.test.js`, like the CSS.
  //
  // **Ten carriers in total, not ten per type.** Seventy names in a native `title` is a
  // wall nobody reads, and the count says the rest. Each is named with its type, because
  // "Beach day" alone does not say what it is.
  var CF_TIP_HITS = 10;      // carriers named before the rest become a count
  var CF_TIP_MARK = 'ⓘ';     // circled Latin small letter i

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
    var cls = String(node.className || '').replace(/\s*gttx-cftip-open\b/, '');
    node.className = (on ? cls + ' gttx-cftip-open' : cls).replace(/^\s+/, '');
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
      node.addEventListener('mouseenter', function () { cfTipLoad(node); cfTipOpen(node, true); });
      node.addEventListener('mouseleave', function () { cfTipOpen(node, false); });
      node.addEventListener('focus', function () { cfTipLoad(node); cfTipOpen(node, true); });
      node.addEventListener('blur', function () { cfTipOpen(node, false); });
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
    if (row) {
      var on = named && list.length > 0;
      var cls = String(row.className || '').replace(/\s*gttx-cflisted\b/, '');
      row.className = (on ? cls + ' gttx-cflisted' : cls).replace(/^\s+/, '');
    }
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
  // plugin's own dialog, or a summary line it draws - and only where Custom Fields Bulk
  // Editor holds a description of it, since that is what the box is for there. Resolves
  // to the node to place after the name, or null: no field, no Custom Fields Bulk
  // Editor, no description, or a read that failed.
  function cfTipMark(field) {
    var api = coop().api && coop().api.CustomFieldsBulkEditor;
    if (!field || !api || typeof api.descriptions !== 'function') return Promise.resolve(null);
    return api.descriptions().then(function (d) {
      if (!d || !tipText(d[field])) return null;
      injectStyle();
      var node = cfTipShell(el('span', 'gttx-cftipped gttx-cfinline'));
      node._gttxCfField = field;
      node._gttxCfBox.textContent = 'Custom field "' + field + '"';
      cfTipArm(node, null);
      return node;
    }, function () { return null; });
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
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-danger btn-sm';
    b.textContent = 'Reload UI';
    b.title = RELOAD_UI_TIP;
    b.style = 'margin-left:.6rem;';
    b.addEventListener('click', function () {
      if (window.location && window.location.reload) window.location.reload();
    });
    box.appendChild(b);
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
    var m = coop().staleUI || {}, k;
    for (k in m) if (Object.prototype.hasOwnProperty.call(m, k) && m[k]) return true;
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
    var c = coop();
    if (!c.staleUI) c.staleUI = {};
    c.staleUI[pluginId] = !!stale;
    var node = document.getElementById(RELOAD_UI_ID);
    var anchor = anyStale() ? reloadUiAnchor(group) : null;
    if (!anchor) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      return;
    }
    if (node && node.parentNode === anchor.parentNode) return;
    if (node && node.parentNode) node.parentNode.removeChild(node);
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-danger';
    b.textContent = 'Reload UI';
    b.id = RELOAD_UI_ID;
    b.title = RELOAD_UI_TIP;
    // `margin-left:auto` rather than a class: the row is `justify-content-between`, so
    // a third child would otherwise sit alone in the middle of it. This puts our
    // button and Stash's together at the right, with the filter box still at the left.
    b.style = 'margin-left:auto;margin-right:.5rem;';
    b.addEventListener('click', function () {
      if (window.location && window.location.reload) window.location.reload();
    });
    anchor.parentNode.insertBefore(b, anchor);
  }


  function computedStyleOf(node) {
    var w = (typeof window !== 'undefined') ? window : null;
    if (!w || typeof w.getComputedStyle !== 'function' || !node) return null;
    try { return w.getComputedStyle(node) || null; } catch (e) { return null; }
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
  // other result fields, in the same weight and colour as everything beside it - and it
  // is the one line on that card that decides whether a match is the right file. Read off
  // `ui/v2.5/src/components/Tagger/scenes/StashSearchResult.tsx`: `getDurationStatus`
  // returns a wrapped, bolded, icon-carrying element when the duration *matches*, and a
  // **bare `FormattedMessage`** when it does not - so the failing case is the one with no
  // element and no class of its own to style.
  //
  // Off by default, because it changes a page this plugin does not own.
  var DUR_RE = /Duration off by at least (\d+)s/;
  var DUR_CLASS = 'gttx-durwarn';

  // Red past five seconds, amber above one. Both bands are the user's, and the upper one
  // is where Stash's own threshold already sits: `getDurationStatus` takes the match
  // branch as soon as any fingerprint is within 5s, so in practice a printed number below
  // 5 is rare and 5 itself is the amber band's whole population. Stated as asked rather
  // than narrowed to what today's Stash can produce - the bands are about the seconds,
  // not about which branch printed them.
  function durationBand(n) {
    if (!(n >= 0)) return null;
    if (n > 5) return 'red';
    if (n > 1) return 'amber';
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
  // Three switches that change no behaviour of their own: each one sets a flag on the
  // shared object that the other plugins already read, or that this one does. They are a
  // *setting* rather than a console incantation because the console line was the thing
  // nobody could remember - but they are all off by default and none of them is meant to
  // be left on.
  //
  // Stored as one string in one key, the shape `NormalizeParentTags` settled on for its
  // own modes: parsing forgives - any order, any spacing, unknown names carried through
  // untouched - and formatting is strict.
  var DEV_MODS = [
    { key: 'DEBUG', flag: 'debugMode', label: 'Debug mode',
      help: 'Turns on the [<prefix> gate] console channel in every ᝯㄝₓ plugin that ' +
        'draws a control into Stash’s own rows, explaining for each one whether it ' +
        'is shown or hidden and why. Read at call time, so it takes effect on the next ' +
        'tick. This is what __GTTx__.StashPluginCoop.debugMode does from the console.' },
    { key: 'LAYOUT', flag: 'layoutEdit', label: 'Layout edit mode',
      help: 'Outlines every control these plugins have injected into Stash’s own ' +
        'chrome and labels it with the plugin that put it there. For working out which ' +
        'plugin owns a button in a row that holds several.' },
    { key: 'STALEDEMO', flag: 'staleDemo', label: 'Stale UI demo',
      help: 'Pretends a plugin’s script is out of date, so the red Reload UI button ' +
        'appears beside Stash’s own Reload plugins without waiting for a real ' +
        'mismatch. Nothing else changes, and no plugin’s own banner is affected.' },
  ];

  function parseDevMods(raw) {
    var out = {};
    DEV_MODS.forEach(function (m) { out[m.key] = false; });
    String(raw == null ? '' : raw).split(',').forEach(function (piece) {
      var bits = piece.split('=');
      if (bits.length !== 2) return;
      var k = bits[0].replace(/\s+/g, '').toUpperCase();
      if (hasOwn(out, k)) out[k] = bits[1].replace(/\s+/g, '').toUpperCase() === 'ON';
    });
    return out;
  }

  function formatDevMods(state) {
    return DEV_MODS.map(function (m) {
      return m.key + '=' + (state[m.key] ? 'ON' : 'OFF');
    }).join(', ');
  }

  // **`debugMode`, and `debugButtons` still answers.** The flag was named for the buttons
  // and long ago stopped being only about them; renaming it is what this switch is for.
  // The old name is still read, because it is the one people have written down, and still
  // written, because a console that sets it must go on working.
  function applyDevMods(state) {
    var c = coop();
    c.debugMode = !!state.DEBUG;
    c.debugButtons = !!state.DEBUG;
    c.layoutEdit = !!state.LAYOUT;
    if (!c.staleUI) c.staleUI = {};
    // A key in the same map every plugin's `anyStale` already scans, so the demo needs no
    // plugin to know about it: one entry that is not a plugin id, cleared when it is off.
    if (state.STALEDEMO) c.staleUI.demo = true;
    else delete c.staleUI.demo;
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
        marked[i].className = marked[i].className.replace(/\s*gttx-layoutmark/g, '');
      }
    }
    if (!on || !document.querySelectorAll) return;
    injectStyle();     // the same reason: nothing else on this page draws ours
    var all = document.querySelectorAll('button, a, span, div');
    for (var k = 0; k < all.length; k++) {
      var owner = all[k]._coopOwner;
      if (!owner || all[k].getAttribute('data-gttx-owner')) continue;
      all[k].setAttribute('data-gttx-owner', owner);
      if (!hasClass(all[k], 'gttx-layoutmark')) all[k].className += ' gttx-layoutmark';
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
    if (!on) {
      root.className = root.className.replace(/\s*gttx-selectpaste/g, '');
      return;
    }
    injectStyle();     // nothing else on a Scene edit page draws ours
    root.className += ' ' + PASTE_CLASS;
  }

  // ── The counts on the Tags, Performers and Custom Fields headings ─────────
  //
  // "Tags" above a tag list says nothing about how long the list is, and on a scene
  // carrying forty the number is what is worth knowing before reading them. With the
  // one setting on, the heading reads `Tags (40)`: Stash's own word, the count in
  // brackets after it, on the details view and the edit form of every entity that has
  // one - and the same for `Performers (3)` and `Custom Fields (5)`.
  //
  // Three shapes, read off Stash's source (docs/stash-reference.md):
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
    var d = String(s.c1JournalKeepDays == null ? '' : s.c1JournalKeepDays).replace(/^\s+|\s+$/g, '');
    var days = /^(forever|0)$/i.test(d) ? 0 : parseInt(d, 10);
    if (days !== 0) days = isNaN(days) ? JOURNAL_KEEP_DAYS : Math.max(1, Math.min(999, days));
    var mb = parseInt(s.c2JournalSizeMB, 10);
    mb = isNaN(mb) ? JOURNAL_SIZE_MB : Math.max(16, Math.min(4096, mb));
    return { days: days, bytes: mb * 1048576, imageRuns: truthy(s.c5JournalImageRuns),
      since: truthy(s.c3JournalSinceBackup) ? journalBackupAt() : 0 };
  }

  // When this browser last saw a backup finish, or 0. Per browser, like the journal.
  var JOURNAL_BACKUP_KEY = 'gttx-journal-backup';
  function journalBackupAt() {
    try { return parseInt(window.localStorage.getItem(JOURNAL_BACKUP_KEY), 10) || 0; } catch (e) { return 0; }
  }
  function journalSawBackup(at) {
    try { window.localStorage.setItem(JOURNAL_BACKUP_KEY, String(at)); } catch (e) { /* per page, then */ }
  }

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

  function journalHead(run) {
    var at = Date.now();
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
    // A custom field that was, or is, not there at all - distinct from one holding null.
    if (x.before === undefined && x.action !== 'create') row.beforeAbsent = true;
    if (x.after === undefined && x.action !== 'create') row.afterAbsent = true;
    row.bytes = JSON.stringify(row).length;
    return row;
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
    return journalDb().then(function (db) {
      var tx = db.transaction(['runs', 'entries'], 'readwrite');
      tx.objectStore('runs').put(head);
      var store = tx.objectStore('entries');
      rows.forEach(function (r) { store.put(r); });
      return idbDone(tx);
    }).then(function () {
      journalChanged();
      journalProtect();
      return journalTrim();
    }).then(function () { return { recorded: rows.length, run: id, bytes: bytes }; });
  }

  function journalRunsOf(db) {
    return idbRequest(db.transaction('runs').objectStore('runs').getAll());
  }

  // Oldest first, while a run is past the age limit, older than the last backup where
  // only what came after it is kept, or the whole is past the size limit. An imported run
  // is kept past the age limit: it was brought back on purpose, to be undone.
  function journalTrim() {
    var limits = journalLimits(), cutoff = Date.now() - limits.days * DAY_MS;
    return journalDb().then(function (db) {
      return journalRunsOf(db).then(function (runs) {
        runs.sort(journalOrder);
        var total = 0, drop = [];
        runs.forEach(function (r) { total += r.bytes; });
        for (var i = 0; i < runs.length; i++) {
          var old = limits.days && runs[i].at < cutoff && !runs[i].imported;
          if (!old && !(limits.since && runs[i].at < limits.since) && total <= limits.bytes) break;
          drop.push(runs[i].id);
          total -= runs[i].bytes;
        }
        return drop.length ? journalDropRuns(db, drop) : 0;
      });
    });
  }

  function journalDropRuns(db, ids) {
    var tx = db.transaction(['runs', 'entries'], 'readwrite');
    var runs = tx.objectStore('runs'), entries = tx.objectStore('entries');
    ids.forEach(function (id) {
      runs.delete(id);
      var keys = entries.index('run').getAllKeys(id);
      keys.onsuccess = function () { keys.result.forEach(function (k) { entries.delete(k); }); };
    });
    return idbDone(tx).then(function () { journalChanged(); return ids.length; });
  }

  // Takes whole runs and single changes out of the history; nothing in the library changes.
  // A run left with no changes goes with them, and one left with some is recounted.
  function journalRemove(runIds, entries) {
    return journalDb().then(function (db) {
      var tx = db.transaction(['runs', 'entries'], 'readwrite');
      var runs = tx.objectStore('runs'), store = tx.objectStore('entries'), touched = {};
      runIds.forEach(function (id) {
        runs.delete(id);
        var keys = store.index('run').getAllKeys(id);
        keys.onsuccess = function () { keys.result.forEach(function (k) { store.delete(k); }); };
      });
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
  var _journalChannel = null;
  function journalChanged() {
    try {
      if (!_journalChannel && typeof window.BroadcastChannel === 'function') {
        _journalChannel = new window.BroadcastChannel(JOURNAL_DB);
      }
      if (_journalChannel) _journalChannel.postMessage({ changed: Date.now() });
    } catch (e) { /* another tab catches up on its next open */ }
  }

  // ── Undo History: the entity types, and reading a field the way it is written ──
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
  };

  var JOURNAL_RELATIONS = { tag_ids: 'tags', performer_ids: 'performers', gallery_ids: 'galleries',
    scene_ids: 'scenes', parent_ids: 'parents', child_ids: 'children' };
  var JOURNAL_SCALARS = ['title', 'code', 'details', 'director', 'date', 'rating100', 'organized',
    'name', 'disambiguation', 'gender', 'birthdate', 'death_date', 'country', 'ethnicity',
    'eye_color', 'hair_color', 'height_cm', 'weight', 'measurements', 'fake_tits',
    'penis_length', 'circumcised', 'career_length', 'tattoos', 'piercings', 'favorite',
    'ignore_auto_tag', 'description', 'sort_name', 'duration', 'photographer', 'urls',
    'alias_list', 'aliases'];

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
  // and marks them undone there. So a plugin keeps nothing extra for it: keeping each
  // forward input on the dialog's Undo list cost hundreds of megabytes on a large pass.
  // `drain()` resolves once everything handed over so far is written, for a caller that
  // feeds a large pass in slices.
  var JOURNAL_CHUNK = 2000;
  function journalPass(run) {
    var buf = [], skipped = [], head = journalHead(run), n = 0, over = false, failed = null;
    var written = false, reversals = {};
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
        return journalDb().then(function (db) {
          var tx = db.transaction(['runs', 'entries'], 'readwrite');
          tx.objectStore('runs').put(head);
          var store = tx.objectStore('entries');
          rows.forEach(function (r) { store.put(r); });
          return idbDone(tx);
        });
      }).then(null, function (e) { failed = e; });
      return chain;
    };
    var push = function (list) {
      for (var i = 0; i < list.length; i++) buf.push(list[i]);
      if (buf.length >= JOURNAL_CHUNK) flush();
    };
    // Each earlier pass named in `reverse`, read back, its entities' entries swapped and
    // handed over, and the originals marked undone by this run.
    var reverseAll = function () {
      var runs = Object.keys(reversals);
      reversals = {};
      return runs.reduce(function (p, runId) {
        var keys = runs.length && reversalsOf[runId];
        return p.then(function () {
          return journalEntries(runId).then(function (entries) {
            var mine = entries.filter(function (e) { return keys[e.entity] && !e.undone; });
            push(mine.map(function (e) {
              return { type: e.type, id: e.eid, name: e.name, field: e.field, folder: e.folder,
                action: e.action === 'create' ? 'delete' : e.action,
                before: e.afterAbsent ? undefined : e.after, after: e.beforeAbsent ? undefined : e.before,
                undoes: e.id };
            }));
            return flush().then(function () {
              if (!over && !failed && mine.length) return journalMark(mine, head.id);
              return null;
            });
          });
        });
      }, Promise.resolve());
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
      reverse: function (runId, type, id) {
        if (!runId) return;
        reversals[runId] = true;
        (reversalsOf[runId] = reversalsOf[runId] || {})[type + ':' + id] = true;
      },
      drain: function () { return window.indexedDB ? flush() : Promise.resolve(); },
      finish: function () {
        // A browser with no IndexedDB has no history to add to, so there is nothing to say.
        if (!window.indexedDB) { buf = []; return Promise.resolve(''); }
        return flush().then(reverseAll).then(function () {
          if (failed) return 'Not recorded in Undo History: ' + (failed.message || String(failed)) + '.';
          if (over) {
            var dropped = head ? journalDb().then(function (db) { return journalDropRuns(db, [head.id]); }) : Promise.resolve();
            return dropped.then(function () {
              return 'Not recorded in Undo History: this pass is more than half its size limit. ' +
                'Its Undo here still works while this dialog is open.';
            });
          }
          if (!written) return '';
          journalChanged();
          journalProtect();
          return journalTrim().then(function () {
            return 'Recorded in Undo History: ' + plural(head.count, 'change') +
              (head.note ? ' (' + head.note + ')' : '') + '.';
          });
        }).then(null, function (e) {
          return 'Not recorded in Undo History: ' + (e && e.message ? e.message : String(e)) + '.';
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
  function journalCapture(send, input, init) {
    var saves = journalSaves(init);
    if (!saves.length) return send(input, init);
    var removal = saves.some(function (sv) { return sv.spec.mode === 'destroy' || sv.spec.mode === 'merge'; });
    return loadSettings(false).then(function (s) {
      return truthy(s.c4JournalHandEdits) && (!removal || truthy(s.c7JournalDeletes));
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
            note: sv.skipped.length ? 'not recorded: ' + sv.skipped.join(', ') : '' }, lists[i]);
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
        ids.map(function (id) { return { type: sv.type, id: id, action: 'gap' }; }));
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
      ['groups', 'findGroups', 'group_filter', 'tags', 'tag_ids'], ['studios', 'findStudios', 'studio_filter', 'tags', 'tag_ids']],
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
            journalRecord({ source: 'hand', label: journalLabel(sv) }, gone);
          });
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
      var before = into ? into.carriers || {} : {};
      return Object.keys(e.carriers || {}).reduce(function (p, key) {
        return p.then(function () {
          var parts = key.split('.'), ct = parts[0], field = parts[1];
          var ids = e.carriers[key].map(function (x) { return x; });
          return journalReattach(ct, field, ids, made, e.type, w.remap).then(function () {
            if (!into || field === 'groups') return;
            var had = (before[key] || []).map(String);
            var only = ids.map(function (x) { return w.remap(ct, String(x)); }).filter(function (x) { return had.indexOf(x) === -1; });
            return journalDetach(ct, field, only, w.intoId);
          });
        });
      }, Promise.resolve()).then(function () { return made; });
    });
  }

  var BULK = { scenes: ['bulkSceneUpdate', 'BulkSceneUpdateInput'], images: ['bulkImageUpdate', 'BulkImageUpdateInput'],
    galleries: ['bulkGalleryUpdate', 'BulkGalleryUpdateInput'], performers: ['bulkPerformerUpdate', 'BulkPerformerUpdateInput'],
    groups: ['bulkGroupUpdate', 'BulkGroupUpdateInput'] };

  function journalChunks(ids, fn) {
    var chunks = [];
    for (var i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    return chunks.reduce(function (p, ch) { return p.then(function () { return fn(ch); }); }, Promise.resolve());
  }

  // Each carrier still there gets the recreated entity back. A relation list goes back in
  // bulk; a studio's tags, a studio's parent and a scene's place in a group are one update
  // each, since those carry more than an id.
  function journalReattach(ct, field, list, made, type, remap) {
    var ids = list.map(function (x) { return remap(ct, String(Array.isArray(x) ? x[0] : x)); });
    var one = function (id, input) {
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
    });
  }

  function journalDetach(ct, field, ids, dest) {
    if (!ids.length || !dest || !BULK[ct] || field === 'studio_id') return Promise.resolve();
    var b = BULK[ct];
    return journalChunks(ids, function (ch) {
      var input = { ids: ch };
      input[field] = { ids: [dest], mode: 'REMOVE' };
      return gqlRequest('mutation GTTxUndoDetach($input: ' + b[1] + '!) { ' + b[0] + '(input: $input) { id } }', { input: input })
        .then(null, function () {});
    });
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
    gallery_ids: 'galleries', scene_ids: 'scenes' };
  function journalRemapped(e, remap) {
    var r = {}, k;
    for (k in e) if (hasOwn(e, k)) r[k] = e[k];
    r._orig = e;
    r.eid = remap(e.type, e.eid);
    r.entity = e.type + ':' + r.eid;
    if (hasOwn(REMAP_REL, e.field)) {
      var rt = REMAP_REL[e.field], m = function (v) { return Array.isArray(v) ? v.map(function (x) { return remap(rt, x); }) : v; };
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
      both[1].forEach(function (pair) { now[pair[0]] = pair[1]; });
      both[2].forEach(function (pair) { exists[pair[0]] = pair[1]; });
      var writes = [];
      // Put back first, so whatever follows in the same undo finds them there.
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
            if (!intact) { items.push({ entry: e, status: 'changed', reason: 'changed since' }); return; }
            state[e.field] = now.filter(function (x) { return d.added.indexOf(x) === -1; })
              .concat(d.removed).sort();
            if (touched.indexOf(e.field) === -1) touched.push(e.field);
            done.push(e);
            items.push({ entry: e, status: 'ok', reason: '' });
            return;
          }
          if (!journalSame(state[e.field], entryAfter(e))) {
            items.push({ entry: e, status: 'changed', reason: 'changed since' });
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
    var lease = { owner: PLUGIN_ID, label: 'Undo History', until: Date.now() + 60000 };
    c.leases.push(lease);
    var written = [], failed = 0;
    return plan.writes.reduce(function (p, w) {
      return p.then(function () {
        lease.until = Date.now() + 60000;
        var t = JOURNAL_TYPES[w.type], q, vars;
        if (w.recreate) {
          return journalRecreate(w).then(function (made) {
            w.made = made;
            written.push(w);
            line('UNDO', 'put back as ' + t.label.toLowerCase() + ' ' + made, w);
          }, function (e) {
            failed++;
            line('ERROR', 'it could not be put back: ' + (e && e.message ? e.message : e), w);
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
    }, Promise.resolve()).then(function () {
      var i = c.leases.indexOf(lease);
      if (i !== -1) c.leases.splice(i, 1);
      var entries = [], undid = [], remap = null;
      written.forEach(function (w) {
        if (w.recreate) {
          var e = w.entries[0];
          undid.push(e);
          remap = remap || {};
          (remap[w.type] = remap[w.type] || {})[e.eid] = w.made;
          entries.push({ type: w.type, id: w.made, name: w.name, action: 'create', undoes: e.id });
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
  function journalMark(undid, runId) {
    return journalDb().then(function (db) {
      var tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries');
      undid.forEach(function (e) {
        e = e._orig || e;
        e.undone = runId || true;
        store.put(e);
        if (e.undoes) {
          var g = store.get(e.undoes);
          g.onsuccess = function () { if (g.result) { delete g.result.undone; store.put(g.result); } };
        }
      });
      return idbDone(tx);
    }).then(journalChanged);
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  var DEFAULTS = {
    a1TaggerDuration: false,
    a2SelectPaste: false,
    a3SameTab: false,
    a4HeadingCounts: false,
    a5LogLinesKept: '',
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

  function loadSettings(force) {
    var now = Date.now();
    if (!force && _settings && now - _settingsAt < SETTINGS_TTL_MS) {
      return Promise.resolve(_settings);
    }
    if (_settingsInFlight) return _settingsInFlight;
    _settingsInFlight = gqlRequest('query GTTxCoreSettings { configuration { plugins } }', null)
      .then(function (data) {
        var raw = ((data.configuration || {}).plugins || {})[PLUGIN_ID] || {};
        var out = {}, k;
        for (k in DEFAULTS) if (hasOwn(DEFAULTS, k)) out[k] = hasOwn(raw, k) ? raw[k] : DEFAULTS[k];
        // The one heading-counts switch replaced two, `a4TagCount` and `a5PerformerCount`,
        // the day after they shipped. A map that has either on and has never had the new
        // key written reads as on; the old keys are left where they are.
        if (!hasOwn(raw, 'a4HeadingCounts') && (raw.a4TagCount || raw.a5PerformerCount)) {
          out.a4HeadingCounts = true;
        }
        _settings = out;
        _settingsAt = Date.now();
        _settingsInFlight = null;
        applyDevMods(parseDevMods(out.b1DevMods));
        seedSettings(raw, out);
        return out;
      }, function () {
        _settingsInFlight = null;
        return settings();
      });
    return _settingsInFlight;
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
  var SEEDS = {
    a1TaggerDuration: false,
    a2SelectPaste: false,
    a3SameTab: false,
    a4HeadingCounts: false,
    a5LogLinesKept: LOG_KEEP,
    c1JournalKeepDays: String(JOURNAL_KEEP_DAYS),
    c2JournalSizeMB: JOURNAL_SIZE_MB,
    c3JournalSinceBackup: false,
    c4JournalHandEdits: true,
    c5JournalImageRuns: false,
    c6JournalProtect: true,
    c7JournalDeletes: true,
  };
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
  function writeOwnSettings(patch) {
    return gqlRequest('query GTTxCoreConfig { configuration { plugins } }', null)
      .then(function (data) {
        var raw = ((data.configuration || {}).plugins || {})[PLUGIN_ID] || {};
        var input = {}, k;
        for (k in raw) if (hasOwn(raw, k)) input[k] = raw[k];
        for (k in patch) if (hasOwn(patch, k)) input[k] = patch[k];
        return gqlRequest(
          'mutation GTTxCoreConfigure($plugin_id: ID!, $input: Map!) { ' +
          'configurePlugin(plugin_id: $plugin_id, input: $input) }',
          { plugin_id: PLUGIN_ID, input: input });
      })
      .then(function () { return loadSettings(true); });
  }

  // ── The Dev Mods dialog ───────────────────────────────────────────────────
  //
  // The shared chrome, in its smallest form: this dialog reads nothing and writes no
  // entity, so it has no log, no counters and no backup sentence - the head says where
  // the switches reach instead. Escape acts through the footer's own exit, as everywhere
  // else, so it can never reach a button that is hidden or disabled.
  var _dialog = null;

  function openDevMods() {
    if (_dialog) { if (_dialog.modal.scrollIntoView) _dialog.modal.scrollIntoView(); return; }
    injectStyle();
    var state = parseDevMods(settings().b1DevMods);
    var backdrop = el('div', 'gttxcore-backdrop');
    var modal = el('div', 'gttxcore-modal gttxcore-narrow');
    backdrop.appendChild(modal);

    var head = el('div', 'gttxcore-head');
    head.appendChild(el('div', 'gttxcore-title', PLUGIN_SHORT_NAME + ' - Dev Mods'));
    head.appendChild(el('div', 'gttxcore-note',
      'Switches for working on these plugins, not for using them. Each one sets a flag ' +
      'on the object the ᝯㄝₓ plugins share, so it reaches every one of them at once and ' +
      'none of them writes anything because of it. All three are off by default and none ' +
      'is meant to be left on.'));
    modal.appendChild(head);

    var body = el('div', 'gttxcore-body');
    var boxes = {};
    DEV_MODS.forEach(function (m) {
      var row = el('div', 'gttxcore-devrow');
      var label = el('label', 'gttxcore-devlabel');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!state[m.key];
      box.className = 'gttxcore-devbox';
      box.addEventListener('change', function () { refreshSave(); });
      boxes[m.key] = box;
      label.appendChild(box);
      label.appendChild(el('span', 'gttxcore-devname', m.label));
      row.appendChild(label);
      row.appendChild(el('div', 'gttxcore-devhelp', m.help));
      body.appendChild(row);
    });
    modal.appendChild(body);

    var foot = el('div', 'gttxcore-foot');
    var saveBtn = button('Save', 'gttxcore-save');
    // Teal, not amber: it stores three flags in this plugin's own settings and touches
    // nothing in the library. The colour rule is about what a control does to your data.
    saveBtn.className = saveBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    var closeBtn = button('Close', 'gttxcore-close');
    foot.appendChild(saveBtn);
    foot.appendChild(closeBtn);
    modal.appendChild(foot);

    var run = { modal: modal, backdrop: backdrop, boxes: boxes,
      saveBtn: saveBtn, closeBtn: closeBtn };

    // **Save is held back until a switch has actually moved**, the rule
    // `PropagateTagsAndPerformers` settled for its own settings dialog: a Save that is
    // live from the moment the dialog opens invites a press that stores back exactly what
    // it just read. Compared between *formatted* strings rather than against the stored
    // one, so a difference of case or spacing in what was stored is not a change - and so
    // that a stored value this script could not parse is normalised by the first real
    // edit rather than by an idle press.
    function current() {
      var next = {};
      DEV_MODS.forEach(function (m) { next[m.key] = !!boxes[m.key].checked; });
      return next;
    }
    function refreshSave() {
      var moved = formatDevMods(current()) !== formatDevMods(state);
      saveBtn.disabled = !moved;
      saveBtn.title = moved ? 'Store these three switches and apply them now.'
        : 'Nothing has changed since this opened.';
    }
    run.refreshSave = refreshSave;
    refreshSave();

    function shut() {
      unwireEscape(run);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      _dialog = null;
    }
    closeBtn.addEventListener('click', shut);
    saveBtn.addEventListener('click', function () {
      if (saveBtn.disabled) return;
      var next = current();
      saveBtn.disabled = true;
      closeBtn.disabled = true;
      // Applied before the write lands as well as after it: the flags are what the user
      // pressed Save for, and a round trip is not a reason to wait for them.
      applyDevMods(next);
      writeOwnSettings({ b1DevMods: formatDevMods(next) }).then(shut, function (e) {
        saveBtn.disabled = false;
        closeBtn.disabled = false;
        saveBtn.textContent = 'Save failed';
        if (window.console && console.error) console.error('[gttxcore]', e);
      });
    });

    _dialog = run;
    wireEscape(run);
    document.body.appendChild(backdrop);
  }

  function button(label, className) {
    var b = el('button', 'btn btn-secondary btn-sm ' + (className || ''), label);
    b.type = 'button';
    return b;
  }

  function escapeButton(run) {
    var b = run.closeBtn;
    return b && !b.disabled ? b : null;
  }

  function wireEscape(run) {
    run._onEscape = function (ev) {
      if (!ev || (ev.key !== 'Escape' && ev.keyCode !== 27)) return;
      var b = escapeButton(run);
      if (!b) return;
      if (ev.preventDefault) ev.preventDefault();
      b.click();
    };
    document.addEventListener('keydown', run._onEscape);
  }

  function unwireEscape(run) {
    if (run._onEscape && document.removeEventListener) {
      document.removeEventListener('keydown', run._onEscape);
    }
    run._onEscape = null;
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
    return journalDb().then(function (db) {
      var tx = db.transaction(['runs', 'entries']);
      return Promise.all([idbRequest(tx.objectStore('runs').getAll()),
        idbRequest(tx.objectStore('entries').getAll())]);
    }).then(function (both) {
      var parts = [JSON.stringify({ kind: 'gttx-undo-history', version: 1, exported: Date.now(),
        runs: both[0].length, entries: both[1].length }) + '\n'];
      both[0].sort(journalOrder).forEach(function (r) { parts.push(JSON.stringify({ kind: 'run', run: r }) + '\n'); });
      both[1].forEach(function (e) { parts.push(JSON.stringify({ kind: 'entry', entry: e }) + '\n'); });
      var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var name = 'gttx-undo-history-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' +
        pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.ndjson';
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
    return journalDb().then(function (db) {
      var tx = db.transaction(['runs', 'entries'], 'readwrite');
      var rs = tx.objectStore('runs'), es = tx.objectStore('entries');
      runs.forEach(function (r) { rs.put(r); });
      entries.forEach(function (e) { es.put(e); });
      return idbDone(tx);
    }).then(function () {
      journalChanged();
      return { runs: runs.length, entries: entries.length, skipped: skipped };
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
    if (e.action === 'merge') return 'merged into "' + ((e.merge && e.merge.name) || '') + '"' +
      (e.lost ? ' (' + LOST_REASON[e.lost] + ')' : '');
    if (e.action === 'split') return 'split back out of "' + ((e.merge && e.merge.name) || '') + '"';
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
  var HISTORY_REL_TYPES = { tag_ids: 'tags', performer_ids: 'performers', gallery_ids: 'galleries',
    scene_ids: 'scenes', parent_ids: 'tags', child_ids: 'tags', studio_id: 'studios',
    parent_id: 'studios', groups: 'groups' };
  var _histNames = {};

  function historyNames(type, ids) {
    var cache = _histNames[type] = _histNames[type] || {};
    var want = ids.filter(function (id) { return !hasOwn(cache, id); });
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
        }, function () { return {}; });
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
        a.textContent = name == null ? '(' + id + ', deleted)' : name + ' (' + id + ')';
      });
    }
    return a;
  }

  // A custom field's name, teal, carrying the box every custom field named here opens:
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
    if (/^custom_fields\./.test(e.field || '') && e.action !== 'gap') {
      span.appendChild(el('span', null, 'custom field '));
      span.appendChild(historyCfName(e.field.slice(14)));
      span.appendChild(el('span', null, ': ' + historyValue(e.before, e.beforeAbsent) + ' → ' +
        historyValue(e.after, e.afterAbsent)));
      return span;
    }
    var type = hasOwn(HISTORY_REL_TYPES, e.field) && e.action !== 'create' && e.action !== 'delete' &&
      e.action !== 'gap' ? HISTORY_REL_TYPES[e.field] : null;
    if (!type) { span.textContent = historyChange(e); return span; }
    var idOf = function (v) { return v && typeof v === 'object' ? String(v.group_id) : String(v); };
    var list = function (v) { return v == null ? [] : Object.prototype.toString.call(v) === '[object Array]' ? v.map(idOf) : [idOf(v)]; };
    var before = list(e.before), after = list(e.after);
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

  function historyMatches(H, e) {
    if (H.type && e.type !== H.type) return false;
    if (!H.find) return true;
    return [e.name, e.field, JSON.stringify(e.before), JSON.stringify(e.after)].join('\n')
      .toLowerCase().indexOf(H.find) !== -1;
  }

  function openHistory() {
    if (_history) { if (_history.modal.scrollIntoView) _history.modal.scrollIntoView(); return; }
    injectStyle();
    var H = { selRuns: {}, selEntries: {}, open: {}, entries: {}, byId: {}, shown: HISTORY_PAGE,
      mode: 'list', plan: null, find: '', type: '', source: '', from: 0, to: 0, drawing: 0 };
    var backdrop = el('div', 'gttxcore-backdrop');
    var modal = el('div', 'gttxcore-modal gttxcore-history');
    backdrop.appendChild(modal);
    H.backdrop = backdrop;
    H.modal = modal;

    var head = el('div', 'gttxcore-head');
    head.appendChild(el('div', 'gttxcore-title', PLUGIN_SHORT_NAME + ' - Undo History'));
    head.appendChild(el('div', 'gttxcore-warn',
      'Backing up your database before proceeding is recommended. An undo writes to your ' +
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
    find.title = 'Show only the runs with a change whose entity name, field or value holds this text.';
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
    var amber = function (b) { b.className = b.className.replace('btn-secondary', 'btn-warning'); return b; };
    H.undoBtn = amber(button('Undo Selected...', 'gttxcore-hundo'));
    H.deleteBtn = button('Delete Selected...', 'gttxcore-hdelete');
    H.popLabel = el('label', 'gttxcore-hpop gttxcore-hidden');
    H.popBox = el('input', 'gttxcore-hbox');
    H.popBox.type = 'checkbox';
    H.popLabel.appendChild(H.popBox);
    H.popLabel.appendChild(el('span', null, ' Take it out of the history'));
    H.popLabel.title = 'Ticked, what is undone leaves the history instead of an undo joining it - the ' +
      'history goes back to where it was, as a stack does. It cannot then be redone from here. ' +
      'Unticked, the undo is recorded and can be undone in turn.';
    H.popBox.addEventListener('change', function () { historyFoot(H); });
    H.proceedBtn = amber(button('Proceed', 'gttxcore-hproceed gttxcore-hidden'));
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
      'Asks for a second press.';
    H.dropBtn.title = 'Delete from this browser’s history every run recorded before the backup just ' +
      'taken: the backup holds your library as it was, and the file just saved holds those runs. ' +
      'Nothing in your library changes. Asks for a second press.';
    H.proceedBtn.title = 'Undo the changes listed above. The undo is recorded, so it can be undone in turn.';
    H.backBtn.title = 'Back to the history, with nothing written.';
    H.closeBtn.title = 'Close Undo History.';
    [H.undoBtn, H.deleteBtn, H.popLabel, H.proceedBtn, H.backBtn, H.exportBtn, H.importBtn, H.backupBtn, H.dropBtn,
      H.clearBtn, H.closeBtn].forEach(function (b) { foot.appendChild(b); });
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
        journalSawBackup(at);
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
    }, H);
    H.closeBtn.addEventListener('click', function () { historyClose(H); });

    // Another tab recording something redraws the list here, when it is showing.
    try {
      if (typeof window.BroadcastChannel === 'function') {
        H.channel = new window.BroadcastChannel(JOURNAL_DB);
        H.channel.onmessage = function () {
          historyStats(H);
          if (H.mode === 'list' && !H.busy) historyDraw(H, true);
        };
      }
    } catch (e) { /* redrawn on the next open */ }

    _history = H;
    wireEscape(H);
    document.body.appendChild(backdrop);
    historyFoot(H);
    historyStats(H);
    historyDraw(H);
    return H;
  }

  function historyShow(node, on) {
    node.className = String(node.className || '').replace(/\s*gttxcore-hidden\b/g, '') + (on ? '' : ' gttxcore-hidden');
  }

  // A line with a spinner before it, for as long as the work runs; the next line written
  // to the progress replaces it.
  function historyWorking(H, text) {
    H.progressEl.textContent = '';
    H.progressEl.appendChild(el('span', 'gttxcore-spinner'));
    H.progressEl.appendChild(el('span', null, text));
  }

  function historyBusy(H, on) {
    H.busy = on;
    historyFoot(H);
  }

  // A press that deletes history asks twice: the first press changes the caption, a
  // second within five seconds does it.
  function historyConfirm(btn, ask, act, H) {
    var label = btn.textContent, armed = null;
    btn.addEventListener('click', function () {
      if (!armed) {
        holdWidth(btn);
        btn.textContent = ask;
        armed = setTimeout(function () { armed = null; btn.textContent = label; }, 5000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      btn.textContent = label;
      historyBusy(H, true);
      act().then(function () { historyStats(H); return historyDraw(H, true); }, function (e) {
        H.progressEl.textContent = 'That failed: ' + (e && e.message ? e.message : e);
      }).then(function () { historyBusy(H, false); });
    });
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
          return historyEntriesOf(H, r.id).then(function (run) {
            return function (es) {
              if (es.some(function (e) { return historyMatches(H, e); })) kept.push(run);
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
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!runs.length) list.appendChild(el('div', 'gttxcore-line', total ? 'Nothing matches the filter.' : 'Nothing is recorded yet.'));
    runs.forEach(function (r) {
      var block = el('div', 'gttxcore-hrun');
      var row = el('div', 'gttxcore-hhead');
      var box = el('input', 'gttxcore-hbox');
      box.type = 'checkbox';
      box.checked = !!H.selRuns[r.id];
      box.addEventListener('change', function () {
        if (box.checked) H.selRuns[r.id] = true; else delete H.selRuns[r.id];
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
          inner.textContent = '';
          es.forEach(function (e) {
            if ((H.find || H.type) && !historyMatches(H, e)) return;
            var line = el('div', 'gttxcore-hentry' + (e.undone ? ' gttxcore-hundone' : ''));
            var eb = el('input', 'gttxcore-hbox');
            eb.type = 'checkbox';
            eb.checked = !!H.selEntries[e.id] || !!H.selRuns[r.id];
            eb.disabled = !!H.selRuns[r.id];
            eb.addEventListener('change', function () {
              if (eb.checked) H.selEntries[e.id] = true; else delete H.selEntries[e.id];
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
      return journalPlan(entries);
    }).then(function (plan) {
      H.plan = plan;
      H.mode = 'review';
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
      H.progressEl.textContent = 'Undone: ' + plural(res.written, 'entity', 'entities') + ' written' +
        (res.failed ? ', ' + plural(res.failed, 'failure') : '') + '. ' + (pop
        ? plural(res.popped, 'change') + ' taken out of the history; what was skipped or failed is still there.'
        : 'The undo is in the history, where it can be undone in turn.');
    }, function (e) {
      H.failed = 1;
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
  }

  // ── Undo History: where it opens from ─────────────────────────────────────
  //
  // Settings - Tasks lists it, since the yml declares it; a capture-phase listener takes
  // the click before Stash would queue a job, and only when the button sits under our own
  // heading. The top bar gets a button of its own beside Stash's Settings and Help, so the
  // history is one click from any page.
  function ownHistoryTask(btn) {
    if (String(btn.textContent || '').replace(/^\s+|\s+$/g, '') !== HISTORY_TASK) return false;
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

  // ── The settings page ─────────────────────────────────────────────────────
  //
  // The same treatment every ᝯㄝₓ plugin gives its own group - the description
  // split into a summary and a hover box, the group's own description behind
  // **Show more**, a labelled README link, and the red banner when the script
  // running here is not the one installed.
  var CORE_TASKS = ['Undo History...'];
  var TIP_MARK = 'ⓘ';     // circled Latin small letter i


  function ownSettingGroup() {
    // Every key rather than one named one: a release can rename every setting the
    // plugin has, and a single named anchor is exactly what such a rename breaks.
    var node = null, d, key;
    for (key in DEFAULTS) {
      if (!hasOwn(DEFAULTS, key)) continue;
      node = settingElement(PLUGIN_ID, key);
      if (node) break;
    }
    for (d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting-group')) return node;
    }
    // Fallback for a Stash that sets no setting ids: the group headed with our own
    // name. It was the both-modes notice's fallback and it outlived that notice,
    // because everything else this section puts on the page - the README
    // link, the description split, the stale banner - needs the same box.
    //
    // Settings - Tasks heads *its* group with the same name, and that group is not
    // this one: it holds the task buttons and no settings, so decorating it would put
    // a README link and a split description on a page that never had either. The
    // heading is only enough to identify us; the buttons are what say which page.
    var heading = ownSettingGroupHeading();
    for (node = heading, d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting-group')) return hasOwnTaskButton(node) ? null : node;
    }
    return heading && !hasOwnTaskButton(heading.parentElement)
      ? heading.parentElement : null;
  }

  function hasOwnTaskButton(node) {
    if (!node) return false;
    if (node.tagName === 'BUTTON' &&
        CORE_TASKS.indexOf(String(node.textContent || '').replace(/^\s+|\s+$/g, '')) !== -1) {
      return true;
    }
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      if (hasOwnTaskButton(kids[i])) return true;
    }
    return false;
  }

  function readmeLinkSlot(group) {
    var sub = byClass(group, 'sub-heading');
    if (sub && sub.parentNode) return { parent: sub.parentNode, before: sub.nextSibling };
    var header = byClass(group, 'setting');
    var box = header && header.childNodes && header.childNodes[0];
    if (box) return { parent: box, before: null };
    return { parent: group, before: null };
  }

  function splitDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'gttxcore-p')) return;   // already ours
    var text = sub.textContent || '';
    if (text.indexOf('\n') === -1) return;                   // nothing to split
    var paras = text.split(/\n{2,}/);
    sub.textContent = '';
    paras.forEach(function (para) {
      var t = para.replace(/\s+/g, ' ').replace(/^ | $/g, '');
      if (t) sub.appendChild(el('div', 'gttxcore-p', t));
    });
  }

  function setTipOpen(sub, on) {
    var cls = String(sub.className || '').replace(/\s*gttxcore-tip-open\b/, '');
    sub.className = (on ? cls + ' gttxcore-tip-open' : cls).replace(/^\s+/, '');
  }

  function tipTrigger(node, row) {
    if (!node || node._nptTipWired) return;
    node._nptTipWired = true;
    var toggle = function (on) {
      var sub = byClass(row, 'sub-heading');
      if (sub) setTipOpen(sub, on);
    };
    node.addEventListener('mouseenter', function () { toggle(true); });
    node.addEventListener('mouseleave', function () { toggle(false); });
    node.addEventListener('focus', function () { toggle(true); });
    node.addEventListener('blur', function () { toggle(false); });
  }

  function tipSetting(key) {
    var row = settingRow(PLUGIN_ID, key);
    if (!row) return;
    var sub = byClass(row, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'gttxcore-sum')) return;    // already ours
    var text = sub.textContent || '';
    var cut = text.indexOf('\n\n');
    if (cut === -1) return;                                     // nothing to hide
    var summary = oneLine(text.slice(0, cut));
    // Kept as paragraphs: a native tooltip honours newlines, and a description with
    // three paragraphs run together reads worse than the wall this is replacing.
    var detail = text.slice(cut + 2).split(/\n{2,}/).map(oneLine)
      .filter(function (p) { return !!p; }).join('\n\n');
    if (!summary || !detail) return;
    sub.textContent = '';
    if (!hasClass(sub, 'gttxcore-tipped')) {
      sub.className = ((sub.className || '') + ' gttxcore-tipped').replace(/^\s+/, '');
    }
    var sum = el('span', 'gttxcore-sum', summary);
    sub.appendChild(sum);
    // tabIndex, so the box can be reached and read without a mouse. The box is a
    // sibling of the mark rather than a child: as a child it would sit inside an
    // inline span and inherit its clipping and stacking.
    var mark = el('span', 'gttxcore-tip', TIP_MARK);
    mark.tabIndex = 0;
    sub.appendChild(mark);
    sub.appendChild(el('span', 'gttxcore-tipbox', detail));
    tipTrigger(mark, row);
    // The visible summary opens it too. The mark is a small target for something
    // every row now hides half its text behind, and the box opens *above* the
    // .sub-heading, so it covers the name rather than the sentence being read - the
    // one place a hover-to-open box would have been in its own way.
    tipTrigger(sum, row);
    // The setting's *name* opens the same box. It used to carry a plain `title`
    // instead, so one row had two hover targets showing the same text in two
    // different tooltips - and the browser's was exactly what the box exists to
    // replace. Stash's own `<h3 title>` slot is left empty.
    // querySelector by tag name is all the fake DOM implements, and all this needs.
    var h3 = row.querySelector ? row.querySelector('h3') : null;
    if (h3) tipTrigger(h3, row);
  }

  function tipSettings() {
    for (var k in DEFAULTS) {
      if (hasOwn(DEFAULTS, k)) tipSetting(k);
    }
  }

  function setDescCollapsed(sub, on) {
    var cls = String(sub.className || '').replace(/\s*gttxcore-desc-collapsed\b/, '');
    sub.className = (on ? cls + ' gttxcore-desc-collapsed' : cls).replace(/^\s+/, '');
  }

  function collapseDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    var paras = 0;
    for (var i = 0; i < kids.length; i++) if (hasClass(kids[i], 'gttxcore-p')) paras++;
    if (paras < 2) return;                        // one paragraph hides nothing
    if (document.getElementById(DESC_TOGGLE_ID)) return;
    // A re-render drops the button and the class together, so the description
    // returns to collapsed rather than to a half-state with no way out of it.
    setDescCollapsed(sub, true);
    var btn = el('button', 'gttxcore-desc-toggle', 'Show more');
    btn.id = DESC_TOGGLE_ID;
    btn.type = 'button';
    btn.addEventListener('click', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      var open = descCollapsed(sub);
      setDescCollapsed(sub, !open);
      btn.textContent = open ? 'Show less' : 'Show more';
    });
    sub.appendChild(btn);
  }

  function installedFromHeading(group) {
    var h3 = group && group.querySelector ? group.querySelector('h3') : null;
    var t = h3 ? String(h3.textContent == null ? '' : h3.textContent).trim() : '';
    var m = /\(([^()]+)\)$/.exec(t);
    return m ? m[1].replace(/^\s+|\s+$/g, '') : null;
  }

  function staleSlot(group) {
    var sub = byClass(group, 'sub-heading');
    if (sub && sub.parentNode) return { parent: sub.parentNode, before: sub };
    return { parent: group, before: group.firstChild };
  }

  function ensureStaleNotice(group) {
    var installed = installedFromHeading(group);
    var node = document.getElementById(STALE_ID);
    ensureReloadUiButton(PLUGIN_ID, group, !!installed && installed !== PLUGIN_VERSION);
    // No parenthesised version on the heading means Settings → Tasks, which heads its
    // group with the bare name - not a mismatch, and nothing to say.
    if (!installed || installed === PLUGIN_VERSION) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      return;
    }
    var slot = staleSlot(group);
    if (node && node.parentNode === slot.parent) return;
    if (node && node.parentNode) node.parentNode.removeChild(node);
    var box = el('div', 'gttxcore-stale', '⚠ This page is still running ' +
      PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION + ', but ' + installed + ' is installed. ' +
      'Press Ctrl+Shift+R (⌘+Shift+R on a Mac) to reload it: your browser has cached ' +
      'the older script, and everything this plugin does until then is that older code.');
    box.id = STALE_ID;
    slot.parent.insertBefore(box, slot.before);
  }

  function ensureReadmeLink() {
    var group = ownSettingGroup();
    if (!group) return;
    // Both of these run on every tick, not just when the link is missing: React
    // re-renders this panel on any settings change, and the class is the only thing
    // making the description's paragraph breaks visible.
    injectStyle();
    if (!hasClass(group, 'gttxcore-own-group')) {
      group.className = ((group.className || '') + ' gttxcore-own-group').replace(/^\s+/, '');
    }
    splitDescription(group);
    collapseDescription(group);   // after the split: it counts the .gttxcore-p divs
    tipSettings();
    ensureStaleNotice(group);     // before the early return: the link outlives it
    if (document.getElementById(README_LINK_ID)) return;
    var link = el('a', 'gttxcore-readme', 'NormalizeParentTags/README.md');
    link.id = README_LINK_ID;
    link.href = README_URL;
    link.target = linkTarget();
    link.rel = 'noreferrer';
    link.title = 'Open this plugin\'s documentation for the version it was published at';
    link.style = 'display:inline-block;margin-top:.35rem;font-size:.8rem;';
    var slot = readmeLinkSlot(group);
    slot.parent.insertBefore(link, slot.before);
  }


  function headingIsOurs(text) {
    var t = String(text == null ? '' : text).trim();
    if (t === PLUGIN_NAME) return true;
    t = t.replace(/\s*\([^()]*\)$/, '').replace(/\s+undefined$/, '').trim();
    return t === PLUGIN_NAME;
  }

  function ownSettingGroupHeading() {
    var nodes = document.querySelectorAll ? document.querySelectorAll('h3') : [];
    for (var i = 0; i < nodes.length; i++) {
      if (headingIsOurs(nodes[i].textContent)) return nodes[i];
    }
    return null;
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

  function oneLine(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  function descCollapsed(sub) { return hasClass(sub, 'gttxcore-desc-collapsed'); }


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
    '.gttx-tipbox{display:none;position:fixed;left:0;top:0;z-index:1700;' +
    'width:20rem;max-width:90vw;padding:.5rem .65rem;background:#202b33;color:#d6dee4;' +
    'border:1px solid #425a6b;border-radius:3px;font-size:.8rem;line-height:1.45;' +
    'white-space:pre-wrap;pointer-events:none;text-align:left;font-family:inherit;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.gttx-tipbox.gttx-tip-open{display:block;}' +
    '.gttx-tipbox img{display:block;width:100%;max-height:14rem;object-fit:contain;' +
    'margin-bottom:.4rem;border-radius:3px;background:#111a20;}' +
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
    '.gttx-cftip{margin-left:.9rem;color:#a7b6c2;cursor:help;}' +
    // A listed setting: our names stand in for Stash's text of the value, each with
    // its mark close behind it.
    '.gttx-cflisted .value > span:not(.gttx-cftipped){display:none;}' +
    '.gttx-cfname+.gttx-cftip{margin-left:.3rem;}' +
    '.gttx-cfinline .gttx-cftip{margin-left:.3rem;}' +
    '.gttx-cftipbox{display:none;position:fixed;left:0;top:0;' +
    'z-index:1600;width:max-content;max-width:min(48rem,60vw);padding:.5rem .65rem;' +
    'background:#202b33;color:#d6dee4;border:1px solid #425a6b;border-radius:3px;' +
    'font-size:.92rem;line-height:1.45;white-space:pre-wrap;pointer-events:none;' +
    'text-align:left;box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.gttx-cftipped.gttx-cftip-open .gttx-cftipbox{display:block;}' +

    // **The duration warning.** Bootstrap's own `text-danger` / `text-warning` are the
    // colours Stash already uses for the tagger's match icons, so the two bands read as
    // the same vocabulary rather than as a second one; the size and the capitals are what
    // this adds. `inherit` on the family so it stays the card's own typeface.
    '.gttx-durwarn{font-family:inherit;text-transform:uppercase;letter-spacing:.02em;}' +
    '.gttx-durwarn-red{font-size:1.25em;font-weight:700;color:#ff7373;}' +
    '.gttx-durwarn-amber{color:#ffb366;font-weight:600;}' +

    // Layout edit mode. An outline rather than a border, so nothing moves when it comes
    // on, and the owner's id in a corner label drawn from the attribute itself.
    '.gttx-layoutmark{outline:1px dashed #6ad1ff !important;outline-offset:1px;' +
    'position:relative;}' +
    '.gttx-layoutmark::after{content:attr(data-gttx-owner);position:absolute;' +
    'left:0;bottom:100%;font-size:.6rem;line-height:1;padding:1px 3px;' +
    'background:#6ad1ff;color:#0b1116;border-radius:2px;pointer-events:none;' +
    'white-space:nowrap;z-index:5;}' +

    // ── The shared chrome and the settings page ──────────────────────────
    //
    // **Taken from a sibling's stylesheet rather than written**, which is what these
    // rules were missing for one release: this plugin sat outside the comparison in
    // `tests/style.test.js`, so hand-written approximations of them drifted with
    // nothing to notice - and **Show more** came out with the browser's default button
    // chrome, a white box, because the rule lacked `padding:0;border:0;background:none`.
    // It is in that comparison now, against all eight.
    '.gttxcore-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;' +
    'background:rgba(0,0,0,.6);z-index:1600;display:flex;align-items:center;' +
    'justify-content:center;}' +
    '.gttxcore-modal{background:#202b33;color:#f5f8fa;border:1px solid #394b59;' +
    'border-radius:4px;width:min(100rem,94vw);max-height:88vh;display:flex;' +
    'flex-direction:column;}' +
    '.gttxcore-head{padding:.75rem 1rem;border-bottom:1px solid #394b59;}' +
    '.gttxcore-title{font-size:1.1rem;font-weight:600;}' +
    '.gttxcore-warn{color:#ffb648;margin-top:.35rem;}' +
    '.gttxcore-note{color:#a7b6c2;margin-top:.35rem;}' +
    '.gttxcore-legend{color:#7d8f9c;margin-top:.35rem;font-size:.8rem;}' +
    '.gttxcore-progress{padding:.5rem 1rem;border-bottom:1px solid #394b59;' +
    'color:#a7b6c2;white-space:pre-wrap;}' +
    '.gttxcore-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;' +
    'font-family:monospace;font-size:.8rem;line-height:1.35;min-height:14rem;}' +
    '.gttxcore-line{white-space:pre-wrap;word-break:break-word;}' +
    '.gttxcore-foot{padding:.75rem 1rem;border-top:1px solid #394b59;display:flex;' +
    'gap:.5rem;flex-wrap:wrap;align-items:center;}' +
    // **`!important`, because a hidden utility that loses a cascade is not one.** Every
    // one of these rules is a single class, so the last one written wins - and this one
    // is written before the strips and rows that set their own `display`. A `-hidden` on
    // one of those did nothing at all, which is how Find & Replace shipped a row that
    // stayed on screen with the checkbox that reveals it switched off.
    '.gttxcore-hidden{display:none !important;}' +
    '.gttxcore-spin{color:#a7b6c2;}' +
    '.gttxcore-spinner{display:inline-block;width:.9em;height:.9em;margin-right:.45em;' +
    'vertical-align:-.1em;border:2px solid #a7b6c2;border-right-color:transparent;' +
    'border-radius:50%;animation:gttxcore-turn .8s linear infinite;}' +
    '@keyframes gttxcore-turn{to{transform:rotate(360deg);}}' +
    '.gttxcore-own-group .gttxcore-sub-heading{white-space:pre-wrap;}' +
    '.gttxcore-own-group .gttxcore-sub-heading .gttxcore-p{margin:0 0 .35em;}' +
    '.gttxcore-own-group .gttxcore-sub-heading .gttxcore-p:last-child{' +
    'margin-bottom:0;}' +
    '.gttxcore-desc-collapsed .gttxcore-p:not(:first-child){display:none;}' +
    '.gttxcore-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:#7cc4ff;font-size:.8rem;cursor:pointer;' +
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
    'padding:.5rem .65rem;background:#202b33;color:#d6dee4;border:1px solid #425a6b;' +
    'border-radius:3px;font-size:.92rem;line-height:1.45;white-space:pre-wrap;' +
    'pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.gttxcore-tipped.gttxcore-tip-open .gttxcore-tipbox{display:block;}' +
    '.gttxcore-readme{color:#7cc4ff;font-size:.8rem;margin-top:.35rem;' +
    'display:inline-block;}' +
    // This plugin's own: the dialog has no log and no counters, so it has a body and
    // three rows instead.
    // The shared modal is 100rem wide because the other dialogs hold monospace log
    // lines naming an entity, an id and two values. This one holds three switches and
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
    '.gttxcore-devrow{padding:.5rem 0;border-bottom:1px solid #2b3a45;}' +
    '.gttxcore-devlabel{display:flex;align-items:center;gap:.5rem;margin:0;' +
    'cursor:pointer;font-weight:600;}' +
    '.gttxcore-devname{font-size:.95rem;}' +
    '.gttxcore-devhelp{font-size:.82rem;color:#a7b6c2;margin-top:.25rem;' +
    'margin-left:1.6rem;}' +
    '.gttxcore-devline{margin:.1rem 0 .25rem;}' +
    // Undo History: the list, a run a row, its changes indented under it.
    '.gttxcore-modal.gttxcore-history{width:min(100rem,94vw);}' +
    '.gttxcore-hfilter{padding:.35rem 1rem;border-bottom:1px solid #394b59;display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;font-size:.8rem;}' +
    '.gttxcore-hfind{flex:1 1 14rem;min-width:8rem;background:#1f2b33;color:#f5f8fa;' +
    'border:1px solid #394b59;border-radius:3px;padding:.15rem .4rem;}' +
    '.gttxcore-hselect,.gttxcore-hdate{background:#1f2b33;color:#f5f8fa;border:1px solid #394b59;' +
    'border-radius:3px;padding:.1rem .3rem;}' +
    '.gttxcore-hlist{font-family:monospace;font-size:.8rem;min-height:16rem;}' +
    '.gttxcore-hrun{padding:.15rem 0;border-bottom:1px solid #2b3a45;}' +
    '.gttxcore-hhead{display:flex;gap:.4rem;align-items:flex-start;}' +
    '.gttxcore-hplus{color:#84d68a;font-weight:600;}.gttxcore-hminus{color:#ff7b72;font-weight:600;}' +
    '.gttxcore-hcfname{color:#17a2b8;cursor:help;}' +
    '.gttxcore-hbackto{margin-left:.75rem;font-size:.8rem;color:#a7b6c2;}' +
    '.gttxcore-hpop{margin:0 .5rem;align-self:center;cursor:pointer;}' +
    '.gttxcore-htoggle{cursor:pointer;white-space:pre-wrap;word-break:break-word;}' +
    '.gttxcore-hentries{padding:.1rem 0 .25rem 1.6rem;color:#a7b6c2;}' +
    '.gttxcore-hentry{display:flex;gap:.4rem;align-items:flex-start;white-space:pre-wrap;word-break:break-word;}' +
    '.gttxcore-hundone{opacity:.55;}' +
    '.gttxcore-elink{color:#7cc4ff;text-decoration:none;}' +
    '.gttxcore-elink:hover{text-decoration:underline;}' +
    '.gttxcore-hSKIP{color:#ffb648;} .gttxcore-hERROR{color:#ff7373;} .gttxcore-hUNDO{color:#84d68a;}' +
    '.gttxcore-hmore{margin-top:.5rem;}' +
    '.gttxcore-navbtn{font-size:1.15rem;line-height:1;}';

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
  // text modal - which for three flags spelled `DEBUG=ON, LAYOUT=OFF, STALEDEMO=OFF` is a
  // place to make a typo in. The value is replaced with the switches in words and Stash's
  // own button with one opening the dialog; both of Stash's are hidden rather than
  // removed, because React owns them and the setting must stay editable if this script
  // ever stops running.
  var DEV_LINE_ID = 'gttxcore-devmods-line';
  var DEV_BTN_ID = 'gttxcore-devmods-button';

  function devFieldTick() {
    var row = settingRow(PLUGIN_ID, 'b1DevMods');
    if (!row) return;
    var slot = byClass(row, 'value');
    var state = parseDevMods(settings().b1DevMods);
    var on = DEV_MODS.filter(function (m) { return state[m.key]; })
      .map(function (m) { return m.label; });
    var line = document.getElementById(DEV_LINE_ID);
    if (!line) {
      line = el('div', 'gttxcore-devline');
      line.id = DEV_LINE_ID;
    }
    line.textContent = on.length ? on.join(', ') : 'All off';
    // The row itself where there is no `.value`, never `row.childNodes[0]` - on the second
    // tick that first child is the line the first tick appended.
    var host = slot ? slot.parentNode : row;
    if (line.parentNode !== host) {
      if (slot) host.insertBefore(line, slot.nextSibling);
      else host.appendChild(line);
    }
    if (slot) hide(slot);

    var btn = document.getElementById(DEV_BTN_ID);
    if (!btn) {
      btn = button('Dev Mods...', 'gttxcore-devbtn');
      btn.id = DEV_BTN_ID;
      btn.className = btn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
      btn._coopOwner = PLUGIN_ID;
      btn.title = 'Three switches for working on these plugins. Nothing here changes ' +
        'your library, and all three are off by default.';
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
    var group = ownSettingGroup();
    var cards = document.querySelectorAll ?
      document.querySelectorAll('.scene-metadata') : [];
    var boxes = document.querySelectorAll ?
      document.querySelectorAll('.react-select__input-container') : [];
    var heads = headCountTargets();
    if (group || cards.length || boxes.length || heads.length) {
      try { loadSettings(false); } catch (e) { /* a settings read is never fatal */ }
    }
    try { durationTick(cards); } catch (e) { fail(e); }
    try { selectPasteTick(boxes); } catch (e) { fail(e); }
    try { headCountTick(heads); } catch (e) { fail(e); }
    try { layoutTick(); } catch (e) { fail(e); }
    try { historyNavTick(); } catch (e) { fail(e); }
    try { historyTaskTick(); } catch (e) { fail(e); }
    if (group) { try { settingsTick(group); } catch (e) { fail(e); } }
  }

  function fail(e) { if (window.console && console.error) console.error('[gttxcore]', e); }

  function settingsTick(group) {
    injectStyle();
    splitDescription(group);
    collapseDescription(group);
    tipSettings();
    devFieldTick();
    ensureStaleNotice(group);
    ensureReadmeLink();
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
    byClass: byClass, gqlRequest: gqlRequest, settingElement: settingElement,
    settingRow: settingRow, coopObject: coopObject, coop: coop, settle: settle, settled: settled, waitingOn: waitingOn,
    domBus: domBus, plural: plural, copyToClipboard: copyToClipboard,
    keepLog: keepLog, droppedLine: droppedLine, logKeep: logKeep, LOG_KEEP: LOG_KEEP,
    splitTerms: splitTerms, nameMatchesAny: nameMatchesAny,
    linkTarget: linkTarget, holdWidth: holdWidth, fieldLocks: fieldLocks,
    tagTipImage: tagTipImage, tipBox: tipBox, tipPlace: tipPlace, tipRatingBadge: tipRatingBadge,
    tipOpen: tipOpen, tipClose: tipClose, tagTip: tagTip,
    tipText: tipText, tagTipNames: tagTipNames, tagLinkTitle: tagLinkTitle,
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
    // What a caller prints when it finds no core at all. Written once here, even
    // though by definition the caller that needs it cannot read it from here.
    missingMessage: PLUGIN_NAME + ' is not installed or is disabled. Install it from '
      + 'the same source as this plugin and reload the page.',
  };
  ns.core = api;
  // The surface this plugin's own suite drives, beside the one its callers bind. Separate
  // because they answer different questions: `core` is the contract eight plugins depend
  // on, this is the inside of the two features that are only this plugin's.
  ns.gttxcore = {
    durationBand: durationBand, durationTick: durationTick, durationClear: durationClear,
    selectPasteTick: selectPasteTick,
    headCountTick: headCountTick, headCountTargets: headCountTargets, headCountClear: headCountClear,
    parseDevMods: parseDevMods, formatDevMods: formatDevMods, applyDevMods: applyDevMods,
    devMods: DEV_MODS, openDevMods: openDevMods, tick: tick,
    settings: function () { return settings(); },
    // Forced, because the tick only reads them when the page shows something that
    // depends on the answer - which a suite driving the dialog directly does not.
    load: function () { return loadSettings(true); },
  };
  if (_previous) {
    log('[gttxcore] replacing the ' + (_previous.version || 'unknown') +
      ' evaluation already on this page.');
  }

  coop();          // bring the shared object into its full shape whoever loads first

  // Replaced outright, like the export: a newer evaluation's closures are the ones called.
  coop().journal = {
    record: journalRecord, runs: journalRuns, entries: journalEntries,
    stats: journalStats, trim: journalTrim, clear: journalClear,
    plan: journalPlan, undo: journalUndo, remove: journalRemove, open: openHistory, fromInputs: journalFromInputs,
    pass: journalPass,
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

  window.addEventListener('load', start);
  window.addEventListener('popstate', tick);
  start();
}());
