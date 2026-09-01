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
// in the repo-root CLAUDE.md.
//
// It also carries the features that belong to no single plugin: the Scene Tagger's
// duration mismatch, and the developer switches.
(function () {
  'use strict';

  var PLUGIN_ID = 'GTTxCore';
  var PLUGIN_NAME = 'ᝯㄝₓ Core';
  var PLUGIN_SHORT_NAME = 'ᝯㄝₓ Core';
  var PLUGIN_VERSION = '1.2.0';
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
  // plugins does - measured, and recorded in the repo-root CLAUDE.md - but the suites do
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
    return c;
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

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
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

  // `id` and one display field per type, and the filter argument each `find*` takes.
  // The alias is the list field's own name, so `data.scenes.scenes` is the rows and
  // `data.scenes.count` is how many there are altogether.
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
        ', modifier: NOT_NULL }] }) { count ' + t.list + ' { id ' + t.name + ' } }';
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
            names.push(t.label + ' "' + (tipText(o[t.name]) || 'untitled') + '" (' + o.id + ')');
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
    var mark = node.firstChild;
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
  function cfTipTick(pluginId, key, field) {
    var row = settingRow(pluginId, key);
    var id = 'gttx-cffield-' + pluginId + '-' + key;
    var node = document.getElementById(id);
    if (!row || !field) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      return;
    }
    if (!node) {
      // A wrapper holding the mark and the box: it carries the id and the open-state
      // class, and nothing else - the box is fixed to the viewport, so it is not
      // positioned against this.
      node = el('span', 'gttx-cftipped');
      node.id = id;
      var mark = el('span', 'gttx-cftip', CF_TIP_MARK);
      // Reachable without a mouse, like the setting descriptions' own mark.
      mark.tabIndex = 0;
      node.appendChild(mark);
      node._gttxCfBox = el('span', 'gttx-cftipbox', '');
      node.appendChild(node._gttxCfBox);
    }
    if (node._gttxCfField !== field) {
      node._gttxCfField = field;
      // Honest until the read lands rather than a promise about what is coming: the
      // name is the one thing known without asking anything.
      node._gttxCfBox.textContent = 'Custom field "' + field + '"';
    }
    cfTipArm(node, row);
    // At the end of Stash's own `.value`, so the mark is on the same line as the name it
    // describes and to the left of the Edit button - the placement the reference note in
    // the repo-root CLAUDE.md settles for every one of these.
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

  // ── Settings ──────────────────────────────────────────────────────────────

  var DEFAULTS = {
    a1TaggerDuration: false,
    a2SelectPaste: false,
    a3SameTab: false,
    b1DevMods: '',
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
        _settings = out;
        _settingsAt = Date.now();
        _settingsInFlight = null;
        applyDevMods(parseDevMods(out.b1DevMods));
        return out;
      }, function () {
        _settingsInFlight = null;
        return settings();
      });
    return _settingsInFlight;
  }

  // **`configurePlugin` replaces a plugin's settings; it never merges.** So the stored map
  // is read per write and sent back whole - see the repo-root CLAUDE.md. Read from the
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


  // ── The settings page ─────────────────────────────────────────────────────
  //
  // The same treatment every ᝯㄝₓ plugin gives its own group - the description
  // split into a summary and a hover box, the group's own description behind
  // **Show more**, a labelled README link, and the red banner when the script
  // running here is not the one installed.
  var CORE_TASKS = [];    // this plugin declares no task; the check still runs
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
    '.gttxcore-devline{margin:.1rem 0 .25rem;}';

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
    if (group || cards.length || boxes.length) {
      try { loadSettings(false); } catch (e) { /* a settings read is never fatal */ }
    }
    try { durationTick(cards); } catch (e) { fail(e); }
    try { selectPasteTick(boxes); } catch (e) { fail(e); }
    try { layoutTick(); } catch (e) { fail(e); }
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
    settingRow: settingRow, coopObject: coopObject, coop: coop,
    domBus: domBus, plural: plural, copyToClipboard: copyToClipboard,
    linkTarget: linkTarget,
    tagTipImage: tagTipImage, tipBox: tipBox, tipPlace: tipPlace, tipRatingBadge: tipRatingBadge,
    tipOpen: tipOpen, tipClose: tipClose, tagTip: tagTip,
    tipText: tipText, tagTipNames: tagTipNames, tagLinkTitle: tagLinkTitle,
    entityTipStars: entityTipStars, entityTipName: entityTipName, entityTipCountry: entityTipCountry,
    entityTipGender: entityTipGender, entityTipLines: entityTipLines, entityTipDetail: entityTipDetail,
    entityTip: entityTip, cfTipCarriers: cfTipCarriers, cfTipTitle: cfTipTitle,
    cfTipLoad: cfTipLoad, cfTipPlace: cfTipPlace, cfTipOpen: cfTipOpen,
    cfTipArm: cfTipArm, cfTipTick: cfTipTick, anyStale: anyStale,
    reloadUiAnchor: reloadUiAnchor, ensureReloadUiButton: ensureReloadUiButton, staleReloadButton: staleReloadButton,
    computedStyleOf: computedStyleOf, findActionByLabel: findActionByLabel, borderingAction: borderingAction,
    pxOf: pxOf, sideMargin: sideMargin, neighbourGap: neighbourGap,
    nonZeroLength: nonZeroLength, stashButtonMargins: stashButtonMargins, fillNeighbourGaps: fillNeighbourGaps,
    ensureRowSpacing: ensureRowSpacing, applyButtonSpacing: applyButtonSpacing, insertOrdered: insertOrdered,
    insertBeforeImportantAction: insertBeforeImportantAction,
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
