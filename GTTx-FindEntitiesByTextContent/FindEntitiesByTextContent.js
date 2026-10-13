// Find Entities by Text Content
//
// Requires Stash 0.31.0 or newer: `custom_fields` on the seven entity-types is one of
// the places this plugin looks.
//
// Stash can filter a Scene list on its own `details`, and a Performer list on its own
// `details`, and neither on the other's - and nothing at all on "whichever custom fields
// this entity happens to carry". So there is no way to ask it *which entities in my
// library mention this string*. This plugin answers that: one search box, a toggle per
// entity-type, and a list of what it found.
//
// **Nothing here writes.** It is a read of the library and a list of links; there is no
// mutation to undo, no lease to take and nothing to stand a reactive plugin down for.
// Its head says where the results go rather than telling anyone to back up first.
//
// The scan is a read of the whole library, one page of one type at a time, because no
// server-side filter can answer the question above.
// ponytail: full paged scan; the six non-custom-field types could be narrowed with each
// filter type's own OR chain of INCLUDES criteria if a large library makes this slow.
//
// The design notes, and the reasoning behind the parts that look arbitrary, are in
// AGENTS.md next to this file.
(function () {
  'use strict';

  // ── The shared blocks, from ᝯㄝₓ Core ─────────────────────────────────────
  //
  // These used to be copies in this file, pinned byte-identical by a test that could
  // prove the copies agreed and never that this plugin could run one. They are bound
  // here instead: `ui: requires:` in the .yml is topologically sorted by Stash and
  // `useScript` sets `async = false`, so Core has finished running before this line.
  // Binding rather than looking up per call is what keeps every call site below
  // reading exactly as it did when the block was local.
  var C = (window.__GTTx__ || {}).core;
  // The Core floor, ᝯㄝₓ Core 5.7.0 or newer, told by one of its exports (`download`).
  // Below it nothing else in this file can run, and no shared code is left to say so.
  if (!C || typeof C.download !== 'function') {
    if (window.console && console.error) {
      console.error('[fretc] ᝯㄝₓ Find & Replace Entities by Text Content cannot start: it needs ᝯㄝₓ Core 5.7.0 or newer, installed and '
        + 'enabled. Install or update it from the same source and reload the page.');
    }
    return;
  }
  var caseSensitive = C.caseSensitive, fold = C.fold, coop = C.coop, fieldLocks = C.fieldLocks, plural = C.plural,
    linkTarget = C.linkTarget, copyToClipboard = C.copyToClipboard, keepLog = C.keepLog, droppedLine = C.droppedLine,
    holdWidth = C.holdWidth, entityTip = C.entityTip, staleReloadButton = C.staleReloadButton, hasOwn = C.hasOwn, hasClass = C.hasClass,
    gqlRequest = C.gqlRequest, el = C.el, paintButton = C.paintButton, displayName = C.displayName,
    matchesIn = C.occurrences, context = C.matchContext, download = C.download;

  // How many lines a dialog draws at once: Core's Lines Drawn at Once, read where it is used.
  var linesDrawn = C.linesDrawn;
  var PLUGIN_ID   = 'FindEntitiesByTextContent';
  // The name is a display string and the id is the contract: the folder, the plugin id
  // and every storage key are untouched by a rename, which is why one costs a user
  // nothing. What moves with the name is every place this plugin matches Stash's own
  // markup by heading text - Core's `settingsPage` and `ownTaskName`, handed this name -
  // so the three files change together or it stops finding its own settings group and
  // its own task button.
  var PLUGIN_NAME = 'ᝯㄝₓ Find & Replace Entities by Text Content';
  // The name the dialog head wears. `PLUGIN_NAME` is the manifest's and has to stay
  // byte-identical to the `.yml`, because Core's `settingsPage` heading match and
  // `ownTaskName` both find this plugin by it. This one is free to be short, and here it has to be:
  // the head goes on to quote what is being searched for.
  var PLUGIN_SHORT_NAME = 'ᝯㄝₓ Find & Replace';

  // The one version that proves anything. The settings page reads the manifest over
  // GraphQL and goes current the moment plugins are reloaded, while the browser can
  // still be running a script it cached before the edit.
  var PLUGIN_VERSION = '4.11.2';

  // Printed before anything else runs, so a script that loads and then throws is told
  // apart from one that never loaded at all. Through whatever the console offers rather
  // than console.info directly: this is the first statement in the file.
  function fretc(message) {
    if (typeof console !== 'undefined' && (console.info || console.log)) {
      (console.info || console.log).call(console, message);
    }
  }

  fretc('[fretc] FindEntitiesByTextContent.js ' + PLUGIN_VERSION + ' loaded. This is the running ' +
    'script\'s own version - the settings page reads the manifest instead, which can be ' +
    'newer than the script your browser has cached.');

  var README_URL = 'https://github.com/gregttx/GTTxStashPluginsRelease/blob/main/GTTx-FindEntitiesByTextContent/README.md';
  var STYLE_ID = 'fretc-style';

  // Custom Fields Bulk Editor keeps its field descriptions as JSON in a tag's text, and a
  // substring rewrite is how a JSON store stops parsing. The tag marks itself with a custom
  // field, so it is recognised whatever it is named, and skipped whole.
  // COMPAT: `cfbe_desc_store`, the marker's name before CustomFieldsBulkEditor 2.0.1 renamed it
  // (since CustomFieldsBulkEditor 2.0.1); remove when no store can still wear it - never on its
  // own: CustomFieldsBulkEditor upgrades a store only the next time its own dialog finds it.
  var CFBE_STORE_FIELDS = ['ᱜ╦╦🞮_🛂🧲_🛠🛈🖫_desc_store', 'cfbe_desc_store'];
  var CFBE_NAME = 'ᝯㄝₓ Custom Fields Bulk Editor';
  function isPluginStore(ent) {
    var cf = ent && ent.custom_fields;
    if (!cf || typeof cf !== 'object') return false;
    for (var i = 0; i < CFBE_STORE_FIELDS.length; i++) if (hasOwn(cf, CFBE_STORE_FIELDS[i])) return true;
    return false;
  }

  // **Orange (`btn-warning`), because Replace writes.** The repo's rule is that a plugin's
  // own control is orange where it writes and Stash's blue where it only reads, and the task
  // button is the way to the dialog that offers the write - exactly the shape of
  // `MergePerformerTagsToScenes`' orange task button, whose task also writes nothing until
  // a second, deliberate press. The filter toggles wear the same orange for the color's
  // other job, marking a control as ours; they are a separate constant so the two reasons
  // cannot be read as one.
  var PLUGIN_BTN_VARIANT = 'btn-warning';
  // A filter that is letting its category through, in the same orange every other control
  // these plugins draw wears. It marks the control as *ours* - the color's other job -
  // rather than saying the filter writes, which it does not. Kept in a constant of its
  // own precisely so the two reasons cannot be read as one.
  var FILTER_ON_VARIANT = 'btn-warning';

  var READ_PAGE     = 500;   // entities per page of the scan
  var HISTORY_MAX   = 50;    // the most previous searches the box will keep
  var TICK_MS       = 1000;
  // The busy cursor under the last line of the log. The counters say how far the search
  // has got; this says it is still going, which is the question a page of 500 entities
  // leaves unanswered for seconds at a time.

  // Where the dialog keeps what the user asked it to remember. Under the one global this
  // repo reserves, so it cannot collide with another plugin's key.
  var STORE_KEY = '__GTTx__.fretcSearch';
  // The key this used before the acronym moved. Read when the current key holds nothing
  // and **written back under the new name on that read**, not on the next save - a user
  // who never saves anything would otherwise carry the old key for the life of the
  // browser profile, which works but leaves the migration permanently un-taken. The old
  // entry is left where it is rather than deleted: it costs a few hundred bytes in one
  // browser, and a delete is the one operation that cannot be taken back if this
  // migration is wrong.
  // COMPAT: the `__GTTx__.fetcSearch` key from before the acronym moved (since
  // FindEntitiesByTextContent 2.0.1); remove when never on its own: a browser may skip releases.
  var LEGACY_STORE_KEY = '__GTTx__.fetcSearch';

  // ── The seven entity-types ────────────────────────────────────────────────
  //
  // Core's `entityTypes`: the table (`fields` are candidates, settled against the running
  // Stash by `describeFields`), the order a search walks it in, one label per field, and
  // the `FRETC_Shapes` and `FRETC_Scan` queries.
  var TEXT = C.entityTypes('FRETC');
  var ENTITIES = TEXT.types, TYPE_ORDER = TEXT.order, FIELD_LABEL = TEXT.fieldLabel;
  var describeFields = TEXT.describeFields, pageQuery = TEXT.pageQuery;
  var CF_NAME_LABEL  = 'Custom field name';
  var CF_VALUE_LABEL = 'Custom field value';
  // The names of a scene's, image's or gallery's files and a gallery's folder: found by a search
  // and exported, never rewritten - renaming a file on disk is Scene Filename Manager's.
  var FILE_LABEL = 'File names';

  // ── No settings ───────────────────────────────────────────────────────────
  //
  // This plugin declares none, and that is a decision rather than an oversight. Every
  // choice it offers - what to look for, which types to read, what to remember - is made
  // inside the dialog, where the user already is, and answered on the spot. A console
  // switch was the one setting it had; it duplicated Copy log, which hands over the same
  // lines plus every result, and reached the console of a page the user only opens to
  // read a list on screen. Where the Case-sensitive box starts is ᝯㄝₓ Core's setting,
  // shared by every plugin with such a box.
  //
  // Two consequences worth knowing, because both are load-bearing:
  //
  //   - **Stash still renders a group, a heading and a description for it**, which is the
  //     first thing anyone reads before installing. So the description half of the shared
  //     settings design still applies here in full; only the per-*setting* tooltip does
  //     not, because there is no setting row for one to open from.
  //   - **There is no `plugin-<id>-<key>` id to anchor on**, so Core's `settingsPage`,
  //     handed no keys, finds the group by the heading alone - exactly, never by prefix -
  //     and passes over the Settings → Tasks group by its task caption.

  // **This plugin is on the bulk side of the lease protocol and on neither other side,
  // and exactly one of its four absences moved when Replace arrived.** It reacts to nothing, so it still registers no `respecters` entry; it
  // performs no relationship copy, so any path id in `declares` would still be a lie; it
  // draws no button into an entity's action row, so it still takes no `order` priority.
  // What changed is that Replace rewrites many entities on purpose, which is a bulk run
  // by any measure, so it takes a lease for the duration - the same one-of-five edit
  // `SceneVariants` made when its migration task arrived. A plugin's list of absences is
  // a set of separate claims, not one claim about the plugin.
  //
  // `coop()` still creates all four fields, for shape-consistency with its siblings.
  //
  // It does note a foreign lease in its log, which is not standing down: a bulk run in
  // another dialog is rewriting the very entities this search is reading, so a result may
  // be a moment out of date. Saying so costs a line; refusing to search would be absurd.
  //
  // The lease is Core's `lease`, renewed per batch rather than taken once for the whole
  // write, because a replacement across a large library can outlast any sane fixed
  // expiry, and released in every outcome - success, failure, the dialog being closed - so a reactive sibling is never
  // left standing down. The expiry is the backstop for the one outcome neither can catch:
  // the tab going away mid-run.
  var LEASE_TTL_MS = 60000;

  // ── What the dialog remembers ─────────────────────────────────────────────
  //
  // In `localStorage`, so it is this browser's rather than the server's, and so that a
  // search never writes to the library or to the plugin configuration. Both halves are
  // opt-in from inside the dialog: the types are only kept while "Remember filters" is
  // ticked, and a search only joins the history while the history is set to hold more
  // than nothing.
  //
  // Every read and write is wrapped: a browser with storage disabled, or a private
  // window, throws on the accessor itself rather than returning null.
  function readStore() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      var legacy = false;
      // COMPAT: the pre-2.0.1 key, taken over on this read (since FindEntitiesByTextContent
      // 2.0.1); remove when never on its own: a browser may skip releases.
      if (!raw) {
        raw = window.localStorage.getItem(LEGACY_STORE_KEY);
        legacy = !!raw;
      }
      var v = raw ? JSON.parse(raw) : null;
      if (!v || typeof v !== 'object') return {};
      // Taken over on the read that found it. After this the new key answers, so the
      // fallback above never fires again and this costs one write per browser.
      if (legacy) writeStore(v);
      return v;
    } catch (e) {
      return {};
    }
  }

  function writeStore(v) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(v));
    } catch (e) { /* a browser that will not store is not a reason to refuse a search */ }
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  var CSS =
    // Kept literally identical to the sibling plugins' stylesheets wherever the dialogs
    // overlap, down to the hex values. They are separate strings because the plugins
    // share no module, not because they are meant to look different - and two of them
    // did drift, from #202b33 to #30404d, because nothing compared them.
    // `.tests/style.test.js` pins the overlap. #202b33 is Blueprint's dark-gray2, the
    // step Stash's own page uses; every dim gray in these dialogs was chosen against it.
    '.fretc-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);' +
    'z-index:1600;display:flex;align-items:center;justify-content:center;}' +
    '.fretc-modal{background:var(--gttx-bg,#202b33);color:var(--gttx-fg,#f5f8fa);border:1px solid var(--gttx-border,#394b59);border-radius:4px;' +
    'width:min(100rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
    '.fretc-head{padding:.75rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);}' +
    '.fretc-title{font-size:1.1rem;font-weight:600;}' +
    '.fretc-warn{color:var(--gttx-highlight,#ffc107);margin-top:.35rem;}' +
    '.fretc-note{color:var(--gttx-muted,#a7b6c2);margin-top:.35rem;}' +
    '.fretc-legend{color:var(--gttx-dim,#7d8f9c);margin-top:.35rem;font-size:.8rem;}' +
    '.fretc-progress{padding:.5rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);color:var(--gttx-muted,#a7b6c2);' +
    'white-space:pre-wrap;}' +
    '.fretc-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;font-family:monospace;font-size:.8rem;' +
    'line-height:1.35;min-height:14rem;}' +
    '.fretc-line{white-space:pre-wrap;word-break:break-word;}' +
    '.fretc-stale{margin:.5rem 0;padding:.6rem .75rem;border-left:4px solid #ff7373;' +
    'background:rgba(255,115,115,.14);color:#ff7373;font-size:.95rem;line-height:1.45;' +
    'font-weight:600;}' +
    '.fretc-ERROR{color:#ff7373;} .fretc-WARN{color:var(--gttx-highlight,#ffc107);} .fretc-INFO{color:var(--gttx-muted,#a7b6c2);}' +
    // The green the siblings give a line that says something landed in the library.
    '.fretc-EDIT{color:#84d68a;}' +
    '.fretc-foot{padding:.75rem 1rem;border-top:1px solid var(--gttx-border,#394b59);display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.fretc-foot button{margin-right:.5rem;}' +
    // **`!important`, because a hidden utility that loses a cascade is not one.** Every
    // one of these rules is a single class, so the last one written wins - and this one
    // is written before the strips and rows that set their own `display`. A `-hidden` on
    // one of those did nothing at all, which is how Find & Replace shipped a row that
    // stayed on screen with the checkbox that reveals it switched off.
    '.fretc-hidden{display:none !important;}' +
    '.fretc-search{padding:.5rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);position:relative;' +
    'display:flex;gap:.5rem;align-items:center;}' +
    '.fretc-label{color:var(--gttx-muted,#a7b6c2);font-size:.85rem;white-space:nowrap;}' +
    '.fretc-textbox{background:var(--gttx-bg,#1f2b33);color:var(--gttx-fg,#f5f8fa);border:1px solid var(--gttx-border,#394b59);border-radius:3px;' +
    'padding:.25rem .5rem;flex:1 1 12rem;min-width:8rem;}' +
    // The × that empties the box, inside it. `NormalizeParentTags` got here first and
    // these two rules are its, byte-identical with the prefix swapped - a class two
    // plugins share has to mean the same thing in both, and this one does. The right
    // padding above is what keeps the text clear of the icon.
    '.fretc-inputwrap{position:relative;display:flex;align-items:center;flex:1 1 0;}' +
    '.fretc-clear{position:absolute;right:.35rem;top:50%;transform:translateY(-50%);' +
    'background:none;border:0;color:var(--gttx-muted,#a7b6c2);font-size:1.1rem;line-height:1;cursor:pointer;' +
    'padding:0 .35rem;}' +
    '.fretc-clear:hover{color:var(--gttx-fg,#f5f8fa);}' +
    // The right padding that keeps the typed text clear of the icon, as a modifier
    // beside the pinned `.textbox` rule rather than an edit to it - `EntityNameMaintainer`
    // shares that rule and its box has no ×.
    '.fretc-searchbox{padding-right:1.9rem;}' +
    // A fixed height rather than the shared `max-height` alone: rows arrive while the
    // user is reading, and a content-sized modal would grow under the pointer with every
    // page of results. The modifier pattern `CustomFieldsBulkEditor` established - a
    // class beside the pinned rule, never an edit to what the other plugins share.
    '.fretc-modal.fretc-tall{height:88vh;}' +
    '.fretc-search-wrap{flex-wrap:wrap;}' +
    // ── This dialog's own ───────────────────────────────────────────────────
    //
    // The filter strip, byte-identical to `EntityNameMaintainer`'s: same control, same
    // meaning, one row of small toggles under the head.
    // The rows on the left, and on the right the buttons that act on them all - beside what they change
    // rather than in the footer, wrapping under the rows where the dialog is narrow.
    '.fretc-filters{padding:.4rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);display:flex;' +
    'flex-wrap:wrap;align-items:flex-start;gap:.3rem .75rem;}' +
    '.fretc-filterrows{flex:1 1 20rem;min-width:0;display:flex;flex-direction:column;gap:.3rem;}' +
    '.fretc-filterall{display:flex;gap:.35rem;flex-wrap:wrap;margin-left:auto;}' +
    '.fretc-filterrow{display:flex;gap:.35rem;align-items:center;flex-wrap:wrap;}' +
    '.fretc-filterbtn{font-size:.78rem;padding:.05rem .4rem;}' +
    // The box a tag's tooltip opens instead of the browser's own, which cannot hold a
    // picture. Fixed to the viewport and placed from the node, because the logs these
    // open over are `overflow:auto` boxes that would clip a positioned child against
    // their own top edge. `pointer-events:none` is load-bearing: a box that took the
    // pointer would fire mouseleave on the node, close, hand the pointer back and
    // reopen. Unprefixed, like the Reload UI button's id - six plugins draw this one
    // box and it belongs to none of them.
    '.gttx-tipbox{display:none;position:fixed;left:0;top:0;z-index:1700;' +
    'width:20rem;max-width:90vw;padding:.5rem .65rem;background:var(--gttx-bg,#202b33);color:var(--gttx-fg2,#d6dee4);' +
    'border:1px solid var(--gttx-border-strong,#425a6b);border-radius:3px;font-size:.8rem;line-height:1.45;' +
    'white-space:pre-wrap;pointer-events:none;text-align:left;font-family:inherit;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.gttx-tipbox.gttx-tip-open{display:block;}' +
    '.gttx-tipbox img{display:block;width:100%;max-height:14rem;object-fit:contain;' +
    'margin-bottom:.4rem;border-radius:3px;background:var(--gttx-sunken,#111a20);}' +
    '.fretc-ent{text-decoration:none;}' +
    '.fretc-ent:hover{text-decoration:underline;}' +
    '.fretc-attr{color:var(--gttx-muted,#a7b6c2);}' +
    // The highlight: the one thing on a result line that asks for a second look before Replace.
    '.fretc-casediff{color:var(--gttx-highlight,#ffc107);white-space:nowrap;}' +
    '.fretc-ctx{overflow-wrap:anywhere;word-break:break-word;}' +
    '.fretc-mark{background:var(--gttx-match-bg,#3f6b46);border-radius:2px;padding:0 .1rem;}' +
    '.fretc-spacer{flex:1 1 auto;}' +
    // One entity per line. Not `.fretc-hitrow`: `EntityNameMaintainer`'s row is a decision
    // with a checkbox in it, and this one is a link - a class two plugins share has to
    // mean the same thing in both.
    // Text that flows, not flex columns: as columns a long name ran over the attributes
    // beside it. A hanging indent sets every wrapped line in from the first.
    '.fretc-pager{position:sticky;top:-.5rem;z-index:2;background:var(--gttx-bg,#202b33);margin:0;padding:.25rem 0;}' +
    '.fretc-result{padding:.1rem .25rem .1rem 1.25rem;text-indent:-1rem;overflow-wrap:anywhere;}' +
    '.fretc-result>*{margin-right:.5rem;}' +
    '.fretc-result:hover{background:var(--gttx-raised,#3c4f5d);}' +
    // The two remembering controls, grouped so that they line up with each other and
    // sit a clear step away from the search box rather than at the row's own gap.
    '.fretc-opts{display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;' +
    'margin-left:.5rem;}' +
    '.fretc-num{background:var(--gttx-card,#30404d);color:var(--gttx-fg,#f5f8fa);border:1px solid var(--gttx-border,#394b59);border-radius:3px;' +
    'padding:.25rem .35rem;width:4rem;}' +
    // As wide as its longest format, not the number boxes' 4rem.
    'select.fretc-format{width:auto;}' +
    '.fretc-check{display:flex;align-items:center;gap:.35rem;color:var(--gttx-muted,#a7b6c2);font-size:.85rem;' +
    'white-space:nowrap;cursor:pointer;margin:0;}' +
    // A checkbox carries browser margins that put it off the row's centre line.
    '.fretc-check input{margin:0;}' +
    // The sentence beside the replacement box. The log's own dim gray, and allowed to
    // wrap onto its own line on a narrow window - the row is already `flex-wrap`.
    '.fretc-hint{color:var(--gttx-dim,#7d8f9c);font-size:.8rem;}' +
    '.fretc-readme{font-size:.8rem;margin-top:.35rem;display:inline-block;}' +
    // ── The settings page ───────────────────────────────────────────────────
    //
    // Stash renders the description as one text node in a `.sub-heading` that is
    // `white-space: normal`, and a description cannot carry markup - it is passed to
    // React as a child, so any tag in it is escaped. So the blank lines are made visible
    // by the class, and then rebuilt as divs.
    //
    // Scoped to our own group, never applied to `.sub-heading` at large - another
    // plugin's description is not ours to reflow.
    '.fretc-own-group .sub-heading{white-space:pre-wrap;}' +
    '.fretc-own-group .sub-heading .fretc-p{margin:0 0 .35em;}' +
    '.fretc-own-group .sub-heading .fretc-p:last-child{margin-bottom:0;}' +
    '.fretc-desc-collapsed .fretc-p:not(:first-child){display:none;}' +
    '.fretc-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:var(--gttx-accent,#7cc4ff);font-size:.8rem;cursor:pointer;' +
    // **No per-setting hover box and no color-coded toggle**, because this plugin
    // declares no settings: both would style rows Stash never renders for it. The blue is
    // not lost - it is on the task button, which Core's `paintTaskButtons` sets.
    'text-decoration:underline;}';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.body || document.documentElement).appendChild(style);
  }

  // A `<datalist>` renders nothing of its own, so there is no empty state to draw and
  // nothing to hide when the history is switched off - an empty list is simply a box that
  // suggests nothing, which is exactly right. Two boxes have one now, which is why this
  // is a function rather than a loop in one method.
  function fillDatalist(list, items) {
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    items.forEach(function (t) {
      var o = el('option');
      o.value = t;
      list.appendChild(o);
    });
  }

  function button(label, className) {
    var b = el('button', 'btn btn-secondary btn-sm' + (className ? ' ' + className : ''), label);
    b.type = 'button';
    return b;
  }

  // ── What the running Stash actually stores ────────────────────────────────
  //
  // Core's `describeFields` settles which text fields the object types have. **The write
  // half of the same question is a different question.** A field can
  // exist on the object type and not on the update input, or be spelled differently
  // there, and a mutation naming one Stash does not have fails outright - taking the
  // whole entity's replacement with it. So the inputs are introspected too, once per
  // page, and a field the input does not carry is dropped with a line saying so rather
  // than being sent hopefully.
  //
  // `inputFields`, not `fields`: an input object type has no `fields` at all, and asking
  // for the wrong one returns null for every type - which would read as "this Stash has
  // no update inputs" and skip every write in silence.
  var _inputs = null;

  function describeInputs() {
    if (_inputs) return Promise.resolve(_inputs);
    return TEXT.introspect('input', 'inputFields', 'FRETC_Inputs')
      .then(function (out) { _inputs = out; return out; });
  }

  // ── Finding the text ──────────────────────────────────────────────────────

  // **`cased` is passed rather than read from anywhere**, because the two callers get it
  // from different places: the scan reads what the search was *started* with, and a
  // replacement reads the same captured value rather than what the checkbox says now.
  // A default of false keeps every existing call site meaning what it meant.
  //
  // Core's `occurrences` refuses a field whose fold changes length rather than search it
  // at offsets that would not point into the original; this counts each refusal, for the
  // line that says how many fields a search or a Replace could not read.
  var _foldSkips = 0;

  // **`whole` keeps a match only where it is a whole word**: no letter or digit (Core's `wordChars`)
  // runs on into it from either side. A needle that starts or ends on a space or a hyphen is
  // bounded by that character itself, as Whole word means anywhere else.
  var WORD_CHAR = new RegExp('[' + C.wordChars + ']');
  function occurrences(text, needle, cased, whole) {
    var out = matchesIn(text, needle, cased);
    if (out.refused) _foldSkips++;
    if (!whole || !out.length) return out;
    var s = String(text), n = String(needle).length, w = function (i) { return WORD_CHAR.test(s.charAt(i)); };
    return out.filter(function (at) {
      return !(at > 0 && w(at - 1) && w(at)) && !(w(at + n - 1) && w(at + n));
    });
  }

  // Every occurrence replaced, matched the way the search matched them - a plain
  // case-insensitive substring. **The replacement goes in exactly as typed**, whatever
  // case the text it displaces was in: guessing that a capitalised match wanted a
  // capitalised replacement is a rule nobody asked for, and a wrong guess is a wrong
  // word in the library. Written from `indexOf` rather than a RegExp because the needle
  // is the user's literal text - `.` and `(` in a box are characters, not syntax.
  //
  // The offsets are `occurrences`', so its refusal of a field whose fold changes length
  // holds here too: a field the scan refused yields none and is returned untouched,
  // never rewritten from offsets nothing computed.
  function replaceAllIn(text, needle, to, cased, whole) {
    var str = String(text);
    var len = (cased ? String(needle) : fold(needle)).length;
    var out = '';
    var i = 0;
    occurrences(str, needle, cased, whole).forEach(function (at) { out += str.slice(i, at) + to; i = at + len; });
    return out + str.slice(i);
  }

  // How many entities the chosen types hold, in one query before the first page. The
  // scan already receives a `count` with every page, and accumulating those was the
  // cheaper option and the wrong one: a denominator that grows as each new type is reached
  // reads as the target moving - "500 of 500", then "500 of 1700". One round trip buys a
  // number that means the same thing from the first page to the last.
  //
  // `per_page: 1` rather than 0, which is not a size any of these queries promises to
  // honour; one row per type is not worth avoiding.
  function countOf(types) {
    if (!types.length) return Promise.resolve({ total: 0, per: {} });
    var parts = types.map(function (k) {
      return k + ': ' + ENTITIES[k].find + '(filter: { per_page: 1 }) { count }';
    });
    return gqlRequest('query FRETC_Counts { ' + parts.join(' ') + ' }', null)
      .then(function (data) {
        var out = { total: 0, per: {} };
        types.forEach(function (k) {
          out.per[k] = ((data[k] || {}).count) || 0;
          out.total += out.per[k];
        });
        return out;
      });
  }

  // Every text value of an entity, as `each(label, text)`: a field's string, each string of a list,
  // and each custom field's name and its value where that is a string. A custom field can hold a
  // number or an object, and neither is text a search or an export has any business claiming.
  // The custom-field map's key is one string and its value another, under two labels, because
  // they are two different things to have found. The file names come last. `on(label)`, where
  // given, is the attributes turned on: the rest are not read.
  function eachText(shapes, ent, each, on) {
    var take = function (label, text) { if (!on || on(label)) each(label, text); };
    shapes.forEach(function (f) {
      var v = ent[f.name];
      var label = FIELD_LABEL[f.name] || f.name;
      if (f.kind === 'string') {
        if (typeof v === 'string') take(label, v);
        return;
      }
      if (f.kind === 'list') {
        if (v && v.length) v.forEach(function (str) { if (typeof str === 'string') take(label, str); });
        return;
      }
      if (!v || typeof v !== 'object') return;
      Object.keys(v).forEach(function (key) {
        take(CF_NAME_LABEL, key);
        if (typeof v[key] === 'string') take(CF_VALUE_LABEL, v[key]);
      });
    });
    fileNames(ent).forEach(function (n) { take(FILE_LABEL, n); });
  }

  // The attributes a type has, as the Attributes row names them: a field's label, the custom
  // fields' two, and File names where the type's query reads them.
  function attrsOf(spec, fields) {
    var out = [];
    var add = function (label) { if (out.indexOf(label) === -1) out.push(label); };
    (fields || []).forEach(function (f) {
      if (f.kind === 'map') { add(CF_NAME_LABEL); add(CF_VALUE_LABEL); } else add(FIELD_LABEL[f.name] || f.name);
    });
    if (/basename/.test(spec.extra || '')) add(FILE_LABEL);
    return out;
  }

  // The fields with an attribute turned on - what JSON and YAML carry. A read still asks for
  // every field: a title or a name is also what a result is shown by.
  function readFields(fields, on) {
    return (fields || []).filter(function (f) {
      return f.kind === 'map' ? on(CF_NAME_LABEL) || on(CF_VALUE_LABEL) : on(FIELD_LABEL[f.name] || f.name);
    });
  }

  // Whether a type leaves anything to read once the attributes turned off are left out.
  function readsAny(spec, fields, on) {
    return attrsOf(spec, fields).some(on);
  }

  // One result per *entity*, not per occurrence: the question this plugin answers is
  // which entities mention the text, and a scene whose details say it nine times is one
  // scene. The attributes it matched in, with a count each, are on the line; the first
  // match's surroundings are what the line shows.
  function scanEntity(spec, shapes, ent, needle, cased, on, whole) {
    var attrs = [];
    var index = {};
    // One context per *attribute*, rather than one for the whole result. The line shows
    // the surroundings of the first match in the first attribute still showing, so a
    // filter that hides Title cannot leave a line quoting the title it just hid.
    // `differs` counts the matches written in another case than the text searched for -
    // "Beach" for "beach" - which a line marks, since a replacement rewrites them too.
    function add(label, source, pos) {
      if (!hasOwn(index, label)) {
        index[label] = { label: label, count: 0, differs: 0, ctx: context(source, pos, needle.length) };
        attrs.push(index[label]);
      }
      index[label].count++;
      if (!cased && String(source).substr(pos, needle.length) !== String(needle)) {
        index[label].differs++;
      }
    }
    eachText(shapes, ent, function (label, text) {
      occurrences(text, needle, cased, whole).forEach(function (p) { add(label, text, p); });
    }, on);
    if (!attrs.length) return null;
    return {
      typeKey: spec.key, id: String(ent.id), name: displayName(ent) || '',
      attrs: attrs,
    };
  }

  // ── Export ────────────────────────────────────────────────────────────────
  //
  // Every text value of every type turned on, read as a search reads it, saved as one file
  // through the browser's download - no search text needed. The format is chosen in the
  // dialog, not in a setting, while the formats are still settling. Text is the values
  // alone; JSON and YAML keep which entity each came from; Term counts is a table of the
  // words and phrases the text uses most, for finding what De-Spicer's Explicit Terms
  // should carry next. File and folder names are text in the library too, and De-Spicer
  // rewrites them, so an export carries them where the page already reads them.
  var MIN_COUNT_DEFAULT = 2;
  var MAX_PHRASE = 3;   // words in the longest phrase Term counts lists
  var EXPORT_FORMATS = [
    { key: 'text', label: 'Text', ext: 'txt', type: 'text/plain',
      tip: 'Every value on a line of its own - a field, a custom field\'s name and value, a file name - with nothing ' +
        'saying which entity it came from.' },
    { key: 'json', label: 'JSON', ext: 'json', type: 'application/json',
      tip: 'One array, one entity a line: its type, its id and every text field holding something.' },
    { key: 'yaml', label: 'YAML', ext: 'yaml', type: 'text/yaml',
      tip: 'What JSON holds, as YAML: an item per entity, its fields beneath it.' },
    { key: 'terms', label: 'Term counts (CSV)', ext: 'csv', type: 'text/csv',
      tip: 'A table of every word, and every phrase of up to ' + MAX_PHRASE + ' words, used at least Min count times, most ' +
        'used first: its length, how often it occurs in all, how often outside a longer phrase listed, and whether ' +
        'De-Spicer\'s Explicit Terms already carry it, with what it becomes.' },
  ];

  function formatOf(key) {
    return EXPORT_FORMATS.filter(function (f) { return f.key === key; })[0] || EXPORT_FORMATS[0];
  }

  // The names of an entity's files and folder, where the scan's query reads them.
  function fileNames(ent) {
    var out = [];
    [ent.files, ent.visual_files].forEach(function (list) {
      (list || []).forEach(function (f) { if (f && typeof f.basename === 'string' && f.basename) out.push(f.basename); });
    });
    if (ent.folder && typeof ent.folder.basename === 'string' && ent.folder.basename) out.push(ent.folder.basename);
    return out;
  }

  // An entity as JSON and YAML give it: the fields holding something, by the names Stash
  // gives them, and its file names. The custom fields go whole where either of their two
  // attributes is on.
  function exportItem(spec, shapes, ent, on) {
    var fields = {};
    readFields(shapes, on).forEach(function (f) {
      var v = ent[f.name];
      if (f.kind === 'string') { if (typeof v === 'string' && v) fields[f.name] = v; return; }
      if (f.kind === 'list') {
        var list = (v || []).filter(function (x) { return typeof x === 'string' && x; });
        if (list.length) fields[f.name] = list;
        return;
      }
      if (v && typeof v === 'object' && Object.keys(v).length) fields[f.name] = v;
    });
    var files = on(FILE_LABEL) ? fileNames(ent) : [];
    if (files.length) fields.file_names = files;
    return { type: spec.gqlType, id: String(ent.id), fields: fields };
  }

  // A YAML double-quoted scalar: JSON's string is one, once the characters YAML will not take
  // raw - DEL, the C1 controls, the byte order mark and the two Unicode line breaks - are
  // escaped too. A number, a boolean or null from a custom field is written as JSON writes it,
  // which YAML reads the same; an object as a JSON flow mapping, which it reads as well.
  function yq(v) {
    return JSON.stringify(v).replace(/[\u007f-\u009f\u2028\u2029\ufeff]/g, function (c) {
      return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  function yamlItem(item) {
    var out = '- type: ' + yq(item.type) + '\n  id: ' + yq(item.id) + '\n  fields:' +
      (Object.keys(item.fields).length ? '\n' : ' {}\n');
    Object.keys(item.fields).forEach(function (k) {
      var v = item.fields[k];
      if (typeof v === 'string') { out += '    ' + k + ': ' + yq(v) + '\n'; return; }
      out += '    ' + k + ':\n';
      if (Object.prototype.toString.call(v) === '[object Array]') {
        v.forEach(function (x) { out += '      - ' + yq(x) + '\n'; });
      } else {
        Object.keys(v).forEach(function (key) { out += '      ' + yq(key) + ': ' + yq(v[key]) + '\n'; });
      }
    });
    return out;
  }

  // The words of a text, lowered, in the runs a phrase may cross: words joined only by spaces,
  // dashes, underscores or dots, which is what De-Spicer finds a term of several words across.
  // Anything else between two words - a comma, a bracket, a quote - ends the run. A word is
  // Core's `wordChars`, De-Spicer's own, so a phrase counted is one a term can name; an
  // apostrophe inside a word keeps it whole ("don't").
  var WORD_RE = new RegExp('[' + C.wordChars + ']+(?:[\'\u2019][' + C.wordChars + ']+)*', 'g');
  var JOIN_RE = /^[\s_.\-]+$/;
  function wordRuns(text, each) {
    var run = [], last = -1, m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(text)) !== null) {
      if (last !== -1 && !JOIN_RE.test(text.slice(last, m.index))) { each(run); run = []; }
      run.push(m[0].toLowerCase());
      last = m.index + m[0].length;
    }
    if (run.length) each(run);
  }

  // Every word and phrase of up to MAX_PHRASE words found at least `min` times across `texts`,
  // the longest phrases first, then the most used, then the most often in a longer phrase:
  // `{ term, words, total, inside, spellings }`. A row is every spelling with
  // the same words run together - "blow job", "blow-job" and "blowjob" are one, as De-Spicer finds
  // one term in all three - shown as its most used spelling, `spellings` listing them all where
  // there is more than one. `inside` is the occurrences that sit inside an occurrence of a longer
  // phrase also listed - `total - inside` is how often it stands on its own. A phrase is counted
  // only where both shorter phrases in it were kept, since it cannot occur more often than either;
  // that keeps the phrases nobody repeats - most of them - from ever being held. A phrase left out
  // that way is still added to a row another spelling of it started.
  // ponytail: whole passes on the main thread, every text held until the end; a worker, or
  // counting page by page and pruning, if a large library freezes the tab or runs it out of memory.
  // ponytail: a row only some spelling of which was counted; one whose every spelling is a phrase
  // left out ("big blackcock" and "big black cock", "big" rare) can fall short of Min count.
  function termCounts(texts, min) {
    var kept = Object.create(null), spelled = Object.create(null), joins = Object.create(null);
    var key = function (w, i, n) { return w.slice(i, i + n).join(' '); };
    var joined = function (w, i, n) { return w.slice(i, i + n).join(''); };
    var count = function (n, counts) {
      return function (w) {
        for (var i = 0; i + n <= w.length; i++) {
          if (n > 1 && !(kept[key(w, i, n - 1)] && kept[key(w, i + 1, n - 1)])) continue;
          var k = key(w, i, n);
          counts[k] = (counts[k] || 0) + 1;
        }
      };
    };
    var n, k;
    for (n = 1; n <= MAX_PHRASE; n++) {
      var counts = Object.create(null), each = count(n, counts);
      texts.forEach(function (t) { wordRuns(t, each); });
      for (k in counts) {
        spelled[k] = counts[k];
        joins[k.replace(/ /g, '')] = true;
        if (counts[k] >= min) kept[k] = true;
      }
    }
    var late = Object.create(null);
    texts.forEach(function (t) {
      wordRuns(t, function (w) {
        for (var m = 2; m <= MAX_PHRASE; m++) {
          for (var i = 0; i + m <= w.length; i++) {
            var p = key(w, i, m);
            if (!(p in spelled) && joins[joined(w, i, m)]) late[p] = (late[p] || 0) + 1;
          }
        }
      });
    });
    for (k in late) spelled[k] = late[k];
    var groups = Object.create(null), rows = [], listed = Object.create(null);
    for (k in spelled) (groups[k.replace(/ /g, '')] = groups[k.replace(/ /g, '')] || []).push(k);
    Object.keys(groups).forEach(function (g) {
      var list = groups[g], total = 0;
      list.forEach(function (sp) { total += spelled[sp]; });
      if (total < min) return;
      list.sort(function (a, b) { return spelled[b] - spelled[a] || (a < b ? -1 : a > b ? 1 : 0); });
      rows.push(listed[g] = { term: list[0], words: list[0].split(' ').length, total: total, inside: 0,
        spellings: list.length > 1 ? list.map(function (sp) { return sp + ' (' + spelled[sp] + ')'; }) : [] });
    });
    var covered = function (w, i, n) {
      for (var m = n + 1; m <= MAX_PHRASE; m++) {
        for (var j = Math.max(0, i + n - m); j <= i && j + m <= w.length; j++) if (listed[joined(w, j, m)]) return true;
      }
      return false;
    };
    texts.forEach(function (t) {
      wordRuns(t, function (w) {
        for (var n = 1; n < MAX_PHRASE; n++) {
          for (var i = 0; i + n <= w.length; i++) {
            var e = listed[joined(w, i, n)];
            if (e && covered(w, i, n)) e.inside++;
          }
        }
      });
    });
    return rows.sort(function (a, b) {
      return b.words - a.words || b.total - a.total || b.inside - a.inside || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0);
    });
  }

  // A CSV cell, quoted where it has to be (RFC 4180).
  function csvCell(v) {
    var str = String(v);
    return /[",\r\n]|^\s|\s$/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  }

  // De-Spicer's answer to "is this phrase an Explicit Term, and what does it become?", by its
  // own matching rules (`coop().api.DeSpicer.terms`). Null where it is not here; false where
  // it is and could not answer.
  function deSpicerTerms() {
    var api = (coop().api || {}).DeSpicer;
    if (!api || typeof api.terms !== 'function') return Promise.resolve(null);
    return Promise.resolve().then(function () { return api.terms(); })
      .then(function (w) { return w && typeof w.lookup === 'function' ? w : false; },
        function () { return false; });
  }

  // The file's name: what made it, and when, to the minute, in the browser's own time.
  function exportName(fmt) {
    var d = new Date(), two = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'fretc-export-' + d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + '-' +
      two(d.getHours()) + two(d.getMinutes()) + '.' + fmt.ext;
  }

  // ── The task ──────────────────────────────────────────────────────────────
  //
  // Declared in the yml so Stash renders a button for it in Settings → Tasks, and
  // handled entirely here: the click never reaches the server, because there is no
  // `exec` behind it and nothing server-side to run. A capture-phase listener on
  // `document` runs before React's own handler and stops the propagation, which is what
  // keeps PluginTasks' "added job to queue" toast from appearing over a dialog that is
  // already open.
  var TASK_NAME = 'Find & Replace Entities by Text Content...';

  // Ours only if the label matches *and* the enclosing SettingGroup is headed with our
  // name - another plugin may declare a task called the same thing. Core's `ownTaskName`
  // answers that, and `paintTaskButtons` re-paints ours every tick, since React hands back
  // a button with Stash's own classes on every re-render.
  var TASKS = [TASK_NAME];

  if (document.addEventListener) {
    document.addEventListener('click', function (event) {
      var target = event.target;
      var btn = target && target.closest ? target.closest('button') : null;
      if (!btn || !C.ownTaskName(btn, PLUGIN_NAME, TASKS)) return;
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      startRun();
    }, true);
  }

  // ── The dialog ────────────────────────────────────────────────────────────

  var _active = null;

  // Opens once Core's Case-Sensitive Matching is read, fresh, so flipping it and pressing
  // the button in one page session does what it says. Unreadable, it is off: a search is
  // worth more than the one box's starting place.
  var _opening = false;
  function startRun() {
    if (_active) { _active.focus(); return; }
    if (_opening) return;
    _opening = true;
    caseSensitive().then(null, function () { return false; }).then(function (cs) {
      _opening = false;
      _active = new Run(cs);
      _active.begin();
    });
  }

  function Run(matchCase) {
    var stored = readStore();
    // Off by default, as asked: a search that covered everything the first time it was
    // opened would read the whole library before the user had chosen anything.
    this.typeOn = {};
    var remembered = stored.persist && stored.types ? stored.types : null;
    TYPE_ORDER.forEach(function (k) { this.typeOn[k] = !!(remembered && remembered[k]); }, this);
    this.persist = !!stored.persist;
    this.historyMax = Math.max(0, Math.min(HISTORY_MAX, parseInt(stored.historyMax, 10) || 0));
    this.history = (stored.history || []).slice(0, this.historyMax);
    // **One setting, two buffers.** How many are kept is one number - it is a preference
    // about how much the box remembers, and nobody wants to answer it twice - but what is
    // remembered is not: the last thing searched for and the last thing replaced with are
    // different lists, and offering one in the other's box would suggest a value that has
    // never been typed there.
    this.replaceHistory = (stored.replaceHistory || []).slice(0, this.historyMax);
    // **Off every time the dialog opens, never remembered.** "Remember filters" keeps the
    // types, which decide what is *read*; this one decides whether a write is on offer at
    // all, and a control like that starting in the on position because of something the
    // user did last week is the one default worth being conservative about.
    this.replacing = false;
    // **As ᝯㄝₓ Core's Case-Sensitive Matching setting says**, off unless it is on:
    // somebody who wants case-sensitive matching usually wants it every time, and one
    // setting says so once, for every plugin with this box. The box then decides for
    // this dialog. `matchCase` below is what a run actually uses - see `start`.
    this.caseSensitive = !!matchCase;
    // Whole word has no setting of its own in Core, so this browser remembers the box.
    this.wholeWord = !!stored.wholeWord;
    // Leave out what De-Spicer would remove, from a search and an export; this browser remembers it.
    this.skipRemoved = !!stored.skipRemoved;
    // The De-Spicer view in use when the dialog last closed, kept by "Remember filters" and asked of De-Spicer
    // again once the field shapes are in (`shapesIn`); kept while De-Spicer cannot answer, so it comes back with it.
    this.dspWanted = stored.persist && (stored.dspMode === 'fields' || stored.dspMode === 'kept') ? stored.dspMode : null;
    // What a Replace wrote, newest last: `{typeKey, id, input}` where `input` holds the
    // values each entity carried *before* it. That is what Undo sends back, which makes
    // it an exact inverse per field rather than a restore of the whole record.
    this.changes = [];
    // Every entity that matched, in scan order. The rendered rows are a window on this;
    // Copy log takes all of it.
    this.results = [];
    // The attributes turned on, by label: what a search and an export read, and what the
    // list on screen shows. On unless turned off; "Remember filters" keeps the ones turned off.
    this.attrOn = {};
    if (stored.persist && stored.attrsOff) {
      stored.attrsOff.forEach(function (label) { this.attrOn[label] = false; }, this);
    }
    // Where the page on screen starts among the results the attribute filters leave, and how
    // many those are. Previous and Next move it; a filter redraws from it.
    this.pageAt = 0;
    this.shownCount = 0;
    this.rendered = 0;
    this.scanned = 0;
    // `matched` counts entities, `occurs` the matches in them - every occurrence in every attribute read.
    this.matched = 0;
    this.occurs = 0;
    this.occursPer = {};
    // How many entities the chosen types hold, read once before the first page. Null
    // until it lands, and stays null if that one query fails - the counters then say how
    // far it has got without saying how far there is to go, which is what they said
    // before this existed.
    this.total = null;
    // Per type, so the counters say *where* the wait is rather than only how far one
    // number has got. `scannedPer` is what has been read of each, `totals` what there is;
    // a type nobody turned on appears in neither.
    this.scannedPer = {};
    this.totals = {};
    this.searching = [];
    this.needle = '';
    this.loadingWhat = '';
    this.stale = false;
    this.searchFailed = false;
    // 'idle' before a search, 'running', 'paused' (by hand),
    // 'done'. One word decides the button caption, the cursor and what the counters say.
    this.state = 'idle';
    // Bumped on every Search and Refresh, so a page that was already in flight when the
    // user restarted cannot append to the new listing.
    this.epoch = 0;
    // Set by Stop, read at the top of every write batch. A replacement is the one thing
    // here the epoch cannot reach: it works from a list captured at the press rather
    // than from a page in flight.
    this.stopping = false;
    // Where the fold-skip counter stood when this phase began, so a warning names what
    // *this* run refused rather than everything the page ever has.
    this.foldMark = 0;
    this.logText = [];
    // The export's format and Term counts' threshold, remembered in this browser like the
    // history; `xEpoch` moves on Stop export and on close, so a page in flight saves nothing.
    this.exportFormat = formatOf(stored.exportFormat).key;
    this.minCount = parseInt(stored.minCount, 10) >= 1 ? parseInt(stored.minCount, 10) : MIN_COUNT_DEFAULT;
    this.exporting = false;
    this.xEpoch = 0;
    this.build();
  }

  Run.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'fretc-backdrop');
    this.modal = el('div', 'fretc-modal fretc-tall');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'fretc-head');
    // A plain block, so a title too long for one line wraps rather than being clipped.
    this.titleEl = el('div', 'fretc-title', PLUGIN_NAME);
    head.appendChild(this.titleEl);
    this.staleEl = el('div', 'fretc-stale fretc-hidden', '');
    head.appendChild(this.staleEl);
    // **The head says which of the two dialogs this is right now, and the sentence
    // switches with the checkbox.** With Replace off, no path here issues a mutation and
    // telling anyone to back up first would be false - the same reasoning
    // `TagBundleClipboard`'s head follows. With Replace on, one press rewrites text
    // across the library, and the backup sentence is the first line of every head in this
    // repo that can. Neither wording is decoration: each is true only in its own state,
    // which is why this is not one standing sentence with a warning bolted on.
    this.noteFixedEl = el('div', 'fretc-note', '');
    head.appendChild(this.noteFixedEl);
    head.appendChild(el('div', 'fretc-legend',
      'One line per entity that matched, reading: the entity with its id in brackets, ' +
      'then which attributes matched and how many times each, then the text around the ' +
      'first match. Click an entity to open it. Turn on the types you want ' +
      'searched - they all start off. A long list is shown a page at a time, Previous and Next ' +
      'moving through it while the search goes on reading; Copy log and Replace cover every ' +
      'result, not only the page. Export saves the text of every type turned on as one file, whatever the box says.'));
    // The run's own warnings go in the highlighted slot every writing dialog gives the backup
    // sentence, which this head does not have - the same swap `TagBundleClipboard` makes,
    // and for the same reason: the standing sentence above is a fact about the dialog and
    // these are facts about this run.
    this.noteEl = el('div', 'fretc-warn', '');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);

    this.progressEl = el('div', 'fretc-progress', 'Type something to look for, turn on a type, and press Search.');
    this.modal.appendChild(this.progressEl);

    var bar = el('div', 'fretc-search fretc-search-wrap');
    bar.appendChild(el('span', 'fretc-label', 'Contains:'));
    this.textInput = el('input', 'fretc-textbox fretc-searchbox');
    this.textInput.type = 'text';
    this.textInput.value = '';
    this.textInput.addEventListener('input', function () { self.syncFooter(); });
    // The × that empties it, in a wrapper it positions against - the shape
    // `NormalizeParentTags`' `clearableInput` settled on. Hidden while the box is empty,
    // so the row never shows a press that would do nothing.
    var wrap = el('div', 'fretc-inputwrap');
    this.clearBtn = el('button', 'fretc-clear fretc-hidden', '\u00d7');
    this.clearBtn.type = 'button';
    this.clearBtn.title = 'Empty the box.';
    this.clearBtn.addEventListener('click', function () {
      self.textInput.value = '';
      if (self.textInput.focus) self.textInput.focus();
      self.syncFooter();
    });
    wrap.appendChild(this.textInput);
    wrap.appendChild(this.clearBtn);
    bar.appendChild(wrap);

    // The recent searches are the box's own autocomplete, through a `<datalist>` - the
    // shape the three siblings' filter boxes settled on. It replaced a `<select>` beside
    // the box, which was a second control to explain, a second thing to line up in the
    // row, and a list you had to leave the box to look at.
    this.recentEl = el('datalist');
    this.recentEl.id = 'fretc-recent-searches';
    this.textInput.setAttribute('list', this.recentEl.id);
    wrap.appendChild(this.recentEl);

    // The two remembering controls in one group of their own: they were direct children
    // of a wrapping row, so what lined them up was wherever the wrap happened to put
    // them, and the gap between them was the row's own - the same as the gap to the
    // search box. One flex group with a gap of its own fixes both.
    var opts = el('div', 'fretc-opts');
    var keep = el('label', 'fretc-check');
    this.persistBox = el('input');
    this.persistBox.type = 'checkbox';
    this.persistBox.checked = this.persist;
    this.persistBox.addEventListener('change', function () {
      self.persist = !!self.persistBox.checked;
      self.save();
    });
    keep.appendChild(this.persistBox);
    keep.appendChild(el('span', null, 'Remember filters'));
    keep.title = 'Keep the entity-types you have turned on, in this browser, for the next ' +
      'time this dialog is opened. Nothing is written to your library or to the plugin ' +
      'settings.';
    opts.appendChild(keep);

    var kept = el('label', 'fretc-check');
    kept.appendChild(el('span', null, 'Recent searches kept'));
    this.historyInput = el('input', 'fretc-num');
    this.historyInput.type = 'number';
    this.historyInput.value = String(this.historyMax);
    kept.title = this.historyInput.title = 'How many previous searches the box offers back ' +
      'as you type, in this browser. Zero keeps none - and setting it to zero also throws ' +
      'away the ones already kept, which is how the list is cleared.';
    this.historyInput.addEventListener('change', function () { self.setHistoryMax(); });
    this.historyInput.addEventListener('input', function () { self.setHistoryMax(); });
    kept.appendChild(this.historyInput);
    opts.appendChild(kept);

    // **The one control that turns this dialog into something that writes.** Off every
    // time, and not covered by "Remember filters" - see the constructor. Ticking it does
    // nothing on its own: it reveals the box and the button, and the write still needs a
    // deliberate press with the results already listed on screen.
    var repl = el('label', 'fretc-check');
    this.replaceBox = el('input');
    this.replaceBox.type = 'checkbox';
    this.replaceBox.checked = false;
    this.replaceBox.addEventListener('change', function () {
      self.replacing = !!self.replaceBox.checked;
      self.syncFooter();
    });
    repl.appendChild(this.replaceBox);
    repl.appendChild(el('span', null, 'Replace'));
    // The title says which of the two states it is in, so it is written in `syncReplace`
    // beside everything else that answers for this control.
    this.replaceLabel = repl;
    opts.appendChild(repl);

    // Beside Replace rather than beside the box, because it belongs with the other two
    // things that decide how a run behaves rather than with the text itself.
    var cs = el('label', 'fretc-check');
    this.caseBox = el('input');
    this.caseBox.type = 'checkbox';
    this.caseBox.checked = this.caseSensitive;
    this.caseBox.addEventListener('change', function () {
      self.caseSensitive = !!self.caseBox.checked;
      self.syncFooter();
    });
    cs.appendChild(this.caseBox);
    cs.appendChild(el('span', null, 'Case-sensitive'));
    cs.title = 'Match the text exactly as typed, capitals included. Off: "beach" also ' +
      'finds "Beach". It applies to a replacement as well, which finds what the search ' +
      'found; changing it takes effect on the next search. It starts as ᝯㄝₓ Core\'s ' +
      'Case-Sensitive Matching setting says; changing it here lasts for this dialog and ' +
      'leaves the setting as it is.';
    opts.appendChild(cs);
    var ww = el('label', 'fretc-check');
    this.wholeBox = el('input');
    this.wholeBox.type = 'checkbox';
    this.wholeBox.checked = this.wholeWord;
    this.wholeBox.addEventListener('change', function () {
      self.wholeWord = !!self.wholeBox.checked;
      self.save();
      self.syncFooter();
    });
    ww.appendChild(this.wholeBox);
    ww.appendChild(el('span', null, 'Whole word'));
    ww.title = 'Find the text only as a word of its own: "beach" finds "the beach." but not "beaches". ' +
      'A letter or a digit next to it makes it part of another word. It applies to a replacement as ' +
      'well, which finds what the search found; changing it takes effect on the next search. ' +
      'Remembered in this browser.';
    opts.appendChild(ww);
    var sk = el('label', 'fretc-check');
    this.skipBox = el('input');
    this.skipBox.type = 'checkbox';
    this.skipBox.checked = this.skipRemoved;
    this.skipBox.addEventListener('change', function () {
      self.skipRemoved = !!self.skipBox.checked;
      self.save();
      self.syncFooter();
    });
    sk.appendChild(this.skipBox);
    sk.appendChild(el('span', null, 'Skip what De-Spicer removes'));
    this.skipLabel = sk;
    opts.appendChild(sk);
    bar.appendChild(opts);
    this.modal.appendChild(bar);

    // The second line, revealed by the checkbox. Same shape as the search box above it -
    // the same clearable wrapper, the same `<datalist>` autocomplete - because it is the
    // same kind of thing and a second design for it would only be a second thing to learn.
    var rbar = el('div', 'fretc-search fretc-search-wrap fretc-hidden');
    this.replaceBar = rbar;
    rbar.appendChild(el('span', 'fretc-label', 'Replace by:'));
    this.replaceInput = el('input', 'fretc-textbox fretc-searchbox');
    this.replaceInput.type = 'text';
    this.replaceInput.value = '';
    this.replaceInput.addEventListener('input', function () { self.syncFooter(); });
    var rwrap = el('div', 'fretc-inputwrap');
    this.replaceClearBtn = el('button', 'fretc-clear fretc-hidden', '\u00d7');
    this.replaceClearBtn.type = 'button';
    this.replaceClearBtn.title = 'Empty the box.';
    this.replaceClearBtn.addEventListener('click', function () {
      self.replaceInput.value = '';
      if (self.replaceInput.focus) self.replaceInput.focus();
      self.syncFooter();
    });
    rwrap.appendChild(this.replaceInput);
    rwrap.appendChild(this.replaceClearBtn);
    rbar.appendChild(rwrap);
    this.replaceRecentEl = el('datalist');
    this.replaceRecentEl.id = 'fretc-recent-replacements';
    this.replaceInput.setAttribute('list', this.replaceRecentEl.id);
    rwrap.appendChild(this.replaceRecentEl);
    // Said beside the box rather than in the head: it is a fact about this control, and
    // the head is where facts about the whole dialog go.
    rbar.appendChild(el('span', 'fretc-hint',
      'An empty box deletes the text it finds. Matching follows Case-sensitive, as the ' +
      'search did; the replacement goes in exactly as typed.'));
    this.modal.appendChild(rbar);

    this.filtersEl = el('div', 'fretc-filters');
    var filterRows = this.filtersEl.appendChild(el('div', 'fretc-filterrows'));
    this.typeRow = el('div', 'fretc-filterrow');
    this.typeRow.appendChild(el('span', 'fretc-label', 'Entity-types'));
    TYPE_ORDER.forEach(function (k) {
      self.typeRow.appendChild(self.toggle(ENTITIES[k].plural, self.typeOn, k));
    });
    filterRows.appendChild(this.typeRow);
    // **Two rows, two scopes.** A type decides which entities are read; an attribute which of
    // their fields, for every type turned on - the row offers what those types have, filled
    // from the server's field shapes as the dialog opens. An attribute acts twice: on the next
    // search or export, which does not read it, and on the list on screen, which hides what
    // was found only there. Same shape, same color, same All On / All Off.
    this.attrRow = el('div', 'fretc-filterrow fretc-hidden');
    var attrLabel = this.attrRow.appendChild(el('span', 'fretc-label', 'Attributes'));
    attrLabel.title = 'Which fields of the types turned on are read. Off: the next search and export do not read it, ' +
      'Replace does not rewrite it, and a result found only there is hidden now.';
    filterRows.appendChild(this.attrRow);
    this.filterAllEl = this.filtersEl.appendChild(el('div', 'fretc-filterall'));
    this.modal.appendChild(this.filtersEl);

    this.logEl = el('div', 'fretc-log');
    this.modal.appendChild(this.logEl);

    var foot = el('div', 'fretc-foot');
    // One button for the whole search, which is what the caption slash in the brief says:
    // Search when there is nothing running, Pause while there is, Resume after a pause by
    // hand.
    this.goBtn = button('Search', 'fretc-go');
    this.refreshBtn = button('Refresh', 'fretc-refresh fretc-hidden');
    this.refreshBtn.title = 'Throw away what this search has found and start it again from ' +
      'the beginning, with whatever the box now says. Search carries the current one on; ' +
      'this one replaces it.';
    // Orange: the one button here that writes. See "one color for a plugin wrote this".
    this.replaceBtn = button('Replace', 'fretc-replace fretc-hidden');
    this.replaceBtn.className =
      this.replaceBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.undoBtn = button('Undo', 'fretc-undo fretc-hidden');
    this.undoBtn.className = this.undoBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.undoBtn.title = 'Put back what every Replace since the last Undo changed, newest first, field by ' +
      'field, as the entities carried it a moment before. Only what this dialog wrote, and only while ' +
      'it stays open.';
    this.cancelBtn = button('Cancel', 'fretc-cancel');
    // Only ever visible while a replacement or an undo is writing, and the only way out
    // of one: Cancel and Escape are both unavailable there, because abandoning the
    // dialog would leave the mutations running headless and take the undo records with
    // it. Gray - it stops a write, it does not make one.
    this.stopBtn = button('Stop', 'fretc-stop fretc-hidden');
    this.copyBtn = button('Copy log', 'fretc-copy');
    this.copyBtn.title = 'Copy the counters, the messages and every result as plain text - ' +
      'including the ones the on-screen list no longer shows.';
    // Export, its format, and - for Term counts alone - how often a phrase must occur to be listed.
    this.exportBtn = button('Export', 'fretc-export');
    this.formatSel = C.dropdown('fretc-num fretc-format');
    EXPORT_FORMATS.forEach(function (f) {
      var o = el('option', null, f.label);
      o.value = f.key;
      o.title = f.tip;
      self.formatSel.appendChild(o);
    });
    this.formatSel.value = this.exportFormat;
    this.formatSel.addEventListener('change', function () {
      self.exportFormat = formatOf(self.formatSel.value).key;
      self.save();
      self.syncFooter();
    });
    this.minLabel = el('label', 'fretc-check');
    this.minLabel.appendChild(el('span', null, 'Min count'));
    this.minInput = el('input', 'fretc-num');
    this.minInput.type = 'number';
    this.minInput.min = '1';
    this.minInput.value = String(this.minCount);
    this.minLabel.title = this.minInput.title = 'How many times a word or phrase must occur to be listed. ' +
      'Lower lists more, and takes longer and more memory to count; 1 lists every phrase there is.';
    var setMin = function () {
      var n = parseInt(String(self.minInput.value).trim(), 10);
      self.minCount = n >= 1 ? n : MIN_COUNT_DEFAULT;
      self.save();
      self.syncFooter();
    };
    // Left, the box says the number in use - a 0 or a blank typed there counts as the default.
    this.minInput.addEventListener('change', function () { setMin(); self.minInput.value = String(self.minCount); });
    this.minInput.addEventListener('input', setMin);
    this.minLabel.appendChild(this.minInput);
    this.allOnBtn = button('All On', 'fretc-allon fretc-filterbtn');
    this.allOffBtn = button('All Off', 'fretc-alloff fretc-filterbtn');
    [this.allOnBtn, this.allOffBtn].forEach(function (b) {
      paintButton(b, FILTER_ON_VARIANT);
      // Both rows, which is what "the filters" means to someone looking at one block of
      // buttons - and the attribute half decides what a Replace covers, so the caption
      // saying only "entity-type" was hiding the half that writes.
      b.title = 'Turn every filter in this strip on or off - entity-types and attributes ' +
        'alike. The attribute half also decides what a Replace covers.';
    });

    this.goBtn.addEventListener('click', function () { self.go(); });
    this.replaceBtn.addEventListener('click', function () { self.replaceAll(); });
    this.undoBtn.addEventListener('click', function () { self.undo(); });
    this.refreshBtn.addEventListener('click', function () { self.refresh(); });
    this.cancelBtn.addEventListener('click', function () { self.close(); });
    this.stopBtn.addEventListener('click', function () {
      if (!self.writing || self.stopping) return;
      self.stopping = true;
      self.syncFooter();
      self.msg('INFO', 'Stopping after the batch already in flight. What has been written ' +
        'so far stays written, and Undo still reaches it.');
    });
    this.copyBtn.addEventListener('click', function () { self.copyLog(); });
    this.exportBtn.addEventListener('click', function () { self.exportAll(); });
    // De-Spicer's types and the attributes its goals and rules would change, for this dialog only.
    this.dspBtn = button('De-Spicer changes', 'fretc-dspscope');
    this.dspBtn.addEventListener('click', function () { self.useDeSpicer('fields'); });
    this.dspLeftBtn = button('De-Spicer leaves', 'fretc-dspleft');
    this.dspLeftBtn.addEventListener('click', function () { self.useDeSpicer('kept'); });
    this.allOnBtn.addEventListener('click', function () { self.setAll(true); });
    this.allOffBtn.addEventListener('click', function () { self.setAll(false); });

    // The write leads, as in all five dialogs; Undo sits with it, and the read controls
    // follow. Export and its options stand alone in the middle, between two spacers, well
    // apart from Copy log. The filters' own buttons are beside the filters, not here.
    [this.replaceBtn, this.goBtn, this.refreshBtn, this.cancelBtn, this.stopBtn,
      this.copyBtn, this.undoBtn].forEach(function (b) { foot.appendChild(b); });
    foot.appendChild(el('div', 'fretc-spacer'));
    [this.exportBtn, this.formatSel, this.minLabel].forEach(function (b) { foot.appendChild(b); });
    foot.appendChild(el('div', 'fretc-spacer'));
    this.modal.appendChild(foot);
    // De-Spicer's scope first: it sets both rows to something particular, the pair after it to all or none.
    [this.dspBtn, this.dspLeftBtn, this.allOnBtn, this.allOffBtn].forEach(function (b) { self.filterAllEl.appendChild(b); });

    this.syncRecent();
    this.syncFooter();
    // The field shapes, asked once and kept by Core, so the Attributes row can offer them
    // before anything is read. Failing, the row waits for the first search, which asks again.
    describeFields().then(function (shapes) { self.shapesIn(shapes); }, function (e) {
      self.msg('WARN', 'Could not read which fields this Stash has (' + (e && e.message ? e.message : String(e)) +
        '), so the Attributes row is not shown yet: the first search or export asks again.');
    });
    C.wireEscape(this, 'fretc');
    document.body.appendChild(this.backdrop);
  };

  Run.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
  };

  Run.prototype.show = function (node, visible) {
    node.className = node.className.replace(/\s*fretc-hidden/g, '') + (visible ? '' : ' fretc-hidden');
  };

  Run.prototype.showStale = function (msg) {
    this.staleEl.textContent = msg || '';
    if (msg) staleReloadButton(this.staleEl);
    this.show(this.staleEl, !!msg);
  };

  Run.prototype.toggle = function (label, bag, key) {
    var self = this;
    var b = button(label, 'fretc-filterbtn');
    b._bag = bag;
    b._key = key;
    paintButton(b, bag[key] ? FILTER_ON_VARIANT : 'btn-secondary');
    b.addEventListener('click', function () {
      bag[key] = !bag[key];
      paintButton(b, bag[key] ? FILTER_ON_VARIANT : 'btn-secondary');
      // Both rows are standing choices about what to read, remembered by "Remember filters";
      // the types decide which attributes are on offer, the attributes what is on screen too.
      self.save();
      if (bag === self.typeOn) self.syncAttrs();
      if (bag === self.attrOn) self.redraw();
      self.syncFooter();
    });
    return b;
  };

  // Every filter toggle in the strip, both rows. `All On` and `All Off` act on all of
  // them, which is what "the filters" means to someone looking at one block of buttons.
  Run.prototype.toggles = function () {
    var out = [];
    [this.typeRow, this.attrRow].forEach(function (row) {
      for (var i = 0; i < row.childNodes.length; i++) {
        if (row.childNodes[i]._bag) out.push(row.childNodes[i]);
      }
    });
    return out;
  };

  Run.prototype.setAll = function (on) {
    this.toggles().forEach(function (b) {
      b._bag[b._key] = on;
      paintButton(b, on ? FILTER_ON_VARIANT : 'btn-secondary');
    });
    // The attributes no type turned on offers now as well, or All On after All Off would bring
    // the row back with every one still off.
    for (var a in this.attrOn) if (hasOwn(this.attrOn, a)) this.attrOn[a] = on;
    this.save();
    this.syncAttrs();
    this.redraw();
    this.syncFooter();
  };

  // The Attributes row, redrawn for the types turned on: every attribute one of them has, on
  // unless turned off. Empty, with no type on or no field shapes yet, it is hidden.
  // **De-Spicer's view**, two ways (`coop().api.DeSpicer.scope`): what its goals and rules
  // would change (`fields`), or where the original words survive them (`kept`) - what is left to find by hand.
  // Both set the types its run reads and the attributes the answer names, over both rows; `mine` keeps the
  // user's own choice, which `save` goes on storing - with the view itself as `dspMode` under "Remember
  // filters" - and the button in use reads Back to mine. The other one
  // switches straight across, `mine` kept. A toggle clicked meanwhile is part of the borrowed choice.
  Run.prototype.useDeSpicer = function (mode) {
    var self = this;
    var copy = function (from, to) {
      Object.keys(to).forEach(function (k) { delete to[k]; });
      for (var k in from) if (hasOwn(from, k)) to[k] = from[k];
    };
    var done = function () {
      self.toggles().forEach(function (b) { paintButton(b, b._bag[b._key] ? FILTER_ON_VARIANT : 'btn-secondary'); });
      self.syncAttrs();
      self.redraw();
      self.syncFooter();
    };
    if (this.mine && this.dspMode === mode) {
      copy(this.mine.types, this.typeOn);
      copy(this.mine.attrs, this.attrOn);
      this.mine = null;
      this.dspMode = null;
      this.dspWanted = null;
      this.save();
      this.msg('INFO', 'Back to your own types and attributes.');
      done();
      return;
    }
    var api = (coop().api || {}).DeSpicer;
    Promise.resolve().then(function () { return api.scope(); }).then(function (sc) {
      // `kept` is the newer half of De-Spicer's answer; an older one answers what it changes only.
      if (!sc[mode]) { self.msg('WARN', 'This De-Spicer is too old to say what it leaves: update it.'); return; }
      if (!self.mine) {
        var mine = { types: {}, attrs: {} };
        copy(self.typeOn, mine.types);
        copy(self.attrOn, mine.attrs);
        self.mine = mine;
      }
      self.dspMode = mode;
      self.dspWanted = mode;
      self.save();
      TYPE_ORDER.forEach(function (k) { self.typeOn[k] = sc.types.indexOf(k) !== -1; });
      var want = (sc[mode] || []).map(function (n) {
        return n === 'custom_fields.value' ? CF_VALUE_LABEL : n === 'custom_fields.name' ? CF_NAME_LABEL
          : n === 'files' ? FILE_LABEL : FIELD_LABEL[n] || n;
      });
      self.syncAttrs();            // the row the borrowed types offer, then each attribute on as De-Spicer says
      for (var a in self.attrOn) if (hasOwn(self.attrOn, a)) self.attrOn[a] = want.indexOf(a) !== -1;
      var types = self.chosen(), on = Object.keys(self.attrOn).filter(function (l) { return self.attrOn[l]; });
      var aside = sc.types.filter(function (k) { return !hasOwn(ENTITIES, k); })
        .map(function (k) { return k === 'markers' ? 'scene markers' : k === 'filters' ? 'saved filters' : k; });
      var unread = TYPE_ORDER.filter(function (k) { return sc.types.indexOf(k) === -1; });
      self.msg('INFO', (mode === 'kept' ? 'Left by De-Spicer' : 'Changed by De-Spicer') + ', for this dialog: ' +
        (types.length ? types.map(function (k) { return ENTITIES[k].plural; }).join(', ') : 'no type') + '; ' +
        (on.length ? on.join(', ') : 'no attribute') + '. Back to mine puts your own choice back' +
        (mode === 'kept' && unread.length ? '; De-Spicer does not read ' +
          unread.map(function (k) { return ENTITIES[k].plural; }).join(', ') + ' at all, so all their text is left too' : '') +
        (aside.length ? '; De-Spicer also reads ' + aside.join(' and ') + ', which this dialog does not search.' : '.'));
      done();
    }, function (e) {
      self.msg('WARN', 'De-Spicer could not say what it covers: ' + (e && e.message ? e.message : String(e)) + '.');
    });
  };

  // The field shapes, first in: the Attributes row they offer, then a remembered De-Spicer view on it - before
  // them its attributes have no row to be set in, and every one would come on.
  Run.prototype.shapesIn = function (shapes) {
    this.shapes = shapes;
    this.syncAttrs();
    if (!this.dspWanted) return;
    var dsp = (coop().api || {}).DeSpicer;
    if (dsp && typeof dsp.scope === 'function') this.useDeSpicer(this.dspWanted);
    else this.msg('INFO', 'De-Spicer is not installed or enabled, so your own types and attributes are on, ' +
      'not the De-Spicer view remembered; it comes back with De-Spicer.');
  };

  Run.prototype.syncAttrs = function () {
    var self = this, labels = [];
    if (this.shapes) {
      this.chosen().forEach(function (k) {
        attrsOf(ENTITIES[k], self.shapes[k]).forEach(function (l) { if (labels.indexOf(l) === -1) labels.push(l); });
      });
    }
    // A `while` over the live collection: `childNodes` is a NodeList (see `start`).
    while (this.attrRow.childNodes.length > 1) {
      this.attrRow.removeChild(this.attrRow.childNodes[this.attrRow.childNodes.length - 1]);
    }
    labels.forEach(function (l) {
      if (self.attrOn[l] !== false) self.attrOn[l] = true;
      var b = self.attrRow.appendChild(self.toggle(l, self.attrOn, l));
      b.title = l === FILE_LABEL
        ? 'The names of files and folders: searched and exported while on, never rewritten by Replace - renaming a ' +
          'file is ᝯㄝₓ Scene Filename Manager\'s. Off: not read, and a result found only there is hidden now.'
        : l + ': read by Search and Export, and rewritten by Replace, while on. Off: not read, and a result ' +
          'found only there is hidden now.';
    });
    this.show(this.attrRow, labels.length > 0);
    this.syncFooter();
  };

  // Whether every attribute on offer is turned off, which leaves a search nothing to read.
  Run.prototype.noAttrs = function () {
    var self = this, b = this.toggles().filter(function (t) { return t._bag === self.attrOn; });
    return b.length > 0 && b.every(function (t) { return !self.attrOn[t._key]; });
  };

  // The attributes as they stand now, for a read to keep to whatever is clicked while it runs.
  Run.prototype.readOn = function () {
    var on = {};
    for (var a in this.attrOn) if (hasOwn(this.attrOn, a)) on[a] = this.attrOn[a];
    return function (label) { return on[label] !== false; };
  };

  // What a search is run with, to tell whether pressing Search again could find anything else.
  Run.prototype.searchKey = function () {
    var self = this;
    return JSON.stringify([this.textInput.value.trim(), !!this.caseSensitive, !!this.wholeWord, !!this.skipRemoved, this.chosen(),
      Object.keys(this.attrOn).filter(function (k) { return self.attrOn[k] === false; }).sort()]);
  };

  Run.prototype.chosen = function () {
    var self = this;
    return TYPE_ORDER.filter(function (k) { return self.typeOn[k]; });
  };

  // Zero is not merely "keep none": it is also how the list already kept is cleared,
  // which is the one thing a number box can be asked to do that is not about the future.
  Run.prototype.setHistoryMax = function () {
    var n = parseInt(this.historyInput.value.trim(), 10);
    if (!(n > 0)) n = 0;
    this.historyMax = Math.min(HISTORY_MAX, n);
    this.history = this.historyMax ? this.history.slice(0, this.historyMax) : [];
    this.replaceHistory = this.historyMax ? this.replaceHistory.slice(0, this.historyMax) : [];
    this.syncRecent();
    this.save();
  };

  // `text` to the front of `this[listProp]` - `history` for the search box, on Search;
  // `replaceHistory` for the replacement box, on the press that *uses* the value rather
  // than as it is typed, since a half-typed replacement is not something to offer back.
  Run.prototype.remember = function (listProp, text) {
    if (!this.historyMax || !text) return;
    this[listProp] = [text].concat(this[listProp].filter(function (t) { return t !== text; }))
      .slice(0, this.historyMax);
    this.syncRecent();
    this.save();
  };

  // A `<datalist>` renders nothing of its own, so there is no empty state to draw and
  // nothing to hide when the history is switched off - an empty list is simply a box that
  // suggests nothing, which is exactly right.
  Run.prototype.syncRecent = function () {
    fillDatalist(this.recentEl, this.history);
    fillDatalist(this.replaceRecentEl, this.replaceHistory);
  };

  Run.prototype.save = function () {
    var types = {};
    var self = this;
    // While De-Spicer's view is borrowed, what is stored is still the user's own choice.
    var typeOn = this.mine ? this.mine.types : this.typeOn, attrOn = this.mine ? this.mine.attrs : this.attrOn;
    TYPE_ORDER.forEach(function (k) { if (typeOn[k]) types[k] = true; });
    writeStore({
      persist: this.persist,
      types: this.persist ? types : null,
      historyMax: this.historyMax,
      history: this.history,
      replaceHistory: this.replaceHistory,
      attrsOff: this.persist ? Object.keys(attrOn).filter(function (k) { return attrOn[k] === false; }) : null,
      exportFormat: this.exportFormat,
      wholeWord: this.wholeWord || undefined,
      skipRemoved: this.skipRemoved || undefined,
      // The De-Spicer view in use, or one remembered that De-Spicer could not answer yet; your own choice stays above.
      dspMode: this.persist && this.dspWanted ? this.dspWanted : undefined,
      // Kept only once it differs from the default, so a later default reaches this browser too.
      minCount: this.minCount !== MIN_COUNT_DEFAULT ? this.minCount : undefined,
    });
  };

  // Search / Pause / Resume, and the reason the button is disabled said out
  // loud rather than left to be guessed at.
  Run.prototype.syncFooter = function () {
    var caption = this.state === 'running' ? 'Pause'
      : this.state === 'paused' ? 'Resume' : 'Search';
    this.goBtn.textContent = caption;
    paintButton(this.goBtn, 'btn-secondary');
    var text = this.textInput.value.trim();
    var types = this.chosen().length;
    var why = this.state !== 'idle' && this.state !== 'done' ? ''
      : !text ? 'Type what to look for.'
        : !types ? 'Turn on at least one entity-type.'
          : this.noAttrs() ? 'Turn on at least one attribute.' : '';
    var exporting = !!this.exporting;
    if (exporting && !why) why = 'Not while an export is running - stop it, or let it finish.';
    // **Off once a search has run, until something it was run with changes** - the text, a box,
    // a type or an attribute - or Replace or Undo writes. Refresh shows meanwhile, for a change
    // made elsewhere, and wears Core's stale mark when another tab writes.
    var unchanged = this.state === 'done' && !this.searchFailed && this.searchedKey === this.searchKey();
    if (unchanged && !why) why = 'Nothing has changed since this search. Change the text, a box, a type or an ' +
      'attribute to search again, or press Refresh to read the library again as it is.';
    this.goBtn.disabled = !!why;
    this.goBtn.title = why || (caption === 'Pause' ? 'Stop after the page being read.'
      : caption === 'Resume' ? 'Carry on from where it stopped.'
          : 'Read every ' + plural(types, 'chosen type') + ' looking for this text.');
    // **Refresh is hidden wherever the button beside it already says Search**, which is
    // every state where the two would do the same thing - idle, and finished. It is for
    // the states where the primary button has become Pause or Resume and there
    // is no other way to say *start over*. It works mid-run: `start` moves the epoch, so
    // the page in flight is discarded rather than raced.
    var second = caption === 'Search' && !unchanged;
    var writing = !!this.writing;
    this.show(this.refreshBtn, !second);
    // Core's stale mark - another tab changed the library since this listing was read - goes on
    // whichever of the two is showing: Search wears the class Core marks by while Refresh is hidden,
    // and a mark already made moves across (`start` clears both).
    this.goBtn.className = this.goBtn.className.replace(/\s*fretc-rescan/g, '') + (second ? ' fretc-rescan' : '');
    if (hasClass(this.goBtn, 'gttx-stale-rescan') || hasClass(this.refreshBtn, 'gttx-stale-rescan')) {
      C.clearStale(second ? this.refreshBtn : this.goBtn);
      C.markStale(second ? this.goBtn : this.refreshBtn);
    }
    this.refreshBtn.disabled = !text || !types || this.noAttrs() || writing || exporting;
    this.textInput.disabled = this.state === 'running' || writing;
    this.historyInput.disabled = this.state === 'running' || writing;
    // Cancel while there is something to abandon, Close once the search has run out:
    // the same button, saying which of the two pressing it now means.
    this.cancelBtn.textContent = this.state === 'done' ? 'Close' : 'Cancel';
    // **Both exits are shut mid-write, and Stop is the only way out** - the rule every
    // writing dialog here follows. `close()` cannot reach the write loop: it works from
    // a list captured at the press, so leaving would carry on mutating with no progress
    // shown and the undo records gone with the dialog. Escape goes through this button,
    // so disabling it is what makes the key inert too.
    this.cancelBtn.disabled = writing;
    this.cancelBtn.title = writing
      ? 'Not while a replacement is running - press Stop, and this comes back.' : '';
    this.show(this.stopBtn, writing);
    this.stopBtn.disabled = !writing || !!this.stopping;
    this.stopBtn.title = this.stopping
      ? 'Stopping after the batch already in flight.'
      : 'Stop after the batch already in flight. What has been written stays written.';
    if (writing) {
      this.goBtn.disabled = true;
      this.goBtn.title = 'Not while a replacement is running - it rewrites the very ' +
        'entities on this list. Let it finish, or stop it.';
    }
    this.show(this.clearBtn, !!text && this.state !== 'running');
    // Disabled where pressing would change nothing: every filter in the strip already on,
    // or every one already off. The types start all-off, so All Off is dead on open and
    // says so.
    var toggles = this.toggles();
    var busy = this.state === 'running' || exporting;
    // The **type** toggles are what `start()` copied the queue from, so switching one
    // while the search is going changes nothing about it - results go on arriving for a
    // type the strip now shows as off, and the breakdown goes on naming it. A control
    // that looks like it steers the run and does not is worse than one that is plainly
    // unavailable, so it is disabled with the reason on it and live again the moment the
    // search pauses or ends. **The attribute toggles are the opposite case and stay
    // live**: they filter what is shown out of what has been found, which goes on being
    // true as more arrives - the distinction is whether the control decides what the run
    // *does* or what the screen *shows*.
    var self = this;
    toggles.forEach(function (b) {
      if (b._bag !== self.typeOn) return;
      b.disabled = busy;
      b.title = !busy ? ''
        : exporting ? 'Not while an export is running - it covers the types it started with. Stop it, ' +
          'or let it finish, and this comes back.'
          : 'Not while a search is running - it covers the types it started with. Pause it, ' +
            'or let it finish, and this comes back.';
    });
    var dsp = (coop().api || {}).DeSpicer, self2 = this;
    [[this.dspBtn, 'fields', 'De-Spicer changes', 'what De-Spicer would change now: the entity-types its run reads, ' +
      'and the attributes its goals and rules rewrite'],
    [this.dspLeftBtn, 'kept', 'De-Spicer leaves', 'what De-Spicer leaves as it is: the entity-types its run reads, and the ' +
      'attributes where your original words survive its goals and rules - kept, or a pseudonym in free text, which keeps ' +
      'every word but the names - for finding by hand what it will not clean']].forEach(function (d) {
      var b = d[0], inUse = !!self2.mine && self2.dspMode === d[1];
      b.textContent = inUse ? 'Back to mine' : d[2];
      paintButton(b, inUse ? FILTER_ON_VARIANT : 'btn-secondary');
      var can = dsp && typeof dsp.scope === 'function';
      b.disabled = busy || (!inUse && !can);
      b.title = busy ? 'Not while a search or an export is running - it covers the types it started with.'
        : inUse ? 'Put back your own entity-types and attributes, as they were before.'
          : !can ? 'ᝯㄝₓ De-Spicer is not installed or enabled, or too old to say what it covers.'
            : 'Set both rows to ' + d[3] + '. Your own choice is kept, and Back to mine puts it back; Remember filters ' +
              'keeps the view for the next time the dialog opens, asked of De-Spicer again then.';
    });
    this.allOnBtn.disabled = busy || !toggles.length ||
      toggles.every(function (b) { return b._bag[b._key]; });
    this.allOffBtn.disabled = busy || !toggles.length ||
      toggles.every(function (b) { return !b._bag[b._key]; });
    this.syncReplace(busy);
    this.syncExport(types);
    // Green when nothing is left to write: the search has run out and left nothing on
    // the list to replace. Undo does not take the green away - it is an offer, not
    // something waiting on the user. A failed search and a stale script stay gray:
    // those say "something is wrong", not "nothing to do". Only ever while the
    // button reads Close - a green Cancel would promise the wrong thing.
    paintButton(this.cancelBtn, this.state === 'done' && !this.writing && !this.stale &&
      !this.searchFailed && !this.replaceScope().length ? 'btn-success' : 'btn-secondary');
    this.spin(this.state === 'running' || this.writing || exporting);
  };

  // The export half of the footer. Export turns into Stop export while it reads; the format and
  // the threshold it started with are locked until it ends, as the types are.
  Run.prototype.syncExport = function (types) {
    var exporting = !!this.exporting;
    var fmt = formatOf(this.exportFormat);
    this.exportBtn.textContent = exporting ? 'Stop export' : 'Export';
    var why = exporting ? ''
      : this.writing ? 'Not while a replacement is running.'
        : this.state === 'running' ? 'Not while a search is running - pause it, or let it finish.'
          : !types ? 'Turn on at least one entity-type.'
            : this.noAttrs() ? 'Turn on at least one attribute.' : '';
    this.exportBtn.disabled = !!why;
    this.exportBtn.title = why || (exporting ? 'Stop reading. Nothing is saved.'
      : 'Read every ' + plural(types, 'type') + ' turned on and save its text as one ' + fmt.label + ' file - ' +
        'no search text needed. ' + fmt.tip);
    this.formatSel.disabled = exporting;
    this.formatSel.title = exporting ? 'Not while an export is running.' : 'What the export saves. ' + fmt.tip;
    this.minInput.disabled = exporting;
    this.show(this.minLabel, fmt.key === 'terms');
  };

  // The Replace half of the footer, and the head sentence that goes with it.
  //
  // **Every reason the button is off is said on the button**, the same way the search
  // button says why it is: a write that is quietly unavailable is a user re-reading the
  // dialog looking for what they have missed.
  Run.prototype.syncReplace = function (busy) {
    var self = this;
    var writing = !!this.writing;
    var text = this.textInput.value.trim();
    // **Nothing to replace until there is something to replace.** The button already said
    // so and stayed on screen saying it, under a row offering a replacement for a search
    // nobody had asked for. With the box above empty the whole row is a control for a
    // write that cannot even be described, so it is unavailable rather than
    // disabled-with-a-reason - and the tick is kept, so typing the search back brings the
    // row straight back with it.
    var on = !!this.replacing && !!text;
    this.show(this.replaceBar, on);
    // **Highlighted in the one state that earns it.** The backup sentence is the first line of
    // every head in this repo that can write, and it is highlighted in all of them; the other
    // wording is a fact about a dialog that writes nothing, which is the gray note slot.
    // One element with the class swapped rather than two, so the sentence stays in the
    // place the siblings put it whichever of the two it is showing.
    this.noteFixedEl.className = on ? 'fretc-warn' : 'fretc-note';
    this.noteFixedEl.textContent = on
      ? 'Backing up your database before proceeding is strongly recommended. Replace rewrites the ' +
        'text in your library; Undo only reverses what this dialog wrote, while it stays ' +
        'open, and cannot account for changes made elsewhere in the meantime.'
      : 'Nothing here is written to your library: this is a read and a list of links.';
    this.show(this.replaceBtn, on);
    this.show(this.undoBtn, on && this.changes.length > 0);
    // Locked while the run it steers is running, and while a replacement is writing -
    // the search captured it at `start` and a replacement reads that capture, so a
    // control left live there would look like it steers something it cannot reach.
    var rm = (coop().api || {}).DeSpicer;
    var canSkip = !!rm && typeof rm.removals === 'function';
    this.skipBox.disabled = busy || writing || !canSkip;
    this.skipLabel.title = !canSkip ? 'ᝯㄝₓ De-Spicer is not installed or enabled, or too old to say what it removes.'
      : 'Leave out of a search and an export everything De-Spicer would remove: what carries its Remove Everything ' +
        'Tagged tag or a tag under it, in the types it reads, less what Leave Alone protects - asked of De-Spicer at the ' +
        'press. Remembered in this browser.';
    this.caseBox.disabled = this.wholeBox.disabled = busy || writing;
    this.caseBox.title = this.wholeBox.title = busy || writing
      ? 'Not while this is running - the search covers what it started with. Let it ' +
        'finish, or pause it, and this comes back.'
      : '';
    this.replaceInput.disabled = busy || writing;
    this.show(this.replaceClearBtn, on && !!this.replaceInput.value.trim() && !busy && !writing);
    this.replaceBox.disabled = busy || writing || !text;
    this.replaceLabel.title = text
      ? 'Offer to replace the text you searched for, everywhere this search found it. ' +
        'Off: this dialog reads and writes nothing at all.'
      : 'Nothing to replace yet: a replacement replaces what a search found, so the box ' +
        'above has to say what to look for first.';
    this.undoBtn.disabled = writing;
    if (!on) return;
    var to = this.replaceInput.value;
    // Counted rather than merely tested, because the count is what the button promises
    // and it is the attribute filters' answer, not the raw result list: a filter is a
    // choice about what is being looked at, and a write must not reach past it.
    var scope = this.replaceScope();
    var why = writing ? 'A replacement is running.'
      : this.state === 'running' ? 'Not while the search is running - pause it, or let it finish.'
        : this.exporting ? 'Not while an export is running - stop it, or let it finish.'
        : this.stale ? 'This page is running an older script than Stash has installed. Reload first.'
          : !scope.length
            ? 'Nothing on this list to replace: search first, or turn an attribute back on.'
            // The list - and so the write - is what the search found; a box edited since says
            // something else, and the button would read as the edit.
            : this.needle != null && text !== this.needle
              ? 'The box says "' + text + '", but the list shows what "' + this.needle + '" found. Search again first.'
            : to === text
              ? 'The replacement is the text being searched for, so it would change nothing.'
              : '';
    this.replaceBtn.disabled = !!why;
    this.replaceBtn.title = why || ('Replace "' + text + '" with ' +
      (to ? '"' + to + '"' : 'nothing') + ' in ' + plural(scope.length, 'entity', 'entities') +
      ' on this list, in the attributes still shown. Nothing else is touched.');
  };

  // What a press would cover: the results the attribute filters leave, each carrying only
  // the attributes still shown. The same rule `copyLog` follows, for the same reason - the
  // filters are the user's statement of what they are looking at.
  // File names are found, never rewritten: an entity matched only there is not Replace's.
  Run.prototype.replaceScope = function () {
    var self = this;
    return this.results.filter(function (hit) {
      return self.shownAttrs(hit).some(function (a) { return a.label !== FILE_LABEL; });
    });
  };

  // A cursor cycling under the last line of the log for as long as work is in flight,
  // and gone the moment it is not. It carries no `-line` class, since it is not a message
  // and must not be read back as one.
  Run.prototype.spin = function (on) {
    if (!on) {
      if (this.spinEl && this.spinEl.parentNode) this.spinEl.parentNode.removeChild(this.spinEl);
      this.spinEl = null;
      return;
    }
    if (!this.spinEl) this.spinEl = C.busyCursor('div', 'fretc-spin');
    this.logEl.appendChild(this.spinEl);
  };

  Run.prototype.msg = function (kind, message) {
    var line = el('div', 'fretc-line fretc-' + kind);
    line.textContent = '[' + kind + '] ' + message;
    this.logEl.appendChild(line);
    this.logText.push('[' + kind + '] ' + message);
    // Bounded, because the copy buffer is what a library-wide search grows without limit.
    this.logDropped = (this.logDropped || 0) + keepLog(this.logText);
    if (this.spinEl) this.logEl.appendChild(this.spinEl);   // back to the end
    this.scrollLog();
    return line;
  };

  Run.prototype.note = function (message) {
    this.msg('WARN', message);
    this.noteEl.textContent = this.noteEl.textContent
      ? this.noteEl.textContent + ' ' + message : message;
  };

  Run.prototype.scrollLog = function () {
    if (this.logEl && typeof this.logEl.scrollHeight === 'number') {
      this.logEl.scrollTop = this.logEl.scrollHeight;
    }
  };

  // One entry per type in scope, `Plural read/there`, in the order they are read. The
  // aggregate above says how far the whole search has got; this says *where* it is, which
  // on a library whose Images outnumber everything else is the difference between a number
  // that has stopped moving and one that is moving through the biggest type.
  //
  // Only the types that were turned on: an entry for a type nobody asked to read would be
  // a zero that never changes.
  Run.prototype.perTypeText = function () {
    var self = this;
    if (!this.searching || !this.searching.length) return '';
    return this.searching.map(function (k) {
      var there = self.totals[k];
      return ENTITIES[k].plural + ' ' + (self.scannedPer[k] || 0) +
        (there == null ? '' : '/' + there) +
        (self.occursPer[k] ? ' (' + plural(self.occursPer[k], 'match', 'matches') + ')' : '');
    }).join('  ·  ');
  };

  Run.prototype.progress = function () {
    // Before any search, the last export's outcome where there is one.
    if (this.state === 'idle' && !this.scanned) {
      this.progressEl.textContent = this.exported ||
        'Type something to look for, turn on a type, and press Search.';
      return;
    }
    // The noun agrees with the total where there is one, since that is the number it is
    // counting toward.
    var head = 'Scanned ' + (this.total == null
      ? plural(this.scanned, 'entity', 'entities')
      : this.scanned + ' of ' + plural(this.total, 'entity', 'entities')) +
      (this.loadingWhat && this.state === 'running' ? ' (' + this.loadingWhat + ')' : '') +
      '  ·  ' + plural(this.occurs, 'match', 'matches') + ' in ' + plural(this.matched, 'entity', 'entities') +
      '  ·  ' + this.rendered + ' on screen' +
      (this.state === 'paused' ? '  ·  paused' : this.state === 'done' ? '  ·  finished' : '');
    var per = this.perTypeText();
    // `.fretc-progress` is `white-space: pre-wrap` - one of the rules pinned across the
    // plugins - so the second line is a newline rather than a second element.
    this.progressEl.textContent = per ? head + '\n' + per : head;
  };

  Run.prototype.begin = function () {
    this.checkVersion();
    var other = C.foreignLease(PLUGIN_ID);
    if (other) {
      // Not a stand-down: this plugin has nothing to suppress. A bulk run is rewriting
      // the entities being read, so a result may be a moment out of date, and saying so
      // costs a line.
      this.note('Another plugin is applying bulk changes right now (' + other.owner + ' - ' +
        other.label + '), so what this search finds may be a moment behind.');
    }
    this.progress();
  };

  Run.prototype.checkVersion = function () {
    var self = this;
    C.installedVersion(PLUGIN_ID, 'FRETCPluginVersion').then(function (installed) {
      if (!installed || installed === PLUGIN_VERSION) { self.showStale(''); return; }
      self.stale = true;
      var msg = '⚠ This page is running ' + PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION +
        ', but Stash has ' + installed + ' installed. Reload the page (F5); if this warning ' +
        'comes back, hard-refresh with Ctrl+Shift+R (⌘+Shift+R on a Mac).';
      self.msg('WARN', msg);
      self.showStale(msg);
    });
  };

  // ── Searching ─────────────────────────────────────────────────────────────

  Run.prototype.go = function () {
    if (this.goBtn.disabled) return;
    if (this.state === 'running') { this.state = 'paused'; this.syncFooter(); this.progress(); return; }
    if (this.state === 'paused') { this.resume(); return; }
    this.start();
  };

  Run.prototype.refresh = function () {
    this.msg('INFO', 'Searching again from the beginning.');
    this.start();
  };

  Run.prototype.start = function () {
    var self = this;
    var text = this.textInput.value.trim();
    if (!text) return;                       // an empty box does nothing, as asked
    C.clearStale(this.goBtn);                // read afresh: neither button is stale any more
    C.clearStale(this.refreshBtn);
    var epoch = ++this.epoch;
    this.needle = text;
    this.searchedKey = this.searchKey();
    // Captured with the needle, and read by the scan *and* by a replacement. Toggling the
    // box after a search would otherwise let Replace match on terms the list on screen was
    // not found by - and the list is the plan.
    this.matchCase = this.caseSensitive;
    this.matchWhole = this.wholeWord;
    this.results = [];
    this.scanned = 0;
    this.matched = 0;
    this.occurs = 0;
    this.occursPer = {};
    this.skipped = 0;
    this.skip = null;
    this.searchFailed = false;
    this.total = null;
    this.scannedPer = {};
    this.totals = {};
    // The attributes read are the ones on at the press, as the types are: a toggle clicked
    // while it runs filters the screen, not the read. (`childNodes` is walked with a `while`
    // elsewhere, never `slice`: in a real browser it is a **NodeList**, which has none of
    // Array's methods; `.tests/style.test.js` fails on any array method reached through it.)
    this.readsOn = this.readOn();
    this.pageAt = 0;
    this.shownCount = 0;
    this.remember('history', text);
    this.titleEl.textContent = PLUGIN_NAME + ' - "' + text + '"';
    this.queue = this.chosen().slice();
    // The queue is consumed as the search goes; this stays, so the breakdown goes on
    // naming every type the search covers rather than only the ones it has left.
    this.searching = this.queue.slice();
    this.page = 1;
    this.state = 'running';
    this.syncFooter();
    this.msg('INFO', 'Looking for "' + text + '" in ' +
      this.queue.map(function (k) { return ENTITIES[k].plural; }).join(', ') + '.');
    this.clearRows();                        // after the message, so it reads in order
    var types = this.queue.slice();
    // Held as a page in flight while the reads before the first page run: a Pause and Resume
    // in them leaves the chain to this one, which starts when they are in, rather than starting
    // a second.
    this.inFlight = epoch;
    describeFields().then(function (shapes) {
      if (!self.shapes) self.shapesIn(shapes);
      // The count is the one failure here that is survivable, so it is the only one
      // caught - and it is caught *inside* the chain rather than beside it, or a failed
      // introspection would land in the same handler and the scan would run with no
      // field shapes at all.
      return countOf(types).then(function (counts) {
        if (self.epoch !== epoch) return;
        self.total = counts.total;
        self.totals = counts.per;
        self.progress();
      }, function () { /* no denominator is not a reason not to search */ });
    }).then(function () {
      return self.removedSet();
    }).then(function (skip) {
      if (self.inFlight === epoch) self.inFlight = null;
      if (self.epoch !== epoch) return;
      self.skip = skip;
      return self.step(epoch);
    }).then(null, function (e) {
      if (self.inFlight === epoch) self.inFlight = null;
      if (self.state !== 'running') return;
      self.searchFailed = true;
      self.msg('ERROR', 'The search failed: ' + (e && e.message ? e.message : String(e)));
      self.finish();
    });
  };

  Run.prototype.resume = function () {
    var self = this;
    if (this.state === 'done' || !this.queue) return;
    this.state = 'running';
    this.foldMark = _foldSkips;
    this.syncFooter();
    // Paused and resumed while a page was still in flight (a double-click on Pause): that
    // page's chain carries on when it lands, so a second chain would read every page twice.
    if (this.inFlight === this.epoch) return;
    this.step(this.epoch).then(null, function (e) {
      if (self.state !== 'running') return;
      self.searchFailed = true;
      self.msg('ERROR', 'The search failed: ' + (e && e.message ? e.message : String(e)));
      self.finish();
    });
  };

  // One page of one type per turn, so Pause has somewhere to stand and the buffer can
  // stop the search rather than the search having to know about the buffer. `epoch` is
  // what stops a page that was already in flight from appending to a listing the user
  // has since restarted.
  Run.prototype.step = function (epoch) {
    var self = this;
    if (epoch !== this.epoch || this.state !== 'running') return Promise.resolve();
    if (!this.queue.length) { this.finish(); return Promise.resolve(); }
    var spec = ENTITIES[this.queue[0]];
    var fields = this.shapes[spec.key] || [], on = this.readsOn;
    if (!fields.length || !readsAny(spec, fields, on)) {
      this.msg('WARN', !fields.length ? 'This Stash has none of the text fields this plugin looks for on ' +
        spec.plural + '; that type is skipped.' : 'Every attribute ' + spec.plural + ' have is turned off; ' +
        'that type is skipped.');
      // Out of the breakdown too, or it would sit there as a zero that never moves and
      // read as a type still to come. The message above is what says it was skipped.
      var at = this.searching.indexOf(spec.key);
      if (at !== -1) this.searching.splice(at, 1);
      // And out of the total, or a finished search would never reach it.
      if (this.total != null && this.totals[spec.key] != null) {
        this.total -= this.totals[spec.key];
        delete this.totals[spec.key];
      }
      this.queue.shift();
      this.page = 1;
      return this.step(epoch);
    }
    this.loadingWhat = spec.plural;
    this.inFlight = epoch;
    return gqlRequest(pageQuery(spec, fields),
      { f: { page: this.page, per_page: READ_PAGE, sort: 'id', direction: 'ASC' } })
      .then(function (data) {
        if (self.inFlight === epoch) self.inFlight = null;
        if (epoch !== self.epoch) return;
        var block = data[spec.find] || {};
        var list = block[spec.list] || [];
        self.scannedPer[spec.key] = (self.scannedPer[spec.key] || 0) + list.length;
        list.forEach(function (ent) {
          self.scanned++;
          if (removed(self.skip, spec.key, ent)) { self.skipped++; return; }
          var hit = scanEntity(spec, fields, ent, self.needle, self.matchCase, on, self.matchWhole);
          if (!hit) return;
          self.matched++;
          var n = hit.attrs.reduce(function (t, a) { return t + a.count; }, 0);
          self.occurs += n;
          self.occursPer[spec.key] = (self.occursPer[spec.key] || 0) + n;
          self.results.push(hit);
          if (!self.shownAttrs(hit).length) return;
          // Drawn only when it lands on the page on screen, so the page being read stays put. Never
          // before it: the pager only reaches lines already found.
          if (self.shownCount++ < self.pageAt + linesDrawn()) self.addRow(hit);
        });
        if (list.length < READ_PAGE) { self.queue.shift(); self.page = 1; } else self.page++;
        self.syncPager();
        self.progress();
        // ponytail: every hit is kept until the dialog closes (a few hundred bytes each, ~50 MB at
        // 100k); Pause is the brake. A cap that pauses by itself, if a library ever needs one.
        return self.step(epoch);
      }, function (e) {
        if (self.inFlight === epoch) self.inFlight = null;
        throw e;
      });
  };

  // One line per phase, and only where a field was actually refused. Silence would put
  // this in the same position as a wrong field name: "nothing found" and "not searched"
  // reading identically.
  Run.prototype.noteFolds = function (mark) {
    var n = _foldSkips - mark;
    if (n <= 0) return;
    this.msg('WARN', plural(n, 'field') + ' could not be matched case-insensitively: the ' +
      'text holds a character whose lower case is longer than itself, so a position in it ' +
      'would not point at the same character. Tick Case-sensitive to search those exactly ' +
      'as typed.');
  };

  Run.prototype.finish = function () {
    this.state = 'done';
    this.loadingWhat = '';
    this.syncFooter();
    this.syncPager();
    this.progress();
    this.noteFolds(this.foldMark);
    if (this.skipped) this.msg('INFO', this.skippedLine(this.skipped));
    this.msg('INFO', this.matched
      ? 'Finished: ' + plural(this.matched, 'entity', 'entities') + ' mention "' +
        this.needle + '" (' + plural(this.occurs, 'match', 'matches') + '), out of ' + plural(this.scanned, 'entity', 'entities') + ' read.'
      : 'Finished: nothing in the ' + plural(this.scanned, 'entity', 'entities') +
        ' read mentions "' + this.needle + '".');
    var differ = this.results.filter(function (hit) {
      return hit.attrs.some(function (a) { return a.differs; });
    }).length;
    if (differ) {
      this.msg('INFO', plural(differ, 'entity', 'entities') + (differ === 1 ? ' holds' : ' hold') +
        ' a match written in another case than "' + this.needle + '", marked case differs. ' +
        'Replace rewrites those too; tick Case-sensitive and search again to leave them out.');
    }
  };

  // ── Exporting ─────────────────────────────────────────────────────────────
  //
  // Its own read, apart from the search: one page of one type at a time, as a search reads,
  // into the file's pieces as it goes, so nothing but the file is kept - but Term counts, which
  // counts over every text at the end. Stop export and Close end it, and save nothing.
  // What De-Spicer would remove, as `{ type: { id: true } }`, while Skip what De-Spicer removes is ticked; null
  // otherwise, or where De-Spicer cannot say - which the log says, since then nothing is left out.
  Run.prototype.removedSet = function () {
    var self = this, api = (coop().api || {}).DeSpicer;
    if (!this.skipRemoved) return Promise.resolve(null);
    if (!api || typeof api.removals !== 'function') {
      this.msg('WARN', 'De-Spicer is not installed or enabled, or too old to say what it removes, so nothing is skipped.');
      return Promise.resolve(null);
    }
    return Promise.resolve().then(function () { return api.removals(); }).then(function (r) {
      if (!r || !r.tag) { self.msg('INFO', 'De-Spicer has no Remove Everything Tagged tag set, so nothing is skipped.'); return null; }
      (r.notes || []).forEach(function (n) { self.msg('INFO', 'De-Spicer: ' + n); });
      var set = {};
      Object.keys(r.ids || {}).forEach(function (k) {
        set[k] = {};
        r.ids[k].forEach(function (id) { set[k][String(id)] = true; });
      });
      self.removedTag = r.tag;
      return set;
    }, function (e) {
      self.msg('WARN', 'De-Spicer could not say what it removes (' + (e && e.message ? e.message : String(e)) + '), so nothing is skipped.');
      return null;
    });
  };
  function removed(skip, typeKey, ent) { return !!(skip && skip[typeKey] && skip[typeKey][String(ent.id)]); }
  Run.prototype.skippedLine = function (n) {
    return 'Left out ' + plural(n, 'entity', 'entities') + ' De-Spicer removes: carrying "' + this.removedTag + '" or a tag under it.';
  };

  Run.prototype.exportAll = function () {
    var self = this;
    if (this.exporting) {
      this.xEpoch++;
      this.exporting = false;
      this.msg('INFO', 'Export stopped. Nothing was saved.');
      this.syncFooter();
      this.progress();
      return Promise.resolve();
    }
    if (this.exportBtn.disabled) return Promise.resolve();
    var xEpoch = ++this.xEpoch;
    var live = function () { return self.xEpoch === xEpoch; };
    var queue = this.chosen().slice();
    var fmt = formatOf(this.exportFormat);
    var min = this.minCount, on = this.readOn();
    var parts = [], texts = [], read = 0, entities = 0, stores = 0, page = 1, termRows = 0, skip = null, skipped = 0;
    this.exporting = true;
    this.syncFooter();
    this.msg('INFO', 'Exporting the text of ' + queue.map(function (k) { return ENTITIES[k].plural; }).join(', ') +
      ' as ' + fmt.label + (fmt.key === 'terms' ? ', listing what occurs at least ' + plural(min, 'time') : '') + '.');
    function collect(spec, shapes, ent) {
      if (fmt.key === 'json' || fmt.key === 'yaml') {
        var item = exportItem(spec, shapes, ent, on);
        parts.push(fmt.key === 'json' ? (entities ? ',\n' : '[\n') + JSON.stringify(item) : yamlItem(item));
      } else {
        var into = fmt.key === 'text' ? function (t) { parts.push(t + '\n'); } : function (t) { texts.push(t); };
        eachText(shapes, ent, function (label, t) { if (t) into(t); }, on);
      }
      entities++;
    }
    function next(shapes) {
      if (!live()) return null;
      if (!queue.length) return true;
      var spec = ENTITIES[queue[0]], fields = shapes[spec.key] || [];
      if (!fields.length || !readsAny(spec, fields, on)) {
        self.msg('WARN', !fields.length ? 'This Stash has none of the text fields this plugin looks for on ' + spec.plural +
          '; that type is left out.' : 'Every attribute ' + spec.plural + ' have is turned off; that type is left out.');
        queue.shift();
        page = 1;
        return next(shapes);
      }
      self.progressEl.textContent = 'Exporting: ' + plural(read, 'entity', 'entities') + ' read (' + spec.plural + ')';
      return gqlRequest(pageQuery(spec, fields), { f: { page: page, per_page: READ_PAGE, sort: 'id', direction: 'ASC' } })
        .then(function (data) {
          if (!live()) return null;
          var list = (data[spec.find] || {})[spec.list] || [];
          list.forEach(function (ent) {
            read++;
            // Custom Fields Bulk Editor's description store is that plugin's JSON, not the library's text.
            if (isPluginStore(ent)) { stores++; return; }
            if (removed(skip, spec.key, ent)) { skipped++; return; }
            collect(spec, fields, ent);
          });
          if (list.length < READ_PAGE) { queue.shift(); page = 1; } else page++;
          return next(shapes);
        });
    }
    return this.removedSet().then(function (s) { skip = s; return describeFields(); }).then(next).then(function (done) {
      if (!done || !live()) return false;
      if (skipped) self.msg('INFO', self.skippedLine(skipped));
      if (stores) self.msg('INFO', 'Left out ' + CFBE_NAME + '\'s description store: its text is that plugin\'s, not the library\'s.');
      if (fmt.key === 'json') parts.push(entities ? '\n]\n' : '[]\n');
      if (fmt.key !== 'terms') return true;
      self.progressEl.textContent = 'Exporting: counting the words of ' + plural(entities, 'entity', 'entities') + '...';
      return deSpicerTerms().then(function (dsp) {
        if (!live()) return false;
        if (dsp === null) {
          self.msg('INFO', 'De-Spicer is not installed or not enabled, so the two De-Spicer columns are empty.');
        } else if (dsp === false) {
          self.msg('WARN', 'De-Spicer could not read its Explicit Terms, so the two De-Spicer columns are empty.');
        }
        var rows = termCounts(texts, min);
        texts = null;
        parts.push('\ufeffTerm,Words,Length,Total,Independent,In combo,In De-Spicer,De-Spicer replacement,Spellings\n');
        rows.forEach(function (r) {
          // A term of De-Spicer's is "yes"; a phrase holding one is "subset", with what De-Spicer's
          // own replacement makes of it ("standing blowjob" becomes "standing mouth massage").
          var to = dsp ? dsp.lookup(r.term) : null, mark = to == null ? '' : 'yes';
          if (to == null && dsp && typeof dsp.replace === 'function') {
            var out = dsp.replace(r.term);
            if (out !== r.term) { mark = 'subset'; to = out; }
          }
          parts.push([r.term, r.words, r.term.length, r.total, r.total - r.inside, r.inside,
            mark, to == null ? '' : to, r.spellings.join('; ')].map(csvCell).join(',') + '\n');
        });
        termRows = rows.length;
        return true;
      });
    }).then(function (done) {
      if (!done || !live()) return;
      var name = exportName(fmt);
      var what = fmt.key === 'terms'
        ? plural(termRows, 'term') + ' used at least ' + plural(min, 'time') + ', from ' + plural(entities, 'entity', 'entities')
        : plural(entities, 'entity', 'entities');
      if (download(name, parts, fmt.type + ';charset=utf-8')) {
        // The browser never tells a page where it put a download, so the folder is named as the browser's.
        self.msg('INFO', 'Saved to your browser\'s downloads as ' + name + ': ' + what + '.');
        self.exported = 'Exported ' + plural(read, 'entity', 'entities') + ' read: saved to your browser\'s downloads as ' + name + '.';
      } else {
        self.msg('ERROR', 'This page cannot save a file, so nothing was saved (' + what + ' read).');
      }
    }, function (e) {
      if (!live()) return;
      self.msg('ERROR', 'The export failed: ' + (e && e.message ? e.message : String(e)) + '. Nothing was saved.');
    }).then(function () {
      if (!live()) return;
      self.exporting = false;
      self.syncFooter();
      self.progress();
    });
  };

  // ── Replacing ─────────────────────────────────────────────────────────────
  //
  // **The plan is already on screen.** The repo's standing rule is that no deliberate
  // write happens without a plan in front of the user; here the result list *is* that
  // plan and it was drawn before this button became pressable - one line per entity,
  // naming it, which attributes matched, how many times each, and the text around the
  // first match. The attribute filters narrow it, and a press covers exactly what the
  // list shows. So there is no second review dialog: putting one in front of a list that
  // already enumerates every entity would be a plan of a plan.
  //
  // Three things this does that a first cut would not:
  //
  //   - **It re-reads every entity before rewriting it.** The scan's values are as old as
  //     the scan, which on a large library is minutes, and the repo has already paid for
  //     trusting a stale read once. One aliased read per chunk, then one mutation per
  //     entity - there is no bulk mutation that can give each entity different text.
  //   - **It sends only fields the update input actually has.** `describeInputs` answers
  //     that; a field the input does not carry is dropped with a line saying so, because
  //     a mutation naming one fails outright and would take the whole entity with it.
  //   - **It keeps the previous values**, which is what makes Undo an exact per-field
  //     inverse rather than a restore of a whole record.
  var WRITE_CHUNK = 50;   // entities re-read per query before their mutations go out

  Run.prototype.replaceAll = function () {
    if (this.replaceBtn.disabled) return;
    var self = this;
    // The text searched, which is what the listing shows matches of - not the box as it reads now,
    // which may have been edited since without searching again.
    var needle = this.needle;
    var to = this.replaceInput.value;
    var scope = this.replaceScope();
    // The attributes as they were at the press: a toggle clicked during the write changes the
    // listing, not what this pass writes.
    var on = {};
    for (var a in this.attrOn) if (hasOwn(this.attrOn, a)) on[a] = this.attrOn[a];
    this.remember('replaceHistory', to);
    // Added to what an earlier press left for Undo, never in place of it: one Undo takes back every
    // press since the last, newest first.
    this.msg('INFO', 'Replacing "' + needle + '" with ' + (to ? '"' + to + '"' : 'nothing') +
      ' in ' + plural(scope.length, 'entity', 'entities') + ' on this list.');
    if (this.results.some(function (hit) {
      return self.shownAttrs(hit).some(function (a) { return a.label === FILE_LABEL; });
    })) {
      this.msg('INFO', 'File names are found, never rewritten here: renaming a file is ᝯㄝₓ Scene Filename Manager\'s.');
    }
    this.searchedKey = null;                 // the library changed: Search is worth pressing again
    // Locked for the round trip, so a second press cannot start a second pass.
    this.writing = true;
    this.syncFooter();
    Promise.all([fieldLocks(), C.pluginConfig().then(function (d) { return ((d || {}).configuration || {}).plugins; },
      function () { return null; })]).then(function (both) {
      var locks = both[0];
      self.locks = locks;
      self.isOwned = C.ownedFields(both[1]);
      if (locks === null) {
        self.msg('INFO', 'ᝯㄝₓ Custom Fields Bulk Editor is not installed, or too old to ' +
          'publish its Locked Custom Fields list, so no custom field is locked for this ' +
          'replacement.');
      } else if (locks === false) {
        self.msg('WARN', 'ᝯㄝₓ Custom Fields Bulk Editor could not say which custom fields ' +
          'are locked, so this replacement changes no custom field at all.');
      } else if (locks.names.length) {
        self.msg('INFO', 'Locked custom ' + (locks.names.length === 1 ? 'field' : 'fields') +
          ', left alone: ' + locks.names.map(function (n) { return '"' + n + '"'; }).join(', ') + '.');
      }
      self.runWrites(scope, 'Replace', function (hit, ent, shapes, inputFields) {
        return self.replacementFor(hit, ent, shapes, inputFields, needle, to, self.matchCase, on, self.matchWhole);
      });
    });
  };

  Run.prototype.undo = function () {
    if (this.undoBtn.disabled || !this.changes.length) return;
    var self = this;
    var back = this.changes.slice().reverse();
    this.changes = [];
    this.msg('INFO', 'Undoing: putting back ' + plural(back.length, 'entity', 'entities') + '.');
    // Straight from what was recorded, with no re-read: an Undo is the inverse of a write
    // this dialog made, and re-reading would only let a change made elsewhere in between
    // decide what "before" meant.
    this.searchedKey = null;
    this.writing = true;
    this.syncFooter();
    var lease = C.lease(PLUGIN_ID, 'Find & Replace (undo)', LEASE_TTL_MS);
    var pass = journalPass('Find & Replace, undone');
    var i = 0;
    var ok = 0;
    var failed = 0;
    var retry = [];
    function next() {
      if (i >= back.length || self.stopping) {
        var left = retry.concat(back.slice(i));
        lease.release();
        self.writing = false;
        self.stopping = false;
        // What Stop did not reach, and what failed, is still this dialog's to put back, so it
        // goes back on the pile rather than being dropped: pressing Undo again carries on.
        if (left.length) self.changes = left.slice().reverse().concat(self.changes);
        self.syncFooter();
        pass.finish().then(function (line) { if (line) self.msg('INFO', line); });
        self.msg('INFO', 'Undo ' + (i < back.length ? 'stopped' : 'finished') + ': ' +
          plural(ok, 'entity', 'entities') + ' put back' +
          (failed ? ', ' + plural(failed, 'failure') : '') +
          (left.length ? ', ' + plural(left.length, 'entity', 'entities') + ' left for Undo' : '') +
          '. The list on screen still describes what was found before either write - ' +
          'press Refresh to search again.');
        return;
      }
      lease.renew();
      var c = back[i++];
      self.sendUpdate(c.typeKey, c.id, c.input).then(function () {
        ok++;
        // Recorded from the Replace's own run in the history, reversed - nothing is kept here.
        pass.reverse(c.run, c.typeKey, c.id);
      }, function (e) {
        failed++;
        retry.push(c);
        self.msg('ERROR', ENTITIES[c.typeKey].label + ' ' + c.id + ' could not be put back: ' +
          (e && e.message ? e.message : String(e)));
      }).then(next);
    }
    next();
  };

  // Undo History, which ᝯㄝₓ Core keeps: a pass collects what it wrote and records it
  // when it ends, so it can be undone after this dialog has closed.
  function journalPass(label) {
    return coop().journal.pass({ plugin: PLUGIN_SHORT_NAME, label: label, libraryWide: true });
  }

  // One mutation, named from the table rather than assembled at each call site.
  Run.prototype.sendUpdate = function (typeKey, id, input) {
    var spec = ENTITIES[typeKey];
    var vars = { input: {} };
    var k;
    for (k in input) if (hasOwn(input, k)) vars.input[k] = input[k];
    vars.input.id = String(id);
    return gqlRequest('mutation FRETC_Update($input: ' + spec.input + '!) { ' +
      spec.mutation + '(input: $input) { id } }', vars);
  };

  // The chunked read-then-write loop both Replace and a future second operation would
  // use. `build` is handed the fresh entity and answers `{input, undo, lines}` or null
  // for an entity nothing in scope still matches - which is not a failure: it is an
  // entity something else changed between the search and the press.
  Run.prototype.runWrites = function (scope, label, build) {
    var self = this;
    this.writing = true;
    this.syncFooter();
    var lease = C.lease(PLUGIN_ID, 'Find & Replace', LEASE_TTL_MS);
    var pass = journalPass(label);
    var foldMark = _foldSkips;
    var written = 0;
    var skipped = 0;
    var failed = 0;
    var at = 0;
    var dropped = {};
    var lockedHits = {};    // locked field name -> entities it was left alone on
    var ownedHits = {};     // another plugin's own field -> entities it was left alone on
    var lockedOnly = 0;     // entities whose every match was in a locked field
    var ownedOnly = 0;      // entities whose every match was in another plugin's own field
    var storeSkipped = 0;   // entities carrying a sibling plugin's store, never rewritten

    function chunk() {
      var stopped = self.stopping && at < scope.length;
      if (at >= scope.length || self.stopping) {
        lease.release();
        self.writing = false;
        self.stopping = false;
        self.syncFooter();
        pass.finish().then(function (line) { if (line) self.msg('INFO', line); });
        var missing = Object.keys(dropped);
        if (missing.length) {
          self.msg('WARN', 'This Stash has no ' + missing.join(', ') + ' on the update ' +
            'inputs for those types, so ' + (missing.length === 1 ? 'that field was' :
              'those fields were') + ' left alone.');
        }
        self.noteFolds(foldMark);
        if (storeSkipped) {
          self.msg('WARN', 'Left alone: ' + plural(storeSkipped, 'entity', 'entities') + ' carrying ' + CFBE_NAME +
            '\u2019s custom field descriptions, kept as JSON - rewriting it by text would break it.');
        }
        var ownedNames = Object.keys(ownedHits).sort();
        if (ownedNames.length) {
          self.msg('INFO', 'Left alone, as fields another ᝯㄝₓ plugin keeps for itself: ' + ownedNames.map(function (n) {
            return '"' + n + '" on ' + plural(ownedHits[n], 'entity', 'entities');
          }).join(', ') + '. Rewriting one would break its owner.');
        }
        var lockedNames = Object.keys(lockedHits);
        if (lockedNames.length) {
          self.msg('WARN', 'Left alone because the field is locked: ' +
            lockedNames.map(function (n) {
              return n === '' ? 'every custom field on ' + plural(lockedHits[n], 'entity', 'entities') +
                ' (the locks could not be read)'
                : '"' + n + '" on ' + plural(lockedHits[n], 'entity', 'entities');
            }).join(', ') + '.');
        }
        self.msg('INFO', label + (stopped ? ' stopped: ' : ' finished: ') +
          plural(written, 'entity', 'entities') +
          ' rewritten' + (skipped ? ', ' + skipped + ' no longer matching' : '') +
          (lockedOnly ? ', ' + lockedOnly + ' matching only in a locked field' : '') +
          (ownedOnly ? ', ' + ownedOnly + ' matching only in another plugin\u2019s own field' : '') +
          (stopped ? ', ' + (scope.length - at) + ' not reached' : '') +
          (failed ? ', ' + plural(failed, 'failure') : '') + '. The list on screen still ' +
          'describes what was found before it - press Refresh to search again.');
        return;
      }
      lease.renew();
      var part = scope.slice(at, at + WRITE_CHUNK);
      at += part.length;
      self.reread(part).then(function (fresh) {
        var seq = Promise.resolve();
        part.forEach(function (hit, i) {
          seq = seq.then(function () {
            var ent = fresh[i];
            if (!ent) {
              skipped++;
              self.msg('WARN', ENTITIES[hit.typeKey].label + ' ' + hit.id +
                ' no longer exists; nothing was written to it.');
              return null;
            }
            if (isPluginStore(ent)) { storeSkipped++; return null; }
            var plan = build(hit, ent, self.shapes[hit.typeKey] || [],
              (self.inputs || {})[hit.typeKey] || {});
            (plan && plan.dropped ? plan.dropped : []).forEach(function (f) { dropped[f] = true; });
            (plan && plan.owned ? plan.owned : []).forEach(function (f) {
              ownedHits[f] = (ownedHits[f] || 0) + 1;
            });
            (plan && plan.locked ? plan.locked : []).forEach(function (f) {
              lockedHits[f] = (lockedHits[f] || 0) + 1;
            });
            if (plan && plan.clashed && plan.clashed.length) {
              self.msg('WARN', ENTITIES[hit.typeKey].label + ' ' + hit.id + ': no custom field renamed onto ' +
                plan.clashed.map(function (k) { return '"' + k + '"'; }).join(', ') +
                ', which it already has - that value is kept.');
            }
            if (plan && !plan.count && plan.locked && plan.locked.length) { lockedOnly++; return null; }
            if (plan && !plan.count && plan.owned && plan.owned.length) { ownedOnly++; return null; }
            if (!plan || !plan.count) { skipped++; return null; }
            lease.renew();
            return self.sendUpdate(hit.typeKey, hit.id, plan.input).then(function () {
              written++;
              self.changes.push({ typeKey: hit.typeKey, id: hit.id, input: plan.undo,
                run: pass.id });
              pass.add(hit.typeKey, hit.id, hit.name, plan.input, plan.undo);
              // **`EDIT`, not `INFO`.** Every other line this dialog writes is about the
              // run - what it is looking for, how far it got, what it could not do. These
              // are the only ones that say an entity in the library was changed, and a log
              // where a write reads like a status line is one where the writes cannot be
              // found. The siblings' `TAG` / `ADD` / `REMOVE` kinds are the same idea.
              self.msg('EDIT', ENTITIES[hit.typeKey].label + ' "' +
                (hit.name || '(untitled)') + '" (' + hit.id + '): ' + plan.summary);
            }, function (e) {
              failed++;
              self.msg('ERROR', ENTITIES[hit.typeKey].label + ' ' + hit.id + ' failed: ' +
                (e && e.message ? e.message : String(e)));
            });
          });
        });
        return seq;
      }, function (e) {
        failed += part.length;
        self.msg('ERROR', 'Re-reading a batch failed, so none of it was written: ' +
          (e && e.message ? e.message : String(e)));
      }).then(chunk);
    }

    // The input shapes are asked for once and only when something is about to be
    // written - a dialog that never replaces never issues this query.
    // Without them nothing says which fields the mutation may name, so nothing is written - and the
    // run ends as a Stop would, every entity counted as not reached. A press after asks again.
    describeInputs().then(function (inputs) { self.inputs = inputs; }, function (e) {
      self.stopping = true;
      self.msg('ERROR', 'The update inputs could not be read, so nothing was written: ' +
        (e && e.message ? e.message : String(e)) + '. Press ' + label + ' again to try once more.');
    }).then(chunk);
  };

  // One aliased query per chunk, grouped nowhere: `r0: findScene(id: "1") {...}` beside
  // `r1: findTag(id: "9") {...}` is legal and saves splitting a mixed list by type.
  Run.prototype.reread = function (hits) {
    var self = this;
    var parts = hits.map(function (hit, i) {
      var spec = ENTITIES[hit.typeKey];
      var sel = ['id'];
      (self.shapes[hit.typeKey] || []).forEach(function (f) { sel.push(f.name); });
      return 'r' + i + ': ' + spec.one + '(id: ' + JSON.stringify(String(hit.id)) + ') { ' +
        sel.join(' ') + ' }';
    });
    return gqlRequest('query FRETC_Reread { ' + parts.join(' ') + ' }', null)
      .then(function (data) {
        return hits.map(function (hit, i) { return (data && data['r' + i]) || null; });
      });
  };

  // What one entity's update carries, its inverse, and the line the log gets. Null where
  // the fresh values no longer hold the text - an entity something else changed in
  // between, which is worth skipping quietly rather than rewriting from a stale idea of
  // what it said.
  Run.prototype.replacementFor = function (hit, ent, shapes, inputFields, needle, to, cased, on, whole) {
    var shown = {};
    hit.attrs.forEach(function (a) { if ((on || this.attrOn)[a.label] !== false) shown[a.label] = true; }, this);
    var input = {};
    var undo = {};
    var parts = [];
    var dropped = [];
    var locked = [];
    var clashed = [];
    var owned = [];
    var count = 0;
    var locks = this.locks;
    var isOwned = this.isOwned;

    shapes.forEach(function (f) {
      var label = f.name === 'custom_fields' ? null : (FIELD_LABEL[f.name] || f.name);
      var v = ent[f.name];
      if (f.kind === 'string') {
        if (!shown[label] || typeof v !== 'string' || !occurrences(v, needle, cased, whole).length) return;
        if (!hasOwn(inputFields, f.name)) { dropped.push(f.name); return; }
        input[f.name] = replaceAllIn(v, needle, to, cased, whole);
        undo[f.name] = v;
        count++;
        parts.push(label);
        return;
      }
      if (f.kind === 'list') {
        if (!shown[label] || !v || !v.length) return;
        var hits = v.filter(function (str) {
          return typeof str === 'string' && occurrences(str, needle, cased, whole).length;
        });
        if (!hits.length) return;
        if (!hasOwn(inputFields, f.name)) { dropped.push(f.name); return; }
        input[f.name] = v.map(function (str) {
          return typeof str === 'string' ? replaceAllIn(str, needle, to, cased, whole) : str;
        });
        undo[f.name] = v.slice();
        count++;
        parts.push(label);
        return;
      }
      // The custom-field map. A **key** that matches is a rename - the old key is removed
      // and the new one set - and a **value** that matches is a plain update. The undo is
      // per field too: the old value put back, a renamed key's new name removed. A rename
      // onto a key the entity already has is refused, so that inverse stays exact and no
      // value is overwritten.
      if (!v || typeof v !== 'object') return;
      var partial = {};
      var remove = [];
      var undoPartial = {};
      var undoRemove = [];
      var touched = 0;
      Object.keys(v).forEach(function (key) {
        var newKey = shown[CF_NAME_LABEL] && occurrences(key, needle, cased, whole).length
          ? replaceAllIn(key, needle, to, cased, whole) : key;
        var val = v[key];
        var newVal = shown[CF_VALUE_LABEL] && typeof val === 'string' &&
          occurrences(val, needle, cased, whole).length ? replaceAllIn(val, needle, to, cased, whole) : val;
        if (newKey === key && newVal === val) return;
        // A field another ᝯㄝₓ plugin keeps (Core's `ownedFields`) is found by a search and never
        // rewritten by one, nor a key renamed onto its name.
        if (isOwned && (isOwned(key) || isOwned(newKey))) {
          var mine = isOwned(key) ? key : newKey;
          if (owned.indexOf(mine) === -1) owned.push(mine);
          return;
        }
        // A locked field keeps its name and its value, and no key is renamed onto one.
        // Locks that could not be read (`false`) lock every field; '' records that.
        if (locks === false) { if (locked.indexOf('') === -1) locked.push(''); return; }
        if (locks && (locks.isLocked(key) || locks.isLocked(newKey))) {
          var which = locks.isLocked(key) ? key : newKey;
          if (locked.indexOf(which) === -1) locked.push(which);
          return;
        }
        if (newKey !== key && (hasOwn(v, newKey) || hasOwn(partial, newKey))) {
          if (clashed.indexOf(newKey) === -1) clashed.push(newKey);
          return;
        }
        touched++;
        if (newKey !== key) { remove.push(key); undoRemove.push(newKey); }
        partial[newKey] = newVal;
        undoPartial[key] = val;
      });
      if (!touched) return;
      if (!hasOwn(inputFields, 'custom_fields')) { dropped.push('custom_fields'); return; }
      input.custom_fields = { partial: partial };
      if (remove.length) input.custom_fields.remove = remove;
      undo.custom_fields = { partial: undoPartial };
      if (undoRemove.length) undo.custom_fields.remove = undoRemove;
      count++;
      parts.push(remove.length ? CF_NAME_LABEL : CF_VALUE_LABEL);
    });

    return { input: input, undo: undo, count: count, dropped: dropped, locked: locked, clashed: clashed, owned: owned,
      summary: parts.join(', ') + ' \u21d2 ' + (to ? '"' + to + '"' : 'nothing') };
  };

  // ── The listing ───────────────────────────────────────────────────────────

  // **Appended, not inserted at the top.** The listing and the messages share one box and
  // one scrollbar, so the box has to read in the order things happened: the line saying
  // what is being looked for, then the results under it, then whatever the run had to say
  // afterwards. Putting the list first pushed every message below it, so the first thing
  // written ended up last on the page - which is what a reader takes for the newest.
  //
  // A fresh block each time rather than emptying the old one, so a Refresh
  // starts its results *after* the message that explains why they start again.
  //
  // The pager bar is built here, once per list, and only relabelled as results arrive: rebuilt on
  // every page read, its buttons were replaced between a press and its release, and a click whose
  // two halves land on different elements is no click - Next did nothing until the search ended.
  Run.prototype.clearRows = function () {
    var self = this;
    if (this.pageEl && this.pageEl.parentNode) this.pageEl.parentNode.removeChild(this.pageEl);
    this.pageEl = el('div', 'fretc-page');
    this.pagerEl = el('div', 'fretc-search fretc-search-wrap fretc-pager fretc-hidden');
    this.pagerLabel = this.pagerEl.appendChild(el('span', 'fretc-label', ''));
    var page = function (by) {
      return function () {
        self.pageAt = Math.max(0, self.pageAt + by * linesDrawn());
        self.redraw();
        self.jump(true);
      };
    };
    this.prevBtn = this.pagerEl.appendChild(button('Previous', 'fretc-prevpage'));
    this.nextBtn = this.pagerEl.appendChild(button('Next', 'fretc-nextpage'));
    this.topBtn = this.pagerEl.appendChild(button('\u2912 Top', 'fretc-toppage'));
    this.bottomBtn = this.pagerEl.appendChild(button('\u2913 Bottom', 'fretc-bottompage'));
    this.prevBtn.addEventListener('click', page(-1));
    this.nextBtn.addEventListener('click', page(1));
    this.topBtn.addEventListener('click', function () { self.jump(true); });
    this.bottomBtn.addEventListener('click', function () { self.jump(false); });
    this.topBtn.title = 'Scroll to the first line of this page.';
    this.bottomBtn.title = 'Scroll to the last line of this page.';
    this.listEl = el('div', 'fretc-results');
    this.pageEl.appendChild(this.pagerEl);
    this.pageEl.appendChild(this.listEl);
    this.logEl.appendChild(this.pageEl);
    if (this.spinEl) this.logEl.appendChild(this.spinEl);   // the cursor stays last
    this.rendered = 0;
  };

  // The page's first line, or its last, brought into view.
  Run.prototype.jump = function (top) {
    var to = top ? this.pageEl : this.listEl.lastChild;
    if (to && to.scrollIntoView) to.scrollIntoView({ block: top ? 'start' : 'end' });
  };

  // The attributes of one result that are still showing. An entity that matched in Title
  // and in Details, with Details turned off, is still a Title match and stays - carrying
  // only the chip that is still true.
  Run.prototype.shownAttrs = function (hit) {
    var self = this;
    return hit.attrs.filter(function (a) { return self.attrOn[a.label] !== false; });
  };

  // Redraw the page on screen. Cheap enough to run on every filter click: the filter walks the
  // results, but only one page of Core's Lines Drawn at Once is drawn.
  Run.prototype.redraw = function () {
    if (!this.listEl) return;
    var self = this, size = linesDrawn();
    var shown = this.results.filter(function (hit) { return self.shownAttrs(hit).length; });
    this.shownCount = shown.length;
    // A filter that leaves fewer lines than the page started at lands on the last page there is.
    if (this.pageAt >= shown.length) this.pageAt = Math.max(0, Math.floor((shown.length - 1) / size) * size);
    this.clearRows();
    shown.slice(this.pageAt, this.pageAt + size).forEach(function (hit) { self.addRow(hit); });
    this.syncPager();
    this.progress();
  };

  // Lines a to b of n, and the pages either side - De-Spicer's pager, drawn while the search
  // still reads: Next turns on as soon as there is a line past this page. Pinned above the list
  // (`position: sticky`), so it is in reach wherever the page is scrolled to.
  Run.prototype.syncPager = function () {
    var size = linesDrawn(), total = this.shownCount;
    if (!this.pagerEl) return;
    this.show(this.pagerEl, total > size);
    if (total <= size) return;
    var end = Math.min(total, this.pageAt + size);
    this.pagerLabel.textContent = 'Lines ' + (this.pageAt + 1) + '-' + end + ' of ' + total +
      (this.state === 'running' || this.state === 'paused' ? ' found so far' : '') +
      ' - Copy log and Replace cover every one.';
    this.prevBtn.textContent = 'Previous ' + size;
    this.nextBtn.textContent = 'Next ' + Math.min(size, total - end);
    this.prevBtn.disabled = this.pageAt === 0;
    this.nextBtn.disabled = end >= total;
    this.prevBtn.title = 'Show the ' + size + ' lines before these, from the first.';
    this.nextBtn.title = 'Show the lines after these, from the first' +
      (this.state === 'running' ? '; the search goes on reading meanwhile.' : '.');
  };

  Run.prototype.addRow = function (hit) {
    if (!this.listEl) this.clearRows();
    var shown = this.shownAttrs(hit);
    var row = el('div', 'fretc-result');
    var link = el('a', 'fretc-ent', (hit.name || '(untitled)') + ' (' + hit.id + ')');
    link.href = ENTITIES[hit.typeKey].route + hit.id;
    link.target = linkTarget();
    link.rel = 'noopener noreferrer';
    // Hovering the name says which entity this is, which is most of what a search result
    // is read for - the matched text says why it is here and nothing else does.
    entityTip(link, hit.typeKey, hit.id);
    row.appendChild(link);
    row.appendChild(el('span', 'fretc-attr', ENTITIES[hit.typeKey].label + ' · ' +
      shown.map(function (a) {
        return a.label + (a.count > 1 ? ' ×' + a.count : '');
      }).join(', ')));
    var differs = caseDiffers(shown);
    if (differs) {
      var diff = el('span', 'fretc-casediff', 'case differs');
      diff.title = plural(differs, 'match', 'matches') + ' here ' + (differs === 1 ? 'is' : 'are') +
        ' written in another case than "' + this.needle + '". Replace rewrites ' +
        (differs === 1 ? 'it' : 'them') + ' too; tick Case-sensitive and search again to ' +
        'leave ' + (differs === 1 ? 'it' : 'them') + ' out.';
      row.appendChild(diff);
    }
    if (shown.length) {
      var ctx = el('span', 'fretc-ctx');
      ctx.appendChild(el('span', null, shown[0].ctx.pre));
      ctx.appendChild(el('span', 'fretc-mark', shown[0].ctx.hit));
      ctx.appendChild(el('span', null, shown[0].ctx.post));
      row.appendChild(ctx);
    }
    this.listEl.appendChild(row);
    this.rendered++;
    return row;
  };

  // How many of the shown attributes' matches are written in another case.
  function caseDiffers(shown) {
    return shown.reduce(function (t, a) { return t + (a.differs || 0); }, 0);
  }

  Run.prototype.resultText = function (hit) {
    var shown = this.shownAttrs(hit);
    return ENTITIES[hit.typeKey].label + ' ' + (hit.name || '(untitled)') + ' (' + hit.id +
      ') · ' + shown.map(function (a) {
        return a.label + (a.count > 1 ? ' x' + a.count : '');
      }).join(', ') + (caseDiffers(shown) ? ' (case differs)' : '') +
      (shown.length ? ': ' + shown[0].ctx.pre + shown[0].ctx.hit + shown[0].ctx.post : '');
  };

  Run.prototype.copyLog = function () {
    var self = this;
    var lines = [this.progressEl.textContent, ''];
    // Every result the attribute filters leave, not only the ones the window is currently
    // showing - which is the whole reason the buffer is allowed to drop rows. A filter is
    // a choice about what is being looked at, so it is honoured here; the buffer is not a
    // choice, so it is not.
    this.results.forEach(function (hit) {
      if (self.shownAttrs(hit).length) lines.push(self.resultText(hit));
    });
    lines.push('');
    if (this.logDropped) lines.push(droppedLine(this.logDropped));
    this.logText.forEach(function (l) { lines.push(l); });
    var was = this.copyBtn.textContent;
    copyToClipboard(lines.join('\n'), function (ok) {
      holdWidth(self.copyBtn);
      self.copyBtn.textContent = ok ? 'Copied' : 'Failed';
      setTimeout(function () { self.copyBtn.textContent = was; }, 2000);
    });
  };

  // Escape acts through the footer's own exit - Core's `wireEscape` presses `cancelBtn`
  // while it is shown and enabled - rather than by calling `close()` itself, so the key
  // can never reach a button that is hidden or disabled.
  Run.prototype.close = function () {
    // The epochs move, so a page still in flight cannot append to a dialog that has gone, nor an
    // export save a file after it.
    this.epoch++;
    this.xEpoch++;
    this.state = 'done';
    C.unwireEscape(this);
    this.spin(false);
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    _active = null;
  };

  // ── The settings page ─────────────────────────────────────────────────────
  //
  // The group gets the siblings' description treatment - a one-line summary, the rest
  // behind **Show more**, the stale-script banner and a labelled link to the README -
  // from Core's `settingsPage`. No `keys`: this plugin declares no settings, so there is
  // no `plugin-<id>-<key>` id to anchor on and the group is found by its heading alone,
  // compared *exactly*; the Settings → Tasks group, headed the same, is passed over by
  // its task caption.
  var PAGE = C.settingsPage({
    id: PLUGIN_ID, name: PLUGIN_NAME, shortName: PLUGIN_SHORT_NAME, version: PLUGIN_VERSION,
    prefix: 'fretc', keys: [], tasks: TASKS,
    readmeUrl: README_URL, readmeLabel: 'GTTx-FindEntitiesByTextContent/README.md', injectStyle: injectStyle,
  });

  // ── Ticking ───────────────────────────────────────────────────────────────
  //
  // The settings page and the task button are decoration in a panel, not something that
  // has to land before the user can click it, so a timer plus the navigation hooks is
  // enough - there is no MutationObserver here and so nothing to subscribe to the shared
  // bus.
  function tick() {
    try { PAGE.decorate(PAGE.group()); } catch (e) { console.error('[fretc] settings tick failed', e); }
    try {
      C.paintTaskButtons(PLUGIN_NAME, TASKS, function () { return PLUGIN_BTN_VARIANT; });
    } catch (e) { console.error('[fretc] task paint failed', e); }
  }

  if (window.addEventListener) {
    window.addEventListener('load', function () { tick(); });
    window.addEventListener('popstate', function () { setTimeout(tick, 300); });
  }
  setInterval(tick, TICK_MS);
  tick();

  // The shared object is brought into its full shape at load even though this plugin
  // registers nothing in it: every sibling does so as a side effect of the entry it
  // *does* make, and a plugin that loads first and leaves `leases` undefined is one the
  // next plugin's `coop()` has to repair. One call, and the invariant holds whoever
  // loads first.
  coop();
  window.__GTTx__.fretc = {
    occurrences: occurrences,
    replaceAllIn: replaceAllIn,
    context: context,
    scanEntity: scanEntity,
    wordRuns: wordRuns,
    termCounts: termCounts,
    csvCell: csvCell,
    open: startRun,
    dialog: function () { return _active; },
  };
}());
