// Scene Variants
//
// Requires Stash 0.28.0 or newer: the scene page's `ScenePage.Tabs` and
// `ScenePage.TabContent` patch points are what this plugin is built on.
//
// A scene is often in the library twice: the whole thing, and a cut out of it. Stash
// has no first-class relation for "these two files are the same work", so the Variants
// tab this plugin adds to the scene page is that relation, derived rather than stored:
// the scenes sharing this one's stash-id, with whichever of them is the full-duration one
// named as such.
//
// **One word for one idea: variant.** The plan this came from says "sibling set" for the
// relation and "variant" for a member of it, which is a distinction that reads as one in
// prose and as two synonyms in a UI. The plugin is called Scene Variants and the id is the
// contract, so `variant` is the word that survives everywhere - tab, copy, log, CSS.
//
// **The tab itself never writes.** It reads two queries - the variants and the tag tree
// they are classified against - and draws a list of links. What writes is a dialog with
// the whole plan listed first, reached five ways: the three tasks in Settings - Tasks
// (the stash-id migration, the flag and the library-wide review), the tab's own
// Synchronize Variants button, and the offer that follows a save in the scene's edit
// form. Every write takes a lease and is undoable while its dialog stays open.
//
// The rules this file follows are in AGENTS.md next to it; the reasoning behind the
// parts that look arbitrary is in NOTES.md.
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
  if (!C) {
    // Nothing else in this file can run, and there is no shared code left to say so
    // with - so this is the one message this plugin prints on its own.
    if (window.console && console.error) {
      console.error('[svr] ᝯㄝₓ Core is not installed or is disabled, so '
        + 'this plugin cannot start. Install it from the same source and reload the page.');
    }
    return;
  }
  var showDefaults = C.showDefaults, coop = C.coop, fieldLocks = C.fieldLocks, settled = C.settled, plural = C.plural, linkTarget = C.linkTarget,
    copyToClipboard = C.copyToClipboard, keepLog = C.keepLog, droppedLine = C.droppedLine, holdWidth = C.holdWidth, tipRatingBadge = C.tipRatingBadge,
    tipPlace = C.tipPlace, tagTip = C.tagTip, tagLinkTitle = C.tagLinkTitle,
    entityTip = C.entityTip, entityTipName = C.entityTipName, cfTipTick = C.cfTipTick, cfTipMark = C.cfTipMark,
    ensureReloadUiButton = C.ensureReloadUiButton, staleReloadButton = C.staleReloadButton,
    hasOwn = C.hasOwn, el = C.el, hasClass = C.hasClass, byClass = C.byClass,
    coreSettingElement = C.settingElement, coreSettingRow = C.settingRow;

  var PLUGIN_ID   = 'SceneVariants';
  var PLUGIN_NAME = 'ᝯㄝₓ Scene Variants';
  // The name a head wears. `PLUGIN_NAME` is the manifest's and has to stay
  // byte-identical to the `.yml`, because `ownSettingGroup`'s fallback and
  // `headingIsOurs` find this plugin's block on the settings page by matching that
  // heading. This one is free to be short; here it already fits.
  var PLUGIN_SHORT_NAME = 'ᝯㄝₓ Scene Variants';

  // The one version that proves anything. The settings page reads the manifest over
  // GraphQL and goes current the moment plugins are reloaded, while the browser can
  // still be running a script it cached before the edit - so a heading reading one
  // version over the previous one's behaviour is the normal look of a stale script,
  // not a contradiction.
  //
  // The number the .yml and the manifest carry; a dialog compares it with what Stash
  // reports installed and refuses to write from a script that is not the one installed.
  var PLUGIN_VERSION = '2.0.3';

  // Printed before anything else runs, so a script that loads and then throws is told
  // apart from one that never loaded at all. Through whatever the console offers rather
  // than console.info directly: this is the first statement in the file.
  function svr(message) {
    if (typeof console !== 'undefined' && (console.info || console.log)) {
      (console.info || console.log).call(console, message);
    }
  }

  svr('[svr] SceneVariants.js ' + PLUGIN_VERSION + ' loaded. This is the running ' +
    'script\'s own version - the settings page reads the manifest instead, which can be ' +
    'newer than the script your browser has cached.');

  var README_URL = 'https://github.com/gregttx/GTTxStashPluginsRelease/blob/main/SceneVariants/README.md';
  var README_LINK_ID = 'svr-readme-link';
  var DESC_TOGGLE_ID = 'svr-desc-toggle';
  var STYLE_ID       = 'svr-style';

  // The tab's own key, in the namespace Stash's own nine sit in - `scene-details-panel`,
  // `scene-edit-panel` and the rest. `svr` in the middle of it because the key is a
  // string in a space Stash owns and any plugin can write into: it is not a class we
  // prefix by convention, it is the value `activeTabKey` holds while our tab is open.
  var TAB_KEY = 'scene-svr-variants-panel';
  var TAB_LABEL = 'Variants';
  // The tab this one goes in front of. Edit is last in Stash's strip and is the one tab
  // that is an action rather than a view, so it wants to stay at the end.
  var BEFORE_TAB_KEY = 'scene-edit-panel';

  var SETTINGS_TTL_MS = 10000;   // settings are re-read at most this often

  // The migration task writes, so it takes a lease for the duration - see the repo-root
  // AGENTS.md. Sized to the work: a library-wide pass over every tagged scene is minutes,
  // and the lease is renewed per batch rather than taken once for all of it.
  var LEASE_TTL_MS = 120000;
  var READ_PAGE  = 500;          // scenes per scan query
  var WRITE_CHUNK = 10;          // scenes written in parallel
  var LOG_RENDER_CAP = 1000;     // log lines kept in the DOM; all of them stay in memory

  // Stash's own button variant for a control that writes, and the one every plugin here
  // paints its task button with.
  var PLUGIN_BTN_VARIANT = 'btn-warning';


  function trim(text) {
    return String(text == null ? '' : text).replace(/^\s+|\s+$/g, '');
  }


  function oneLine(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').replace(/^ | $/g, '');
  }

  // What a listing calls a scene: its title, else its file's name the way Stash's own
  // lists do - a long one cut to the start of its stem and its extension - else its
  // id. Only a query that asks for `files { basename }` can answer with the file.
  var STEM_MAX = 32;
  function sceneName(sc) {
    var name = entityTipName(sc);
    if (!name) return 'Scene ' + sc.id;
    if (sc.title || name.length <= STEM_MAX + 8) return name;
    var dot = name.lastIndexOf('.');
    var ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot + 1) : '';
    return (ext ? name.slice(0, dot) : name).slice(0, STEM_MAX) + '...' + ext;
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  //
  // A key is the storage key: renaming one silently resets it for every install and
  // strands the old value in the config.
  //
  // The two tag names are the user's, not this plugin's, and they are deliberately
  // empty by default. A library that has not adopted the convention still gets the
  // tab - the variants are found from the stash-id, which owes nothing to a tag -
  // and every row simply reads as unclassified. Inventing a default like "Full Duration"
  // would name a tag most libraries do not have and then quietly classify nothing,
  // which looks exactly like a broken plugin.
  var DEFAULTS = {
    a1FullLengthTag: '',
    a2PartialLengthTag: '',
    a3VariantStashIdField: '',
    a4VariantFlagTag: '',
    b1LogToConsole: false,
    c1PropagateOnSave: false,
    c3SkipRedundantTags: false,
    c4CheckCoverMismatch: false,
    // `c5` was `c2` before it moved beside the title settings; the old key is read where the new one is unanswered.
    c5PropagateTitleOnSave: false,
    e1PartialPostfix: '',
    e2FirstIndex: '',
    e3BaseNameField: '',
    e4NoRenameField: '',
    e5NoRenameTag: '',
    e2bIndexLonePartial: false,
    e2cRenumberByDuration: false,
    // The set-review weights. Dialog-only - they are edited in the review dialog's own
    // strip, and a `.yml` row would be a second editor for one value. Absent means
    // "not remembered", which is why they are read as numbers-or-null rather than
    // through the boolean/string coercion above.
    d1WeightAttribute: null,
    d2WeightTag: null,
    d3WeightPerformer: null,
    d4WeightGroup: null,
    d5WeightCover: null,
    d6WeightTitle: null,
    // The review's Exclude Organized box, kept with the weights under Remember.
    d7ExcludeOrganized: false,
  };

  // What an unremembered dialog starts with: an attribute difference is worth five of
  // a missing tag, which is the ratio the feature was asked for.
  // Title is priced on its own and cheaply: variants are *named* apart on purpose, so
  // a title difference is the one that says least about whether a set has drifted -
  // but it is not nothing, and pricing it at zero would be this plugin deciding that
  // rather than the user. One point, where an attribute is five.
  var WEIGHT_DEFAULTS = { title: 1, cover: 5, attr: 5, tag: 1, performer: 1, group: 1 };
  var WEIGHT_KEYS = { attr: 'd1WeightAttribute', tag: 'd2WeightTag',
    performer: 'd3WeightPerformer', group: 'd4WeightGroup', cover: 'd5WeightCover',
    title: 'd6WeightTitle' };
  var WEIGHT_MAX = 100;

  // ── The variant stash-id custom field ─────────────────────────────────────
  //
  // A stash-id is meant to name the *work*, and a stash-box has one entry for the full
  // scene - so a partial-duration cut carrying the same stash-id is claiming to be the
  // thing it was cut out of. The migration task moves that claim into a custom field of
  // this plugin's own and takes the stash-id off, which leaves the identity where the
  // variant lookup can still read it and out of everywhere Stash treats a stash-id as an
  // assertion about the file: scraping, Submit to Stash-box, and duplicate detection.
  //
  // Prefixed like every other name this repo writes into a namespace it shares with the
  // user - a custom field key is flat and unowned, exactly like the description store's
  // marker field. Stash has no default for a plugin setting, so an empty box means this.
  var FIELD_DEFAULT = 'ᱜ╦╦🞮_Variant_Stash_ID';

  function fieldName(s) {
    return trim((s || settings()).a3VariantStashIdField) || FIELD_DEFAULT;
  }

  // The tag the flag task keeps in step with the library: on every scene that shares a
  // variant stash-id line with at least one other scene, and off everything else. A tag
  // rather than a second custom field because the whole point is Stash's own tag filter -
  // one click on the tag's page lists every scene offering a choice of variants. Prefixed
  // like the field above and for the same reason: a tag name is flat and unowned. The tag
  // is machine-kept and not a source of truth - it says what the last run of the task
  // found, nothing fresher.
  var FLAG_DEFAULT = 'ᱜ╦╦🞮⸎✱MultiVariants✅∙';

  // Rename Variants: what a partial-duration scene is called after its set. The postfix
  // carries its own separator; the first index's spelling is the counting rule (see
  // `indexAlphabet`); the two fields are a remembered base name for a set and a mark
  // that keeps a scene out of the renaming.
  // The postfix ends in the space the index follows: nothing is put between them, so
  // " - cut #" with a first index of "00" reads " - cut #00". An empty first index means
  // no index at all - the postfix alone, however many partials a set has; a set's only
  // partial wears the postfix alone too unless `e2bIndexLonePartial` gives it the first; an empty
  // postfix means none - the index straight after the base, or the base alone. Both
  // are seeded, so the boxes show them, and an emptied box is an answer.
  var POSTFIX_DEFAULT = ' - Promo ';
  var FIRST_INDEX_DEFAULT = '1';
  var BASE_FIELD_DEFAULT = 'ᱜ╦╦🞮_Variant_Base_Name';
  var SKIP_FIELD_DEFAULT = 'ᱜ╦╦🞮_Do_Not_Auto_Rename';
  function naming(s) {
    return {
      postfix: s.e1PartialPostfix,
      first: trim(s.e2FirstIndex),
      baseField: trim(s.e3BaseNameField) || BASE_FIELD_DEFAULT,
      skipField: trim(s.e4NoRenameField) || SKIP_FIELD_DEFAULT,
      skipTag: trim(s.e5NoRenameTag),
      loneIndex: !!s.e2bIndexLonePartial,
      renumber: !!s.e2cRenumberByDuration,
    };
  }
  // The names this shipped under before, only ever written by the seed - treated as
  // unanswered so a rename reaches a box nobody chose deliberately, the same trade
  // CustomFieldsBulkEditor's legacy hide-field name makes.
  var LEGACY_FLAG_DEFAULTS = ['ᱜ╦╦🞮_Multiple_Variants', 'ᱜ╦╦🞮⸎✱MultiVariants❌∙'];
  function isLegacyFlag(v) { return LEGACY_FLAG_DEFAULTS.indexOf(v) !== -1; }

  function flagTagName(s) {
    var v = trim((s || settings()).a4VariantFlagTag);
    return !v || isLegacyFlag(v) ? FLAG_DEFAULT : v;
  }

  // `stashdb.org:9f3c1e2a-...`: the provider, then the id. The endpoint is a GraphQL URL
  // and its host is the half a reader recognises - keeping the whole of it would put an
  // `https://` and a `/graphql` in front of every value in Stash's own custom-field
  // panel, which is where this is read by eye.
  function hostOf(endpoint) {
    var t = trim(endpoint).replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    return t.split('/')[0] || t;
  }

  function variantValue(entry) {
    var id = trim(entry && entry.stash_id);
    if (!id) return '';
    var host = hostOf(entry && entry.endpoint);
    return host ? host + ':' + id : id;
  }

  // One line per stash-id, in the order the scene carries them. A scene with ids from two
  // providers is one work with two names for it, and both belong in the field; a value
  // holding one line is the ordinary case and the one the filter matches on exactly.
  function variantValues(stashIds) {
    var out = [], seen = {};
    (stashIds || []).forEach(function (e) {
      var v = variantValue(e);
      if (v && !hasOwn(seen, v)) { seen[v] = true; out.push(v); }
    });
    return out;
  }

  // A variant stash-id for a set no stash-box knows about: `pseudo` where a real line
  // carries the provider's host, so a reader of Stash's custom-field panel can tell at
  // a glance that nothing upstream was consulted. Written identically into every scene
  // of the set the user grouped by hand, it is a line like any other from there on -
  // the tab's lookup, the flag task's matching and the field regex all read it with no
  // special case.
  function pseudoStashId() {
    var hex = '', bytes = null, i, b;
    var c = window.crypto || window.msCrypto;
    if (c && c.getRandomValues && typeof Uint8Array !== 'undefined') {
      bytes = new Uint8Array(16);
      c.getRandomValues(bytes);
    }
    for (i = 0; i < 16; i++) {
      b = bytes ? bytes[i] : Math.floor(Math.random() * 256);
      hex += (b < 16 ? '0' : '') + b.toString(16);
    }
    return 'pseudo:' + hex;
  }

  function splitValues(raw) {
    if (raw == null) return [];
    return String(raw).split('\n').map(trim).filter(function (v) { return !!v; });
  }

  // A field line back into the page it names: `stashdb.org:9f3c…` is this work's entry
  // at that stash-box, and a stashdb-style box serves it at `/scenes/<id>`. A line whose
  // head is not a host - `pseudo:`, or a bare id - names nothing upstream and gets no
  // link.
  function boxLink(v) {
    var i = String(v).indexOf(':');
    if (i < 1) return null;
    var host = v.slice(0, i), id = v.slice(i + 1);
    if (!id || host.indexOf('.') === -1) return null;
    return { value: v, url: 'https://' + host + '/scenes/' + id };
  }

  // The field lookup, as one regex: any of these values as a whole line of the stored
  // string. EQUALS compared the whole value, so two migrated partials whose id sets
  // overlap without being equal never found each other - a value holding two lines is
  // not equal to either of them. One regex rather than one value per line because the
  // criterion ANDs its values under every modifier (read off custom_fields.go): the OR
  // has to be inside a single pattern, and the line anchors are what keep one id from
  // matching inside a longer one.
  function fieldRegex(values) {
    return '(^|\n)(' + values.map(function (v) {
      return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|') + ')(\n|$)';
  }

  function customField(scene, field) {
    var cf = scene && scene.custom_fields;
    return cf && typeof cf === 'object' && hasOwn(cf, field) ? cf[field] : null;
  }

  // Compared case-insensitively and with the surrounding space trimmed, because these
  // are typed into a settings box by hand rather than picked from a list.
  function tagKey(name) {
    return String(name == null ? '' : name).replace(/^\s+|\s+$/g, '').toLowerCase();
  }


  // **Three of the shared mechanisms are correctly left alone, and each absence is a
  // rule rather than an omission:**
  //
  //   no `declares`      - the registry is for two plugins performing the *identical*
  //                        relationship copy, keyed by a path id. Nothing here copies a
  //                        relationship, so any path id would be a lie.
  //   no `order`         - the ordering protocol is for buttons sharing one of Stash's
  //                        own action rows. This plugin's only button is the one Stash
  //                        renders for its task.
  //   no `domBus`        - the shared MutationObserver is for a control that has to be
  //                        put back into Stash's DOM after every re-render. This plugin
  //                        hands React a component and React renders it, so there is
  //                        nothing to reconcile and nothing to watch for. The settings
  //                        page is decoration, which the one-second timer covers - the
  //                        same position `NormalizeParentTags` is in.
  //
  // The two it does take: the tasks and the propagate dialog rewrite many scenes on
  // purpose, which is exactly what a **lease** announces; and `respecters`, since the
  // save watch made the plugin reactive - it answers a scene save with a dialog, and a
  // library-wide bulk edit must not raise one per scene, so the watch samples the
  // lease *before* the save goes through and stands down while one is held. It reads
  // `debugButtons` too - the tab is a control drawn into Stash's chrome and "why is it
  // not there" is the same question that flag answers for every sibling.

  // A bulk run announces itself for the duration of its writes, so a reactive plugin in
  // the same tab stands down rather than reacting to every entity we touch. Advisory,
  // always expiring, per tab - see the repo-root AGENTS.md.
  function acquireLease(label, ttl) {
    var c = coop();
    var ms = ttl || LEASE_TTL_MS;
    var lease = { owner: PLUGIN_ID, label: label, until: Date.now() + ms };
    c.leases.push(lease);
    return {
      renew: function () { lease.until = Date.now() + ms; },
      release: function () {
        var i = c.leases.indexOf(lease);
        if (i !== -1) c.leases.splice(i, 1);
      },
    };
  }

  // Someone else's lease, still live. Expired ones are dropped on the way past: a tab
  // that crashed mid-run must not disable this plugin until the next reload.
  function foreignLease() {
    var c = coop();
    var now = Date.now();
    for (var i = c.leases.length - 1; i >= 0; i--) {
      if (c.leases[i].until <= now) c.leases.splice(i, 1);
    }
    for (var j = 0; j < c.leases.length; j++) {
      if (c.leases[j].owner !== PLUGIN_ID) return c.leases[j];
    }
    return null;
  }

  // ── Tab gating diagnostics ───────────────────────────────────────────────
  //
  // Off unless `__GTTx__.StashPluginCoop.debugButtons = true`, which is typed into the
  // browser console: no setting, no reload, no file edit, and the flag is read at call
  // time so it takes effect on the next tick.
  //
  // Deduplicated per channel, because a React re-render can ask the same question many
  // times a second. Turning the flag off clears the channels, so switching it back on
  // restates the current position rather than staying silent until something moves.
  var _gateLast = {};
  function gateLogOnce(channel, line) {
    if (!coop().debugButtons) { _gateLast = {}; return; }
    if (_gateLast[channel] === line) return;
    _gateLast[channel] = line;
    console.info('[svr gate] ' + line);
  }

  // ── GraphQL ───────────────────────────────────────────────────────────────

  function gqlRequest(query, variables) {
    // `__svr` marks the request as this plugin's own, so the save watch lets it
    // straight through - on a live page the bare `fetch` here *is* the wrapper.
    // `fetch` ignores a property it does not know.
    return fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, variables: variables }),
      __svr: true,
    })
      .then(function (resp) { return resp.json(); })
      .then(function (json) {
        if (json.errors) throw new Error(json.errors.map(function (e) { return e.message; }).join('; '));
        return json.data;
      });
  }

  function loadSettings() {
    return gqlRequest('{ configuration { plugins } }', null).then(function (data) {
      var raw = ((data.configuration || {}).plugins || {})[PLUGIN_ID] || {};
      if (raw.c5PropagateTitleOnSave == null && raw.c2PropagateTitleOnSave != null) {
        raw.c5PropagateTitleOnSave = raw.c2PropagateTitleOnSave;
      }
      var s = {};
      for (var k in DEFAULTS) {
        if (!hasOwn(DEFAULTS, k)) continue;
        s[k] = DEFAULTS[k] === null
          // A weight is a number or nothing at all; an absent one is what says the
          // user has not asked for these to be remembered.
          ? (raw[k] == null || raw[k] === '' ? null : Number(raw[k]))
          : typeof DEFAULTS[k] === 'boolean' ? !!raw[k]
            : (raw[k] == null ? '' : String(raw[k]));
      }
      seedFieldDefault(raw, s);
      return s;
    });
  }

  // ── The one default that has to be written in ─────────────────────────────
  //
  // **Stash has no `default:` for a plugin setting.** The settings page renders whatever
  // is in `config.yml`, which on a fresh install is nothing at all - so a plugin using a
  // default shows an empty box, and the one name a user needs in order to find the field
  // in Stash's own Custom Fields panel is the one thing the page does not say. Reported
  // live as exactly that: the field has a default and the setting reads empty.
  //
  // `CustomFieldsBulkEditor` found this first and `PropagateTagsAndPerformers` followed;
  // this is the same seed as theirs, for the one string setting here that has a default.
  //
  // **Absent, never merely empty.** An empty box still means the default - `fieldName`
  // has always read it that way and the description says so - so re-seeding a cleared box
  // would change nothing about what the plugin does and would undo a deliberate edit on
  // the next page load. The key's *presence* is what says the question has been answered,
  // the same rule the siblings' exclusion-filter adoption reads.
  //
  // **The whole stored map goes back.** `configurePlugin` replaces `plugins.<id>` rather
  // than merging into it, so a mutation naming one key deletes every other setting the
  // plugin has - which is what cost this repo two users' configurations before the rule
  // was written down in the root `AGENTS.md`.
  //
  // **Its own operation name**, so a plugin watching for its own settings change can tell
  // this apart from one: what it writes is what `loadSettings` has already returned.
  // Nothing here watches yet, and the next thing that does would have to know.
  var _seededField = false;

  // The defaulted settings, in one write: a key that is *absent* gets its default
  // written in; a key that is present - even holding '' or false - has been answered.
  // The propagate offer is on by default, and Stash has no default for a plugin
  // setting, so the seed is what makes a fresh install's switch show the state the
  // plugin is actually in.
  var SEED_DEFAULTS = {
    a3VariantStashIdField: FIELD_DEFAULT,
    a4VariantFlagTag: FLAG_DEFAULT,
    c1PropagateOnSave: true,
    c3SkipRedundantTags: true,
    e1PartialPostfix: POSTFIX_DEFAULT,
    e2FirstIndex: FIRST_INDEX_DEFAULT,
    e3BaseNameField: BASE_FIELD_DEFAULT,
    e4NoRenameField: SKIP_FIELD_DEFAULT,
  };

  // Shown on Stash's settings page from its first paint, by the same rule (Core's
  // `showDefaults`); `seedFieldDefault` below is what writes them.
  if (typeof showDefaults === 'function') showDefaults(PLUGIN_ID, function () { return SEED_DEFAULTS; });

  function seedFieldDefault(raw, s) {
    if (_seededField) return;
    var missing = [], k;
    for (k in SEED_DEFAULTS) {
      if (!hasOwn(SEED_DEFAULTS, k)) continue;
      // A legacy default was only ever written by the seed, so it is an unanswered
      // box wearing an old spelling, not an answer.
      if (!hasOwn(raw, k) ||
        (k === 'a4VariantFlagTag' && isLegacyFlag(raw[k]))) missing.push(k);
    }
    if (!missing.length) return;
    _seededField = true;
    var input = {};
    for (k in raw) if (hasOwn(raw, k)) input[k] = raw[k];
    missing.forEach(function (key) {
      s[key] = SEED_DEFAULTS[key];
      input[key] = SEED_DEFAULTS[key];
    });
    gqlRequest('mutation SVRSeedSettings($id: ID!, $input: Map!) ' +
      '{ configurePlugin(plugin_id: $id, input: $input) }',
    { id: PLUGIN_ID, input: input }).then(null, function () {
      // Left in force for this page either way: the values are what `fieldName` and
      // `flagTagName` already use. Only the boxes stay empty, and the next load tries
      // again.
      _seededField = false;
      svr('[svr] the default names could not be written into the settings; ' +
        'they are in force all the same.');
    });
  }

  // Read synchronously by the settings tick and refreshed on a timer, the shape every
  // sibling plugin uses.
  var _settings = null, _settingsAt = 0, _settingsWait = null;

  function settings() {
    if (!_settings) {
      _settings = {};
      for (var k in DEFAULTS) if (hasOwn(DEFAULTS, k)) _settings[k] = DEFAULTS[k];
    }
    if (!_settingsWait && Date.now() - _settingsAt > SETTINGS_TTL_MS) {
      _settingsWait = loadSettings().then(function (s) {
        _settings = s; _settingsAt = Date.now(); _settingsWait = null;
      }, function () {
        _settingsAt = Date.now(); _settingsWait = null;
      });
    }
    return _settings;
  }

  function logToConsole(msg) {
    if (settings().b1LogToConsole) console.info('[svr] ' + msg);
  }
  // ── The tag tree ───────────────────────────────────────────────────────
  //
  // A configured name is matched against every tag's name *and* its aliases, and a scene
  // counts as classified when it carries the matched tag or any descendant of it. Both of
  // those are questions about the whole tag graph rather than about one string, so the
  // graph is what is fetched: one unfiltered `findTags`, cached, rather than a filter
  // query per name whose field spellings would be one more guess about Stash's schema -
  // the kind that cost this plugin two releases already.
  //
  // It also answers the question nothing else could: whether the two names are the same
  // tag, or one an ancestor of the other. That is a contradiction to report rather than
  // resolve - see `conflictNote`.
  var TAGS_QUERY =
    'query SVRTags { findTags(filter: { per_page: -1 }) ' +
    '{ tags { id name aliases parents { id } } } }';

  var TAGS_TTL_MS = 60000;   // the tag tree is re-read at most this often
  var _tagsWait = null, _tagsAt = 0;

  function tagTree() {
    if (!_tagsWait || Date.now() - _tagsAt > TAGS_TTL_MS) {
      _tagsAt = Date.now();
      _tagsWait = gqlRequest(TAGS_QUERY, null).then(function (data) {
        return (((data || {}).findTags) || {}).tags || [];
      }, function (err) {
        // Loud, like the variant query and for the same reason: with no tag tree every
        // row lists unclassified, which is indistinguishable from two tag names that
        // match nothing.
        console.warn('[svr] the tag list could not be read, so no row can be classified: ' +
          err.message);
        return [];
      });
    }
    return _tagsWait;
  }

  // The two configured names resolved against that tree: for each, the tags whose name or
  // any alias matches, and every descendant of those. Matching is by tag **id** from here
  // on - a name is only what starts the search, and a scene's tag is then that tag or it
  // is not.
  // **The one rule two callers match by**, hoisted out of `matchers` when the settings
  // rows grew a link: the classifier asks it which tags a configured name reaches, and
  // the row asks it which tag to link to. A second copy would be a link pointing at a
  // tag the classifier does not actually use.
  //
  // A **list**, not one tag: `tagKey` is case-insensitive and matches aliases as well as
  // names, so two different tags can answer to one configured name - and this plugin
  // means all of them, along with their descendants.
  function tagsMatchingName(tags, name) {
    var k = tagKey(name);
    if (!k) return [];
    return tags.filter(function (t) {
      if (tagKey(t.name) === k) return true;
      var aliases = t.aliases || [];
      for (var i = 0; i < aliases.length; i++) if (tagKey(aliases[i]) === k) return true;
      return false;
    });
  }

  function matchers(tags, s) {
    var byId = {}, kids = {};
    tags.forEach(function (t) {
      byId[t.id] = t;
      (t.parents || []).forEach(function (p) {
        (kids[p.id] = kids[p.id] || []).push(t.id);
      });
    });

    // Breadth-first with a visited set. A Stash tag hierarchy is a graph rather than a
    // tree - a tag can have several parents - so a diamond or a cycle is a shape to
    // survive rather than one to assume away.
    function withDescendants(roots) {
      var set = {}, queue = roots.map(function (t) { return t.id; }), id, next, i;
      while (queue.length) {
        id = queue.shift();
        if (set[id]) continue;
        set[id] = true;
        next = kids[id] || [];
        for (i = 0; i < next.length; i++) queue.push(next[i]);
      }
      return set;
    }

    var fl = tagsMatchingName(tags, s.a1FullLengthTag),
        pl = tagsMatchingName(tags, s.a2PartialLengthTag);
    return { byId: byId, flRoots: fl, plRoots: pl,
      fl: withDescendants(fl), pl: withDescendants(pl),
      // A scene wearing this tag, or a descendant of it, is left out of Rename Variants.
      noRename: withDescendants(tagsMatchingName(tags, s.e5NoRenameTag)) };
  }

  // The tag ids never pushed and never scored: both dimension sets, descendants
  // included, and whatever answers to the flag tag's name. A full-duration scene and its
  // partial cut differ by these *by definition*.
  function skipTagIds(tags, s, m) {
    var skip = {}, id;
    for (id in m.fl) if (hasOwn(m.fl, id)) skip[id] = true;
    for (id in m.pl) if (hasOwn(m.pl, id)) skip[id] = true;
    tagsMatchingName(tags, flagTagName(s)).forEach(function (t) {
      skip[String(t.id)] = true;
    });
    return skip;
  }

  // The two values are mutually exclusive by definition, so a configuration where one tag
  // can be both is a contradiction the plugin cannot resolve. Left unsaid it surfaces as
  // every scene under the overlap being flagged red - a scene-level error for a settings
  // mistake, which is the wrong place to go looking. One sentence at the head of the pane
  // instead, and nothing is refused: the rows are still listed.
  //
  // One test covers all three shapes - the same tag under both names, and an ancestor and
  // a descendant either way round - because if the two descendant sets meet at all, the
  // two tags are related.
  function conflictNote(m) {
    if (!m.flRoots.length || !m.plRoots.length) return '';
    var shared = [], id;
    for (id in m.fl) if (hasOwn(m.fl, id) && m.pl[id]) shared.push(id);
    if (!shared.length) return '';
    var name = function (i) { return (m.byId[i] || {}).name || ('tag ' + i); };
    var same = m.flRoots.some(function (a) {
      return m.plRoots.some(function (b) { return b.id === a.id; });
    });
    if (same) {
      return '⚠ Both tag settings name the same tag (' + name(m.flRoots[0].id) +
        '), so every scene carrying it is listed as a contradiction. The full-duration and ' +
        'partial-duration tags are meant to be mutually exclusive.';
    }
    return '⚠ The full-duration tag (' + name(m.flRoots[0].id) + ') and the ' +
      'partial-duration tag (' + name(m.plRoots[0].id) + ') are related in the tag ' +
      'hierarchy, so ' + plural(shared.length, 'tag') + ' counts as both: ' +
      shared.map(name).join(', ') + '. The two are meant to be mutually exclusive.';
  }

  // ── Finding the variants ──────────────────────────────────────────────────
  //
  // One query, which is what the plan sketched and what a DOM-injected panel could not
  // have: the tab is handed `props.scene`, a `SceneDataFragment`, and that fragment
  // already carries `stash_ids`. Reading them off the page instead of asking for them is
  // the whole saving - there is nothing to look up before the filter can be written.
  //
  // `stash_ids_endpoint` takes a *list*, so one call covers a scene carrying several
  // ids, and the endpoint is deliberately left out: a variant set that spans two
  // metadata providers is still one work, and naming an endpoint would hide half of it.
  // Omitting it leaves the endpoint out of the join condition entirely, which is what
  // makes that work rather than matching nothing.
  //
  // **The modifier is EQUALS, and it is the one that means "any of these".** The stash
  // IDs criterion accepts exactly four - IS_NULL, NOT_NULL, EQUALS, NOT_EQUALS - and
  // rejects everything else outright, INCLUDES among them; EQUALS over a list ORs the
  // ids, which is the semantics wanted here. INCLUDES is the natural guess for a list
  // criterion and every other list filter in Stash takes it, so this is the one place
  // reading like its neighbours is wrong.
  // Everything the hover delta compares, and nothing else. The list is the price of that
  // feature and is worth reading as one: a field named wrongly here does not lose the
  // delta, it loses the whole query and with it the tab's only answer. All of them are
  // ordinary `Scene` fields on the Stash this plugin already requires, and
  // `groups { group { ... } }` is the shape a sibling plugin runs against a live server.
  //
  // One string for both lookups below, because the two answers are merged into one list:
  // a row has to be the same shape whichever query found it, and two field lists that
  // drifted would show a delta against fields only half the rows carry.
  var SCENE_FIELDS =
    'id title tags { id name } ' +
    'paths { screenshot preview } files { duration width height size } ' +
    'code details director date rating100 organized urls ' +
    'studio { id name } performers { id name } groups { group { id name } scene_index }';

  var VARIANTS_QUERY =
    'query SVRVariants($ids: [String!]) { findScenes(' +
    'scene_filter: { stash_ids_endpoint: { stash_ids: $ids, modifier: EQUALS } }, ' +
    'filter: { per_page: -1 }) { scenes { ' + SCENE_FIELDS + ' custom_fields } } }';

  // The other half of the same question, for the scenes whose stash-id has been moved
  // into the custom field - and for the full-duration ones carrying both, where either
  // query finds them. The one value is `fieldRegex`'s pattern: MATCHES_REGEX per line
  // rather than EQUALS on the whole value, because a scene with entries at two
  // providers stores two lines, and sharing any one of them is sharing the work.
  //
  // Its own failure is caught where it is asked rather than here: a Stash that spells
  // this criterion differently must lose the half of the answer it cannot give, not the
  // half it can.
  var BY_FIELD_QUERY =
    'query SVRFieldMatch($field: String!, $values: [Any!]) { findScenes(' +
    'scene_filter: { custom_fields: [{ field: $field, value: $values, modifier: MATCHES_REGEX }] }, ' +
    'filter: { per_page: -1 }) { scenes { ' + SCENE_FIELDS + ' custom_fields } } }';

  // What this scene's own custom field holds. `props.scene` is Stash's
  // `SceneDataFragment` and whether it carries `custom_fields` is Stash's to decide, so
  // the field is read off it when it is there and asked for by id when it is not - one
  // query, on the scenes that need it, which after a migration is every partial-duration
  // one. A failure reads as "no values", which is what a scene that never had any looks
  // like anyway.
  function ownFieldValues(scene, field, ids) {
    if (scene && scene.custom_fields && typeof scene.custom_fields === 'object') {
      return Promise.resolve(splitValues(customField(scene, field)));
    }
    // Only where the scene has no stash-id of its own, which after a migration is every
    // partial-duration one: a scene that carries stash-ids is matched on those, and the
    // field a migration wrote holds exactly them. A query per scene page to re-read what
    // is already in hand is the two-round-trip version of a lookup this plugin
    // deliberately does in one. The one case the field would add something is a scene
    // grouped by Create Variant Group that later gained a real stash-id through a
    // scrape; the migration task's scan is where that drift is reported.
    if (ids && ids.length) return Promise.resolve([]);
    return gqlRequest('query SVRSceneFields($id: ID!) { findScene(id: $id) ' +
      '{ id custom_fields } }', { id: String(scene && scene.id) })
      .then(function (data) {
        return splitValues(customField((data || {}).findScene, field));
      }, function () { return []; });
  }

  // What a lookup was matched on, in one phrase. Both halves are named where both were
  // used, because "no other scene shares this one's stash-id" is a different fact from
  // "...or its variant stash-id", and a user deciding whether to migrate a scene is
  // exactly the person who needs to know which was asked.
  function matchedOn(ids, own) {
    var parts = [];
    if (ids.length) parts.push(plural(ids.length, 'stash-id'));
    if (own.length) parts.push(plural(own.length, 'variant stash-id'));
    return parts.join(' and ');
  }

  // Resolves once the first settings read has landed, so the rows are classified against
  // the user's tag names rather than against the empty defaults. The pane reads settings
  // exactly once, when it mounts, and nothing re-renders it afterwards - so a
  // classification made half a second early would simply be wrong for as long as the tab
  // stayed open.
  function settingsReady() {
    settings();
    // `_settingsWait`'s own handlers return nothing - they assign `_settings` and are
    // done - so what resolves has to be read back rather than passed through.
    return _settingsWait ? _settingsWait.then(function () { return _settings; })
      : Promise.resolve(_settings);
  }

  // Everything the tab shows, as one promise: the rows in the order they go on screen,
  // and the sentence explaining what they were matched on. The three empty answers are
  // values rather than failures - a scene with no stash-id is the ordinary case here,
  // not an error - and only the fourth, a query the server refused, is loud.
  function findVariants(scene) {
    var ids = ((scene && scene.stash_ids) || []).map(function (s) { return s.stash_id; })
      .filter(function (v) { return !!v; });
    return Promise.all([settingsReady(), tagTree()]).then(function (both) {
      var s = both[0], m = matchers(both[1], s);
      var field = fieldName(s);
      return ownFieldValues(scene, field, ids).then(function (own) {
        // The scene's own stash-ids expressed the way the field stores them, plus
        // whatever the field already holds. A migrated partial has only the second; a
        // full-duration scene that has been through the task has both, and they agree.
        var values = variantValues(scene && scene.stash_ids).concat(own)
          .filter(function (v, i, all) { return all.indexOf(v) === i; });
        if (!ids.length && !values.length) {
          return { rows: [], conflict: conflictNote(m),
            why: 'This scene carries no stash-id and no "' + field + '" custom field, ' +
              'which are the only evidence this plugin uses so far.' };
        }
        return Promise.all([
          ids.length ? gqlRequest(VARIANTS_QUERY, { ids: ids }) : Promise.resolve(null),
          values.length ? gqlRequest(BY_FIELD_QUERY, { field: field, values: [fieldRegex(values)] })
            .then(null, function (err) {
              // Half an answer beats none: the stash-id half is still valid, and a
              // criterion this server spells differently is worth one line rather than
              // an empty tab.
              console.warn('[svr] the "' + field + '" custom-field lookup failed for scene ' +
                scene.id + ', so only stash-id matches are listed: ' + err.message);
              return null;
            }) : Promise.resolve(null),
        ]).then(function (answers) {
          var scenes = [], seen = {};
          answers.forEach(function (data) {
            ((((data || {}).findScenes) || {}).scenes || []).forEach(function (o) {
              if (hasOwn(seen, String(o.id))) return;
              seen[String(o.id)] = true;
              scenes.push(o);
            });
          });
          var others = scenes.filter(function (o) { return String(o.id) !== String(scene.id); });
          // The viewed scene as the query returned it - the same fields, selected the same
          // way, which is what the delta compares against. A server that does not agree this
          // scene carries the stash-id leaves it null, and every row then reports no
          // difference rather than reporting a wrong one.
          var self = scenes.filter(function (o) { return String(o.id) === String(scene.id); })[0];
          logToConsole('scene ' + scene.id + ': ' + plural(others.length, 'variant') +
            ' from ' + matchedOn(ids, own));
          var nm = naming(s);
          return {
            rows: ordered(others, self, m, self ? expectedMap([self].concat(others), m, nm) : null,
              nm.baseField),
            // The viewed scene as the query returned it - the delta's other side, and
            // what the synchronize task pushes from: the same fields, selected the same
            // way, for both readers.
            self: self,
            conflict: conflictNote(m),
            // The merged evidence, for the pane's stash-box links: the same lines the
            // lookup was matched on, so a link can never name an entry the tab did not ask.
            values: values,
            why: others.length
              ? 'Matched on ' + matchedOn(ids, own) + '.'
              : 'No other scene shares this one’s ' + matchedOn(ids, own) + '.',
            // What the pane's drift score is priced and filtered by: the review
            // task's own weights and its own tag exclusions, read here so the number
            // on the tab is the number the listing would give this set.
            skip: skipTagIds(both[1], s, m),
            matchers: m, naming: nm,
            weights: weightsFrom(s),
            remembered: anyRemembered(s),
            excludeOrganized: !!s.d7ExcludeOrganized,
            coverCheck: !!s.c4CheckCoverMismatch,
          };
        });
      });
    }).then(null, function (err) {
      // Loud rather than silent: a pane that stays empty because a filter field is
      // named differently on this Stash looks exactly like a scene with no variants,
      // and only one of those is worth reporting.
      console.warn('[svr] variant lookup failed for scene ' + scene.id + ': ' + err.message);
      return { rows: [], why: 'The variant query failed: ' + err.message };
    });
  }
  // ── Classifying a variant ─────────────────────────────────────────────────
  //
  // The dimension is read off a tag, which is the whole of what makes it cheap: the
  // hard half of the problem is "which scenes are the same work", and it is already
  // answered by the time this runs.
  //
  // A scene carrying *both* tags is a real error rather than a tie - the two values are
  // mutually exclusive by definition - so it is shown as one instead of being resolved
  // by whichever test ran first.
  // **The label is the dimension's value, never the tag that carried it.** These shipped
  // echoing the configured tag name back, which is noise twice over: every row in a value
  // shows the same string, and the user picked it, so it says nothing they do not know. It
  // is also whatever they typed - a taxonomy of Unicode-marked namespaces renders as
  // `✨🎥Promo⚠∙` in a column meant to be scanned. The tag is *how* the value was read; the
  // value is what the tab is about. The tag name goes on the row's hover text, where a
  // reader who does want to confirm the match can find it and nobody else has to look at it.
  var ROLES = {
    fl: { label: 'Full-duration' },
    pl: { label: 'Partial-duration' },
    bad: { label: '⚠ both' },
  };

  // The tag named on the hover text is the one the scene actually carries, which is the
  // whole of what alias and descendant matching cost here: a row matched through a child
  // tag or an alias has to say which, or the hover text is answering "did it match the
  // right tag" with the string the reader typed into the settings.
  function classify(scene, m) {
    var full = null, partial = null;
    (scene.tags || []).forEach(function (t) {
      if (!full && m.fl[t.id]) full = t;
      if (!partial && m.pl[t.id]) partial = t;
    });
    if (full && partial) {
      return { role: 'bad', label: ROLES.bad.label, tags: full.name + ' and ' + partial.name };
    }
    if (full) return { role: 'fl', label: ROLES.fl.label, tags: full.name };
    if (partial) return { role: 'pl', label: ROLES.pl.label, tags: partial.name };
    return { role: 'none', label: '', tags: '' };
  }

  // ── The delta against the scene being viewed ──────────────────────────────
  //
  // What the hover text on a row answers: *how is this one different from the scene I am
  // looking at*. Two halves, and they are deliberately not symmetrical in what they show:
  //
  //   the tags, **by name** - a tag is a short string and the names are the answer;
  //   the attributes, **by name only** - which fields disagree, never how. A title and a
  //     details block are paragraphs, and a tooltip that quoted both sides would be a
  //     diff view nobody asked for. Knowing *that* the dates differ is what sends the
  //     reader to the two pages; which of them is right is a question for those pages.
  //
  // The scene being compared against comes out of the same `findScenes` answer rather than
  // off `props.scene`: the query returns every scene sharing the stash-id, this one
  // included, so both sides of every comparison are the same fields selected by the same
  // query. Reading one side off the props fragment instead would compare Stash's
  // `SceneDataFragment` - whose shape is Stash's to change - against ours, and any field
  // that fragment happens not to carry would read as a difference on every row.
  var ATTRS = [
    { key: 'title', label: 'Title' },
    { key: 'date', label: 'Date' },
    { key: 'studio', label: 'Studio', of: function (v) { return v ? v.name : ''; } },
    { key: 'performers', label: 'Performers', of: joinNames },
    { key: 'groups', label: 'Groups', of: joinNames },
    { key: 'rating100', label: 'Rating' },
    { key: 'code', label: 'Studio code' },
    { key: 'director', label: 'Director' },
    { key: 'details', label: 'Details' },
    { key: 'urls', label: 'URLs', of: joinNames },
    { key: 'organized', label: 'Organized' },
  ];

  // One comparable string for a list of names, whatever the list holds: performers and
  // studios carry a `name`, a scene's groups wrap theirs a level in, and urls are bare
  // strings. **Sorted**, because two scenes holding the same three performers in a
  // different order are not two scenes that disagree about their performers.
  function joinNames(list) {
    return (list || []).map(function (x) {
      if (x && x.name) return String(x.name);
      if (x && x.group && x.group.name) return String(x.group.name);
      return String(x == null ? '' : x);
    }).sort().join(' · ');
  }

  function attrValue(scene, a) {
    var v = scene ? scene[a.key] : null;
    if (a.of) return a.of(v);
    return String(v == null ? '' : v);
  }

  function tagNames(tags) {
    return (tags || []).map(function (t) { return t.name || ('tag ' + t.id); }).sort();
  }

  // Tags are compared by **id** and reported by name - the same split the classification
  // makes, and for the same reason: an id is what identifies a tag and a name is what a
  // reader can act on.
  function tagDelta(self, other) {
    var have = {}, theirs = {};
    (self.tags || []).forEach(function (t) { have[t.id] = true; });
    (other.tags || []).forEach(function (t) { theirs[t.id] = true; });
    return {
      extra: tagNames((other.tags || []).filter(function (t) { return !have[t.id]; })),
      missing: tagNames((self.tags || []).filter(function (t) { return !theirs[t.id]; })),
    };
  }

  // The hover content itself, as sections rather than one string: each has a header the
  // box renders bold and amber, because three runs of comma-separated names in one grey
  // paragraph were the reported readability problem. "Same tags and attributes as this
  // scene." rather than an empty box: a row with nothing to report is an answer - the two
  // are duplicates of each other in everything this plugin can see - and a box that
  // failed to open would read as one that had never been built.
  // Sections for the hover box, counts for the row's badges - one computation, so the
  // badge and the box it opens can never disagree about a number. Null where there is
  // nothing to compare against, which is a different fact from "no differences".
  // `expected`, the set's titles under the naming rule where it has any: a title is then
  // a difference only where a side that has an expected title is not wearing it - a
  // partial named after its set does not differ from the scene it is named after, and
  // the review's title count says the same. A side carrying the base-name field
  // (`baseField`) is left out the way the review leaves it out. A title that differs
  // but is not counted - pinned, following the rule, or on a scene the rule skips -
  // is listed as "Title (ignored)" rather than dropped, "(ignored)" in grey, so the box still says it differs.
  function deltaOf(self, other, expected, baseField) {
    if (!self || String(self.id) === String(other.id)) return null;
    var d = tagDelta(self, other), out = [];
    var pinned = function (sc) {
      var v = baseField && sc.custom_fields && sc.custom_fields[baseField];
      return typeof v === 'string' && !!trim(v);
    };
    var titleDiffers = function () {
      if (!expected) return !pinned(self) && !pinned(other) &&
        attrValue(self, ATTRS[0]) !== attrValue(other, ATTRS[0]);
      return [self, other].some(function (sc) {
        return !pinned(sc) && hasOwn(expected, String(sc.id)) &&
          (sc.title || '') !== expected[String(sc.id)];
      });
    };
    var titleIgnored = false;
    if (d.extra.length) {
      out.push({ head: 'Extra ' + plural(d.extra.length, 'tag') + ':',
        body: d.extra.join(', '), kind: 'extra' });
    }
    if (d.missing.length) {
      out.push({ head: 'Missing ' + plural(d.missing.length, 'tag') + ':',
        body: d.missing.join(', '), kind: 'missing' });
    }
    var differ = ATTRS.filter(function (a) {
      if (a.key !== 'title') return attrValue(self, a) !== attrValue(other, a);
      if (titleDiffers()) return true;
      titleIgnored = attrValue(self, a) !== attrValue(other, a);
      return false;
    }).map(function (a) { return a.label; });
    if (differ.length || titleIgnored) {
      out.push({ head: 'Differing attributes:', body: differ.join(', '), kind: 'attrs',
        ignored: titleIgnored ? ATTRS[0].label : '' });
    }
    if (!out.length) out.push({ head: '', body: 'Same tags and attributes as this scene.' });
    return { sections: out, extra: d.extra.length, missing: d.missing.length,
      attrs: differ.length };
  }

  function bestFile(scene) {
    var files = scene.files || [];
    var best = null;
    for (var i = 0; i < files.length; i++) {
      if (!best || (files[i].duration || 0) > (best.duration || 0)) best = files[i];
    }
    return best;
  }

  function hhmmss(seconds) {
    var n = Math.round(Number(seconds) || 0);
    if (!n) return '';
    var h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
    var pad = function (v) { return (v < 10 ? '0' : '') + v; };
    return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(sec);
  }

  function metaOf(scene) {
    var f = bestFile(scene), parts = [];
    if (f && f.width && f.height) parts.push(f.width + '×' + f.height);
    var d = hhmmss(f && f.duration);
    if (d) parts.push(d);
    return parts.join(' · ');
  }

  // Full-duration first, then longest. The order is the answer to "which of these did I
  // mean", and the ranking the plan sketches is only worth building once there is more
  // than one candidate at the top - which the user says is rare.
  var ROLE_RANK = { fl: 0, none: 1, bad: 1, pl: 2 };

  function ordered(variants, self, m, expected, baseField) {
    return variants.map(function (scene) {
      return { scene: scene, cls: classify(scene, m), delta: deltaOf(self, scene, expected, baseField) };
    }).sort(function (a, b) {
      var ra = ROLE_RANK[a.cls.role], rb = ROLE_RANK[b.cls.role];
      if (ra !== rb) return ra - rb;
      return ((bestFile(b.scene) || {}).duration || 0) - ((bestFile(a.scene) || {}).duration || 0);
    });
  }
  // ── The migration task ────────────────────────────────────────────────────
  //
  // A stash-id belongs to the *work*, and a stash-box holds one entry for the whole
  // scene - so a partial-duration cut wearing the same stash-id is claiming to be the
  // thing it was cut out of, and every part of Stash that treats a stash-id as an
  // assertion about the file believes it. The task moves that claim into this plugin's
  // own custom field and takes the stash-id off the cut.
  //
  // Full-duration scenes are written too, and keep their stash-ids. That is not symmetry
  // for its own sake: with the field on both sides the variant lookup is one query over
  // one criterion, where a library half-migrated needs the union of two. Their stash-id
  // is untouched, because on the full-duration scene it is true.
  var TASK_NAME = 'Migrate Variant Stash-IDs...';
  var FLAG_TASK_NAME = 'Flag Variants...';

  // The scan reads only what a plan needs - the tags to classify by, the stash-ids to
  // move, and the field as it stands so an entry already in place is not written again.
  var MIGRATE_QUERY =
    'query SVRMigrateScan($f: FindFilterType, $tags: [ID!]) { findScenes(' +
    'scene_filter: { tags: { value: $tags, modifier: INCLUDES, depth: 0 } }, filter: $f) ' +
    '{ count scenes { id title tags { id } custom_fields ' +
    'stash_ids { endpoint stash_id } } } }';

  // Depth 0 with the descendants already expanded, rather than `depth: -1` over the two
  // configured roots: `matchers` has resolved the names through aliases and the whole
  // hierarchy by the time this runs, and reusing that answer keeps the task classifying
  // scenes by exactly the rule the tab classifies rows by. One filter semantics fewer to
  // be right about, and the two can never disagree.
  function tagIdsFor(m) {
    var out = [], id;
    for (id in m.fl) if (hasOwn(m.fl, id)) out.push(String(id));
    for (id in m.pl) if (hasOwn(m.pl, id) && !m.fl[id]) out.push(String(id));
    return out;
  }

  // What one scene needs doing to it, or null. Three shapes of "nothing to do" and they
  // are deliberately not one: a scene with no stash-id has nothing to move, a scene
  // whose field already says the right thing has nothing to write, and a scene that is
  // neither full nor partial is not this task's business at all.
  function planScene(scene, m, field) {
    var cls = classify(scene, m);
    if (cls.role !== 'fl' && cls.role !== 'pl') return null;
    var values = variantValues(scene.stash_ids);
    if (!values.length) return null;
    var had = customField(scene, field);
    var value = values.join('\n');
    var clear = cls.role === 'pl';
    if (String(had == null ? '' : had) === value && !clear) return null;
    return {
      id: String(scene.id),
      title: scene.title || ('Scene ' + scene.id),
      role: cls.role,
      field: field,
      value: value,
      had: had == null ? null : String(had),
      clear: clear,
      stashIds: (scene.stash_ids || []).map(function (e) {
        return { endpoint: e.endpoint, stash_id: e.stash_id };
      }),
    };
  }

  function writeInput(job) {
    var input = { id: job.id, custom_fields: { partial: {} } };
    input.custom_fields.partial[job.field] = job.value;
    // `stash_ids: []` on the partial only. `partial` is what leaves every other custom
    // field the scene carries alone, which is the whole reason it exists.
    if (job.clear) input.stash_ids = [];
    return input;
  }

  // The exact inverse, built at plan time from what the scene held: the field back to the
  // string it had - or removed, where it had none - and the stash-ids back on the ones
  // they were taken off. `remove` rather than an empty string, because a field set to ""
  // is a field the scene carries, and it did not carry one.
  function undoInput(job) {
    var input = { id: job.id };
    if (job.had == null) {
      input.custom_fields = { remove: [job.field] };
    } else {
      input.custom_fields = { partial: {} };
      input.custom_fields.partial[job.field] = job.had;
    }
    if (job.clear) input.stash_ids = job.stashIds;
    return input;
  }

  // **Locked custom fields** - Custom Fields Bulk Editor's list, asked through Core's
  // `fieldLocks()`. A locked field's value cannot change and it cannot come off a scene;
  // setting it where a scene has none is allowed. `locks` is the worker, null (no
  // publisher: nothing locked) or false (it could not answer: every field locked).
  function fieldLocked(locks, field) {
    return locks === false || !!(locks && locks.isLocked(field));
  }

  function lockRefusal(field) {
    return '"' + field + '" is locked in ᝯㄝₓ Custom Fields Bulk Editor\u2019s Locked Custom ' +
      'Fields setting, so it cannot be changed or taken off a scene.';
  }

  // The lock list read fresh at a press, so a lock added since the scan still holds.
  function refreshLocks(run) {
    return fieldLocks().then(function (l) { run.locks = l; });
  }

  var SCENE_UPDATE =
    'mutation SVR_Write($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id } }';

  // ── The dialog ────────────────────────────────────────────────────────────
  //
  // The shared chrome every plugin here puts up, and the first one in this plugin: a
  // head with the backup sentence and a legend, a monospace log, and a footer whose
  // write button leads. Nothing is written until Proceed, which is the standing rule -
  // the scan is a read, and what it found is on screen before anything moves.
  var _active = null;

  // `scope` is what the synchronize button adds: the scene whose values are pushed.
  // On the run rather than in the call that started it, so anything re-entering
  // `begin()` stays scoped - the same reasoning the siblings' scoped dialogs record.
  function startRun(task, scope, extra) {
    // An automatic run never steals an open dialog; a pressed button focuses it.
    if (_active) { if (!extra || !extra.auto) _active.focus(); return; }
    _active = new Run(task, extra);
    _active.scope = scope || null;
    if (_paneLock) _paneLock(true);
    _active.begin();
  }

  // One dialog, five tasks. The chrome, the log, the counters, the write batching and the
  // undo bookkeeping are the same machinery; what differs per task - the title, the
  // legend, the scan, the input builders, the verbs - lives on a task object rather than
  // in a second three-hundred-line copy of this one.
  function Run(task, extra) {
    this.task = task;
    // `auto` (opened by a save rather than a press) and `only` (the attribute set the
    // save changed) ride on the run itself, the way `scope` does, because Rescan
    // re-enters `begin()` and a rescan of a scoped run has to stay scoped.
    if (extra) { for (var xk in extra) if (hasOwn(extra, xk)) this[xk] = extra[xk]; }
    this.logText = [];      // every line as plain text, for Copy log and for the count
    this.jobs = [];         // what the scan found to do
    this.candidates = [];   // { job, box }: flagged scenes with no evidence, user-decided
    this.changes = [];      // what Proceed wrote, newest last, for Undo
    this.scanned = 0;
    this.total = 0;
    this.sets = [];          // the review task's variant sets, scored
    this.srcRadios = [];     // every source radio on screen, for exclusivity
    this.weightInputs = {};
    this.source = null;      // the scene a set will be synchronized from
    this.sourceSet = null;
    this.plannedFrom = null; // the id of the source whose set is already listed below
    this.openKey = null;     // the key of the one set shown open
    this.picked = {};        // set key -> the scene id last picked in it, while the dialog is open
    this.written = 0;
    this.failed = 0;
    this.state = 'scanning';
    this.stopped = false;
    this.scanFailed = false;
    this.build();
  }

  Run.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'svr-backdrop');
    // An automatic run stays invisible until its plan holds something to offer: a
    // dialog that flashed open and shut on every unremarkable save would be worse
    // than no feature.
    if (this.auto) this.backdrop.className += ' svr-hidden';
    // Tall, as its siblings' run dialogs are: the log takes the height the listing leaves,
    // rather than the dialog shrinking to what has been written so far.
    this.modal = el('div', 'svr-modal svr-tall');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'svr-head');
    // A plain block, so a title too long for one line wraps rather than being clipped.
    head.appendChild(el('div', 'svr-title', PLUGIN_SHORT_NAME + ' - ' + this.task.title));
    this.staleEl = el('div', 'svr-stale svr-hidden', '');
    head.appendChild(this.staleEl);
    head.appendChild(el('div', 'svr-warn',
      'Backing up your database before proceeding is recommended. Undo only reverses what this ' +
      'dialog wrote, while it stays open, and cannot account for changes made elsewhere in the ' +
      'meantime.'));
    this.noteEl = el('div', 'svr-note svr-hidden', '');
    head.appendChild(this.noteEl);
    head.appendChild(el('div', 'svr-legend', this.task.legend));
    this.modal.appendChild(head);

    this.progressEl = el('div', 'svr-progress', 'Starting…');
    this.modal.appendChild(this.progressEl);

    // One "All <attribute>" box per attribute the listing holds, filled by a task
    // that lists per-attribute lines (`buildAllBar`); hidden for the tasks that do
    // not.
    this.allBar = el('div', 'svr-allbar svr-hidden');
    this.modal.appendChild(this.allBar);

    // The review task's own two blocks: the weights strip, and the set listing above
    // the log rather than in it, because it is re-rendered and a log is append-only.
    this.weightBar = el('div', 'svr-allbar svr-hidden');
    this.modal.appendChild(this.weightBar);
    // Hidden until a task fills it, like the weights strip beside it. It carries a
    // height of its own so it can be dragged, which is exactly what made an empty one
    // visible: every dialog but the review task's had 22vh of nothing above its log.
    this.setsEl = el('div', 'svr-sets svr-hidden');
    this.modal.appendChild(this.setsEl);
    // The full-width drag bar under the listing. The divider was `resize:vertical` -
    // one declaration, no listeners - and live use found its corner grip tedious to
    // keep re-finding as the log grows. A bar the pointer can take anywhere along the
    // row is the fix; the CSS min/max-height still clamp whatever the drag sets, so
    // the arithmetic the declaration was chosen to avoid is still avoided.
    this.splitEl = el('div', 'svr-splitbar svr-hidden');
    this.splitEl.title = 'Drag to resize the set listing';
    (function (run) {
      run.splitEl.addEventListener('mousedown', function (e) {
        // The height is clamped here, to the listing's own min/max-height and to what
        // the log can give up above its minimum, so the bar stays under the pointer:
        // a height the CSS clamps or the flexbox shrinks leaves the pointer running
        // ahead of the bar, and a dead stretch to drag back through.
        var startY = e.clientY || 0;
        var rect = function (n) { return n.getBoundingClientRect ? n.getBoundingClientRect().height : 0; };
        var css = function (n, key) {
          var v = window.getComputedStyle ? parseFloat(window.getComputedStyle(n)[key]) : NaN;
          return isNaN(v) ? null : v;
        };
        var startH = rect(run.setsEl);
        var lo = css(run.setsEl, 'minHeight') || 0;
        var hi = css(run.setsEl, 'maxHeight');
        var logMin = css(run.logEl, 'minHeight');
        if (hi === null) hi = Infinity;
        if (logMin !== null) hi = Math.min(hi, startH + Math.max(0, rect(run.logEl) - logMin));
        function move(ev) {
          var h = startH + ((ev.clientY || 0) - startY);
          run.setsEl.style.height = Math.max(lo, Math.min(Math.max(hi, lo), h)) + 'px';
        }
        function up() {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        if (e.preventDefault) e.preventDefault();   // a drag must not select the log's text
      });
    })(this);
    this.modal.appendChild(this.splitEl);

    this.logEl = el('div', 'svr-log');
    this.modal.appendChild(this.logEl);

    var foot = el('div', 'svr-foot');
    // Two buttons, as every sibling's footer has: one that writes and one that takes
    // it back. They were one button on the reasoning that the two never overlap -
    // after a write, the listing describes a library this dialog has already changed.
    // **Rescan is what makes that false**: it reads the library again and produces a
    // fresh plan while what the last pass wrote is still undoable, and a single button
    // can only offer one of them. Live, that was a Proceed nobody could find.
    this.goBtn = button('Proceed', 'svr-go');
    this.goBtn.className = this.goBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.goBtn.disabled = true;
    this.undoBtn = button('Undo', 'svr-undo svr-hidden');
    this.undoBtn.className = this.undoBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    // Offered while a write runs and never during the scan, which is the split the
    // siblings make too. A scan is a read: Close abandons it outright, so a second
    // control that ends it slowly - after the page in flight, which is hundreds of
    // scenes - would be the worse of the two exits and the one nearer the pointer.
    this.stopBtn = button('Stop', 'svr-stop svr-hidden');
    // The two candidate actions, hidden until a scan lists a [GROUP?] line. Both write,
    // so both are amber; no "..." because the listing they act on is already on screen.
    this.groupBtn = button('Create Variant Group', 'svr-group svr-hidden');
    this.groupBtn.className = this.groupBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.untagBtn = button('Remove Tag', 'svr-untag svr-hidden');
    this.untagBtn.className = this.untagBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    // Amber and dotted: it lists a plan rather than writing one, and the listing is
    // what Proceed then acts on.
    this.syncSetBtn = button('Synchronize Set from Selected...', 'svr-syncset svr-hidden');
    this.syncSetBtn.className =
      this.syncSetBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.closeBtn = button('Close', 'svr-close');
    // Reads nothing and writes nothing: it opens the set below the open one.
    this.nextSetBtn = button('Next Set', 'svr-nextset svr-hidden');
    this.nextSetBtn.className = this.nextSetBtn.className.replace('btn-secondary', 'btn-info');
    this.copyBtn = button('Copy log', 'svr-copy');
    // Grey: it reads the library again and writes nothing. Hidden while anything is
    // in flight, like Stop's mirror image - a second scan started over a running one
    // would have two passes writing into one listing.
    this.rescanBtn = button('Rescan', 'svr-rescan svr-hidden');
    this.rescanBtn.title = 'Scan the library again and replace the plan with whatever ' +
      'is left to do. The log is kept, and so is what Undo can still reverse.';
    this.copyBtn.title = 'Copy the counters, the messages and every line of the listing as ' +
      'plain text.';
    this.goBtn.addEventListener('click', function () { self.go(); });
    this.undoBtn.addEventListener('click', function () { self.undo(); });
    this.stopBtn.addEventListener('click', function () { self.stop(); });
    this.groupBtn.addEventListener('click', function () { self.actCandidates(true); });
    this.untagBtn.addEventListener('click', function () { self.actCandidates(false); });
    this.syncSetBtn.addEventListener('click', function () { self.planSet(); });
    this.nextSetBtn.addEventListener('click', function () { self.nextSet(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });
    this.copyBtn.addEventListener('click', function () { self.copyLog(); });
    this.rescanBtn.addEventListener('click', function () { self.rescan(); });
    // A task may caption Proceed with what it writes; the candidate pair is captioned
    // as what it acts on and walled off from the rest of the row, both shown with it.
    if (this.task.goLabel) foot.appendChild(el('span', 'svr-foot-label', this.task.goLabel));
    this.candLabel = el('span', 'svr-foot-label svr-hidden', 'Selected [Group?]: ');
    this.candSep = el('span', 'svr-foot-sep svr-hidden', '-');
    // At the row's right end, shown with the candidate pair: the [GROUP?] boxes are the
    // only ones this listing has, and the two set them all at once. Grey: they write
    // nothing, and the pair reads the boxes only when pressed.
    this.selAllBtn = button('Select All', 'svr-selall svr-hidden');
    this.unselAllBtn = button('Unselect All', 'svr-unselall svr-hidden');
    this.selAllBtn.title = 'Tick every [GROUP?] line still open.';
    this.unselAllBtn.title = 'Untick every [GROUP?] line still open.';
    this.selAllBtn.addEventListener('click', function () { self.tickCandidates(true); });
    this.unselAllBtn.addEventListener('click', function () { self.tickCandidates(false); });
    [this.syncSetBtn, this.goBtn, this.stopBtn, this.nextSetBtn, this.candLabel, this.groupBtn, this.untagBtn,
      this.candSep, this.copyBtn, this.undoBtn, this.rescanBtn, this.closeBtn,
      this.selAllBtn, this.unselAllBtn]
      .forEach(function (b) { foot.appendChild(b); });
    this.modal.appendChild(foot);

    wireEscape(this);
    document.body.appendChild(this.backdrop);
  };

  Run.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
  };

  Run.prototype.show = function (node, visible) {
    node.className = node.className.replace(/\s*svr-hidden/g, '') + (visible ? '' : ' svr-hidden');
  };

  Run.prototype.note = function (text) {
    this.noteEl.textContent = text || '';
    this.show(this.noteEl, !!text);
  };

  Run.prototype.setState = function (state) {
    this.state = state;
    var busy = state !== 'listing';
    var writing = state === 'writing' || state === 'undoing';
    this.show(this.stopBtn, writing);
    this.show(this.rescanBtn, !busy);
    // Closing mid-scan is safe and instant: nothing has been written, so there is
    // nothing to leave half-done, and the paging stops on the next answer. Closing
    // mid-write is the one thing this dialog must not let happen - what it wrote is
    // only undoable while it is open - so there Stop is the only way out.
    this.closeBtn.disabled = writing;
    this.syncFooter();
    this.spin(busy);
  };

  // Proceed until a write has landed, Undo afterwards, and the reason it is disabled said
  // out loud rather than left to be guessed at.
  // The jobs Proceed will write: every job whose line carries no checkbox, and the
  // ticked live ones where it does. A disabled box is either mid-write or settled by an
  // earlier write, and neither is a selection.
  // The items of an additive line the user has left ticked - every item, where the
  // line has no picker.
  function pickedItems(job) {
    return (job.items || []).filter(function (it) { return !it.box || it.box.checked; });
  }

  Run.prototype.tickedJobs = function () {
    var out = [], self = this;
    this.jobs.forEach(function (j) {
      // A written job is settled whether or not its line has a box: a task without
      // boxes has nothing to lock, so the check is on `changes` itself.
      if (self.changes.indexOf(j) !== -1) return;
      if (j.box && (!j.box.checked || j.box.disabled)) return;
      // An additive line with every individual item unticked adds nothing, so it is
      // not a change however its master box stands.
      if (j.items && !pickedItems(j).length) return;
      out.push(j);
    });
    return out;
  };

  Run.prototype.syncFooter = function () {
    this.syncCandidates();
    this.syncSets();
    var busy = this.state !== 'listing', self = this;
    // Jobs with a checkbox lock while anything is in flight - the selection is read at
    // press time, so a live box mid-write would steer nothing - and stay settled once
    // written, until an Undo takes them back out of `changes`.
    var open = 0, selected = 0;
    this.jobs.forEach(function (j) {
      var lock = busy || self.changes.indexOf(j) !== -1;
      if (j.box) j.box.disabled = lock;
      if (j.box && !lock) { open++; if (j.box.checked) selected++; }
      // The individual item boxes steer the write exactly like the line's own box, so
      // they lock with it. The expander stays live: opening a list changes only what
      // the screen shows.
      if (j.items) j.items.forEach(function (it) { if (it.box) it.box.disabled = lock; });
    });
    // The same pair the [GROUP?] candidates get, over the lines of a task that lists
    // one group and starts every line unticked; held back where pressing one would
    // change nothing.
    if (this.task.selectAll && !this.candidates.length) {
      this.show(this.selAllBtn, open > 0);
      this.show(this.unselAllBtn, open > 0);
      this.selAllBtn.title = 'Tick every line still open.';
      this.unselAllBtn.title = 'Untick every line still open.';
      this.selAllBtn.disabled = busy || selected === open;
      this.unselAllBtn.disabled = busy || !selected;
    }
    // Undo stands beside Proceed rather than replacing it: a rescan leaves a fresh
    // plan and a written pass in the same dialog, and both need a button.
    this.show(this.undoBtn, this.changes.length > 0);
    this.undoBtn.disabled = busy;
    this.undoBtn.title = this.task.undoTip;
    // "Proceed all" against "Proceed selected" is read off the boxes themselves rather
    // than `tickedJobs`, which excludes locked boxes and would flap mid-write.
    var unticked = 0;
    this.jobs.forEach(function (j) { if (j.box && !j.box.checked) unticked++; });
    this.goBtn.textContent = !this.task.pickCaption ? 'Proceed'
      : unticked ? 'Proceed selected' : 'Proceed all';
    var ticked = this.tickedJobs().length;
    var why = busy ? 'Still working.'
      : this.stale ? 'Reload the page first: this tab is running an older script.'
        : !this.jobs.length ? this.task.nothing
          : !ticked ? (this.jobs.every(function (j) { return self.changes.indexOf(j) !== -1; })
            ? 'Everything listed is written.' : 'Nothing is ticked.')
            : '';
    this.goBtn.disabled = !!why;
    this.goBtn.title = why || ('Write ' + plural(ticked, this.task.planUnit || 'scene') + '.');
    // Green when nothing is left to write: every listed job written or none listed, no
    // candidate pair or set still offered. Undo does not take the green away - it is an
    // offer, not something waiting on the user. A failed scan and a stale script stay
    // grey: those say "something is wrong", not "nothing to do".
    var left = this.sets.length;
    this.jobs.forEach(function (j) { if (self.changes.indexOf(j) === -1) left++; });
    this.candidates.forEach(function (c) { if (self.changes.indexOf(c.job) === -1) left++; });
    paintButton(this.closeBtn, !busy && !this.stale && !this.scanFailed && !left
      ? 'btn-success' : 'btn-secondary');
    this.refreshAllBar();
  };

  // The listing is derived from `allSets`, every set whole as the scan found it: with
  // Exclude Organized on, an organized scene is left out of its set - listed, scored
  // and synchronized as if absent - and a set left with one scene is not a set. The
  // picked source survives where it is still listed.
  Run.prototype.deriveSets = function () {
    var self = this, m = this.matchers, hidden = 0;
    this.sets = [];
    (this.allSets || []).forEach(function (b) {
      var scenes = b.scenes.filter(function (sc) {
        if (self.excludeOrganized && sc.organized) { hidden++; return false; }
        return true;
      });
      if (scenes.length < 2) return;
      self.sets.push({ key: b.key, base: b, scenes: scenes,
        delta: setDelta(scenes, self.skip, self.coverBy,
          m ? expectedMap(scenes, m, self.naming) : null, self.naming && self.naming.baseField) });
    });
    this.setCount = this.sets.length;
    this.organizedHidden = hidden;
    var src = this.source, keep = null;
    if (src) {
      this.sets.forEach(function (set) {
        if (set.scenes.some(function (sc) { return String(sc.id) === String(src.id); })) keep = set;
      });
    }
    if (!keep) { this.source = null; this.plannedFrom = null; }
    this.sourceSet = keep;
  };

  // The weights strip: what a difference of each kind is worth, 0 to 100, and whether
  // to keep the numbers for next time. Above the listing rather than in the settings
  // page because they are read *while* looking at the scores they produce - a number
  // whose effect you cannot see is a number nobody tunes.
  Run.prototype.buildWeightBar = function () {
    var self = this;
    this.weightBar.className = 'svr-allbar';
    this.weightBar.textContent = '';
    this.weightBar.appendChild(el('span', 'svr-all-label', 'Drift score weights:'));
    [['title', 'title'], ['cover', 'cover'], ['attr', 'other attribute'],
      ['tag', 'tag'], ['performer', 'performer'], ['group', 'group']]
      .forEach(function (w) {
        var wrap = el('label', 'svr-weight');
        wrap.appendChild(el('span', null, w[1]));
        var input = el('input', 'svr-weight-box');
        input.type = 'number';
        input.min = '0';
        input.max = String(WEIGHT_MAX);
        input.value = String(self.weights[w[0]]);
        input.title = 'What one ' + w[1] + ' difference adds to a set\u2019s drift score, ' +
          '0 to ' + WEIGHT_MAX + '.';
        input.addEventListener('change', function () {
          self.weights[w[0]] = clampWeight(input.value);
          input.value = String(self.weights[w[0]]);
          self.renderSets(false);
          if (self.remember) self.saveWeights();
          self.msg('INFO', 'Re-sorted: a title difference is worth ' +
            self.weights.title + ', a cover ' + self.weights.cover + ', another attribute ' +
            self.weights.attr + ', a tag ' + self.weights.tag + ', a performer ' +
            self.weights.performer + ', a group ' + self.weights.group + '.');
        });
        self.weightInputs[w[0]] = input;
        wrap.appendChild(input);
        self.weightBar.appendChild(wrap);
      });
    // Not a weight: it decides which scenes are in the listing at all. Remembered with
    // the weights.
    var org = el('label', 'svr-weight svr-remember');
    var orgBox = el('input', 'svr-organized-box');
    orgBox.type = 'checkbox';
    orgBox.checked = !!this.excludeOrganized;
    orgBox.title = 'Leave organized scenes out of the listing: out of every set\u2019s ' +
      'drift score, out of the scenes you can pick, and out of what Synchronize Set from Selected ' +
      'pushes to. A set left with one scene is not listed.';
    orgBox.addEventListener('click', function () {
      self.excludeOrganized = !!orgBox.checked;
      self.deriveSets();
      self.renderSets(false);
      if (self.remember) self.saveWeights();
      self.msg('INFO', self.excludeOrganized
        ? 'Organized scenes left out: ' + plural(self.organizedHidden, 'scene') + ', ' +
          plural(self.sets.length, 'variant set') + ' still listed.'
        : 'Organized scenes included again: ' + plural(self.sets.length, 'variant set') +
          ' listed.');
      self.syncFooter();
    });
    this.organizedBox = orgBox;
    org.appendChild(orgBox);
    org.appendChild(el('span', null, 'Exclude Organized'));
    this.weightBar.appendChild(org);
    // Set apart from the numbers rather than reading as one more of them: it prices
    // nothing, it decides whether the six survive the dialog.
    var mem = el('label', 'svr-weight svr-remember');
    var box = el('input', 'svr-remember-box');
    box.type = 'checkbox';
    box.checked = !!this.remember;
    box.title = 'Keep these numbers in this plugin\u2019s settings, so the next review ' +
      'opens with them. Unticked, they are forgotten when this dialog closes.';
    box.addEventListener('click', function () {
      self.remember = !!box.checked;
      self.saveWeights();
    });
    this.rememberBox = box;
    mem.appendChild(box);
    mem.appendChild(el('span', null, 'Remember'));
    this.weightBar.appendChild(mem);
  };

  // Written whole, per the rule `configurePlugin` forces: it replaces the plugin's
  // stored map rather than merging into it, so a mutation naming four keys would
  // delete every other setting this plugin has. Read per write rather than off the
  // cache, since another tab may have changed something in the meantime.
  Run.prototype.saveWeights = function () {
    var self = this;
    // The pane behind this dialog prices its drift score by these, so closing after
    // a change re-reads it the way a write does.
    self.dirty = true;
    return gqlRequest('{ configuration { plugins } }', null).then(function (data) {
      var raw = ((data.configuration || {}).plugins || {})[PLUGIN_ID] || {};
      var input = {}, k;
      for (k in raw) if (hasOwn(raw, k)) input[k] = raw[k];
      for (k in WEIGHT_KEYS) {
        if (!hasOwn(WEIGHT_KEYS, k)) continue;
        // Forgetting is the key going away, not a zero: an absent weight is what
        // says "not remembered", and zero is a perfectly good weight to have chosen.
        if (self.remember) input[WEIGHT_KEYS[k]] = self.weights[k];
        else delete input[WEIGHT_KEYS[k]];
        if (_settings) _settings[WEIGHT_KEYS[k]] = self.remember ? self.weights[k] : null;
      }
      if (self.remember) input.d7ExcludeOrganized = !!self.excludeOrganized;
      else delete input.d7ExcludeOrganized;
      if (_settings) _settings.d7ExcludeOrganized = !!self.remember && !!self.excludeOrganized;
      return gqlRequest('mutation SVRSaveWeights($id: ID!, $input: Map!) ' +
        '{ configurePlugin(plugin_id: $id, input: $input) }',
      { id: PLUGIN_ID, input: input });
    }).then(null, function (err) {
      self.msg('WARN', 'The weights could not be saved: ' +
        (err && err.message ? err.message : String(err)) + '. They still apply here.');
    });
  };

  // One line per set, worst first, each opening on its arrow to a radio per member.
  // Picking a member picks the set and the source in one control, because they are one
  // decision: the scene whose values are right.
  //
  // Rebuilt in place whenever a weight moves - it is a listing, not a log line, and a
  // re-sorted copy appended below the old one would be two answers to one question.
  // The log keeps a line saying the weights moved, so Copy log still explains the
  // order on screen.
  Run.prototype.renderSets = function (first) {
    var self = this;
    var w = this.weights;
    // The radios of the last render are detached with their rows; only this render's
    // are worth clearing later.
    this.srcRadios = [];
    this.show(this.setsEl, true);
    this.show(this.splitEl, true);
    // The first time the listing shows, it and the log share the height half and half;
    // after that the bar stays where it was dragged, across rescans.
    if (!this.splitSized && this.setsEl.getBoundingClientRect) {
      var both = this.setsEl.getBoundingClientRect().height + this.logEl.getBoundingClientRect().height;
      if (both > 0) {
        this.splitSized = true;
        this.setsEl.style.height = Math.floor(both / 2) + 'px';
      }
    }
    this.sets.forEach(function (set) { set.score = scoreOf(set.delta, w); });
    var order = this.sets.slice().sort(function (a, b) {
      return b.score - a.score || String(a.key).localeCompare(String(b.key));
    });
    // One set open at a time. Opening one whose source is not the scene picked puts back
    // the scene last picked in it while this dialog has been open, or, the first time it
    // opens, picks its first scene.
    var opened = null;
    this.sets.forEach(function (set) { if (set.key === self.openKey) opened = set; });
    if (opened && this.sourceSet !== opened) {
      var was = this.picked[opened.key], back = null;
      opened.scenes.forEach(function (sc) { if (String(sc.id) === was) back = sc; });
      if (was === undefined && opened.scenes.length) {
        back = opened.scenes[0];
        this.picked[opened.key] = String(back.id);
      }
      this.source = back;
      this.sourceSet = back ? opened : null;
    }
    this.setsEl.textContent = '';
    this.setOrder = order;
    order.forEach(function (set) {
      var head = el('div', 'svr-line svr-set');
      var isOpen = set === opened;
      var toggle = el('span', 'svr-expand', isOpen ? '▾' : '▸');
      toggle.title = isOpen ? 'Close this set.'
        : 'Open to pick the scene whose values are right. The other sets close, and the ' +
          'list is sorted again by score.';
      var sub = el('div', 'svr-sub' + (isOpen ? '' : ' svr-hidden'));
      set.radios = {};
      toggle.addEventListener('click', function () {
        if (self.openKey === set.key) {
          self.openKey = null;
          self.show(sub, false);
          toggle.textContent = '▸';
          return;
        }
        self.openKey = set.key;
        self.renderSets(false);
        self.syncFooter();
      });
      head.appendChild(toggle);
      set.scoreEl = el('span', 'svr-score ' + scoreClass(set.score, w),
        ' ' + set.score + ' ');
      // What the number is: a sorting value, priced by the weights strip - the one
      // question a bare number beside a title cannot answer. Set once here; a rescore
      // rewrites the text and the class and leaves the title standing.
      set.scoreEl.title = 'The set\u2019s drift score - a sorting value, not a count: ' +
        'every disagreement in the counts to the right is worth the points its weight ' +
        'above assigns, and this is their sum per variant - divided by the number of ' +
        'other scenes in the set, rounded up - so a pair and a set of five are scored ' +
        'alike. The further apart the set has drifted, the higher it sorts.';
      head.appendChild(set.scoreEl);
      var headText = el('span', null, plural(set.scenes.length, 'scene') + ': ' +
        (set.scenes[0].title || ('Scene ' + set.scenes[0].id)) +
        (set.scenes.length > 1 ? ' + ' + (set.scenes.length - 1) + ' more' : '') +
        '  (' + deltaText(set.delta) + ')');
      // The names are in the table's own column headers, so the hover answers "how is
      // this set split" rather than repeating the line it hangs off.
      diffTip(headText, [{ node: setTable(set, self.skip, self.coverBy) }]);
      set.headEl = headText;
      head.appendChild(headText);
      self.setsEl.appendChild(head);
      set.scenes.forEach(function (sc) {
        var row = el('div', 'svr-item');
        var radio = el('input', 'svr-src-box');
        radio.type = 'radio';
        radio.checked = !!self.source && String(self.source.id) === String(sc.id);
        radio.title = 'Push this scene\u2019s values to the rest of its set.';
        radio.addEventListener('click', function () {
          // The exclusivity is ours rather than the browser's: these radios are
          // rebuilt on every re-sort, and a `name` group spanning a rebuilt subtree
          // is one the browser has no reason to keep consistent.
          self.clearSourceRadios();
          radio.checked = true;
          self.source = sc;
          self.sourceSet = set;
          self.picked[set.key] = String(sc.id);
          self.syncFooter();
        });
        set.radios[String(sc.id)] = radio;
        self.srcRadios.push(radio);
        row.appendChild(radio);
        var link = el('a', 'svr-elink', (sc.title || ('Scene ' + sc.id)) + ' [' + sc.id + ']');
        link.href = '/scenes/' + sc.id;
        link.target = linkTarget();
        link.rel = 'noopener noreferrer';
        entityTip(link, 'scenes', sc.id);
        row.appendChild(link);
        row.appendChild(el('span', 'svr-meta', '  ' + (metaOf(sc) || '')));
        sub.appendChild(row);
      });
      self.setsEl.appendChild(sub);
      if (first) {
        self.logText.push('[SET]     ' + set.score + '  ' +
          set.scenes.map(function (sc) {
            return (sc.title || ('Scene ' + sc.id)) + ' [' + sc.id + ']';
          }).join(', ') + '  (' + deltaText(set.delta) + ')');
      }
    });
    if (first) this.capLog();
  };

  // Pressing Synchronize Set from Selected: the same `planSyncScene` both other doors use, over the
  // members of one set against the picked source. Add-only, like the tab's button and
  // for the same reason - nothing here knows what the source deliberately dropped, so
  // a value only the target holds is its own.
  //
  // `changes` is not trimmed here: Undo reaches every set written while this dialog
  // has been open, in reverse order, so moving on to the next set takes nothing away.
  Run.prototype.planSet = function () {
    if (this.state !== 'listing' || !this.source ||
      String(this.source.id) === this.plannedFrom) return;
    var self = this;
    // The jobs of a set already listed are done with - their boxes stay on screen as
    // the record of what was decided, and a fresh listing follows below.
    this.jobs.forEach(function (j) { if (j.box) j.box.disabled = true; });
    this.jobs = [];
    this.msg('INFO', '--- Synchronizing from ' +
      (this.source.title || ('Scene ' + this.source.id)) + ' [' + this.source.id + '] ---');
    var others = this.sourceSet.scenes.filter(function (sc) {
      return String(sc.id) !== String(self.source.id);
    });
    this.plannedFrom = String(this.source.id);
    this.pruned = 0;
    // The covers are the one part of a plan that has to be read before it can be
    // built, so the listing is a state of its own while they land - Synchronize Set from Selected
    // is a scan like any other, and the footer already knows what to do with one.
    this.setState('scanning');
    this.progress('Reading the set as it stands now…');
    var set = this.sourceSet;
    // Read before planning, every time: the listing was built before whatever this
    // dialog has already written, and the second source out of one set is exactly the
    // press that would otherwise offer changes that have already been made.
    this.rereadSet(set).then(function (r) {
      others = r.others;
      self.covers = r.covers;
      var nmg = self.matchers ? namingOf(set.scenes, self.matchers, self.naming, self.source.id)
        : { base: { base: '', from: null }, expected: null };
      self.expected = nmg.expected;
      self.base = nmg.base;
      self.ruledTitles = 0;
      others.forEach(function (sc) { planSyncScene(self, self.source, sc, self.skip); });
      titleRuleNotes(self);
      if (!self.jobs.length) {
        self.msg('INFO', 'Nothing to synchronize: this set already agrees on every ' +
          'attribute this dialog pushes.');
      }
      reportPruneFilter(self, self.settings || {});
      self.buildAllBar();
      self.pickNext(set);
      self.setState('listing');
      self.progress(self.progressText());
    }, function (err) {
      self.plannedFrom = null;
      self.setState('listing');
      self.msg('ERROR', 'The set could not be planned: ' +
        (err && err.message ? err.message : String(err)));
    });
  };

  // The set read again, its covers with it, and its score put back on the line it is
  // already drawn on. **Not a re-render**: the score changes after a write and the
  // sort would carry the set away from the pointer that is working on it. Before a
  // plan, and after every write or undo, so the score says what the set is now.
  Run.prototype.rereadSet = function (set) {
    var self = this;
    return refreshScenes(set.scenes).then(function (fresh) {
      set.scenes.forEach(function (sc, i) {
        var got = fresh[String(sc.id)];
        if (!got) return;
        set.scenes[i] = got;
        if (set.base) {
          set.base.scenes.forEach(function (b, j) {
            if (String(b.id) === String(got.id)) set.base.scenes[j] = got;
          });
        }
        // The covers cached by the scan are as old as the scene objects were.
        if (self.coverBy) delete self.coverBy[String(sc.id)];
      });
      if (self.source) self.source = fresh[String(self.source.id)] || self.source;
      var others = set.scenes.filter(function (sc) {
        return !self.source || String(sc.id) !== String(self.source.id);
      });
      // The covers again, for the set alone: cheap where the comparison is on, and
      // `null` where it is off, exactly as it was for the scan.
      return Promise.resolve(self.source ? gatherCovers(self, self.settings, self.source, others) : null)
        .then(function (covers) {
          if (covers) {
            self.coverBy = self.coverBy || {};
            self.coverBy[String(self.source.id)] = covers.src;
            others.forEach(function (sc) {
              self.coverBy[String(sc.id)] = covers.had[String(sc.id)];
            });
          }
          self.rescoreSet(set);
          return { covers: covers, others: others };
        });
    });
  };

  // One set's score and counts, recomputed and written back onto the line it is
  // already drawn on. Deliberately not a re-render: a write makes a set agree more,
  // so its score drops, and re-sorting would move the set out from under the pointer
  // of whoever is working on it. The order is the order the listing was drawn in, and
  // it changes when the user asks for that - a weight, or a rescan.
  Run.prototype.rescoreSet = function (set) {
    if (!set || !set.scoreEl) return;
    set.delta = setDelta(set.scenes, this.skip, this.coverBy,
      this.matchers ? expectedMap(set.scenes, this.matchers, this.naming) : null,
      this.naming && this.naming.baseField);
    set.score = scoreOf(set.delta, this.weights);
    set.scoreEl.textContent = ' ' + set.score + ' ';
    set.scoreEl.className = 'svr-score ' + scoreClass(set.score, this.weights);
    if (set.headEl) {
      set.headEl.textContent = plural(set.scenes.length, 'scene') + ': ' +
        (set.scenes[0].title || ('Scene ' + set.scenes[0].id)) +
        (set.scenes.length > 1 ? ' + ' + (set.scenes.length - 1) + ' more' : '') +
        '  (' + deltaText(set.delta) + ')';
      // The table is built from the scenes as they were when the line was drawn, and
      // this is the one place they change under it - a set re-read after a write.
      diffTip(set.headEl, [{ node: setTable(set, this.skip, this.coverBy) }]);
    }
  };

  // After a set is listed, the pick moves on to the next scene in it, the first after
  // the last, so pressing again synchronizes from the next one.
  Run.prototype.pickNext = function (set) {
    var n = set.scenes.length, i = 0, src = this.source;
    set.scenes.forEach(function (sc, j) { if (String(sc.id) === String(src.id)) i = j; });
    var next = set.scenes[(i + 1) % n];
    this.source = next;
    this.picked[set.key] = String(next.id);
    this.clearSourceRadios();
    if (set.radios && set.radios[String(next.id)]) set.radios[String(next.id)].checked = true;
  };

  Run.prototype.clearSourceRadios = function () {
    this.srcRadios.forEach(function (r) { r.checked = false; });
  };

  // The "All <attribute>" boxes above the listing: one per distinct `job.group`,
  // ticking or unticking every line of that attribute across all the variants at
  // once. Built after a plan lands; a task whose jobs carry no groups never shows
  // the bar.
  Run.prototype.buildAllBar = function () {
    var self = this, groups = [], seen = {};
    this.jobs.forEach(function (j) {
      if (!j.box || !j.group || hasOwn(seen, j.group)) return;
      seen[j.group] = true;
      groups.push(j.group);
    });
    // Rebuilt from nothing: a second plan, or a rescan, would otherwise draw a second
    // row of boxes under the first, and the old row would go on steering the jobs.
    this.allBar.textContent = '';
    this.allBoxes = [];
    if (!groups.length) { this.show(this.allBar, false); return; }
    groups.forEach(function (g) {
      var lab = el('label', 'svr-all');
      var b = el('input', 'svr-all-box');
      b.type = 'checkbox';
      b._group = g;
      b.addEventListener('click', function () {
        self.jobs.forEach(function (j) {
          if (j.group === g && j.box && !j.box.disabled) j.box.checked = b.checked;
        });
        self.syncFooter();
      });
      lab.appendChild(b);
      lab.appendChild(el('span', null, 'All ' + g));
      self.allBar.appendChild(lab);
      self.allBoxes.push(b);
    });
    this.show(this.allBar, true);
    this.refreshAllBar();
  };

  // Each All box restates its group - checked while every live line of it is - so a
  // line ticked by hand is reflected upward, and the boxes lock with everything else
  // while a write is in flight.
  Run.prototype.refreshAllBar = function () {
    if (!this.allBoxes) return;
    var self = this, busy = this.state !== 'listing';
    this.allBoxes.forEach(function (b) {
      var live = [];
      self.jobs.forEach(function (j) {
        if (j.group === b._group && j.box && !j.box.disabled) live.push(j);
      });
      b.disabled = busy || !live.length;
      b.checked = !!live.length && live.every(function (j) { return j.box.checked; });
    });
  };

  // The candidate buttons and their checkboxes, kept in step with the run the same way
  // syncFooter keeps Proceed: disabled while anything is in flight - the selection is
  // read at the moment a button is pressed, so a box left live mid-write would be a
  // control that looks like it steers the run and does not - and a candidate already
  // written stays disabled until an Undo takes it back out of `changes`.
  // The review task's own controls. A source radio and a weight steer what the next
  // press plans, so both are unavailable while anything is in flight - the rule that
  // a control steering a run is locked while the run is running, with a scan counting.
  Run.prototype.syncSets = function () {
    if (!this.sets.length) return;
    var busy = this.state !== 'listing', self = this;
    this.srcRadios.forEach(function (r) { r.disabled = busy; });
    var k;
    for (k in this.weightInputs) {
      if (hasOwn(this.weightInputs, k)) this.weightInputs[k].disabled = busy;
    }
    if (this.rememberBox) this.rememberBox.disabled = busy;
    if (this.organizedBox) this.organizedBox.disabled = busy;
    this.show(this.syncSetBtn, true);
    // Pressing it a second time on the set already listed would only disable the
    // boxes in front of you and list the same jobs again below. Nothing about the
    // listing says the button has already been used on this source, so the button says it.
    var why = busy ? 'Let the pass finish, or stop it, before changing what it covers.'
      : this.stale ? 'Reload the page first: this tab is running an older script.'
        : !this.source ? 'Open a set and pick the scene whose values are right.'
          : String(this.source.id) === this.plannedFrom
            ? 'This set is already listed below.'
            : '';
    this.syncSetBtn.disabled = !!why;
    this.show(this.nextSetBtn, true);
    var nextWhy = busy ? 'Let the pass finish, or stop it, before moving on.'
      : this.sets.length < 2 && this.openKey ? 'This is the only set.' : '';
    this.nextSetBtn.disabled = !!nextWhy;
    this.nextSetBtn.title = nextWhy || (this.openKey
      ? 'Close this set and open the one below it in the list, the first after the last.'
      : 'Open the first set in the list.');
    this.syncSetBtn.title = why || ('List what would be pushed from the selected scene, "' +
      (this.source.title || ('Scene ' + this.source.id)) + '", to the ' +
      plural(this.sourceSet.scenes.length - 1, 'other scene') + ' in its set. The selection ' +
      'then moves to the next scene in the set.');
  };

  // The set below the open one in the list as it is drawn, the first after the last, or
  // the first where none is open - opened as its ▸ would, with its scene picked.
  Run.prototype.nextSet = function () {
    if (this.state !== 'listing' || !this.setOrder || !this.setOrder.length) return;
    var order = this.setOrder, at = -1, self = this;
    order.forEach(function (set, i) { if (set.key === self.openKey) at = i; });
    var next = order[(at + 1) % order.length];
    this.openKey = next.key;
    this.renderSets(false);
    this.syncFooter();
    if (next.headEl && next.headEl.scrollIntoView) next.headEl.scrollIntoView({ block: 'nearest' });
  };

  Run.prototype.syncCandidates = function () {
    if (!this.candidates.length) return;
    var busy = this.state !== 'listing', selected = 0, open = 0, self = this;
    this.candidates.forEach(function (c) {
      var done = self.changes.indexOf(c.job) !== -1;
      c.box.disabled = busy || done;
      if (done) return;
      open++;
      if (c.box.checked) selected++;
    });
    this.show(this.candLabel, true);
    this.show(this.groupBtn, true);
    this.show(this.untagBtn, true);
    this.show(this.candSep, true);
    this.show(this.selAllBtn, true);
    this.show(this.unselAllBtn, true);
    // Each is held back when it would change nothing: every open box already ticked,
    // or none.
    this.selAllBtn.disabled = busy || selected === open;
    this.unselAllBtn.disabled = busy || !selected;
    var why = busy ? 'Still working.'
      : this.stale ? 'Reload the page first: this tab is running an older script.' : '';
    this.groupBtn.disabled = !!why || selected < 2;
    this.groupBtn.title = why || (selected < 2
      ? 'Tick at least two candidate scenes: one scene cannot be a variant set.'
      : 'Write one shared pseudo stash-id into "' + this.field + '" of the ' +
        plural(selected, 'ticked scene') + ', making them one variant set. They keep ' +
        'the flag tag, which is now true of them.');
    this.untagBtn.disabled = !!why || selected < 1;
    this.untagBtn.title = why || (selected < 1
      ? 'Tick at least one candidate scene.'
      : 'Take the flag tag off the ' + plural(selected, 'ticked scene') +
        ': their flag is left over rather than deliberate.');
  };

  // A [GROUP?] line: a flagged scene with no stash-id and no field value. The task
  // cannot tell a flag that outlived its evidence from one the user just put on by hand
  // to say "group these", so the line carries a checkbox and the decision is the
  // user's - Create Variant Group for a deliberate set, Remove Tag for a leftover.
  Run.prototype.candLine = function (job) {
    var self = this;
    var name = job.title + ' [' + job.id + ']';
    var tail = '  carries the flag with no stash-id and no variant stash-id value';
    var line = el('div', 'svr-line svr-job svr-op-cand');
    var box = el('input', 'svr-cand-box');
    box.type = 'checkbox';
    box.checked = true;
    // The browser toggles `checked` before click handlers run, so reading it from here
    // sees the new state.
    box.addEventListener('click', function () { self.syncFooter(); });
    line.appendChild(box);
    line.appendChild(el('span', null, '[GROUP?]  '));
    var link = el('a', 'svr-elink', name);
    link.href = '/scenes/' + job.id;
    link.target = linkTarget();
    link.rel = 'noopener noreferrer';
    entityTip(link, 'scenes', job.id);
    line.appendChild(link);
    line.appendChild(el('span', null, tail));
    this.appendLine(line, '[GROUP?]  ' + name + tail);
    this.candidates.push({ job: job, box: box });
  };

  // A *job* line with a checkbox - unlike a candidate, it is written by Proceed, and
  // only while its box is ticked. The box hangs off the job itself, so the footer's
  // count, the write's selection and the settled state all read one thing.
  Run.prototype.tickLine = function (job, cls, head, tail, ticked, full) {
    var self = this;
    var name = job.title + ' [' + job.id + ']';
    var line = el('div', 'svr-line svr-job ' + cls);
    var box = el('input', 'svr-cand-box');
    box.type = 'checkbox';
    box.checked = ticked !== false;
    box.addEventListener('click', function () { self.syncFooter(); });
    job.box = box;
    line.appendChild(box);
    line.appendChild(el('span', null, head));
    var link = el('a', 'svr-elink', name);
    link.href = '/scenes/' + job.id;
    link.target = linkTarget();
    link.rel = 'noopener noreferrer';
    entityTip(link, 'scenes', job.id);
    line.appendChild(link);
    var sub = null;
    if (job.items) sub = this.itemPicker(job, line);
    else {
      // A tail is either a plain string or `[[text, className], ...]` - the parts a
      // line wants coloured, in the one vocabulary the head's legend explains: what a
      // variant loses is red, what it gains green, a value replaced blue, and every
      // label, name and count around them the modal's own white.
      var parts = typeof tail === 'string' ? [[tail, null]] : tail;
      var tailEl = el('span', null);
      var text = '';
      parts.forEach(function (part) {
        // A part naming entities (`part[2]`) draws each name with its hover card.
        tailEl.appendChild(part[2] ? entityNames(part[2], part[1]) : el('span', part[1] || null, part[0]));
        text += part[0];
      });
      tail = text;
      // On the tail rather than on the line: the name beside it is a link with a hover
      // card of its own, and a `title` on their common parent would be what the
      // browser showed while the pointer was over the link's own text.
      //
      // Only where the two strings differ. A value that fits and holds no newline is
      // shown whole already, and a tooltip repeating it is one more box opening over
      // a log for no reason.
      if (full && typeof full !== 'string') diffTip(tailEl, full);
      else if (full && full !== text) tailEl.title = full;
      line.appendChild(tailEl);
    }
    // The sub-list is a sibling of the line rather than a child, so the line's own text
    // stays exactly what the listing says and the sub-list travels under it.
    this.appendLine(line, head + name + tail, sub);
    this.jobs.push(job);
  };

  // `[{ type, id, name }]` as one span of names, each with the hover card every name in
  // these dialogs carries.
  function entityNames(list, cls) {
    var span = el('span', cls || null);
    list.forEach(function (x, i) {
      if (i) span.appendChild(el('span', null, ', '));
      var n = el('span', 'svr-ename', x.name);
      if (x.id != null) entityTip(n, x.type, String(x.id));
      span.appendChild(n);
    });
    return span;
  }
  // A part of a line's tail that names entities: the text Copy log keeps, and the list.
  function namesPart(list, cls) {
    var sorted = list.slice().sort(function (a, b) { return String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0; });
    return [sorted.map(function (x) { return x.name; }).join(', '), cls, sorted];
  }

  // The click-open sub-list on an additive line: one checkbox per tag or performer,
  // so a press can push some of what a variant is missing without pushing all of it.
  // The summary re-says what is picked as boxes move; the line's master box still
  // gates the whole line, and a line with nothing picked is not a change at all.
  Run.prototype.itemPicker = function (job, line) {
    var self = this;
    var toggle = el('span', 'svr-expand', ' ▸');
    toggle.title = 'Open to pick individual ' + job.noun + 's.';
    var tailEl = el('span', null, '');
    var sub = el('div', 'svr-sub svr-hidden');

    function tailText() {
      var picked = pickedItems(job);
      var count = picked.length === job.items.length
        ? plural(job.items.length, job.noun)
        : picked.length + ' of ' + plural(job.items.length, job.noun);
      return '  ' + (job.verb || 'Add') + ' ' + count + (picked.length ? ': ' +
        picked.map(function (it) { return it.name; }).sort().join(', ') : '');
    }

    // The names in it carry the line's own colour: an item picker only ever appears on
    // an add line or a remove line, so which one is the job's verb.
    function tailPaint() {
      var t = tailText(), at = t.indexOf(': ');
      while (tailEl.firstChild) tailEl.removeChild(tailEl.firstChild);
      if (at === -1) { tailEl.appendChild(el('span', null, t)); return; }
      tailEl.appendChild(el('span', null, t.slice(0, at + 2)));
      var names = namesPart(pickedItems(job).map(function (it) {
        return { type: job.tipType, id: it.id, name: it.name };
      }))[2];
      tailEl.appendChild(entityNames(names, job.verb === 'Remove' ? 'svr-del' : 'svr-add'));
    }

    toggle.addEventListener('click', function () {
      var open = hasClass(sub, 'svr-hidden');
      self.show(sub, open);
      toggle.textContent = open ? ' ▾' : ' ▸';
    });

    job.items.forEach(function (it) {
      var row = el('div', 'svr-item');
      var b = el('input', 'svr-item-box');
      b.type = 'checkbox';
      b.checked = true;
      b.addEventListener('click', function () {
        tailPaint();
        self.syncFooter();
      });
      it.box = b;
      row.appendChild(b);
      // A link with the shared hover card, like every name these dialogs draw: which
      // tag or performer this is, is exactly what a pick is decided from.
      var a = el('a', 'svr-elink', it.name);
      a.href = '/' + job.tipType + '/' + it.id;
      a.target = linkTarget();
      a.rel = 'noopener noreferrer';
      entityTip(a, job.tipType, it.id);
      row.appendChild(a);
      sub.appendChild(row);
    });

    tailPaint();
    line.appendChild(toggle);
    line.appendChild(tailEl);
    return sub;
  };

  // What the two candidate buttons do: the ticked, not-yet-written candidates through
  // the same batching, lease and undo bookkeeping as Proceed. A group press mints one
  // pseudo stash-id and writes it into every selected scene, which is what makes them a
  // set; a fresh id per press, so two presses are two sets.
  // ponytail: after a partial failure a retry press mints a new id, so the retried
  // scenes form a set of their own rather than joining the ones that succeeded - Undo
  // and one clean press is the way back.
  // A box already settled by a write stays as it is, like the hand leaves it.
  Run.prototype.tickCandidates = function (on) {
    var boxes = this.candidates.length ? this.candidates : this.jobs;
    boxes.forEach(function (c) { if (c.box && !c.box.disabled) c.box.checked = on; });
    this.syncFooter();
  };

  Run.prototype.actCandidates = function (group) {
    if (this.state !== 'listing') return;
    var self = this, task = this.task, jobs = [];
    this.candidates.forEach(function (c) {
      if (c.box.checked && !c.box.disabled) jobs.push(c.job);
    });
    if (group ? jobs.length < 2 : !jobs.length) return;
    var value = group ? pseudoStashId() : null;
    jobs.forEach(function (job) {
      job.kind = group ? 'group' : 'untag';
      job.field = self.field;
      if (group) job.value = value;
    });
    this.setState('writing');
    this.stopped = false;
    this.msg('INFO', group
      ? 'Writing "' + this.field + ' = ' + value + '" into ' +
        plural(jobs.length, 'scene') + ' - one new variant set.'
      : 'Taking the flag tag off ' + plural(jobs.length, 'scene') + '.');
    this.writeThen(null, jobs, task.writeInput, task.verb, task.leaseLabel, function () {
      self.msg('INFO', 'Done: ' + plural(self.written, 'scene') + ' ' + task.verb +
        (self.failed ? ', ' + plural(self.failed, 'failure') : '') +
        (self.stopped ? ' (stopped early; what was written stays written, and Undo takes ' +
          'back exactly that)' : '') + '.');
    });
  };

  // Every line the log gains goes through here: rendered node, plain text for Copy
  // log, the DOM cap, the spinner back at the end, and the scroll. `sub` is an optional
  // sibling drawn under the line.
  Run.prototype.appendLine = function (line, text, sub) {
    this.logEl.appendChild(line);
    if (sub) this.logEl.appendChild(sub);
    this.logged = (this.logged || 0) + 1;
    this.logText.push(text);
    // Bounded, because the copy buffer is what a library-wide run grows without limit.
    this.logDropped = (this.logDropped || 0) + keepLog(this.logText);
    this.capLog();
    if (this.spinEl) this.logEl.appendChild(this.spinEl);
    this.scrollLog();
  };

  Run.prototype.msg = function (kind, message) {
    var line = el('div', 'svr-line svr-' + kind);
    line.textContent = '[' + kind + '] ' + message;
    this.appendLine(line, '[' + kind + '] ' + message);
    if (settings().b1LogToConsole) console.info('[svr] ' + kind + ': ' + message);
  };

  // The scene is a link and a card, like every name the siblings' dialogs draw: this is
  // the list a Proceed is decided from, and a title with an id beside it is exactly what
  // cannot be recognised. `logText` keeps the plain line, so Copy log is unchanged - a
  // link and a card are not text.
  Run.prototype.jobLine = function (job) {
    var p = this.task.jobParts(job);
    // `tailParts` is the rendered tail where one piece wants a colour of its own;
    // `tail` stays the whole thing as text, so `logText` and Copy log never depend on
    // how the line was drawn.
    var tailParts = p.tailParts || [{ text: p.tail }];
    var name = job.title + ' [' + job.id + ']';
    var text = p.head + name + p.tail;
    var line = el('div', 'svr-line svr-job ' + p.cls);
    line.appendChild(el('span', null, p.head));
    var link = el('a', 'svr-elink', name);
    link.href = '/scenes/' + job.id;
    link.target = linkTarget();
    link.rel = 'noopener noreferrer';
    entityTip(link, 'scenes', job.id);
    line.appendChild(link);
    tailParts.forEach(function (part) {
      line.appendChild(el('span', part.cls || null, part.text));
    });
    this.appendLine(line, text);
  };

  // The oldest rendered lines are dropped past the cap, as in every sibling dialog: a
  // migration plans one line per scene, and a library-sized one is exactly the
  // six-figure-nodes page that stops responding. `logText` keeps all of them, so Copy log
  // and the count in the header are unaffected - the cap is about the DOM, not the log.
  // Coalescing the scroll fixed the layout thrash; it never touched the node count.
  Run.prototype.capLog = function () {
    while (this.logEl.childNodes && this.logEl.childNodes.length > LOG_RENDER_CAP) {
      this.logEl.removeChild(this.logEl.firstChild);
    }
  };

  // Coalesced: a scan page appends up to `READ_PAGE` lines in one go, and reading
  // `scrollHeight` after each of them forces a layout per line. That is what a stuttering
  // cursor and a Stop that takes a moment to answer both are - the main thread, not the
  // request. One read per burst says the same thing.
  Run.prototype.scrollLog = function () {
    var self = this;
    if (this.scrollQueued) return;
    this.scrollQueued = true;
    setTimeout(function () {
      self.scrollQueued = false;
      if (self.logEl && typeof self.logEl.scrollTop === 'number') {
        self.logEl.scrollTop = self.logEl.scrollHeight || 0;
      }
    }, 0);
  };

  Run.prototype.progress = function (text) {
    this.progressEl.textContent = text;
  };

  Run.prototype.progressText = function () {
    var parts = ['Scanned ' + (this.total
      ? this.scanned + ' of ' + plural(this.total, this.task.scanNoun)
      : plural(this.scanned, this.task.scanNoun))];
    // Right after the scanned count, where the review task's own denominator belongs:
    // sets are what that scan is for, and scenes are only how it found them.
    if (this.setCount) parts.push(plural(this.setCount, 'variant set') + ' found');
    parts.push(plural(this.jobs.length, this.task.planUnit || 'scene') + ' ' + this.task.planNoun);
    if (this.candidates.length) {
      parts.push(plural(this.candidates.length, 'candidate') + ' to group or untag');
    }
    if (this.written) parts.push(plural(this.written, this.task.planUnit || 'scene') + ' written');
    if (this.failed) parts.push(plural(this.failed, 'failure'));
    if ((this.logged || 0) > LOG_RENDER_CAP) {
      parts.push('showing the last ' + LOG_RENDER_CAP + ' of ' + this.logged + ' lines');
    }
    return parts.join('. ') + '.';
  };

  // A cursor cycling under the last line of the log for as long as work is in flight, and
  // gone the moment it is not. It carries no `-line` class, since it is not a message and
  // must not be read back as one.
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
    this.spinEl = el('div', 'svr-spin', frames[0]);
    this.logEl.appendChild(this.spinEl);
    this.spinTimer = setInterval(function () {
      i = (i + 1) % frames.length;
      if (self.spinEl) self.spinEl.textContent = frames[i];
    }, 500);
  };


  Run.prototype.copyLog = function () {
    var self = this;
    var text = [this.progressEl.textContent, droppedLine(this.logDropped)].filter(Boolean)
      .concat(this.logText).join('\n');
    var was = this.copyBtn.textContent;
    copyToClipboard(text, function (ok) {
      holdWidth(self.copyBtn);
      self.copyBtn.textContent = ok ? 'Copied' : 'Failed';
      setTimeout(function () { self.copyBtn.textContent = was; }, 2000);
    });
  };

  Run.prototype.reveal = function () {
    this.backdrop.className = 'svr-backdrop';
  };

  Run.prototype.stop = function () {
    if (this.state !== 'writing' && this.state !== 'undoing') return;
    if (this.stopped) return;
    this.stopped = true;
    this.msg('WARN', 'Stopping after the request in flight…');
  };

  // A rescan starts a *pass*, not a session: the log is the record of what this dialog
  // has already done, and `changes` is what Undo can still reverse - converging on an
  // empty plan must not cost either. Everything a pass builds goes: the jobs, the
  // candidates, the sets and the source picked among them, and the counters.
  //
  // The old plan's lines stay on screen, because the log does; their boxes are locked
  // so that a listing nobody can act on cannot be ticked, which is the same thing
  // `planSet` does when it moves to a new set.
  Run.prototype.rescan = function () {
    if (this.state !== 'listing') return;
    this.jobs.forEach(function (j) {
      if (j.box) j.box.disabled = true;
      if (j.items) j.items.forEach(function (it) { if (it.box) it.box.disabled = true; });
    });
    this.jobs = [];
    this.candidates.forEach(function (c) { c.box.disabled = true; });
    this.candidates = [];
    this.sets = [];
    this.allSets = [];
    this.setCount = 0;
    this.srcRadios = [];
    this.source = null;
    this.sourceSet = null;
    this.plannedFrom = null;
    this.pruned = 0;
    this.setsEl.textContent = '';
    this.show(this.setsEl, false);
    this.show(this.splitEl, false);
    this.show(this.weightBar, false);
    this.show(this.allBar, false);
    this.show(this.syncSetBtn, false);
    this.show(this.nextSetBtn, false);
    this.show(this.candLabel, false);
    this.show(this.groupBtn, false);
    this.show(this.untagBtn, false);
    this.show(this.candSep, false);
    this.show(this.selAllBtn, false);
    this.show(this.unselAllBtn, false);
    this.scanned = 0;
    this.total = 0;
    this.written = 0;
    this.failed = 0;
    this.scanFailed = false;
    // A rescan starts a fresh log, as the siblings' do: what it lists is all that holds.
    while (this.logEl.firstChild) this.logEl.removeChild(this.logEl.firstChild);
    this.logText = [];
    this.logged = this.logDropped = 0;
    this.begin();
  };

  Run.prototype.close = function () {
    // What ends a scan: the paging checks this before asking for the next page, so a
    // closed dialog stops reading rather than filling a log nobody can see.
    this.stopped = true;
    unwireEscape(this);
    this.spin(false);
    diffTipClose();
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    _active = null;
    if (_paneLock) _paneLock(false);
    // A run that wrote - or put back - changed the very scenes the pane behind this
    // dialog is listing, and that list was read before the dialog opened. Closing is
    // when the user comes back to it, so closing is when it re-reads. An undo counts:
    // a stopped one leaves part of the writes standing, and a completed one is one
    // wasted read rather than a stale list. No pane mounted (the settings-page tasks)
    // is a no-op.
    if (this.dirty && _paneRefresh) _paneRefresh();
  };

  // Escape acts through whichever of the footer's exits is showing and enabled, never by
  // calling `close()` itself. The footer is the dialog's own statement of what it will let
  // you do right now, so the key can never reach a button that is hidden or disabled - and
  // in particular does nothing mid-write.
  function escapeButton(run) {
    var b = run.closeBtn;
    return b && !b.disabled && !hasClass(b, 'svr-hidden') ? b : null;
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

  // ── The scan ──────────────────────────────────────────────────────────────

  // The shared half of every scan: the stale check, the foreign-lease note, and the
  // transition back to a listing whatever the task's own `begin` did. A task's `begin`
  // resolves to an optional progress override for the runs that never scanned anything.
  Run.prototype.begin = function () {
    var self = this;
    this.setState('scanning');
    this.stopped = false;
    this.progress('Reading your settings and the tag hierarchy…');
    checkStale(this);
    var lease = foreignLease();
    if (lease) {
      // Noted, never stood down for: this run was started by hand, and §7's rule is that
      // a manual action is not suppressed. What it buys the reader is an explanation for
      // a scene that looks a moment out of date.
      this.note('Another plugin is running a bulk edit here (' + lease.label + '), so a ' +
        'scene may be read a moment behind what it holds.');
    }
    Promise.resolve().then(function () { return self.task.begin(self); })
      .then(function (finalProgress) {
        self.setState('listing');
        self.progress(finalProgress || self.progressText());
      }, function (err) {
        self.scanFailed = true;
        self.setState('listing');
        self.msg('ERROR', 'The scan failed: ' + (err && err.message ? err.message : String(err)));
        self.progress(self.progressText());
      });
  };

  function migrateBegin(run) {
    return Promise.all([settingsReady(), tagTree(), fieldLocks()]).then(function (both) {
      var s = both[0];
      var m = matchers(both[1], s);
      var field = fieldName(s);
      run.field = field;
      run.locks = both[2];
      run.lockedSkips = 0;
      var conflict = conflictNote(m);
      if (conflict) run.msg('WARN', conflict);
      var tags = tagIdsFor(m);
      if (!tags.length) {
        run.msg('WARN', 'Neither the full-duration nor the partial-duration tag setting names ' +
          'a tag in your library, so there is nothing to classify. Name them in this ' +
          'plugin’s settings first.');
        return 'Nothing to scan.';
      }
      run.msg('INFO', 'Looking through every scene tagged full-duration or partial-duration ' +
        'for a stash-id to move into "' + field + '".');
      return run.scanPage(1, m, field, tags).then(function () {
        if (run.lockedSkips) {
          run.msg('WARN', 'Left alone: ' + plural(run.lockedSkips, 'scene') + ' already ' +
            'holding a different value in "' + field + '". ' + (run.locks === false
              ? 'ᝯㄝₓ Custom Fields Bulk Editor could not say which custom fields are ' +
                'locked, so none is changed.' : lockRefusal(field)));
        } else if (run.locks === null && run.jobs.length) {
          run.msg('INFO', 'ᝯㄝₓ Custom Fields Bulk Editor is not installed, or too old to ' +
            'publish its Locked Custom Fields list, so no custom field is locked for this run.');
        }
        if (!run.jobs.length) {
          run.msg('INFO', 'Nothing to migrate: every tagged scene either carries no ' +
            'stash-id or has been through this already.');
        }
        return null;
      });
    });
  }

  // A scene holding a pseudo line *and* a real stash-id is making two different claims
  // about what names the work - a hand-made grouping and a provider entry - and this
  // task's rewrite keeps only the second. Flagged, never resolved: which claim wins is
  // the user's call, and the line says what a Proceed would do so the call is an
  // informed one. A full scene carrying only its real stash-id is the ordinary case,
  // not this.
  function warnPseudoDrift(run, scene, field) {
    var pseudos = splitValues(customField(scene, field)).filter(function (v) {
      return v.indexOf('pseudo:') === 0;
    });
    if (!pseudos.length || !(scene.stash_ids || []).length) return;
    run.msg('WARN', 'Potential drift: "' + (scene.title || ('Scene ' + scene.id)) +
      '" [' + scene.id + '] carries ' + plural(pseudos.length, 'pseudo line') + ' (' +
      pseudos.join(', ') + ') and a real stash-id at once - an inconsistent state this ' +
      'task does not resolve. Proceeding rewrites the field from the real stash-id and ' +
      'drops the pseudo line, which takes the scene out of its hand-made set.');
  }

  // Paged rather than `per_page: -1`, which is what the rest of this plugin uses: a
  // library-wide scan is the one query here whose answer grows with the library, and the
  // counters are only worth having if they move while it runs.
  Run.prototype.scanPage = function (page, m, field, tags) {
    var self = this;
    return gqlRequest(MIGRATE_QUERY, {
      f: { page: page, per_page: READ_PAGE, sort: 'id', direction: 'ASC' }, tags: tags,
    }).then(function (data) {
      var answer = ((data || {}).findScenes) || {};
      var scenes = answer.scenes || [];
      self.total = answer.count || self.total;
      scenes.forEach(function (scene) {
        self.scanned++;
        warnPseudoDrift(self, scene, field);
        var job = planScene(scene, m, field);
        if (!job) return;
        // Adding the field is allowed; changing a value it already holds is not - and a
        // partial's stash-ids must not come off where the field cannot take them.
        if (job.had != null && job.had !== job.value && fieldLocked(self.locks, field)) {
          self.lockedSkips++;
          return;
        }
        self.jobs.push(job);
        self.jobLine(job);
      });
      self.progress(self.progressText());
      // `stopped` here means the dialog was closed: stop reading.
      if (self.stopped || scenes.length < READ_PAGE) return null;
      return self.scanPage(page + 1, m, field, tags);
    });
  };

  // ── Writing, and taking it back ───────────────────────────────────────────

  // The one road every write takes, forward or back: the lease is taken here and given
  // back whatever happens, the dialog returns to its listing, and only then is the
  // outcome said. `before` is the write-phase step a task may need before its first
  // scene - the flag task creates its tag there when the library has none, because a
  // tag must not be created by a scan, and a failure has to leave a listing nobody has
  // acted on.
  // Undo History, where ᝯㄝₓ Core keeps one: each write recorded from the input it sent
  // and the one that puts it back, a pass per press.
  function journalPass(label) {
    var j = coop().journal;
    return j && typeof j.pass === 'function'
      ? j.pass({ plugin: PLUGIN_SHORT_NAME, label: label, libraryWide: true }) : null;
  }

  Run.prototype.writeThen = function (before, jobs, build, verb, leaseLabel, say) {
    var self = this;
    var lease = acquireLease(leaseLabel);
    self.renamed = [];
    var pass = self.journalRun = journalPass(/\(undo\)$/.test(leaseLabel)
      ? leaseLabel.replace(/\s*\(undo\)$/, ', undone') : leaseLabel);
    function settle(err) {
      self.journalRun = null;
      if (pass) pass.finish().then(function (line) { if (line) self.msg('INFO', line); });
      lease.release();
      self.setState('listing');
      self.progress(self.progressText());
      if (err) {
        self.msg('ERROR', 'Nothing was written: ' +
          (err && err.message ? err.message : String(err)));
      } else say();
      handRenames(self);
      if (self.sourceSet) {
        self.rereadSet(self.sourceSet).then(null, function (e) {
          self.msg('WARN', 'The set could not be read again, so its score is as it was: ' +
            (e && e.message ? e.message : String(e)));
        });
      }
    }
    Promise.resolve().then(function () { return before ? before() : null; })
      .then(function () { return self.writeAll(jobs, build, verb, lease); })
      .then(function () { settle(null); },
        function (err) { settle(err || new Error('unknown failure')); });
  };

  Run.prototype.go = function () {
    if (this.state !== 'listing') return;
    var self = this, task = this.task;
    // Read before the state change: mid-write every box is disabled, and a selection
    // has to be what the user saw at the moment of the press.
    var jobs = this.tickedJobs();
    this.setState('writing');
    this.stopped = false;
    this.msg('INFO', 'Writing ' + plural(jobs.length, task.planUnit || 'scene') + '.');
    this.writeThen(function () {
      return refreshLocks(self).then(function () { return task.prepare ? task.prepare(self) : null; });
    }, jobs, task.writeInput, task.verb, task.leaseLabel, function () {
        self.msg('INFO', 'Done: ' + plural(self.written, task.planUnit || 'scene') + ' ' + task.verb +
          (self.failed ? ', ' + plural(self.failed, 'failure') : '') +
          (self.stopped ? ' (stopped early; what was written stays written, and Undo takes ' +
            'back exactly that)' : '') + '.');
      });
  };

  Run.prototype.undo = function () {
    if (this.state !== 'listing') return;
    var self = this, task = this.task;
    var jobs = this.changes.slice().reverse();
    this.setState('undoing');
    this.stopped = false;
    this.msg('INFO', 'Putting back what ' + plural(jobs.length, this.task.planUnit || 'scene') +
      ' held before.');
    this.written = 0;
    this.failed = 0;
    // `changes` is emptied a scene at a time by the write itself rather than upfront, so
    // a stopped or failed reversal still knows what it did not reach. Empty at the end
    // means back to a listing nobody has used, and Proceed offers the same jobs again.
    this.writeThen(function () { return refreshLocks(self); }, jobs, task.undoInput, 'put back',
      task.leaseLabel + ' (undo)',
      function () {
        self.msg('INFO', 'Undone: ' + plural(self.written, task.planUnit || 'scene') + ' put back' +
          (self.failed ? ', ' + plural(self.failed, 'failure') : '') +
          (self.stopped ? ' (stopped early; what was put back stays put back)' : '') + '.');
        self.written = 0;
      });
  };

  // Batched so the log and the counters stay live on a long run, and so a failure is one
  // scene rather than the whole plan. The lease is renewed per batch rather than taken
  // once for the lot: what a crashed tab leaves behind is one batch, not the run.
  Run.prototype.writeAll = function (jobs, build, verb, lease) {
    var self = this;

    function batch(i) {
      if (i >= jobs.length || self.stopped) return Promise.resolve();
      lease.renew();
      var slice = jobs.slice(i, i + WRITE_CHUNK);
      return Promise.all(slice.map(function (job) {
        // The builder runs inside the promise so a throw in it is this job's failure,
        // logged like a refused write, rather than an exception out of the click.
        var req = null;
        return Promise.resolve().then(function () {
          req = build(job, self);
          return gqlRequest(req.query, req.variables);
        }).then(function () {
          self.written++;
          self.dirty = true;
          var forward = verb === self.task.verb;
          // The forward input is kept on the job, so its undo is recorded against it
          // without calling a builder a second time.
          if (self.journalRun && req && req.variables && req.variables.input) {
            var sent = req.variables.input, back = null;
            if (forward) {
              job.journalSent = sent;
              try { back = self.task.undoInput(job, self); } catch (e) { back = null; }
              back = back && back.variables ? back.variables.input : null;
            } else {
              back = job.journalSent || null;
            }
            self.journalRun.add('scenes', job.id, job.title || '', sent, back || {});
          }
          if (forward) self.changes.push(job);
          else {
            var ix = self.changes.indexOf(job);
            if (ix >= 0) self.changes.splice(ix, 1);
          }
          // A title written is a rename, and so is one put back - see `handRenames`.
          if (job.kind === 'set' && job.input === 'title') {
            var was = job.had == null ? '' : String(job.had), now = job.value == null ? '' : String(job.value);
            (self.renamed = self.renamed || []).push({ id: job.id, from: forward ? was : now, to: forward ? now : was });
          }
          self.msg('INFO', job.title + ' [' + job.id + ']: ' + verb + '.');
        }, function (e) {
          self.failed++;
          self.msg('ERROR', job.title + ' [' + job.id + ']: ' +
            (e && e.message ? e.message : String(e)));
        });
      })).then(function () {
        self.progress(self.progressText());
        return batch(i + WRITE_CHUNK);
      });
    }

    return batch(0);
  };

  // ── Is this script the one Stash has installed? ───────────────────────────
  //
  // Stash serves plugin JS with caching on, so "Reload plugins" cannot replace a script
  // this page already executed. The settings page has this in its heading; a dialog does
  // not, so it asks - and a stale script is refused the write rather than merely warned
  // about, because what it would write is last release's idea of the plan.
  function checkStale(run) {
    gqlRequest('query SVRPluginVersion { plugins { id version } }', null)
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
        run.staleEl.textContent = '⚠ This page is still running ' + PLUGIN_SHORT_NAME + ' ' +
          PLUGIN_VERSION + ', but ' + installed + ' is installed. Press Ctrl+Shift+R ' +
          '(⌘+Shift+R on a Mac) and open this again: nothing will be written until you do.';
        staleReloadButton(run.staleEl);
        run.show(run.staleEl, true);
        run.syncFooter();
      });
  }

  // ── The two tasks ─────────────────────────────────────────────────────────

  var MIGRATE_TASK = {
    title: 'Migrate Variant Stash-IDs',
    legend: 'One line per scene: whether it is full-duration or partial-duration, the scene ' +
      'with its id in brackets, and the value its custom field will hold. A ' +
      'partial-duration scene also has its stash-ids removed, which is what the migration ' +
      'is for; a full-duration one keeps them.',
    nothing: 'Nothing found to migrate.',
    scanNoun: 'tagged scene',
    planNoun: 'to migrate',
    leaseLabel: 'Variant stash-id migration',
    undoTip: 'Put back the custom field and the stash-ids of every scene this ' +
      'dialog wrote. Only what it wrote, and only while it stays open.',
    verb: 'migrated',
    begin: migrateBegin,
    jobParts: function (job) {
      return {
        head: (job.role === 'fl' ? ROLES.fl.label : ROLES.pl.label) + '  ',
        cls: 'svr-role-' + job.role,
        tail: '  ' + job.field + ' = ' + job.value.split('\n').join(' + ') +
          (job.clear ? '  (stash-ids removed)' : ''),
      };
    },
    writeInput: function (job, run) {
      if (job.had != null && job.had !== job.value && fieldLocked(run.locks, job.field)) {
        throw new Error('not written: ' + lockRefusal(job.field));
      }
      return { query: SCENE_UPDATE, variables: { input: writeInput(job) } };
    },
    // Where the write added the field, putting it back means taking it off - which a
    // lock refuses. That scene keeps what the write gave it; the rest are put back.
    undoInput: function (job, run) {
      if (job.had == null && fieldLocked(run.locks, job.field)) {
        throw new Error('not put back: ' + lockRefusal(job.field));
      }
      return { query: SCENE_UPDATE, variables: { input: undoInput(job) } };
    },
  };

  // ── The flag task ─────────────────────────────────────────────────────────
  //
  // Keeps one tag - configurable, `FLAG_DEFAULT` by default - in step with the library:
  // on every scene that shares a variant stash-id line with at least one other scene,
  // and off every scene it marks that no longer does. The tag is what makes "show me
  // the scenes offering a choice of variants" one click on Stash's own tag filter; it
  // is not a source of truth, only what the last run of this task found.
  //
  // The matching is the tab's own, deliberately: a scene's lines are its stash-ids as
  // `variantValue` spells them plus whatever its field holds, and two scenes sharing
  // any one line are variants of one work - the same line-level rule the tab's
  // MATCHES_REGEX lookup applies.
  //
  // Three paged passes rather than one query, because there is no OR across criteria:
  // scenes carrying a stash-id, scenes carrying the field, and - so a scene that has
  // lost both is still unflagged - scenes carrying the flag tag itself.
  var FLAG_SCENE_SEL =
    '{ count scenes { id title files { basename } tags { id } custom_fields ' +
    'stash_ids { endpoint stash_id } } }';

  var FLAG_BY_STASHID_QUERY =
    'query SVRFlagScanIds($f: FindFilterType) { findScenes(' +
    'scene_filter: { stash_ids_endpoint: { modifier: NOT_NULL } }, filter: $f) ' +
    FLAG_SCENE_SEL + ' }';
  var FLAG_BY_FIELD_QUERY =
    'query SVRFlagScanField($f: FindFilterType, $field: String!) { findScenes(' +
    'scene_filter: { custom_fields: [{ field: $field, value: [], modifier: NOT_NULL }] }, ' +
    'filter: $f) ' + FLAG_SCENE_SEL + ' }';
  var FLAG_BY_TAG_QUERY =
    'query SVRFlagScanTag($f: FindFilterType, $tags: [ID!]) { findScenes(' +
    'scene_filter: { tags: { value: $tags, modifier: INCLUDES, depth: 0 } }, filter: $f) ' +
    FLAG_SCENE_SEL + ' }';

  function sceneKeys(scene, field) {
    var out = variantValues(scene.stash_ids), seen = {}, i;
    for (i = 0; i < out.length; i++) seen[out[i]] = true;
    splitValues(customField(scene, field)).forEach(function (v) {
      if (!hasOwn(seen, v)) { seen[v] = true; out.push(v); }
    });
    return out;
  }

  // One pass of the scan: pages through one query, collecting scenes not already seen
  // by an earlier pass. `total` is left alone - the three counts overlap, so there is
  // no honest denominator and the progress line counts scenes rather than promising one.
  function flagScanPass(run, query, vars, seen, scenes, keep) {
    function page(p) {
      var v = { f: { page: p, per_page: READ_PAGE, sort: 'id', direction: 'ASC' } }, k;
      for (k in vars) if (hasOwn(vars, k)) v[k] = vars[k];
      return gqlRequest(query, v).then(function (data) {
        var got = ((((data || {}).findScenes) || {}).scenes) || [];
        got.forEach(function (sc) {
          if (hasOwn(seen, String(sc.id))) return;
          seen[String(sc.id)] = true;
          scenes.push(keep ? keep(sc) : sc);
          run.scanned++;
        });
        // A task that can say more about what it has read so far says it here, before
        // the counters are drawn - the review task counts the sets in what has landed,
        // which is the number its whole listing is about.
        if (run.afterPage) run.afterPage(scenes);
        run.progress(run.progressText());
        if (run.stopped || got.length < READ_PAGE) return null;
        return page(p + 1);
      });
    }
    return page(1);
  }

  function flagBegin(run) {
    return Promise.all([settingsReady(), tagTree()]).then(function (both) {
      var s = both[0];
      var field = fieldName(s), name = flagTagName(s);
      run.field = field;
      // Exact name or alias, never descendants: the flag is one machine-kept tag, and a
      // scene wearing a child of it is not wearing it.
      var hits = tagsMatchingName(both[1], name);
      // None under the configured name: the tag may be wearing a default this shipped
      // with before, or be known only by the alias this plugin gives it - either way it
      // is this plugin's own tag, and a twin could not carry that alias. Proceed renames
      // it rather than creating one. Live: the default's respelling reached the setting
      // and not the tag, and every Proceed failed on the alias.
      var legacy = null;
      if (!hits.length) LEGACY_FLAG_DEFAULTS.concat([FLAG_TAG_ALIAS]).forEach(function (old) {
        if (!legacy) legacy = tagsMatchingName(both[1], old)[0] || null;
      });
      run.flagTagId = hits.length ? String(hits[0].id) : legacy ? String(legacy.id) : null;
      run.flagRename = legacy ? legacy.name : null;
      run.flagTagName = name;
      if (hits.length > 1) {
        run.msg('WARN', plural(hits.length, 'tag') + ' answer to "' + name + '"; using "' +
          hits[0].name + '" [' + hits[0].id + '].');
      }
      if (!run.flagTagId) {
        run.msg('INFO', 'No tag named "' + name + '" exists yet; Proceed will create it.');
      } else if (run.flagRename) {
        run.msg('INFO', 'No tag named "' + name + '" exists yet, but "' + run.flagRename + '" [' +
          run.flagTagId + '] is this plugin\'s flag tag under an earlier name; Proceed will ' +
          'rename it, and every scene wearing it keeps it.');
      }
      run.msg('INFO', 'Looking for every scene that shares a stash-id or a "' + field +
        '" line with another scene, to put "' + name + '" on exactly those.');
      var seen = {}, scenes = [];
      // What the plan reads of a scene, taken as its page lands: the scene as read is
      // not kept, so the scan holds a few strings per scene rather than its tags and
      // every custom field.
      var keep = function (sc) {
        return { id: sc.id, name: sceneName(sc), keys: sceneKeys(sc, field),
          flagged: !!run.flagTagId && (sc.tags || []).some(function (t) {
            return String(t.id) === run.flagTagId;
          }) };
      };
      return flagScanPass(run, FLAG_BY_STASHID_QUERY, {}, seen, scenes, keep)
        .then(function () {
          return run.stopped ? null
            : flagScanPass(run, FLAG_BY_FIELD_QUERY, { field: field }, seen, scenes, keep);
        })
        .then(function () {
          return (run.stopped || !run.flagTagId) ? null
            : flagScanPass(run, FLAG_BY_TAG_QUERY, { tags: [run.flagTagId] }, seen, scenes, keep);
        })
        .then(function () {
          if (run.stopped) return null;
          // Which scenes share a line: ids per line, then each scene's partners are the
          // union over its lines minus itself. The count goes in the log - the tag
          // cannot carry it, and the listing is where a number is worth a glance.
          var byKey = {};
          scenes.forEach(function (sc) {
            sc.keys.forEach(function (k) {
              (byKey[k] = byKey[k] || []).push(String(sc.id));
            });
          });
          // How many sets, not only how many scenes: connected components over shared
          // lines, counted where they hold two or more. Union-find, because two scenes
          // can be one set through a chain of overlapping lines without sharing one.
          var parent = {};
          function findRoot(x) {
            while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
            return x;
          }
          scenes.forEach(function (sc) { parent[String(sc.id)] = String(sc.id); });
          var k2;
          for (k2 in byKey) {
            if (!hasOwn(byKey, k2)) continue;
            for (var i2 = 1; i2 < byKey[k2].length; i2++) {
              parent[findRoot(byKey[k2][i2])] = findRoot(byKey[k2][0]);
            }
          }
          var sizes = {}, setCount = 0;
          scenes.forEach(function (sc) {
            var r = findRoot(String(sc.id));
            sizes[r] = (sizes[r] || 0) + 1;
            if (sizes[r] === 2) setCount++;
          });
          scenes.forEach(function (sc) {
            var id = String(sc.id), partners = {}, n = 0;
            var keys = sc.keys;
            keys.forEach(function (k) {
              byKey[k].forEach(function (other) {
                if (other !== id && !hasOwn(partners, other)) { partners[other] = true; n++; }
              });
            });
            var flagged = sc.flagged;
            // A flagged scene with no evidence at all is not unflagged by machine: the
            // flag is either left over or the user's own "group these" mark, and the
            // two are indistinguishable from here. Listed as a [GROUP?] candidate and
            // decided by the buttons instead.
            if (flagged && !keys.length) {
              run.candLine({ id: id, title: sc.name });
              return;
            }
            if (!!flagged === (n > 0)) return;
            var job = { id: id, title: sc.name, flag: n > 0, others: n };
            run.jobs.push(job);
            run.jobLine(job);
          });
          // After the listing, not before it: this is the summary, and the log scrolls
          // to its newest line - a count printed first is off the top of a long plan
          // the moment the plan lands, and past the render cap it is not even in the
          // DOM any more. Last is the one position a summary is guaranteed to be read
          // in.
          run.msg('INFO', plural(setCount, 'multi-variant set') + ' detected in the library.');
          if (run.candidates.length) {
            run.msg('INFO', plural(run.candidates.length, 'scene carries', 'scenes carry') +
              ' the flag with no stash-id and no "' + field + '" value - tagged by hand ' +
              'to make a set, or left over from evidence since removed. Tick the ones ' +
              'that belong together and press Create Variant Group, or Remove Tag for ' +
              'the leftovers.');
          }
          if (!run.jobs.length && !run.candidates.length) {
            run.msg('INFO', 'Nothing to change: the flag tag already marks exactly the ' +
              'scenes that have another variant.');
          }
          return null;
        });
    });
  }

  // What the created tag carries, beyond its name. The whole input shape is the one
  // CustomFieldsBulkEditor's store tag already creates live - description, aliases,
  // ignore_auto_tag and a plain custom-fields map are all TagCreateInput fields there.
  //
  // The two marks are other plugins' vocabularies, written the way each reads them:
  // CFBE's hide-from-add-lists mark is value-read (`isMarked`, where 0 is present but
  // off - the key is there for the user to flip on without retyping the name), and the
  // do-not-propagate mark is presence-read in MPTTS (the value is never inspected), so
  // 1 simply says what it means. No parents: the tag is an orphan by design - a
  // machine-kept flag filed under anything would put the hierarchy plugins in play.
  var FLAG_TAG_ALIAS = 'GTTx Multiple Variants';
  var FLAG_TAG_DESCRIPTION = '[Personal∙Tag] ᝯㄝₓ Scene Variants - This scene was ' +
    'associated with at least another variant during the last Flag Variants task run. ' +
    'Re-Run Flag Variants task to update entire library.';

  function flagTagCreateInput(name) {
    var marks = {};
    marks['ᱜ╦╦🞮_exclude_from_add_list'] = 0;
    marks['ᱜ╦╦🞮_Do_Not_Propagate_Tag'] = 1;
    return { name: name, description: FLAG_TAG_DESCRIPTION, aliases: [FLAG_TAG_ALIAS],
      ignore_auto_tag: true, custom_fields: marks };
  }

  // The tag is created on Proceed, never by the scan - a scan is a read - and a failure
  // here rejects the whole write, leaving a listing nobody has acted on.
  function flagPrepare(run) {
    if (run.flagTagId && !run.flagRename) return null;
    if (run.flagRename) {
      return gqlRequest('mutation SVRRenameTag($input: TagUpdateInput!) ' +
        '{ tagUpdate(input: $input) { id } }', { input: { id: run.flagTagId, name: run.flagTagName } })
        .then(function (data) {
          if (!data || !data.tagUpdate) {
            throw new Error('the tag "' + run.flagRename + '" could not be renamed to "' +
              run.flagTagName + '"');
          }
          run.msg('INFO', 'Renamed the tag "' + run.flagRename + '" [' + run.flagTagId + '] to "' +
            run.flagTagName + '". Undo leaves the name.');
          run.flagRename = null;
          _tagsAt = 0;   // the cached tree still says the old name
        });
    }
    return gqlRequest('mutation SVRCreateTag($input: TagCreateInput!) ' +
      '{ tagCreate(input: $input) { id } }', { input: flagTagCreateInput(run.flagTagName) })
      .then(function (data) {
        var t = (data || {}).tagCreate;
        if (!t || !t.id) throw new Error('the tag "' + run.flagTagName + '" could not be created');
        run.flagTagId = String(t.id);
        run.msg('INFO', 'Created the tag "' + run.flagTagName + '" [' + t.id + '] - an ' +
          'orphan, ignored by auto-tagging, marked never-propagate, with the alias "' +
          FLAG_TAG_ALIAS + '". Undo takes it off the scenes and leaves the tag itself ' +
          'in place.');
      });
  }

  var BULK_TAG_MUTATION =
    'mutation SVRFlagWrite($input: BulkSceneUpdateInput!) { bulkSceneUpdate(input: $input) { id } }';

  // ADD / REMOVE rather than a full tag_ids replace, so a tag somebody put on the scene
  // between the scan and the press is not clobbered - the mutation names only the flag.
  // The inverse is the opposite mode, and both are idempotent on the server, which is
  // what lets a stopped undo be pressed again.
  function flagInput(job, run, add) {
    return { query: BULK_TAG_MUTATION, variables: { input: {
      ids: [job.id], tag_ids: { ids: [run.flagTagId], mode: add ? 'ADD' : 'REMOVE' },
    } } };
  }

  var FLAG_TASK = {
    title: 'Flag Variants',
    goLabel: '[Flag]/[Unflag]: ',
    legend: 'One line per scene: FLAG where the tag goes on, because at least one other ' +
      'scene shares one of its variant stash-id lines, and UNFLAG where it comes off, ' +
      'because none does any more. Only the flag tag moves; nothing else on the scene ' +
      'is touched. A scene carrying the flag with no stash-id and no field value is a ' +
      'GROUP? line with a checkbox instead - either you tagged it yourself to say ' +
      '"these are variants", or its flag outlived the evidence. Tick the ones that ' +
      'belong together and Create Variant Group writes one shared pseudo stash-id ' +
      'into their field; Remove Tag takes the flag off the ticked leftovers.',
    nothing: 'Nothing to flag or unflag.',
    scanNoun: 'scene',
    planNoun: 'to flag or unflag',
    leaseLabel: 'Variant flagging',
    undoTip: 'Put the flag tag back the way it was on every scene this dialog wrote. ' +
      'Only what it wrote, and only while it stays open.',
    verb: 'updated',
    begin: flagBegin,
    prepare: flagPrepare,
    jobParts: function (job) {
      if (!job.flag) {
        return { head: '[UNFLAG]  ', cls: 'svr-op-unflag',
          tail: '  no other scene shares its ids' };
      }
      // The count in its own colour - blue for exactly one partner, amber for a real
      // choice - so a listing of hundreds scans by number. `tail` carries the same
      // words as text for the log.
      var word = '  shares its ids with ';
      var rest = plural(job.others, 'other scene').replace(/^\d+/, '');
      return { head: '[FLAG]    ', cls: 'svr-op-flag',
        tail: word + job.others + rest,
        tailParts: [{ text: word },
          { text: String(job.others), cls: job.others > 1 ? 'svr-num-many' : 'svr-num-one' },
          { text: rest }] };
    },
    // Three job shapes through one pair of builders: the scan's FLAG/UNFLAG, and the
    // two things a candidate button can do to a scene. A group write is a sceneUpdate
    // on the custom field - the candidates carry no value by definition, so the exact
    // inverse is removing the field, not restoring one.
    writeInput: function (job, run) {
      if (job.kind === 'group') {
        var input = { id: job.id, custom_fields: { partial: {} } };
        input.custom_fields.partial[job.field] = job.value;
        return { query: SCENE_UPDATE, variables: { input: input } };
      }
      if (job.kind === 'untag') return flagInput(job, run, false);
      return flagInput(job, run, job.flag);
    },
    undoInput: function (job, run) {
      if (job.kind === 'group') {
        if (fieldLocked(run.locks, job.field)) {
          throw new Error('not put back: ' + lockRefusal(job.field));
        }
        return { query: SCENE_UPDATE, variables: { input:
          { id: job.id, custom_fields: { remove: [job.field] } } } };
      }
      if (job.kind === 'untag') return flagInput(job, run, true);
      return flagInput(job, run, !job.flag);
    },
  };

  // ── The synchronize task ──────────────────────────────────────────────────
  //
  // Opened from the Variants pane, never from Settings - Tasks: it pushes *this*
  // scene's values to its variants, and only the scene page knows which scene that is.
  // The direction is the whole design - the scene the user is standing on is the
  // source, so there is no "which of the selected wins" question to invent an answer
  // to.
  //
  // One job per attribute per variant, each a checkbox line, ticked by default except
  // titles. Scalars are replaces, listed old -> new; tags and performers are ADDs and
  // never removes, so whatever makes a variant deliberately different survives a
  // Proceed with everything ticked. The dimension tags (full-duration, partial-duration
  // and everything under them) and the flag tag are never pushed at all: they are what
  // makes a variant a variant, and the flag is the flag task's to keep.
  //
  // Groups ride at the source's own `scene_index`: variants are the same work, so a
  // variant added to a group belongs at the same position in it. Membership is what is
  // compared - a shared group whose index differs is not listed. The write is the
  // whole `groups` list through `sceneUpdate`, like URLs (`SceneUpdateInput.groups`
  // has no ADD mode), so a save that removed a group folds into the same line as the
  // adds rather than a second write clobbering the first.
  var SYNC_TASK_NAME = 'Synchronize Variants...';

  // The writable half of the delta's attribute list: how each field is compared for
  // the listing (same shape as `ATTRS`) and which `SceneUpdateInput` field carries it.
  var SYNC_ATTRS = [
    { key: 'title', label: 'Title', input: 'title' },
    { key: 'date', label: 'Date', input: 'date' },
    { key: 'studio', label: 'Studio', input: 'studio_id',
      raw: function (sc) { return sc.studio ? String(sc.studio.id) : null; },
      show: function (sc) { return sc.studio ? sc.studio.name : ''; } },
    { key: 'rating100', label: 'Rating', input: 'rating100' },
    { key: 'code', label: 'Studio code', input: 'code' },
    { key: 'director', label: 'Director', input: 'director' },
    { key: 'details', label: 'Details', input: 'details' },
    { key: 'organized', label: 'Organized', input: 'organized' },
  ];

  // A value as a listing shows it: one line, quoted, cut at sixty characters - the
  // details block is a paragraph and the log line is a glance. The job keeps the whole
  // value; only the display is cut.
  function syncValShow(v) {
    var t = oneLine(v == null ? '' : String(v));
    if (t.length > 60) t = t.slice(0, 57) + '...';
    return t === '' ? '(empty)' : '"' + t + '"';
  }

  // ── Seeing what changed inside a paragraph ────────────────────────────────
  //
  // `Details: "Porcelain-skinned, blonde princess flirting..." -> "Porcelain-skinned,
  // blonde princess flirting..."` is two cuts of the same opening sentence and says
  // nothing at all: the change is somewhere past the sixtieth character, which is
  // exactly where both strings stop being shown. So a long value is not shown twice
  // and cut - it is shown **once, as a diff**: the words only the old value has in
  // red, the words only the new one has in green, and the text they share in white.
  //
  // Word-level rather than character-level, because a paragraph diffed by character
  // produces shards of words that are harder to read than the sentence was.
  var DIFF_TOKEN_CAP = 400;   // beyond this the middle is one replacement, not a diff
  var DIFF_EDGE = 30;         // characters of unchanged text kept at either end
  var DIFF_GAP = 60;          // an unchanged run longer than this is elided in the middle

  // A token is a word **and the space after it**, never a space of its own. Split the
  // other way and the spaces match each other everywhere, so `second half` against
  // `closing act` comes back as `second closing half act` - the words interleaved
  // around the blanks between them, which is nonsense to read. Carrying the space
  // means a word can only match a word, and the text still rebuilds exactly.
  function diffTokens(t) {
    return String(t == null ? '' : t).match(/\S+\s*/g) || [];
  }

  // Two tokens are the same word when they differ only in the space they carry. The
  // last word of a value has none and the same word mid-sentence has one, so without
  // this a sentence with something appended to it matches nothing at the join.
  function diffKey(t) { return String(t).replace(/\s+$/, ''); }

  // The longest common subsequence of two short token lists, as a list of
  // `[op, text]` with op -1 removed, 0 kept, 1 added. Only ever called on what is left
  // after the shared head and tail are taken off, which for an edited paragraph is a
  // handful of words.
  function diffMiddle(a, b) {
    var n = a.length, m = b.length, i, j;
    if (!n && !m) return [];
    if (!n) return [[1, b.join('')]];
    if (!m) return [[-1, a.join('')]];
    if (n > DIFF_TOKEN_CAP || m > DIFF_TOKEN_CAP) {
      return [[-1, a.join('')], [1, b.join('')]];
    }
    var len = [];
    for (i = 0; i <= n; i++) {
      len[i] = [];
      for (j = 0; j <= m; j++) {
        len[i][j] = (!i || !j) ? 0
          : diffKey(a[i - 1]) === diffKey(b[j - 1]) ? len[i - 1][j - 1] + 1
            : Math.max(len[i - 1][j], len[i][j - 1]);
      }
    }
    var out = [];
    function push(op, text) {
      if (!text) return;
      if (out.length && out[out.length - 1][0] === op) out[out.length - 1][1] += text;
      else out.push([op, text]);
    }
    i = n; j = m;
    var rev = [];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && diffKey(a[i - 1]) === diffKey(b[j - 1])) {
        rev.push([0, b[j - 1]]); i--; j--;
      }
      else if (j > 0 && (i === 0 || len[i][j - 1] >= len[i - 1][j])) { rev.push([1, b[j - 1]]); j--; }
      else { rev.push([-1, a[i - 1]]); i--; }
    }
    for (i = rev.length - 1; i >= 0; i--) push(rev[i][0], rev[i][1]);
    return out;
  }

  // Unchanged text is context, not content: enough of it to place a change and no
  // more. The ends are cut towards the change and the middle from both sides, with a
  // one-character ellipsis standing in for what is left out - the tooltip still has
  // the whole of both values.
  function diffContext(text, first, last) {
    if (first && last) return text;                       // the values share everything shown
    if (first) {
      return text.length > DIFF_EDGE ? '\u2026' + text.slice(text.length - DIFF_EDGE) : text;
    }
    if (last) return text.length > DIFF_EDGE ? text.slice(0, DIFF_EDGE) + '\u2026' : text;
    if (text.length <= DIFF_GAP) return text;
    return text.slice(0, DIFF_EDGE) + ' \u2026 ' + text.slice(text.length - DIFF_EDGE);
  }

  // The diff itself: `[[op, text], ...]`, or null where one would say less than the
  // plain old -> new - a value short enough to show whole, one side empty, or two
  // values with no word in common to anchor on.
  function valueDiffOps(oldV, newV) {
    var a = oneLine(oldV == null ? '' : String(oldV));
    var b = oneLine(newV == null ? '' : String(newV));
    if (!a || !b) return null;
    var A = diffTokens(a), B = diffTokens(b);
    var p = 0;
    while (p < A.length && p < B.length && diffKey(A[p]) === diffKey(B[p])) p++;
    var q = 0;
    while (q < A.length - p && q < B.length - p &&
      diffKey(A[A.length - 1 - q]) === diffKey(B[B.length - 1 - q])) q++;
    var ops = [];
    // From `B` throughout: the new value is the one that would be written, so where
    // the two differ only in spacing it is its spacing that belongs on screen.
    if (p) ops.push([0, B.slice(0, p).join('')]);
    diffMiddle(A.slice(p, A.length - q), B.slice(p, B.length - q))
      .forEach(function (o) { ops.push(o); });
    if (q) ops.push([0, B.slice(B.length - q).join('')]);
    // Nothing in common to anchor on - two unrelated paragraphs - so the diff would be
    // one red block and one green one, which is what old -> new already says.
    if (!ops.some(function (o) { return o[0] === 0 && trim(o[1]); })) return null;
    if (!ops.some(function (o) { return o[0] !== 0; })) return null;
    return ops;
  }

  // The line's view of a diff: coloured, with the unchanged runs elided to context.
  function valueDiffParts(ops) {
    var parts = [];
    ops.forEach(function (o, i) {
      var text = o[0] === 0
        ? diffContext(o[1], i === 0, i === ops.length - 1)
        : o[1];
      if (!text) return;
      // An equal run is rendered from the new value, whose last word carries no
      // trailing space - so where something follows it, the space that was there in
      // the old value has to come back or `Adira` runs straight into `- Promo`.
      if (o[0] === 0 && i < ops.length - 1 && !/\s$/.test(text)) text += ' ';
      // A removal running straight into the insertion that replaced it reads as one
      // made-up word - `sunlitcandlelit` - so the two are separated by an arrow.
      // White, and spaced, because it is punctuation of ours rather than either
      // value's text; a removal or an insertion on its own gets none.
      if (o[0] === -1 && ops[i + 1] && ops[i + 1][0] === 1) {
        parts.push([text.replace(/\s+$/, ''), 'svr-del']);
        parts.push([' \u2192 ', 'svr-mod']);
        return;
      }
      parts.push([text, o[0] === 0 ? 'svr-mod' : o[0] < 0 ? 'svr-del' : 'svr-add']);
    });
    return parts;
  }

  // The tooltip's view of the same diff: **the whole text, with the changes coloured
  // in it** - nothing elided, and no second copy of the paragraph to compare by eye.
  //
  // Unchanged text is white here and light blue in the line, which is not an
  // inconsistency: the line is one row among many and the blue says "this row's value
  // is what changed", while the box holds nothing but the value, where the same blue
  // would only be dimming the text you opened it to read.
  function valueDiffFullParts(ops) {
    var out = [];
    ops.forEach(function (o) {
      if (!o[1]) return;
      out.push([o[1], o[0] === 0 ? null : o[0] < 0 ? 'svr-del' : 'svr-add']);
    });
    return out;
  }

  // ── The box a diff opens ──────────────────────────────────────────────────
  //
  // A native `title` cannot colour anything, which is why the full diff shipped in it
  // as `[-went-]` and `{+arrived+}` - a notation standing in for the colours the line
  // already had. This is the thing itself: one box for the page, `position:fixed` so a
  // scrolling log cannot clip it, above the backdrop so it is not painted over, and
  // `pointer-events:none` for the reason every box here has it - one that took the
  // pointer would close under it and reopen for ever.
  var DIFF_TIP_ID = 'svr-difftip';

  function diffTipBox() {
    var box = document.getElementById(DIFF_TIP_ID);
    if (!box) {
      box = el('div', 'svr-difftip');
      box.id = DIFF_TIP_ID;
      (document.body || document.documentElement).appendChild(box);
    }
    return box;
  }

  function diffTipOpen(node, parts) {
    var box = diffTipBox();
    box.textContent = '';
    parts.forEach(function (part) {
      // A picture rather than a run of text: `{ img: <data url>, label: ... }`. The
      // cover line's tooltip is the only thing that uses it, and it is the one place
      // here where the change *is* an image - two of them side by side is the whole
      // question ("is that the right cover?") answered at a glance, where any amount
      // of text about them is not.
      if (part && part.node) { box.appendChild(part.node); return; }
      if (part && part.img) {
        var fig = el('div', 'svr-coverfig' + (part.cls ? ' ' + part.cls : ''));
        var im = el('img');
        im.src = part.img;
        im.alt = '';
        fig.appendChild(im);
        fig.appendChild(el('div', 'svr-covercap', part.label || ''));
        box.appendChild(fig);
        return;
      }
      box.appendChild(el('span', part[1] || null, part[0]));
    });
    // Last child of the body every time: a dialog opened after the box would otherwise
    // paint over it wherever the two carry the same z-index, which is the bug the
    // shared tooltip in Core had and fixed the same way.
    var host = document.body || document.documentElement;
    if (host && host.lastChild !== box) host.appendChild(box);
    // A box holding built content (the set table) shrinks to it; the fixed 60rem is
    // for the text diffs, whose paragraphs need somewhere to wrap.
    var fit = parts.length && parts.every(function (p) { return p && p.node; });
    box.className = 'svr-difftip svr-difftip-open' + (fit ? ' svr-difftip-fit' : '');
    if (!node.getBoundingClientRect || !box.getBoundingClientRect) return;
    var a = node.getBoundingClientRect(), b = box.getBoundingClientRect();
    var vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
    var top = a.bottom + 6;
    if (top + b.height > vh - 8) top = Math.max(8, a.top - b.height - 6);
    box.style.top = top + 'px';
    box.style.left = Math.min(Math.max(8, a.left), Math.max(8, vw - b.width - 8)) + 'px';
  }

  function diffTipClose() {
    var box = document.getElementById(DIFF_TIP_ID);
    if (box) box.className = 'svr-difftip';
  }

  function diffTip(node, parts) {
    if (!node || !node.addEventListener) return;
    node.addEventListener('mouseenter', function () { diffTipOpen(node, parts); });
    node.addEventListener('mouseleave', diffTipClose);
    node.addEventListener('focus', function () { diffTipOpen(node, parts); });
    node.addEventListener('blur', diffTipClose);
  }

  // The same value with nothing taken out of it - the tooltip's half. A details block
  // is cut at sixty characters *and* flattened onto one line, so a value can be
  // abbreviated well under the cut; comparing the two strings is what decides whether
  // there is anything a tooltip could add.
  function syncValFull(v) {
    var t = v == null ? '' : String(v);
    return t === '' ? '(empty)' : '"' + t + '"';
  }

  // ── The cover ─────────────────────────────────────────────────────────────
  //
  // The one attribute here that is not a value the scene record carries. `paths`
  // gives a URL per scene - `/scene/<id>/screenshot`, different for every scene
  // whatever the pictures are - and `SceneUpdateInput.cover_image` takes base64 image
  // data. So both halves of "does this differ" and "write it across" mean reading the
  // bytes, and the read is what makes the comparison honest as well as the write
  // possible: the same fetch answers both, and the target's own bytes are what Undo
  // needs. Nothing is fetched twice.
  //
  // **Only where a person picked the source.** A save never changes a cover, so the
  // save dialog never lists one and never fetches; and the review task scores whole
  // libraries, where a fetch per scene would be thousands of images for a number.
  // Covers are compared inside a set a user has chosen, and nowhere else.
  function coverUrl(scene) {
    return (scene && scene.paths && scene.paths.screenshot) || null;
  }

  // Bytes to base64, in chunks: `String.fromCharCode.apply` over a whole image is an
  // argument list long enough to overflow the call stack.
  function base64Of(buf) {
    var bytes = new Uint8Array(buf), step = 0x8000, parts = [], i;
    for (i = 0; i < bytes.length; i += step) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + step)));
    }
    return btoa(parts.join(''));
  }

  // A scene's cover as the data URL `cover_image` wants, or null. `__svr` marks it as
  // ours so the save watch lets it straight past.
  function readCover(scene) {
    var url = coverUrl(scene);
    if (!url) return Promise.resolve(null);
    return fetch(url, { __svr: true }).then(function (r) {
      if (!r || !r.ok) return null;
      var type = (r.headers && r.headers.get && r.headers.get('content-type')) || 'image/jpeg';
      return r.arrayBuffer().then(function (buf) {
        var b64 = base64Of(buf);
        return b64 ? 'data:' + type + ';base64,' + b64 : null;
      });
    }).then(null, function () { return null; });   // a cover we cannot read is one we do not offer
  }

  // Every cover in every set, so the listing can score a mismatch rather than only
  // report one after a set has been picked. Sequential on purpose: this is the one
  // read here that is an image per scene, and firing hundreds at once is how a page
  // stops responding. The progress line counts them, and Close stops it.
  //
  // What it buys is the whole point of the review dialog for covers: a variant that
  // was rescanned into losing the cover a stash-box gave it is *findable*, at the top
  // of the listing, rather than something you have to open every set to notice.
  function readSetCovers(run, s, sets) {
    run.coverBy = null;
    if (!s.c4CheckCoverMismatch) return Promise.resolve(null);
    var scenes = [];
    sets.forEach(function (set) {
      set.scenes.forEach(function (sc) { scenes.push(sc); });
    });
    if (!scenes.length) return Promise.resolve(null);
    var by = {}, done = 0;
    run.coverRead = 0;
    run.coverFailed = 0;
    run.msg('INFO', 'Reading the cover of ' + plural(scenes.length, 'scene in a set') +
      ', to say which sets disagree about one.');
    function next(i) {
      if (i >= scenes.length || run.stopped) return Promise.resolve(null);
      return readCover(scenes[i]).then(function (data) {
        by[String(scenes[i].id)] = data;
        if (data) run.coverRead++; else run.coverFailed++;
        done++;
        if (done % 10 === 0 || done === scenes.length) {
          run.progress(run.progressText() + ' Covers ' + done + ' of ' + scenes.length + '…');
        }
        return next(i + 1);
      });
    }
    return next(0).then(function () {
      run.coverBy = by;
      return null;
    });
  }

  // What the cover comparison did, said once after the listing. **A setting that is
  // off and a feature that is broken look identical from the outside**, which is how
  // "still not seeing a cover mismatch flagged" stayed unanswerable across two
  // releases: the dialog said nothing about covers in either case. The tag filter has
  // had this line since it shipped; this is the same rule, applied where it was
  // missed.
  //
  // The failure count is the half that earns its keep. `readCover` answers null for
  // anything it cannot read and carries on - which is right, since a picture is not
  // worth failing a scan for - so a Stash whose `paths.screenshot` points at another
  // origin, or behind a proxy that refuses the fetch, would otherwise compare nothing
  // and report nothing, for ever.
  function reportCoverCheck(run, s) {
    if (!s.c4CheckCoverMismatch) {
      run.msg('INFO', 'Cover images are not compared: switch on "Compare Cover Images" ' +
        'in this plugin\u2019s settings to have a set\u2019s drift score count a cover ' +
        'its members disagree about.');
      return;
    }
    var sets = 0;
    run.sets.forEach(function (set) { if (set.delta.cover) sets++; });
    if (run.coverFailed) {
      run.msg(run.coverRead ? 'WARN' : 'ERROR',
        plural(run.coverFailed, 'cover') + ' could not be read' +
        (run.coverRead ? '' : ' - none of them could') + ', so ' +
        (run.coverRead ? 'those scenes are' : 'no set is') + ' not compared. This is ' +
        'what a Stash serving its images from another origin, or from behind a proxy ' +
        'that refuses the request, looks like from here.');
    }
    run.msg('INFO', run.coverRead
      ? plural(run.coverRead, 'cover') + ' read; ' + (sets
        ? plural(sets, 'set disagrees', 'sets disagree') + ' about one.'
        : 'every set agrees on its cover.')
      : 'No cover was read, so no set could be compared.');
  }

  // The source's cover and every target's, read once before the plan is built - the
  // planner is synchronous, and this is the one thing in it that is not.
  function gatherCovers(run, s, source, targets) {
    // Opt-in, because it is the one comparison here that costs a download per scene.
    if (!s || !s.c4CheckCoverMismatch) return Promise.resolve(null);
    // An automatic run reads covers only when the save it is answering actually set
    // one. Every other save would otherwise pay for an image per variant to find out
    // that nothing about the cover moved.
    if (run.auto && !(run.only && run.only.cover)) return Promise.resolve(null);
    return readCover(source).then(function (src) {
      if (!src) return null;
      var out = { src: src, had: {} };
      var chain = Promise.resolve();
      targets.forEach(function (t) {
        chain = chain.then(function () {
          return readCover(t).then(function (b) { out.had[String(t.id)] = b; });
        });
      });
      return chain.then(function () { return out; });
    });
  }

  // A scene's `groups` as `SceneUpdateInput.groups` spells them - the index kept,
  // because it is the half the whole feature is about.
  function groupInput(list) {
    return (list || []).map(function (g) {
      return { group_id: String(g.group.id),
        scene_index: g.scene_index == null ? null : g.scene_index };
    });
  }

  // One variant against the source: a [SYNC] line per difference. `skip` is the set of
  // tag ids never pushed.
  function planSyncScene(run, source, target, skip) {
    var title = target.title || ('Scene ' + target.id);

    var only = run.only || null;
    SYNC_ATTRS.forEach(function (a) {
      // `only` is the set of attributes the triggering save changed; without one
      // (the manual button) every attribute is compared. Titles are dropped from an
      // automatic run unless the setting opts them in - a title is the one value a
      // variant most deliberately owns.
      if (only && !only[a.key]) return;
      if (a.key === 'title' && run.titleOff) return;
      var sv = a.show ? a.show(source) : source[a.key];
      var tv = a.show ? a.show(target) : target[a.key];
      var val = a.raw ? a.raw(source) : (source[a.key] == null ? null : source[a.key]);
      // A title goes by the naming rule where the set has one: a partial-duration
      // variant is offered its expected title under the base, never this scene's title
      // verbatim, and a partial's own title is never pushed onto a full-duration one.
      if (a.key === 'title' && run.expected) {
        if (hasOwn(run.expected, String(target.id))) sv = val = run.expected[String(target.id)];
        else if (hasOwn(run.expected, String(source.id))) return;
      }
      if (String(sv == null ? '' : sv) === String(tv == null ? '' : tv)) return;
      if (a.key === 'title' && run.expected && hasOwn(run.expected, String(target.id))) run.ruledTitles = (run.ruledTitles || 0) + 1;
      // A studio is a name with a card, never a diff of two names.
      var studioOf = function (sc) { return sc.studio ? [{ type: 'studios', id: String(sc.studio.id), name: sc.studio.name || ('id ' + sc.studio.id) }] : null; };
      var ops = a.key === 'studio' ? null : valueDiffOps(tv, sv);
      var studioParts = a.key === 'studio'
        ? [studioOf(target) ? namesPart(studioOf(target), 'svr-del') : [syncValShow(tv), 'svr-del'], [' \u2192 ', 'svr-mod'],
          studioOf(source) ? namesPart(studioOf(source), 'svr-add') : [syncValShow(sv), 'svr-add']]
        : null;
      // Unticked, every one of them: an add only ever adds, while a replace
      // overwrites the variant's own value, so a replace is opted into rather than
      // out of. The All boxes are what keep that from costing a click per line.
      run.tickLine({
        id: String(target.id), title: title, kind: 'set', input: a.input,
        group: a.label,
        value: val,
        had: a.raw ? a.raw(target) : (target[a.key] == null ? null : target[a.key]),
      }, 'svr-op-set', '[SYNC]    ',
      // The save dialog preselects its replaces: they are the edit the user just made
      // by hand, which is stronger evidence of intent than a long-standing diff the
      // manual button lists. Titles are the exception either way - the one value a
      // variant most deliberately owns.
      // A long value is shown once as a diff rather than twice and cut: two cuts of
      // one opening sentence are identical and say nothing about the edit. The
      // tooltip is the same diff unelided, so hovering says what changed rather than
      // handing back two paragraphs to compare.
      [['  ' + a.label + ': ', null]].concat(studioParts || (ops ? valueDiffParts(ops)
        : [[syncValShow(tv), 'svr-del'], [' \u2192 ', 'svr-mod'],
          [syncValShow(sv), 'svr-add']])),
      run.auto ? a.key !== 'title' : false,
      ops ? [['  ' + a.label + ': ', null]].concat(valueDiffFullParts(ops))
        // The same arrow the line uses, so a value short enough to be shown whole
        // matches its own tooltip exactly and no box opens to repeat it.
        : '  ' + a.label + ': ' + syncValFull(tv) + ' \u2192 ' + syncValFull(sv));
    });

    // The additive lists: what the source carries and the target lacks, by id. The
    // target's own extras are never listed and never touched - they are the variant's
    // deliberate uniqueness.
    [['tags', 'tag_ids', 'tag'], ['performers', 'performer_ids', 'performer']]
      .forEach(function (list) {
        if (only && !only[list[0]]) return;
        var have = {};
        (target[list[0]] || []).forEach(function (x) { have[String(x.id)] = true; });
        var missing = (source[list[0]] || []).filter(function (x) {
          return !have[String(x.id)] && !skip[String(x.id)];
        });
        // A tag the hierarchy already implies through another the target carries is
        // not copied - the sibling decides which those are. Only the additions are
        // filtered: what the target already holds is its own, and this dialog does
        // not prune.
        if (list[0] === 'tags' && run.pruner && missing.length) {
          var drop = redundantOf(run.pruner, target,
            missing.map(function (x) { return String(x.id); }));
          var kept = missing.filter(function (x) { return !drop[String(x.id)]; });
          run.pruned = (run.pruned || 0) + (missing.length - kept.length);
          missing = kept;
        }
        if (!missing.length) return;
        // `items` is what makes the line a picker: one checkbox per tag or performer,
        // behind the line's expander. `tipType` is the URL half of the item links.
        var items = missing.map(function (x) {
          return { id: String(x.id), name: x.name || ('id ' + x.id) };
        });
        run.tickLine({
          id: String(target.id), title: title, kind: list[1],
          items: items, noun: list[2], tipType: list[0],
          group: list[0] === 'tags' ? 'Tags' : 'Performers',
        }, 'svr-op-add', '[SYNC]    ',
        [['  Add ' + plural(items.length, list[2]) + ': ', null],
          [items.map(function (x) { return x.name; }).sort().join(', '), 'svr-add']],
        true);
      });

    // URLs are a list of bare strings with no ADD mode on the input, so the additive
    // write is the union sent whole - and the undo is the old list, not a removal.
    // What this save *removed*, offered as removals on the variants that still carry
    // it. Only the save-triggered run has `run.removed`: the manual button cannot tell
    // a value the source dropped from a value the variant deliberately owns, which is
    // why its lists stay add-only. The dimension and flag tags are protected here the
    // same way they are from the adds.
    var rem = run.removed || {};
    [['tags', 'tag_ids_remove', 'tag'], ['performers', 'performer_ids_remove', 'performer']]
      .forEach(function (list) {
        if (only && !only[list[0]]) return;
        var gone = rem[list[0]] || [];
        if (!gone.length) return;
        var carried = (target[list[0]] || []).filter(function (x) {
          return gone.indexOf(String(x.id)) !== -1 && !skip[String(x.id)];
        });
        if (!carried.length) return;
        var items = carried.map(function (x) {
          return { id: String(x.id), name: x.name || ('id ' + x.id) };
        });
        run.tickLine({
          id: String(target.id), title: title, kind: list[1],
          items: items, noun: list[2], tipType: list[0], verb: 'Remove',
          group: list[0] === 'tags' ? 'Tags' : 'Performers',
        }, 'svr-op-set', '[SYNC]    ',
        [['  Remove ' + plural(items.length, list[2]) + ': ', null],
          [items.map(function (x) { return x.name; }).sort().join(', '), 'svr-del']],
        true);
      });

    // Compared by the bytes, so a set already sharing a cover lists nothing. A target
    // whose own cover could not be read is not offered: writing one without having
    // captured what it replaced would leave an Undo that cannot put it back.
    var cov = run.covers;
    if (cov && hasOwn(cov.had, String(target.id)) && cov.had[String(target.id)] &&
        cov.had[String(target.id)] !== cov.src) {
      run.tickLine({
        id: String(target.id), title: title, kind: 'cover_image', group: 'Cover',
        value: cov.src, had: cov.had[String(target.id)],
      }, 'svr-op-set', '[SYNC]    ',
      [['  Cover: ', null], ['replace with this scene\u2019s', 'svr-mod']], !!run.auto,
      // Both covers, side by side, in the colours the rest of the vocabulary uses:
      // the one that goes and the one that arrives.
      [{ img: cov.had[String(target.id)], label: 'this variant now', cls: 'svr-cover-old' },
        { img: cov.src, label: 'would become', cls: 'svr-cover-new' }]);
    }

    if (!only || only.groups) {
      var tg = target.groups || [];
      var tgIds = {};
      tg.forEach(function (g) { tgIds[String(g.group.id)] = true; });
      var goneGroups = (rem.groups || []).filter(function (id) { return tgIds[id]; });
      var missingGroups = (source.groups || []).filter(function (g) {
        return !tgIds[String(g.group.id)];
      });
      if (goneGroups.length || missingGroups.length) {
        var keptG = tg.filter(function (g) {
          return goneGroups.indexOf(String(g.group.id)) === -1;
        });
        var named = function (g) { return { type: 'groups', id: String(g.group.id), name: g.group.name || ('id ' + g.group.id) }; };
        var goneNames = tg.filter(function (g) {
          return goneGroups.indexOf(String(g.group.id)) !== -1;
        }).map(named);
        var addNames = missingGroups.map(named);
        run.tickLine({
          id: String(target.id), title: title, kind: 'groups', group: 'Groups',
          value: groupInput(keptG).concat(groupInput(missingGroups)),
          had: groupInput(tg),
        }, goneGroups.length ? 'svr-op-set' : 'svr-op-add', '[SYNC]    ',
        goneGroups.length
          ? [['  Update groups: remove ', null], namesPart(goneNames, 'svr-del')]
            .concat(addNames.length
              ? [['; add ', null], namesPart(addNames, 'svr-add')] : [])
          : [['  Add ' + plural(addNames.length, 'group') + ': ', null],
            namesPart(addNames, 'svr-add')],
        true);
      }
    }

    if (only && !only.urls) return;
    var tu = target.urls || [];
    var missingUrls = (source.urls || []).filter(function (u) { return tu.indexOf(u) === -1; });
    var goneUrls = (rem.urls || []).filter(function (u) { return tu.indexOf(u) !== -1; });
    if (goneUrls.length) {
      // One line, not an add line and a remove line: both would write the whole `urls`
      // list and the second would clobber the first. The combined value is the
      // variant's list with the removed URLs out and the missing ones in, and the one
      // box starts unticked because part of what it does is take a value away.
      run.tickLine({
        id: String(target.id), title: title, kind: 'urls', group: 'URLs',
        value: tu.filter(function (u) { return goneUrls.indexOf(u) === -1; })
          .concat(missingUrls),
        had: tu.slice(),
      }, 'svr-op-set', '[SYNC]    ',
      [['  Update URLs: remove ', null], [goneUrls.join(', '), 'svr-del']]
        .concat(missingUrls.length
          ? [['; add ', null], [missingUrls.join(', '), 'svr-add']] : []), true);
    } else if (missingUrls.length) {
      run.tickLine({
        id: String(target.id), title: title, kind: 'urls', group: 'URLs',
        value: tu.concat(missingUrls), had: tu.slice(),
      }, 'svr-op-add', '[SYNC]    ',
      [['  Add ' + plural(missingUrls.length, 'URL') + ': ', null],
        [missingUrls.join(', '), 'svr-add']], true);
    }
  }

  function syncBegin(run) {
    var scene = run.scope || {};
    return Promise.all([settingsReady(), tagTree()]).then(function (both) {
      var s = both[0], m = matchers(both[1], s);
      if (run.auto && !s.c5PropagateTitleOnSave) run.titleOff = true;
      run.settings = s;
      var skip = skipTagIds(both[1], s, m);
      // Re-queried rather than taken off the pane: the pane's answer is as old as the
      // tab, and this is the read a write is planned from. The sibling is asked in the
      // same breath - one `prepare`, answered from its own caches.
      return Promise.all([findVariants(scene), nptPruner(s)]).then(function (two) {
        var found = two[0];
        run.pruner = two[1];
        run.scanned = found.rows.length;
        if (!found.rows.length) {
          if (run.auto) { run.close(); return null; }
          run.msg('WARN', found.why || 'This scene has no variants to synchronize with.');
          return 'Nothing to synchronize.';
        }
        if (!found.self) {
          if (run.auto) { run.close(); return null; }
          run.msg('WARN', 'The server did not return the viewed scene among its own ' +
            'variants, so there is nothing to push from.');
          return 'Nothing to synchronize.';
        }
        var others = found.rows.map(function (r) { return r.scene; });
        var nmg = namingOf([found.self].concat(others), m, naming(s), found.self.id);
        run.expected = nmg.expected;
        run.base = nmg.base;
        return gatherCovers(run, s, found.self, others)
          .then(function (covers) {
            run.covers = covers;
            found.rows.forEach(function (row) {
              planSyncScene(run, found.self, row.scene, skip);
            });
            return finishSyncPlan(run, s);
          });
      });
    });
  }

  // What the naming rule did to the title lines, said in the listing: the base the
  // partials were named after, or the pinned base that kept them as they are.
  function titleRuleNotes(run) {
    if (run.titleOff || !run.base || !run.base.base) return;
    if (run.ruledTitles) {
      run.msg('INFO', plural(run.ruledTitles, 'partial-duration title follows', 'partial-duration titles follow') +
        ' the naming rule under the base "' + run.base.base + '"' +
        (run.base.from === 'field' ? ', pinned by the base-name field' : '') +
        ', not this scene\u2019s title verbatim.');
    } else if (run.base.from === 'field' && run.only && run.only.title) {
      run.msg('INFO', 'The base name of this set is pinned to "' + run.base.base +
        '" by the base-name field, so its partial-duration scenes keep their titles.');
    }
  }

  // The tail of a sync listing, shared by the run that reaches it through `syncBegin`
  // and the one the review dialog's Synchronize Set from Selected builds.
  function finishSyncPlan(run, s) {
    titleRuleNotes(run);
    var unticked = 0;
    run.jobs.forEach(function (j) { if (j.box && !j.box.checked) unticked++; });
    if (unticked && run.auto) {
      // The save dialog preselects everything it lists except titles, so its unticked
      // lines are title lines and nothing else.
      run.msg('INFO', plural(unticked, 'title line starts', 'title lines start') +
        ' unticked: a title is the one value a variant most deliberately owns.');
    } else if (unticked) {
      run.msg('INFO', plural(unticked, 'replace line starts', 'replace lines start') +
        ' unticked: an add only ever adds, while a replace overwrites the ' +
        'variant\u2019s own value. Tick them one by one, or a whole attribute at ' +
        'once with the All boxes above the listing.');
    }
    // The state the title policy left things in, said in the listing: a change the
    // save made that this dialog is deliberately not offering.
    if (run.titleOff && run.only && run.only.title) {
      run.msg('INFO', 'The title changed too, but title lines are not offered here: ' +
        'the "Rename Variants After a Title Change" setting is off.');
    }
    if (!run.jobs.length) {
      if (run.auto) { run.close(); return null; }
      run.msg('INFO', 'Nothing to synchronize: the variants already agree on every ' +
        'attribute this dialog pushes.');
    }
    reportPruneFilter(run, s);
    run.buildAllBar();
    if (run.auto) run.reveal();
    return null;
  }


  var SYNC_TASK = {
    title: 'Synchronize Variants',
    legend: 'One line per attribute per variant, pushing this scene’s values ' +
      'outward: old -> new where a value would be replaced, and the tags, performers, ' +
      'groups or URLs that would be added - added only, never removed, so whatever ' +
      'makes a variant deliberately different stays. A group is joined at this ' +
      'scene’s own position in it, since a variant is the same work. The full-duration, partial-duration and flag ' +
      'tags are never pushed: they are what makes a variant a variant. Adds start ' +
      'ticked and replaces start unticked - overwriting is opted into, not out of. ' +
      'Green is what a variant gains, red what it loses, blue a value replaced. ' +
      'Proceed writes only the ticked lines; the All boxes above the listing tick a ' +
      'whole attribute at once, and a tag or performer line opens on its arrow to ' +
      'pick individual ones.',
    nothing: 'The variants already agree on every attribute this dialog pushes.',
    scanNoun: 'variant',
    planNoun: 'listed',
    planUnit: 'change',
    leaseLabel: 'Variant synchronization',
    undoTip: 'Put back what every written line replaced or added. Only what this ' +
      'dialog wrote, and only while it stays open.',
    verb: 'synchronized',
    pickCaption: true,
    begin: syncBegin,
    writeInput: function (job) {
      if (job.kind === 'tag_ids_remove' || job.kind === 'performer_ids_remove') {
        job.written = pickedItems(job).map(function (it) { return it.id; });
        var rin = { ids: [job.id] };
        rin[job.kind.replace('_remove', '')] = { ids: job.written, mode: 'REMOVE' };
        return { query: BULK_TAG_MUTATION, variables: { input: rin } };
      }
      if (job.kind === 'tag_ids' || job.kind === 'performer_ids') {
        // The picked items, read at write time - the boxes lock the moment the state
        // leaves `listing`, so this is the selection the user saw at the press. What
        // was actually written is kept on the job, because the undo must remove
        // exactly that, whatever the boxes say by then.
        job.written = pickedItems(job).map(function (it) { return it.id; });
        var input = { ids: [job.id] };
        input[job.kind] = { ids: job.written, mode: 'ADD' };
        return { query: BULK_TAG_MUTATION, variables: { input: input } };
      }
      var one = { id: job.id };
      one[job.kind === 'urls' || job.kind === 'groups' || job.kind === 'cover_image'
        ? job.kind : job.input] = job.value;
      return { query: SCENE_UPDATE, variables: { input: one } };
    },
    undoInput: function (job) {
      if (job.kind === 'tag_ids_remove' || job.kind === 'performer_ids_remove') {
        var rin = { ids: [job.id] };
        rin[job.kind.replace('_remove', '')] = { ids: job.written || [], mode: 'ADD' };
        return { query: BULK_TAG_MUTATION, variables: { input: rin } };
      }
      if (job.kind === 'tag_ids' || job.kind === 'performer_ids') {
        var input = { ids: [job.id] };
        input[job.kind] = { ids: job.written || [], mode: 'REMOVE' };
        return { query: BULK_TAG_MUTATION, variables: { input: input } };
      }
      var one = { id: job.id };
      one[job.kind === 'urls' || job.kind === 'groups' || job.kind === 'cover_image'
        ? job.kind : job.input] = job.had;
      return { query: SCENE_UPDATE, variables: { input: one } };
    },
  };

  // The save-triggered shape of the same task: identical planner, writers and undo,
  // scoped by `run.only` to the attributes the save changed. A separate object only
  // because its head has a different story to tell.
  var PROPAGATE_TASK = (function () {
    var t = {}, k;
    for (k in SYNC_TASK) if (hasOwn(SYNC_TASK, k)) t[k] = SYNC_TASK[k];
    t.title = 'Propagate Changes to Variants';
    t.legend = 'This scene was just saved with changes, and these are its variants: ' +
      'one checkbox line per changed attribute per variant, old -> new where a value ' +
      'would be replaced, adds for the tags, performers, groups or URLs this save ' +
      'added - a group joined at this scene’s own position in it - and ' +
      'removes for the ones it took off, on variants still carrying them - a ' +
      'variant\u2019s own extras are never touched. The full-duration, partial-duration ' +
      'and flag tags are never pushed or removed. Green is what a variant gains, red ' +
      'what it loses, blue a value replaced. Every line starts ticked - it is ' +
      'the edit you just made - except titles, which start unticked: a title is the ' +
      'one value a variant most deliberately owns. ' +
      'Proceed writes only the ticked lines; Close leaves the variants as they are. ' +
      'The offer can be switched off in this plugin\u2019s settings.';
    t.leaseLabel = 'Variant propagation';
    return t;
  }());

  // ── Propagating a save to the variants ────────────────────────────────────
  //
  // Stash's scene edit form submits its whole input on Save, so which attributes
  // *changed* is the input against the scene as it stood - and after the write there
  // is no "stood" left to ask for. The save is therefore held for one by-id read
  // (nothing else: settings answer from their cache), then forwarded untouched.
  //
  // Two of the repo's fetch-wrapper rules are load-bearing here:
  //   - the response body is never read - `resp.ok` is all this looks at, and the
  //     dialog's own scan re-reads every value from the server, so a save that came
  //     back 200-with-errors still gets a truthful listing;
  //   - the lease is sampled *before* the write goes through, so a sibling reacting
  //     to this same save cannot make the watch stand down for a reaction rather
  //     than for a bulk run.

  var SAVE_SNAPSHOT_QUERY = 'query SVRSaveSnapshot($id: ID!) { findScene(id: $id) { ' +
    'id title date code director details rating100 organized urls ' +
    'studio { id } tags { id } performers { id } groups { group { id } scene_index } ' +
    'custom_fields stash_ids { endpoint stash_id } } }';

  // The single-scene save mutation's input, or null for anything else - our own
  // requests (`__svr`), bulk updates, and everything that is not a scene save.
  function sceneSaveOf(init) {
    if (!init || init.__svr || typeof init.body !== 'string') return null;
    var body;
    try { body = JSON.parse(init.body); } catch (e) { return null; }
    var q = body && body.query;
    if (!q || typeof q !== 'string') return null;
    if (!/\bsceneUpdate\s*\(/.test(q) || q.indexOf('bulkSceneUpdate') !== -1) return null;
    var input = body.variables && body.variables.input;
    if (!input || input.id == null) return null;
    return input;
  }

  // The save's group list, whichever field the form spelled it in - `groups` is the
  // current name, `movies` the compatibility one - normalised to group_id entries.
  function saveGroups(input) {
    if (hasOwn(input, 'groups')) return input.groups || [];
    if (hasOwn(input, 'movies')) {
      return (input.movies || []).map(function (m) {
        return { group_id: m.movie_id, scene_index: m.scene_index };
      });
    }
    return null;
  }

  function idSet(arr) {
    return (arr || []).map(function (x) {
      return String(x && typeof x === 'object' ? x.id : x);
    }).sort().join(',');
  }

  // Which of the writable attributes this save changed: input against the snapshot,
  // keyed the way `planSyncScene` reads `run.only`. Null when nothing it pushes moved.
  function changedAttrs(before, input) {
    var out = {}, any = false;
    function norm(v) { return v == null ? '' : String(v); }
    SYNC_ATTRS.forEach(function (a) {
      if (!hasOwn(input, a.input)) return;
      var was = a.raw ? a.raw(before) : before[a.key];
      if (norm(input[a.input]) !== norm(was)) { out[a.key] = true; any = true; }
    });
    [['tags', 'tag_ids'], ['performers', 'performer_ids'], ['urls', 'urls']]
      .forEach(function (l) {
        if (hasOwn(input, l[1]) && idSet(input[l[1]]) !== idSet(before[l[0]])) {
          out[l[0]] = true; any = true;
        }
      });
    // A cover the save carried. Stash sends `cover_image` only when the form has one
    // to set, and there is nothing on the snapshot to compare it against - the
    // snapshot holds fields, not image bytes. So this says "a cover was set", and the
    // dialog's own byte comparison is what decides whether any variant differs from
    // it. A save that re-sent an unchanged cover therefore lists nothing and closes
    // unseen, which is the same answer as not having noticed.
    if (hasOwn(input, 'cover_image') && input.cover_image) { out.cover = true; any = true; }
    // Membership, not index: a reorder inside a group is not variant metadata.
    var gIn = saveGroups(input);
    if (gIn) {
      var was = (before.groups || []).map(function (g) { return String(g.group.id); })
        .sort().join(',');
      var now = gIn.map(function (g) { return String(g.group_id); }).sort().join(',');
      if (was !== now) { out.groups = true; any = true; }
    }
    return any ? out : null;
  }

  // What the save took off the scene, per list - the half of an edit the manual
  // dialog can never see, and what lets a replaced URL or a dropped tag be offered
  // for removal from the variants too.
  function removedIn(before, input) {
    var out = {};
    [['tags', 'tag_ids'], ['performers', 'performer_ids'], ['urls', 'urls']]
      .forEach(function (l) {
        if (!hasOwn(input, l[1])) return;
        var kept = {};
        (input[l[1]] || []).forEach(function (x) {
          kept[String(x && typeof x === 'object' ? x.id : x)] = true;
        });
        out[l[0]] = (before[l[0]] || []).map(function (x) {
          return String(x && typeof x === 'object' ? x.id : x);
        }).filter(function (id) { return !kept[id]; });
      });
    var gIn = saveGroups(input);
    if (gIn) {
      var kept = {};
      gIn.forEach(function (g) { kept[String(g.group_id)] = true; });
      out.groups = (before.groups || []).map(function (g) { return String(g.group.id); })
        .filter(function (id) { return !kept[id]; });
    }
    return out;
  }

  // The offer waits for the save to settle. A sibling reacting to this same save -
  // PropagateTagsAndPerformers adding a new performer's tags - writes after it lands,
  // under a lease, as a bulk mutation this watch cannot see, so an offer built from
  // the save's input alone listed the performer and never the tags. Every reaction
  // registers itself on Core's `settling` the moment it sees the save; this waits for
  // those releases (a bounded wait - a stuck reaction is not a lost offer), reads the
  // scene again, and offers the diff of the two snapshots on the two lists a
  // reaction can move. The cover and the stash-ids still come from the input, which
  // is the only place they are.
  var SETTLE_MS = 120000;

  function offerSettled(input, before) {
    settled('scene', [String(input.id)], SETTLE_MS, PLUGIN_SHORT_NAME).then(function () {
      return gqlRequest(SAVE_SNAPSHOT_QUERY, { id: String(input.id) }).then(function (d) {
        return (d || {}).findScene || null;
      }, function () { return null; });
    }).then(function (after) {
      var seen = input;
      if (after) {
        seen = {};
        for (var k in input) if (hasOwn(input, k)) seen[k] = input[k];
        seen.tag_ids = idsOfList(after, 'tags');
        seen.performer_ids = idsOfList(after, 'performers');
      }
      offerPropagate(seen, before);
    });
  }

  function offerPropagate(input, before) {
    var changed = changedAttrs(before, input);
    if (!changed) return;
    // An open dialog is never stolen; it is told instead, so an offer that did not
    // come is explained rather than missing.
    if (_active) {
      _active.msg('INFO', 'Scene ' + input.id + ' was saved with changes to ' +
        Object.keys(changed).join(', ') + '; no propagate offer while this dialog is open.');
      return;
    }
    // Enough scene for `findVariants`: the id, and the stash-ids as the save left
    // them. The dialog's scan reads everything else fresh.
    var scene = { id: String(input.id),
      stash_ids: hasOwn(input, 'stash_ids') ? (input.stash_ids || []) : (before.stash_ids || []) };
    startRun(PROPAGATE_TASK, scene, { auto: true, only: changed,
      removed: removedIn(before, input) });
  }

  // ── Taking a stash-id off a scene that has variants ───────────────────────
  //
  // The bin beside a stash-id in the edit form only edits the form: the id leaves the
  // scene when Save posts `stash_ids` without it, and Save posts the *whole* scene -
  // `tag_ids` and the custom-field map (`custom_fields: { full }`) with it. So the
  // save is both the moment to ask and the only place to write the answer: a tag or
  // field line taken off separately while the form was open would be put straight
  // back by the form's own map. OK folds the cleanup into the save being held; Cancel
  // puts the id back into it, so the scene keeps the id and every other edit lands.
  // The one write the save cannot carry - the flag coming off the *other* scene when
  // it is the last one left in the set - follows the save, under a lease.

  var CLEANUP_TITLE = 'Remove Stash-id';

  function sameStashId(a, b) { return a.endpoint === b.endpoint && a.stash_id === b.stash_id; }

  // The scenes sharing any of `ids`, or any of `vals` (the ids' own lines unless given)
  // through the field. Enough scene for `findVariants`: it reads `custom_fields` off the
  // scene when the scene carries the map, so no query goes out for the field itself.
  function probeSet(sceneId, field, ids, vals) {
    var cf = {}; cf[field] = (vals || variantValues(ids)).join('\n');
    return findVariants({ id: String(sceneId), stash_ids: ids, custom_fields: cf });
  }

  // What removing the save's missing stash-ids leaves to tidy, or null when nothing:
  // the field line, the flag on this scene (only if nothing still ties it to a set),
  // and the flag on a lone survivor. Read from the save's own values where it carries
  // them, since those are what will land.
  function planStashIdCleanup(before, input, s) {
    var gone = (before.stash_ids || []).filter(function (e) {
      return !(input.stash_ids || []).some(function (k) { return sameStashId(k, e); });
    });
    if (!gone.length) return Promise.resolve(null);
    var field = fieldName(s), goneVals = variantValues(gone);
    var full = (input.custom_fields || {}).full;
    var lines = splitValues(full && hasOwn(full, field) ? full[field] : customField(before, field));
    var keep = lines.filter(function (l) { return goneVals.indexOf(l) === -1; });
    var cfLocked = false;
    return fieldLocks().then(function (locks) {
      // A locked field is not tidied: its lines stay, and so does what they still bind.
      if (keep.length !== lines.length && fieldLocked(locks, field)) { keep = lines; cfLocked = true; }
      return tagTree();
    }).then(function (tags) {
      var hit = tagsMatchingName(tags, flagTagName(s))[0];
      var flagId = hit ? String(hit.id) : null;
      var tagIds = hasOwn(input, 'tag_ids') ? (input.tag_ids || []).map(String) : idsOfList(before, 'tags');
      var flagged = !!flagId && tagIds.indexOf(flagId) !== -1;
      // One probe per dropped id: each names its own set, and a scene that is the only
      // one left in one set may sit in another with company.
      var probes = gone.map(function (e) { return probeSet(input.id, field, [e]); });
      probes.push(flagged ? probeSet(input.id, field, input.stash_ids || [], keep) : { rows: [] });   // what still binds this scene
      return Promise.all(probes).then(function (r) {
        var still = r.pop().rows.length;
        var sets = r.map(function (ans, i) {
          var left = ans.rows;
          var survivor = left.length === 1 && flagId &&
            idsOfList(left[0].scene, 'tags').indexOf(flagId) !== -1 ? left[0].scene : null;
          return { value: variantValue(gone[i]), others: left.length, survivor: survivor, lone: false };
        });
        var mine = variantValues(input.stash_ids).concat(keep);
        // Each survivor looked up once, whichever sets it is left in.
        var seen = {}, checks = [];
        sets.forEach(function (st) {
          if (!st.survivor || hasOwn(seen, String(st.survivor.id))) return;
          seen[String(st.survivor.id)] = true;
          checks.push(survivorAlone(st.survivor, input, mine, field).then(function (alone) {
            sets.forEach(function (o) {
              if (o.survivor && String(o.survivor.id) === String(st.survivor.id)) o.lone = alone;
            });
          }));
        });
        return Promise.all(checks).then(function () {
          var lone = [], ids = {};
          sets.forEach(function (st) {
            if (st.lone && !hasOwn(ids, String(st.survivor.id))) {
              ids[String(st.survivor.id)] = true;
              lone.push(st.survivor);
            }
          });
          var plan = { gone: gone, field: field, keep: keep, flagId: flagId,
            flagName: flagTagName(s), cfChanged: keep.length !== lines.length, cfLocked: cfLocked,
            unflagSelf: flagged && !still, still: flagged ? still : 0,
            sets: sets, lone: lone };
          return plan.cfChanged || plan.unflagSelf || plan.lone.length ? plan : null;
        });
      });
    });
  }

  // Whether the one scene left in the dropped id's set has no variant anywhere else:
  // its own ids and lines are read and matched, since the dropped id never named the
  // other sets it may sit in. The edited scene counts only through what it still
  // carries after the save. A lookup that fails answers "not alone" - a flag left on
  // is the flag task's to take off, a flag taken off wrongly is a lost mark.
  function survivorAlone(sc, input, mine, field) {
    return gqlRequest('query SVRSurvivor($id: ID!) { findScene(id: $id) ' +
      '{ id custom_fields stash_ids { endpoint stash_id } } }', { id: String(sc.id) })
      .then(function (d) {
        var full = (d || {}).findScene || {};
        var vals = variantValues(full.stash_ids).concat(splitValues(customField(full, field)));
        return findVariants({ id: String(sc.id), stash_ids: full.stash_ids || [],
          custom_fields: full.custom_fields || {} }).then(function (r) {
          var others = r.rows.filter(function (row) { return String(row.scene.id) !== String(input.id); });
          var withMe = mine.some(function (v) { return vals.indexOf(v) !== -1; });
          return !others.length && !withMe;
        });
      }).then(null, function () { return false; });
  }

  function cleanupLines(p) {
    var out = p.gone.map(function (e) {
      return 'The stash-id ' + variantValue(e) + ' comes off this scene.';
    });
    if (p.cfChanged) {
      out.push('Remove ' + (p.gone.length === 1 ? 'its line' : 'their lines') + ' from the "' +
        p.field + '" custom field' + (p.keep.length
          ? ', keeping ' + plural(p.keep.length, 'other line') + '.'
          : ' - the field comes off the scene.'));
    }
    if (p.cfLocked) {
      out.push('Leave the "' + p.field + '" custom field as it is: it is locked in ᝯㄝₓ Custom ' +
        'Fields Bulk Editor\u2019s Locked Custom Fields setting.');
    }
    if (p.unflagSelf) {
      out.push('Remove the tag "' + p.flagName + '" from this scene: no other scene shares ' +
        'what it still carries.');
    } else if (p.still) {
      out.push('Keep the tag "' + p.flagName + '" on this scene: it still shares a variant ' +
        'stash-id with ' + plural(p.still, 'other scene') + '.');
    }
    var named = {};
    p.sets.forEach(function (st) {
      var which = p.gone.length > 1 ? ' in ' + st.value + '\'s set' : ' in the set';
      if (st.survivor && st.lone) {
        if (hasOwn(named, String(st.survivor.id))) return;
        named[String(st.survivor.id)] = true;
        out.push('Remove the tag "' + p.flagName + '" from ' + (st.survivor.title || 'scene') + ' [' +
          st.survivor.id + '] too: it is the only variant left' + which + '.');
      } else if (st.survivor) {
        if (hasOwn(named, String(st.survivor.id))) return;
        named[String(st.survivor.id)] = true;
        out.push((st.survivor.title || 'Scene') + ' [' + st.survivor.id + '] keeps its tag: it still ' +
          'shares a variant stash-id with another scene.');
      } else if (st.others > 1) {
        out.push(plural(st.others, 'other scene') + ' stay' + which + ' and keep their tag.');
      }
    });
    return out;
  }

  // Folds the plan into the save's own input; returns the scene ids whose flag the
  // save cannot carry and a bulk write must take off afterwards.
  function applyStashIdCleanup(p, input) {
    var after = [];
    if (p.cfChanged) {
      var cf = input.custom_fields || (input.custom_fields = {});
      var v = p.keep.join('\n');
      if (cf.full) { if (v) cf.full[p.field] = v; else delete cf.full[p.field]; }
      else if (v) { (cf.partial || (cf.partial = {}))[p.field] = v; }
      else cf.remove = (cf.remove || []).concat([p.field]);
    }
    if (p.unflagSelf) {
      if (hasOwn(input, 'tag_ids')) {
        input.tag_ids = (input.tag_ids || []).filter(function (t) { return String(t) !== p.flagId; });
      } else after.push(String(input.id));
    }
    p.lone.forEach(function (sc) { after.push(String(sc.id)); });
    return after;
  }

  function unflagAfterSave(ids, flagId) {
    if (!ids.length) return;
    var lease = acquireLease('Variant cleanup');
    gqlRequest(BULK_TAG_MUTATION, { input: { ids: ids, tag_ids: { ids: [flagId], mode: 'REMOVE' } } })
      .then(function () { lease.release(); }, function (err) {
        lease.release();
        console.warn('[svr] the flag tag could not be removed from scene ' + ids.join(', ') +
          ': ' + err.message);
      });
  }

  // One question, two answers. Built from the same chrome as `Run` so the two dialogs
  // read as one plugin; Escape is Cancel, through the footer like everywhere else.
  // `info` makes it a message box: one Close, and no backup line, since it writes nothing.
  function confirmDialog(title, lines, info) {
    injectStyle();
    return new Promise(function (resolve) {
      var backdrop = el('div', 'svr-backdrop'), modal = el('div', 'svr-modal svr-confirm');
      backdrop.appendChild(modal);
      var head = el('div', 'svr-head');
      head.appendChild(el('div', 'svr-title', PLUGIN_SHORT_NAME + ' - ' + title));
      if (!info) {
        head.appendChild(el('div', 'svr-warn', 'Backing up your database before proceeding is recommended.'));
      }
      modal.appendChild(head);
      var body = el('div', 'svr-confirm-body');
      lines.forEach(function (t) { body.appendChild(el('div', 'svr-line', t)); });
      modal.appendChild(body);
      var foot = el('div', 'svr-foot');
      var ok = button('OK'), cancel = button(info ? 'Close' : 'Cancel');
      paintButton(ok, PLUGIN_BTN_VARIANT);
      if (info) ok.className += ' svr-hidden';
      var stub = { closeBtn: cancel };
      function done(v) {
        unwireEscape(stub);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        resolve(v);
      }
      ok.addEventListener('click', function () { done(true); });
      cancel.addEventListener('click', function () { done(false); });
      foot.appendChild(ok);
      foot.appendChild(cancel);
      modal.appendChild(foot);
      document.body.appendChild(backdrop);
      wireEscape(stub);
      var first = info ? cancel : ok;
      if (first.focus) first.focus();
    });
  }

  // ── A stash-id put on: the set it joins ───────────────────────────────────
  //
  // The mirror of the question above, as a notice rather than a write: a save that
  // adds a stash-id other scenes carry has made or grown a variant set, and the field
  // line and the flag tag that record that are the two tasks' to write. Nothing is
  // held - the save is through - and nothing is written; the box says what happened
  // and which tasks catch up. An id nobody else carries is not a set, and is not news.
  var JOINED_TITLE = 'Variant Set Joined';

  function noteJoinedSets(before, input, s) {
    var added = (input.stash_ids || []).filter(function (e) {
      return !(before.stash_ids || []).some(function (k) { return sameStashId(k, e); });
    });
    if (!added.length) return;
    var field = fieldName(s);
    Promise.all([tagTree()].concat(added.map(function (e) { return probeSet(input.id, field, [e]); })))
      .then(function (r) {
        var flagName = flagTagName(s);
        var hit = tagsMatchingName(r[0], flagName)[0];
        var flagId = hit ? String(hit.id) : null;
        var lines = [];
        r.slice(1).forEach(function (ans, i) {
          var others = ans.rows.map(function (row) { return row.scene; });
          if (!others.length) return;
          var flagged = others.some(function (sc) {
            return flagId && idsOfList(sc, 'tags').indexOf(flagId) !== -1;
          });
          lines.push('The stash-id ' + variantValue(added[i]) + ' is shared with ' +
            plural(others.length, 'other scene') + ': ' + others.map(function (sc) {
              return (sc.title || 'scene') + ' [' + sc.id + ']';
            }).join(', ') + '. This ' + (flagged ? 'extends' : 'creates') + ' a multi-variant set.');
        });
        if (!lines.length) return;
        lines.push('Running ' + TASK_NAME.replace(/\.\.\.$/, '') + ' and ' +
          FLAG_TASK_NAME.replace(/\.\.\.$/, '') + ' is recommended, so the "' + field +
          '" custom field and the "' + flagName + '" tag catch up with it.');
        confirmDialog(JOINED_TITLE, lines, true);
      }, function (err) {
        console.warn('[svr] could not look up the set a stash-id on scene ' + input.id +
          ' joins: ' + err.message);
      });
  }

  // The held save, with the answer folded in. Resolves to the ids to unflag after it,
  // or null when the save goes through as posted.
  function askStashIdCleanup(before, input, args, s) {
    return planStashIdCleanup(before, input, s).then(null, function (err) {
      console.warn('[svr] could not plan the stash-id cleanup for scene ' + input.id +
        ', so the save goes through as posted: ' + err.message);
      return null;
    }).then(function (p) {
      if (!p) return null;
      return confirmDialog(CLEANUP_TITLE, cleanupLines(p)).then(function (ok) {
        var body = JSON.parse(args[1].body), inp = body.variables.input;
        var after = ok ? applyStashIdCleanup(p, inp) : [];
        if (!ok) inp.stash_ids = (inp.stash_ids || []).concat(p.gone);
        var init = {}, k;
        for (k in args[1]) if (hasOwn(args[1], k)) init[k] = args[1][k];
        init.body = JSON.stringify(body);
        args[1] = init;
        return { input: inp, after: after, flagId: p.flagId };
      });
    });
  }

  function watchSave(orig, self, args, input) {
    args = Array.prototype.slice.call(args);
    var settingsNow = null;
    return settingsReady().then(function (s) {
      settingsNow = s;
      // The snapshot serves two readers: the propagate offer, behind its switch, and
      // the stash-id question, which has no switch and needs only saves carrying ids.
      if (!s.c1PropagateOnSave && !hasOwn(input, 'stash_ids')) return null;
      return gqlRequest(SAVE_SNAPSHOT_QUERY, { id: String(input.id) }).then(function (d) {
        return (d || {}).findScene || null;
      }, function () { return null; });   // a lost snapshot must not lose the save
    }).then(function (before) {
      var asked = before && hasOwn(input, 'stash_ids')
        ? askStashIdCleanup(before, input, args, settingsNow) : Promise.resolve(null);
      return asked.then(function (a) {
        if (a) input = a.input;
        var resp = orig.apply(self, args);
        // A side listener, never a link in the save's own chain: nothing this plugin
        // does can delay or fail the response Stash is waiting for.
        resp.then(function (r) {
          if (!r || !r.ok) return;
          if (a) unflagAfterSave(a.after, a.flagId);
          // A mounted pane's rows and deltas describe the scene this save just changed,
          // so it re-reads - whatever the propagate switch says, since the staleness
          // does not depend on it. The same door the dialogs' dirty close uses.
          if (_paneRefresh) _paneRefresh();
          if (before && settingsNow.c1PropagateOnSave) offerSettled(input, before);
          if (before && hasOwn(input, 'stash_ids')) noteJoinedSets(before, input, settingsNow);
        }, function () {});
        return resp;
      });
    }, function () { return orig.apply(self, args); });
  }

  function installSaveWatch() {
    if (typeof window.fetch !== 'function') return;
    var orig = window.fetch;
    window.fetch = function (url) {
      try {
        if (!/\/graphql([?#]|$)/.test(String(url))) return orig.apply(this, arguments);
        var input = sceneSaveOf(arguments[1]);
        if (!input) return orig.apply(this, arguments);
        if (foreignLease()) return orig.apply(this, arguments);
        return watchSave(orig, this, arguments, input);
      } catch (e) {
        return orig.apply(this, arguments);
      }
    };
  }

  // ── Not pushing a tag the hierarchy makes redundant ───────────────────────
  //
  // A scene tagged both `Blonde` and its parent `Hair Colour` carries one tag that
  // says nothing the other does not, and pushing that redundancy onto every variant
  // spreads it. `NormalizeParentTags` is the plugin that decides what "redundant"
  // means - it owns the hierarchy walk *and* the exclusion filters a user configures
  // over there - so this asks it rather than copying the rules, which is the drift its
  // API exists to end.
  //
  // **It asks a different question from `PropagateTagsAndPerformers`, deliberately.**
  // That plugin gates on `autoMode === 'prune'`, because its question is "will the
  // sibling take this tag off again in a moment" - a type nobody prunes automatically
  // is a type where adding it is harmless. This plugin's question is "is this tag
  // redundant *as data* before I copy it to three more scenes", and the answer does
  // not depend on whether anyone tidies up afterwards. `plan` answers without the
  // mode, so nothing is being worked around: the two callers ask what each needs.
  var NPT_ID = 'NormalizeParentTags';
  // Named as the user will see it: the whole point of the line is to send them to that
  // plugin's own settings group, which they then have to find.
  var NPT_NAME = 'ᝯㄝₓ Normalize Parent Tags';
  var NPT_API_MIN = '3.2.0';   // the release that publishes `prepare`, for the log line

  function nptApi() {
    var api = coop().api && coop().api[NPT_ID];
    return api && typeof api.prepare === 'function' ? api : null;
  }

  // ── Handing a renamed title to Entity Name Maintainer ─────────────────────
  //
  // Every title this plugin writes is a rename that sibling would offer to carry into
  // the library's text - except that it stands down for the lease the writes go out
  // under, and rightly: a bulk run must not raise a dialog per scene. So the titles
  // are handed to it by name instead, once the lease is given back, and it offers
  // them one after another. A sibling too old to take them is named in the log; no
  // sibling at all is silence, since there is nobody to send the reader to.
  var ENM_ID = 'EntityNameMaintainer';
  var ENM_NAME = 'ᝯㄝₓ Entity Name Maintainer';
  var ENM_API_MIN = '2.2.0';   // the release that publishes `renamed`, for the log line

  function enmApi() {
    var api = coop().api && coop().api[ENM_ID];
    return api && typeof api.renamed === 'function' ? api : null;
  }

  function handRenames(run) {
    var list = run.renamed || [];
    run.renamed = [];
    if (!list.length) return;
    var api = enmApi();
    if (!api) {
      if (coop().respecters[ENM_ID]) {
        run.msg('INFO', plural(list.length, 'renamed title was', 'renamed titles were') +
          ' not handed to ' + ENM_NAME + ': the one on this page is older than ' + ENM_API_MIN + '.');
      }
      return;
    }
    // One call for the lot, so the sibling knows the batch: two partials whose indexes
    // were swapped must not be offered as mentions of each other's old title. A sibling
    // from before the batch shape answers with no count, and is handed them one by one.
    var taken = api.renamed({ type: 'scene', owner: PLUGIN_SHORT_NAME, renames: list });
    if (typeof taken !== 'number') {
      taken = list.filter(function (r) {
        return api.renamed({ type: 'scene', id: r.id, from: r.from, to: r.to,
          owner: PLUGIN_SHORT_NAME }) === true;
      }).length;
    }
    if (!taken) return;
    run.msg('INFO', plural(taken, 'renamed title was', 'renamed titles were') + ' handed to ' +
      ENM_NAME + ', which offers to update mentions of the old ' +
      (taken === 1 ? 'title' : 'titles') + ' - a dialog per title mentioned anywhere, one after another.');
  }

  // A bound pruner, or null. Resolved once per run and read synchronously from the
  // planner, which is the whole reason the sibling's `plan` is not a promise.
  function nptPruner(s) {
    if (!s.c3SkipRedundantTags) return Promise.resolve(null);
    var api = nptApi();
    if (!api) return Promise.resolve(null);
    return api.prepare({ entityType: 'scenes' }).then(function (w) {
      // Feature-detected rather than version-gated: the number is for a log line.
      return w && typeof w.plan === 'function' ? w : null;
    }, function () { return null; });   // a sibling that cannot answer is not asked
  }

  // Which of `ids` the sibling would prune off this target. Asked against the tags the
  // target would actually be carrying - its own plus the ones under consideration -
  // because a tag is redundant for being implied by *any* of them, most often by one
  // that was already there.
  function redundantOf(pruner, target, ids) {
    var all = {}, k, out = {};
    idsOfList(target, 'tags').forEach(function (id) { all[id] = true; });
    ids.forEach(function (id) { all[String(id)] = true; });
    var list = [];
    for (k in all) if (hasOwn(all, k)) list.push(k);
    var res = null;
    // A sibling that throws is one that is not asked again here; this decides what to
    // skip and never what to write, so failing open is right.
    try { res = pruner.plan({ mode: 'prune', tagIds: list }); } catch (e) { return out; }
    if (!res || !res.remove) return out;
    res.remove.forEach(function (id) { out[String(id)] = true; });
    return out;
  }

  // What a run says about the filter once, after its listing: what it dropped, or why
  // it dropped nothing. A setting that is on and silently doing nothing is the failure
  // this line exists to prevent.
  function reportPruneFilter(run, s) {
    if (!s.c3SkipRedundantTags) return;
    if (run.pruner) {
      if (run.pruned) {
        run.msg('INFO', plural(run.pruned, 'tag was', 'tags were') + ' not listed: ' +
          'the tag hierarchy already implies ' +
          (run.pruned === 1 ? 'it' : 'them') + ' through another tag the scene carries.');
      }
      return;
    }
    run.msg('INFO', 'Redundant tags are not being filtered: ' +
      (nptApi() ? 'the copy of ' + NPT_NAME + ' running here is older than ' +
        NPT_API_MIN + '.'
        : NPT_NAME + ' is not installed, or is disabled, so nothing here can say ' +
          'which tags the hierarchy makes redundant.'));
  }

  // ── Reviewing every variant set in the library ────────────────────────────
  //
  // The two per-scene doors into synchronization - the tab's button and the save
  // dialog - both start from a scene the user is already looking at. This one starts
  // from the library: every multi-variant set, scored by how far apart its members
  // have drifted, worst first, so the sets worth a minute are the ones at the top.
  //
  // It is a *listing*, not a plan: nothing is written until a set and a source are
  // picked and Synchronize Set from Selected is pressed, at which point the same `planSyncScene`
  // that both other doors use lists the changes below, with the same boxes, the same
  // All bar, the same Proceed and the same Undo.

  // With a naming rule and a base, a title counts against a set only where it is not
  // the expected one - a partial named after its set is not drift, and a full-duration
  // scene's title is what the base is read from. Without a base, the plurality count.
  // Either way a scene carrying the base-name field is left out of the title count:
  // its name was pinned by hand, so its title differing is a decision, not drift.
  function setDelta(scenes, skip, coverBy, expectedBy, baseField) {
    var out = setDeltaRaw(scenes, skip, coverBy);
    var counted = baseField ? scenes.filter(function (sc) {
      var v = sc.custom_fields && sc.custom_fields[baseField];
      return !(typeof v === 'string' && trim(v));
    }) : scenes;
    if (expectedBy) {
      out.title = counted.filter(function (sc) {
        return hasOwn(expectedBy, String(sc.id)) && (sc.title || '') !== expectedBy[String(sc.id)];
      }).length;
    } else if (counted.length !== scenes.length) {
      out.title = setDeltaRaw(counted, skip, null).title;
    }
    return out;
  }

  // ── Rename Variants: naming a partial after its set ────────────────────────
  //
  // A partial-duration scene is expected to be called "<base><postfix>", or with an
  // index after the postfix where the set has more than one partial. The base is
  // what the set's titles share once the plugin's own postfix is taken off, a
  // remembered base on any member first; the full-duration members are never renamed,
  // since the base is read from them. Everything here is pure: the task and the
  // review's title count both call it.

  // ── The index counter ─────────────────────────────────────────────────────
  //
  // The first index is a string, and its spelling is the whole rule: "1" counts 1, 2,
  // 3; "01" counts 01, 02 ... 99, 100; "A" counts A ... Z, AA, AB; "AA" starts at AA
  // and runs to ZZ, then AAA. Digits count in base ten, letters in the bijective base
  // twenty-six a spreadsheet names its columns in, padded to the first index's length
  // and growing past it rather than stopping. Anything else counts as "1".
  function indexAlphabet(first) {
    if (!first) return null;   // no index at all
    if (/^[0-9]+$/.test(first)) return { kind: 'digits', width: first.length };
    if (/^[A-Z]+$/.test(first)) return { kind: 'upper', width: first.length };
    if (/^[a-z]+$/.test(first)) return { kind: 'lower', width: first.length };
    return { kind: 'digits', width: 1 };
  }
  function indexValue(str, alpha) {
    if (alpha.kind === 'digits') return parseInt(str, 10);
    var n = 0, s = str.toUpperCase();
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n;
  }
  function indexString(n, alpha) {
    if (alpha.kind === 'digits') {
      var d = String(n);
      while (d.length < alpha.width) d = '0' + d;
      return d;
    }
    var out = '';
    while (n > 0) {
      var r = (n - 1) % 26;
      out = String.fromCharCode(65 + r) + out;
      n = Math.floor((n - 1) / 26);
    }
    while (out.length < alpha.width) out = 'A' + out;
    return alpha.kind === 'lower' ? out.toLowerCase() : out;
  }
  // The pattern one index of this alphabet wears, for reading an index off a title.
  function indexPattern(alpha) {
    return alpha.kind === 'digits' ? '[0-9]+' : alpha.kind === 'upper' ? '[A-Z]+' : '[a-z]+';
  }

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // The same, with every run of spaces matching any run of whitespace: a title typed with
  // two spaces, or a non-breaking one, before its index is still in the expected shape,
  // so it keeps its index and is only respaced rather than renumbered.
  function looseRe(s) { return escapeRe(s).replace(/\s+/g, '\\s+'); }
  // Whitespace a log line cannot show: doubled, leading or trailing, or not a plain space.
  function oddSpacing(t) { return /\s\s|[^\S ]|^\s|\s$/.test(String(t || '')); }

  // ── The base name ─────────────────────────────────────────────────────────
  //
  // Titles with this plugin's own postfix taken off, then the longest prefix they
  // share, cut back to a word boundary in every longer title and stripped of trailing
  // separators. "Song - Remastered" and "Song - Promo 2" give "Song"; "Songbird" and
  // "Song" give nothing, since the shared letters end inside a word.
  // What a partial wears when it has no index: the postfix without its trailing space.
  function bareTitle(base, postfix) { return (base + postfix).replace(/\s+$/, ''); }
  function stripPostfix(title, postfix, alpha) {
    // With no postfix there is nothing to tell an index from a number in the name, so
    // every title votes whole: "Episode 12" must not vote "Episode".
    if (!postfix) return title;
    var re = new RegExp('(' + looseRe(postfix) + (alpha ? indexPattern(alpha) : '') + '|' +
      looseRe(bareTitle('', postfix)) + ')\\s*$');
    return title.replace(re, '');
  }
  function commonPrefix(titles) {
    if (!titles.length) return '';
    var p = titles[0];
    titles.forEach(function (t) {
      var i = 0;
      while (i < p.length && i < t.length && p.charAt(i) === t.charAt(i)) i++;
      p = p.slice(0, i);
    });
    var insideWord = function () {
      return titles.some(function (t) { return t.length > p.length && /[0-9A-Za-zÀ-￿]/.test(t.charAt(p.length)); });
    };
    while (p.length && insideWord()) p = p.slice(0, -1);
    return p.replace(/[\s\-–—_:|,.;(\[]+$/, '');
  }

  // `members`: [{ id, title, role ('fl'|'pl'|other), duration, size, custom_fields }].
  // `naming`: { postfix, first, baseField, skipField }.
  // Returns { base, from: 'field'|'prefix'|'full'|null, voters }. `leadId`, for a sync
  // planned from one scene: that scene alone votes where it is full-duration, else the
  // full-duration members do - the save that just renamed a scene is the base now, and
  // the partials still wearing the old one would vote the new one down to nothing.
  function baseOf(members, naming, leadId) {
    var alpha = indexAlphabet(naming.first);
    var pinned = null;
    // A remembered base on any member wins, the full-duration member's first.
    members.slice().sort(function (a, b) { return (a.role === 'fl' ? 0 : 1) - (b.role === 'fl' ? 0 : 1); })
      .forEach(function (m) {
        var v = m.custom_fields && m.custom_fields[naming.baseField];
        if (pinned === null && typeof v === 'string' && v.replace(/^\s+|\s+$/g, '')) pinned = v.replace(/^\s+|\s+$/g, '');
      });
    if (pinned !== null) return { base: pinned, from: 'field' };
    var titled = members.filter(function (m) { return typeof m.title === 'string' && m.title; });
    // Who votes on the prefix: the full-duration members alone, where the set has any -
    // the base is read from them, and a partial still wearing an old base would vote a
    // new one down to what the two share ("Adventures #04, Scene #04" against "Adventures
    // #04 - Scene 4 - Promo 1" is "Adventures #04"). With none, the partials already
    // named in the expected shape; a partial titled any old way is what the rename is
    // for. With no such member either, every titled member votes.
    var lead = leadId != null ? titled.filter(function (m) { return m.id === String(leadId); })[0] : null;
    var full = titled.filter(function (m) { return m.role === 'fl'; });
    var voters = lead && lead.role === 'fl' ? [lead] : full.length ? full : titled.filter(function (m) {
      return !lead && stripPostfix(m.title, naming.postfix, alpha) !== m.title;
    });
    if (!voters.length) voters = titled;
    var prefix = commonPrefix(voters.map(function (m) { return stripPostfix(m.title, naming.postfix, alpha); }));
    if (!prefix) return { base: '', from: null, voters: [] };
    return { base: prefix, from: voters.length === 1 && voters[0].role === 'fl' ? 'full' : 'prefix', voters: voters };
  }

  // Partials in the order the tab shows them - longest first, then the bigger file,
  // then the lower id - which is the order their indexes count in.
  function partialOrder(a, b) {
    return (b.duration || 0) - (a.duration || 0) || (b.size || 0) - (a.size || 0) ||
      (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0);
  }

  // The expected title of every partial-duration member, against the base. One partial
  // wears the postfix alone, or the first index where the setting says so; several wear
  // it with an index. An index a title already
  // carries in the expected shape is kept unless `renumber`, so a run does not renumber
  // a set that was numbered by hand; the rest take the next free index in order.
  // Full-duration members are never renamed: their titles are what the base is read from.
  // Returns [{ member, expected, kept, skipped }] for every partial, expected === title
  // where nothing would change.
  function expectedTitles(members, naming, base, renumber) {
    var alpha = indexAlphabet(naming.first);
    var partials = members.filter(function (m) { return m.role === 'pl'; }).sort(partialOrder);
    var out = partials.map(function (m) {
      var skip = m.custom_fields && m.custom_fields[naming.skipField];
      return { member: m, expected: m.title, kept: false, skipped: !!skip || !!m.excluded };
    });
    var live = out.filter(function (o) { return !o.skipped; });
    if (!base) return out;
    if (!alpha || (live.length === 1 && !naming.loneIndex)) {
      live.forEach(function (o) { o.expected = bareTitle(base, naming.postfix); });
      return out;
    }
    var shape = new RegExp('^\\s*' + looseRe(base + naming.postfix) + '(' + indexPattern(alpha) + ')\\s*$');
    var taken = {};
    if (!renumber) {
      live.forEach(function (o) {
        var m = shape.exec(o.member.title || '');
        if (!m || taken[indexValue(m[1], alpha)]) return;
        taken[indexValue(m[1], alpha)] = true;
        o.kept = true;
        o.expected = base + naming.postfix + m[1];
      });
    }
    var n = indexValue(naming.first, alpha);
    live.forEach(function (o) {
      if (o.kept) return;
      while (taken[n]) n++;
      taken[n] = true;
      o.expected = base + naming.postfix + indexString(n, alpha);
    });
    return out;
  }


  // One member per scene, in the shape the naming functions read.
  function memberOf(sc, m) {
    var f = bestFile(sc) || {};
    return { id: String(sc.id), title: sc.title || '', role: classify(sc, m).role,
      duration: f.duration || 0, size: f.size || 0, custom_fields: sc.custom_fields || {},
      excluded: (sc.tags || []).some(function (t) { return !!m.noRename[String(t.id)]; }),
      scene: sc };
  }

  // { base, expected }: the set's base as `baseOf` read it, and { id: expected title }
  // over its partials, or null where the set has no base or no partial to rule on -
  // the tags unset, or a set of full-duration scenes - and the title is scored the way
  // it always was. `expectedMap` is what the review scores a title against.
  function namingOf(scenes, m, nm, leadId) {
    var members = scenes.map(function (sc) { return memberOf(sc, m); });
    var b = baseOf(members, nm, leadId);
    if (!b.base) return { base: b, expected: null };
    var out = {}, any = false;
    expectedTitles(members, nm, b.base, nm.renumber).forEach(function (p) {
      if (p.skipped) return;
      out[p.member.id] = p.expected;
      any = true;
    });
    return { base: b, expected: any ? out : null };
  }
  function expectedMap(scenes, m, nm) { return namingOf(scenes, m, nm).expected; }

  // ── The title rules, in one dialog ────────────────────────────────────────
  //
  // Eight settings about one thing - how a partial-duration scene is titled - had
  // eight rows on Stash's settings page, beside the tags and the switches the tab
  // itself runs on, and the page read as a wall. They are one dialog now, opened from
  // one row of the group: stored under the same keys, so nothing already set moves,
  // and written whole the way every settings write here is.
  var TITLE_TASK_NAME = 'Variants Title...';

  var TITLE_FIELDS = [
    { key: 'c5PropagateTitleOnSave', bool: true, label: 'Rename Variants After a Title Change',
      tip: 'Also list the title in the propagate dialog when a save changed it, each ' +
        'partial named under the new base.\n\nOff by default: a title is the one value a ' +
        'variant most deliberately owns, so pushing it is opted into twice - here and then ' +
        'per line in the dialog, where title lines start unticked like every other replace. ' +
        'While this is off, a dialog raised by a save that changed the title says so in its ' +
        'listing rather than silently dropping the change. Only the save-triggered dialog ' +
        'reads this: the Synchronize Variants button on the tab always lists titles, unticked.' },
    { key: 'e1PartialPostfix', label: 'Partial-duration Title Postfix',
      tip: 'What goes after the set\'s base name to title a partial-duration scene, ' +
        'separators included: nothing is added between the base and the postfix, or between ' +
        'the postfix and the index.\n\nDefault " - Promo ", so a cut of \'Song\' is \'Song - ' +
        'Promo\' - a trailing space is dropped when no index follows - and two cuts are ' +
        '\'Song - Promo 1\' and \'Song - Promo 2\'. \' - cut #\' with a first index of \'00\' ' +
        'gives \'Song - cut #00\'. Empty means no postfix: \'Song1\' and \'Song2\', or \'Song\' ' +
        'alone with no first index either.' },
    { key: 'e2FirstIndex', label: 'First Partial Index',
      tip: 'The index the first partial of a set gets when a set has more than one - or ' +
        'always, with the switch below - and how the rest are counted: its spelling is the ' +
        'rule.\n\n"1" counts 1, 2, 3; "01" counts 01, 02 and on past 99; "A" counts A to Z ' +
        'then AA; "AA" runs to ZZ then AAA. It follows the postfix with nothing between them. ' +
        'Indexes are handed out longest scene first, and an index a title already carries in ' +
        'the expected shape is kept. Empty means no index at all: every partial wears the ' +
        'postfix alone.' },
    { key: 'e2bIndexLonePartial', bool: true, label: 'Index a Set\'s Only Partial',
      tip: 'On, a set with a single partial-duration scene gets the first index too: ' +
        '\'Song - Promo 1\'. Off, it wears the postfix alone: \'Song - Promo\'.\n\nNothing ' +
        'changes without a first index.' },
    { key: 'e2cRenumberByDuration', bool: true, label: 'Renumber by Duration',
      tip: 'On, every partial of a set is expected to carry the index its duration gives ' +
        'it, longest first, so a set numbered the other way round is title drift and each ' +
        'dialog offers the swap.\n\nOff, a partial already carrying an index in the expected ' +
        'shape keeps it wherever it falls, and only unnumbered partials take the next free ' +
        'one. The box in the Rename Variants dialog starts from this and overrides it for ' +
        'that dialog only. A scene marked in the no-rename field or wearing the no-rename ' +
        'tag keeps its title either way.' },
    { key: 'e3BaseNameField', cfDefault: BASE_FIELD_DEFAULT, label: 'Variant Base Name Custom Field',
      tip: 'The custom field whose value names a variant set: whatever is written in it on ' +
        'any scene of the set is the base every partial is titled from, before the postfix ' +
        'and the index. Empty means the default name, ' + BASE_FIELD_DEFAULT + '.\n\n' +
        'Read off every scene of the set, the full-duration one first: where several ' +
        'carry a value, the full-duration scene\'s wins, then the first partial found. A ' +
        'value on a partial alone still names the set. Spaces around it are dropped, and a ' +
        'blank value counts as not set.\n\nWhere a value is found the titles are not read ' +
        'at all - no shared prefix, no falling back to the full-duration title. Where none ' +
        'is, the base is what the set\'s titles share once the postfix is taken off, or the ' +
        'full-duration scene\'s title when they share nothing. Either way the base names ' +
        'the partials only: a full-duration scene is never renamed, so the field on it ' +
        'changes nothing but its partials\' titles.\n\nRead everywhere the rule applies - ' +
        'Rename Variants, Synchronize Variants and Synchronize Set from Selected, the offer after a save, ' +
        'and the title drift the review and the tab count. Never written by this plugin, ' +
        'and never checked against the titles: a value left on a partial from a set it ' +
        'used to belong to names the whole set. A scene marked in the no-rename field or ' +
        'wearing the no-rename tag keeps its title whatever the base is.' },
    { key: 'e4NoRenameField', cfDefault: SKIP_FIELD_DEFAULT, label: 'Variant No-Rename Custom Field',
      tip: 'A custom field that, set to anything on a scene, keeps every title rule from ' +
        'proposing a title for it. Empty means the default name, ' + SKIP_FIELD_DEFAULT +
        '.\n\nFor the partial that falls outside the rule. The scene is still counted as ' +
        'a member of its set - its title is simply never the one the set would give it, ' +
        'and never counted as drift.' },
    { key: 'e5NoRenameTag', label: 'Exclude Scenes Carrying This Tag From Renaming',
      tip: 'The name of a tag: a scene carrying it, or any tag filed under it, is left ' +
        'alone by every title rule, the same way the no-rename field leaves one alone.\n\n' +
        'Matched by name or alias, without regard to case, like the tags on the settings ' +
        'page. Empty excludes nothing.' },
  ];

  var _title = null;

  function TitleDialog() {
    this.boxes = {};
    this.remarks = [];
    this.stored = null;
    this.saving = false;
  }

  TitleDialog.prototype.build = function () {
    injectStyle();
    var self = this;
    this.backdrop = el('div', 'svr-backdrop');
    this.modal = el('div', 'svr-modal svr-narrow');
    this.backdrop.appendChild(this.modal);
    var head = el('div', 'svr-head');
    head.appendChild(el('div', 'svr-title', PLUGIN_SHORT_NAME + ' - ' + TITLE_TASK_NAME));
    head.appendChild(el('div', 'svr-legend', 'How a partial-duration scene is titled after ' +
      'its set, everywhere the rule is applied: Rename Variants, the Synchronize dialogs, ' +
      'the offer after a save, and the title drift the review and the tab count. Hover a ' +
      'line for what it does. Nothing is written until you press Save.'));
    this.noteEl = el('div', 'svr-note', 'Reading the current settings…');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);
    this.body = el('div', 'svr-form');
    TITLE_FIELDS.forEach(function (f) {
      var row = el('label', 'svr-field');
      row.title = f.tip;
      var box = el('input', 'svr-field-box');
      box.type = f.bool ? 'checkbox' : 'text';
      box.disabled = true;
      box.addEventListener(f.bool ? 'click' : 'input', function () { self.refreshSave(); });
      var cap = el('span', 'svr-field-label', f.label);
      // The switch sits before its caption, as Stash's own do; a text box sits under it.
      if (f.bool) { row.appendChild(box); row.appendChild(cap); }
      else { row.appendChild(cap); row.appendChild(box); }
      if (f.cfDefault) {
        // The field in force - the box, else the default - marked after the caption.
        var remark = function () {
          var field = trim(box.value) || f.cfDefault;
          if (cap._cf === field) return;
          var old = cap.nextSibling;
          if (old && old !== box && /\bgttx-cftipped\b/.test(String(old.className || ''))) row.removeChild(old);
          cap._cf = field;
          markField(cap, field);
        };
        box.addEventListener('change', remark);
        self.remarks.push(remark);
      }
      row.appendChild(el('span', 'svr-field-note', oneLine(f.tip.split('\n\n')[0])));
      self.boxes[f.key] = box;
      self.body.appendChild(row);
    });
    this.modal.appendChild(this.body);
    var foot = el('div', 'svr-foot');
    this.saveBtn = button('Save', 'svr-save');
    this.saveBtn.className = this.saveBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.saveBtn.disabled = true;
    this.saveBtn.title = 'Nothing has changed.';
    this.closeBtn = button('Cancel', 'svr-cancel');
    this.saveBtn.addEventListener('click', function () { self.save(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });
    foot.appendChild(this.saveBtn);
    foot.appendChild(this.closeBtn);
    this.modal.appendChild(foot);
    wireEscape(this);
    document.body.appendChild(this.backdrop);
    loadSettings().then(function (s) {
      if (_title !== self) return;
      self.stored = s;
      TITLE_FIELDS.forEach(function (f) {
        if (f.bool) self.boxes[f.key].checked = !!s[f.key];
        else self.boxes[f.key].value = s[f.key] == null ? '' : String(s[f.key]);
        self.boxes[f.key].disabled = false;
      });
      self.remarks.forEach(function (r) { r(); });
      self.noteEl.textContent = '';
      self.refreshSave();
    }, function (e) {
      if (_title !== self) return;
      self.noteEl.textContent = 'The current settings could not be read (' +
        (e && e.message ? e.message : e) + '). Saving from here would replace them with ' +
        'whatever the boxes hold, so Save stays disabled - close this and try again.';
    });
  };

  TitleDialog.prototype.values = function () {
    var out = {}, self = this;
    TITLE_FIELDS.forEach(function (f) {
      out[f.key] = f.bool ? !!self.boxes[f.key].checked : self.boxes[f.key].value;
    });
    return out;
  };

  TitleDialog.prototype.refreshSave = function () {
    var changed = false, v = this.values(), s = this.stored;
    if (s) TITLE_FIELDS.forEach(function (f) { if (v[f.key] !== s[f.key]) changed = true; });
    this.saveBtn.disabled = this.saving || !s || !changed;
    this.saveBtn.title = !s ? 'Still reading the current settings.'
      : !changed ? 'Nothing has changed.' : 'Write these settings.';
  };

  // The whole stored map goes back, per the rule `configurePlugin` forces. The cache
  // takes the new values at once: the next dialog that names a partial reads them
  // through `settingsReady`, which would otherwise serve the old ones for ten seconds.
  TitleDialog.prototype.save = function () {
    if (this.saving || this.saveBtn.disabled) return;
    var self = this, v = this.values();
    this.saving = true;
    this.refreshSave();
    this.noteEl.textContent = 'Saving…';
    gqlRequest('{ configuration { plugins } }', null).then(function (data) {
      var raw = ((data.configuration || {}).plugins || {})[PLUGIN_ID] || {};
      var input = {}, k;
      for (k in raw) if (hasOwn(raw, k)) input[k] = raw[k];
      for (k in v) if (hasOwn(v, k)) input[k] = v[k];
      return gqlRequest('mutation SVRSaveTitleSettings($id: ID!, $input: Map!) ' +
        '{ configurePlugin(plugin_id: $id, input: $input) }', { id: PLUGIN_ID, input: input });
    }).then(function () {
      if (_settings) for (var k in v) if (hasOwn(v, k)) _settings[k] = v[k];
      if (_title === self) self.close();
    }, function (e) {
      self.saving = false;
      if (_title !== self) return;
      self.refreshSave();
      self.noteEl.textContent = 'The settings could not be saved: ' +
        (e && e.message ? e.message : e);
    });
  };

  TitleDialog.prototype.focus = Run.prototype.focus;

  TitleDialog.prototype.close = function () {
    unwireEscape(this);
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    if (_title === this) _title = null;
  };

  function openTitleDialog() {
    if (_title) { _title.focus(); return; }
    _title = new TitleDialog();
    _title.build();
  }

  // The dialog's row on Settings → Plugins, in the shape of Stash's own rows so it reads
  // as one setting among them: a heading, a line, and the button where Edit would be.
  //
  // Beside the last of Stash's own rows, never on the group itself: on a Stash whose
  // plugin groups fold (develop's collapsible list), the rows sit in a <Collapse> under
  // the header, and a row appended to the group stayed on screen with the group folded.
  // Live, on a preview of 0.32. The group is the fallback where no row can be found.
  var TITLE_ROW_ID = 'svr-title-row';

  // What the eight settings say now, in one line under the row's description, the way
  // Stash shows a setting's value under its own.
  // Text, with each custom field's name as `{ cf }` so the row can mark it.
  function titleSummaryParts(s) {
    var nm = naming(s);
    return ['Postfix "' + (nm.postfix || '') + '"' + (nm.postfix ? '' : ' (none)') +
      (nm.first ? ', indexes from "' + nm.first + '"' + (nm.loneIndex ? ', a lone partial indexed too' : '') +
        (nm.renumber ? ', renumbered by duration' : ', indexes kept') : ', no index') +
      '; base name in "', { cf: nm.baseField }, '", no-rename in "', { cf: nm.skipField }, '"' +
      (nm.skipTag ? ' or tagged "' + nm.skipTag + '"' : '') +
      '; a title change after a save is ' + (s.c5PropagateTitleOnSave ? '' : 'not ') + 'offered to the variants.'];
  }
  function titleSummary(s) {
    return titleSummaryParts(s).map(function (p) { return typeof p === 'string' ? p : p.cf; }).join('');
  }
  // A custom field's ⓘ after its name, where Custom Fields Bulk Editor describes it.
  function markField(nameNode, field) {
    if (typeof cfTipMark !== 'function') return;
    cfTipMark(field).then(function (mark) {
      if (!mark || !nameNode.parentNode || nameNode._cf !== field) return;
      nameNode.parentNode.insertBefore(mark, nameNode.nextSibling);
    });
  }
  function drawTitleSummary(node, s) {
    while (node.firstChild) node.removeChild(node.firstChild);
    node._summary = titleSummary(s);
    titleSummaryParts(s).forEach(function (p) {
      if (typeof p === 'string') { node.appendChild(el('span', null, p)); return; }
      var name = el('span', 'svr-cfname', p.cf);
      name._cf = p.cf;
      node.appendChild(name);
      markField(name, p.cf);
    });
  }

  function ensureTitleRow(group) {
    var had = document.getElementById(TITLE_ROW_ID);
    if (had) {
      if (had._sum && had._sum._summary !== titleSummary(settings())) drawTitleSummary(had._sum, settings());
      return;
    }
    var host = null;
    for (var key in DEFAULTS) {
      if (!hasOwn(DEFAULTS, key)) continue;
      var r = settingRow(key);
      if (r && r.parentNode) host = r.parentNode;
    }
    var row = el('div', 'setting svr-title-row');
    row.id = TITLE_ROW_ID;
    var left = el('div');
    left.appendChild(el('h3', null, 'Variants Title'));
    left.appendChild(el('div', 'sub-heading', 'How a partial-duration scene is titled after ' +
      'its set: the postfix, the index, the base-name and no-rename marks, and whether a ' +
      'title change after a save is offered to the variants. Eight settings, in a dialog.'));
    row._sum = left.appendChild(el('div', 'value svr-title-sum'));
    drawTitleSummary(row._sum, settings());
    row.appendChild(left);
    var right = el('div');
    var btn = button(TITLE_TASK_NAME, 'svr-title-btn');
    btn.className = btn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    btn.title = 'Open the title rules. Nothing is written until you press Save there.';
    btn.addEventListener('click', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      openTitleDialog();
    });
    right.appendChild(btn);
    row.appendChild(right);
    (host || group).appendChild(row);
  }

  var RENAME_TASK_NAME = 'Rename Variants...';

  function renameBegin(run) {
    return Promise.all([settingsReady(), tagTree()]).then(function (both) {
      var s = both[0], m = matchers(both[1], s), field = fieldName(s), nm = naming(s);
      run.settings = s;
      // The box starts from the setting and is this run's override of it.
      if (run.renumber == null) run.renumber = nm.renumber;
      run.buildRenameBar();
      // The renumber box re-lists what the last scan found rather than reading the
      // library again: the sets have not changed, only how their indexes are handed out.
      if (run.replanOnly && run.scannedSets) {
        run.replanOnly = false;
        return planRenames(run, m, nm);
      }
      run.msg('INFO', 'Looking for every variant set, to name each partial-duration scene ' +
        'after its set: "<base>' + bareTitle('', nm.postfix) + '"' + (nm.first
          ? ', with an index counted from "' + nm.first + '"' + (nm.loneIndex ? '.' : ' where a set has more than one.')
          : ', with no index.'));
      run.afterPage = function (got) { run.setCount = variantSetsOf(got, field).length; };
      return setMembersScan(run, field)
        .then(function (scenes) {
          if (run.stopped) return null;
          run.scannedSets = variantSetsOf(scenes, field);
          run.setCount = run.scannedSets.length;
          return planRenames(run, m, nm);
        });
    });
  }

  var FROM_TEXT = { field: 'the "%s" field', prefix: 'what these titles share',
    full: 'the full-duration scene\'s title' };

  function planRenames(run, m, nm) {
    if (!run.scannedSets.length) {
      run.msg('INFO', 'No scene in the library shares a stash-id or a "' + fieldName(run.settings) +
        '" line with another, so there is no variant set to name.');
      return null;
    }
    var changes = 0, skipped = 0, unbased = 0;
    run.scannedSets.forEach(function (set) {
      var members = set.scenes.map(function (sc) { return memberOf(sc, m); });
      var b = baseOf(members, nm);
      var names = members.map(function (x) { return (x.title || '(untitled)') + ' [' + x.id + ']'; }).join(', ');
      if (!b.base) {
        unbased++;
        run.msg('WARN', 'Set of ' + plural(members.length, 'scene') + ' (' + names + '): the titles ' +
          'share nothing and no single full-duration scene names it, so nothing is proposed. ' +
          'Put the base name in "' + nm.baseField + '" on one of them to name this set.');
        return;
      }
      // Which scenes the base was read from, so a base that looks wrong says why.
      var from = FROM_TEXT[b.from].replace('%s', nm.baseField) + (b.voters && b.voters.length
        ? ': ' + b.voters.map(function (v) { return '"' + v.title + '" [' + v.id + ']' + (v.role === 'fl' ? ' (full-duration)' : ''); }).join(', ')
        : '');
      expectedTitles(members, nm, b.base, !!run.renumber).forEach(function (p) {
        if (p.skipped) { skipped++; return; }
        if (p.expected === p.member.title) return;
        changes++;
        var ops = valueDiffOps(p.member.title, p.expected);
        // The line collapses whitespace, so a change in spacing alone would read as none.
        var respaced = oddSpacing(p.member.title) && !oddSpacing(p.expected);
        run.tickLine({ id: p.member.id, title: p.member.title || '(untitled)', kind: 'set',
          input: 'title', group: 'Title', value: p.expected, had: p.member.title || '' },
        'svr-op-set', '[RENAME]  ',
        // The same word diff a sync line wears: two long titles differing in their last
        // character were shown cut at the sixtieth, identical on screen. Both whole
        // titles are in the hover text below.
        [['  Title: ', null]].concat(ops ? valueDiffParts(ops)
          : [[syncValShow(p.member.title || ''), 'svr-del'], [' \u2192 ', 'svr-mod'],
            [syncValShow(p.expected), 'svr-add']]).concat(respaced ? [['  (spacing fixed)', 'svr-mod']] : []),
        false,
        'Rename "' + (p.member.title || '') + '" to "' + p.expected + '".' + (respaced
          ? ' The title has doubled, leading, trailing or non-breaking spaces, which the line cannot ' +
            'show; the new one has single plain spaces.' : '') + ' The base "' + b.base +
          '" is ' + from + '.');
      });
    });
    if (skipped) {
      run.msg('INFO', plural(skipped, 'partial-duration scene') + ' left alone: marked with "' +
        nm.skipField + '"' + (nm.skipTag ? ' or tagged "' + nm.skipTag + '"' : '') + '.');
    }
    if (unbased) run.msg('INFO', plural(unbased, 'set') + ' without a base name, listed above.');
    run.msg('INFO', changes
      ? plural(changes, 'rename') + ' proposed, none ticked: tick the ones to write, then press Proceed.'
      : 'Every partial-duration scene in a set is already named after it.');
    return null;
  }

  // The one option the listing has: hand the indexes out again in the tab's order
  // - longest first - instead of keeping the index a title already carries.
  Run.prototype.buildRenameBar = function () {
    var self = this;
    this.weightBar.className = 'svr-allbar';
    this.weightBar.textContent = '';
    var wrap = el('label', 'svr-renumber');
    var box = el('input', 'svr-renumber-box');
    box.type = 'checkbox';
    box.checked = !!this.renumber;
    // On the label, so the caption explains itself as well as the box.
    wrap.title = 'On: every partial in a set is numbered afresh in order of duration, longest ' +
      'first, whatever index its title carries now. Off: a partial already numbered in the ' +
      'expected shape keeps its index, and only the rest take the next free ones, in that ' +
      'same order. Either way the listing re-plans at once, without reading the library again. ' +
      'It starts as the "Renumber by Duration" setting says and overrides it for this dialog only.';
    box.addEventListener('click', function () {
      if (self.state !== 'listing') { box.checked = !!self.renumber; return; }
      self.renumber = box.checked;
      self.replanOnly = true;
      self.rescan();
    });
    wrap.appendChild(box);
    wrap.appendChild(el('span', null, ' Force renumber by duration, longest first'));
    this.weightBar.appendChild(wrap);
    this.show(this.weightBar, true);
  };

  var RENAME_TASK = {
    title: 'Rename Variants',
    legend: 'Every partial-duration scene in a variant set, named after its set: the ' +
      'base name the set\'s titles share, then the postfix from your settings, then an ' +
      'index where the set has more than one partial - counted longest first, and kept ' +
      'where a title already carries one. Full-duration scenes are never renamed: the ' +
      'base is read from them. A base remembered in the base-name field wins over the ' +
      'titles, and a scene marked in the no-rename field or wearing the no-rename tag is ' +
      'left alone. Nothing starts ' +
      'ticked and nothing is written until you press Proceed; Undo puts every written ' +
      'title back while the dialog stays open.',
    nothing: 'Nothing is ticked.',
    scanNoun: 'scene',
    planNoun: 'proposed',
    planUnit: 'rename',
    leaseLabel: 'Variant renaming',
    undoTip: 'Put back every title this dialog wrote. Only what it wrote, and only while ' +
      'it stays open.',
    verb: 'renamed',
    selectAll: true,
    begin: renameBegin,
    writeInput: SYNC_TASK.writeInput,
    undoInput: SYNC_TASK.undoInput,
  };

  var REVIEW_TASK_NAME = 'Review Variant Sets...';

  var REVIEW_SCENE_SEL = '{ count scenes { ' + SCENE_FIELDS +
    ' custom_fields stash_ids { endpoint stash_id } } }';
  var REVIEW_BY_STASHID_QUERY =
    'query SVRReviewScanIds($f: FindFilterType) { findScenes(' +
    'scene_filter: { stash_ids_endpoint: { modifier: NOT_NULL } }, filter: $f) ' +
    REVIEW_SCENE_SEL + ' }';
  var REVIEW_BY_FIELD_QUERY =
    'query SVRReviewScanField($f: FindFilterType, $field: String!) { findScenes(' +
    'scene_filter: { custom_fields: [{ field: $field, value: [], modifier: NOT_NULL }] }, ' +
    'filter: $f) ' + REVIEW_SCENE_SEL + ' }';

  // The same two scans reading a scene's keys alone, and the full fields read back by id.
  var KEYS_SEL = '{ count scenes { id custom_fields stash_ids { endpoint stash_id } } }';
  var KEYS_BY_STASHID_QUERY = REVIEW_BY_STASHID_QUERY.replace('SVRReviewScanIds', 'SVRReviewScanIdsKeys')
    .replace(REVIEW_SCENE_SEL, KEYS_SEL);
  var KEYS_BY_FIELD_QUERY = REVIEW_BY_FIELD_QUERY.replace('SVRReviewScanField', 'SVRReviewScanFieldKeys')
    .replace(REVIEW_SCENE_SEL, KEYS_SEL);
  var SET_SCENES_QUERY = 'query SVRSetScenes($ids: [ID!]) { findScenes(ids: $ids, ' +
    'filter: { per_page: -1 }) ' + REVIEW_SCENE_SEL + ' }';

  // Every member of a variant set, in full, in id order. Two passes: every scene's keys
  // alone, paged, to find the sets - `run.afterPage` counts them as pages land - then the
  // full fields of the members only, `READ_PAGE` at a time. A library where most scenes
  // carry a stash-id and few share one is never held in full.
  function setMembersScan(run, field) {
    var seen = {}, keys = [], full = [];
    return flagScanPass(run, KEYS_BY_STASHID_QUERY, {}, seen, keys).then(function () {
      return run.stopped ? null : flagScanPass(run, KEYS_BY_FIELD_QUERY, { field: field }, seen, keys);
    }).then(function () {
      var ids = [];
      if (!run.stopped) {
        variantSetsOf(keys, field).forEach(function (set) {
          set.scenes.forEach(function (sc) { ids.push(Number(sc.id)); });
        });
      }
      keys = null;
      ids.sort(function (a, b) { return a - b; });
      var next = function (i) {
        if (i >= ids.length || run.stopped) return Promise.resolve(full);
        return gqlRequest(SET_SCENES_QUERY, { ids: ids.slice(i, i + READ_PAGE).map(String) })
          .then(function (data) {
            full = full.concat((((data || {}).findScenes) || {}).scenes || []);
            return next(i + READ_PAGE);
          });
      };
      return next(0);
    });
  }

  // The weights in force: what the dialog's strip holds, seeded from the settings when
  // they have been remembered and from the defaults when they have not.
  function weightsFrom(s) {
    var w = {}, k;
    for (k in WEIGHT_DEFAULTS) {
      if (!hasOwn(WEIGHT_DEFAULTS, k)) continue;
      var v = s ? s[WEIGHT_KEYS[k]] : null;
      w[k] = v == null || isNaN(v) ? WEIGHT_DEFAULTS[k] : clampWeight(v);
    }
    return w;
  }

  // The six in force, in the order the strip shows them.
  function weightsText(w) {
    return 'title ' + w.title + ', cover ' + w.cover + ', attribute ' + w.attr +
      ', tag ' + w.tag + ', performer ' + w.performer + ', group ' + w.group;
  }

  function clampWeight(v) {
    var n = Math.round(Number(v));
    if (isNaN(n) || n < 0) return 0;
    return n > WEIGHT_MAX ? WEIGHT_MAX : n;
  }

  function anyRemembered(s) {
    var k;
    for (k in WEIGHT_KEYS) {
      if (hasOwn(WEIGHT_KEYS, k) && s && s[WEIGHT_KEYS[k]] != null) return true;
    }
    return false;
  }

  // ── What a set disagrees about, laid out per variant ──────────────────────
  //
  // The set line's tooltip was the member names, which is the one thing the line
  // already says. This is the question actually being asked of a listing sorted by
  // drift: *how* is this set split? A column per variant and a row per dimension they
  // do not all agree on, with a tick where a variant has company on that value and a
  // cross where something else disagrees.
  //
  // Both marks in one cell is the interesting case and the reason for marks rather
  // than a value: with three variants holding A, A, B, the two A's each have company
  // *and* a disagreement, so a 2-1 split reads at a glance and a 1-1-1 split - crosses
  // all the way across - reads as "these need looking at side by side" without the
  // table pretending to say more than it can.
  var SET_TABLE_COLS = 4;    // beyond this the marks stop being scannable

  // One comparable string per member for a dimension, or null where the dimension has
  // nothing to say about this set.
  function setRowValues(set, dim, skip, coverBy) {
    return set.scenes.map(function (sc) {
      if (dim.list) {
        return idsOfList(sc, dim.list).filter(function (id) {
          return !(dim.list === 'tags' && skip[id]);
        }).sort().join(',');
      }
      if (dim.cover) return coverBy ? (coverBy[String(sc.id)] || null) : null;
      var v = dim.attr.show ? dim.attr.show(sc) : sc[dim.attr.key];
      return v == null ? '' : String(v);
    });
  }

  function setTableRows(set, skip, coverBy) {
    var dims = SYNC_ATTRS.map(function (a) { return { label: a.label, attr: a }; })
      .concat([{ label: 'Tags', list: 'tags' }, { label: 'Performers', list: 'performers' },
        { label: 'Groups', list: 'groups' }, { label: 'Cover', cover: true }]);
    var out = [];
    dims.forEach(function (dim) {
      var vals = setRowValues(set, dim, skip, coverBy);
      // A dimension nobody can answer for - a cover nobody read - says nothing rather
      // than reporting agreement it has not checked.
      if (vals.some(function (v) { return v === null; })) return;
      var cells = vals.map(function (v, i) {
        var ok = false, bad = false;
        vals.forEach(function (other, j) {
          if (i === j) return;
          if (other === v) ok = true; else bad = true;
        });
        return { ok: ok, bad: bad };
      });
      if (!cells.some(function (c) { return c.bad; })) return;
      out.push({ label: dim.label, cells: cells });
    });
    return out;
  }

  // The table itself. Built once per render of a set line and handed to the shared box,
  // which is what lets it be a table at all - a native `title` is text.
  function setTable(set, skip, coverBy) {
    var rows = setTableRows(set, skip, coverBy);
    var wrap = el('div', 'svr-settable');
    if (!rows.length) {
      wrap.appendChild(el('div', null,
        'These variants agree on everything this dialog compares.'));
      return wrap;
    }
    var shown = Math.min(set.scenes.length, SET_TABLE_COLS);
    var table = el('table');
    var head = el('tr');
    head.appendChild(el('th', null, ''));
    for (var c = 0; c < shown; c++) {
      var sc = set.scenes[c];
      var name = oneLine(sc.title || ('Scene ' + sc.id));
      if (name.length > 18) name = name.slice(0, 17) + '\u2026';
      var th = el('th', null, name + ' [' + sc.id + ']');
      // A second line under the name: the duration and resolution are how a reader
      // tells the variants apart when the names do not - the same facts, formatted by
      // the same helper, as the pane's own rows.
      var meta = metaOf(sc);
      if (meta) th.appendChild(el('div', 'svr-settable-meta', meta));
      head.appendChild(th);
    }
    table.appendChild(head);
    rows.forEach(function (row) {
      var tr = el('tr');
      tr.appendChild(el('th', 'svr-settable-label', row.label));
      for (var i = 0; i < shown; i++) {
        var cell = el('td');
        if (row.cells[i].ok) cell.appendChild(el('span', 'svr-mark-ok', '\u2714'));
        if (row.cells[i].bad) cell.appendChild(el('span', 'svr-mark-bad', '\u2718'));
        tr.appendChild(cell);
      }
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    if (set.scenes.length > shown) {
      wrap.appendChild(el('div', 'svr-settable-note',
        plural(set.scenes.length - shown, 'more variant is', 'more variants are') +
        ' in this set and not shown: past ' + SET_TABLE_COLS +
        ' columns the marks stop being scannable.'));
    }
    return wrap;
  }

  // How far apart a set has drifted, in the four counts the weights price.
  //
  // For each scalar attribute: the members that disagree with the set's most common
  // value. For each list: the union of what the set carries between them, and every
  // membership a scene is missing from it. Both reduce to the obvious thing for a pair
  // - one differing attribute, one tag on one side only - and stay meaningful above
  // two, which pairwise counting does not.
  //
  // The dimension and flag tags are left out: a full-duration scene and its partial cut
  // differ by them *by definition*, and counting that would give every set in the
  // library the same baseline score and rank nothing.
  function setDeltaRaw(scenes, skip, coverBy) {
    var out = { title: 0, attr: 0, tag: 0, performer: 0, group: 0, cover: 0, n: scenes.length };
    var n = scenes.length;
    // The same shape as an attribute: the members that disagree with the set's most
    // common cover. Only where the covers have actually been read - the comparison is
    // opt-in, and an unread cover is not a matching one.
    if (coverBy) {
      var seen = {}, best = 0, known = 0;
      scenes.forEach(function (sc) {
        var c = coverBy[String(sc.id)];
        if (!c) return;
        known++;
        seen[c] = (seen[c] || 0) + 1;
        if (seen[c] > best) best = seen[c];
      });
      if (known > 1) out.cover = known - best;
    }
    SYNC_ATTRS.forEach(function (a) {
      // Titles are counted into a bucket of their own rather than in with the rest.
      // They were counted nowhere at all, because variants are *named* apart on
      // purpose and pricing that with the other attributes put the same baseline
      // under every set in the library. A weight of its own is the better answer to
      // the same problem: the difference stays visible, and what it is worth is the
      // user's to say rather than this plugin's.
      var bucket = a.key === 'title' ? 'title' : 'attr';
      var counts = {}, best = 0;
      scenes.forEach(function (sc) {
        var v = a.show ? a.show(sc) : sc[a.key];
        v = v == null ? '' : String(v);
        counts[v] = (counts[v] || 0) + 1;
        if (counts[v] > best) best = counts[v];
      });
      out[bucket] += n - best;
    });
    [['tags', 'tag'], ['performers', 'performer'], ['groups', 'group']]
      .forEach(function (l) {
        var union = {};
        scenes.forEach(function (sc) {
          idsOfList(sc, l[0]).forEach(function (id) {
            if (l[0] === 'tags' && skip[id]) return;
            union[id] = true;
          });
        });
        scenes.forEach(function (sc) {
          var have = {};
          idsOfList(sc, l[0]).forEach(function (id) { have[id] = true; });
          for (var id in union) {
            if (hasOwn(union, id) && !have[id]) out[l[1]]++;
          }
        });
      });
    return out;
  }

  // A scene's members of one list, by id. Groups wrap theirs a level in.
  function idsOfList(scene, key) {
    return (scene[key] || []).map(function (x) {
      return String(key === 'groups' ? x.group.id : x.id);
    });
  }

  // Per variant, not per set: every count above is bounded by (members - 1) per item,
  // so the raw sum grows with the set and a five-scene set outranked a pair that was
  // just as far apart. Dividing by the other members reads as "how far one variant
  // typically stands from the rest", the same number for the pair and the five, and
  // the bands - priced in units of one difference - hold unchanged. Rounded up so a
  // set with anything to do never shows 0.
  function scoreOf(delta, w) {
    var sum = (delta.title || 0) * w.title + delta.attr * w.attr + delta.tag * w.tag +
      delta.performer * w.performer + delta.group * w.group +
      (delta.cover || 0) * w.cover;
    return Math.ceil(sum / Math.max(1, (delta.n || 2) - 1));
  }

  // What a score's colour says: nothing to do, a little, a lot, or look at this one.
  //
  // The bands are read off the weights rather than fixed, because the weights are the
  // user's to change and a threshold in absolute points would mean something different
  // after every edit to the strip. `unit` is the cheapest difference the strip can
  // price - one point where a weight has been set to zero, since a band of width zero
  // sorts nothing - and the top band starts at whichever is the larger of three
  // attribute differences and ten of the cheapest ones.
  function scoreBands(w) {
    var unit = Math.max(1,
      Math.min(w.title, w.cover, w.attr, w.tag, w.performer, w.group));
    return { mid: 5 * unit, high: Math.max(3 * w.attr, 10 * unit) };
  }

  // Green reaches 1: one cheap difference per variant - a title, most often, which
  // variants carry apart on purpose - is not a set worth a look.
  function scoreClass(score, w) {
    if (score <= 1) return 'svr-score-none';
    var b = scoreBands(w);
    if (score >= b.high) return 'svr-score-high';
    if (score >= b.mid) return 'svr-score-mid';
    return 'svr-score-low';
  }

  function deltaText(delta) {
    return (delta.title || 0) + ' title, ' + delta.attr + ' attr, ' +
      delta.tag + ' tag, ' + delta.performer + ' perf, ' + delta.group + ' group' +
      (delta.cover ? ', ' + delta.cover + ' cover' : '');
  }

  // The scenes of one set as they stand *now*, in one request - `findScene(id:)` per
  // member, aliased, which is a spelling this plugin already sends rather than a new
  // by-ids filter to be wrong about.
  //
  // It exists because a Proceed makes the scan's own copies stale: the listing was
  // built before the write, and planning a second source out of the same set from
  // those objects offers changes that have already been made. A rescan would fix it
  // and is the wrong tool - it re-scores every set in the library and moves the one
  // being worked on out from under the pointer.
  function refreshScenes(scenes) {
    if (!scenes.length) return Promise.resolve({});
    var decl = [], parts = [], vars = {};
    scenes.forEach(function (sc, i) {
      decl.push('$id' + i + ': ID!');
      parts.push('s' + i + ': findScene(id: $id' + i + ') { ' + SCENE_FIELDS +
        ' custom_fields }');
      vars['id' + i] = String(sc.id);
    });
    return gqlRequest('query SVRSetRefresh(' + decl.join(', ') + ') { ' +
      parts.join(' ') + ' }', vars).then(function (d) {
      var out = {};
      scenes.forEach(function (sc, i) {
        var got = (d || {})['s' + i];
        if (got) out[String(sc.id)] = got;
      });
      return out;
    }, function () { return {}; });   // a read that fails leaves the scan's own copies
  }

  // Connected components over the lines the scenes share: two scenes can be one set
  // through a chain of overlapping lines without sharing one, which is what makes this
  // union-find rather than a group-by.
  function variantSetsOf(scenes, field) {
    var byKey = {}, parent = {}, k, i;
    scenes.forEach(function (sc) {
      parent[String(sc.id)] = String(sc.id);
      sceneKeys(sc, field).forEach(function (key) {
        (byKey[key] = byKey[key] || []).push(String(sc.id));
      });
    });
    function findRoot(x) {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    for (k in byKey) {
      if (!hasOwn(byKey, k)) continue;
      for (i = 1; i < byKey[k].length; i++) {
        parent[findRoot(byKey[k][i])] = findRoot(byKey[k][0]);
      }
    }
    var groups = {}, out = [];
    scenes.forEach(function (sc) {
      var r = findRoot(String(sc.id));
      (groups[r] = groups[r] || []).push(sc);
    });
    for (k in groups) {
      if (hasOwn(groups, k) && groups[k].length > 1) out.push({ key: k, scenes: groups[k] });
    }
    return out;
  }

  // Every scene carrying evidence, gathered into connected components over the lines
  // they share - the flag task's union-find, over the same two queries, kept separate
  // because this one needs every field a plan is built from rather than the four the
  // flag needs.
  function reviewBegin(run) {
    return Promise.all([settingsReady(), tagTree()]).then(function (both) {
      var s = both[0], m = matchers(both[1], s);
      var field = fieldName(s);
      run.settings = s;
      run.matchers = m;
      run.naming = naming(s);
      run.weights = weightsFrom(s);
      run.remember = anyRemembered(s);
      run.excludeOrganized = !!s.d7ExcludeOrganized;
      run.skip = skipTagIds(both[1], s, m);
      run.buildWeightBar();
      // Bound before the scan, so the first Synchronize Set from Selected can read it synchronously.
      var pruning = nptPruner(s).then(function (w) { run.pruner = w; });
      run.msg('INFO', 'Looking for every scene that shares a stash-id or a "' + field +
        '" line with another, to give each set its drift score.');
      // The count the listing is about, updated as pages land rather than only at the
      // end: a library-wide scan is the one place here that runs for minutes, and
      // "scenes read" alone says nothing about whether it is finding anything.
      run.afterPage = function (got) { run.setCount = variantSetsOf(got, field).length; };
      return pruning
        .then(function () { return setMembersScan(run, field); })
        .then(function (scenes) {
          if (run.stopped) return null;
          var raw = variantSetsOf(scenes, field);
          // The covers, once the sets are known - and only for scenes that are *in*
          // one. A scene sharing evidence with nobody can have no cover mismatch, so
          // the read is bounded by the variants in the library rather than by the
          // library, which is the difference between a few hundred images and all of
          // them.
          return readSetCovers(run, s, raw).then(function () {
            run.allSets = raw.map(function (set) {
            // Longest first inside a set, the order the tab lists variants in.
              return { key: set.key, scenes: set.scenes.slice().sort(function (a, b) {
                return ((bestFile(b) || {}).duration || 0) - ((bestFile(a) || {}).duration || 0);
              }) };
            });
            run.deriveSets();
          if (!raw.length) {
            run.msg('INFO', 'No scene in the library shares a stash-id or a "' + field +
              '" line with another, so there are no variant sets to review.');
            return null;
          }
            run.renderSets(true);
            reportCoverCheck(run, s);
            run.msg('INFO', plural(run.sets.length, 'variant set') + ' found. Pick the ' +
              'scene whose values are right - that is both the set and the source - then ' +
              'press Synchronize Set from Selected to list what would be pushed to the others.');
            return null;
          });
        });
    });
  }

  var REVIEW_TASK = {
    title: 'Review Variant Sets',
    legend: 'Every multi-variant set in your library, worst first: the drift score ' +
      'beside each is how far its members have drifted apart, counting the attributes they ' +
      'disagree on and the tags, performers and groups one carries and another does ' +
      'not. What each of those is worth is the strip above the listing, and Remember ' +
      'keeps your numbers for next time. Open a set and pick the scene whose values ' +
      'are right; Synchronize Set from Selected then lists exactly what would be pushed to the ' +
      'others, one checkbox line each - green for what a variant gains, red for what ' +
      'it loses, blue for a value replaced - and nothing is written until you press ' +
      'Proceed. The full-duration, partial-duration and flag tags are never pushed, and ' +
      'never counted against a set.',
    nothing: 'Pick a source scene and press Synchronize Set from Selected first.',
    scanNoun: 'scene',
    planNoun: 'listed',
    planUnit: 'change',
    leaseLabel: 'Variant set synchronization',
    undoTip: 'Put back what every written line replaced or added. Only what this ' +
      'dialog wrote, and only while it stays open.',
    verb: 'synchronized',
    pickCaption: true,
    begin: reviewBegin,
    writeInput: SYNC_TASK.writeInput,
    undoInput: SYNC_TASK.undoInput,
  };

  // ── The task button ───────────────────────────────────────────────────────
  //
  // Declared in the yml so Stash renders a button for it in Settings → Tasks, and handled
  // entirely here: the click never reaches the server, because there is no `exec` behind
  // it and nothing server-side to run. A capture-phase listener on `document` runs before
  // React's own handler and stops the propagation, which is what keeps PluginTasks'
  // "added job to queue" toast from appearing over a dialog that is already open.
  //
  // Ours only if the label matches *and* the enclosing SettingGroup is headed with our
  // name - another plugin may declare a task called the same thing.
  function ownTaskName(btn) {
    var label = trim(btn.textContent);
    if (label !== TASK_NAME && label !== FLAG_TASK_NAME &&
      label !== REVIEW_TASK_NAME && label !== RENAME_TASK_NAME) return null;
    var node = btn;
    var fallback = null;
    for (var depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      var heading = node.querySelector ? node.querySelector('h3') : null;
      var ours = !!heading && headingIsOurs(heading.textContent);
      if (hasClass(node, 'setting-group')) return ours ? label : null;
      if (ours) fallback = label;
    }
    return fallback;
  }

  // Re-applied every tick rather than once: React re-renders this panel and hands back a
  // button with Stash's own classes, and `paintButton` is a no-op on one that already
  // carries ours. Amber, because this one writes - the tab and its links are the reading
  // half of this plugin and take no colour from this rule.
  function paintTaskButtons() {
    var nodes = document.querySelectorAll ? document.querySelectorAll('button') : [];
    for (var i = 0; i < nodes.length; i++) {
      if (ownTaskName(nodes[i])) paintButton(nodes[i], PLUGIN_BTN_VARIANT);
    }
  }

  // ── Style ─────────────────────────────────────────────────────────────────

  var CSS =
    // ── The shared dialog chrome ────────────────────────────────────────────
    //
    // Kept literally identical to the sibling plugins' stylesheets wherever the dialogs
    // overlap, down to the hex values. They are separate strings because the plugins
    // share no module, not because they are meant to look different - and two of them
    // did drift, from #202b33 to #30404d, because nothing compared them.
    // `tests/style.test.js` pins the overlap. #202b33 is Blueprint's dark-gray2, the
    // step Stash's own page uses; every dim grey in these dialogs was chosen against it.
    '.svr-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);' +
    'z-index:1600;display:flex;align-items:center;justify-content:center;}' +
    '.svr-modal{background:#202b33;color:#f5f8fa;border:1px solid #394b59;border-radius:4px;' +
    'width:min(100rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
    '.svr-head{padding:.75rem 1rem;border-bottom:1px solid #394b59;}' +
    '.svr-title{font-size:1.1rem;font-weight:600;}' +
    '.svr-warn{color:#ffb648;margin-top:.35rem;}' +
    '.svr-note{color:#a7b6c2;margin-top:.35rem;}' +
    '.svr-legend{color:#7d8f9c;margin-top:.35rem;font-size:.8rem;}' +
    '.svr-progress{padding:.5rem 1rem;border-bottom:1px solid #394b59;color:#a7b6c2;' +
    'white-space:pre-wrap;}' +
    '.svr-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;font-family:monospace;font-size:.8rem;' +
    'line-height:1.35;min-height:14rem;}' +
    '.svr-line{white-space:pre-wrap;word-break:break-word;}' +
    // An entity named in the log is a link to it. The same blue the siblings' result
    // lines use, underlined only on hover so a log full of them does not read as a
    // page of underlines.
    '.svr-elink{color:#7cc4ff;text-decoration:none;}' +
    '.svr-elink:hover{text-decoration:underline;}' +
    '.svr-spin{color:#a7b6c2;}' +
    '.svr-ERROR{color:#ff7373;} .svr-WARN{color:#ffb648;} .svr-INFO{color:#a7b6c2;}' +
    '.svr-foot{padding:.75rem 1rem;border-top:1px solid #394b59;display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.svr-foot button{margin-right:.5rem;}' +
    '.svr-foot-label{color:#7d8f9c;}' +
    '.svr-foot-sep{color:#7d8f9c;padding:0 .75rem;}' +
    '.svr-selall{margin-left:auto;}' +
    // **`!important`, because a hidden utility that loses a cascade is not one.** Every
    // one of these rules is a single class, so the last one written wins - and this one
    // is written before the strips and rows that set their own `display`. A `-hidden` on
    // one of those did nothing at all, which is how Find & Replace shipped a row that
    // stayed on screen with the checkbox that reveals it switched off.
    '.svr-hidden{display:none !important;}' +
    // The stash-id question: the same chrome, narrower, with a plain list for a body.
    '.svr-confirm{width:min(60rem,94vw);}' +
    '.svr-confirm-body{padding:.75rem 1rem;line-height:1.5;}' +
    // ── This dialog's own ───────────────────────────────────────────────────
    //
    // A planned scene is not a message, so it does not wear one of the three message
    // colours; it wears the row colour the tab already gives that value, which is what
    // makes a listing of two hundred lines scannable by role.
    '.svr-job{margin-left:.5rem;}' +
    // The flag task's two line kinds, in the greens and ambers the migration lines
    // already borrow from the tab's roles: green where the tag goes on, amber where it
    // comes off.
    '.svr-op-flag{color:#84d68a;}' +
    '.svr-op-unflag{color:#ffb648;}' +
    // A [GROUP?] candidate is a question rather than a plan, so it wears the log's own
    // link blue - neither the green of a write going on nor the amber of one coming off.
    '.svr-op-cand{color:#7cc4ff;}' +
    '.svr-cand-box{margin-right:.5rem;vertical-align:middle;}' +
    // The synchronize listing colours the *change*, not the line. One vocabulary
    // across every dialog here, explained in each head's legend: what a variant loses
    // is red, what it gains green, a value replaced blue, and everything around them -
    // the label, the scene's name, the counts - stays the modal's own white, so a
    // glance down the listing reads the kinds rather than the sentences.
    //
    // The line classes stay for what they are, a name for the kind of line; colouring
    // the whole of one was what made a listing of adds and removes uniform amber.
    // The box a diffed value opens: the modal's own panel colour, above the backdrop,
    // and fixed so a scrolling log cannot clip it. `pre-wrap` because the value it
    // holds is a paragraph and the whole point is to show all of it.
    '.svr-difftip{display:none;position:fixed;left:0;top:0;z-index:1700;' +
    'width:min(60rem,90vw);max-height:70vh;overflow:hidden;padding:.5rem .65rem;' +
    'background:#202b33;color:#f5f8fa;border:1px solid #425a6b;border-radius:3px;' +
    'font-size:.8rem;line-height:1.45;white-space:pre-wrap;pointer-events:none;' +
    'text-align:left;box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.svr-difftip.svr-difftip-open{display:block;}' +
    // Sized to the table it holds rather than to a paragraph's wrap width.
    '.svr-difftip.svr-difftip-fit{width:max-content;max-width:90vw;}' +
    // Two covers side by side: the question a cover line asks is "is that the right
    // picture", and no amount of text answers it.
    // The set table: a column per variant, a row per dimension they disagree about.
    // Left-aligned labels, centred marks, and the log's own borders so it reads as
    // part of the dialog rather than as a web page's table.
    '.svr-settable table{border-collapse:collapse;}' +
    '.svr-settable th,.svr-settable td{border:1px solid #394b59;padding:.15rem .5rem;' +
    'text-align:center;white-space:nowrap;}' +
    '.svr-settable th{color:#a7b6c2;font-weight:600;}' +
    '.svr-settable-meta{font-weight:400;font-size:.9em;color:#7d8f9c;}' +
    '.svr-settable-label{text-align:left !important;color:#f5f8fa !important;}' +
    // `width:0;min-width:100%` is the caption trick: the note contributes nothing to
    // the box's shrink-to-fit width and then wraps at the table's, so a long sentence
    // cannot widen a box sized to its table.
    '.svr-settable-note{color:#a7b6c2;margin-top:.35rem;white-space:normal;' +
    'width:0;min-width:100%;}' +
    '.svr-mark-ok{color:#84d68a;}' +
    '.svr-mark-bad{color:#ff7b72;margin-left:.15rem;}' +
    '.svr-coverfig{display:inline-block;vertical-align:top;margin:0 .4rem 0 0;' +
    'border:2px solid transparent;border-radius:3px;}' +
    '.svr-coverfig img{display:block;width:24rem;max-width:40vw;aspect-ratio:16/9;' +
    'object-fit:contain;background:#111a20;}' +
    '.svr-covercap{font-size:.75rem;text-align:center;padding:.15rem 0;}' +
    '.svr-cover-old{border-color:#ff7b72;}' +
    '.svr-cover-old .svr-covercap{color:#ff7b72;}' +
    '.svr-cover-new{border-color:#84d68a;}' +
    '.svr-cover-new .svr-covercap{color:#84d68a;}' +
    '.svr-del{color:#ff7b72;}' +
    '.svr-add{color:#84d68a;}' +
    '.svr-mod{color:#7cc4ff;}' +
    // The pane's one button, spaced off the summary above and the rows below.
    '.svr-sync-btn{margin:.25rem 0 .75rem;}' +
    // The All boxes' own strip, between the counters and the log: one label per
    // attribute, wrapping on a narrow window. The log's INFO grey - it is a control
    // strip, not a message.
    '.svr-allbar{padding:.4rem 1rem;border-bottom:1px solid #394b59;display:flex;' +
    'gap:1rem;flex-wrap:wrap;color:#a7b6c2;font-size:.85rem;}' +
    '.svr-all{display:inline-flex;align-items:center;gap:.35rem;margin:0;' +
    'cursor:pointer;}' +
    '.svr-all-box{margin:0;}' +
    // An additive line's expander and its sub-list. The arrow is the log's link blue -
    // it is a control, not content - and the sub rows indent under the line they
    // belong to. The expander stays live mid-write (it only shows and hides); the
    // item boxes lock with the line's own.
    // A size up from the log's .8rem monospace, from live feedback - at the log's own
    // size the arrow reads as punctuation, and it is the click target. The padding
    // widens that target a little without moving the text beside it.
    '.svr-expand{cursor:pointer;color:#7cc4ff;font-size:1.35em;line-height:1;' +
    'padding:0 .15rem;}' +
    '.svr-expand:hover{text-decoration:underline;}' +
    '.svr-sub{margin-left:3.5rem;}' +
    // The review listing: the set lines scroll on their own above the log, so a
    // library with hundreds of sets does not push the messages off the dialog.
    // The same monospace the log uses - the two are read as one column.
    // The divider under this block is `.svr-splitbar`, a full-width drag bar of our
    // own - `resize:vertical`'s corner grip was tedious to keep re-finding as the log
    // grew, per live use. The min/max-height here still clamp whatever the drag sets.
    // The minimum is six lines (.8rem at 1.5 line-height): a log that grows through a
    // long pass takes the listing's height first, and below six lines a set list
    // reads as a scrollbar with a caption.
    //
    // `flex:0 1 auto` rather than `0 0 auto`: the dragged height is kept while there
    // is room for it, and given up before the log's own minimum pushes the footer off
    // the bottom of a short window. The log's shrink factor is what keeps it: flex
    // shrinks in proportion to size, so with equal factors a log growing through a pass
    // took an ever larger share of the listing's height. The log's factor makes it give
    // up everything above its own minimum first. `color-scheme:dark` keeps the box's own scrollbar
    // in the dialog's colours - CustomFieldsBulkEditor's lesson.
    '.svr-sets{flex:0 1 auto;overflow:auto;height:22vh;min-height:7.2rem;' +
    'max-height:46vh;color-scheme:dark;padding:0 1rem;font-family:ui-monospace,' +
    'SFMono-Regular,Menlo,Consolas,monospace;font-size:.8rem;line-height:1.5;}' +
    '.svr-splitbar{flex:0 0 auto;height:8px;margin:.15rem 1rem .35rem;' +
    'cursor:ns-resize;background:#2b3a45;border-radius:4px;}' +
    '.svr-splitbar:hover{background:#425a6b;}' +
    // The log after the bar - the shared `.log` rule stays as every sibling has it.
    '.svr-splitbar+.svr-log{flex-shrink:100000;}' +
    '.svr-set{white-space:pre-wrap;}' +
    // The score, banded: green at one or nothing to do, then yellow, amber and
    // red as a set drifts further apart. The weights decide where the bands fall, so
    // a user who reprices a difference reprices the colours with it.
    '.svr-score{font-weight:600;}' +
    '.svr-score-none{color:#84d68a;}' +
    '.svr-score-low{color:#ffe066;}' +
    '.svr-score-mid{color:#ffb648;}' +
    '.svr-score-high{color:#ff7b72;}' +
    '.svr-src-box{margin-right:.4rem;vertical-align:middle;}' +
    // The weights: a number box narrow enough that four of them and the label fit one
    // line, and wide enough for three digits.
    '.svr-weight{display:inline-flex;align-items:center;gap:.35rem;margin:0;' +
    'cursor:pointer;}' +
    '.svr-weight-box{width:4rem;background:#30404d;color:#f5f8fa;border:1px solid ' +
    '#425a6b;border-radius:3px;padding:0 .25rem;}' +
    // Two steps of the strip's own gap, so Remember reads as the thing beside the
    // numbers rather than the last of them.
    '.svr-remember{margin-left:2rem;}' +
    // The title-rules dialog: a narrow modal of labelled boxes, one per setting, each
    // with its first sentence under it and the rest on hover. The row it opens from
    // borrows Stash's own `.setting` classes, so it is laid out as the rows above it.
    '.svr-modal.svr-narrow{width:min(58rem,94vw);}' +
    '.svr-modal.svr-tall{height:88vh;}' +
    '.svr-form{padding:.5rem 1rem;overflow:auto;}' +
    '.svr-field{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem;' +
    'margin:.6rem 0;color:#d6dee4;font-size:.9rem;cursor:pointer;}' +
    '.svr-field-label{font-weight:600;}' +
    '.svr-field-box[type=text]{flex:1 1 14rem;background:#30404d;color:#f5f8fa;' +
    'border:1px solid #425a6b;border-radius:3px;padding:.15rem .4rem;}' +
    '.svr-field-box[type=checkbox]{accent-color:#ffc107;margin:0;}' +
    '.svr-field-note{flex:1 0 100%;color:#7d8f9c;font-size:.8rem;}' +
    '.svr-all-label{color:#7d8f9c;}' +
    '.svr-item-box{margin-right:.4rem;vertical-align:middle;}' +
    // The partner count inside a [FLAG] line: blue where there is exactly one other
    // scene, amber where there is a real choice. The blue is the log's own link blue,
    // so nothing new is introduced.
    '.svr-num-one{color:#7cc4ff;font-weight:600;}' +
    '.svr-num-many{color:#ffb648;font-weight:600;}' +
    // ── The tab itself ──────────────────────────────────────────────────────
    //
    // Amber, so the one tab in the strip that Stash did not put there says so. This is the
    // repo's "a plugin wrote this" colour reaching a surface it had not covered: the rule
    // is written for *buttons*, where amber means the control writes and teal means it
    // only reads, and this plugin only reads. The distinction the split exists to draw
    // has no second member here - there is no other plugin tab to be told apart from this
    // one - while the distinction it is standing in for, Stash's tabs against ours, has
    // nothing else to carry it. See AGENTS.md for why that is the reading rather than a
    // contradiction of the rule.
    //
    // A colour, not a Bootstrap variant, because a `Nav.Link` has none to borrow - the
    // same position the settings toggles are in. Scoped under `.nav-tabs` (Stash's own
    // class, only ever read here) so it outranks `.nav-tabs .nav-link`, which is where
    // Bootstrap sets the colour this replaces; equal specificity, and this sheet is
    // appended after Stash's, so source order settles it without an `!important`. Hover,
    // focus and the active tab are named because Bootstrap sets each of them separately.
    '.nav-tabs .svr-tab-link,.nav-tabs .svr-tab-link:hover,' +
    '.nav-tabs .svr-tab-link:focus,.nav-tabs .svr-tab-link.active{color:#ffb648;}' +
    // ── The tab's pane ──────────────────────────────────────────────────────
    //
    // Not the shared dialog chrome: the pane is not a dialog, so a backdrop, a log
    // and a footer would be a stylesheet for markup that never exists here. It is not a card
    // either - the pane sits inside Stash's own tab content, beside Details and File
    // Info, so it takes no background and no border of its own and lets the page's
    // showing through. The greys are the dialogs' greys all the same - #a7b6c2 and
    // #7d8f9c, the two dim steps - because a sixth palette would read as a sixth author.
    // `.svr-tabpane`, not `.svr-pane`: TagBundleClipboard already has a `.pane` and it
    // is a different thing - a scrolling column inside a two-column dialog. A class two
    // plugins share has to mean the same thing in both, and a *tab* pane is not that.
    '.svr-tabpane{padding:1rem;}' +
    '.svr-summary{color:#7d8f9c;margin-bottom:.5rem;}' +
    '.svr-drift{color:#7d8f9c;margin-bottom:.5rem;}' +
    '.svr-boxlinks{color:#7d8f9c;margin:-.25rem 0 .5rem;}' +
    '.svr-boxlink{margin-right:.75rem;}' +
    '.svr-cflinks{margin-left:.5rem;}' +
    '.svr-cflink{margin-right:.5rem;}' +
    // The settings contradiction, in the same red the row-level one wears - it is the same
    // fact reported one level up, before it can be mistaken for a fault in the scenes.
    '.svr-conflict{color:#ff7373;margin-bottom:.5rem;}' +
    // `position:relative` anchors the hover delta box; the pane scrolls with the page
    // rather than inside an overflow container, so absolute positioning has nothing to
    // clip against here.
    '.svr-variant{display:flex;align-items:center;gap:.75rem;padding:.35rem .5rem;' +
    'border-radius:3px;position:relative;}' +
    '.svr-variant:hover{background:#3c4f5d;}' +
    // The delta box the row opens on hover, in place of a native title, which cannot be
    // styled. z-index 1700, the shared tipbox's own lesson: level with the backdrops is a
    // stacking race decided by document order. The colours are the dialogs' - #202b33
    // panel, #ffb648 headers, the amber every warning here already wears.
    '.svr-delta{display:none;position:absolute;left:.5rem;top:100%;z-index:1700;' +
    'background:#202b33;color:#f5f8fa;border:1px solid #394b59;border-radius:4px;' +
    'padding:.5rem .75rem;max-width:min(56rem,90vw);font-size:.85rem;line-height:1.4;' +
    'pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.5);}' +
    '.svr-variant:hover .svr-delta{display:block;}' +
    '.svr-delta-hdr{color:#ffb648;font-weight:600;}' +
    // The hover delta's three sections, in the listing's own colours: what this
    // variant carries and the viewed scene does not is a gain, what it lacks is a
    // loss, and an attribute they disagree on is a modification. The headers stay
    // amber - they label a section rather than name a change.
    '.svr-delta-extra{color:#84d68a;}' +
    '.svr-delta-missing{color:#ff7b72;}' +
    '.svr-delta-attrs{color:#7cc4ff;}' +
    '.svr-delta-ignored{color:#8a8a8a;}' +
    // The asked-for half-line of air between sections, and only between them.
    '.svr-delta-sec+.svr-delta-sec{margin-top:.5em;}' +
    // A fixed 16:9 box, so a row is the same height whatever the cover's aspect is and the
    // list does not step in and out as it scrolls. `object-fit:cover` is what fills it
    // without distorting; a portrait scene is cropped rather than letterboxed, which is
    // what Stash's own cards do with the same content.
    '.svr-thumb-link{flex:0 0 auto;display:block;line-height:0;position:relative;}' +
    '.svr-rating{position:absolute;top:.2rem;left:.2rem;background:#ffb648;' +
    'color:#1b2429;font-weight:600;font-size:.75rem;line-height:1.4;padding:0 .35rem;' +
    'border-radius:3px;}' +
    '.svr-organized{position:absolute;top:.2rem;right:.2rem;font-size:.85rem;' +
    'line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.8));}' +
    '.svr-thumb{width:10rem;aspect-ratio:16/9;object-fit:cover;background:#0d1317;' +
    'border-radius:3px;display:block;}' +
    // A column: the title, then the facts line under it.
    '.svr-variant-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;' +
    'gap:.15rem;}' +
    '.svr-facts{display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap;}' +
    // The floor a flex item keeps by default is the width of its longest word, which a
    // filename-shaped title blows straight through; releasing it is what lets the title
    // wrap instead of pushing the meta column off the row.
    '.svr-variant-title{overflow-wrap:anywhere;}' +
    // One rule for both, so the two things sitting after the title cannot end up at
    // different sizes: they are read together, at a glance, and a half-step between them
    // reads as one of them being an afterthought.
    '.svr-role,.svr-meta{font-size:.85rem;white-space:nowrap;}' +
    '.svr-meta{color:#a7b6c2;}' +
    // The delta badges: an icon and a count per kind, absent at zero. The metadata grey,
    // because the icon is the distinguisher and three colours here would out-shout the
    // role column. The group is one inline-flex item in the wrapping facts row, so the
    // badges break onto the next line together rather than between each other.
    '.svr-dbadges{display:inline-flex;gap:.5rem;white-space:nowrap;}' +
    '.svr-dbadge{font-size:.85rem;color:#a7b6c2;}' +
    // The cover badge is the one that arrives a moment after the row, so it is also
    // the one that has to be noticed once it does - amber rather than the metadata
    // grey the counts wear.
    '.svr-dbadge-cover{color:#ffb648;}' +
    // Green for the full-duration one, because it is the answer the tab exists to give;
    // amber for a partial; red for the scene wearing both tags, which is a contradiction.
    // An untagged scene has no label at all, which is the only quiet state left.
    //
    // The partial was grey to begin with, on the reasoning that it is context rather than
    // an answer. Live use said otherwise, and the reasoning was wrong in a way worth
    // keeping written down: a reader is not looking up one row, they are scanning a short
    // list to see *which is which*, and a value rendered as the same grey as the metadata
    // beside it does not answer that at a glance. Both values are the answer; only the
    // absence of one is context.
    '.svr-role-fl{color:#84d68a;}' +
    '.svr-role-pl{color:#ffb648;}' +
    '.svr-role-bad{color:#ff7373;}' +
    // Byte-identical to TagBundleClipboard's, because a class two plugins share has to
    // mean the same thing in both and here it does: the line standing in for a list
    // that has nothing in it.
    '.svr-empty{padding:.5rem 1rem;color:#7d8f9c;}' +
    // Stash's own .sub-heading is white-space: normal, so this plugin's description
    // would collapse into one paragraph. Scoped to the group we marked, never to
    // .sub-heading at large: another plugin's description is not ours to reflow.
    '.svr-own-group .sub-heading{white-space:pre-wrap;}' +
    '.svr-own-group .sub-heading .svr-p{margin:0 0 .35em;}' +
    '.svr-own-group .sub-heading .svr-p:last-child{margin-bottom:0;}' +
    // A per-setting description shows its first paragraph and hides the rest in a
    // tooltip. The mark is the only thing saying there is one - a hover that opens with
    // no invitation is a hover nobody makes. Built rather than borrowed: a native
    // `title` opens below-right of the pointer, exactly where the arrow sits, so its
    // first line arrives half covered, and its size cannot be reached from CSS.
    //
    // These rules are shared with every sibling plugin and `tests/style.test.js`
    // compares them with the prefix stripped: keep them byte-identical, or change all
    // of them together.
    '.svr-tipped{position:relative;}' +
    '.svr-tip{margin-left:.35rem;cursor:pointer;opacity:.65;font-style:normal;' +
    'font-size:1.05em;}' +
    '.svr-tip:hover,.svr-tip:focus{opacity:1;outline:none;}' +
    // pointer-events:none is load-bearing, not tidiness. Opened from the setting's
    // name the box lands over the h3, so a box that took the pointer would fire
    // mouseleave on the name, close, hand the pointer back to the name, and reopen -
    // a flicker loop for as long as it is hovered.
    '.svr-tipbox{display:none;position:absolute;left:0;bottom:calc(100% + .35rem);' +
    'z-index:1500;width:max-content;max-width:100%;padding:.5rem .65rem;' +
    'background:#202b33;color:#d6dee4;border:1px solid #425a6b;border-radius:3px;' +
    'font-size:.92rem;line-height:1.45;white-space:pre-wrap;pointer-events:none;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.svr-tipped.svr-tip-open .svr-tipbox{display:block;}' +
    // The group description sits in the group header, outside the <Collapse>, so it is
    // on screen at whatever size whether the group is expanded or not. Hiding all but
    // the first paragraph is the only thing that shortens it.
    '.svr-desc-collapsed .svr-p:not(:first-child){display:none;}' +
    '.svr-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:#7cc4ff;font-size:.8rem;cursor:pointer;' +
    'text-decoration:underline;}' +
    '.svr-stale{margin:.5rem 0;padding:.6rem .75rem;border-left:4px solid #ff7373;' +
    'background:rgba(255,115,115,.14);color:#ff7373;font-size:.95rem;line-height:1.45;' +
    'font-weight:600;}' +
    // ── Colour-coded toggles ────────────────────────────────────────────────
    //
    // Teal for the one setting that only talks to the console, matching every sibling.
    // The two tag names keep Stash's blue: they say what a row is *called*, not what
    // anything does on its own, and marking everything would mark nothing. Nothing here
    // is amber, because nothing here writes.
    //
    // Keyed on the id SettingsPluginsPanel.tsx builds from the plugin id and the
    // setting key, the same anchor `settingElement` uses, rather than on position or
    // heading text. Two shapes because the switch is Stash's to render: `::before` is
    // the track of the react-bootstrap Form.Switch it renders today, and `accent-color`
    // covers a plain checkbox if that ever changes.
    '#plugin-SceneVariants-b1LogToConsole{accent-color:#17a2b8;}' +
    '#plugin-SceneVariants-b1LogToConsole:checked~.custom-control-label::before' +
    '{background-color:#17a2b8;border-color:#17a2b8;}' +
    // The box a tag's tooltip opens instead of the browser's own, which cannot hold a
    // picture. Fixed to the viewport and placed from the node, because the logs these
    // open over are `overflow:auto` boxes that would clip a positioned child against
    // their own top edge. `pointer-events:none` is load-bearing: a box that took the
    // pointer would fire mouseleave on the node, close, hand the pointer back and
    // reopen. Unprefixed, like the Reload UI button's id - six plugins draw this one
    // box and it belongs to none of them.
    '.gttx-tipbox{display:none;position:fixed;left:0;top:0;z-index:1700;' +
    'width:20rem;max-width:90vw;padding:.5rem .65rem;background:#202b33;color:#d6dee4;' +
    'border:1px solid #425a6b;border-radius:3px;font-size:.8rem;line-height:1.45;' +
    'white-space:pre-wrap;pointer-events:none;text-align:left;font-family:inherit;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.gttx-tipbox.gttx-tip-open{display:block;}' +
    '.gttx-tipbox img{display:block;width:100%;max-height:14rem;object-fit:contain;' +
    'margin-bottom:.4rem;border-radius:3px;background:#111a20;}' +
    // Each tag name's own row, when the name in it names something. A link, so the tag
    // is one click away and the name beside it can be selected; the same blue every
    // other link this plugin draws uses.
    // The mark beside a setting that names a custom field. Grey and `cursor:help`,
    // not the tag links' blue: it opens a tooltip and goes nowhere. The one shared,
    // unprefixed class in this repo besides the Reload UI button's id, and for the
    // same reason - five plugins draw the identical mark.
    '.gttx-cftip{margin-left:.9rem;color:#a7b6c2;cursor:help;}' +
    // **A box of ours, not a native `title`, and the cursor is why.** A `title` opens
    // below-right of the pointer, which is exactly where `cursor:help` draws its `?` -
    // so the first line arrived half covered, and nothing in CSS can move a tooltip the
    // browser owns.
    //
    // **`position:fixed`, placed from the mark's own rect** - which is the second answer,
    // not the first. It was `position:absolute` against the wrapper, and that failed in
    // both of the ways an absolutely positioned box can: an inline `<span>` is a poor
    // containing block, and Stash's settings card clips what overflows it, so the box
    // landed in the corner of the page and was cut off by the section edge. Fixed to the
    // viewport is the one position nothing on the page can clip, and it is the same
    // conclusion - and the same `tipPlace` arithmetic - the shared entity card reached
    // about a scrolling log.
    //
    // `pointer-events:none` is load-bearing, not tidiness: a box that took the pointer
    // would fire mouseleave on the mark, close, hand the pointer back and reopen.
    '.gttx-cftipbox{display:none;position:fixed;left:0;top:0;' +
    'z-index:1600;width:max-content;max-width:min(48rem,60vw);padding:.5rem .65rem;' +
    'background:#202b33;color:#d6dee4;border:1px solid #425a6b;border-radius:3px;' +
    'font-size:.92rem;line-height:1.45;white-space:pre-wrap;pointer-events:none;' +
    'text-align:left;box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.gttx-cftipped.gttx-cftip-open .gttx-cftipbox{display:block;}' +
    '.svr-tagicon{margin-left:.9rem;color:#7cc4ff;text-decoration:none;}' +
    '.svr-tagicon:hover{text-decoration:underline;}';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.body || document.documentElement).appendChild(style);
  }


  function button(label, className) {
    var b = el('button', 'btn btn-secondary btn-sm' + (className ? ' ' + className : ''), label);
    b.type = 'button';
    return b;
  }

  // Swaps one Bootstrap variant for another in place, so a button can go amber without
  // losing `btn` or `btn-sm`.
  function paintButton(btn, variant) {
    btn.className = String(btn.className || '')
      .replace(/\bbtn-(secondary|warning|info|primary|success|light|dark|link)\b/g, '')
      .replace(/\s+/g, ' ').replace(/^ | $/g, '') + ' ' + variant;
  }

  // ── The tab ───────────────────────────────────────────────────────────────
  //
  // A real tab beside Details, Queue, Markers, Group, Filter, File Info, History and
  // Edit - not a block injected under the strip. Stash renders its tab strip and its tab
  // content each wrapped in a `PatchContainerComponent`, which exists for exactly this:
  //
  //   const ScenePageTabs      = PatchContainerComponent<IProps>("ScenePage.Tabs");
  //   const ScenePageTabContent = PatchContainerComponent<IProps>("ScenePage.TabContent");
  //
  // Each renders `props.children` and nothing else, so an `after` patch is handed the
  // rendered children and returns whatever should be there instead. Appending is the
  // whole of what this plugin does to them.
  //
  // Three facts this is built on, read off `stashapp/stash` and worth not re-deriving:
  //
  //   * The after-patch is invoked as `afterFn.apply(ctx, args.concat(result))` and must
  //     return the new result. **`args` is what React passed the component, which is not
  //     one argument.** React calls a function component as `Component(props, secondArg)`
  //     where `secondArg` is the legacy context - `emptyContextObject`, `{}`, for any
  //     component that declares no `contextTypes`, which is all of them here. So the
  //     callback is handed `(props, {}, result)`, and a signature reading the result out
  //     of the second position renders that `{}` as a child: React error #31, "Objects
  //     are not valid as a React child (found: object with keys {})". The result is last
  //     by construction, so `safeAppend` searches backwards for the first *element*
  //     rather than indexing at all - being wrong here kills the whole scene page rather
  //     than losing a tab, and neither props nor a context object is ever an element.
  //     The patch list is read when the component *renders*, not when it is defined, so
  //     registering at script load is early enough however late Scene.tsx is imported.
  //   * `props.scene` is a `SceneDataFragment`, which already carries `stash_ids`. That
  //     is what makes the variant lookup one query rather than two: there is nothing to
  //     look up before the filter can be written.
  //   * `activeTabKey` is a plain `useState("scene-details-panel")` with no whitelist, so
  //     a key of our own is selectable exactly like Stash's nine.
  //
  // There is deliberately **no DOM fallback** for a Stash without these patch points. A
  // second implementation of the same tab, injected into the strip by hand, is the kind
  // of duplicate this repo has already decided against paying for elsewhere: it would
  // have to reproduce tab activation, pane switching and every re-render React does for
  // free. A Stash too old gets one console line and no tab.

  // Appending to what a patched component rendered, without being able to break the page
  // it is appending to.
  //
  // The result is the last argument by construction, whatever React put in front of it -
  // but "by construction" is what the two arguments in front of it were also thought to
  // be, and a wrong answer here does not degrade to a missing tab. It takes the whole
  // scene view down with a React error, for a plugin that only reads. So: the result is
  // checked for being an element before anything is appended to it, and building the
  // addition is wrapped, and either way out returns Stash's own render untouched.
  //
  // Untouched is the *only* safe answer. There is nothing else to fall back to - the
  // result is what the container component produced, so passing it through unchanged is
  // exactly the page as it would have been without this plugin.
  // Does this element, or anything inside it, carry `eventKey`? Stash's strip is a list
  // of `Nav.Item`s each wrapping a `Nav.Link`, and the key is on the link - so finding the
  // Edit tab means looking one level in. The same shape the deleted DOM version needed to
  // tell one `.nav-tabs` from another, for the same reason: the key is the only
  // unambiguous mark on that page, and the caption "Edit" is not unique.
  function carriesEventKey(React, node, key) {
    if (!React.isValidElement(node)) return false;
    if (node.props && node.props.eventKey === key) return true;
    var kids = node.props && node.props.children;
    if (kids == null) return false;
    var arr = React.Children.toArray(kids);
    for (var i = 0; i < arr.length; i++) {
      if (carriesEventKey(React, arr[i], key)) return true;
    }
    return false;
  }

  // Rebuilds a container's children with `extra` spliced in ahead of the one carrying
  // `key`. Returns null when there is nothing to splice into or no such child, which is
  // what makes this an *attempt*: the caller appends instead, and a Stash that renames or
  // drops its Edit tab loses the placement rather than the tab.
  //
  // `React.Children.toArray` rather than the raw value, because the raw value is not a
  // list: `props.children` is a single element when there is one child, an array when
  // there are several, and may hold nested arrays, `null`s and the empty strings Stash's
  // conditional tabs render. `toArray` normalises all of that.
  //
  // It also assigns keys, which turns out *not* to matter here and is worth writing down
  // so nobody re-derives it as a reason: React marks a child passed directly to
  // `createElement` as validated, so Stash's key-less static tabs do not start warning
  // when they are moved into an array. `toArray` is the right API for the shape, not a
  // fix for a warning.
  function insertBefore(React, container, extra, key) {
    var kids = container.props && container.props.children;
    if (kids == null) return null;
    var arr = React.Children.toArray(kids);
    for (var i = 0; i < arr.length; i++) {
      if (carriesEventKey(React, arr[i], key)) {
        arr.splice(i, 0, extra);
        return React.createElement(React.Fragment, null, arr);
      }
    }
    return null;
  }

  function safeAppend(React, args, build, beforeKey) {
    var last = args.length ? args[args.length - 1] : null;
    try {
      // Backwards for the first *element*, rather than an index. The result is last
      // today, and the two arguments in front of it were also "obviously" one argument
      // until React's legacy-context object turned up between them. Neither props nor a
      // context object is ever an element, so the search cannot pick the wrong one, and
      // it survives anything else arriving on either side.
      for (var i = args.length - 1; i >= 0; i--) {
        if (React.isValidElement(args[i])) {
          var extra = build();
          var placed = beforeKey ? insertBefore(React, args[i], extra, beforeKey) : null;
          return placed || React.createElement(React.Fragment, null, args[i], extra);
        }
      }
      // Nothing element-shaped at all. There is nothing to append to and nothing better
      // to return than what we were handed, so the page is whatever it would have been.
      gateLogOnce('shape', 'a patched component was called with ' +
        plural(args.length, 'argument') + ' and none of them an element - ' +
        'the Variants tab is not being added.');
      return last;
    } catch (e) {
      console.warn('[svr] the Variants tab could not be built, so it is not being added: ' +
        e.message);
      return last;
    }
  }

  function pluginApi() {
    var api = window.PluginApi;
    return api && api.patch && typeof api.patch.after === 'function' ? api : null;
  }

  // The tab is always present, even on the scenes - most of them, today - with no
  // stash-id and so no possible variant. A tab that came and went as a query landed
  // would move the strip under the pointer, and the empty cases are the ones worth
  // explaining: "this scene carries no stash-id" is a fact about the library the user
  // can act on, and a tab that hid itself would be the one place it could never appear.
  //
  // The caption carries no count, which is the price of that: the strip and the pane are
  // two separate patches rendering two separate components, so a count in the caption
  // would need the query's answer to be shared between them - a module-level cache and a
  // subscription, to save the user one click. The pane counts its own rows in its first
  // line instead.
  function TabLink(React, Nav) {
    return React.createElement(Nav.Item, { key: TAB_KEY },
      React.createElement(Nav.Link, { eventKey: TAB_KEY, className: 'svr-tab-link' }, TAB_LABEL));
  }

  // One row. `row.cls.label` is empty for an unclassified scene and the span is then not
  // rendered at all, rather than rendered blank - an untagged variant is listed as
  // context, and a column of empty marks would read as something missing.
  // The cover, and the preview loop the scene cards play on hover.
  //
  // **A `<video poster>` rather than an image with a video over it.** Stash's own card
  // stacks the two and slides the video in, because a card is a fixed frame it can
  // position inside; one element that shows the cover until it is asked to play needs no
  // stacking context, no transition and no second URL fetched up front - `preload="none"`
  // is what keeps three previews on a page from being three downloads nobody asked for.
  //
  // **And not Stash's `SceneCard`, though `PluginApi.loadableComponents` offers it.** It
  // would bring the cover, the preview, the scrubber and the whole card look for free, and
  // it wants a `SlimSceneDataFragment` to do it - forty-odd fields across five nested
  // fragments, hand-copied into a query here and silently wrong the day Stash's card reads
  // one more. Two path fields against that is not a close call, and a row keeps the
  // dimension column a card has nowhere to put.
  function VariantThumb(React, scene) {
    var paths = scene.paths || {};
    if (!paths.screenshot && !paths.preview) return null;
    if (!paths.preview) {
      return React.createElement('img',
        { key: 'thumb', className: 'svr-thumb', src: paths.screenshot, alt: '', loading: 'lazy' });
    }
    return React.createElement('video', {
      key: 'thumb', className: 'svr-thumb', src: paths.preview, poster: paths.screenshot,
      muted: true, loop: true, playsInline: true, preload: 'none', disableRemotePlayback: true,
      // The promise is caught because a browser rejects `play()` when the pointer crosses
      // a row before the page has been interacted with, and an uncaught rejection in a
      // mouse handler is a console error on every hover.
      onMouseEnter: function (e) {
        var v = e.currentTarget, p = v.play();
        if (p && p.catch) p.catch(function () {});
      },
      // `load()`, not pause-and-rewind. A paused video keeps showing the frame it
      // stopped on, and rewinding it only moves that to frame zero of the *preview* - the
      // poster is painted while the element has no frame at all, and `load()` is what
      // returns it to that state. With `preload="none"` it fetches nothing on the way.
      onMouseLeave: function (e) { e.currentTarget.load(); },
    });
  }

  // Two lines: the title, then everything that describes the file. The value sits at the
  // head of the second line rather than after the title, which is what keeps a column of
  // them scannable - titles vary in length, so a value trailing one starts at a different
  // place on every row, and the eye has to hunt for it.
  function VariantRow(React, row, coverDiffers) {
    var facts = [];
    if (row.cls.label) {
      facts.push(React.createElement('span', {
        key: 'role', className: 'svr-role svr-role-' + row.cls.role,
        // The tag that decided it, for whoever wants to confirm the match.
        title: row.cls.tags ? 'Tagged ' + row.cls.tags : null,
      }, row.cls.label));
    }
    var meta = metaOf(row.scene);
    if (meta) facts.push(React.createElement('span', { key: 'meta', className: 'svr-meta' }, meta));
    // The delta at a glance, before the hover: a badge per kind, only where the count
    // is not zero. The numbers come from the same computation the hover box renders,
    // so the two cannot disagree. One wrapper for the group, because the facts line
    // wraps between its children - three loose badges could break onto two lines
    // mid-group, and they read as one annotation, so they move as one.
    if (row.delta) {
      var badges = [];
      [['extra', '🏷️+', 'extra tag'], ['missing', '🏷️−', 'missing tag'],
        ['attrs', '📋⚙', 'differing attribute']].forEach(function (b) {
        var n = row.delta[b[0]];
        if (!n) return;
        badges.push(React.createElement('span', {
          key: 'badge-' + b[0], className: 'svr-dbadge svr-dbadge-' + b[0],
          title: plural(n, b[2]),
        }, b[1] + n));
      });
      if (badges.length) {
        facts.push(React.createElement('span',
          { key: 'badges', className: 'svr-dbadges' }, badges));
      }
    }
    // The cover is not part of `row.delta`: every other count comes off fields the
    // one query already returned, and this one is two pictures compared by their
    // bytes, which lands after the list is drawn. Its own badge, in the same row.
    if (coverDiffers) {
      facts.push(React.createElement('span',
        { key: 'coverbadge', className: 'svr-dbadges' },
        React.createElement('span', { key: 'c', className: 'svr-dbadge svr-dbadge-cover',
          title: 'This variant\u2019s cover is not the same picture as this scene\u2019s.' },
        '\ud83d\uddbc\u2260')));
    }
    var line = [React.createElement('a', {
      key: 'title', className: 'svr-variant-title', href: '/scenes/' + row.scene.id,
      // A new tab by default, like every other link these plugins draw - the scene
      // being read is the one the pane belongs to, and following a variant out of it
      // is what loses the comparison. ᝯㄝₓ Core's own setting is what moves both of
      // these to the same tab.
      target: linkTarget(),
    }, row.scene.title || ('Scene ' + row.scene.id))];
    if (facts.length) {
      line.push(React.createElement('div', { key: 'facts', className: 'svr-facts' }, facts));
    }
    var thumb = VariantThumb(React, row.scene);
    var kids = [React.createElement('div', { key: 'body', className: 'svr-variant-body' }, line)];
    if (thumb) {
      // The cover links too, and it is its own anchor rather than the whole row being one:
      // the title inside is already a link, and an anchor inside an anchor is invalid
      // markup that browsers resolve by closing the outer one early.
      // The rating banner and the organized mark, over the cover's top corners - the
      // same pair the hover card wears, from the same fields the query already fetches.
      var over = [thumb];
      var rate = tipRatingBadge(row.scene.rating100);
      if (rate) over.push(React.createElement('span',
        { key: 'rate', className: 'svr-rating' }, rate));
      if (row.scene.organized) over.push(React.createElement('span',
        { key: 'org', className: 'svr-organized', title: 'Organized' }, '\ud83d\udce6'));
      kids.unshift(React.createElement('a',
        { key: 'thumblink', className: 'svr-thumb-link', href: '/scenes/' + row.scene.id,
          target: linkTarget() }, over));
    }
    // On the row rather than on any one thing in it, so anywhere in the row answers it -
    // and the value span keeps its own title, which is a narrower answer about that span.
    // A styled box shown by the row's own :hover rather than a native `title`, because a
    // `title` cannot make the section headers bold and amber or space the sections, and
    // that formatting is the whole point - three runs of names in one grey paragraph was
    // the readability complaint. `pointer-events:none` in its rule, for the reason every
    // box here has it: one that took the pointer would close and reopen under it.
    if (row.delta) {
      var sections = row.delta.sections;
      if (coverDiffers) {
        sections = sections.filter(function (sec) { return sec.head; })
          .concat([{ head: 'Cover:', body: 'a different picture from this scene\u2019s',
            kind: 'attrs' }]);
      }
      kids.push(React.createElement('div', { key: 'delta', className: 'svr-delta' },
        sections.map(function (sec, i) {
          var bits = [];
          if (sec.head) {
            bits.push(React.createElement('span',
              { key: 'h', className: 'svr-delta-hdr' }, sec.head));
            bits.push(' ');
          }
          bits.push(sec.kind
            ? React.createElement('span',
              { key: 'b', className: 'svr-delta-' + sec.kind }, sec.ignored
                ? [sec.ignored, React.createElement('span',
                  { key: 'i', className: 'svr-delta-ignored' }, ' (ignored)'),
                  sec.body ? ', ' + sec.body : '']
                : sec.body)
            : sec.body);
          return React.createElement('div', { key: 's' + i, className: 'svr-delta-sec' }, bits);
        })));
    }
    return React.createElement('div',
      { key: row.scene.id, className: 'svr-variant' }, kids);
  }

  // `found` is null until the query lands, which is the loading state; after that it is
  // `{ rows, why }` and `why` is a whole sentence, because every one of the empty answers
  // needs one. The effect is keyed on the scene id so that walking the queue re-runs it,
  // and its cleanup drops the answer to a scene the user has already left.
  // The dialog's way back into the mounted pane's hooks: plain DOM code cannot reach a
  // `useState`, so the pane leaves two callbacks here for as long as it is mounted -
  // one to re-read after a dialog that wrote closes, one to lock the Synchronize button
  // while any dialog is open.
  var _paneRefresh = null;
  var _paneLock = null;

  function VariantsPane(React) {
    return function (props) {
      var scene = (props && props.scene) || {};
      var state = React.useState(null);
      var found = state[0], setFound = state[1];
      var bump = React.useState(0);
      var stamp = bump[0], setStamp = bump[1];
      // `{ <scene id>: <data url> }` for every cover read, the viewed scene's
      // included, or null while nobody has asked or nothing has answered. A variant's
      // badge is its entry differing from the viewed scene's; the drift score counts
      // the same map the way the review task does.
      var cov = React.useState(null);
      var coverBy = cov[0], setCoverBy = cov[1];
      // Whether one of this plugin's dialogs is open: the Synchronize button is a
      // control that starts a run, so it is unavailable, with the reason on it, while
      // one runs. Read at mount so a pane mounted under an open dialog starts locked.
      var lk = React.useState(!!_active);
      var locked = lk[0], setLocked = lk[1];

      // Re-registered every render so the callback always closes over the current
      // stamp; unregistered on unmount so a task run from the settings page pokes
      // nothing.
      React.useEffect(function () {
        _paneRefresh = function () { setStamp(stamp + 1); };
        _paneLock = function (on) { setLocked(!!on); };
        return function () { _paneRefresh = null; _paneLock = null; };
      });

      // Keyed on the scene's *evidence* as well as its id. A save that took a stash-id
      // off reaches the page in two steps: the response, which fires `_paneRefresh`
      // while Stash's cache still holds the old scene, and then the re-render with the
      // new one. A key of the id alone re-read on the first step with the old ids -
      // finding the same variants - and did nothing on the second, so the rows it
      // showed were the ones the save had just detached.
      var evidence = variantValues(scene.stash_ids).join('\n') + '|' +
        (customField(scene, fieldName()) || '');
      React.useEffect(function () {
        var live = true;
        setFound(null);
        setCoverBy(null);
        findVariants(scene).then(function (result) { if (live) setFound(result); });
        return function () { live = false; };
      }, [scene.id, evidence, stamp]);

      // **After the list, never before it.** Comparing covers means reading the
      // pictures, and a tab that waited for them would show nothing while it did -
      // for an answer that is a badge on a row the user can already see. The browser
      // is fetching these same images to draw the thumbnails, so the read is a cache
      // hit in the ordinary case.
      React.useEffect(function () {
        if (!found || !found.self || !found.rows.length) return undefined;
        var live = true;
        settingsReady().then(function (s) {
          if (!live || !s.c4CheckCoverMismatch) return null;
          return readCover(found.self).then(function (mine) {
            if (!live || !mine) return null;
            var out = {}, chain = Promise.resolve();
            out[String(found.self.id)] = mine;
            found.rows.forEach(function (row) {
              chain = chain.then(function () {
                return readCover(row.scene).then(function (theirs) {
                  if (theirs) out[String(row.scene.id)] = theirs;
                });
              });
            });
            return chain.then(function () { if (live) setCoverBy(out); });
          });
        }, function () { return null; });
        return function () { live = false; };
      }, [found, stamp]);

      if (!found) {
        return React.createElement('div', { className: 'svr-tabpane' },
          React.createElement('div', { className: 'svr-empty' }, 'Looking for variants…'));
      }
      var kids = [];
      // Above the summary rather than below it: it is about the settings the whole list
      // was classified with, not about the list.
      if (found.conflict) {
        kids.push(React.createElement('div',
          { key: 'conflict', className: 'svr-conflict' }, found.conflict));
      }
      kids.push(React.createElement('div', { key: 'why', className: 'svr-summary' },
        found.rows.length
          ? plural(found.rows.length, 'other variant') + ' of this scene. ' + found.why
          : found.why));
      // The set's drift score, the number the review task's listing would sort this
      // set by: the same counts, the same exclusions and the same weights, so a set
      // synchronized from here reads as the listing would show it afterwards. Priced
      // by the weights the review dialog remembered, or its defaults. The cover count
      // lands with the pictures, after the rows, like the badge.
      // With Exclude Organized remembered, the listing scores the set without its
      // organized scenes, and a set left with one scene is not listed at all.
      var members = found.self && found.rows.length
        ? [found.self].concat(found.rows.map(function (r) { return r.scene; })) : [];
      if (found.excludeOrganized) {
        var before = members.length;
        members = members.filter(function (sc) { return !sc.organized; });
        if (before && members.length < 2) {
          kids.push(React.createElement('div', { key: 'drift', className: 'svr-drift' },
            'No drift score: Exclude Organized is on in ' +
            REVIEW_TASK_NAME.replace(/\.\.\.$/, '') + ', and fewer than two scenes of this ' +
            'set are not organized, so the listing leaves it out.'));
        }
      }
      if (members.length > 1) {
        var delta = setDelta(members, found.skip || {}, coverBy,
          found.matchers ? expectedMap(members, found.matchers, found.naming) : null,
          found.naming && found.naming.baseField);
        var score = scoreOf(delta, found.weights);
        // The tooltip hangs on the whole phrase, not the digit: a one-character hover
        // target is hard to hit, and the words are part of the thing being explained.
        kids.push(React.createElement('div', { key: 'drift', className: 'svr-drift' },
          React.createElement('span', {
            key: 'tip', className: 'svr-drift-tip',
            title: deltaText(delta) + '. A sorting value, not a count: each ' +
              'disagreement between this scene and its variants is worth its weight, ' +
              'and this is their sum per variant - divided by the number of variants, ' +
              'rounded up.\n' +
              'Weights: ' + weightsText(found.weights) + ' (' +
              (found.remembered ? 'remembered from' : 'the defaults of') + ' the ' +
              REVIEW_TASK_NAME.replace(/\.\.\.$/, '') + ' dialog).\n' +
              'Change them in Settings \u2192 Tasks \u2192 ' + PLUGIN_SHORT_NAME +
              ' \u2192 ' + REVIEW_TASK_NAME + ', on the strip above the listing; ' +
              'tick Remember there and this score follows.\n' +
              'Green is nothing to do, or one point of it; yellow, amber and red as the set drifts ' +
              'further apart.' +
              (found.coverCheck ? '' : ' Covers are not compared while Compare Cover ' +
                'Images is off.'),
          }, ['Drift score: ', React.createElement('span', {
            key: 's', className: 'svr-score ' + scoreClass(score, found.weights),
          }, String(score))])));
      }
      // The evidence lines back into the pages they name: one link per stash-box
      // entry, opening `https://<host>/scenes/<id>`. A pseudo line names nothing
      // upstream, so it gets none - and a scene with only one is a line with no links,
      // which is nothing at all.
      var boxes = (found.values || []).map(boxLink).filter(function (l) { return !!l; });
      if (boxes.length) {
        kids.push(React.createElement('div', { key: 'boxes', className: 'svr-boxlinks' },
          [plural(boxes.length, 'stash-box entry', 'stash-box entries') + ': ']
            .concat(boxes.map(function (l, i) {
              return React.createElement('a', {
                key: 'box' + i, href: l.url, target: linkTarget(), rel: 'noopener noreferrer',
                className: 'svr-boxlink',
                title: 'Open ' + l.url + (linkTarget() ? ' in a new tab' : ''),
              }, l.value);
            }))));
      }
      // The one control in the pane, and the reading half's only door into a write:
      // it opens the synchronize dialog, which re-reads and lists everything before
      // anything moves. Amber because pressing through leads to writes, dots because
      // the click itself only asks. The caption counts - "Synchronize Variant..." under
      // a summary that says "1 other variant" - while the tooltip and the dialog's title
      // stay generic: they describe what the task does, not this scene's set.
      if (found.rows.length) {
        kids.push(React.createElement('button', {
          key: 'sync', type: 'button',
          className: 'btn btn-sm ' + PLUGIN_BTN_VARIANT + ' svr-sync-btn',
          disabled: locked,
          title: locked
            ? 'A ' + PLUGIN_SHORT_NAME + ' dialog is already open. Finish or close it ' +
              'before starting another.'
            : 'Push this scene’s attribute values to its variants. Everything ' +
              'that differs is listed first with a checkbox per line; tags, performers ' +
              'and URLs are only ever added, a group is joined at this scene\u2019s own ' +
              'position, and nothing is written until you approve.',
          onClick: function () { startRun(SYNC_TASK, scene); },
        }, found.rows.length === 1 ? SYNC_TASK_NAME.replace('Variants', 'Variant') : SYNC_TASK_NAME));
      }
      var mine = coverBy && found.self ? coverBy[String(found.self.id)] : null;
      found.rows.forEach(function (row) {
        var theirs = coverBy ? coverBy[String(row.scene.id)] : null;
        kids.push(VariantRow(React, row, !!(mine && theirs && theirs !== mine)));
      });
      return React.createElement('div', { className: 'svr-tabpane' }, kids);
    };
  }

  var _patched = false;

  function installTabs() {
    if (_patched) return true;
    var api = pluginApi();
    if (!api) {
      gateLogOnce('patch', 'PluginApi component patching is unavailable - no Variants tab. ' +
        'This plugin needs Stash 0.28.0 or newer.');
      return false;
    }
    var React = api.React;
    var Bootstrap = (api.libraries || {}).Bootstrap;
    var Nav = Bootstrap && Bootstrap.Nav, Tab = Bootstrap && Bootstrap.Tab;
    if (!React || !Nav || !Tab) {
      gateLogOnce('patch', 'PluginApi is present but React or react-bootstrap is not - ' +
        'no Variants tab.');
      return false;
    }
    var Pane = VariantsPane(React);
    api.patch.after('ScenePage.Tabs', function () {
      return safeAppend(React, arguments,
        function () { return TabLink(React, Nav); }, BEFORE_TAB_KEY);
    });
    api.patch.after('ScenePage.TabContent', function (props) {
      return safeAppend(React, arguments, function () {
        return React.createElement(Tab.Pane, { key: TAB_KEY, eventKey: TAB_KEY },
          React.createElement(Pane, { scene: props.scene }));
      });
    });
    _patched = true;
    gateLogOnce('patch', 'the Variants tab is registered on the scene page');
    // The pane's own CSS has to be on the page before React first renders it, and there
    // is no tick watching the scene page any more to put it there.
    injectStyle();
    return true;
  }
  // ── The settings page ─────────────────────────────────────────────────────

  // SettingsPluginsPanel.tsx gives every plugin setting an id built from the plugin id
  // and the setting key - `plugin-SceneVariants-a1FullLengthTag`. That is ours by
  // construction: no version suffix, no localisation, nothing formatted for display.
  // Two plugins here shipped this broken by matching heading text instead, twice, so
  // the ids are the anchor and the heading is only a fallback.
  function settingElement(key) { return coreSettingElement(PLUGIN_ID, key); }

  // Walks up from any one of our settings to the group box that contains it. Trying
  // every key rather than a named one means removing or renaming a setting cannot
  // quietly break the anchor - but a release that renames them *all* can, and the first
  // casualty of that is the stale-script banner, which is the one thing on this page
  // such a release needed to show. So the group headed with our own name is the
  // fallback, inside this function rather than OR'd in by each caller.
  //
  // The fallback is guarded with `hasOwnTaskButton`, because Settings - Tasks heads *its*
  // group with the same name and decorating it would destroy the task button: the README
  // link picks its slot by structure, and there that slot is inside the button. The
  // guard matches this plugin's own task caption rather than merely testing for a
  // button - Stash puts its own Enable/Disable button in the plugin group's header row,
  // and a plugin here shipped that looser test and decorated nothing at all.
  function ownSettingGroup() {
    var node = null, d;
    for (var key in DEFAULTS) {
      if (!hasOwn(DEFAULTS, key)) continue;
      node = settingElement(key);
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
    if (node.tagName === 'BUTTON' &&
      (trim(node.textContent) === TASK_NAME || trim(node.textContent) === FLAG_TASK_NAME ||
        trim(node.textContent) === REVIEW_TASK_NAME ||
        trim(node.textContent) === RENAME_TASK_NAME)) return true;
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      if (hasOwnTaskButton(kids[i])) return true;
    }
    return false;
  }

  function settingRow(key) { return coreSettingRow(PLUGIN_ID, key); }

  // The two pages that show a group headed with our name do not head it the same way.
  // Settings - Tasks passes the plugin name straight through, but Settings - Plugins
  // appends the version:
  //
  //   heading: `${plugin.name} ${plugin.version ? `(${plugin.version})` : undefined}`
  //
  // so the h3 there reads "... (<version>)" - and, because that template interpolates
  // the literal when there is no version at all, sometimes "... undefined".
  //
  // Strip the suffix and compare exactly, rather than testing a prefix: a plugin whose
  // name merely starts with ours must not be mistaken for us.
  function ownSettingGroupHeading() {
    var nodes = document.querySelectorAll ? document.querySelectorAll('h3') : [];
    for (var i = 0; i < nodes.length; i++) {
      if (headingIsOurs(nodes[i].textContent)) return nodes[i];
    }
    return null;
  }

  function headingIsOurs(text) {
    var t = String(text == null ? '' : text).trim();
    if (t === PLUGIN_NAME) return true;
    t = t.replace(/\s*\([^()]*\)$/, '').replace(/\s+undefined$/, '').trim();
    return t === PLUGIN_NAME;
  }

  function readmeLinkSlot(group) {
    var sub = byClass(group, 'sub-heading');
    if (sub && sub.parentNode) return { parent: sub.parentNode, before: sub.nextSibling };
    var header = byClass(group, 'setting');
    var box = header && header.childNodes && header.childNodes[0];
    if (box) return { parent: box, before: null };
    return { parent: group, before: null };
  }

  // Paragraph spacing needs elements. Under `white-space: pre-wrap` a blank line is
  // always one whole line-height and nothing can target it, so the description's
  // paragraphs are rebuilt as divs and the gap becomes a margin - about a third of a
  // line, rather than a whole empty one.
  //
  // Stash renders the description as a single text node; React puts that text node back
  // on every re-render of this panel, so this runs on every tick and re-splits when it
  // has to. It is idempotent: once the children are ours, there is no text node left.
  function splitDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'svr-p')) return;   // already ours
    var text = sub.textContent || '';
    if (text.indexOf('\n') === -1) return;                   // nothing to split
    var paras = text.split(/\n{2,}/);
    sub.textContent = '';
    paras.forEach(function (para) {
      var t = oneLine(para);
      if (t) sub.appendChild(el('div', 'svr-p', t));
    });
  }

  // ── Settings verbosity: a summary on the page, the rest on hover ──────────
  //
  // A description written as "summary\n\ndetail" shows only its first paragraph, with
  // the rest moved into a tooltip. Stash's own Setting renders `<h3 title={tooltip}>`,
  // but SettingsPluginsPanel never passes a tooltip for a plugin setting and
  // `PluginSetting` has no field to declare one - so the slot exists, is always empty
  // for us, and is filled from here.
  var TIP_MARK = 'ⓘ';                  // circled Latin small letter i

  function setTipOpen(sub, on) {
    var cls = String(sub.className || '').replace(/\s*svr-tip-open\b/, '');
    sub.className = (on ? cls + ' svr-tip-open' : cls).replace(/^\s+/, '');
  }

  // A class toggled from JS rather than a `:hover ~` selector, because the triggers do
  // not sit in one predictable place: the mark is inside the .sub-heading and the name
  // is an <h3> somewhere above it, and a sibling combinator would depend on exactly how
  // Stash nests the pair.
  //
  // The row is passed rather than the .sub-heading, and the current one looked up per
  // event: an <h3> is Stash's element and survives the re-renders that replace
  // everything we put in the row, so a captured reference would go stale. The flag is
  // what stops a second pair of listeners landing on it each time we rebuild.
  function tipTrigger(node, row) {
    if (!node || node._svrTipWired) return;
    node._svrTipWired = true;
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
    var row = settingRow(key);
    if (!row) return;
    var sub = byClass(row, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'svr-sum')) return;   // already ours
    var text = sub.textContent || '';
    var cut = text.indexOf('\n\n');
    if (cut === -1) return;                                    // nothing to hide
    var summary = oneLine(text.slice(0, cut));
    var detail = text.slice(cut + 2).split(/\n{2,}/).map(oneLine)
      .filter(function (p) { return !!p; }).join('\n\n');
    if (!summary || !detail) return;
    sub.textContent = '';
    if (!hasClass(sub, 'svr-tipped')) {
      sub.className = ((sub.className || '') + ' svr-tipped').replace(/^\s+/, '');
    }
    var sum = el('span', 'svr-sum', summary);
    sub.appendChild(sum);
    // tabIndex, so the box can be reached and read without a mouse. The box is a
    // sibling of the mark rather than a child: as a child it would sit inside an inline
    // span and inherit its clipping and stacking.
    var mark = el('span', 'svr-tip', TIP_MARK);
    mark.tabIndex = 0;
    sub.appendChild(mark);
    sub.appendChild(el('span', 'svr-tipbox', detail));
    tipTrigger(mark, row);
    tipTrigger(sum, row);
    var h3 = row.querySelector ? row.querySelector('h3') : null;
    if (h3) tipTrigger(h3, row);
  }

  function tipSettings() {
    for (var k in DEFAULTS) {
      if (hasOwn(DEFAULTS, k)) tipSetting(k);
    }
  }

  // The group description is in the group *header*, which is outside the <Collapse> -
  // so it stays on screen at full height whether the group is expanded or not, and
  // per-plugin collapse does not shorten it. Hiding all but the first paragraph is the
  // only thing that does.
  //
  // A <button>, never a <span>: SettingGroup's onDivClick walks up from the event
  // target and returns early for `a` and `button`, so anything else folds the whole
  // group on click.
  function descCollapsed(sub) { return hasClass(sub, 'svr-desc-collapsed'); }

  function setDescCollapsed(sub, on) {
    var cls = String(sub.className || '').replace(/\s*svr-desc-collapsed\b/, '');
    sub.className = (on ? cls + ' svr-desc-collapsed' : cls).replace(/^\s+/, '');
  }

  function collapseDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    var paras = 0;
    for (var i = 0; i < kids.length; i++) if (hasClass(kids[i], 'svr-p')) paras++;
    if (paras < 2) return;                        // one paragraph hides nothing
    if (document.getElementById(DESC_TOGGLE_ID)) return;
    // A re-render drops the button and the class together, so the description returns
    // to collapsed rather than to a half-state with no way out of it.
    setDescCollapsed(sub, true);
    var btn = el('button', 'svr-desc-toggle', 'Show more');
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

  // ── The stale-script banner ───────────────────────────────────────────────
  //
  // Stash serves plugin JS with caching on, so a browser holding the old file goes on
  // running it after an update and nothing on screen says so. The settings heading is
  // where the two numbers meet: Stash builds it as `${name} (${version})` from the
  // **manifest**, read fresh from the server, while `PLUGIN_VERSION` is what this
  // script actually is.
  //
  // No query for it - the number is on the page already, and this tick runs once a
  // second.
  var STALE_ID = 'svr-stale-notice';

  // The group's own h3, not a search of the page: the header row comes before the
  // setting rows, each of which has an h3 too, and the group is already ours.
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
    // No parenthesised version on the heading means Settings - Tasks, which heads its
    // group with the bare name - not a mismatch, and nothing to say.
    if (!installed || installed === PLUGIN_VERSION) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      return;
    }
    var slot = staleSlot(group);
    if (node && node.parentNode === slot.parent) return;
    if (node && node.parentNode) node.parentNode.removeChild(node);
    var box = el('div', 'svr-stale', '⚠ This page is still running ' +
      PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION + ', but ' + installed + ' is installed. ' +
      'Press Ctrl+Shift+R (⌘+Shift+R on a Mac) to reload it: your browser has cached ' +
      'the older script, and everything this plugin does until then is that older code.');
    box.id = STALE_ID;
    slot.parent.insertBefore(box, slot.before);
  }

  // Re-added rather than tracked: React re-renders this panel whenever a setting changes
  // and drops anything we put in it, so the tick puts it back. Keyed on the id, so a
  // re-render that kept it does not produce a second one.
  function ensureReadmeLink() {
    var group = ownSettingGroup();
    if (!group) return;
    injectStyle();
    if (!hasClass(group, 'svr-own-group')) {
      group.className = ((group.className || '') + ' svr-own-group').replace(/^\s+/, '');
    }
    splitDescription(group);
    collapseDescription(group);   // after the split: it counts the .svr-p divs
    tipSettings();
    ensureStaleNotice(group);     // before the early return: the link outlives it
    ensureTitleRow(group);
    if (document.getElementById(README_LINK_ID)) return;
    var link = el('a', 'svr-readme', 'SceneVariants/README.md');
    link.id = README_LINK_ID;
    link.href = README_URL;
    link.target = linkTarget();
    link.rel = 'noopener noreferrer';
    link.title = 'Open this plugin’s documentation';
    link.style = 'display:inline-block;margin-top:.35rem;font-size:.8rem;';
    var slot = readmeLinkSlot(group);
    slot.parent.insertBefore(link, slot.before);
  }


  var TAG_LINK_MARK = '🔗';      // link symbol
  var TAG_LINK_KEYS = ['a1FullLengthTag', 'a2PartialLengthTag', 'a4VariantFlagTag', 'e5NoRenameTag'];

  function tagLinkId(key) { return 'svr-taglink-' + key; }

  // **The tree the classifier reads cannot answer the tooltip**, and deliberately: it is
  // every tag in the library, so it carries ids for parents and nothing at all for
  // children or descriptions - a paragraph per tag across a library is the payload
  // `tagQuery` in the siblings is careful to avoid. The tooltip wants all three for
  // exactly **one** tag, so it asks for that one by id.
  //
  // Cached for the page and never expired, unlike `tagTree`: what a tag is called and
  // what it says about itself does not move under a settings page, and a stale tooltip is
  // the cheapest thing in this plugin to be wrong.
  var _tagDetail = {};

  function tagLinkDetail(id) {
    if (hasOwn(_tagDetail, id)) return _tagDetail[id];
    _tagDetail[id] = gqlRequest(
      'query SVRTagDetail($id: ID!) { findTag(id: $id) ' +
      '{ id name aliases description parents { name } children { name } } }', { id: id })
      .then(function (d) { return (d && d.findTag) || null; }, function () { return null; });
    return _tagDetail[id];
  }

  function dropTagLink(key) {
    var node = document.getElementById(tagLinkId(key));
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  // The flag tag's box, like the field's, means its default when empty - so its link
  // resolves the name in force rather than the raw setting, and never drops for an
  // empty box the way the two length tags' links do.
  function tagLinkName(key) {
    return key === 'a4VariantFlagTag' ? flagTagName() : trim(settings()[key]);
  }

  function tagLinkTick(key) {
    if (!settingRow(key)) return;
    var name = tagLinkName(key);
    if (!name) { dropTagLink(key); return; }
    tagTree().then(function (tags) {
      var row = settingRow(key);
      if (!row || tagLinkName(key) !== name) return;   // the box moved on
      var hits = tagsMatchingName(tags, name);
      if (!hits.length) { dropTagLink(key); return; }
      var tag = hits[0];
      var node = document.getElementById(tagLinkId(key));
      if (!node) {
        node = el('a', 'svr-tagicon', TAG_LINK_MARK);
        node.id = tagLinkId(key);
        node.target = linkTarget();
        node.rel = 'noopener noreferrer';
      }
      node.href = '/tags/' + tag.id;
      var note = [];
      if (tag.name !== name) {
        note.push('Matched on "' + name + '", without regard to case or by one of its aliases.');
      }
      if (hits.length > 1) {
        note.push(plural(hits.length, 'tag') + ' match this name and this plugin uses all ' +
          'of them; this is the first.');
      }
      // The detail lands a moment after the link does, which is invisible - and where it
      // cannot be read the tree's own entry still names the tag and its aliases, so the
      // tooltip degrades rather than disappearing.
      // The tooltip goes through `tagTip`, which draws it as a `title` and reopens it as a
      // box with the tag's picture above it wherever the tag has one.
      tagLinkDetail(tag.id).then(function (full) {
        tagTip(node, tag.id, tagLinkTitle(full || tag, note.join(' ') || null));
      });
      // At the end of Stash's own `.value`, so the link is on the same line as the name
      // it resolves and to the left of the Edit button. `.setting` is
      // `display:flex;align-items:center` with the heading, the value and the
      // sub-heading stacked in one flex child and Edit alone in the other, so a node
      // beside `.value` starts a line of its own beneath it and one next to Edit is
      // centred against the whole stack. React owns this subtree; the tick re-adds the
      // link, so a re-render dropping it costs a second.
      var host = byClass(row, 'value') || row;
      if (node.parentNode !== host) host.appendChild(node);
    }, function () { /* a link is not worth an error */ });
  }

  function settingsTick() {
    ensureReadmeLink();
    paintTaskButtons();
    for (var i = 0; i < TAG_LINK_KEYS.length; i++) tagLinkTick(TAG_LINK_KEYS[i]);
    // `fieldName()`, not the raw setting: an empty box means the default here, and the
    // mark has to describe the field actually in force rather than the empty string.
    cfTipTick(PLUGIN_ID, 'a3VariantStashIdField', fieldName());
  }

  // The field's own display, wherever Stash shows it. `CustomFields.tsx` renders each
  // field as a DetailItem whose value span is classed `detail-item-value
  // custom-field-<name, lowercased, spaces and underscores to hyphens>` - Stash's own
  // class, by construction, the same kind of anchor as the settings ids. Each `host:id`
  // line gains a link opening the work's page at that stash-box, through the same
  // `boxLink` the pane draws; a pseudo line names nothing upstream and gets none.
  //
  // Appended after Stash's text rather than replacing it: the span is React's, so a
  // re-render drops the links and the next tick puts them back - the settings-page
  // rule, applied to a second page that is also decoration rather than a control.
  function cfValueLinkTick() {
    if (!document.querySelectorAll) return;
    var cls = ('custom-field-' + fieldName().toLowerCase().replace(/ /g, '-'))
      .replace(/_/g, '-');
    var nodes = document.querySelectorAll('.' + cls);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!hasClass(node, 'detail-item-value')) continue;
      if (node.querySelector && node.querySelector('.svr-cflinks')) continue;
      var links = splitValues(node.textContent).map(boxLink)
        .filter(function (l) { return !!l; });
      if (!links.length) continue;
      var wrap = el('span', 'svr-cflinks');
      for (var j = 0; j < links.length; j++) {
        var a = el('a', 'svr-cflink', '↗' + links[j].url.split('/')[2]);
        a.href = links[j].url;
        a.target = linkTarget();
        a.rel = 'noopener noreferrer';
        a.title = 'Open ' + links[j].url + (linkTarget() ? ' in a new tab' : '');
        wrap.appendChild(a);
      }
      node.appendChild(wrap);
    }
  }

  if (document.addEventListener) {
    document.addEventListener('click', function (event) {
      var target = event.target;
      var btn = target && target.closest ? target.closest('button') : null;
      var name = btn ? ownTaskName(btn) : null;
      if (!name) return;
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      startRun(name === FLAG_TASK_NAME ? FLAG_TASK
        : name === REVIEW_TASK_NAME ? REVIEW_TASK
        : name === RENAME_TASK_NAME ? RENAME_TASK : MIGRATE_TASK);
    }, true);
  }

  // The one sentence that documents this plugin's custom field, filed in
  // `CustomFieldsBulkEditor`'s description store so it shows up wherever that plugin
  // shows a field. Feature-detected, never version-checked, and it never overwrites:
  // a description already filed under this name is somebody's writing.
  var FIELD_DESCRIPTION = 'The stash-id of the work this scene is a variant of, as ' +
    '<provider>:<stash-id>, one per line.\n\n' +
    'Written by ' + PLUGIN_NAME + '. A partial-duration scene carries this instead of a ' +
    'real stash-id, because a stash-id names the whole work and a cut is not it; a ' +
    'full-duration scene carries it as well as one. The Variants tab matches on this ' +
    'field and on stash-ids together, so a scene is found by either.';

  var BASE_FIELD_DESCRIPTION = 'The base name of the variant set this scene belongs to: ' +
    'what Rename Variants titles the set\u2019s partial-duration scenes after, before the ' +
    'postfix and the index.\n\n' +
    'Read by ' + PLUGIN_NAME + ', never written by it. Set it on any scene of a set whose ' +
    'titles share the wrong thing, or nothing at all; it wins over the titles.';
  var SKIP_FIELD_DESCRIPTION = 'Set to anything, keeps Rename Variants from proposing a ' +
    'title for this scene.\n\n' +
    'Read by ' + PLUGIN_NAME + ', never written by it. For the partial-duration scene that ' +
    'falls outside the naming rule.';

  function describeVariantFields() {
    var api = coop().api && coop().api.CustomFieldsBulkEditor;
    if (!api || typeof api.describeField !== 'function') return;
    var nm = naming(settings());
    [[fieldName(), FIELD_DESCRIPTION], [nm.baseField, BASE_FIELD_DESCRIPTION],
      [nm.skipField, SKIP_FIELD_DESCRIPTION]].forEach(function (pair) {
      api.describeField(pair[0], pair[1]).then(function (outcome) {
        if (outcome === 'added') {
          svr('[svr] described the custom field "' + pair[0] + '" in ' +
            'CustomFieldsBulkEditor\u2019s description store.');
        } else if (outcome === 'queued') {
          svr('[svr] a description for "' + pair[0] + '" is waiting for ' +
            'CustomFieldsBulkEditor\u2019s description store - open "Manage Custom Field ' +
            'Descriptions..." and press Apply to file it.');
        }
      }, function () { /* a sentence is not worth an error */ });
    });
  }
  // ── Wiring ────────────────────────────────────────────────────────────────
  //
  // Patches have to be registered before the components they target first render, so
  // this runs at script load; the `load` retry only covers Stash setting
  // window.PluginApi later than usual.
  //
  // The timer is for decoration alone - the settings page, and the custom field's own
  // display on a detail panel. There is no MutationObserver and no click or popstate
  // handler, because nothing a click needs is put back into the DOM: React renders the
  // tab and the pane, and re-renders them itself. That is the same position
  // `NormalizeParentTags` is in, and the reason this plugin subscribes to no `domBus`.

  function tick() {
    try { settingsTick(); } catch (e) { console.error('[svr] settings tick:', e); }
    try { cfValueLinkTick(); } catch (e) { console.error('[svr] cf link tick:', e); }
  }

  installTabs();
  // The respecter flag says "I react to saves and will stand down for a lease" - true
  // since the save watch, and what lets a sibling's bulk dialog tell "will stand
  // down" from "too old to know".
  coop().respecters[PLUGIN_ID] = true;
  installSaveWatch();

  // For ᝯㄝₓ Scene Filename Manager's rename template: the base title and partial
  // postfix of every scene in a variant set whose base the naming rule reads, as
  // { sceneId: { base, postfix } }. A read call, library-wide - the two scans Review
  // Variant Sets runs - so its caller asks once per run. A full-duration scene, or a
  // partial the rule skips, has the base and an empty postfix.
  function apiTitleParts() {
    return Promise.all([settingsReady(), tagTree()]).then(function (both) {
      var s = both[0], m = matchers(both[1], s), nm = naming(s), field = fieldName(s);
      var quiet = { scanned: 0, progress: function () {}, progressText: function () { return ''; } };
      return setMembersScan(quiet, field).then(function (scenes) {
        var out = {};
        variantSetsOf(scenes, field).forEach(function (set) {
          var n = namingOf(set.scenes, m, nm), base = n.base.base;
          if (!base) return;
          set.scenes.forEach(function (sc) {
            var id = String(sc.id);
            var want = n.expected && hasOwn(n.expected, id) ? n.expected[id] : '';
            out[id] = { base: base,
              postfix: want.indexOf(base) === 0 ? want.slice(base.length) : '' };
          });
        });
        return out;
      });
    });
  }

  // For its `stashid` token: every name a scene is known by as a work - its own
  // stash-ids spelled the way the field stores them, then what the field holds - as
  // `sceneKeys` reads them. The worker reads the scene it is handed, which must carry
  // `stash_ids` and `custom_fields`.
  function apiStashIds() {
    return settingsReady().then(function (s) {
      var field = fieldName(s);
      return { of: function (scene) { return sceneKeys(scene, field); } };
    });
  }

  coop().api[PLUGIN_ID] = { version: PLUGIN_VERSION, titleParts: apiTitleParts,
    stashIds: apiStashIds };

  if (window.addEventListener) {
    window.addEventListener('load', function () {
      installTabs();
      tick();
    });
  }
  setInterval(tick, 1000);
  // Warms the settings cache so the first pane knows the two tag names, and documents
  // the custom field once the configured name is known - the sibling may not have loaded
  // yet at script bottom, and `describeField` is read off the shared object at call time.
  settingsReady().then(describeVariantFields, function () {});
  tick();
}());
