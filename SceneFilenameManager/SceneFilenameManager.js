// Scene Filename Manager
//
// Requires Stash 0.31.0 or newer: a scene's `custom_fields` is where the original
// filename is kept.
//
// A file's name is metadata nothing else in Stash remembers: rename the file - by hand,
// by a renamer plugin, by a scraper-driven tidy-up - and the old name is gone. This
// plugin keeps a copy of it in one custom field per scene, and puts it back on request.
//
// Two Settings → Tasks entries, one dialog:
//
//   - **Archive** writes the primary file's name, without its extension, into the field
//     on every scene that does not carry the field yet. It never overwrites: a scene that
//     has the field is left alone whatever it says, and deleting the field by hand is how
//     a scene is re-archived under its current name.
//   - **Restore** renames the primary file back to the archived name, keeping the file's
//     current extension, on every scene whose file is named differently now.
//
// Both list every scene they would touch before anything is written, and Undo reverses
// what the dialog wrote while it stays open. The design notes are in CLAUDE.md and
// NOTES.md next to this file.
(function () {
  'use strict';

  // ── The shared blocks, from ᝯㄝₓ Core ─────────────────────────────────────
  //
  // `ui: requires:` in the .yml is topologically sorted by Stash and `useScript` sets
  // `async = false`, so Core has finished running before this line - when it is present.
  var C = (window.__GTTx__ || {}).core;
  if (!C) {
    if (window.console && console.error) {
      console.error('[sfm] ᝯㄝₓ Core is not installed or is disabled, so '
        + 'this plugin cannot start. Install it from the same source and reload the page.');
    }
    return;
  }
  var coop = C.coop, plural = C.plural, el = C.el, hasClass = C.hasClass, hasOwn = C.hasOwn,
    byClass = C.byClass, gqlRequest = C.gqlRequest, coreSettingElement = C.settingElement,
    coreSettingRow = C.settingRow, linkTarget = C.linkTarget, entityTip = C.entityTip,
    copyToClipboard = C.copyToClipboard, holdWidth = C.holdWidth, cfTipTick = C.cfTipTick,
    fieldLocks = C.fieldLocks,
    ensureReloadUiButton = C.ensureReloadUiButton, staleReloadButton = C.staleReloadButton;

  var PLUGIN_ID = 'SceneFilenameManager';
  // Byte-identical to the `.yml`: `headingIsOurs` and `ownTaskName` find this plugin's
  // settings group and task buttons by it.
  var PLUGIN_NAME = 'ᝯㄝₓ Scene Filename Manager';
  var PLUGIN_SHORT_NAME = PLUGIN_NAME;
  // The one version that proves which code is running; the settings page reads the
  // manifest, which can be newer than the script this browser cached.
  var PLUGIN_VERSION = '0.1.0';

  function sfm(message) {
    if (typeof console !== 'undefined' && (console.info || console.log)) {
      (console.info || console.log).call(console, message);
    }
  }

  sfm('[sfm] SceneFilenameManager.js ' + PLUGIN_VERSION + ' loaded. This is the running ' +
    'script\'s own version - the settings page reads the manifest instead, which can be ' +
    'newer than the script your browser has cached.');

  var README_URL = 'https://github.com/gregttx/GTTxStashPluginsRelease/blob/main/SceneFilenameManager/README.md';
  var STYLE_ID = 'sfm-style';
  var README_LINK_ID = 'sfm-readme-link';
  var DESC_TOGGLE_ID = 'sfm-desc-toggle';
  var STALE_ID = 'sfm-stale-notice';

  // Amber: both tasks write.
  var PLUGIN_BTN_VARIANT = 'btn-warning';

  var READ_PAGE = 500;          // scenes per page of the scan
  var LOG_RENDER_CAP = 1000;    // log lines kept in the DOM; `logText` keeps them all
  var SETTINGS_TTL_MS = 10000;
  var LEASE_TTL_MS = 60000;

  // The field's name when the setting is empty. Written into the setting the first time
  // the plugin loads (`seedDefaults`), because Stash has no default for a plugin
  // setting and an empty box would not say which field to look for.
  var FIELD_DEFAULT = 'ᱜ╦╦🞮_Original_Filename';

  function trim(text) {
    return String(text == null ? '' : text).replace(/^\s+|\s+$/g, '');
  }

  // ── Filenames ─────────────────────────────────────────────────────────────
  //
  // The extension is whatever follows the last dot. A leading dot is part of the name
  // (`.hidden` has no extension), and a name with no dot has none.
  function stemOf(basename) {
    var b = String(basename || ''), i = b.lastIndexOf('.');
    return i > 0 ? b.slice(0, i) : b;
  }

  function extOf(basename) {
    var b = String(basename || ''), i = b.lastIndexOf('.');
    return i > 0 ? b.slice(i) : '';
  }

  // What an archived value may not be renamed to: nothing at all, a path, or the two
  // names a folder reserves. The field is the user's to edit, so this is a trust boundary.
  function badStem(v) {
    if (!trim(v)) return 'it is empty';
    if (/[\/\\]/.test(v)) return 'it contains a path separator';
    if (v === '.' || v === '..') return 'it names a folder';
    return null;
  }

  function primaryFile(scene) {
    return (scene && scene.files && scene.files[0]) || null;
  }

  function sceneName(scene) {
    var f = primaryFile(scene);
    return trim(scene.title) || (f && f.basename) || 'Scene ' + scene.id;
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  //
  // A key is the storage key: renaming one silently resets it for every install.
  var DEFAULTS = {
    a1FilenameField: '',
  };

  var SEED_DEFAULTS = {
    a1FilenameField: FIELD_DEFAULT,
  };

  // **Absent is seeded, present is answered** - even an empty box, which means the
  // default anyway. **The whole stored map goes back**, because `configurePlugin`
  // replaces `plugins.<id>` rather than merging into it.
  var _seeded = false;

  function seedDefaults(raw, s) {
    if (_seeded) return;
    var missing = [], k;
    for (k in SEED_DEFAULTS) if (hasOwn(SEED_DEFAULTS, k) && !hasOwn(raw, k)) missing.push(k);
    if (!missing.length) return;
    _seeded = true;
    var input = {};
    for (k in raw) if (hasOwn(raw, k)) input[k] = raw[k];
    missing.forEach(function (key) { s[key] = input[key] = SEED_DEFAULTS[key]; });
    gqlRequest('mutation SFMSeedSettings($id: ID!, $input: Map!) ' +
      '{ configurePlugin(plugin_id: $id, input: $input) }', { id: PLUGIN_ID, input: input })
      .then(refreshConfiguration, function () {
        _seeded = false;
        sfm('[sfm] the default field name could not be written into the settings; ' +
          'it is in force all the same.');
      });
  }

  // The settings page reads the configuration through Stash's Apollo cache, usually
  // before the seed lands, so the box would stay empty until a later visit. Evicting
  // the cached root field makes the page ask again and show the seeded name. Where
  // Apollo is absent the box fills on the next visit instead.
  function refreshConfiguration() {
    var client = window.__APOLLO_CLIENT__;
    if (!client || !client.cache || !client.cache.evict) return;
    try {
      client.cache.evict({ id: 'ROOT_QUERY', fieldName: 'configuration' });
      if (client.cache.gc) client.cache.gc();
    } catch (e) {
      sfm('[sfm] the settings page could not be told to re-read the seeded default: ' + e);
    }
  }

  function loadSettings() {
    return gqlRequest('query SFMSettings { configuration { plugins } }', null).then(function (data) {
      var raw = ((data.configuration || {}).plugins || {})[PLUGIN_ID] || {};
      var s = {};
      for (var k in DEFAULTS) {
        if (hasOwn(DEFAULTS, k)) s[k] = raw[k] == null ? '' : String(raw[k]);
      }
      seedDefaults(raw, s);
      return s;
    });
  }

  var _settings = null, _settingsAt = 0, _settingsWait = null;

  function settings() {
    if (!_settings) {
      _settings = {};
      for (var k in DEFAULTS) if (hasOwn(DEFAULTS, k)) _settings[k] = DEFAULTS[k];
    }
    if (!_settingsWait && Date.now() - _settingsAt > SETTINGS_TTL_MS) {
      _settingsWait = loadSettings().then(function (s) {
        _settings = s; _settingsAt = Date.now(); _settingsWait = null;
      }, function () { _settingsAt = Date.now(); _settingsWait = null; });
    }
    return _settings;
  }

  function settingsReady() {
    settings();
    return _settingsWait ? _settingsWait.then(function () { return _settings; })
      : Promise.resolve(_settings);
  }

  // An empty box means the default, never "no field".
  function fieldName(s) {
    return trim((s || settings()).a1FilenameField) || FIELD_DEFAULT;
  }

  // ── The bulk-edit lease ───────────────────────────────────────────────────
  //
  // Taken for every write and every undo, renewed per scene, released in every outcome.
  // A foreign one is noted in the head, never stood down for: these runs are started by
  // hand. Nothing here reacts to a save, so no `respecters` entry.
  function foreignLease() {
    var c = coop(), now = Date.now();
    for (var i = c.leases.length - 1; i >= 0; i--) {
      if (c.leases[i].until <= now) c.leases.splice(i, 1);
    }
    return c.leases.length ? c.leases[0] : null;
  }

  function acquireLease(label) {
    var c = coop();
    var lease = { owner: PLUGIN_ID, label: label, until: Date.now() + LEASE_TTL_MS };
    c.leases.push(lease);
    return {
      renew: function () { lease.until = Date.now() + LEASE_TTL_MS; },
      release: function () {
        var i = c.leases.indexOf(lease);
        if (i !== -1) c.leases.splice(i, 1);
      },
    };
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  var CSS =
    // The shared dialog chrome, identical to the siblings' with the prefix swapped;
    // `tests/style.test.js` pins the overlap.
    '.sfm-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);' +
    'z-index:1600;display:flex;align-items:center;justify-content:center;}' +
    '.sfm-modal{background:#202b33;color:#f5f8fa;border:1px solid #394b59;border-radius:4px;' +
    'width:min(100rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
    '.sfm-head{padding:.75rem 1rem;border-bottom:1px solid #394b59;}' +
    '.sfm-title{font-size:1.1rem;font-weight:600;}' +
    '.sfm-warn{color:#ffb648;margin-top:.35rem;}' +
    '.sfm-note{color:#a7b6c2;margin-top:.35rem;}' +
    '.sfm-legend{color:#7d8f9c;margin-top:.35rem;font-size:.8rem;}' +
    '.sfm-progress{padding:.5rem 1rem;border-bottom:1px solid #394b59;color:#a7b6c2;' +
    'white-space:pre-wrap;}' +
    '.sfm-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;font-family:monospace;font-size:.8rem;' +
    'line-height:1.35;min-height:14rem;}' +
    '.sfm-line{white-space:pre-wrap;word-break:break-word;}' +
    '.sfm-elink{color:#7cc4ff;text-decoration:none;}' +
    '.sfm-elink:hover{text-decoration:underline;}' +
    '.sfm-spin{color:#a7b6c2;}' +
    '.sfm-ERROR{color:#ff7373;} .sfm-WARN{color:#ffb648;} .sfm-INFO{color:#a7b6c2;}' +
    '.sfm-EDIT{color:#84d68a;}' +
    '.sfm-foot{padding:.75rem 1rem;border-top:1px solid #394b59;display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.sfm-foot button{margin-right:.5rem;}' +
    '.sfm-hidden{display:none !important;}' +
    // The settings page: the description in paragraphs, all but the first behind
    // Show more, and each setting's detail in a hover box. Scoped to our own group.
    '.sfm-own-group .sub-heading{white-space:pre-wrap;}' +
    '.sfm-own-group .sub-heading .sfm-p{margin:0 0 .35em;}' +
    '.sfm-own-group .sub-heading .sfm-p:last-child{margin-bottom:0;}' +
    '.sfm-tipped{position:relative;}' +
    '.sfm-tip{margin-left:.35rem;cursor:pointer;opacity:.65;font-style:normal;' +
    'font-size:1.05em;}' +
    '.sfm-tip:hover,.sfm-tip:focus{opacity:1;outline:none;}' +
    '.sfm-tipbox{display:none;position:absolute;left:0;bottom:calc(100% + .35rem);' +
    'z-index:1500;width:max-content;max-width:100%;padding:.5rem .65rem;' +
    'background:#202b33;color:#d6dee4;border:1px solid #425a6b;border-radius:3px;' +
    'font-size:.92rem;line-height:1.45;white-space:pre-wrap;pointer-events:none;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.sfm-tipped.sfm-tip-open .sfm-tipbox{display:block;}' +
    '.sfm-desc-collapsed .sfm-p:not(:first-child){display:none;}' +
    '.sfm-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:#7cc4ff;font-size:.8rem;cursor:pointer;' +
    'text-decoration:underline;}' +
    '.sfm-stale{margin:.5rem 0;padding:.6rem .75rem;border-left:4px solid #ff7373;' +
    'background:rgba(255,115,115,.14);color:#ff7373;font-size:.95rem;line-height:1.45;' +
    'font-weight:600;}';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = el('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.body || document.documentElement).appendChild(style);
  }

  function button(label, className) {
    var b = el('button', 'btn btn-secondary btn-sm' + (className ? ' ' + className : ''), label);
    b.type = 'button';
    return b;
  }

  function paintButton(btn, variant) {
    if (hasClass(btn, variant)) return;
    btn.className = String(btn.className || '')
      .replace(/\bbtn-(secondary|warning|info|primary|success|light|dark|link)\b/g, '')
      .replace(/\s+/g, ' ').replace(/^ | $/g, '') + ' ' + variant;
  }

  // ── The two tasks ─────────────────────────────────────────────────────────
  //
  // Each is a scan (`plan` turns one scene into a job or nothing), a write and its
  // inverse. The dialog around them is shared.
  var SCENE_QUERY = 'query SFMScenes($filter: FindFilterType) { findScenes(filter: $filter) ' +
    '{ count scenes { id title custom_fields files { id basename parent_folder { id } } } } }';

  var ARCHIVE_TASK = {
    name: 'Archive Original Filenames...',
    title: 'Archive Original Filenames',
    legend: 'One line per scene that does not carry the field yet: the scene with its id in ' +
      'brackets, then the name its file has now, without the extension, which is what Proceed ' +
      'writes into the field. A scene that already carries the field is never listed and ' +
      'never overwritten - delete the field on a scene to archive it again under its ' +
      'current name.',
    verb: 'to archive',
    plan: function (scene, field, run) {
      var cf = scene.custom_fields || {};
      if (hasOwn(cf, field) && cf[field] != null && trim(cf[field]) !== '') return null;
      var f = primaryFile(scene);
      if (!f || !f.basename) { run.noFile++; return null; }
      return { scene: scene, value: stemOf(f.basename) };
    },
    tail: function (job) { return ': "' + job.value + '"'; },
    op: 'SFMArchive',
    // Undo takes the field off again, which a lock in Custom Fields Bulk Editor forbids.
    undoRemovesField: true,
    write: function (job, field) {
      var partial = {};
      partial[field] = job.value;
      return { field: 'sceneUpdate', type: 'SceneUpdateInput', sel: ' { id }',
        input: { id: job.scene.id, custom_fields: { partial: partial } } };
    },
    // The field was absent before the write - that is what put the scene in the plan -
    // so taking it off is the exact inverse.
    undo: function (job, field) {
      return { field: 'sceneUpdate', type: 'SceneUpdateInput', sel: ' { id }',
        input: { id: job.scene.id, custom_fields: { remove: [field] } } };
    },
  };

  var RESTORE_TASK = {
    name: 'Restore Original Filenames...',
    title: 'Restore Original Filenames',
    legend: 'One line per scene whose file is named differently from what the field ' +
      'archived: the scene with its id in brackets, then the file’s name now and the ' +
      'name Proceed renames it to - the archived name with the file’s current ' +
      'extension, in the same folder. Only a scene’s primary file is renamed.',
    verb: 'to rename',
    plan: function (scene, field, run) {
      var cf = scene.custom_fields || {};
      if (!hasOwn(cf, field) || cf[field] == null || trim(cf[field]) === '') return null;
      var f = primaryFile(scene);
      if (!f || !f.basename) { run.noFile++; return null; }
      var want = String(cf[field]);
      if (want === stemOf(f.basename)) return null;
      var bad = badStem(want);
      if (bad) {
        run.msg('WARN', sceneName(scene) + ' [' + scene.id + '] is skipped: the archived ' +
          'name "' + want + '" cannot be a filename, because ' + bad + '.');
        return null;
      }
      return { scene: scene, file: f, folder: f.parent_folder && f.parent_folder.id,
        from: f.basename, to: want + extOf(f.basename) };
    },
    tail: function (job) { return ': "' + job.from + '" → "' + job.to + '"'; },
    op: 'SFMRename',
    write: function (job) { return moveFile(job, job.to); },
    undo: function (job) { return moveFile(job, job.from); },
  };

  // Same folder, new basename. Stash refuses a name already taken there, which lands
  // as that scene's error line rather than an overwrite.
  function moveFile(job, basename) {
    return { field: 'moveFiles', type: 'MoveFilesInput', sel: '',
      input: { ids: [job.file.id], destination_folder_id: job.folder,
        destination_basename: basename } };
  }

  // **Many scenes per request.** Each scene carries its own value, so there is no one
  // bulk delta to send the way Custom Fields Bulk Editor's Remove can; instead up to
  // `WRITE_BATCH` single updates travel as aliases of one mutation (`m0`, `m1`, …),
  // which GraphQL runs one after another. One request per scene was the round trip
  // paid tens of thousands of times over. Answers one error string, or null, per part:
  // an alias's own error is that scene's alone, and a request-wide one is everybody's.
  var WRITE_BATCH = 100;

  function sendBatch(opName, parts) {
    var decl = [], body = [], vars = {};
    parts.forEach(function (p, i) {
      decl.push('$i' + i + ': ' + p.type + '!');
      body.push('m' + i + ': ' + p.field + '(input: $i' + i + ')' + p.sel);
      vars['i' + i] = p.input;
    });
    return fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'mutation ' + opName + '(' + decl.join(', ') + ') { ' +
        body.join(' ') + ' }', variables: vars }),
    }).then(function (resp) { return resp.json(); }).then(function (json) {
      var own = {}, general = null;
      (json.errors || []).forEach(function (e) {
        var at = e && e.path && e.path[0];
        if (typeof at === 'string' && /^m\d+$/.test(at)) own[at] = e.message;
        else general = (e && e.message) || 'the request failed';
      });
      var data = json.data || {};
      return parts.map(function (p, i) {
        var k = 'm' + i;
        if (own[k]) return own[k];
        if (data[k] == null || data[k] === false) return general || 'the server did not confirm it';
        return null;
      });
    });
  }

  var TASKS = [ARCHIVE_TASK, RESTORE_TASK];

  // ── The dialog ────────────────────────────────────────────────────────────

  var _active = null;

  function startRun(task) {
    if (_active) { _active.focus(); return; }
    _active = new Run(task);
    _active.begin();
  }

  function Run(task) {
    this.task = task;
    this.logText = [];
    this.jobs = [];       // what the scan found to do
    this.changes = [];    // what Proceed wrote, newest last, for Undo
    this.scanned = 0;
    this.total = 0;
    this.noFile = 0;
    this.written = 0;
    this.failed = 0;
    this.state = 'scanning';
    this.stopped = false;
    this.scanFailed = false;
    this.stale = false;
    this.build();
  }

  Run.prototype.build = function () {
    injectStyle();
    var self = this;
    this.backdrop = el('div', 'sfm-backdrop');
    this.modal = el('div', 'sfm-modal');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'sfm-head');
    head.appendChild(el('div', 'sfm-title', PLUGIN_SHORT_NAME + ' - ' + this.task.title));
    this.staleEl = el('div', 'sfm-stale sfm-hidden', '');
    head.appendChild(this.staleEl);
    head.appendChild(el('div', 'sfm-warn',
      'Backing up your database before proceeding is recommended. Undo only reverses what this ' +
      'dialog wrote, while it stays open, and cannot account for changes made elsewhere in the ' +
      'meantime.'));
    this.noteEl = el('div', 'sfm-note sfm-hidden', '');
    head.appendChild(this.noteEl);
    head.appendChild(el('div', 'sfm-legend', this.task.legend));
    this.modal.appendChild(head);

    this.progressEl = el('div', 'sfm-progress', 'Starting…');
    this.modal.appendChild(this.progressEl);
    this.logEl = el('div', 'sfm-log');
    this.modal.appendChild(this.logEl);

    var foot = el('div', 'sfm-foot');
    this.goBtn = button('Proceed', 'sfm-go');
    paintButton(this.goBtn, PLUGIN_BTN_VARIANT);
    this.undoBtn = button('Undo', 'sfm-undo sfm-hidden');
    paintButton(this.undoBtn, PLUGIN_BTN_VARIANT);
    this.stopBtn = button('Stop', 'sfm-stop sfm-hidden');
    this.copyBtn = button('Copy log', 'sfm-copy');
    this.copyBtn.title = 'Copy the counters and every line of the log as plain text.';
    this.closeBtn = button('Close', 'sfm-close');
    this.goBtn.addEventListener('click', function () { self.go(); });
    this.undoBtn.addEventListener('click', function () { self.undo(); });
    this.stopBtn.addEventListener('click', function () { self.stop(); });
    this.copyBtn.addEventListener('click', function () { self.copyLog(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });
    [this.goBtn, this.stopBtn, this.copyBtn, this.undoBtn, this.closeBtn]
      .forEach(function (b) { foot.appendChild(b); });
    this.modal.appendChild(foot);

    wireEscape(this);
    document.body.appendChild(this.backdrop);
  };

  Run.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
  };

  Run.prototype.show = function (node, visible) {
    node.className = node.className.replace(/\s*sfm-hidden/g, '') + (visible ? '' : ' sfm-hidden');
  };

  Run.prototype.note = function (text) {
    this.noteEl.textContent = text || '';
    this.show(this.noteEl, !!text);
  };

  Run.prototype.appendLine = function (line, text) {
    this.logText.push(text);
    if (this.spinEl) this.logEl.insertBefore(line, this.spinEl);
    else this.logEl.appendChild(line);
    // `firstChild` is always a line: the spinner sits last.
    if (this.logText.length > LOG_RENDER_CAP && this.logEl.firstChild) {
      this.logEl.removeChild(this.logEl.firstChild);
    }
    this.scrollLog();
  };

  Run.prototype.msg = function (kind, message) {
    var text = '[' + kind + '] ' + message;
    this.appendLine(el('div', 'sfm-line sfm-' + kind, text), text);
  };

  // A line naming a scene: the scene is a link and a hover card, `logText` keeps the text.
  Run.prototype.sceneLine = function (kind, job, tail) {
    var name = sceneName(job.scene) + ' [' + job.scene.id + ']';
    var head = '[' + kind + '] ';
    var line = el('div', 'sfm-line sfm-' + kind);
    line.appendChild(el('span', null, head));
    var link = el('a', 'sfm-elink', name);
    link.href = '/scenes/' + job.scene.id;
    link.target = linkTarget();
    link.rel = 'noopener noreferrer';
    entityTip(link, 'scenes', job.scene.id);
    line.appendChild(link);
    line.appendChild(el('span', null, tail));
    this.appendLine(line, head + name + tail);
  };

  Run.prototype.scrollLog = function () {
    var self = this;
    if (this.scrollQueued) return;
    this.scrollQueued = true;
    setTimeout(function () {
      self.scrollQueued = false;
      self.logEl.scrollTop = self.logEl.scrollHeight || 0;
    }, 0);
  };

  Run.prototype.progress = function () {
    var parts = ['Scanned ' + (this.total ? this.scanned + ' of ' + plural(this.total, 'scene')
      : plural(this.scanned, 'scene'))];
    parts.push(plural(this.jobs.length, 'scene') + ' ' + this.task.verb);
    if (this.noFile) parts.push(plural(this.noFile, 'scene') + ' with no file, skipped');
    if (this.written) parts.push(this.written + ' written');
    if (this.failed) parts.push(plural(this.failed, 'failure'));
    if (this.logText.length > LOG_RENDER_CAP) {
      parts.push('showing the last ' + LOG_RENDER_CAP + ' of ' + this.logText.length + ' lines');
    }
    this.progressEl.textContent = parts.join('. ') + '.';
  };

  Run.prototype.spin = function (on) {
    if (!on) {
      if (this.spinTimer) clearInterval(this.spinTimer);
      this.spinTimer = null;
      if (this.spinEl && this.spinEl.parentNode) this.spinEl.parentNode.removeChild(this.spinEl);
      this.spinEl = null;
      return;
    }
    if (this.spinTimer) return;
    var frames = ['▙', '▛', '▜', '▟'], i = 0, self = this;
    this.spinEl = el('div', 'sfm-spin', frames[0]);
    this.logEl.appendChild(this.spinEl);
    this.spinTimer = setInterval(function () {
      i = (i + 1) % frames.length;
      if (self.spinEl) self.spinEl.textContent = frames[i];
    }, 500);
  };

  // A flag on the job rather than a search of `changes`, which was a pass over every
  // write per job - quadratic, and seconds of it on a library-sized run.
  Run.prototype.pending = function () {
    return this.jobs.filter(function (j) { return !j.written && !j.failed; });
  };

  Run.prototype.setState = function (state) {
    this.state = state;
    this.spin(state !== 'listing');
    this.syncFooter();
  };

  // The footer is the one place that says what can be pressed now, and why not.
  Run.prototype.syncFooter = function () {
    var busy = this.state !== 'listing';
    var writing = this.state === 'writing' || this.state === 'undoing';
    var left = this.pending().length;
    this.goBtn.disabled = busy || this.stale || !left;
    this.goBtn.title = this.stale ? 'This page is running an older script than the one ' +
      'installed; reload it first.'
      : busy ? 'Wait for the ' + (this.state === 'scanning' ? 'scan' : 'write') + ' to finish.'
        : !left ? 'Nothing is left ' + this.task.verb + '.'
          : 'Write the ' + plural(left, 'scene') + ' listed.';
    this.show(this.undoBtn, this.changes.length > 0);
    this.undoBtn.disabled = busy;
    this.show(this.stopBtn, writing);
    this.closeBtn.disabled = writing;
    // Green once nothing is left to write; an error, a stopped pass or a stale script
    // keeps it grey. An offered Undo does not take the green away.
    var clean = !busy && !left && !this.scanFailed && !this.failed && !this.stopped &&
      !this.stale;
    paintButton(this.closeBtn, clean ? 'btn-success' : 'btn-secondary');
  };

  Run.prototype.begin = function () {
    var self = this;
    this.setState('scanning');
    this.progressEl.textContent = 'Reading your settings…';
    checkStale(this);
    var lease = foreignLease();
    if (lease) {
      this.note('Another plugin is running a bulk edit here (' + lease.label + '), so a ' +
        'scene may be read a moment behind what it holds.');
    }
    settingsReady().then(function (s) {
      self.field = fieldName(s);
      self.msg('INFO', 'Custom field: "' + self.field + '".');
      return self.scanPage(1);
    }).then(function () {
      if (self.stopped) return;
      if (!self.jobs.length) self.msg('INFO', 'Nothing ' + self.task.verb + '.');
      self.progress();
      self.setState('listing');
    }, function (e) {
      if (self.stopped) return;
      self.scanFailed = true;
      self.msg('ERROR', 'The scan failed: ' + (e && e.message ? e.message : e));
      self.progress();
      self.setState('listing');
    });
  };

  Run.prototype.scanPage = function (page) {
    var self = this;
    if (this.stopped) return Promise.resolve();
    return gqlRequest(SCENE_QUERY, { filter: { page: page, per_page: READ_PAGE, sort: 'id',
      direction: 'ASC' } }).then(function (data) {
      if (self.stopped) return null;
      var res = data.findScenes || {}, scenes = res.scenes || [];
      self.total = res.count || 0;
      scenes.forEach(function (scene) {
        self.scanned++;
        var job = self.task.plan(scene, self.field, self);
        if (!job) return;
        self.jobs.push(job);
        self.sceneLine('PLAN', job, self.task.tail(job));
      });
      self.progress();
      if (scenes.length === READ_PAGE && self.scanned < self.total) return self.scanPage(page + 1);
      return null;
    });
  };

  // One batch per request, the lease renewed before each, Stop read between them.
  Run.prototype.runJobs = function (jobs, op, label, build, done) {
    var self = this, lease = acquireLease(label), i = 0;
    this.stopped = false;
    function next() {
      if (i >= jobs.length || self.stopped) return Promise.resolve();
      var part = jobs.slice(i, i + WRITE_BATCH);
      i += part.length;
      lease.renew();
      return sendBatch(op, part.map(build)).then(function (errs) {
        part.forEach(function (job, k) { done(job, errs[k]); });
      }, function (e) {
        var why = e && e.message ? e.message : String(e);
        part.forEach(function (job) { done(job, why); });
      }).then(function () { self.progress(); }).then(next);
    }
    return next().then(function () { lease.release(); }, function (e) {
      lease.release();
      throw e;
    });
  };

  Run.prototype.go = function () {
    if (this.state !== 'listing' || this.stale) return;
    var self = this, task = this.task, field = this.field, jobs = this.pending();
    if (!jobs.length) return;
    this.setState('writing');
    this.runJobs(jobs, task.op, PLUGIN_SHORT_NAME + ': ' + task.title,
      function (job) { return task.write(job, field); },
      function (job, err) {
        if (err) {
          job.failed = true;
          self.failed++;
          self.sceneLine('ERROR', job, ': ' + err);
        } else {
          job.written = true;
          self.changes.push(job);
          self.written++;
          self.sceneLine('EDIT', job, task.tail(job));
        }
      }).then(function () {
      if (self.stopped) self.msg('WARN', 'Stopped. ' + plural(self.pending().length, 'scene') +
        ' left unwritten.');
      self.setState('listing');
    });
  };

  // An Archive is undone by removing the field it added. Locked in Custom Fields Bulk
  // Editor, the field may be added and never removed, so that Undo is refused - and
  // where the lock list cannot be read, refused too. Restore's Undo renames files and
  // touches no field.
  Run.prototype.undo = function () {
    if (this.state !== 'listing' || !this.changes.length) return;
    if (!this.task.undoRemovesField) { this.undoWrites(); return; }
    var self = this, field = this.field;
    this.setState('undoing');
    fieldLocks().then(function (locks) {
      self.setState('listing');
      if (locks === false || (locks && locks.isLocked(field))) {
        self.msg('WARN', 'Undo is refused: it would remove "' + field + '" from ' +
          plural(self.changes.length, 'scene') + ', and ' + (locks === false
          ? 'ᝯㄝₓ Custom Fields Bulk Editor could not say whether it is locked.'
          : 'it is locked in ᝯㄝₓ Custom Fields Bulk Editor\u2019s Locked Custom Fields ' +
            'setting - a locked field can be added, never removed.'));
        return;
      }
      self.undoWrites();
    });
  };

  Run.prototype.undoWrites = function () {
    var self = this, task = this.task, field = this.field;
    var jobs = this.changes.slice().reverse();
    this.setState('undoing');
    this.runJobs(jobs, task.op + 'Undo', PLUGIN_SHORT_NAME + ': ' + task.title + ' (undo)',
      function (job) { return task.undo(job, field); },
      function (job, err) {
        if (err) {
          self.failed++;
          self.sceneLine('ERROR', job, ': the undo failed: ' + err);
          return;
        }
        // Undone newest first, so the job is at the end: `lastIndexOf` finds it at once
        // where `indexOf` walked the whole list per scene.
        self.changes.splice(self.changes.lastIndexOf(job), 1);
        job.written = false;
        self.written--;
        self.sceneLine('UNDO', job, task.tail(job));
      }).then(function () {
      if (self.stopped) self.msg('WARN', 'Stopped. ' + plural(self.changes.length, 'scene') +
        ' still written.');
      self.setState('listing');
    });
  };

  Run.prototype.stop = function () {
    if (this.state !== 'writing' && this.state !== 'undoing') return;
    if (this.stopped) return;
    this.stopped = true;
    this.msg('WARN', 'Stopping after the request in flight…');
  };

  Run.prototype.copyLog = function () {
    var self = this, was = this.copyBtn.textContent;
    copyToClipboard([this.progressEl.textContent].concat(this.logText).join('\n'), function (ok) {
      holdWidth(self.copyBtn);
      self.copyBtn.textContent = ok ? 'Copied' : 'Failed';
      setTimeout(function () { self.copyBtn.textContent = was; }, 2000);
    });
  };

  Run.prototype.close = function () {
    // Also what ends a scan: the paging checks it before asking for the next page.
    this.stopped = true;
    unwireEscape(this);
    this.spin(false);
    if (this.backdrop.parentNode) this.backdrop.parentNode.removeChild(this.backdrop);
    _active = null;
  };

  // Escape acts through the footer's Close, so it can never reach a disabled one.
  function wireEscape(run) {
    run._onEscape = function (ev) {
      if (!ev || (ev.key !== 'Escape' && ev.keyCode !== 27)) return;
      var b = run.closeBtn;
      if (!b || b.disabled || hasClass(b, 'sfm-hidden')) return;
      if (ev.preventDefault) ev.preventDefault();
      b.click();
    };
    document.addEventListener('keydown', run._onEscape);
  }

  function unwireEscape(run) {
    if (run._onEscape) document.removeEventListener('keydown', run._onEscape);
    run._onEscape = null;
  }

  // A stale script is refused the write rather than warned about: what it would write
  // is the previous release's idea of the plan.
  function checkStale(run) {
    gqlRequest('query SFMPluginVersion { plugins { id version } }', null)
      .then(function (data) {
        var list = (data && data.plugins) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && String(list[i].id) === PLUGIN_ID) return list[i].version || null;
        }
        return null;
      }, function () { return null; })
      .then(function (installed) {
        if (!installed || installed === PLUGIN_VERSION) return;
        run.stale = true;
        run.staleEl.textContent = '⚠ This page is still running ' + PLUGIN_SHORT_NAME +
          ' ' + PLUGIN_VERSION + ', but ' + installed + ' is installed. Press Ctrl+Shift+R ' +
          '(⌘+Shift+R on a Mac) and open this again: nothing will be written until you do.';
        staleReloadButton(run.staleEl);
        run.show(run.staleEl, true);
        run.syncFooter();
      });
  }

  // ── The task buttons ──────────────────────────────────────────────────────
  //
  // Declared in the yml so Stash lists them, handled here: a capture-phase listener beats
  // React's own and stops the click, so no job is queued and no toast appears. Ours only
  // if the caption matches *and* the enclosing group is headed with our name.
  function taskByCaption(label) {
    for (var i = 0; i < TASKS.length; i++) if (TASKS[i].name === label) return TASKS[i];
    return null;
  }

  function ownTask(btn) {
    var task = taskByCaption(trim(btn.textContent));
    if (!task) return null;
    var fallback = null;
    for (var node = btn, depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      var heading = node.querySelector ? node.querySelector('h3') : null;
      var ours = !!heading && headingIsOurs(heading.textContent);
      if (hasClass(node, 'setting-group')) return ours ? task : null;
      if (ours) fallback = task;
    }
    return fallback;
  }

  function paintTaskButtons() {
    var nodes = document.querySelectorAll ? document.querySelectorAll('button') : [];
    for (var i = 0; i < nodes.length; i++) {
      if (ownTask(nodes[i])) paintButton(nodes[i], PLUGIN_BTN_VARIANT);
    }
  }

  if (document.addEventListener) {
    document.addEventListener('click', function (event) {
      var target = event.target;
      var btn = target && target.closest ? target.closest('button') : null;
      var task = btn ? ownTask(btn) : null;
      if (!task) return;
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      startRun(task);
    }, true);
  }

  // ── The settings page ─────────────────────────────────────────────────────
  //
  // The group is found by the `plugin-<id>-<key>` id Stash gives every setting, with the
  // heading as fallback - guarded by `hasOwnTaskButton`, because Settings → Tasks heads
  // its group with the same name and decorating it would destroy the task buttons.
  function ownSettingGroup() {
    var node = null, d;
    for (var key in DEFAULTS) {
      if (!hasOwn(DEFAULTS, key)) continue;
      node = coreSettingElement(PLUGIN_ID, key);
      if (node) break;
    }
    for (d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting-group')) return node;
    }
    var heading = ownSettingGroupHeading();
    for (node = heading, d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting-group')) return hasOwnTaskButton(node) ? null : node;
    }
    return heading ? heading.parentElement : null;
  }

  function hasOwnTaskButton(node) {
    if (!node) return false;
    if (node.tagName === 'BUTTON' && taskByCaption(trim(node.textContent))) return true;
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) if (hasOwnTaskButton(kids[i])) return true;
    return false;
  }

  function ownSettingGroupHeading() {
    var nodes = document.querySelectorAll ? document.querySelectorAll('h3') : [];
    for (var i = 0; i < nodes.length; i++) {
      if (headingIsOurs(nodes[i].textContent)) return nodes[i];
    }
    return null;
  }

  // Settings → Plugins heads the group `<name> (<version>)`, Settings → Tasks with the
  // bare name; compared exactly after the suffix is stripped.
  function headingIsOurs(text) {
    var t = trim(text);
    if (t === PLUGIN_NAME) return true;
    return trim(t.replace(/\s*\([^()]*\)$/, '').replace(/\s+undefined$/, '')) === PLUGIN_NAME;
  }

  function oneLine(text) {
    return trim(String(text == null ? '' : text).replace(/\s+/g, ' '));
  }

  // Stash renders the description as one text node; it is rebuilt as one div per
  // paragraph, on every tick, because React puts the text node back on a re-render.
  function splitDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'sfm-p')) return;
    var text = sub.textContent || '';
    if (text.indexOf('\n') === -1) return;
    sub.textContent = '';
    text.split(/\n{2,}/).forEach(function (para) {
      var t = oneLine(para);
      if (t) sub.appendChild(el('div', 'sfm-p', t));
    });
  }

  function setClass(node, name, on) {
    var cls = String(node.className || '').replace(new RegExp('\\s*' + name + '\\b'), '');
    node.className = trim(on ? cls + ' ' + name : cls);
  }

  // A <button>, never a <span>: SettingGroup folds the whole group on any other click.
  function collapseDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub || document.getElementById(DESC_TOGGLE_ID)) return;
    var kids = sub.childNodes || [], paras = 0;
    for (var i = 0; i < kids.length; i++) if (hasClass(kids[i], 'sfm-p')) paras++;
    if (paras < 2) return;
    setClass(sub, 'sfm-desc-collapsed', true);
    var btn = el('button', 'sfm-desc-toggle', 'Show more');
    btn.id = DESC_TOGGLE_ID;
    btn.type = 'button';
    btn.addEventListener('click', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      var open = hasClass(sub, 'sfm-desc-collapsed');
      setClass(sub, 'sfm-desc-collapsed', !open);
      btn.textContent = open ? 'Show less' : 'Show more';
    });
    sub.appendChild(btn);
  }

  // A setting's description keeps its first paragraph on the row; the rest opens in a
  // box from the ⓘ mark, the summary or the setting's name.
  function tipTrigger(node, row) {
    if (!node || node._sfmTipWired) return;
    node._sfmTipWired = true;
    var toggle = function (on) {
      var sub = byClass(row, 'sub-heading');
      if (sub) setClass(sub, 'sfm-tip-open', on);
    };
    node.addEventListener('mouseenter', function () { toggle(true); });
    node.addEventListener('mouseleave', function () { toggle(false); });
    node.addEventListener('focus', function () { toggle(true); });
    node.addEventListener('blur', function () { toggle(false); });
  }

  function tipSetting(key) {
    var row = coreSettingRow(PLUGIN_ID, key);
    var sub = row && byClass(row, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'sfm-sum')) return;
    var text = sub.textContent || '', cut = text.indexOf('\n\n');
    if (cut === -1) return;
    var summary = oneLine(text.slice(0, cut));
    var detail = text.slice(cut + 2).split(/\n{2,}/).map(oneLine)
      .filter(function (p) { return !!p; }).join('\n\n');
    if (!summary || !detail) return;
    sub.textContent = '';
    setClass(sub, 'sfm-tipped', true);
    var sum = el('span', 'sfm-sum', summary);
    sub.appendChild(sum);
    var mark = el('span', 'sfm-tip', 'ⓘ');
    mark.tabIndex = 0;
    sub.appendChild(mark);
    sub.appendChild(el('span', 'sfm-tipbox', detail));
    tipTrigger(mark, row);
    tipTrigger(sum, row);
    tipTrigger(row.querySelector ? row.querySelector('h3') : null, row);
  }

  // The manifest's version is in the group heading; `PLUGIN_VERSION` is what this script
  // is. No parenthesised version means Settings → Tasks, which says nothing either way.
  function ensureStaleNotice(group) {
    var h3 = group.querySelector ? group.querySelector('h3') : null;
    var m = /\(([^()]+)\)$/.exec(trim(h3 && h3.textContent));
    var installed = m ? trim(m[1]) : null;
    var stale = !!installed && installed !== PLUGIN_VERSION;
    var node = document.getElementById(STALE_ID);
    ensureReloadUiButton(PLUGIN_ID, group, stale);
    if (!stale) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      return;
    }
    var sub = byClass(group, 'sub-heading');
    var parent = sub && sub.parentNode ? sub.parentNode : group;
    var before = sub && sub.parentNode ? sub : group.firstChild;
    if (node && node.parentNode === parent) return;
    if (node && node.parentNode) node.parentNode.removeChild(node);
    node = el('div', 'sfm-stale', '⚠ This page is still running ' + PLUGIN_SHORT_NAME +
      ' ' + PLUGIN_VERSION + ', but ' + installed + ' is installed. Press Ctrl+Shift+R ' +
      '(⌘+Shift+R on a Mac) to reload it: your browser has cached the older script, ' +
      'and everything this plugin does until then is that older code.');
    node.id = STALE_ID;
    parent.insertBefore(node, before);
  }

  function ensureReadmeLink(group) {
    if (document.getElementById(README_LINK_ID)) return;
    var link = el('a', 'sfm-readme', 'SceneFilenameManager/README.md');
    link.id = README_LINK_ID;
    link.href = README_URL;
    link.target = linkTarget();
    link.rel = 'noreferrer';
    link.title = 'Open this plugin’s documentation';
    link.style = 'display:inline-block;margin-top:.35rem;font-size:.8rem;';
    var sub = byClass(group, 'sub-heading');
    if (sub && sub.parentNode) sub.parentNode.insertBefore(link, sub.nextSibling);
    else group.appendChild(link);
  }

  function settingsTick() {
    paintTaskButtons();
    var group = ownSettingGroup();
    if (!group) return;
    injectStyle();
    setClass(group, 'sfm-own-group', true);
    splitDescription(group);
    collapseDescription(group);   // after the split: it counts the paragraphs
    for (var k in DEFAULTS) if (hasOwn(DEFAULTS, k)) tipSetting(k);
    ensureStaleNotice(group);
    ensureReadmeLink(group);
    // `fieldName()`, not the raw box: an empty one means the default.
    cfTipTick(PLUGIN_ID, 'a1FilenameField', fieldName());
  }

  // ── The field's description, filed with Custom Fields Bulk Editor ─────────
  //
  // Feature-detected and never overwriting: a description already filed under the name
  // is somebody's writing, and `describeField` itself refuses to replace it.
  var FIELD_DESCRIPTION = 'The name this scene’s file had when it was archived, ' +
    'without the extension.\n\n' +
    'Written by ' + PLUGIN_NAME + '’s Archive Original Filenames task on scenes that do ' +
    'not carry it yet, and never overwritten - delete it to archive the scene again under ' +
    'its current name. Restore Original Filenames renames the file back to it.';

  function describeField() {
    var api = coop().api && coop().api.CustomFieldsBulkEditor;
    if (!api || typeof api.describeField !== 'function') return;
    var name = fieldName();
    api.describeField(name, FIELD_DESCRIPTION).then(function (outcome) {
      if (outcome === 'queued') {
        sfm('[sfm] a description for "' + name + '" is waiting for ' +
          'CustomFieldsBulkEditor’s description store - open "Manage Custom Field ' +
          'Descriptions..." and press Apply to file it.');
      }
    }, function () { /* a sentence is not worth an error */ });
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  //
  // Decoration only, so a one-second timer and no `domBus` subscription.
  function tick() {
    try { settingsTick(); } catch (e) { console.error('[sfm] settings tick:', e); }
  }

  if (window.addEventListener) window.addEventListener('load', tick);
  setInterval(tick, 1000);
  // After the first settings read, so the configured name is the one described - and
  // late enough that CustomFieldsBulkEditor, loaded after this script, has published.
  settingsReady().then(function () { setTimeout(describeField, 0); }, function () {});
  tick();
}());
