// Scene Filename Manager
//
// Requires Stash 0.31.0 or newer: a scene's `custom_fields` is where the original
// filename is kept.
//
// A file's name is metadata nothing else in Stash remembers: rename the file - by hand,
// by a renamer plugin, by a scraper-driven tidy-up - and the old name is gone. This
// plugin keeps a copy of a scene's filenames in one custom field per scene, and puts
// them back on request.
//
// Three Settings → Tasks entries, one dialog:
//
//   - **Archive** writes each file's name, without its extension, into the field
//     wherever a file's name is not there yet - the primary file's alone as plain text,
//     more than one as JSON by file id. It never overwrites a name, and deleting the
//     field by hand is how a scene is re-archived under its current names.
//   - **Restore** renames each file the field names back to its archived name, keeping
//     the file's current extension.
//   - **Rename** gives files the name the rename template builds from the scene's
//     metadata, archiving first; the template has its own editor on the settings page.
//
// All list what they would touch before anything is written, and Undo reverses what
// the dialog wrote while it stays open. The design notes are in CLAUDE.md and NOTES.md
// next to this file.
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
    copyToClipboard = C.copyToClipboard, keepLog = C.keepLog, droppedLine = C.droppedLine, holdWidth = C.holdWidth, cfTipTick = C.cfTipTick,
    fieldLocks = C.fieldLocks, settle = C.settle,
    ensureReloadUiButton = C.ensureReloadUiButton, staleReloadButton = C.staleReloadButton;

  var PLUGIN_ID = 'SceneFilenameManager';
  // Byte-identical to the `.yml`: `headingIsOurs` and `ownTaskName` find this plugin's
  // settings group and task buttons by it.
  var PLUGIN_NAME = 'ᝯㄝₓ Scene Filename Manager';
  var PLUGIN_SHORT_NAME = PLUGIN_NAME;
  // The one version that proves which code is running; the settings page reads the
  // manifest, which can be newer than the script this browser cached.
  var PLUGIN_VERSION = '1.0.0';

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

  // The rename template's default and the performer cap's, seeded the same way.
  var TEMPLATE_DEFAULT = '{[|studio|] }{|basetitle|}{|!basetitle|{|origfilename|}}{ (|year|)}' +
    '{ |variantpostfix|}{ [|performers|]}{ by |director|}{ |autoindex2|}';
  var MAX_PERFORMERS_DEFAULT = 3;
  // The whole name, extension included, in UTF-8 bytes: what ext4, Btrfs and ZFS count,
  // and never more than NTFS's UTF-16 units. 60 to 255; 140 fits an eCryptfs folder.
  var NAME_BYTES_DEFAULT = 200;
  var NAME_BYTES_MIN = 60;
  var NAME_BYTES_MAX = 255;
  // The folder's path, a separator and the name, in UTF-16 units as Windows counts
  // them. 0 checks nothing; 259 is Windows' limit without long paths turned on.
  var PATH_MIN = 100;

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
    b1RenameTemplate: '',
    b2MaxPerformers: '',
    b3PerformersAlphabetical: '',
    b4MaxNameBytes: '',
    b5MaxPathLength: '',
  };

  var SEED_DEFAULTS = {
    a1FilenameField: FIELD_DEFAULT,
    b1RenameTemplate: TEMPLATE_DEFAULT,
    b2MaxPerformers: MAX_PERFORMERS_DEFAULT,
    b4MaxNameBytes: NAME_BYTES_DEFAULT,
  };

  // **Absent is seeded, present is answered** - even an empty box, which means the
  // default anyway. A saved template naming `base` or `postfix` is promoted to their new
  // names in the same write. **The whole stored map goes back**, because
  // `configurePlugin` replaces `plugins.<id>` rather than merging into it.
  var _seeded = false;

  function seedDefaults(raw, s) {
    if (_seeded) return;
    var missing = [], k;
    for (k in SEED_DEFAULTS) if (hasOwn(SEED_DEFAULTS, k) && !hasOwn(raw, k)) missing.push(k);
    var promoted = raw.b1RenameTemplate == null ? null : promoteTemplate(raw.b1RenameTemplate);
    if (!missing.length && promoted == null) return;
    _seeded = true;
    var input = {};
    for (k in raw) if (hasOwn(raw, k)) input[k] = raw[k];
    missing.forEach(function (key) { s[key] = input[key] = SEED_DEFAULTS[key]; });
    if (promoted != null) {
      s.b1RenameTemplate = input.b1RenameTemplate = promoted;
      sfm('[sfm] the rename template\'s base and postfix tokens are now basetitle and ' +
        'variantpostfix: "' + raw.b1RenameTemplate + '" is saved as "' + promoted + '".');
    }
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

  function templateOf(s) {
    var v = (s || settings()).b1RenameTemplate;
    return trim(v) ? String(v) : TEMPLATE_DEFAULT;
  }

  function maxNameBytes(s) {
    var n = parseInt((s || settings()).b4MaxNameBytes, 10);
    return isNaN(n) ? NAME_BYTES_DEFAULT : Math.max(NAME_BYTES_MIN, Math.min(NAME_BYTES_MAX, n));
  }

  // 0 (or empty) is no limit; anything else is at least PATH_MIN.
  function maxPathLength(s) {
    var n = parseInt((s || settings()).b5MaxPathLength, 10);
    return isNaN(n) || n <= 0 ? 0 : Math.max(PATH_MIN, n);
  }

  function maxPerformers(s) {
    var n = parseInt((s || settings()).b2MaxPerformers, 10);
    return isNaN(n) || n < 0 ? MAX_PERFORMERS_DEFAULT : n;
  }

  // ── The bulk-edit lease ───────────────────────────────────────────────────
  //
  // Taken for every write and every undo, renewed per scene, released in every outcome.
  // A foreign one is noted in the head, never stood down for: these runs are started by
  // hand. The one reaction to a save - carrying archived names when a file moves - stands
  // down for it, so a sibling's bulk merge raises no dialog.
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
    // The template editor: the box is transparent over a coloured copy of its text, so
    // the two share every metric - and no bold, which some fonts draw wider.
    '.sfm-edit-body{flex:1 1 auto;overflow:auto;padding:.75rem 1rem;}' +
    '.sfm-tpl-wrap{position:relative;}' +
    '.sfm-tpl-mirror,.sfm-tpl-input{font-family:monospace;font-size:.95rem;line-height:1.45;' +
    'padding:.5rem .65rem;border:1px solid #394b59;border-radius:3px;white-space:pre-wrap;' +
    'word-break:break-all;margin:0;box-sizing:border-box;}' +
    '.sfm-tpl-mirror{min-height:4.5rem;background:#10161a;color:#f5f8fa;}' +
    '.sfm-tpl-input{position:absolute;top:0;left:0;width:100%;height:100%;resize:none;' +
    'overflow:hidden;background:transparent;color:transparent;caret-color:#f5f8fa;outline:none;}' +
    '.sfm-hl-tok{color:#84d68a;} .sfm-hl-not{color:#7cc4ff;} .sfm-hl-bad{color:#ff7373;}' +
    '.sfm-hl-pair{color:#3fc1c9;} .sfm-hl-open{color:#ffb648;}' +
    '.sfm-hl-err{background:rgba(255,115,115,.4);}' +
    '.sfm-tpl-error{color:#ff7373;margin-top:.35rem;}' +
    '.sfm-palette{display:flex;flex-wrap:wrap;gap:.3rem;margin:.6rem 0;}' +
    '.sfm-vhead{color:#a7b6c2;margin:.6rem 0 .3rem;font-weight:600;}' +
    '.sfm-values{display:grid;grid-template-columns:max-content 1fr max-content;gap:.3rem .6rem;' +
    'align-items:center;}' +
    '.sfm-val{background:#30404d;color:#f5f8fa;border:1px solid #394b59;border-radius:3px;' +
    'padding:.15rem .4rem;}' +
    '.sfm-val-name{font-weight:700;}' +
    '.sfm-val-on{color:#84d68a;} .sfm-val-off{color:#ff7373;}' +
    '.sfm-val-missing{margin:0;white-space:nowrap;}' +
    '.sfm-vhead-row{display:flex;align-items:center;justify-content:space-between;}' +
    '.sfm-kept{display:flex;align-items:center;gap:.35rem;margin:0;font-weight:400;' +
    'font-size:.85rem;white-space:nowrap;}' +
    '.sfm-num{background:#30404d;color:#f5f8fa;border:1px solid #394b59;border-radius:3px;' +
    'padding:.25rem .35rem;width:4rem;}' +
    '.sfm-out{font-family:monospace;padding:.4rem .65rem;background:#10161a;border-radius:3px;' +
    'word-break:break-all;}' +
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
  var FILES_QUERY = 'query SFMScenesFiles($filter: FindFilterType) { findScenes(filter: $filter) ' +
    '{ count scenes { id files { id basename parent_folder { id } } } } }';
  var RENAME_QUERY = 'query SFMScenes($filter: FindFilterType) { findScenes(filter: $filter) ' +
    '{ count scenes { id title code date director rating100 o_counter organized ' +
    'studio { name } tags { id } stash_ids { endpoint stash_id } ' +
    'performers { name scene_count } custom_fields ' +
    'files { id basename width height duration parent_folder { id path } } } } }';

  var ARCHIVE_TASK = {
    name: 'Archive Original Filenames...',
    title: 'Archive Original Filenames',
    legend: 'One line per scene with a file whose name is not archived yet: the scene with ' +
      'its id in brackets, then the names its files have now, without the extension, which ' +
      'is what Proceed writes into the field - the primary file\u2019s name alone, or every ' +
      'file\u2019s by id for a scene with more than one. A name already archived is never ' +
      'overwritten - delete the field on a scene to archive it again under its current names.',
    verb: 'to archive',
    prepare: function (run) { return lockedFor(run); },
    plan: function (scene, field, run) {
      var files = filesOf(scene);
      if (!files.length) {
        if (archivedNames(scene, field).raw == null) run.noFile++;
        return null;
      }
      var names = archivedNames(scene, field), map = withEveryFile(scene, names.map);
      var added = files.filter(function (f) { return !hasOwn(names.map, f.id); })
        .map(function (f) { return map[f.id]; });
      if (!added.length) return null;
      // A missing field may be added whatever the lock; a present one only changed.
      if (names.raw != null && run.locked) {
        run.msg('WARN', sceneName(scene) + ' [' + scene.id + '] has ' +
          plural(added.length, 'file') + ' not archived yet, and is skipped: "' + field +
          '" is locked in ᝯㄝₓ Custom Fields Bulk Editor, so it cannot be added to.');
        return null;
      }
      return { scene: scene, value: archiveValue(scene, map), prev: names.raw, added: added };
    },
    tail: function (job) {
      return ': ' + job.added.map(function (n) { return '"' + n + '"'; }).join(', ') +
        (job.prev != null ? ' (added to the archive)' : '');
    },
    op: 'SFMArchive',
    // Undo takes the field off again, which a lock in Custom Fields Bulk Editor forbids.
    undoRemovesField: true,
    write: function (job, field) {
      var partial = {};
      partial[field] = job.value;
      return { field: 'sceneUpdate', type: 'SceneUpdateInput', sel: ' { id }',
        input: { id: job.scene.id, custom_fields: { partial: partial } } };
    },
    // The field was absent before the write, so taking it off is the exact inverse -
    // or it held fewer files, and they go back.
    undo: function (job, field) {
      if (job.prev != null) return ARCHIVE_TASK.write({ scene: job.scene, value: job.prev }, field);
      return { field: 'sceneUpdate', type: 'SceneUpdateInput', sel: ' { id }',
        input: { id: job.scene.id, custom_fields: { remove: [field] } } };
    },
  };

  var RESTORE_TASK = {
    name: 'Restore Original Filenames...',
    title: 'Restore Original Filenames',
    legend: 'One line per file named differently from what the field archived for it: ' +
      'its scene with the id in brackets, then the file’s name now and the name Proceed ' +
      'renames it to - the archived name with the file’s current extension, in the same ' +
      'folder.',
    verb: 'to rename',
    unit: 'file',
    plan: function (scene, field, run) {
      var names = archivedNames(scene, field);
      if (names.raw == null) return null;
      var files = filesOf(scene);
      if (!files.length) { run.noFile++; return null; }
      return files.map(function (f) {
        if (!hasOwn(names.map, f.id)) return null;
        var want = String(names.map[f.id]);
        if (want === stemOf(f.basename)) return null;
        var bad = badStem(want);
        if (bad) {
          run.msg('WARN', sceneName(scene) + ' [' + scene.id + '] is skipped: the archived ' +
            'name "' + want + '" cannot be a filename, because ' + bad + '.');
          return null;
        }
        return { scene: scene, file: f, folder: folderOf(f), from: f.basename,
          to: want + extOf(f.basename) };
      }).filter(function (j) { return j; });
    },
    tail: function (job) { return ': "' + job.from + '" → "' + job.to + '"'; },
    op: 'SFMRename',
    write: function (job) { return moveFile(job, job.to); },
    undo: function (job) { return moveFile(job, job.from); },
  };

  // ── Renaming from metadata ──────────────────────────────────────────────────
  //
  // The template is text with `{prefix|token|postfix}` groups: a group is written only
  // where its token has a value, so a separator never dangles beside a missing year or
  // director. `{prefix|!token|postfix}` is written only where the token has no value, and
  // writes no value of its own. A prefix or postfix may hold groups of its own, written
  // only when the group around them is. `{token}` is a group with nothing around it. Text
  // outside braces is always written; a stray `{`, `}` or `|` fails the template. A token
  // is read in lower case, so `|Title|` is `title`.
  var TOKENS = ['title', 'basetitle', 'variantpostfix', 'year', 'date', 'studio', 'code',
    'director', 'performers', 'performercount', 'filename', 'origfilename', 'ocount', 'stashid', 'organized',
    'fileresolution', 'filereslabel', 'fileduration'];

  // What each token gives, for the template editor's palette. The three that take an
  // argument are listed in the form the palette inserts.
  var TOKEN_HELP = {
    title: 'The scene’s title.',
    basetitle: 'The variant set’s base title from ᯯㄝₓ Scene Variants, else the title.',
    variantpostfix: 'The partial-duration postfix and index from ᯯㄝₓ Scene Variants, ' +
      'else nothing.',
    year: 'The year of the scene’s date.',
    date: 'The scene’s date, 2021-05-01.',
    studio: 'The studio’s name.',
    code: 'The studio code.',
    director: 'The director.',
    performers: 'The performers with the most scenes, then +N for the rest. Nothing at all ' +
      'where Max Performers In Filename is 0.',
    performercount: 'How many performers the scene has, whatever the filename names.',
    filename: 'The file’s name now, without its extension.',
    origfilename: 'The file’s archived original name, else its name now.',
    ocount: 'The O-count, when it is not 0.',
    stashid: 'The scene’s stash-id, else its Variant Stash ID from ᯯㄝₓ Scene ' +
      'Variants: stashdb.org:9f3c1e2a-…',
    organized: 'Present when the scene is organized: the prefix and postfix alone, or 1.',
    fileresolution: 'The file’s width x height, 1920x1080.',
    filereslabel: 'The file’s resolution as Stash shows it: 144p-, 144p … 8K, ' +
      'Huge, Huge+.',
    fileduration: 'The file’s duration, 01h02m03s.',
    'tag=': 'Present when the scene has the tag named after = (a name or an alias), or ' +
      'one of its children: the prefix and postfix alone, or 1.',
    rating5: 'The rating on a scale of 5 (any scale from 5 to 100), rounded up.',
    autoindex2: 'Given only when the name is already taken in the folder: the lowest free ' +
      'index from 2 (or the number written). Every file of a scene is renamed.',
  };

  // Given by Scene Variants' naming, and renamed so they say so. A saved template is
  // promoted once, when the plugin loads.
  var RENAMED_TOKENS = { base: 'basetitle', postfix: 'variantpostfix' };

  // What a token is, from its lower-case text: `{ kind, arg }`, `{ error }` for a known
  // form with a bad argument, or null for no token at all.
  function tokenSpec(tok) {
    if (TOKENS.indexOf(tok) !== -1) return { kind: tok };
    var m = /^tag=(.*)$/.exec(tok);
    if (m) return trim(m[1]) ? { kind: 'tag', arg: trim(m[1]) } : { error: 'it names no tag' };
    if ((m = /^rating(\d*)$/.exec(tok))) {
      var max = m[1] ? parseInt(m[1], 10) : 5;
      return max >= 5 && max <= 100 ? { kind: 'rating', arg: max }
        : { error: 'a rating’s scale is 5 to 100' };
    }
    if ((m = /^autoindex(\d*)$/.exec(tok))) {
      return { kind: 'autoindex', arg: m[1] ? parseInt(m[1], 10) : 2 };
    }
    return null;
  }

  // Tokens whose value is only "present": a group around one writes its prefix and
  // postfix alone, and a bare one writes 1.
  function isFlag(tok) { return tok === 'organized' || tok.indexOf('tag=') === 0; }

  // Parsed into text strings and {not, tok, pre, post, from, to} groups, pre and post
  // parsed alike; `from`/`to` are where the token's text sits in the template.
  function parseTemplate(tpl) {
    var s = String(tpl), i = 0;
    var fail = function (what, at) {
      var e = new Error('the rename template has ' + what + ' at character ' + (at + 1) + '.');
      e.at = at;
      throw e;
    };
    var node = function (m, start, pre, post) {
      var from = start + m[1].length;
      return { not: !!m[1], tok: trim(m[2]).toLowerCase(), from: from, to: from + m[2].length,
        pre: pre, post: post };
    };
    var seq = function (inGroup) {
      var out = [], text = '';
      while (i < s.length) {
        var c = s.charAt(i);
        if (c === '}' || c === '|') {
          if (!inGroup) fail(c === '}' ? 'a "}" with no "{"' : 'a "|" outside braces', i);
          break;
        }
        if (c === '{') {
          if (text) out.push(text);
          text = '';
          out.push(group());
        } else {
          text += c;
          i++;
        }
      }
      if (text) out.push(text);
      return out;
    };
    var group = function () {
      var at = i++, m;
      var pre = seq(true);
      if (s.charAt(i) === '}') {
        m = pre.length === 1 && typeof pre[0] === 'string' && /^(!?)([^{}|]+)$/.exec(pre[0]);
        if (!m) fail('a "{...}" that is neither a token nor a {prefix|token|postfix} group', at);
        i++;
        return node(m, at + 1, [], []);
      }
      if (s.charAt(i) !== '|') fail('a "{" that is never closed', at);
      m = /^(!?)([^{}|]+)\|/.exec(s.slice(i + 1));
      if (!m) fail('a "|" not followed by a token and a "|"', i);
      var start = i + 1;
      i += 1 + m[0].length;
      var post = seq(true);
      if (i === s.length) fail('a "{" that is never closed', at);
      if (s.charAt(i) !== '}') fail('a third "|" in one group', i);
      i++;
      return node(m, start, pre, post);
    };
    return seq(false);
  }

  function eachGroup(nodes, fn) {
    nodes.forEach(function (n) {
      if (typeof n === 'string') return;
      fn(n);
      eachGroup(n.pre, fn);
      eachGroup(n.post, fn);
    });
  }

  function templateTokens(nodes) {
    var out = [];
    eachGroup(nodes, function (n) { if (out.indexOf(n.tok) === -1) out.push(n.tok); });
    return out;
  }

  // The template with `base` and `postfix` spelled as their new names, or null when it
  // names neither - or does not parse, which is left for the user to see.
  function promoteTemplate(tpl) {
    var nodes;
    try { nodes = parseTemplate(tpl); } catch (e) { return null; }
    var hits = [], out = String(tpl);
    eachGroup(nodes, function (n) { if (hasOwn(RENAMED_TOKENS, n.tok)) hits.push(n); });
    if (!hits.length) return null;
    hits.sort(function (a, b) { return b.from - a.from; }).forEach(function (n) {
      out = out.slice(0, n.from) + RENAMED_TOKENS[n.tok] + out.slice(n.to);
    });
    return out;
  }

  // An index's group is fenced with two private-use characters, so `cleanReport` can cut
  // the name before it rather than the index.
  var INDEX_OPEN = '', INDEX_CLOSE = '';

  function renderTemplate(nodes, values) {
    return nodes.map(function (n) {
      if (typeof n === 'string') return n;
      var v = trim(values[n.tok]);
      if (n.not ? v : !v) return '';
      if (isFlag(n.tok) && (n.pre.length || n.post.length)) v = '';
      var out = renderTemplate(n.pre, values) + (n.not ? '' : v) + renderTemplate(n.post, values);
      return /^autoindex/.test(n.tok) && !n.not ? INDEX_OPEN + out + INDEX_CLOSE : out;
    }).join('');
  }

  // The `max` performers with the most scenes - ties by name - listed by scene count or
  // alphabetically, and "+N" for the ones left out.
  function namedPerformers(scene) {
    var byName = function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; };
    return (scene.performers || []).filter(function (p) { return trim(p.name); })
      .sort(function (a, b) { return (b.scene_count || 0) - (a.scene_count || 0) || byName(a, b); });
  }

  // None kept is no performers at all, not "+5": the count has `performercount` of its own.
  function performersText(scene, max, alphabetical) {
    if (max < 1) return '';
    var byName = function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; };
    var all = namedPerformers(scene);
    var kept = all.slice(0, max);
    if (alphabetical) kept.sort(byName);
    var names = kept.map(function (p) { return trim(p.name); });
    if (all.length > max) names.push('+' + (all.length - max));
    return names.join(', ');
  }

  // Stash's resolution names, by the shorter side: `pkg/models/resolution.go`.
  var RES_LABELS = [[144, '144p'], [240, '240p'], [360, '360p'], [480, '480p'], [540, '540p'],
    [720, '720p'], [1080, '1080p'], [1440, '1440p'], [1920, '4K'], [2560, '5K'], [3000, '6K'],
    [3584, '7K'], [3840, '8K'], [6144, 'Huge'], [10000, 'Huge+']];

  function resLabel(w, h) {
    var side = Math.min(w, h), out = '144p-';
    RES_LABELS.forEach(function (r) { if (side >= r[0]) out = r[1]; });
    return out;
  }

  function durationText(seconds) {
    var t = Math.round(seconds);
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return two(Math.floor(t / 3600)) + 'h' + two(Math.floor(t / 60) % 60) + 'm' + two(t % 60) + 's';
  }

  // What a filename may not hold on any system Stash runs on: `/` and `\` and control
  // characters are dropped, the rest become the look-alike a filename can hold. Spaces
  // are collapsed, and no trailing dot or space, which Windows drops. Capped in UTF-8
  // bytes, the unit filesystems count, leaving room for the extension.
  var ELLIPSIS = '\u2026';
  var LOOK_ALIKES = { ':': '∶', '*': '∗', '?': '？', '"': '＂', '<': '‹',
    '>': '›', '|': '∣' };

  function utf8Length(text) { return unescape(encodeURIComponent(text)).length; }

  // One character off the end, both halves of a surrogate pair together:
  // `encodeURIComponent` throws on half of one.
  function chop(text) { return text.slice(0, /[\uDC00-\uDFFF]$/.test(text) ? -2 : -1); }

  // The stem, and what was done to get it: `replaced` and `dropped` characters, and the
  // text `cut` to fit. The cut comes out of what precedes an index, never the index or
  // what follows it.
  // `room` is what the name may take before its extension: `bytes` in UTF-8, `units` in
  // UTF-16 (Infinity where no path limit applies).
  function cleanReport(text, room) {
    room = room || { bytes: NAME_BYTES_DEFAULT, units: Infinity };
    var fits = function (x) { return utf8Length(x) <= room.bytes && x.length <= room.units; };
    var r = { replaced: [], dropped: [], cut: '', by: '' };
    var note = function (list, c) { if (list.indexOf(c) === -1) list.push(c); };
    var v = String(text).replace(/[\/\\:*?"<>|\u0000-\u001f]/g, function (c) {
      if (hasOwn(LOOK_ALIKES, c)) { note(r.replaced, c); return LOOK_ALIKES[c]; }
      note(r.dropped, c);
      return '';
    }).replace(/\s+/g, ' ');
    v = trim(v).replace(/[. ]+$/, '');
    var at = v.indexOf(INDEX_OPEN), head = at === -1 ? v : v.slice(0, at);
    var keep = at === -1 ? '' : v.slice(at).split(INDEX_OPEN).join('').split(INDEX_CLOSE).join('');
    var whole = head;
    if (!fits(head + keep)) {
      r.by = utf8Length(head + keep) > room.bytes ? 'bytes' : 'path';
      // The ellipsis says a name was cut, and takes room of its own. Trailing dots and
      // spaces go before it, so a cut never reads "word . …".
      while (head && !fits(trim(head).replace(/[. ]+$/, '') + ELLIPSIS + keep)) head = chop(head);
      head = trim(head).replace(/[. ]+$/, '');
      // What was cut is read off the text before the ellipsis was added, and only here:
      // computed after the branch, a name that fits reported its own last character.
      r.cut = whole.slice(head.length);
      if (head) head += ELLIPSIS;
    }
    while (keep && !fits(keep)) keep = chop(keep);
    // What follows the index is kept as it is, bar the trailing dots and spaces every
    // name loses: only the text before the index is ever cut.
    r.stem = trim(head + keep).replace(/[. ]+$/, '');
    return r;
  }

  function cleanStem(text, room) { return cleanReport(text, room).stem; }

  // The room a file's new name has before its extension, under the run's limits.
  function roomFor(run, file) {
    var ext = extOf(file.basename), folder = (file.parent_folder && file.parent_folder.path) || '';
    return { bytes: run.maxNameBytes - utf8Length(ext),
      units: run.maxPath && folder ? run.maxPath - folder.length - 1 - ext.length : Infinity };
  }

  function filesOf(scene) {
    return (scene.files || []).filter(function (f) { return f && f.basename; });
  }

  function folderOf(f) { return f.parent_folder && f.parent_folder.id; }

  // Case-blind, because some filesystems are.
  function nameKey(folder, basename) { return folder + '/' + String(basename).toLowerCase(); }

  // Every token the template names, for one file of one scene.
  function valuesOf(scene, file, run, names) {
    var parts = (run.titleParts && run.titleParts[String(scene.id)]) || {};
    var date = trim(scene.date), w = +file.width || 0, h = +file.height || 0;
    var seconds = +file.duration || 0;
    var plain = {
      title: scene.title,
      basetitle: trim(parts.base) || scene.title,
      variantpostfix: parts.postfix || '',
      year: date.slice(0, 4),
      date: date,
      studio: scene.studio && scene.studio.name,
      code: scene.code,
      director: scene.director,
      performers: performersText(scene, run.maxPerformers, run.alphabetical),
      performercount: namedPerformers(scene).length || '',
      filename: stemOf(file.basename),
      origfilename: hasOwn(names.map, file.id) ? names.map[file.id] : stemOf(file.basename),
      ocount: scene.o_counter > 0 ? String(scene.o_counter) : '',
      stashid: run.stashIdsOf ? run.stashIdsOf(scene)[0] || '' : '',
      organized: scene.organized ? '1' : '',
      fileresolution: w && h ? w + 'x' + h : '',
      filereslabel: w && h ? resLabel(w, h) : '',
      fileduration: seconds > 0 ? durationText(seconds) : '',
    };
    var tags = {};
    (scene.tags || []).forEach(function (t) { tags[t.id] = true; });
    var out = {};
    run.used.forEach(function (tok) {
      var spec = run.specs[tok];
      if (spec.kind === 'tag') {
        out[tok] = run.tagSets[tok].some(function (id) { return hasOwn(tags, id); }) ? '1' : '';
      } else if (spec.kind === 'rating') {
        out[tok] = scene.rating100 == null ? '' : String(Math.ceil(scene.rating100 * spec.arg / 100));
      } else if (spec.kind === 'autoindex') out[tok] = '';
      else out[tok] = plain[tok];
    });
    return out;
  }

  // Who has a name in a folder, other than `file`: a file given it earlier in this plan,
  // else a file named so now.
  // ponytail: a name another file is being renamed away from still counts as taken, so a
  // reshuffle takes an index and settles on the next run; freeing it would make the
  // order of the moves matter.
  function holderOf(run, folder, basename, file) {
    var k = nameKey(folder, basename);
    var c = run.claimed[k];
    if (c && c.file.id !== file.id) return { scene: c.scene, planned: true };
    var e = run.existing[k];
    if (e && e.file.id !== file.id) return { scene: e.scene, planned: false };
    return null;
  }

  // The name the template gives a file: without an index first, then with the lowest
  // free one where the template has an index. `{ to }` or `{ why }`.
  function nameFor(scene, file, run, names) {
    var values = valuesOf(scene, file, run, names), ext = extOf(file.basename), last = null;
    var room = roomFor(run, file);
    if (room.units < 1) {
      return { why: 'its folder\'s path is already ' + file.parent_folder.path.length + ' characters, ' +
        'leaving no room for a name under the ' + run.maxPath + '-character path limit' };
    }
    for (var k = 0; ; k++) {
      run.autoTokens.forEach(function (t) { values[t] = k ? String(run.specs[t].arg + k - 1) : ''; });
      var stem = cleanStem(renderTemplate(run.nodes, values), room);
      if (!stem) return { why: 'the template gives it an empty name' };
      var to = stem + ext, holder = holderOf(run, folderOf(file), to, file);
      if (!holder) return { to: to };
      if (to === last) {
        return { why: '"' + to + '" is already ' + (holder.planned ? 'the new name of scene '
          : 'the name of a file of scene ') + holder.scene.id + ' in the same folder' };
      }
      last = to;
    }
  }

  // The field's value read as names by file id. A plain value is the primary file's
  // stem; a scene archived with more than one file holds a JSON object of them.
  function archivedNames(scene, field) {
    var cf = scene.custom_fields || {};
    var raw = hasOwn(cf, field) && cf[field] != null && trim(cf[field]) !== '' ? String(cf[field]) : null;
    var map = {}, parsed = null;
    if (raw == null) return { raw: null, map: map };
    if (/^\s*\{/.test(raw)) { try { parsed = JSON.parse(raw); } catch (e) { parsed = null; } }
    var ok = parsed && typeof parsed === 'object' && !(parsed instanceof Array) &&
      Object.keys(parsed).every(function (k) { return typeof parsed[k] === 'string'; });
    if (ok) return { raw: raw, map: parsed };
    var f = primaryFile(scene);
    if (f) map[f.id] = raw;
    return { raw: raw, map: map };
  }

  // `map` with every file of the scene that is missing from it, under its name now.
  function withEveryFile(scene, map) {
    var out = {};
    Object.keys(map).forEach(function (k) { out[k] = map[k]; });
    filesOf(scene).forEach(function (f) { if (!hasOwn(out, f.id)) out[f.id] = stemOf(f.basename); });
    return out;
  }

  // The primary file alone is stored plain, as it always was; more than one as JSON.
  function archiveValue(scene, map) {
    var keys = Object.keys(map), f = primaryFile(scene);
    return keys.length === 1 && f && keys[0] === String(f.id) ? map[keys[0]] : JSON.stringify(map);
  }

  function lockedFor(run) {
    return fieldLocks().then(function (locks) {
      run.locked = locks === false || !!(locks && locks.isLocked(run.field));
    });
  }

  var RENAME_TASK = {
    name: 'Rename Files From Metadata...',
    title: 'Rename Files From Metadata',
    legend: 'One line per file that would be named differently under the rename template: ' +
      'its scene with the id in brackets, then the file’s name now and the name Proceed ' +
      'gives it, keeping its extension and folder. Only the primary file is renamed, unless ' +
      'the template has an index. A file whose name is not archived yet has it archived ' +
      'first, so Restore Original Filenames can always put it back. Undo renames the files ' +
      'back; the archived names stay.',
    verb: 'to rename',
    unit: 'file',
    query: RENAME_QUERY,
    // The settings the plan reads; the tag trees the `tag=` tokens name; from ᝯㄝₓ
    // Scene Variants, the base title and postfix of every scene in a variant set and
    // each scene's stash-ids - its rules, asked rather than copied - and from ᝯㄝₓ
    // Custom Fields Bulk Editor, whether the field may be added to.
    prepare: function (run, s) {
      run.template = templateOf(s);
      run.maxPerformers = maxPerformers(s);
      run.alphabetical = String(s.b3PerformersAlphabetical) === 'true';
      run.maxNameBytes = maxNameBytes(s);
      run.maxPath = maxPathLength(s);
      run.claimed = {};
      run.existing = {};
      run.msg('INFO', 'Template: "' + run.template + '". ' + plural(run.maxPerformers, 'performer') +
        ' at most, listed ' + (run.alphabetical ? 'alphabetically' : 'by scene count') + '. Names ' +
        'at most ' + run.maxNameBytes + ' bytes with their extension' + (run.maxPath ? ', and full paths at ' +
        'most ' + run.maxPath + ' characters' : '') + '.');
      run.nodes = parseTemplate(run.template);
      run.used = templateTokens(run.nodes);
      run.specs = {};
      var bad = [];
      run.used.forEach(function (tok) {
        var spec = tokenSpec(tok);
        if (!spec) bad.push(tok);
        else if (spec.error) throw new Error('the rename template’s "' + tok + '" is not a token: ' + spec.error + '.');
        else run.specs[tok] = spec;
      });
      if (bad.length) {
        throw new Error('the rename template names ' + plural(bad.length, 'unknown token') + ': ' +
          bad.join(', ') + '. Known: ' + TOKENS.join(', ') + ', tag=<name>, rating<scale>, ' +
          'autoindex<start>.');
      }
      var uses = function (tok) { return run.used.indexOf(tok) !== -1; };
      run.autoTokens = run.used.filter(function (t) { return run.specs[t].kind === 'autoindex'; });
      if (run.autoTokens.length) {
        run.msg('INFO', 'The template has an index, so every file of a scene is renamed, and ' +
          'a name another file has, or is given first, takes the lowest free index.');
      }
      var api = coop().api && coop().api.SceneVariants;
      return Promise.all([
        lockedFor(run),
        tagSetsFor(run),
        uses('basetitle') || uses('variantpostfix') ? titlePartsFor(run, api) : null,
        uses('stashid') ? stashIdsFor(run, api) : null,
      ]);
    },
    // Every file's name first, so a name any file has now is known before the first is
    // given - and only the name: holding every full scene until the plan was the whole
    // library's metadata in memory at once.
    index: {
      label: 'Reading every file\u2019s name, then planning scene by scene.',
      query: FILES_QUERY,
      each: function (scene, run) {
        var who = { id: scene.id };
        filesOf(scene).forEach(function (f) {
          run.existing[nameKey(folderOf(f), f.basename)] = { scene: who, file: { id: f.id } };
        });
      },
    },
    plan: function (scene, field, run) {
      var files = filesOf(scene);
      if (!files.length) { run.noFile++; return null; }
      // What a job keeps of its scene: enough to name it in the log and to write it.
      var slim = { id: scene.id, title: sceneName(scene) };
      if (!run.autoTokens.length) files = files.slice(0, 1);
      var names = archivedNames(scene, field), archive = null, jobs = [];
      files.forEach(function (f) {
        var who = sceneName(scene) + ' [' + scene.id + ']' +
          (filesOf(scene).length > 1 ? ', file "' + f.basename + '",' : '');
        var got = nameFor(scene, f, run, names);
        if (got.why) { run.msg('WARN', who + ' is skipped: ' + got.why + '.'); return; }
        var job = { scene: slim, file: { id: f.id }, folder: folderOf(f), from: f.basename, to: got.to };
        if (got.to !== f.basename && !hasOwn(names.map, f.id)) {
          // A missing field may be added whatever the lock; a present one only changed.
          if (names.raw != null && run.locked) {
            run.msg('WARN', who + ' is skipped: its name is not archived, and "' + field +
              '" is locked in ᯯㄝₓ Custom Fields Bulk Editor, so it cannot be added.');
            return;
          }
          archive = archive || { scene: slim, value: archiveValue(scene, withEveryFile(scene, names.map)) };
          job.archive = archive;
        }
        run.claimed[nameKey(job.folder, got.to)] = { scene: slim, file: job.file };
        if (got.to !== f.basename) jobs.push(job);
      });
      return jobs;
    },
    tail: function (job) {
      return ': "' + job.from + '" → "' + job.to + '"' + (job.archive ? ' (archived first)' : '');
    },
    op: 'SFMRename',
    // Before the renames: the missing archives, one per scene, so no file is renamed
    // whose original name is not kept. A file whose archive fails is not renamed.
    before: function (job) { return job.archive || null; },
    write: function (job) { return moveFile(job, job.to); },
    undo: function (job) { return moveFile(job, job.from); },
  };

  function titlePartsFor(run, api) {
    if (!api || typeof api.titleParts !== 'function') {
      run.msg('INFO', 'ᯯㄝₓ Scene Variants is not installed, so a base title is the ' +
        'scene’s title and a variant postfix is empty.');
      return null;
    }
    run.progressEl.textContent = 'Asking ᯯㄝₓ Scene Variants for the variant sets…';
    return api.titleParts().then(function (parts) {
      run.titleParts = parts || {};
    }, function (e) {
      run.msg('WARN', 'ᯯㄝₓ Scene Variants could not read the variant sets (' +
        (e && e.message ? e.message : e) + '), so a base title is the scene’s title and ' +
        'a variant postfix is empty.');
    });
  }

  function stashIdsFor(run, api) {
    if (!api || typeof api.stashIds !== 'function') {
      run.msg('INFO', 'ᯯㄝₓ Scene Variants is not installed, or is older than the ' +
        'stashid token, so stashid is empty.');
      return null;
    }
    return api.stashIds().then(function (worker) {
      run.stashIdsOf = worker.of;
    }, function (e) {
      run.msg('WARN', 'ᯯㄝₓ Scene Variants could not read its settings (' +
        (e && e.message ? e.message : e) + '), so stashid is empty.');
    });
  }

  // Every tag and alias, lower-cased, to the tag; each tag's children by id.
  var TAGS_QUERY = 'query SFMTags { findTags(filter: { per_page: -1 }) ' +
    '{ tags { id name aliases children { id } } } }';

  function tagIndex() {
    return gqlRequest(TAGS_QUERY, null).then(function (data) {
      var byName = {}, byId = {};
      (((data || {}).findTags || {}).tags || []).forEach(function (t) {
        byId[t.id] = t;
        [t.name].concat(t.aliases || []).forEach(function (n) {
          if (trim(n)) byName[trim(n).toLowerCase()] = t;
        });
      });
      return { byName: byName, byId: byId };
    });
  }

  // A tag and every tag under it, by id.
  function tagTreeIds(index, tag) {
    var out = [], queue = [tag];
    while (queue.length) {
      var t = queue.shift();
      if (!t || out.indexOf(t.id) !== -1) continue;
      out.push(t.id);
      // A tag's GraphQL `children`, an Array - not a DOM collection.
      var kids = t.children || [];
      kids.forEach(function (c) { queue.push(index.byId[c.id]); });
    }
    return out;
  }

  function tagSetsFor(run) {
    run.tagSets = {};
    var toks = run.used.filter(function (t) { return run.specs[t].kind === 'tag'; });
    if (!toks.length) return null;
    return tagIndex().then(function (index) {
      var missing = [];
      toks.forEach(function (tok) {
        var tag = index.byName[run.specs[tok].arg];
        if (tag) run.tagSets[tok] = tagTreeIds(index, tag);
        else missing.push(run.specs[tok].arg);
      });
      if (missing.length) {
        throw new Error('the rename template names ' + plural(missing.length, 'tag') +
          ' with no tag or alias of that name: ' + missing.join(', ') + '.');
      }
    });
  }

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

  var TASKS = [ARCHIVE_TASK, RESTORE_TASK, RENAME_TASK];

  // ── Carrying archived names to the scene a file moves to ──────────────────
  //
  // Stash moves a file to another scene in two saves: Reassign on a scene's File Info
  // tab (`sceneAssignFile`, never the primary file) and Merge (`sceneMerge`), which
  // deletes the source scenes, custom fields and all. So the scenes the files leave are
  // read before the save goes through, the destination after it, and where a moved file
  // had an archived name the destination has not, a dialog offers to add it there.
  // Merge's own dialog may have copied a source's value into the destination, where a
  // plain stem would read as the destination's primary file: the value is rebuilt from
  // what the destination held before.
  var MOVE_SCENES_QUERY = 'query SFMMoveScenes($ids: [ID!]) { findScenes(ids: $ids, ' +
    'filter: { per_page: -1 }) { scenes { id title custom_fields files { id basename ' +
    'parent_folder { id } } } } }';
  var FILE_SCENES_QUERY = 'query SFMFileScenes($id: ID) { findFile(id: $id) { ... on VideoFile ' +
    '{ scenes { id title custom_fields files { id basename parent_folder { id } } } } } }';

  // The move a request makes, or null: `{ dest, sources }` for a merge, `{ dest, fileId }`
  // for a reassign.
  function fileMoveOf(init) {
    if (!init || typeof init.body !== 'string') return null;
    var body;
    try { body = JSON.parse(init.body); } catch (e) { return null; }
    var q = body && typeof body.query === 'string' ? body.query : '';
    var input = body && body.variables && body.variables.input;
    if (!input) return null;
    if (/\bsceneMerge\s*\(/.test(q) && input.destination != null) {
      return { dest: String(input.destination), sources: [].concat(input.source || []).map(String) };
    }
    if (/\bsceneAssignFile\s*\(/.test(q) && input.scene_id != null && input.file_id != null) {
      return { dest: String(input.scene_id), fileId: String(input.file_id) };
    }
    return null;
  }

  // The destination's value rebuilt from what it held before, plus the archived name of
  // every file it has now that a source scene had one for.
  function carried(move, scene, field) {
    var map = {}, added = [];
    var before = move.destBefore ? archivedNames(move.destBefore, field).map : {};
    Object.keys(before).forEach(function (k) { map[k] = before[k]; });
    filesOf(scene).forEach(function (f) {
      if (hasOwn(map, f.id)) return;
      move.sources.some(function (src) {
        var m = archivedNames(src, field).map;
        if (!hasOwn(m, f.id)) return false;
        map[f.id] = m[f.id];
        added.push(m[f.id]);
        return true;
      });
    });
    return { map: map, added: added };
  }

  function carryTask(move) {
    return {
      title: 'Carry Archived Filenames',
      legend: 'A file moved to this scene had its name archived on the scene it came from. ' +
        'The line names the scene the file is in now, with its id in brackets, then the ' +
        'archived names Proceed adds to its field, so Restore Original Filenames can still ' +
        'put them back.',
      verb: 'to carry over',
      op: 'SFMCarry',
      undoRemovesField: true,
      prepare: function (run) { return lockedFor(run); },
      read: function (run) {
        run.scanned = run.total = 1;
        run.planScene(move.destAfter);
        return Promise.resolve();
      },
      plan: function (scene, field, run) {
        var c = carried(move, scene, field), now = archivedNames(scene, field);
        if (!c.added.length) return null;
        var value = archiveValue(scene, c.map);
        if (value === now.raw) return null;
        if (now.raw != null && run.locked) {
          run.msg('WARN', sceneName(scene) + ' [' + scene.id + '] is not given the archived ' +
            plural(c.added.length, 'name') + ' of the files moved to it: "' + field + '" is ' +
            'locked in ᝯㄝₓ Custom Fields Bulk Editor, so it cannot be changed.');
          return null;
        }
        return { scene: scene, value: value, prev: now.raw, added: c.added };
      },
      tail: ARCHIVE_TASK.tail,
      write: ARCHIVE_TASK.write,
      undo: ARCHIVE_TASK.undo,
      closed: move.release,
    };
  }

  // Reads what the move is about to take away, lets the save through, then reads where
  // the files went. Any read that fails lets the save through untouched.
  function watchMove(orig, self, args, move) {
    var field;
    move.release = settle('scene', move.dest);
    var before = settingsReady().then(function (s) {
      field = fieldName(s);
      if (move.fileId) {
        return Promise.all([
          gqlRequest(FILE_SCENES_QUERY, { id: move.fileId }),
          gqlRequest(MOVE_SCENES_QUERY, { ids: [move.dest] }),
        ]).then(function (r) {
          move.sources = ((r[0].findFile || {}).scenes || []).filter(function (sc) {
            return String(sc.id) !== move.dest;
          });
          move.destBefore = ((r[1].findScenes || {}).scenes || [])[0] || null;
        });
      }
      return gqlRequest(MOVE_SCENES_QUERY, { ids: move.sources.concat([move.dest]) }).then(function (d) {
        var scenes = (d.findScenes || {}).scenes || [];
        move.destBefore = scenes.filter(function (sc) { return String(sc.id) === move.dest; })[0] || null;
        move.sources = scenes.filter(function (sc) { return String(sc.id) !== move.dest; });
      });
    });
    return before.then(function () {
      var resp = orig.apply(self, args);
      Promise.resolve(resp).then(function () {
        // What the save did is read back from the server, not out of its answer.
        return gqlRequest(MOVE_SCENES_QUERY, { ids: [move.dest] });
      }).then(function (d) {
        move.destAfter = ((d.findScenes || {}).scenes || [])[0];
        if (!move.destAfter || !carried(move, move.destAfter, field).added.length) return move.release();
        if (_active) {
          sfm('[sfm] A moved file\'s archived name was not carried to scene ' + move.dest +
            ': another ' + PLUGIN_SHORT_NAME + ' dialog is open.');
          return move.release();
        }
        startRun(carryTask(move));
      }).then(null, function () { move.release(); });
      return resp;
    }, function () {
      move.release();
      return orig.apply(self, args);
    });
  }

  // Installed once per page; a second evaluation of this script replaces the handler
  // rather than wrapping `fetch` again.
  function installMoveWatch() {
    var handle = coop().sfmMoveWatch = coop().sfmMoveWatch || {};
    handle.react = function (orig, self, args) {
      var move = /\/graphql([?#]|$)/.test(String(args[0])) ? fileMoveOf(args[1]) : null;
      if (!move || foreignLease()) return orig.apply(self, args);
      return watchMove(orig, self, args, move);
    };
    if (handle.installed || typeof window.fetch !== 'function') return;
    handle.installed = true;
    var orig = window.fetch;
    window.fetch = function () {
      try {
        return handle.react(orig, this, arguments);
      } catch (e) {
        return orig.apply(this, arguments);
      }
    };
  }

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
    this.logged = (this.logged || 0) + 1;
    this.logText.push(text);
    // Bounded, because the copy buffer is what a library-wide run grows without limit.
    this.logDropped = (this.logDropped || 0) + keepLog(this.logText);
    if (this.spinEl) this.logEl.insertBefore(line, this.spinEl);
    else this.logEl.appendChild(line);
    // `firstChild` is always a line: the spinner sits last.
    if ((this.logged || 0) > LOG_RENDER_CAP && this.logEl.firstChild) {
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
    parts.push(plural(this.jobs.length, this.task.unit || 'scene') + ' ' + this.task.verb);
    if (this.noFile) parts.push(plural(this.noFile, 'scene') + ' with no file, skipped');
    if (this.written) parts.push(this.written + ' written');
    if (this.failed) parts.push(plural(this.failed, 'failure'));
    if ((this.logged || 0) > LOG_RENDER_CAP) {
      parts.push('showing the last ' + LOG_RENDER_CAP + ' of ' + this.logged + ' lines');
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
          : 'Write the ' + plural(left, this.task.unit || 'scene') + ' listed.';
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
      return Promise.resolve(self.task.prepare ? self.task.prepare(self, s) : null);
    }).then(function () {
      if (self.stopped) return null;
      if (self.task.read) return self.task.read(self);
      var plan = function () {
        return self.scanPage(1, self.task.query || SCENE_QUERY, function (scene) { self.planScene(scene); });
      };
      if (!self.task.index) return plan();
      // A task that plans against the whole library reads what it needs of every scene
      // first, lightly, then plans page by page, keeping nothing of a page but its jobs.
      self.msg('INFO', self.task.index.label);
      return self.scanPage(1, self.task.index.query, function (scene) { self.task.index.each(scene, self); })
        .then(function () {
          if (self.stopped) return null;
          self.scanned = 0;
          return plan();
        });
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

  Run.prototype.scanPage = function (page, query, each) {
    var self = this;
    if (this.stopped) return Promise.resolve();
    return gqlRequest(query, { filter: { page: page, per_page: READ_PAGE, sort: 'id',
      direction: 'ASC' } }).then(function (data) {
      if (self.stopped) return null;
      var res = data.findScenes || {}, scenes = res.scenes || [];
      self.total = res.count || 0;
      scenes.forEach(function (scene) {
        self.scanned++;
        each(scene);
      });
      self.progress();
      if (scenes.length === READ_PAGE && self.scanned < self.total) return self.scanPage(page + 1, query, each);
      return null;
    });
  };

  // A task's plan for a scene is a job, a list of them, or nothing.
  Run.prototype.planScene = function (scene) {
    var self = this;
    [].concat(this.task.plan(scene, this.field, this) || []).forEach(function (job) {
      self.jobs.push(job);
      self.sceneLine('PLAN', job, self.task.tail(job));
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
    this.archiveFirst(jobs).then(function () {
      jobs = jobs.filter(function (j) { return !j.failed; });
      if (self.stopped) return null;
      return self.runJobs(jobs, task.op, PLUGIN_SHORT_NAME + ': ' + task.title,
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
        });
    }).then(function () {
      if (self.stopped) self.msg('WARN', 'Stopped. ' + plural(self.pending().length, self.task.unit || 'scene') +
        ' left unwritten.');
      self.setState('listing');
    });
  };

  // A task with a `before` step writes it for every job that needs one ahead of the
  // job's own write: Rename archives the names it is about to change. A job whose step
  // fails is failed, and its own write is never sent. Not undone: an archived name is
  // true whatever happens to the file.
  // Jobs of one scene share one step, written once.
  Run.prototype.archiveFirst = function (jobs) {
    var self = this, task = this.task, field = this.field;
    if (!task.before) return Promise.resolve();
    var need = [];
    jobs.forEach(function (j) {
      var step = task.before(j);
      if (step && !step.done && !step.queued) { step.queued = true; need.push(step); }
    });
    if (!need.length) return Promise.resolve();
    return this.runJobs(need, 'SFMArchive', PLUGIN_SHORT_NAME + ': ' + task.title,
      function (step) { return ARCHIVE_TASK.write(step, field); },
      function (step, err) {
        step.queued = false;
        if (err) step.error = err;
        else step.done = true;
      }).then(function () {
      jobs.forEach(function (j) {
        var step = task.before(j);
        if (!step || !step.error) return;
        j.failed = true;
        self.failed++;
        self.sceneLine('ERROR', j, ': the filename could not be archived, so the file ' +
          'is not renamed: ' + step.error);
      });
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
      if (self.stopped) self.msg('WARN', 'Stopped. ' + plural(self.changes.length, self.task.unit || 'scene') +
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
    copyToClipboard([this.progressEl.textContent, droppedLine(this.logDropped)].filter(Boolean)
      .concat(this.logText).join('\n'), function (ok) {
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
    if (this.task.closed) this.task.closed();
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

  // ── The template editor ───────────────────────────────────────────────────
  //
  // Stash's Edit on the Rename Template row opens this instead of its one-line box: the
  // template coloured as the parser reads it, every token a click away, and the name it
  // gives for test values - kept per token in this browser - with what a filename could
  // not hold. Save writes the setting; nothing else is written.
  var TEMPLATE_KEY = 'b1RenameTemplate';
  var RECENT_KEY = 'sfm-recent-values';
  var RECENT_KEPT_KEY = 'sfm-recent-kept';
  var RECENT_DEFAULT = 8;
  var RECENT_MAX = 50;

  var SAMPLE_VALUES = { title: 'Cleo Does Vegas with her Friends - Scene #3',
    basetitle: 'Cleo Does Vegas with her Friends - Scene #3', variantpostfix: ' - Promo 2',
    year: '2021', date: '2021-05-01', studio: 'BBC 4 Fun', code: 'X1007', director: 'Keen Key',
    performers: 'Ada, Bea, Cleo, +1', performercount: '4',
    filename: 'cleo, bea and ada first time with roko in sin city \uD83D\uDD1E',
    origfilename: 'cleo, bea and ada first time with roko in sin city \uD83D\uDD1E',
    ocount: '42', stashid: 'stashdb.org:9f3c1e2a-5b7d-4c1e-8a2f-0d6e3b9c4a71', organized: '1',
    fileresolution: '1920x1080', filereslabel: '1080p', fileduration: '00h21m07s' };

  // A test value never typed: the token's last one, else a sample. An index starts
  // missing, which is a name no other file has.
  function firstValue(tok) {
    var recent = recentValues()[tok];
    if (recent && recent.length) return { value: recent[0], missing: false };
    return sampleValue(tok);
  }

  // The value this token starts with when nothing has been typed for it.
  function sampleValue(tok) {
    var spec = tokenSpec(tok) || {};
    if (spec.kind === 'autoindex') return { value: String(spec.arg), missing: true };
    var v = spec.kind === 'tag' ? '1' : spec.kind === 'rating' ? String(Math.ceil(spec.arg * 0.8))
      : SAMPLE_VALUES[tok] || '';
    return { value: v, missing: false };
  }

  // Per browser, and a convenience: unreadable storage is an empty list.
  function recentValues() {
    try { return JSON.parse(window.localStorage.getItem(RECENT_KEY)) || {}; } catch (e) { return {}; }
  }

  // How many values each token keeps, 0 to RECENT_MAX; unset is RECENT_DEFAULT.
  function recentKept() {
    var n = NaN;
    try { n = parseInt(window.localStorage.getItem(RECENT_KEPT_KEY), 10); } catch (e) { /* default */ }
    return isNaN(n) ? RECENT_DEFAULT : Math.max(0, Math.min(RECENT_MAX, n));
  }

  // Zero keeps none, and throws away the ones already kept: that is how the lists are cleared.
  function setRecentKept(n) {
    try {
      window.localStorage.setItem(RECENT_KEPT_KEY, String(n));
      var all = recentValues();
      Object.keys(all).forEach(function (tok) {
        all[tok] = all[tok].slice(0, n);
        if (!all[tok].length) delete all[tok];
      });
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(all));
    } catch (e) { /* not kept, and nothing lost */ }
  }

  function rememberValue(tok, value) {
    var n = recentKept();
    if (!n) return;
    try {
      var all = recentValues();
      all[tok] = [value].concat((all[tok] || []).filter(function (v) { return v !== value; }))
        .slice(0, n);
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(all));
    } catch (e) { /* not kept, and nothing lost */ }
  }

  // Every character's colour class. Lenient where `parseTemplate` throws, so a half-typed
  // template is still coloured: braces pair by nesting, and a group's token is what sits
  // between its first two `|`, or the whole of a `{token}`.
  function templateColours(s, tagOk) {
    var cls = [], stack = [], i;
    for (i = 0; i < s.length; i++) cls.push('');
    var token = function (from, to) {
      var raw = s.slice(from, to), not = /^\s*!/.test(raw);
      var spec = tokenSpec(trim(raw.replace(/^\s*!/, '')).toLowerCase());
      var ok = spec && !spec.error && (spec.kind !== 'tag' || tagOk(spec.arg));
      for (var k = from; k < to; k++) cls[k] = !ok ? 'sfm-hl-bad' : not ? 'sfm-hl-not' : 'sfm-hl-tok';
    };
    var close = function (g) {
      if (g.pipes.length >= 2) token(g.pipes[0] + 1, g.pipes[1]);
      else if (!g.pipes.length && !g.inner && g.end != null) token(g.at + 1, g.end);
    };
    for (i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '{') {
        if (stack.length) stack[stack.length - 1].inner = true;
        stack.push({ at: i, pipes: [], inner: false });
      } else if (c === '|' && stack.length) stack[stack.length - 1].pipes.push(i);
      else if (c === '}' && stack.length) {
        var g = stack.pop();
        g.end = i;
        cls[g.at] = cls[i] = 'sfm-hl-pair';
        close(g);
      } else if (c === '}' || c === '|') cls[i] = 'sfm-hl-open';
    }
    stack.forEach(function (g) { cls[g.at] = 'sfm-hl-open'; close(g); });
    return cls;
  }

  // What the template is wrong about, beyond its shape: tokens that are none, bad
  // arguments, tag names no tag has.
  function templateProblems(nodes, tagOk) {
    var out = [];
    templateTokens(nodes).forEach(function (tok) {
      var spec = tokenSpec(tok);
      if (!spec) out.push('"' + tok + '" is not a token.');
      else if (spec.error) out.push('"' + tok + '" is not a token: ' + spec.error + '.');
      else if (spec.kind === 'tag' && !tagOk(spec.arg)) {
        out.push('"' + tok + '" names no tag or alias.');
      }
    });
    return out;
  }

  var _editor = null;

  function openEditor() {
    if (_editor || _active) return;
    _editor = { opening: true };
    settingsReady().then(function (s) {
      _editor = new TemplateEditor(templateOf(s), maxNameBytes(s));
    }, function () { _editor = null; });
  }

  function TemplateEditor(template, nameBytes) {
    this.nameBytes = nameBytes || NAME_BYTES_DEFAULT;
    var self = this;
    this.values = {};     // token → { value, missing }
    this.rows = {};       // token → its row of test inputs
    this.tags = undefined; // the tag index once read; null when it could not be
    injectStyle();
    this.backdrop = el('div', 'sfm-backdrop');
    this.modal = el('div', 'sfm-modal sfm-editor');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'sfm-head');
    head.appendChild(el('div', 'sfm-title', PLUGIN_SHORT_NAME + ' - Rename Template'));
    head.appendChild(el('div', 'sfm-legend', 'Green is a token, blue a !token, red a name ' +
      'that is not one; teal braces are paired, orange ones are not. A token below goes in ' +
      'at the cursor. The test values are kept per token in this browser; Missing gives a ' +
      'token no value.'));
    this.modal.appendChild(head);

    var body = el('div', 'sfm-edit-body');
    var wrap = el('div', 'sfm-tpl-wrap');
    this.mirror = el('div', 'sfm-tpl-mirror');
    this.input = el('textarea', 'sfm-tpl-input');
    this.input.spellcheck = false;
    this.input.value = template;
    this.input.addEventListener('input', function () { self.update(); });
    wrap.appendChild(this.mirror);
    wrap.appendChild(this.input);
    body.appendChild(wrap);
    this.errorEl = el('div', 'sfm-tpl-error sfm-hidden', '');
    body.appendChild(this.errorEl);

    var palette = el('div', 'sfm-palette');
    Object.keys(TOKEN_HELP).forEach(function (tok) {
      var b = button(tok, 'sfm-chip');
      paintButton(b, 'btn-info');
      b.title = TOKEN_HELP[tok];
      b.addEventListener('click', function () { self.insert(tok); });
      palette.appendChild(b);
    });
    body.appendChild(palette);

    var vhead = el('div', 'sfm-vhead sfm-vhead-row');
    vhead.appendChild(el('span', null, 'Test values'));
    var kept = el('label', 'sfm-kept');
    kept.appendChild(el('span', null, 'Recent values kept'));
    this.keptInput = el('input', 'sfm-num');
    this.keptInput.type = 'number';
    this.keptInput.min = '0';
    this.keptInput.max = String(RECENT_MAX);
    this.keptInput.value = String(recentKept());
    kept.title = this.keptInput.title = 'How many previous values each token offers back as ' +
      'you type, in this browser. Zero keeps none - and setting it to zero also throws away ' +
      'the ones already kept, which is how the lists are cleared.';
    this.keptInput.addEventListener('change', function () {
      var n = parseInt(trim(self.keptInput.value), 10);
      n = n > 0 ? Math.min(RECENT_MAX, n) : 0;
      self.keptInput.value = String(n);
      setRecentKept(n);
      Object.keys(self.rows).forEach(function (tok) { fillRecent(self.rows[tok], tok); });
    });
    kept.appendChild(this.keptInput);
    vhead.appendChild(kept);
    body.appendChild(vhead);
    this.valuesEl = el('div', 'sfm-values');
    body.appendChild(this.valuesEl);
    body.appendChild(el('div', 'sfm-vhead', 'Test output'));
    this.outEl = el('div', 'sfm-out', '');
    body.appendChild(this.outEl);
    this.warnEl = el('div', 'sfm-warn', '');
    body.appendChild(this.warnEl);
    this.modal.appendChild(body);

    var foot = el('div', 'sfm-foot');
    this.saveBtn = button('Save', 'sfm-save');
    paintButton(this.saveBtn, PLUGIN_BTN_VARIANT);
    this.defaultBtn = button('Default Template', 'sfm-default');
    this.defaultBtn.title = 'Put the default template in the box: ' + TEMPLATE_DEFAULT;
    this.valuesBtn = button('Default Test Values', 'sfm-defvalues');
    this.valuesBtn.title = 'Put the sample value back in every test box, whatever was typed ' +
      'or kept. The template is left alone.';
    this.closeBtn = button('Cancel', 'sfm-close');
    this.saveBtn.addEventListener('click', function () { self.save(); });
    this.defaultBtn.addEventListener('click', function () {
      self.input.value = TEMPLATE_DEFAULT;
      self.update();
    });
    this.valuesBtn.addEventListener('click', function () { self.resetValues(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });
    [this.saveBtn, this.defaultBtn, this.valuesBtn, this.closeBtn]
      .forEach(function (b) { foot.appendChild(b); });
    this.modal.appendChild(foot);

    wireEscape(this);
    document.body.appendChild(this.backdrop);
    this.update();
    tagIndex().then(function (index) { self.tags = index; }, function () { self.tags = null; })
      .then(function () { if (_editor === self) self.update(); });
  }

  // Until the tags are read, and where they cannot be, every tag name passes.
  // Every test value back to its sample, and the rows rebuilt around them.
  TemplateEditor.prototype.resetValues = function () {
    var self = this;
    Object.keys(this.values).forEach(function (tok) { self.values[tok] = sampleValue(tok); });
    this.rows = {};
    this.rowsKey = null;
    this.update();
  };

  TemplateEditor.prototype.tagOk = function (name) {
    return !this.tags || hasOwn(this.tags.byName, String(name).toLowerCase());
  };

  TemplateEditor.prototype.insert = function (tok) {
    var ta = this.input, v = ta.value;
    var at = typeof ta.selectionStart === 'number' ? ta.selectionStart : v.length;
    var end = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : at;
    var text = '{|' + tok + '|}';
    ta.value = v.slice(0, at) + text + v.slice(end);
    // After `tag=` the name is still to be typed, so the cursor waits there.
    var caret = at + text.length - (tok === 'tag=' ? 2 : 0);
    if (ta.setSelectionRange) ta.setSelectionRange(caret, caret);
    if (ta.focus) ta.focus();
    this.update();
  };

  TemplateEditor.prototype.update = function () {
    var self = this, s = this.input.value, nodes = null, err = null;
    var tagOk = function (n) { return self.tagOk(n); };
    try { nodes = parseTemplate(s); } catch (e) { err = e; }
    var cls = templateColours(s, tagOk);
    if (err && err.at != null && err.at < cls.length) cls[err.at] += ' sfm-hl-err';
    paintMirror(this.mirror, s, cls);
    var problems = err ? [err.message.replace(/^the rename template has/, 'The template has')]
      : templateProblems(nodes, tagOk);
    if (!trim(s)) problems = ['An empty template means the default.'];
    this.errorEl.textContent = problems.join(' ');
    Run.prototype.show(this.errorEl, problems.length > 0);
    this.syncRows(nodes ? templateTokens(nodes) : []);
    this.test(nodes && !problems.length ? nodes : null);
    this.saveBtn.disabled = !!err || (problems.length > 0 && !!trim(s));
    this.saveBtn.title = this.saveBtn.disabled ? 'Correct the template first.'
      : 'Save the template as the Rename Template setting.';
  };

  // One row per token the template names, in its order; a row's values outlive it, so
  // deleting a token and typing it back keeps what was set.
  // Rebuilt only when the list of tokens changes: a box taken out and put back loses
  // the focus, and the recent-values list with it, on every character typed.
  TemplateEditor.prototype.syncRows = function (toks) {
    var self = this;
    toks = toks.filter(function (tok) { return tokenSpec(tok) && !tokenSpec(tok).error; });
    var key = toks.join('|');
    if (key === this.rowsKey) {
      toks.forEach(function (tok) { self.paintRow(tok); });
      return;
    }
    this.rowsKey = key;
    while (this.valuesEl.firstChild) this.valuesEl.removeChild(this.valuesEl.firstChild);
    toks.forEach(function (tok, n) {
      if (!hasOwn(self.values, tok)) self.values[tok] = firstValue(tok);
      var state = self.values[tok];
      var row = self.rows[tok];
      if (!row) {
        row = self.rows[tok] = { label: el('code', 'sfm-val-name', tok) };
        row.input = el('input', 'sfm-val');
        row.input.type = 'text';
        row.input.value = state.value;
        row.list = el('datalist');
        row.list.id = 'sfm-recent-' + n + '-' + Date.now();
        row.input.setAttribute('list', row.list.id);
        row.input.addEventListener('input', function () { state.value = row.input.value; self.update(); });
        row.input.addEventListener('change', function () {
          rememberValue(tok, row.input.value);
          fillRecent(row, tok);
        });
        row.box = el('label', 'sfm-val-missing');
        row.check = el('input');
        row.check.type = 'checkbox';
        row.check.checked = state.missing;
        row.check.addEventListener('change', function () { state.missing = !!row.check.checked; self.update(); });
        row.box.appendChild(row.check);
        row.box.appendChild(el('span', null, ' Missing'));
        fillRecent(row, tok);
      }
      self.paintRow(tok);
      [row.label, row.input, row.list, row.box].forEach(function (x) { self.valuesEl.appendChild(x); });
    });
  };

  // Green where the token has a value in the test, red where it has none.
  TemplateEditor.prototype.paintRow = function (tok) {
    var row = this.rows[tok], state = this.values[tok];
    var missing = state.missing || !trim(state.value);
    row.input.disabled = state.missing;
    row.label.className = 'sfm-val-name ' + (missing ? 'sfm-val-off' : 'sfm-val-on');
  };

  function fillRecent(row, tok) {
    while (row.list.firstChild) row.list.removeChild(row.list.firstChild);
    (recentValues()[tok] || []).forEach(function (v) {
      var o = el('option');
      o.value = v;
      row.list.appendChild(o);
    });
  }

  TemplateEditor.prototype.test = function (nodes) {
    var self = this;
    while (this.warnEl.firstChild) this.warnEl.removeChild(this.warnEl.firstChild);
    if (!nodes) { this.outEl.textContent = '-'; return; }
    var values = {};
    templateTokens(nodes).forEach(function (tok) {
      var st = self.values[tok];
      values[tok] = !st || st.missing ? '' : st.value;
    });
    var r = cleanReport(renderTemplate(nodes, values), { bytes: this.nameBytes - 4, units: Infinity });
    this.outEl.textContent = r.stem ? r.stem + '.mp4' : '(no name)';
    var warn = [];
    var quote = function (list) { return list.map(function (c) { return '"' + c + '"'; }).join(' '); };
    if (r.replaced.length) {
      warn.push('A filename cannot hold ' + quote(r.replaced) + ', so each becomes its look-alike.');
    }
    if (r.dropped.length) {
      warn.push(quote(r.dropped.map(function (c) { return c < ' ' ? 'control character' : c; })) +
        ' cannot be in a filename and ' + (r.dropped.length > 1 ? 'are' : 'is') + ' dropped.');
    }
    if (r.cut) {
      // What it would have been, not what it is: the name on screen is the cut one, and
      // "the name is over 200 bytes" read as a claim about that.
      warn.push('The name would be ' + (utf8Length(r.stem) + utf8Length(r.cut) + 4) + ' bytes with ' +
        'its extension, over ' + this.nameBytes + ', so "' + r.cut + '" is cut and \u2026 put in its place.');
    }
    if (!r.stem) warn.push('The name is empty, so a scene given it is skipped.');
    warn.forEach(function (w) { self.warnEl.appendChild(el('div', null, w)); });
  };

  // `configurePlugin` replaces the whole map, so it is read fresh and sent whole.
  TemplateEditor.prototype.save = function () {
    var self = this, template = this.input.value;
    if (this.saveBtn.disabled) return;
    this.saveBtn.disabled = true;
    gqlRequest('query SFMSettings { configuration { plugins } }', null).then(function (data) {
      var raw = ((data.configuration || {}).plugins || {})[PLUGIN_ID] || {}, input = {};
      for (var k in raw) if (hasOwn(raw, k)) input[k] = raw[k];
      input[TEMPLATE_KEY] = template;
      return gqlRequest('mutation SFMSaveTemplate($id: ID!, $input: Map!) ' +
        '{ configurePlugin(plugin_id: $id, input: $input) }', { id: PLUGIN_ID, input: input });
    }).then(function () {
      _settingsAt = 0;
      refreshConfiguration();
      Object.keys(self.rows).forEach(function (tok) {
        if (!self.values[tok].missing) rememberValue(tok, self.values[tok].value);
      });
      self.close();
    }, function (e) {
      self.errorEl.textContent = 'The template could not be saved: ' + (e && e.message ? e.message : e);
      Run.prototype.show(self.errorEl, true);
      self.saveBtn.disabled = false;
    });
  };

  TemplateEditor.prototype.close = function () {
    unwireEscape(this);
    if (this.backdrop.parentNode) this.backdrop.parentNode.removeChild(this.backdrop);
    _editor = null;
  };

  function paintMirror(mirror, s, cls) {
    while (mirror.firstChild) mirror.removeChild(mirror.firstChild);
    for (var i = 0; i < s.length;) {
      var j = i + 1;
      while (j < s.length && cls[j] === cls[i]) j++;
      mirror.appendChild(el('span', cls[i] || null, s.slice(i, j)));
      i = j;
    }
    // A last empty line still has its height, as it does in the box on top.
    mirror.appendChild(el('span', null, '\n'));
  }

  // The Edit button on the Rename Template row, found by the row's own id.
  function templateEditButton(btn) {
    var row = coreSettingRow(PLUGIN_ID, TEMPLATE_KEY);
    for (var node = btn, d = 0; row && node && d < 8; d++, node = node.parentElement) {
      if (node === row) return true;
    }
    return false;
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
      if (btn && templateEditButton(btn)) {
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        openEditor();
        return;
      }
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

  coop().respecters[PLUGIN_ID] = true;
  installMoveWatch();
  if (window.addEventListener) window.addEventListener('load', tick);
  setInterval(tick, 1000);
  // After the first settings read, so the configured name is the one described - and
  // late enough that CustomFieldsBulkEditor, loaded after this script, has published.
  settingsReady().then(function () { setTimeout(describeField, 0); }, function () {});
  tick();
}());
