// Orphan Cleanup
//
// Requires Stash 0.31.0 or newer.
//
// Finds the tags, performers, studios and groups nothing uses - every count Stash keeps for them
// at 0 - and deletes the ones ticked, each delete recorded in ᝯㄝₓ Core's Undo History under this
// plugin's name. Stash's own lists sort by scene count one type at a time; this is the four at once.
//
// The rules - what counts as use, what is never listed - are in AGENTS.md next to this file, and
// the argument for them in NOTES.md.
(function () {
  'use strict';

  // ── The shared blocks, from ᝯㄝₓ Core ─────────────────────────────────────
  var C = (window.__GTTx__ || {}).core;
  // The Core floor, ᝯㄝₓ Core 5.26.0 or newer, told by the newest export it binds (`styleOnce`).
  // Below it nothing else in this file can run, and no shared code is left to say so.
  if (!C || typeof C.styleOnce !== 'function') {
    var NAME = 'ᝯㄝₓ Orphan Cleanup', NO_CORE = NAME + ' cannot start: it needs ᝯㄝₓ Core 5.26.0 or newer, installed and '
      + 'enabled. Install or update it from the same source and reload the page.';
    if (window.console && console.error) console.error('[oc] ' + NO_CORE);
    // Said where it shows, too: Stash still draws this plugin's task button from its .yml, and a
    // task pressed now is only queued, to fail in the server log. Plain DOM: no shared code is here.
    var mark = function () {
      // Only Settings draws these headings: on any other page a redraw costs no search here.
      if (!/^\/settings/.test(window.location.pathname)) return;
      var hs = document.querySelectorAll('.setting-group h3');
      for (var i = 0; i < hs.length; i++) {
        var h = hs[i], t = h.textContent;
        if ((t !== NAME && t.indexOf(NAME + ' (') !== 0) || (h.nextSibling && h.nextSibling.className === 'gttx-no-core')) continue;
        var line = document.createElement('div');
        line.className = 'gttx-no-core';
        line.style.cssText = 'color:#ff7b72;font-weight:600;margin:4px 0;white-space:normal';   // Core's Bad Result Text Color
        line.textContent = NO_CORE;
        h.parentNode.insertBefore(line, h.nextSibling);
      }
    };
    if (window.MutationObserver) new MutationObserver(mark).observe(document.documentElement, { childList: true, subtree: true });
    mark();
    return;
  }
  // Shared with every ᝯㄝₓ plugin, from Core.
  var trim = C.trim, truthy = C.truthy, button = C.button;
  var coop = C.coop, plural = C.plural, linkTarget = C.linkTarget, copyToClipboard = C.copyToClipboard,
    saveLogFile = C.saveLogFile, keepLog = C.keepLog, droppedLine = C.droppedLine, holdWidth = C.holdWidth,
    entityTip = C.entityTip, staleReloadButton = C.staleReloadButton, gqlRequest = C.gqlRequest, el = C.el,
    paintButton = C.paintButton, deleteRecorded = C.deleteRecorded, undoRun = C.undoRun, hasOwn = C.hasOwn;

  var PLUGIN_ID = 'OrphanCleanup';
  var PLUGIN_NAME = 'ᝯㄝₓ Orphan Cleanup';
  var PLUGIN_SHORT_NAME = 'ᝯㄝₓ Orphan Cleanup';
  // The one version that proves anything: the settings page reads the manifest, which can be
  // newer than the script the browser has cached.
  var PLUGIN_VERSION = '1.0.0';

  function oc(message) {
    if (typeof console !== 'undefined' && (console.info || console.log)) {
      (console.info || console.log).call(console, message);
    }
  }
  oc('[oc] OrphanCleanup.js ' + PLUGIN_VERSION + ' loaded. This is the running ' +
    'script\'s own version - the settings page reads the manifest instead, which can be ' +
    'newer than the script your browser has cached.');

  var README_URL = 'https://github.com/gregttx/GTTxStashPluginsRelease/blob/main/GTTx-OrphanCleanup/README.md';
  var STYLE_ID = 'oc-style';
  var PLUGIN_BTN_VARIANT = 'btn-warning';
  var LEASE_TTL_MS = 60000;
  var LEASE_CAP_MS = 3600000;   // how long a delete may keep renewing the lease
  var DELETE_CHUNK = 50;   // entities checked again and deleted per request
  var CONFIRM_MS = 4000;   // how long Delete... waits for its second press
  var TICK_MS = 1000;

  // ── What an orphan is ─────────────────────────────────────────────────────
  //
  // Every count is read directly (depth 0): an entity anything carries is used, and never listed.
  // What hangs under it - a child tag, a child studio, a sub-group - and what it hangs under are
  // the Exclusion Filters' to decide, with favorites, stash-box links, a tag and a custom field.
  // The server narrows on the scene count alone (`orphanQuery`); `keptBecause` decides, here, on
  // everything that came back. Several count criteria at once are no narrower in effect and far
  // slower: Stash took over five minutes on 1,799 tags with all eight, 0.7 s with one.
  var TYPES = [
    { key: 'tags', label: 'Tag', plural: 'Tags', find: 'findTags', list: 'tags', filterArg: 'tag_filter', route: '/tags/',
      sel: 'id name aliases favorite stash_ids { stash_id } scene_count scene_marker_count image_count gallery_count ' +
        'performer_count studio_count group_count child_count parents { id } custom_fields',
      counts: ['scene_count', 'scene_marker_count', 'image_count', 'gallery_count', 'performer_count', 'studio_count',
        'group_count'],
      kids: function (e) { return e.child_count; }, parent: function (e) { return (e.parents || []).length; },
      // Anywhere under the exclusion tag: its subtree as the scan read it, or a parent read now.
      tagged: function (e, x) {
        return hasOwn(x.under, String(e.id)) || (e.parents || []).some(function (p) { return hasOwn(x.tagIds, String(p.id)); });
      } },
    { key: 'performers', label: 'Performer', plural: 'Performers', find: 'findPerformers', list: 'performers',
      filterArg: 'performer_filter', route: '/performers/',
      sel: 'id name disambiguation favorite stash_ids { stash_id } scene_count image_count gallery_count group_count ' +
        'tags { id } custom_fields',
      counts: ['scene_count', 'image_count', 'gallery_count', 'group_count'] },
    { key: 'studios', label: 'Studio', plural: 'Studios', find: 'findStudios', list: 'studios', filterArg: 'studio_filter',
      route: '/studios/',
      sel: 'id name favorite stash_ids { stash_id } scene_count image_count gallery_count group_count child_studios { id } ' +
        'parent_studio { id } tags { id } custom_fields',
      counts: ['scene_count', 'image_count', 'gallery_count', 'group_count'],
      kids: function (e) { return (e.child_studios || []).length; }, parent: function (e) { return !!e.parent_studio; } },
    { key: 'groups', label: 'Group', plural: 'Groups', find: 'findGroups', list: 'groups', filterArg: 'group_filter',
      route: '/groups/',
      sel: 'id name scene_count sub_group_count containing_groups { group { id } } tags { id } custom_fields',
      counts: ['scene_count'],
      kids: function (e) { return e.sub_group_count; }, parent: function (e) { return (e.containing_groups || []).length; } },
  ];
  var TYPE_BY = {};
  TYPES.forEach(function (t) { TYPE_BY[t.key] = t; });

  // A tag whose name starts with ᝯㄝₓ's own mark is a plugin's, whatever the settings say.
  var OWNED_MARK = 'ᱜ╦╦🞮';

  // ── The settings: the Exclusion Filters ───────────────────────────────────
  //
  // Stored by the dialog alone (Core's `settingsDialog`), none in the .yml, and shown on Stash's
  // page from its first paint (`showDefaults`). The two names follow De-Spicer's pair.
  var DEFAULTS = {
    a1ExcludeFavorites: true,
    a2ExcludeStashBoxLinked: false,
    a3ExcludeWithTagName: 'ᱜ╦╦🞮✅DoNotCleanUp⚠∙',
    a4ExcludeWithCustomFieldName: 'ᱜ╦╦🞮_Do_Not_Clean_Up',
    a5ExcludeWithChildren: true,
    a6ExcludeWithParent: false,
  };
  function settingsOf(raw) {
    var s = {};
    for (var k in DEFAULTS) {
      if (!hasOwn(DEFAULTS, k)) continue;
      var has = !!raw && hasOwn(raw, k) && raw[k] != null;
      s[k] = typeof DEFAULTS[k] === 'boolean' ? (has ? truthy(raw[k]) : DEFAULTS[k]) : has ? trim(raw[k]) : DEFAULTS[k];
    }
    return s;
  }
  function loadSettings(fresh) {
    return C.pluginConfig(fresh).then(function (d) {
      var all = ((d || {}).configuration || {}).plugins || {};
      var s = settingsOf(all[PLUGIN_ID]);
      s.others = all;
      return s;
    });
  }
  C.showDefaults(PLUGIN_ID, function () {
    var out = {};
    for (var k in DEFAULTS) if (hasOwn(DEFAULTS, k)) out[k] = DEFAULTS[k];
    return out;
  });

  // The filters as `keptBecause` reads them: the settings, the exclusion tag (`tag`: `ids`, from its
  // name or an alias - none where no tag has it - and `under`, every tag below it) and the tags
  // the plugins work by (`owner`).
  function exclusionsOf(st, tag, owner) {
    st = st || settingsOf(null);
    tag = tag || {};
    return { favorites: st.a1ExcludeFavorites, stashBox: st.a2ExcludeStashBoxLinked, tag: st.a3ExcludeWithTagName,
      tagIds: tag.ids || {}, under: tag.under || {}, field: st.a4ExcludeWithCustomFieldName,
      children: st.a5ExcludeWithChildren, parent: st.a6ExcludeWithParent, owner: owner || null };
  }
  // By Stash's EQUALS, a LIKE: ASCII letters in any case, and `_` and `%` match any character.
  function resolveTag(name) {
    if (!name) return Promise.resolve({ ids: {}, under: {} });
    return gqlRequest('query OCExclusionTag($n: String!) { byName: findTags(tag_filter: { name: { value: $n, modifier: EQUALS } }) ' +
      '{ tags { id } } byAlias: findTags(tag_filter: { aliases: { value: $n, modifier: EQUALS } }) { tags { id } } }', { n: name })
      .then(function (d) {
        var ids = {};
        ((d.byName || {}).tags || []).concat((d.byAlias || {}).tags || []).forEach(function (t) { ids[String(t.id)] = true; });
        if (!Object.keys(ids).length) return { ids: ids, under: {} };
        return gqlRequest('query OCUnderExclusion($ids: [ID!]) { findTags(tag_filter: { parents: { value: $ids, ' +
          'modifier: INCLUDES, depth: -1 } }, filter: { per_page: -1 }) { tags { id } } }', { ids: Object.keys(ids) })
          .then(function (u) {
            var under = {};
            (((u || {}).findTags || {}).tags || []).forEach(function (t) { under[String(t.id)] = true; });
            return { ids: ids, under: under };
          });
      });
  }

  // Null where the entity is an orphan to list; else why not, in a few words.
  function keptBecause(type, e, x) {
    var t = TYPE_BY[type];
    x = x || exclusionsOf();
    for (var i = 0; i < t.counts.length; i++) {
      if (e[t.counts[i]]) return 'used';
    }
    if (x.children && t.kids && t.kids(e)) return 'with children';
    if (x.favorites && e.favorite) return 'a favorite';
    if (x.stashBox && (e.stash_ids || []).length) return 'linked to a stash-box';
    if (type === 'tags') {
      if (String(e.name || '').indexOf(OWNED_MARK) === 0) return 'a ᝯㄝₓ plugin\'s';
      if (x.owner && x.owner(e)) return 'a tag ' + x.owner(e) + ' works by';
      if (hasOwn(x.tagIds, String(e.id))) return 'the exclusion tag';
    }
    if (x.tag && (t.tagged ? t.tagged(e, x) : (e.tags || []).some(function (g) { return hasOwn(x.tagIds, String(g.id)); }))) {
      return type === 'tags' ? 'under the exclusion tag' : 'carrying the exclusion tag';
    }
    if (x.field && e.custom_fields && typeof e.custom_fields === 'object' && hasOwn(e.custom_fields, x.field)) {
      return 'marked via the exclusion custom field';
    }
    if (x.parent && t.parent && t.parent(e)) return 'with a parent';
    return null;
  }

  function orphanQuery(t, ids) {
    var crit = 'scene_count: { value: 0, modifier: EQUALS }';
    return t.key + ': ' + t.find + '(' + (ids ? 'ids: ' + JSON.stringify(ids.map(String)) + ', '
      : t.filterArg + ': { ' + crit + ' }, ') + 'filter: { per_page: -1, sort: "name", direction: ASC }) { ' +
      t.list + ' { ' + t.sel + ' } }';
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  var CSS =
    // The shared dialog chrome, identical to the siblings' (`.tests/style.test.js` pins it).
    '.oc-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);' +
    'z-index:1600;display:flex;align-items:center;justify-content:center;}' +
    '.oc-modal{background:var(--gttx-bg,#202b33);color:var(--gttx-fg,#f5f8fa);border:1px solid var(--gttx-border,#394b59);border-radius:4px;' +
    'width:min(100rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
    '.oc-head{padding:.75rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);}' +
    '.oc-title{font-size:1.1rem;font-weight:600;}' +
    '.oc-warn{color:var(--gttx-highlight,#ffc107);margin-top:.35rem;}' +
    '.oc-note{color:var(--gttx-muted,#a7b6c2);margin-top:.35rem;}' +
    '.oc-legend{color:var(--gttx-dim,#7d8f9c);margin-top:.35rem;font-size:.8rem;}' +
    '.oc-progress{padding:.5rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);color:var(--gttx-muted,#a7b6c2);' +
    'white-space:pre-wrap;}' +
    '.oc-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;font-family:monospace;font-size:.8rem;' +
    'line-height:1.35;min-height:14rem;}' +
    '.oc-line{white-space:pre-wrap;word-break:break-word;}' +
    '.oc-stale{margin:.5rem 0;padding:.6rem .75rem;border-left:4px solid #ff7373;' +
    'background:rgba(255,115,115,.14);color:#ff7373;font-size:.95rem;line-height:1.45;' +
    'font-weight:600;}' +
    '.oc-ERROR{color:#ff7373;} .oc-WARN{color:var(--gttx-highlight,#ffc107);} .oc-INFO{color:var(--gttx-muted,#a7b6c2);}' +
    '.oc-DELETE{color:var(--gttx-bad,#ff7b72);} .oc-UNDO{color:#84d68a;} .oc-SKIP{color:var(--gttx-muted,#a7b6c2);}' +
    '.oc-foot{padding:.75rem 1rem;border-top:1px solid var(--gttx-border,#394b59);display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.oc-foot button{margin-right:.5rem;}' +
    '.oc-hidden{display:none !important;}' +
    '.oc-modal.oc-tall{height:88vh;}' +
    '.oc-spacer{flex:1 1 auto;}' +
    '.gttx-tipbox{display:none;position:fixed;left:0;top:0;z-index:1700;' +
    'width:20rem;max-width:90vw;padding:.5rem .65rem;background:var(--gttx-bg,#202b33);color:var(--gttx-fg2,#d6dee4);' +
    'border:1px solid var(--gttx-border-strong,#425a6b);border-radius:3px;font-size:.8rem;line-height:1.45;' +
    'white-space:pre-wrap;pointer-events:none;text-align:left;font-family:inherit;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.gttx-tipbox.gttx-tip-open{display:block;}' +
    '.gttx-tipbox img{display:block;width:100%;max-height:14rem;object-fit:contain;' +
    'margin-bottom:.4rem;border-radius:3px;background:var(--gttx-sunken,#111a20);}' +
    // ── This dialog's own: one heading per type, one row per orphan ────────
    // A row flows as text with a hanging indent, laid out in whole pixels (the `style` suite).
    '.oc-modal .oc-log{line-height:18px;}' +
    '.oc-typehead{font-weight:600;margin:8px 0 2px;color:var(--gttx-fg2,#d6dee4);}' +
    '.oc-orphan{display:block;padding:1px 4px 1px 20px;text-indent:-16px;overflow-wrap:anywhere;cursor:pointer;margin:0;}' +
    '.oc-orphan:hover{background:var(--gttx-raised,#3c4f5d);}' +
    '.oc-filter{padding:.35rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);display:flex;gap:.75rem;' +
    'flex-wrap:wrap;align-items:center;font-size:.8rem;}' +
    '.oc-filter-label{color:var(--gttx-muted,#a7b6c2);}' +
    '.oc-filter-type{display:inline-flex;gap:.25rem;align-items:center;margin:0;cursor:pointer;}' +
    '.oc-orphan input{width:13px;height:13px;margin:0 3px 0 0;vertical-align:top;}' +
    '.oc-orphan>*{margin-right:8px;}' +
    '.oc-id{color:var(--gttx-dim,#7d8f9c);}' +
    '.oc-ent{text-decoration:none;}' +
    '.oc-ent:hover{text-decoration:underline;}' +
    // ── The settings page: the shared description rules ───────────────────
    '.oc-own-group .sub-heading{white-space:pre-wrap;}' +
    '.oc-own-group .sub-heading .oc-p{margin:0 0 .35em;}' +
    '.oc-own-group .sub-heading .oc-p:last-child{margin-bottom:0;}' +
    '.oc-desc-collapsed .oc-p:not(:first-child){display:none;}' +
    '.oc-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:var(--gttx-accent,#7cc4ff);font-size:.8rem;cursor:pointer;' +
    'text-decoration:underline;}';

  function injectStyle() { C.styleOnce(STYLE_ID, CSS); }

  // ── The task ──────────────────────────────────────────────────────────────
  //
  // Handled here, never by the server: a capture-phase click on our own task button opens the
  // dialog and stops Stash queueing a job that has no `exec` behind it.
  var TASK_NAME = 'Find Orphans...';
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
  function startRun() {
    if (_active) return;
    _active = new Run();
    _active.begin();
  }

  function Run() {
    this.found = [];          // { type, e, box, row } per orphan listed, in list order
    this.runs = [];           // Undo History runs this dialog's deletes recorded, oldest first
    this.logText = [];
    this.logDropped = 0;
    this.state = 'idle';      // 'scanning', 'listing', 'deleting', 'undoing'
    this.stopping = false;
    this.stale = false;
    this.alive = true;
    this.off = {};            // the types the Show strip hides, kept across a Rescan
    this.heads = {};          // each type's heading in the list
    this.build();
  }

  Run.prototype.build = function () {
    injectStyle();
    var self = this;
    this.backdrop = el('div', 'oc-backdrop');
    this.modal = el('div', 'oc-modal oc-tall');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'oc-head');
    head.appendChild(el('div', 'oc-title', PLUGIN_NAME));
    this.staleEl = el('div', 'oc-stale oc-hidden', '');
    head.appendChild(this.staleEl);
    head.appendChild(el('div', 'oc-warn', 'Backing up your database before proceeding is strongly recommended. ' +
      'A delete is recorded in ᝯㄝₓ Core\'s Undo History, which makes it again under a new id - not everything can be ' +
      'undone there.'));
    head.appendChild(el('div', 'oc-legend', 'Tags, performers, studios and groups nothing uses: no scene, marker, image, ' +
      'gallery, performer, studio or group carries them. A tag a ᝯㄝₓ plugin works by is never listed; what else is left ' +
      'out - favorites, stash-box links, a tag, a custom field, children, a parent - is set in Exclusion Filters on this ' +
      'plugin\'s settings. Nothing is ticked: tick what to delete.'));
    this.modal.appendChild(head);

    this.progressEl = el('div', 'oc-progress', 'Looking for orphans...');
    this.modal.appendChild(this.progressEl);
    this.filterEl = el('div', 'oc-filter oc-hidden');
    this.modal.appendChild(this.filterEl);
    this.listEl = el('div', 'oc-log');
    this.modal.appendChild(this.listEl);

    var foot = el('div', 'oc-foot');
    this.deleteBtn = button('Delete...', 'oc-delete');
    paintButton(this.deleteBtn, PLUGIN_BTN_VARIANT);
    this.undoBtn = button('Undo', 'oc-undo oc-hidden');
    paintButton(this.undoBtn, PLUGIN_BTN_VARIANT);
    this.undoBtn.title = 'Make again everything this dialog deleted, newest first, from Undo History - each under a new id. ' +
      'The undo is recorded there too.';
    this.stopBtn = button('Stop', 'oc-stop oc-hidden');
    this.stopBtn.title = 'Stop after the batch in flight. What is deleted so far stays deleted, and Undo still reaches it.';
    this.copyBtn = button('Copy log', 'oc-copy');
    this.copyBtn.title = 'Copy the counters, the list and every message as plain text.';
    this.saveLogBtn = button('Save log', 'oc-savelog');
    this.saveLogBtn.title = 'Download what Copy log copies as a text file named by the date and time: a long log ' +
      'may be too large to paste, and a file can be kept with the backup.';
    this.rescanBtn = button('Rescan', 'oc-rescan');
    this.rescanBtn.title = 'Look for orphans again, as the library is now. Undo for what this dialog deleted is kept.';
    this.closeBtn = button('Close', 'oc-close');
    this.closeBtn.title = 'Close the dialog. Undo History keeps what was deleted.';
    this.unselAllBtn = button('Unselect All', 'oc-unselall');
    this.unselAllBtn.title = 'Untick every orphan shown.';
    this.selAllBtn = button('Select All', 'oc-selall');
    this.selAllBtn.title = 'Tick every orphan shown - a type the Show strip hides is left alone. Nothing is deleted ' +
      'until Delete... is pressed twice.';

    this.deleteBtn.addEventListener('click', function () { self.pressDelete(); });
    this.undoBtn.addEventListener('click', function () { self.undo(); });
    this.stopBtn.addEventListener('click', function () {
      if (self.state !== 'deleting' || self.stopping) return;
      self.stopping = true;
      self.msg('INFO', 'Stopping after the batch in flight.');
      self.sync();
    });
    this.copyBtn.addEventListener('click', function () { self.copyLog(); });
    this.saveLogBtn.addEventListener('click', function () { saveLogFile('orphan-cleanup', self.logLines()); });
    this.rescanBtn.addEventListener('click', function () { self.scan(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });
    this.unselAllBtn.addEventListener('click', function () { self.tickAll(false); });
    this.selAllBtn.addEventListener('click', function () { self.tickAll(true); });
    [this.deleteBtn, this.undoBtn, this.stopBtn, this.copyBtn, this.saveLogBtn, this.rescanBtn, this.closeBtn]
      .forEach(function (b) { foot.appendChild(b); });
    foot.appendChild(el('div', 'oc-spacer'));
    foot.appendChild(this.unselAllBtn);
    foot.appendChild(this.selAllBtn);
    this.modal.appendChild(foot);

    C.wireEscape(this, 'oc');
    document.body.appendChild(this.backdrop);
  };

  Run.prototype.show = function (node, visible) {
    node.className = node.className.replace(/\s*oc-hidden/g, '') + (visible ? '' : ' oc-hidden');
  };

  Run.prototype.begin = function () {
    this.checkVersion();
    this.scan();
  };

  Run.prototype.checkVersion = function () {
    var self = this;
    C.installedVersion(PLUGIN_ID, 'OCPluginVersion').then(function (installed) {
      if (!installed || installed === PLUGIN_VERSION || !self.alive) return;
      self.stale = true;
      var msg = '⚠ This page is running ' + PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION +
        ', but Stash has ' + installed + ' installed. Reload the page (F5); if this warning ' +
        'comes back, hard-refresh with Ctrl+Shift+R (⌘+Shift+R on a Mac).';
      self.staleEl.textContent = msg;
      staleReloadButton(self.staleEl);
      self.show(self.staleEl, true);
      self.msg('WARN', msg);
      self.sync();
    });
  };

  // The orphans of every type, read at once: one query naming the four.
  Run.prototype.scan = function () {
    if (this.state === 'deleting' || this.state === 'undoing' || this.state === 'scanning') return;
    var self = this;
    this.disarm();
    this.state = 'scanning';
    this.found = [];
    this.clearList();
    this.drawFilter();
    this.progressEl.textContent = 'Looking for orphans...';
    this.sync();
    // Unreadable, the settings and the tags the plugins work by are unknown, and nothing is listed.
    loadSettings(true).then(function (st) {
      self.describeField(st.a4ExcludeWithCustomFieldName);
      return Promise.all([
        gqlRequest('query OCOrphans { ' + TYPES.map(function (t) { return orphanQuery(t); }).join(' ') + ' }', null),
        resolveTag(st.a3ExcludeWithTagName),
      ]).then(function (both) {
        // The default names a tag a library may not have made yet: only a name typed in is warned of.
        var name = st.a3ExcludeWithTagName;
        if (!name || name === DEFAULTS.a3ExcludeWithTagName || Object.keys(both[1].ids).length) return both;
        self.msg('WARN', 'No tag has the name or alias "' + st.a3ExcludeWithTagName + '" the Exclusion Filters name, so it ' +
          'leaves nothing out.');
        return both;
      }).then(function (both) { return [both[0], exclusionsOf(st, both[1], C.ownedTags(st.others))]; });
    }).then(function (both) {
      if (!self.alive) return;
      self.excl = both[1];
      var kept = {}, keptN = 0;
      TYPES.forEach(function (t) {
        var rows = (((both[0] || {})[t.key] || {})[t.list]) || [];
        var mine = rows.filter(function (e) {
          var why = keptBecause(t.key, e, self.excl);
          if (why && why !== 'used') { kept[why] = (kept[why] || 0) + 1; keptN++; }
          return !why;
        });
        if (!mine.length) return;
        self.heads[t.key] = self.listEl.appendChild(el('div', 'oc-typehead', t.plural + ' (' + mine.length + ')'));
        mine.forEach(function (e) { self.addRow(t, e); });
      });
      self.drawFilter();
      var why = Object.keys(kept).map(function (k) { return kept[k] + ' ' + k; }).join(', ');
      self.state = 'listing';
      self.progressEl.textContent = self.found.length
        ? plural(self.found.length, 'orphan') + ' found' + (keptN ? '; ' + keptN + ' more left out (' + why + ')' : '') +
          '. Tick what to delete.'
        : 'No orphans' + (keptN ? ': ' + keptN + ' unused left out (' + why + ')' : '') + '. Nothing to delete.';
      self.sync();
    }, function (e) {
      if (!self.alive) return;
      self.state = 'listing';
      self.progressEl.textContent = 'The orphans could not be read.';
      self.msg('ERROR', 'Reading the orphans failed: ' + (e && e.message ? e.message : String(e)));
      self.sync();
    });
  };

  // The exclusion custom field described in Custom Fields Bulk Editor's description store, as
  // De-Spicer's are: a sentence, so a failure says nothing.
  var CFBE_ID = 'CustomFieldsBulkEditor', CFBE_NAME = 'ᝯㄝₓ Custom Fields Bulk Editor';
  var FIELD_DESCRIPTION = 'Set to anything, keeps ' + PLUGIN_NAME + ' from listing this entity as an orphan, so it is ' +
    'never deleted as one.\n\nRead by ' + PLUGIN_NAME + ', never written by it.';
  Run.prototype.describeField = function (name) {
    var self = this, api = (coop().api || {})[CFBE_ID];
    if (!name || !api || typeof api.describeField !== 'function') return;
    api.describeField(name, FIELD_DESCRIPTION).then(function (outcome) {
      if (outcome === 'added') self.msg('INFO', 'Described the custom field "' + name + '" in ' + CFBE_NAME + '\'s description store.');
      else if (outcome === 'queued') {
        self.msg('INFO', 'A description of the custom field "' + name + '" is waiting for ' + CFBE_NAME + '\'s description ' +
          'store: open its "Manage Custom Field Descriptions and Locks..." and press Apply to file it.');
      }
    }, function () {});
  };

  // Show: a switch per type the list holds. A type switched off is hidden, and Select All, the
  // count and Delete leave it alone; its ticks wait for it to be shown again.
  Run.prototype.drawFilter = function () {
    var self = this, bar = this.filterEl;
    while (bar.firstChild) bar.removeChild(bar.firstChild);
    var types = TYPES.filter(function (t) { return self.found.some(function (f) { return f.type === t.key; }); });
    this.show(bar, types.length > 0);
    if (!types.length) return;
    bar.appendChild(el('span', 'oc-filter-label', 'Show:'));
    types.forEach(function (t) {
      var n = self.found.filter(function (f) { return f.type === t.key; }).length;
      var box = el('input');
      box.type = 'checkbox';
      box.checked = !self.off[t.key];
      box.addEventListener('change', function () {
        if (box.checked) delete self.off[t.key]; else self.off[t.key] = true;
        self.applyFilter();
      });
      var label = el('label', 'oc-filter-type oc-filter-' + t.key);
      label.title = 'Untick to hide the ' + t.label.toLowerCase() + ' orphans: Select All, the count on Delete and ' +
        'Delete itself then leave them alone, ticked or not, until they are shown again.';
      label.appendChild(box);
      label.appendChild(el('span', null, t.plural + ' (' + n + ')'));
      bar.appendChild(label);
    });
    this.applyFilter();
  };

  Run.prototype.shown = function (f) { return !this.off[f.type]; };

  Run.prototype.applyFilter = function () {
    var self = this;
    TYPES.forEach(function (t) { if (self.heads[t.key]) self.heads[t.key].style.display = self.off[t.key] ? 'none' : ''; });
    this.found.forEach(function (f) { f.row.style.display = self.shown(f) ? '' : 'none'; });
    this.sync();
  };

  Run.prototype.clearList = function () {
    this.heads = {};
    while (this.listEl.firstChild) this.listEl.removeChild(this.listEl.firstChild);
  };

  Run.prototype.addRow = function (t, e) {
    var self = this;
    var row = el('label', 'oc-orphan');
    row.title = 'Tick to delete this ' + t.label.toLowerCase() + ' with Delete...; it is checked again first.';
    var box = el('input');
    box.type = 'checkbox';
    box.checked = false;
    box.addEventListener('change', function () { self.sync(); });
    row.appendChild(box);
    var a = el('a', 'oc-ent', e.name + (e.disambiguation ? ' (' + e.disambiguation + ')' : ''));
    a.href = t.route + e.id;
    a.target = linkTarget();
    a.rel = 'noopener noreferrer';
    entityTip(a, t.key, String(e.id));
    row.appendChild(a);
    row.appendChild(el('span', 'oc-id', '[' + e.id + ']'));
    this.listEl.appendChild(row);
    this.found.push({ type: t.key, e: e, box: box, row: row });
  };

  Run.prototype.ticked = function () {
    var self = this;
    return this.found.filter(function (f) { return f.box.checked && !f.gone && self.shown(f); });
  };

  // Every orphan shown.
  Run.prototype.tickAll = function (on) {
    if (this.state !== 'listing') return;
    var self = this;
    this.found.forEach(function (f) { if (!f.gone && self.shown(f)) f.box.checked = on; });
    this.sync();
  };

  // One place for the footer: what each control may do now, and why not.
  Run.prototype.sync = function () {
    var busy = this.state === 'scanning' || this.state === 'deleting' || this.state === 'undoing';
    var self = this, n = this.ticked().length;
    var open = this.found.filter(function (f) { return !f.gone && self.shown(f); }).length;
    var why = this.stale ? 'This page is running an older script than Stash has installed. Reload first.'
      : busy ? 'Not while the dialog is working.'
        : !n ? 'Tick what to delete first.' : '';
    this.deleteBtn.disabled = !!why;
    if (!this.confirming) {
      this.deleteBtn.textContent = n ? 'Delete ' + n + '...' : 'Delete...';
      this.deleteBtn.title = why || 'Delete the ' + plural(n, 'orphan') + ' ticked. Asks for a second press; each is ' +
        'checked again first, and one that is used by then is left alone.';
    }
    this.show(this.stopBtn, this.state === 'deleting');
    this.stopBtn.disabled = this.stopping;
    this.show(this.undoBtn, this.runs.length > 0);
    this.undoBtn.disabled = busy;
    this.rescanBtn.disabled = busy;
    this.rescanBtn.title = busy ? 'Not while the dialog is working.'
      : 'Look for orphans again, as the library is now. Undo for what this dialog deleted is kept.';
    // A scan can always be left; a delete or an undo cannot be walked away from halfway.
    this.closeBtn.disabled = this.state === 'deleting' || this.state === 'undoing';
    paintButton(this.closeBtn, !busy && !n && !this.stale ? 'btn-success' : 'btn-secondary');
    this.found.forEach(function (f) { f.box.disabled = busy || !!f.gone; });
    this.selAllBtn.disabled = busy || this.found.every(function (f) { return f.gone || f.box.checked || !self.shown(f); });
    this.unselAllBtn.disabled = busy || !n;
    if (!this.found.length) this.selAllBtn.disabled = true;
    this.show(this.selAllBtn, open > 0);
    var boxes = this.filterEl.getElementsByTagName ? this.filterEl.getElementsByTagName('input') : [];
    for (var i = 0; i < boxes.length; i++) boxes[i].disabled = busy;
    this.show(this.unselAllBtn, open > 0);
  };

  // Two presses: the first asks, the second deletes, within `CONFIRM_MS`.
  Run.prototype.pressDelete = function () {
    if (this.deleteBtn.disabled) return;
    var self = this;
    if (!this.confirming) {
      this.confirming = true;
      holdWidth(this.deleteBtn);
      this.deleteBtn.textContent = 'Press again to delete';
      this.confirmTimer = setTimeout(function () { self.confirming = false; self.sync(); }, CONFIRM_MS);
      return;
    }
    this.disarm();
    this.deleteTicked();
  };

  // A first press counts for the list it was made on: a scan, an undo or a delete takes it back.
  Run.prototype.disarm = function () {
    clearTimeout(this.confirmTimer);
    this.confirming = false;
  };

  // Per type, a chunk at a time: checked again as it is now, then deleted through Core, which
  // reads each entity whole before it goes and records the delete under this plugin's name.
  Run.prototype.deleteTicked = function () {
    var self = this, all = this.ticked();
    this.disarm();
    this.state = 'deleting';
    this.stopping = false;
    this.sync();
    var lease = C.lease(PLUGIN_ID, 'Orphan Cleanup', LEASE_TTL_MS);
    // Renewed on a clock, not per batch: Core reads each entity whole before a batch goes, which
    // on a slow server can outlast the lease. Not past an hour: a request that never comes back
    // must not keep every sibling standing down for the page's life.
    var since = Date.now();
    var renewing = setInterval(function () { if (Date.now() - since < LEASE_CAP_MS) lease.renew(); else clearInterval(renewing); }, LEASE_TTL_MS / 3);
    var done = 0, left = 0, failed = 0, unrecorded = 0;
    this.msg('INFO', 'Deleting ' + plural(all.length, 'orphan') + '.');
    var chunks = [];
    TYPES.forEach(function (t) {
      var mine = all.filter(function (f) { return f.type === t.key; });
      for (var i = 0; i < mine.length; i += DELETE_CHUNK) chunks.push({ t: t, list: mine.slice(i, i + DELETE_CHUNK) });
    });
    var at = 0;
    function next() {
      if (at >= chunks.length || self.stopping) {
        clearInterval(renewing);
        lease.release();
        var notReached = chunks.slice(at).reduce(function (n, c) { return n + c.list.length; }, 0);
        self.state = 'listing';
        self.stopping = false;
        self.msg('INFO', 'Delete ' + (notReached ? 'stopped: ' : 'finished: ') + plural(done, 'orphan') + ' deleted' +
          (left ? ', ' + left + ' left alone as used by now' : '') + (notReached ? ', ' + notReached + ' not reached' : '') +
          (failed ? ', ' + plural(failed, 'failure') : '') + (unrecorded ? ', ' + unrecorded + ' not recorded in Undo History' : '') + '.');
        self.progressEl.textContent = plural(done, 'orphan') + ' deleted. ' + (self.runs.length
          ? 'Undo makes them again from Undo History, as the ↶ button in Stash\'s top bar does.' : '');
        self.sync();
        return;
      }
      lease.renew();
      var c = chunks[at++];
      // Against the filters the list was drawn by: the settings saved since are the next Rescan's.
      gqlRequest('query OCRecheck { ' + orphanQuery(c.t, c.list.map(function (f) { return f.e.id; })) + ' }', null)
        .then(function (res) {
          var now = {};
          ((((res || {})[c.t.key] || {})[c.t.list]) || []).forEach(function (e) { now[String(e.id)] = e; });
          var go = c.list.filter(function (f) {
            var e = now[String(f.e.id)];
            var why = e ? keptBecause(c.t.key, e, self.excl) : 'gone already';
            if (why) {
              left++;
              self.msg('SKIP', c.t.label + ' "' + f.e.name + '" [' + f.e.id + ']: left alone - ' + (why === 'used' ? 'used by now' : why) + '.');
            }
            return !why;
          });
          if (!go.length) return null;
          var d = deleteRecorded(c.t.key, go.map(function (f) { return f.e.id; }),
            { plugin: PLUGIN_SHORT_NAME, label: c.t.plural + ' deleted as orphans' });
          return d.sent.then(function () {
            go.forEach(function (f) {
              done++;
              f.gone = true;
              f.box.checked = false;
              f.row.style.textDecoration = 'line-through';
              self.msg('DELETE', c.t.label + ' "' + f.e.name + '" [' + f.e.id + ']');
            });
            self.sync();
            // What the history could not read first is a gap in it, said here as Undo History says it.
            return d.recorded.then(function (run) {
              if (!run) {
                unrecorded += go.length;
                self.msg('WARN', plural(go.length, c.t.label.toLowerCase(), c.t.plural.toLowerCase()) +
                  ' deleted but not recorded in Undo History, so Undo cannot make ' + (go.length === 1 ? 'it' : 'them') + ' again.');
                return null;
              }
              self.runs.push(run);
              return coop().journal.runs().then(function (runs) {
                var head = runs.filter(function (r) { return r.id === run; })[0];
                if (head && head.note) self.msg('WARN', 'Undo History: ' + head.note + '.');
              }, function () {});
            });
          }, function (e) {
            failed += go.length;
            self.msg('ERROR', plural(go.length, c.t.label.toLowerCase(), c.t.plural.toLowerCase()) + ' could not be deleted: ' +
              (e && e.message ? e.message : String(e)));
          });
        }, function (e) {
          failed += c.list.length;
          self.msg('ERROR', 'Checking a batch again failed, so none of it was deleted: ' + (e && e.message ? e.message : String(e)));
        })
        // A slip in the handlers above is said and the loop goes on, so the dialog never sticks.
        .then(next, function (e) {
          self.msg('ERROR', 'A batch went wrong after its delete: ' + (e && e.message ? e.message : String(e)));
          next();
        });
    }
    next();
  };

  // Every run this dialog recorded, newest first, through Undo History's own undo.
  Run.prototype.undo = function () {
    if (this.undoBtn.disabled || !this.runs.length) return;
    var self = this, runs = this.runs.slice().reverse();
    this.runs = [];
    this.disarm();
    this.state = 'undoing';
    this.sync();
    this.msg('INFO', 'Undoing ' + plural(runs.length, 'delete') + ' from Undo History.');
    var made = 0, failed = 0;
    runs.reduce(function (p, id) {
      return p.then(function () {
        return undoRun(id, function (kind, text, w) {
          self.msg(kind, TYPE_BY[w.type] ? TYPE_BY[w.type].label + ' "' + (w.name || '') + '" [' + w.id + ']: ' + text : text);
        }).then(function (res) {
          made += (res && res.written) || 0;
          failed += (res && res.failed) || 0;
          // Part of it failed: kept, so Undo here tries again what is not undone yet.
          if (res && res.failed) self.runs.unshift(id);
        }, function (e) {
          failed++;
          self.runs.unshift(id);
          self.msg('ERROR', 'An undo failed: ' + (e && e.message ? e.message : String(e)));
        });
      });
    }, Promise.resolve()).then(function () {
      self.state = 'listing';
      self.msg('INFO', 'Undo finished: ' + plural(made, 'entity', 'entities') + ' made again' +
        (failed ? ', ' + plural(failed, 'failure') : '') + '. Rescan to list what is an orphan now.');
      self.progressEl.textContent = 'Undone: ' + plural(made, 'entity', 'entities') + ' made again, each under a new id.';
      self.sync();
    });
  };

  Run.prototype.msg = function (kind, message) {
    var line = el('div', 'oc-line oc-' + kind);
    line.textContent = '[' + kind + '] ' + message;
    this.listEl.appendChild(line);
    this.logText.push('[' + kind + '] ' + message);
    this.logDropped += keepLog(this.logText);
    if (this.listEl.scrollTop != null) this.listEl.scrollTop = this.listEl.scrollHeight;
    return line;
  };

  Run.prototype.logLines = function () {
    var lines = [this.progressEl.textContent, ''];
    var self = this;
    TYPES.forEach(function (t) {
      self.found.filter(function (f) { return f.type === t.key; }).forEach(function (f) {
        lines.push((f.gone ? '[deleted] ' : f.box.checked ? '[x] ' : '[ ] ') + t.label + ' "' + f.e.name + '" [' + f.e.id + ']');
      });
    });
    lines.push('');
    if (this.logDropped) lines.push(droppedLine(this.logDropped));
    this.logText.forEach(function (l) { lines.push(l); });
    return lines.join('\n');
  };

  Run.prototype.copyLog = function () {
    var self = this, was = this.copyBtn.textContent;
    copyToClipboard(this.logLines(), function (ok) {
      holdWidth(self.copyBtn);
      self.copyBtn.textContent = ok ? 'Copied' : 'Failed';
      setTimeout(function () { self.copyBtn.textContent = was; }, 2000);
    });
  };

  Run.prototype.close = function () {
    if (this.closeBtn.disabled) return;
    this.alive = false;
    clearTimeout(this.confirmTimer);
    C.unwireEscape(this);
    if (this.backdrop && this.backdrop.parentNode) this.backdrop.parentNode.removeChild(this.backdrop);
    _active = null;
  };

  // ── The settings page ─────────────────────────────────────────────────────
  //
  // The siblings' description treatment and stale-script banner from Core's `settingsPage`, and
  // one row of its own opening the Exclusion Filters (Core's `settingsDialog`).
  var PAGE = C.settingsPage({
    id: PLUGIN_ID, name: PLUGIN_NAME, shortName: PLUGIN_SHORT_NAME, version: PLUGIN_VERSION,
    prefix: 'oc', keys: [], tasks: TASKS,
    readmeUrl: README_URL, readmeLabel: 'GTTx-OrphanCleanup/README.md', injectStyle: injectStyle,
  });

  var EXCLUSION_FIELDS = [
    { key: 'a1ExcludeFavorites', label: 'Leave Out Favorites', warn: 'semi',
      tip: 'A favorite tag, performer or studio is never listed. Groups have no favorite.' },
    { key: 'a2ExcludeStashBoxLinked', label: 'Leave Out Anything Linked to a Stash-Box', warn: 'semi',
      tip: 'A tag, performer or studio holding a stash-id - linked to StashDB or another stash-box - is never listed.' },
    { key: 'a3ExcludeWithTagName', label: 'Leave Out Entities Carrying This Tag', warn: 'semi', text: true, wide: true, tag: true,
      mark: function (v) { return C.tagMark(v); },
      tip: 'A performer, studio or group carrying this tag is never listed, nor any tag below it, however far. ' +
        'Matched by the tag\'s name or an alias as Stash\'s own filters match a name, where _ and % match any character. The tag itself is never listed either. 🔗 beside the box opens the tag; ' +
        'a red ? says no tag has that name or alias, so it leaves nothing out. Empty, this filter is off.' },
    { key: 'a4ExcludeWithCustomFieldName', label: 'Leave Out Entities Marked via This Custom Field', warn: 'semi', text: true, wide: true,
      cf: true, mark: function (v) { return v ? C.cfTipMark(v) : null; },
      tip: 'A tag, performer, studio or group holding this custom field is never listed. Only the presence of the ' +
        'field matters - any value at all, even an empty one. Empty, this filter is off.' },
    { key: 'a5ExcludeWithChildren', label: 'Leave Out Anything With Children', warn: 'semi',
      tip: 'A tag with child tags, a studio with child studios, or a group with sub-groups is never listed. Off: ' +
        'one is listed when nothing else uses it, and deleting it leaves its children without that parent - Undo ' +
        'puts them back under it.' },
    { key: 'a6ExcludeWithParent', label: 'Leave Out Anything With a Parent', warn: 'semi',
      tip: 'A tag with a parent tag, a studio with a parent studio, or a group inside another group is never listed.' },
  ];
  function exclusionSummary(st) {
    var tag = trim(st.a3ExcludeWithTagName), field = trim(st.a4ExcludeWithCustomFieldName), parts = ['Leaving out: '], n = 0;
    function add(p) { parts = parts.concat(n++ ? ['; '] : [], p); }
    if (st.a1ExcludeFavorites) add(['favorites']);
    if (st.a2ExcludeStashBoxLinked) add(['stash-box links']);
    if (tag) add(['tagged ', { text: '"' + tag + '"', hl: 'semi', tag: true, mark: function () { return C.tagMark(tag); } }]);
    if (field) add(['holding ', { cf: field, hl: 'semi' }]);
    if (st.a5ExcludeWithChildren) add(['anything with children']);
    if (st.a6ExcludeWithParent) add(['anything with a parent']);
    return n ? parts.concat('.') : 'Nothing is left out but the tags ᝯㄝₓ plugins work by.';
  }
  var _stored = null;
  function storedSettings() {
    if (!_stored) _stored = settingsOf(null);
    loadSettings(false).then(function (st) { _stored = st; }, function () {});
    return _stored;
  }
  var EXCLUSIONS = C.settingsDialog({
    id: PLUGIN_ID, shortName: PLUGIN_SHORT_NAME, prefix: 'oc', key: 'exclusions', title: 'Exclusion Filters',
    line: 'What is never listed as an orphan: favorites, anything linked to a stash-box, a tag, a custom field, ' +
      'anything with children, anything with a parent. Six settings, in a dialog.',
    fields: EXCLUSION_FIELDS, summary: exclusionSummary, settings: storedSettings,
    load: function () { return loadSettings(true); },
    saved: function (patch) { var c = storedSettings(); for (var k in patch) if (hasOwn(patch, k)) c[k] = patch[k]; },
  });

  function tick() {
    try {
      var group = PAGE.group();
      PAGE.decorate(group);
      if (group) EXCLUSIONS.tick(group);
    } catch (e) { console.error('[oc] settings tick failed', e); }
    try {
      C.paintTaskButtons(PLUGIN_NAME, TASKS, function () { return PLUGIN_BTN_VARIANT; });
    } catch (e) { console.error('[oc] task paint failed', e); }
  }

  if (window.addEventListener) {
    window.addEventListener('load', function () { tick(); });
    window.addEventListener('popstate', function () { setTimeout(tick, 300); });
  }
  setInterval(tick, TICK_MS);
  tick();

  coop();
  window.__GTTx__.oc = {
    keptBecause: keptBecause,
    exclusionsOf: exclusionsOf,
    open: startRun,
    dialog: function () { return _active; },
  };
}());
