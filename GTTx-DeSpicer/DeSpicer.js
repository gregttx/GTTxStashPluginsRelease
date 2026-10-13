// De-Spicer
//
// Requires Stash 0.31.0 or newer: `custom_fields` on the seven entity-types is one of the
// places this plugin rewrites, and `CustomFieldsInput` on their update mutations is how.
//
// Vanillify and anonymize a library. One task scans every entity-type and lists what the
// goals - Anonymize, Vanillify or both - and the rule for each kind of data would change,
// entity by entity, before and after. **Nothing is written until Proceed**, and Undo puts
// back exactly what the dialog wrote while it stays open.
//
// **A pseudonym is consistent.** The same original gives the same made-up value wherever it
// appears - a performer's name in a scene's details becomes the performer's own pseudonym -
// and the same one tomorrow, because it is derived from the original and a salt made once
// per library and kept with the settings. Without the salt a pseudonym is a hash anyone
// could run every performer's name through.
//
// The design, and the reasoning behind the parts that look arbitrary, are in AGENTS.md
// and NOTES.md next to this file.
(function () {
  'use strict';

  // ── The shared blocks, from ᝯㄝₓ Core ─────────────────────────────────────
  //
  // Bound at load: `ui: requires:` in the .yml is topologically sorted by Stash and
  // `useScript` sets `async = false`, so Core has finished running before this line.
  var C = (window.__GTTx__ || {}).core;
  // The Core floor, ᝯㄝₓ Core 5.9.0 or newer, told by one of its exports (`ownedTags`).
  // Below it nothing else in this file can run, and no shared code is left to say so.
  if (!C || typeof C.ownedTags !== 'function') {
    if (window.console && console.error) {
      console.error('[dsp] ᝯㄝₓ De-Spicer cannot start: it needs ᝯㄝₓ Core 5.9.0 or newer, installed and '
        + 'enabled. Install or update it from the same source and reload the page.');
    }
    return;
  }
  var pluginConfig = C.pluginConfig, logsToConsole = C.logsToConsole, showDefaults = C.showDefaults,
    coop = C.coop, plural = C.plural, copyToClipboard = C.copyToClipboard, keepLog = C.keepLog,
    droppedLine = C.droppedLine, holdWidth = C.holdWidth, staleReloadButton = C.staleReloadButton,
    hasOwn = C.hasOwn, el = C.el, fieldHeading = C.fieldHeading, hasClass = C.hasClass, paintButton = C.paintButton,
    wireEscape = C.wireEscape, unwireEscape = C.unwireEscape, gqlRequest = C.gqlRequest,
    fieldLocks = C.fieldLocks, foreignLease = C.foreignLease,
    linkTarget = C.linkTarget, entityTip = C.entityTip, displayName = C.displayName, linesDrawn = C.linesDrawn,
    matchContext = C.matchContext, download = C.download;

  var PLUGIN_ID   = 'DeSpicer';
  var PLUGIN_NAME = 'ᝯㄝₓ De-Spicer';
  // The name the dialog head wears: the manifest's, which is already short.
  var PLUGIN_SHORT_NAME = PLUGIN_NAME;

  // The one version that proves which script is running: the settings page reads the
  // manifest, which goes current the moment plugins are reloaded, cached script or not.
  var PLUGIN_VERSION = '1.0.0';

  // Printed before anything else runs, so a script that loads and then throws is told
  // apart from one that never loaded at all.
  function dsp(message) {
    if (typeof console !== 'undefined' && (console.info || console.log)) {
      (console.info || console.log).call(console, message);
    }
  }

  dsp('[dsp] DeSpicer.js ' + PLUGIN_VERSION + ' loaded. This is the running ' +
    'script\'s own version - the settings page reads the manifest instead, which can be ' +
    'newer than the script your browser has cached.');

  var README_URL = 'https://github.com/gregttx/GTTxStashPluginsRelease/blob/main/GTTx-DeSpicer/README.md';
  var STYLE_ID = 'dsp-style';

  // Orange for every button of ours: the task button, Proceed, the filter toggles while on.
  var PLUGIN_BTN_VARIANT = 'btn-warning';
  var TICK_MS = 1000;
  var READ_PAGE = 500;      // entities per page of the scan
  var WRITE_CHUNK = 25;     // entities written per batch, so Undo and the log stay live
  var SHOWN_CHARS = 140;    // of a value on a change line; Copy log keeps it whole
  // What a plan may hold. Up to LEAN_ABOVE changes it keeps each value and what it becomes; past
  // it, a hash of the value alone - the write reads the field again, checks it against the hash and
  // works the new value out afresh, and the listing reads the page it shows. Past UNDO_KEEP
  // entities the dialog keeps no copy for its own Undo and leaves the run to Undo History. Both
  // because a whole library's values, held twice, are more than a tab holds.
  var LEAN_ABOVE = 20000;
  var UNDO_KEEP = 5000;
  // The single-word names a scan asks about at the top of its listing; the rest take a default.
  var REVIEW_MAX = 30;
  // The changes that keep their values in any plan: few, and the write needs what they hold.
  var KEEP_VALUES = { file: true, archive: true, remove: true, image: true, rename: true };

  function trim(text) {
    return String(text == null ? '' : text).replace(/^\s+|\s+$/g, '');
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  //
  // A key is the storage key: renaming one silently resets it for every install. Every one
  // is edited in a dialog of its own row (Core's `settingsDialog`), none on Stash's page.
  // `z2Written` is no setting either: the record of the name pseudonyms runs wrote (`writtenKey`).
  // Nor `z3NameAnswers`: how each single-word name the listing asked about is replaced in free text.
  // `z1Salt` is no setting a user edits: the secret every pseudonym is derived with, made
  // once per library and stored by the first Proceed, so a run tomorrow gives the same fakes.
  var TYPE_KEYS = [['t1Scenes', 'scenes'], ['t2Images', 'images'], ['t3Galleries', 'galleries'],
    ['t4Performers', 'performers'], ['t5Studios', 'studios'], ['t6Groups', 'groups'], ['t7Tags', 'tags'],
    ['t8Markers', 'markers'], ['t9Filters', 'filters']];
  var RULE_KEYS = [['c1Names', 'names'], ['c2Text', 'text'], ['c3Links', 'links'], ['c4Fields', 'fields'],
    ['c4bFieldNames', 'fieldnames'], ['c5Facts', 'facts'], ['c6Dates', 'dates'], ['c7Ratings', 'ratings'], ['c8Filters', 'filters'],
    ['c9Images', 'images'], ['c9bFiles', 'files']];
  // `f1Terms` null stands for the default list, defined below with the matching.
  var DEFAULTS = {
    a1Anonymize: true,
    a2Vanillify: true,
    t1Scenes: true,
    t2Images: true,
    t3Galleries: true,
    t4Performers: true,
    t5Studios: true,
    t6Groups: true,
    t7Tags: true,
    t8Markers: true,
    t9Filters: true,
    c1Names: 'auto',
    c2Text: 'auto',
    c3Links: 'auto',
    c4Fields: 'auto',
    c5Facts: 'auto',
    c6Dates: 'auto',
    c7Ratings: 'auto',
    c8Filters: 'auto',
    c9Images: 'auto',
    c9bFiles: 'auto',
    c2bTagNamesInText: true,
    c4bFieldNames: 'auto',
    d1BlurStrength: '5',
    e1RemoveTag: '',
    e2RemoveDeletes: 'generated',
    f1Terms: null,
    f2Plurals: 'english',
    g1RecordUndo: true,
    g2OfferBackup: true,
    g3KeepArchive: true,
    // The exclusions: a tag carried, or a custom field held whatever its value, leaving the whole
    // entity alone - its name too, wherever it is mentioned - or only its image.
    h1ExcludeEntityWithTagName: 'ᱜ╦╦🞮✅DoNotDeSpice⚠∙',
    h2ExcludeEntityWithCustomFieldName: 'ᱜ╦╦🞮_Do_Not_De-Spice',
    h3ExcludeImageWithTagName: 'ᱜ╦╦🞮✅DoNotDeSpiceImage⚠∙',
    h4ExcludeImageWithCustomFieldName: 'ᱜ╦╦🞮_Do_Not_De-Spice_Image',
    z1Salt: '',
    z2Written: '',
    z3NameAnswers: '',
  };

  // Its own settings come from a slot of Core's read apart from the shared one (`pluginConfig`'s
  // `also`), so its record of pseudonyms is never read by a page drawing nothing of De-Spicer's.
  function loadSettings(fresh) {
    return pluginConfig(fresh, [PLUGIN_ID]).then(function (data) {
      var all = (data.configuration || {}).plugins || {};
      var raw = all[PLUGIN_ID] || {};
      var s = {};
      for (var k in DEFAULTS) {
        if (!hasOwn(DEFAULTS, k)) continue;
        var has = hasOwn(raw, k) && raw[k] != null;
        s[k] = typeof DEFAULTS[k] === 'boolean' ? (has ? truthy(raw[k]) : DEFAULTS[k])
          : has ? String(raw[k]) : DEFAULTS[k];
      }
      if (s.f1Terms == null) s.f1Terms = defaultTerms();
      // COMPAT: Custom field names stored as a switch (since De-Spicer 0.22.0), then as Rewrite terms (since
      // De-Spicer 0.23.0); remove when no library holds a true, a false or "terms" for it.
      if (s.c4bFieldNames === 'true') s.c4bFieldNames = 'auto';
      else if (s.c4bFieldNames === 'false') s.c4bFieldNames = 'never';
      else if (s.c4bFieldNames === 'terms') s.c4bFieldNames = 'keep';
      s.others = all;
      return s;
    });
  }
  function truthy(v) { return v === true || v === 'true'; }

  // Shown on Stash's settings page from its first paint (Core's `showDefaults`); stored by
  // the first Save in a dialog, never by opening a page.
  showDefaults(PLUGIN_ID, function () {
    var out = {};
    for (var k in DEFAULTS) if (hasOwn(DEFAULTS, k) && k !== 'z1Salt' && k !== 'z2Written' && k !== 'z3NameAnswers') out[k] = k === 'f1Terms' ? defaultTerms() : DEFAULTS[k];
    return out;
  });

  // ── The goals and the rules ───────────────────────────────────────────────
  //
  // Each kind of data follows the goals unless a rule of its own says otherwise. Stored as
  // one line - `goals: anonymize vanillify; text: keep` - so the settings page's own box
  // can be read and typed in, and only what differs from the goals is written down.
  var CATEGORIES = [
    { key: 'names', label: 'Names', ways: ['keep', 'blank', 'placeholder', 'pseudonym', 'random'],
      tip: 'Titles, names, sort names, aliases, disambiguations and marker titles. Random words here are random letters ' +
        'of the name\'s shape, each name its own, the same wherever it is mentioned; a title is marked like random text.' },
    { key: 'text', label: 'Free text', ways: ['keep', 'blank', 'pseudonym', 'random'],
      tip: 'Details, descriptions, synopses, directors, photographers, codes, tattoos, piercings and ' +
        'custom field descriptions. A pseudonym here replaces every name in the library by its pseudonym, even names Names keeps, and keeps every other ' +
        'word - readable, but a synopsis can still be searched online; blank is the anonymous choice, and random ' +
        'words are as anonymous at about the original\'s size.' },
    { key: 'links', label: 'Links & ids', ways: ['keep', 'blank', 'pseudonym'], labels: { pseudonym: 'Pseudo-link' },
      tip: 'URLs, and the stash-ids linking an entity to a stash-box. A stash-id has no pseudonym: ' +
        'anything but keep removes it.' },
    { key: 'fields', label: 'Custom field values', ways: ['keep', 'blank', 'placeholder', 'pseudonym', 'random'],
      labels: { random: 'Random values' },
      tip: 'The field names stay. Fields other ᝯㄝₓ plugins keep are left alone. Random values are random words for ' +
        'text and a random number of the same shape for a number; a true/false is kept, and blank removes a number ' +
        'or a true/false.' },
    { key: 'fieldnames', label: 'Custom field names', ways: ['keep', 'never'], labels: { never: 'Never rename' },
      tip: 'The names of custom fields. Kept, as kept text is everywhere, they have their explicit terms rewritten ' +
        'while Vanillify is on: on every entity holding the field and in saved filters naming it, a name already in ' +
        'the library numbered ("Warm rating 2"). Never rename leaves every name as it is. Fields other ᝯㄝₓ plugins ' +
        'keep are never renamed, and a script outside Stash naming a renamed field will not find it.' },
    { key: 'facts', label: 'Performer\'s facts', ways: ['keep', 'blank', 'random'], labels: { random: 'Random values' },
      tip: 'A performer\'s gender, birth and death dates, country, ethnicity, eye and hair color, ' +
        'height, weight, measurements, career dates and the body fields. Random values are each a value of its own ' +
        'kind - a gender, a country, an eye color, a height - and a date within the ten-year span of the original ' +
        '(1985 to 1994, 1995 to 2004…), a career\'s start in its first half and its end in its second, never in ' +
        'the future; a fact left empty stays empty.' },
    { key: 'dates', label: 'Dates', ways: ['keep', 'blank'],
      tip: 'The dates of scenes, images, galleries and groups.' },
    { key: 'ratings', label: 'Ratings & counters', ways: ['keep', 'blank'],
      tip: 'Ratings, O-counters, play counts and resume times. Blank resets them; a counter\u2019s history goes with it, and only the dialog\u2019s Undo puts it back.' },
    { key: 'filters', label: 'Saved filters', ways: ['keep', 'placeholder', 'pseudonym', 'random'],
      tip: 'A saved filter\'s name, and the names inside its criteria, each as Names treats that name.' },
    { key: 'files', label: 'Scene files', ways: ['keep', 'pseudonym'], labels: { never: 'Never rename' },
      tip: 'The names of scenes\' files on disk, renamed only where ᝯㄝₓ Scene Filename Manager has archived the ' +
        'original, so its Restore Original Filenames can take them back. Vanillify\'s words are rewritten in them too.' },
    { key: 'images', label: 'Entity images', ways: ['keep', 'blur', 'placeholder'],
      tip: 'Scene covers, and performer, studio, tag and group images: blurred as Blur Strength says, or ' +
        'replaced by a plain card naming the entity. Neither is recorded in Undo History or undone here.' },
  ];
  // **Never change**, where Keep is not the same thing: under Vanillify a kept value still has its Explicit Terms
  // rewritten, and these are the kinds holding words. Custom field names had it first, as Never rename.
  var NEVER = ['names', 'text', 'fields', 'facts', 'filters', 'files'];
  CATEGORIES.forEach(function (c) {
    if (NEVER.indexOf(c.key) === -1) return;
    c.ways = c.ways.concat('never');
    c.tip += ' ' + ((c.labels || {}).never || 'Never change') + ' leaves them as they are whatever the goals say - Vanillify\'s explicit terms included.';
  });
  var CAT = {};
  CATEGORIES.forEach(function (c) { CAT[c.key] = c; });
  // Removals are a kind of their own in the filters, and no rule: what is removed is chosen by tag.
  CAT.remove = { key: 'remove', label: 'Removals' };

  // How much a removal deletes: the library entry, its generated files too, or the media too.
  var REMOVE_DELETES = {
    entries: { label: 'Library entries only', generated: false, files: false },
    generated: { label: 'Entries and generated files', generated: true, files: false },
    files: { label: 'Entries, generated and media files', generated: true, files: true },
  };
  function deletesOf(v) { return hasOwn(REMOVE_DELETES, v) ? v : DEFAULTS.e2RemoveDeletes; }
  var WAY_LABEL = { auto: 'As the goals say', keep: 'Keep', blank: 'Blank', placeholder: 'Placeholder',
    pseudonym: 'Pseudonym', random: 'Random words', blur: 'Blur', never: 'Never change' };
  // A kind may name a treatment its own way: a made-up URL is a pseudo-link, not a name.
  function wayLabelOf(c, w) { return (c && c.labels && c.labels[w]) || WAY_LABEL[w]; }
  function wayLabel(cat, w) { return wayLabelOf(CAT[cat], w); }

  // What Anonymize asks of each kind; Vanillify alone keeps everything and rewrites words.
  // A real face identifies, so Anonymize replaces an image; Vanillify alone blurs it.
  var ANONYMIZE = { names: 'pseudonym', text: 'blank', links: 'pseudonym', fields: 'pseudonym',
    facts: 'blank', dates: 'blank', ratings: 'keep', filters: 'pseudonym', images: 'placeholder', files: 'pseudonym',
    fieldnames: 'keep' };
  var VANILLIFY = { images: 'blur' };

  function presetOf(goals, cat) {
    if (goals.anonymize) return ANONYMIZE[cat];
    return goals.vanillify && VANILLIFY[cat] ? VANILLIFY[cat] : 'keep';
  }
  // Shown after a rule's box: the treatment "As the goals say" stands for now, and whether Vanillify
  // rewrites the Explicit Terms in what the rule leaves of the original words - all of them but
  // blanked, random or placeholder values, which leave none, and the kinds that hold no words (a URL's
  // words are its address); and on links, that anything but keep removes the stash-ids.
  var NO_WORDS = { images: 1, ratings: 1, dates: 1, links: 1, blank: 1, random: 1, placeholder: 1, never: 1 };
  function autoNote(way, goals, cat) {
    var w = way === 'auto' ? presetOf(goals, cat) : way;
    var tail = cat === 'links' ? (w !== 'keep' ? 'stash-ids removed' : '')
      : goals.vanillify && !NO_WORDS[cat] && !NO_WORDS[w] ? 'explicit terms rewritten' : '';
    if (way !== 'auto') return tail;
    return '→ ' + wayLabel(cat, w) + (tail ? ', ' + tail : '');
  }

  // The goals and rules a run starts with, read off the settings; a rule of "auto" follows the goals.
  function rulesFrom(st) {
    var r = { goals: { anonymize: !!st.a1Anonymize, vanillify: !!st.a2Vanillify }, ways: {}, types: {} };
    RULE_KEYS.forEach(function (k) {
      var v = st[k[0]];
      if (v && v !== 'auto' && CAT[k[1]].ways.indexOf(v) !== -1) r.ways[k[1]] = v;
    });
    TYPE_KEYS.forEach(function (t) { r.types[t[1]] = st[t[0]] !== false; });   // absent is the default, on
    return r;
  }
  // And back, for Save as Defaults.
  function settingsFrom(r) {
    var out = { a1Anonymize: !!r.goals.anonymize, a2Vanillify: !!r.goals.vanillify };
    RULE_KEYS.forEach(function (k) { out[k[0]] = r.ways[k[1]] || 'auto'; });
    TYPE_KEYS.forEach(function (t) { out[t[0]] = r.types[t[1]] !== false; });
    return out;
  }

  // The treatment a kind of data gets: its own rule, else what the goals ask.
  function wayOf(r, cat) {
    return r.ways[cat] || presetOf(r.goals, cat);
  }

  // Under Anonymize, the kinds whose rule still leads back to the originals, each with why. Kept
  // text is the one a reader can search for: a synopsis or a title is published text, and
  // Vanillify's rewording is reversible on purpose - each term has a replacement of its own.
  var LEAKS = {
    names: { keep: 'kept as they are', never: 'never changed' },
    text: { keep: 'kept as it is', never: 'never changed', pseudonym: 'its words are kept, so a synopsis can be searched online - ' +
      'Vanillify\'s rewording undone' },
    links: { keep: 'kept, and each URL names the original' },
    fields: { keep: 'kept as they are', never: 'never changed' },
    facts: { keep: 'kept as they are', never: 'never changed' },
    dates: { keep: 'kept, and with a studio a date narrows a scene down' },
    filters: { keep: 'kept, the real names in their criteria with them', never: 'never changed, the real names in their criteria with them' },
    files: { keep: 'kept as they are', never: 'never renamed' },
    images: { keep: 'kept, and a cover can be found by a reverse image search' },
  };
  function leaksOf(r) {
    if (!r.goals.anonymize) return [];
    return CATEGORIES.filter(function (c) { return LEAKS[c.key] && LEAKS[c.key][wayOf(r, c.key)]; })
      .map(function (c) { return c.label + ' (' + LEAKS[c.key][wayOf(r, c.key)] + ')'; });
  }

  // ── The exclusions ────────────────────────────────────────────────────────
  //
  // A tag by its own name, as `resolveExclusions` found it from the setting's name or alias, carried
  // directly (a marker's primary tag counts), and a custom field by its presence alone. A tag is never carried by a tag, so the two exclusion
  // tags leave themselves alone - renamed to a pseudonym, they would stop excluding.
  function exclusionsOf(st) {
    return { entityTag: trim(st.h1ExcludeEntityWithTagName), entityField: trim(st.h2ExcludeEntityWithCustomFieldName),
      imageTag: trim(st.h3ExcludeImageWithTagName), imageField: trim(st.h4ExcludeImageWithCustomFieldName),
      ownedTag: C.ownedTags(st.others) };
  }
  function carries(typeKey, ent, name) {
    if (!name) return false;
    if (typeKey === 'tags') return false;
    if (ent.primary_tag && ent.primary_tag.name === name) return true;
    return (ent.tags || []).some(function (t) { return t && t.name === name; });
  }
  function holds(ent, field) { return !!field && !!ent.custom_fields && typeof ent.custom_fields === 'object' && hasOwn(ent.custom_fields, field); }
  // 'entity', 'image' or null.
  function exclusionOf(x, typeKey, ent) {
    if (typeKey === 'tags' && (ent.name === x.entityTag || ent.name === x.imageTag) && ent.name) return 'entity';
    // A tag another plugin's setting names - or this one's - keeps its name: renamed, the setting names nothing.
    if (typeKey === 'tags' && x.ownedTag && x.ownedTag(ent)) return 'entity';
    if (carries(typeKey, ent, x.entityTag) || holds(ent, x.entityField)) return 'entity';
    if (carries(typeKey, ent, x.imageTag) || holds(ent, x.imageField)) return 'image';
    return null;
  }

  // ── Explicit terms ────────────────────────────────────────────────────────
  //
  // One term a line, `term = replacement`, or a term alone to remove it; a line opening with #
  // is a note. A term may be several words: between them a space, a dash, an underscore, a dot -
  // or nothing at all - is the same term, so `blow job` also finds `blow-job`, `blow_job.mp4` and
  // `blowjob`, and a regular plural (-s, -es) is found with it. A term ending in `+` is a verb: under
  // English its -ing and -ed forms are found too, `lick+ = taste` making `licking` into `tasting`.
  // Terms that differ only in those are one term; the editor marks the one listed twice.
  // Each with a replacement of its own, so a run's text still says which term was there.
  // The default list is not in this file: `default-terms.gen.js`, generated from
  // `default-terms.src.yaml` and loaded before this script, puts it on the shared object.
  function defaultTerms() { var ns = window.__GTTx__; return (ns && ns.dspDefaultTerms) || ''; }

  // [{ from, to }] from the stored lines.
  function parseTerms(text) {
    var out = [], seen = {};
    String(text == null ? '' : text).split('\n').forEach(function (line) {
      var t = trim(line);
      if (!t || t.charAt(0) === '#') return;
      var i = t.indexOf('=');
      var from = trim(i === -1 ? t : t.slice(0, i)), to = i === -1 ? '' : trim(t.slice(i + 1));
      if (!from || hasOwn(seen, from.toLowerCase())) return;
      seen[from.toLowerCase()] = true;
      out.push({ from: from, to: to });
    });
    return out;
  }
  // A term as the stored list can hold it: one line, no `=` in the term (the separator), no `#` to start
  // it (a note). Applied to every term the editor stores or a file brings in.
  function storableTerm(t) {
    var flat = function (v) { return trim(String(v == null ? '' : v).replace(/[\r\n]+/g, ' ')); };
    return { from: trim(flat(t.from).replace(/=/g, ' ').replace(/^#+/, '')), to: flat(t.to) };
  }
  function formatTerms(list) {
    return list.map(function (t) { return t.from + (t.to ? ' = ' + t.to : ''); }).join('\n');
  }

  // One pattern for the whole list, longest term first; what it finds is looked up by its words,
  // whatever joined them, and with a plural ending taken off when the term itself has none.
  // Between a term's words, any run of space, dash, underscore and dot - or none.
  var SEP = '[\\s_.\\-]*';
  function termKey(s) { return String(s).toLowerCase().replace(/\+\s*$/, '').split(/[\s_.\-]+/).filter(Boolean).join(''); }
  // Plural Rules: how a language makes a plural, as data, so another language is a table here and
  // not code. `endings` are what a plural puts in place of a singular's ending - a term is found in
  // each form, and a plural found takes its replacement in the plural; `plural` makes that from the
  // replacement's last word, an irregular word first. None finds a term only as written: every plural
  // is a term of its own. A plural listed as a term always wins, being found as written.
  var PLURALS = {
    english: {
      label: 'English',
      endings: [['ies', 'y'], ['es', ''], ['s', '']],
      irregular: { man: 'men', woman: 'women', person: 'people', child: 'children', foot: 'feet', tooth: 'teeth' },
      plural: [[/([^aeiou])y$/i, '$1ies'], [/(s|x|z|ch|sh)$/i, '$1es'], [/$/, 's']],
      verb: englishVerb,
    },
    none: { label: 'None - Plurals must be specified', endings: [], irregular: {}, plural: [], verb: null },
  };
  // A regular English verb's `end` (ing, ed) form: `shove` shoving, shoved; `cry` crying, cried; `tie`
  // tying; a short word ending vowel-consonant doubles it, `clap` clapping. `find` gives every spelling a
  // text may use - the doubled one too after any vowel-consonant, `cum` cumming - else the one a
  // replacement takes.
  // ponytail: regular verbs only - an irregular replacement (fall, go) reads wrong; list its forms as terms.
  function englishVerb(word, end, find) {
    var low = word.toLowerCase(), one = function (dbl) {
      var w = word + (dbl ? word.slice(-1) : '');
      if (end === 'ing') return /ie$/.test(low) ? word.slice(0, -2) + 'ying' : /[^e]e$/.test(low) ? word.slice(0, -1) + 'ing' : w + 'ing';
      return /e$/.test(low) ? word + 'd' : /[^aeiou]y$/.test(low) ? word.slice(0, -1) + 'ied' : w + 'ed';
    };
    if (!find) return one(/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(low));
    return /[aeiou][^aeiouwxy]$/.test(low) ? [one(false), one(true)] : [one(false)];
  }
  function verbOf(rules, phrase, end) {
    var m = /^(.*?)([^\s]+)$/.exec(phrase);
    return m ? m[1] + rules.verb(m[2], end) : phrase;
  }
  var PLURAL_KEYS = ['english', 'none'];
  function pluralsOf(lang) { return PLURALS[lang] || PLURALS[DEFAULTS.f2Plurals]; }
  function pluralOf(rules, phrase) {
    var m = /^(.*?)([^\s]+)$/.exec(phrase);
    if (!m) return phrase;
    var word = m[2], low = word.toLowerCase(), irr = rules.irregular[low];
    if (irr) return m[1] + (word === low ? irr : caseLike(word, irr));
    for (var i = 0; i < rules.plural.length; i++) {
      if (rules.plural[i][0].test(word)) return m[1] + word.replace(rules.plural[i][0], rules.plural[i][1]);
    }
    return phrase;
  }

  // The terms as a table: a pattern piece per term, and `lookup`, which answers a phrase found - by its
  // words run together, a plural ending taken off where the term has none - with its replacement ('' to
  // remove it), or null for no term. The replacement below and `apiTerms` share it.
  function termTable(terms, lang) {
    var rules = pluralsOf(lang), map = {}, verbs = {}, list = [];
    terms.forEach(function (t) {
      var verb = rules.verb && /\+\s*$/.test(t.from);
      var words = String(t.from).toLowerCase().replace(/\+\s*$/, '').split(/[\s_.\-]+/).filter(Boolean), k = words.join('');
      if (!k || hasOwn(map, k)) return;
      map[k] = t.to;
      // The last word in each form the plural rules give it.
      var last = words[words.length - 1], forms = [escapeRe(last)];
      rules.endings.forEach(function (e) {
        if (last.slice(last.length - e[1].length) === e[1]) forms.push(escapeRe(last.slice(0, last.length - e[1].length) + e[0]));
      });
      // A verb's -ing and -ed forms, each remembered with its term and ending for `lookup`.
      if (verb) ['ing', 'ed'].forEach(function (end) {
        rules.verb(last, end, true).forEach(function (f) {
          var fk = k.slice(0, k.length - last.length) + f;
          if (!hasOwn(verbs, fk)) verbs[fk] = { base: k, end: end };
          forms.push(escapeRe(f));
        });
      });
      var head = words.slice(0, -1).map(escapeRe);
      list.push({ key: k, re: head.concat(forms.length > 1 ? '(?:' + forms.join('|') + ')' : forms[0]).join(SEP) });
    });
    // The replacement: as listed for a term found as written, made plural for a plural of one.
    function lookup(found) {
      var k = termKey(found);
      if (hasOwn(map, k)) return map[k];
      if (hasOwn(verbs, k)) { var v = verbs[k], to = map[v.base]; return to ? verbOf(rules, to, v.end) : to; }
      for (var i = 0; i < rules.endings.length; i++) {
        var e = rules.endings[i];
        if (k.slice(k.length - e[0].length) !== e[0]) continue;
        var one = k.slice(0, k.length - e[0].length) + e[1];
        if (hasOwn(map, one)) return map[one] ? pluralOf(rules, map[one]) : map[one];
      }
      return null;
    }
    return { list: list, lookup: lookup };
  }

  function termReplacer(terms, lang) {
    // Looked up by its words run together, matched by its words with anything or nothing between them;
    // the longest term first, so `big tits` is found before `tits` and `anal sex` before `anal`.
    var table = termTable(terms, lang), list = table.list, lookup = table.lookup;
    if (!list.length) return null;
    list.sort(function (a, b) { return b.key.length - a.key.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0); });
    var re = new RegExp('(^|[^' + WORD_CHARS + '])(' + list.map(function (x) { return x.re; }).join('|') +
      ')(?=$|[^' + WORD_CHARS + '])', 'gi');
    return function (text) {
      if (typeof text !== 'string' || !text) return text;
      var out = text.replace(re, function (all, pre, found) {
        var to = lookup(found);
        return to == null ? all : pre + caseLike(found, to);
      });
      return out === text ? text : out.replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '');
    };
  }

  // ── Whole-word replacement ────────────────────────────────────────────────
  //
  // One pattern for a whole list, longest first, so a name inside a longer one is not
  // replaced inside it. A word character is a letter or digit of any script: `\b` knows
  // only ASCII, and a name like "Zoë" would otherwise end at the ë: Core's `wordChars`.
  var WORD_CHARS = C.wordChars;
  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // The names a run renames, found in free text by looking each run of words up in a table:
  // linear in the text's length however many names there are, where one pattern of every name
  // took longer with each and froze the tab on a large library. A name is found where its words
  // stand in the text as it is written, in any case, spaces, hyphens and underscores between them
  // read as one space ("Jane-Doe", "Jane  Doe"), and one period too ("Jane.Doe").
  //
  // A pair is [original, pseudonym, owner]: the owner (`p12`, a performer's id) is who the name is.
  // `rel` is who a text belongs to (`relOf`), so a single-word name - "Summer", "Angel", the words
  // a stage name is often made of - is replaced only in text related to its owner, unless `policy`
  // says Everywhere ('e') or Never ('n'), and only where it starts with a capital as the name does.
  // A name of several words is replaced everywhere; where two cross ("Mary Jane Doe"), the one
  // related to the text wins. A pair without an owner applies everywhere. `sink`, if given, hears
  // of every single-word name found: 'related', 'unrelated', or 'lower' where the capital is missing.
  // One name is an entry per kind of owner (`id`, the owner's letter and the name): a performer
  // "Summer" and a tag "Summer" each keep their own pseudonym and their own answer in `policy`, and
  // where both could apply, the one related to the text goes first.
  var WORD_RE = new RegExp('[' + WORD_CHARS + ']+', 'g');
  var GAP_RE = /^(?:[\s\-_]+|\.)$/;
  function gapOf(g) { return GAP_RE.test(g) ? ' ' : g; }
  function nameKey(s) {
    var out = '', last = -1, m;
    s = String(s).toLowerCase();
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(s)) !== null) {
      out += (last === -1 ? s.slice(0, m.index) : gapOf(s.slice(last, m.index))) + m[0];
      last = m.index + m[0].length;
    }
    return last === -1 ? s : out + s.slice(last);
  }
  function isCap(c) { return !!c && c !== c.toLowerCase() && c === c.toUpperCase(); }
  function namesReplacer(pairs, minLength, policy) {
    var map = {}, most = 0;
    pairs.forEach(function (p) {
      var k = nameKey(p[0]);
      if (k.length < (minLength || 1) || p[1] == null) return;
      var kind = p[2] ? String(p[2]).charAt(0) : '', list = hasOwn(map, k) ? map[k] : (map[k] = []);
      var e = list.filter(function (x) { return x.kind === kind; })[0];
      if (!e) {
        var n = (k.match(WORD_RE) || []).length;
        if (n > most) most = n;
        e = { id: kind + ':' + k, key: k, to: p[1], label: String(p[0]), single: n === 1, cap: isCap(String(p[0]).charAt(0)),
          owners: [], free: !kind, kind: kind, named: p[3] };
        list.push(e);
      }
      if (p[2]) e.owners.push(String(p[2]));
    });
    if (!most) return null;
    function related(e, rel) {
      if (!rel) return false;
      for (var i = 0; i < e.owners.length; i++) if (rel.indexOf(' ' + e.owners[i] + ' ') !== -1) return true;
      return false;
    }
    function applies(e, rel) {
      if (e.free) return true;
      var said = policy && hasOwn(policy, e.id) ? policy[e.id] : 'r';
      if (e.single && said === 'n') return false;
      return !e.single || said === 'e' || related(e, rel);
    }
    // `asNames`: each name replaced by what the Names rule makes of it (`named`, a pair's fourth),
    // where one is given - null leaves it as it is - rather than by its pseudonym.
    var fn = function (text, rel, sink, asNames) {
      if (typeof text !== 'string' || !text) return text;
      var toks = [], m;
      WORD_RE.lastIndex = 0;
      while ((m = WORD_RE.exec(text)) !== null) toks.push([m.index, m.index + m[0].length]);
      // The names starting at word i, shortest first.
      function at(i) {
        var found = [], key = '';
        for (var n = 1; n <= most && i + n <= toks.length; n++) {
          // Each word lowered on its own: lowering the whole text can change its length ("İ").
          key += (n > 1 ? gapOf(text.slice(toks[i + n - 2][1], toks[i + n - 1][0])) : '') +
            text.slice(toks[i + n - 1][0], toks[i + n - 1][1]).toLowerCase();
          // Tried from the end: an entry related to the text before one that is not.
          if (hasOwn(map, key)) {
            map[key].forEach(function (e) { if (!related(e, rel)) found.push([n, e]); });
            map[key].forEach(function (e) { if (related(e, rel)) found.push([n, e]); });
          }
        }
        return found;
      }
      // A name related to this text that starts inside words i..j and runs past them.
      function crossed(i, j) {
        for (var k = i + 1; k <= j; k++) {
          var c = at(k);
          for (var x = 0; x < c.length; x++) if (k + c[x][0] - 1 > j && related(c[x][1], rel)) return true;
        }
        return false;
      }
      var out = '', last = 0, i = 0;
      while (i < toks.length) {
        var found = at(i), hit = null, lower = !isCap(text.charAt(toks[i][0]));
        // Every entry found here is counted, before one is chosen: a word naming a tag and a
        // performer counts for both, or the one tried second is never asked about.
        if (sink) {
          for (var y = found.length - 1; y >= 0; y--) {
            var f = found[y][1];
            if (f.single && f.cap && lower) sink('lower', f, text, toks[i][0], toks[i][1]);
            else if (f.single && !f.free) sink(related(f, rel) ? 'related' : 'unrelated', f, text, toks[i][0], toks[i][1]);
          }
        }
        for (var x = found.length - 1; x >= 0 && !hit; x--) {
          var e = found[x][1], n = found[x][0];
          if (e.single && e.cap && lower) continue;
          if (!applies(e, rel)) continue;
          if (asNames && e.named === null) continue;
          if (n > 1 && rel && !e.free && !related(e, rel) && crossed(i, i + n - 1)) break;
          hit = found[x];
        }
        if (!hit) { i++; continue; }
        out += text.slice(last, toks[i][0]) + (asNames && hit[1].named !== undefined ? hit[1].named : hit[1].to);
        last = toks[i + hit[0] - 1][1];
        i += hit[0];
      }
      return last ? out + text.slice(last) : text;
    };
    fn.entries = map;
    return fn;
  }

  // Work over a long list in slices, handing the browser back its turn between them: a scan's
  // planning must not hold the tab past the point where the browser calls it unresponsive.
  var SLICE = 250;
  function inSlices(list, fn) {
    return new Promise(function (resolve, reject) {
      var at = 0;
      (function next() {
        try {
          var end = Math.min(list.length, at + SLICE);
          for (; at < end; at++) fn(list[at], at);
        } catch (e) { reject(e); return; }
        if (at >= list.length) resolve(); else setTimeout(next, 0);
      }());
    });
  }

  // The replacement in the case the word was written in: all capitals, a capital first, or as typed.
  function caseLike(word, to) {
    if (!to) return to;
    if (word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase()) return to.toUpperCase();
    if (word.charAt(0) !== word.charAt(0).toLowerCase()) return to.charAt(0).toUpperCase() + to.slice(1);
    return to;
  }

  // ── Pseudonyms ────────────────────────────────────────────────────────────
  //
  // The salt is the one random value here (repo-root AGENTS.md, rule 11): made once per
  // library, the first time a run needs it, and stored by its first Proceed.
  function makeSalt() {
    var hex = '', i;
    var cr = window.crypto || window.msCrypto;
    if (cr && cr.getRandomValues) {
      var a = new Uint32Array(4);
      cr.getRandomValues(a);
      for (i = 0; i < a.length; i++) hex += ('00000000' + a[i].toString(16)).slice(-8);
      return hex;
    }
    for (i = 0; i < 4; i++) hex += ('00000000' + Math.floor(Math.random() * 4294967296).toString(16)).slice(-8);
    return hex;
  }

  // cyrb53: 53 bits from a string and a seed.
  // ponytail: a fast mixing hash, not a cryptographic one - enough that a pseudonym cannot be
  // looked up without the salt; an HMAC is the upgrade if the salt ever has to stand up to more.
  function hash53(str, seed) {
    var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  // Names come from four lists of 256 words, a space of 65,536 for each name kind, so a library of
  // thousands of names and aliases rarely shares one. The first 64 of each are the lists a
  // pseudonym was made from before: `LEGACY` keeps recognizing those by their shape, and titles,
  // values and URLs - no record, no need to be unique - are still made from them.
  var FIRST = ['Avery', 'Blake', 'Carmen', 'Dana', 'Eden', 'Flynn', 'Gale', 'Harper', 'Indigo', 'Jules',
    'Kai', 'Lane', 'Morgan', 'Nico', 'Oakley', 'Parker', 'Quinn', 'Reese', 'Sage', 'Tatum', 'Umber', 'Vale',
    'Wren', 'Xan', 'Yael', 'Zuri', 'Arden', 'Briar', 'Cove', 'Dorian', 'Ellis', 'Fern', 'Greer', 'Hollis',
    'Ione', 'Jory', 'Kit', 'Lark', 'Marlo', 'Noel', 'Onyx', 'Perry', 'Rory', 'Sloane', 'Teagan', 'Uma',
    'Vesper', 'Winter', 'Yarrow', 'Zephyr', 'Ash', 'Bay', 'Cass', 'Darcy', 'Emery', 'Frankie', 'Gray',
    'Hayden', 'Isla', 'Jessie', 'Kendall', 'Lou', 'Milan', 'Nova', 'Adair', 'Aiden', 'Alder', 'Alvie',
    'Amari', 'Andie', 'Ansel', 'Arlo', 'Aster', 'Aubrey', 'Auden', 'Azalea', 'Bastian', 'Bellamy', 'Benji',
    'Bexley', 'Bodhi', 'Brennan', 'Bryce', 'Caelan', 'Calloway', 'Camden', 'Carey', 'Carrick', 'Caspian',
    'Cedar', 'Channing', 'Clove', 'Colby', 'Corin', 'Cyan', 'Dakota', 'Dale', 'Dallas', 'Damon', 'Darian',
    'Delaney', 'Devon', 'Dorsey', 'Drew', 'Dune', 'Eamon', 'Easton', 'Elian', 'Elliot', 'Ember', 'Emerson',
    'Ennis', 'Evren', 'Ezra', 'Fallon', 'Farley', 'Fenn', 'Finch', 'Finlay', 'Fleur', 'Florin', 'Ford',
    'Galen', 'Garnet', 'Gentry', 'Glen', 'Gwyn', 'Hadley', 'Halden', 'Harlow', 'Haven', 'Hayes', 'Heath',
    'Huxley', 'Ira', 'Ivo', 'Jade', 'Jarrah', 'Jensen', 'Joss', 'Jovie', 'Juniper', 'Kael', 'Karsten',
    'Keaton', 'Kenzie', 'Kestrel', 'Kiran', 'Koda', 'Kyle', 'Laken', 'Landry', 'Larkin', 'Laurel',
    'Leighton', 'Lennox', 'Linden', 'Logan', 'Loren', 'Lyric', 'Mace', 'Maddox', 'Maren', 'Marley', 'Mason',
    'Merritt', 'Micah', 'Miro', 'Monroe', 'Nash', 'Navy', 'Nell', 'Niven', 'Nolan', 'Oaklyn', 'Odell',
    'Olin', 'Orion', 'Osric', 'Paxton', 'Payton', 'Penn', 'Phoenix', 'Pike', 'Piper', 'Presley', 'Quill',
    'Raine', 'Ramsey', 'Rayne', 'Reagan', 'Remy', 'Rhett', 'Ridley', 'Riley', 'Ripley', 'River', 'Roan',
    'Robin', 'Rowan', 'Rumi', 'Ryder', 'Salem', 'Sawyer', 'Scout', 'Selby', 'Shay', 'Shiloh', 'Sky', 'Soren',
    'Spencer', 'Sterling', 'Story', 'Sutton', 'Sydney', 'Tamsin', 'Tarquin', 'Teal', 'Thea', 'Tobin', 'Toby',
    'Torin', 'Tristan', 'Tully', 'Tyne', 'Valen', 'Vaughn', 'Velan', 'Verity', 'Wade', 'Wallis', 'Ward',
    'Waverly', 'Wells', 'Weston', 'Whit', 'Wilder', 'Willa', 'Wynn', 'Yale', 'Yardley', 'Yves', 'Zade',
    'Zander', 'Zayne', 'Zeal', 'Zion', 'Zora', 'Alby', 'Bram', 'Cale', 'Daxon', 'Elm', 'Fife', 'Gilly',
    'Hart'];
  var LAST = ['Ashby', 'Brooks', 'Calder', 'Dunmore', 'Ellery', 'Fairley', 'Garrow', 'Hale', 'Ingram',
    'Jessop', 'Kerrow', 'Lindell', 'Marsh', 'Northcote', 'Oakes', 'Pellow', 'Quill', 'Rowe', 'Sefton',
    'Thorne', 'Upton', 'Vance', 'Wilder', 'Yates', 'Abbot', 'Barlow', 'Crane', 'Darrow', 'Everly', 'Fenwick',
    'Grove', 'Hollins', 'Ives', 'Keene', 'Lyle', 'Mercer', 'Nash', 'Orme', 'Prior', 'Radley', 'Stroud',
    'Tilney', 'Underwood', 'Verity', 'Wakely', 'Ashdown', 'Bellamy', 'Corbett', 'Dale', 'Eastwood',
    'Fleming', 'Gilchrist', 'Hartley', 'Irwin', 'Jarvis', 'Kingsley', 'Lockwood', 'Mayfield', 'Norwood',
    'Overton', 'Penrose', 'Redfern', 'Somerby', 'Thackery', 'Aldren', 'Alnwick', 'Amberley', 'Ansley',
    'Appleby', 'Arbery', 'Ashcombe', 'Atherton', 'Aysgarth', 'Bainbridge', 'Balcombe', 'Barnaby', 'Beckett',
    'Belford', 'Bexhill', 'Bickford', 'Blackmore', 'Blakeney', 'Bletchley', 'Bodmin', 'Borrow', 'Boscombe',
    'Bramley', 'Brandreth', 'Braxton', 'Brightwell', 'Brockley', 'Bromwich', 'Burnell', 'Buxton', 'Cadwell',
    'Calloway', 'Camber', 'Carden', 'Carlow', 'Catterick', 'Chadwick', 'Chalcott', 'Charnley', 'Chesney',
    'Chilcott', 'Clayborne', 'Clifton', 'Colston', 'Coniston', 'Cranley', 'Crawley', 'Crofton', 'Dacre',
    'Danvers', 'Dashwood', 'Davenport', 'Delamere', 'Denholm', 'Dewhurst', 'Dorrell', 'Draycott', 'Dunstan',
    'Eardley', 'Elkington', 'Elmore', 'Elsworth', 'Emberton', 'Endicott', 'Farleigh', 'Fawley', 'Fenby',
    'Fernley', 'Finchley', 'Fitton', 'Follett', 'Fordham', 'Foxley', 'Garside', 'Gatley', 'Gilsland',
    'Glaister', 'Goring', 'Grantley', 'Greaves', 'Gresley', 'Hadleigh', 'Halloway', 'Hambly', 'Harcourt',
    'Harwood', 'Hasting', 'Hatherley', 'Hawksley', 'Hayworth', 'Hemsley', 'Heywood', 'Hilliard', 'Holbrook',
    'Hornsby', 'Hurley', 'Ilsley', 'Inchley', 'Ingleby', 'Jessamy', 'Kemble', 'Kendrew', 'Kenley',
    'Kettering', 'Kilbride', 'Kimber', 'Kirkby', 'Knighton', 'Lacey', 'Lambert', 'Langley', 'Larkham',
    'Latimer', 'Lawley', 'Leighton', 'Linley', 'Littleton', 'Loxley', 'Ludlow', 'Lyndon', 'Maddox',
    'Malvern', 'Marlowe', 'Melbury', 'Merriman', 'Milbourne', 'Moberly', 'Montague', 'Morland', 'Mowbray',
    'Netherby', 'Newbold', 'Norbury', 'Oakley', 'Ockley', 'Oldfield', 'Ormsby', 'Paget', 'Palmer', 'Parkin',
    'Pemberton', 'Pendle', 'Percival', 'Pickering', 'Plumley', 'Portland', 'Prescott', 'Quarrell',
    'Rainford', 'Ravensworth', 'Redmayne', 'Ripley', 'Rockley', 'Rosser', 'Rushton', 'Sackville', 'Saltash',
    'Sandford', 'Scarsdale', 'Selwyn', 'Shawcross', 'Sherwood', 'Shipley', 'Sinclair', 'Skelton', 'Snowden',
    'Stanmore', 'Stirling', 'Stoneley', 'Sutcliffe', 'Swinton', 'Talbot', 'Tamworth', 'Tarrant', 'Tennant',
    'Thursby', 'Tolley', 'Tremaine', 'Tunstall', 'Ufford', 'Varley', 'Wainwright', 'Walsham', 'Warburton',
    'Waverley', 'Wedmore', 'Westbrook', 'Whitcombe', 'Whitley', 'Wickham', 'Winslow', 'Woodley'];
  var ADJ = ['Amber', 'Brisk', 'Calm', 'Distant', 'Early', 'Faded', 'Gentle', 'Hidden', 'Idle', 'Jade',
    'Kind', 'Lucid', 'Mellow', 'Northern', 'Open', 'Pale', 'Quiet', 'Rustic', 'Silver', 'Tidal', 'Upper',
    'Velvet', 'Western', 'Young', 'Azure', 'Bright', 'Coral', 'Dusky', 'Even', 'Fleet', 'Golden', 'Hazel',
    'Ivory', 'Jolly', 'Keen', 'Linen', 'Misty', 'Noble', 'Olive', 'Plain', 'Rapid', 'Sunny', 'Tender',
    'Urban', 'Vivid', 'Warm', 'Autumn', 'Bold', 'Clear', 'Deep', 'Eastern', 'Fair', 'Green', 'High', 'Inner',
    'Little', 'Mild', 'New', 'Outer', 'Proud', 'Round', 'Still', 'True', 'Wide', 'Airy', 'Ancient', 'Arched',
    'Ashen', 'Balmy', 'Blazing', 'Blessed', 'Blue', 'Breezy', 'Brimming', 'Broad', 'Bronze', 'Burnished',
    'Candid', 'Carved', 'Cedar', 'Charmed', 'Cheerful', 'Chosen', 'Civic', 'Classic', 'Cloudy', 'Cobalt',
    'Cosy', 'Crimson', 'Crisp', 'Crystal', 'Curious', 'Dappled', 'Daring', 'Dawn', 'Dewy', 'Dreamy', 'Dry',
    'Dusty', 'Dutiful', 'Eager', 'Elder', 'Emerald', 'Endless', 'Eternal', 'Fabled', 'Fearless', 'Fern',
    'Fiery', 'Final', 'First', 'Floral', 'Foggy', 'Fond', 'Forest', 'Free', 'Fresh', 'Frosty', 'Gilded',
    'Glad', 'Gleaming', 'Glossy', 'Grand', 'Granite', 'Grateful', 'Hallowed', 'Happy', 'Hardy', 'Harmonic',
    'Hearty', 'Hollow', 'Honest', 'Humble', 'Icy', 'Indigo', 'Iron', 'Jasper', 'Jovial', 'Lasting',
    'Lavender', 'Lazy', 'Leafy', 'Light', 'Lilac', 'Lively', 'Lofty', 'Lone', 'Lucky', 'Lunar', 'Lush',
    'Magic', 'Majestic', 'Maple', 'Marble', 'Meadow', 'Merry', 'Midnight', 'Mighty', 'Modest', 'Molten',
    'Mossy', 'Mystic', 'Narrow', 'Native', 'Neat', 'Nimble', 'Oaken', 'Old', 'Opal', 'Orange', 'Painted',
    'Patient', 'Pearl', 'Peaceful', 'Pine', 'Placid', 'Polar', 'Polished', 'Primal', 'Prime', 'Pure',
    'Radiant', 'Rainy', 'Rare', 'Regal', 'Restful', 'Rich', 'Rising', 'Roaming', 'Rosy', 'Royal', 'Ruby',
    'Rugged', 'Sacred', 'Saffron', 'Sage', 'Salty', 'Sandy', 'Scarlet', 'Secret', 'Serene', 'Shady', 'Sharp',
    'Shining', 'Simple', 'Sleepy', 'Slender', 'Smoky', 'Snowy', 'Soft', 'Solar', 'Solid', 'Sparkling',
    'Spiral', 'Stable', 'Starry', 'Steady', 'Stony', 'Stormy', 'Strong', 'Sturdy', 'Sublime', 'Summer',
    'Supple', 'Swift', 'Tall', 'Tawny', 'Thrifty', 'Timber', 'Tranquil', 'Twilight', 'Twin', 'Umber',
    'Unseen', 'Vast', 'Verdant', 'Violet', 'Vital', 'Wandering', 'Wary', 'Wild', 'Windy', 'Winter', 'Wise',
    'Wistful', 'Woven', 'Zesty', 'Aqua', 'Bonny', 'Copper', 'Ebony', 'Flint', 'Honey', 'Lemon', 'Mint',
    'Ochre'];
  var NOUN = ['Harbor', 'Meadow', 'Lantern', 'River', 'Orchard', 'Valley', 'Summit', 'Garden', 'Bridge',
    'Canyon', 'Delta', 'Field', 'Grove', 'Haven', 'Island', 'Jetty', 'Knoll', 'Lake', 'Marsh', 'Nest',
    'Oasis', 'Pier', 'Quarry', 'Ridge', 'Shore', 'Trail', 'Upland', 'Vista', 'Willow', 'Yard', 'Arbor',
    'Bay', 'Cliff', 'Dune', 'Estate', 'Forest', 'Glen', 'Hollow', 'Inlet', 'Junction', 'Kiln', 'Ledge',
    'Mill', 'Noon', 'Outpost', 'Path', 'Reef', 'Spring', 'Tower', 'Union', 'Village', 'Wharf', 'Acre',
    'Beacon', 'Cottage', 'Dell', 'Ember', 'Fountain', 'Gate', 'Heath', 'Inn', 'Lodge', 'Moor', 'Pond',
    'Abbey', 'Alley', 'Anchor', 'Archway', 'Atlas', 'Aviary', 'Badge', 'Balcony', 'Bank', 'Barn', 'Basin',
    'Bastion', 'Bell', 'Bluff', 'Boardwalk', 'Bough', 'Boulder', 'Bower', 'Brook', 'Burrow', 'Cabin',
    'Cairn', 'Canal', 'Cape', 'Castle', 'Cavern', 'Cellar', 'Chapel', 'Chimney', 'Citadel', 'Clearing',
    'Cloister', 'Coast', 'Compass', 'Copse', 'Corner', 'Cove', 'Crag', 'Creek', 'Crest', 'Crossing', 'Crown',
    'Current', 'Dale', 'Dam', 'Dock', 'Dome', 'Dovecote', 'Draw', 'Esplanade', 'Falls', 'Farm', 'Fen',
    'Ferry', 'Fjord', 'Flats', 'Fold', 'Ford', 'Forge', 'Fort', 'Furrow', 'Gable', 'Gallery', 'Garrison',
    'Geyser', 'Glade', 'Gorge', 'Granary', 'Gulch', 'Gully', 'Hamlet', 'Harbour', 'Hearth', 'Hedge', 'Helm',
    'Highland', 'Hill', 'Hive', 'Holt', 'Horizon', 'Hub', 'Isle', 'Keep', 'Kingdom', 'Lagoon', 'Landing',
    'Lane', 'Lea', 'Lighthouse', 'Loft', 'Loop', 'Manor', 'Market', 'Mesa', 'Mire', 'Moat', 'Monument',
    'Mound', 'Mountain', 'Nook', 'Observatory', 'Orbit', 'Outlook', 'Paddock', 'Palace', 'Pasture',
    'Pavilion', 'Peak', 'Plain', 'Plateau', 'Plaza', 'Point', 'Portal', 'Prairie', 'Promenade', 'Quay',
    'Rampart', 'Range', 'Rapids', 'Rise', 'Rock', 'Row', 'Run', 'Sanctuary', 'Savanna', 'Shelter', 'Shire',
    'Shoal', 'Signal', 'Slope', 'Sound', 'Spire', 'Square', 'Stable', 'Stair', 'Station', 'Steppe', 'Stone',
    'Strand', 'Stream', 'Street', 'Studio', 'Summerhouse', 'Tarn', 'Terrace', 'Thicket', 'Tide',
    'Timberland', 'Torrent', 'Trellis', 'Tundra', 'Tunnel', 'Turret', 'Vale', 'Vault', 'Veranda', 'Viaduct',
    'View', 'Vineyard', 'Walk', 'Wall', 'Ward', 'Watch', 'Waterfall', 'Way', 'Weald', 'Well', 'Wilds',
    'Wood', 'Workshop', 'Arcade', 'Bayou', 'Bend', 'Brae', 'Burn', 'Causeway', 'Combe', 'Downs', 'Fell',
    'Firth', 'Garth', 'Pinnacle', 'Rookery', 'Sawmill', 'Spinney', 'Tollgate', 'Weir', 'Wicket', 'Belfry',
    'Mews', 'Hayloft', 'Boathouse'];
  var STUDIO_END = ['Studios', 'Pictures', 'Media', 'Films', 'Productions', 'Works', 'House', 'Collective'];
  var LEGACY = { FIRST: FIRST.slice(0, 64), LAST: LAST.slice(0, 64), ADJ: ADJ.slice(0, 64), NOUN: NOUN.slice(0, 64) };

  function pick(list, n) { return list[n % list.length]; }

  // The made-up value for `value` of kind `kind`, before any collision is settled. `attempt` is the
  // try: a clash is tried again with another hash before it settles for an initial or a number.
  function inventFor(salt, kind, value, attempt) {
    var h = hash53(kind + '\u0001' + String(value) + (attempt ? '\u0002' + attempt : ''), hash53(salt, 7) % 4294967296);
    var a = Math.floor(h / 65536), b = Math.floor(a / 256);
    switch (kind) {
      case 'person': return pick(FIRST, h) + ' ' + pick(LAST, Math.floor(h / 256));
      case 'studio': return pick(ADJ, h) + ' ' + pick(NOUN, Math.floor(h / 256)) + ' ' + pick(STUDIO_END, a);
      case 'group': return 'The ' + pick(ADJ, h) + ' ' + pick(NOUN, Math.floor(h / 256));
      case 'tag': return pick(ADJ, h) + ' ' + pick(NOUN, Math.floor(h / 256));
      case 'filter': return 'Filter: ' + pick(ADJ, h) + ' ' + pick(NOUN, Math.floor(h / 256));
      case 'url': return 'https://example.invalid/' + h.toString(36);
      case 'value': return pick(LEGACY.ADJ, h).toLowerCase() + '-' + pick(LEGACY.NOUN, Math.floor(h / 4096)).toLowerCase();
      default: return pick(LEGACY.ADJ, h) + ' ' + pick(LEGACY.NOUN, Math.floor(h / 4096)) + ' ' + (100 + (b % 900));
    }
  }

  // What a run remembers of a name pseudonym it wrote: 30 bits of it, in this plugin's settings
  // (`z2Written`), so the next run and the final check know it exactly - a real name that happens
  // to read like one is not taken for one. About 6 characters a name.
  // In the record, the mark of a library whose first run came after the record: none of its names is
  // from the 64-word lists, so their shape proves nothing there - "Kit Mercer" stays a real name.
  var NO_LEGACY = '!';
  function writtenKey(kind, value) { return (hash53(kind + '\u0001' + String(value).toLowerCase(), 11) % 1073741824).toString(36); }
  // A random name's key in the same record: all 53 bits, since random letters have no shape to
  // check a chance match against, and an 'r' before them.
  function randomKey(kind, value) { return 'r' + hash53('random\u0001' + kind + '\u0001' + String(value).toLowerCase(), 11).toString(36); }
  function parseWritten(text) {
    var out = {};
    String(text || '').split(/\s+/).forEach(function (k) { if (k) out[k] = true; });
    return out;
  }

  // Whether `value` is already a pseudonym of `kind`, so a second run, or the final check, leaves it
  // as it is rather than inventing a pseudonym for a pseudonym: a name one this plugin's record holds,
  // or the shape the 64-word lists made.
  // COMPAT: name pseudonyms written before the record are known by their 64-word shape alone (since
  // De-Spicer 0.11.0); remove when no library holds one - the names' LEGACY shapes, not the titles'.
  // ponytail: titles, values and URLs are known by shape alone - a record of every title would
  // outgrow the settings - so a real title that reads like one ("Golden Pier 482") is kept.
  // The shape a name pseudonym takes from the full lists, with a middle initial or a number after a clash.
  var _fullRe = {};
  function fullShape(kind) {
    if (_fullRe[kind]) return _fullRe[kind];
    var any = function (list) { return '(?:' + list.map(escapeRe).join('|') + ')'; };
    var n = '(?: \\d+)?$';
    var re = {
      person: '^' + any(FIRST) + '(?: [A-Z]\\.)? ' + any(LAST) + n,
      studio: '^' + any(ADJ) + ' ' + any(NOUN) + ' ' + any(STUDIO_END) + n,
      group: '^The ' + any(ADJ) + ' ' + any(NOUN) + n,
      tag: '^' + any(ADJ) + ' ' + any(NOUN) + n,
      filter: '^Filter: ' + any(ADJ) + ' ' + any(NOUN) + n,
    }[kind] || '^$';
    return (_fullRe[kind] = new RegExp(re));
  }
  var _shapesRe = null;
  function isInvented(kind, value, written, noLegacy) {
    // 30 bits can match a real name by chance; one that is also in the shape the lists make cannot.
    if (written && hasOwn(NAME_KINDS, kind) && hasOwn(written, writtenKey(kind, value)) && fullShape(kind).test(String(value))) {
      return true;
    }
    // A library with no salt stored has had no run, so no name of its own reads that shape.
    if (noLegacy && hasOwn(NAME_KINDS, kind)) return false;
    if (!_shapesRe) {
      var any = function (list) { return '(?:' + list.map(escapeRe).join('|') + ')'; };
      var lower = function (list) { return list.map(function (w) { return w.toLowerCase(); }); };
      var n = '(?: \\d+)?$', F = LEGACY.FIRST, La = LEGACY.LAST, A = LEGACY.ADJ, N = LEGACY.NOUN;
      _shapesRe = {
        person: new RegExp('^' + any(F) + ' ' + any(La) + n),
        studio: new RegExp('^' + any(A) + ' ' + any(N) + ' ' + any(STUDIO_END) + n),
        group: new RegExp('^The ' + any(A) + ' ' + any(N) + n),
        tag: new RegExp('^' + any(A) + ' ' + any(N) + n),
        filter: new RegExp('^Filter: ' + any(A) + ' ' + any(N) + n),
        url: /^https:\/\/example\.invalid\/[0-9a-z]+$/,
        value: new RegExp('^' + any(lower(A)) + '-' + any(lower(N)) + n),
        title: new RegExp('^' + any(A) + ' ' + any(N) + ' \\d{3}' + n),
      };
    }
    var re = _shapesRe[kind] || _shapesRe.title;
    return re.test(String(value));
  }

  // The pseudonyms of one run. Per kind, the same original always gets the same value; a
  // made-up value already taken - by another original, or by a real name the kind holds -
  // is tried again with another hash, then given a middle initial (a person) and only then a
  // number, in scan order, so the same library gives the same answer every run. `reserve`
  // takes the real names first, so a pseudonym is never one. `fresh` is what this run made, for
  // the record a write stores.
  var RETRIES = 8;
  // `fresh`: a library with no salt stored before this run, so no pseudonym from before the record.
  // `randoms`: the kinds whose rule is random words (`randomKinds`) - random letters of the original's
  // shape in place of a made-up name, settled and recorded the same way, but a title, which is
  // marked like random text rather than recorded: there can be a hundred thousand.
  // `words`: Vanillify's replacer, where it is on. A pseudonym it would rewrite ("Deep", a term, in
  // "Deep Harbor") would not read as one once rewritten, and every run would invent another: such a
  // one is drawn again, and one already in the library is replaced.
  function Namer(salt, written, fresh, randoms, words) {
    this.salt = salt;
    this.clean = words ? function (v) { return words(v) === v; } : function () { return true; };
    this.written = written || {};
    this.noLegacy = !!fresh;
    this.randoms = randoms || {};
    this.fresh = [];
    this.maps = {};
    this.used = {};
  }
  Namer.prototype.space = function (kind) {
    return this.used[kind] || (this.used[kind] = {});
  };
  Namer.prototype.reserve = function (kind, name) {
    if (typeof name === 'string' && name) this.space(kind)[name.toLowerCase()] = true;
  };
  // Titles, values, URLs and file names need no map: the same original already gives the same
  // pseudonym, and none of them is looked for in free text. Holding them was most of a large plan's
  // memory. Names keep theirs - unique, and rewritten wherever they appear. Two files in one folder
  // drawing one name are told apart once the scan is done (`settleFiles`).
  var STATELESS = { title: true, value: true, url: true, file: true };
  // `qual` tells apart two originals Stash keeps apart by something else: two performers named
  // "Jane Doe" with different disambiguations are two people, and a pseudonym each - one shared
  // would make the second write a duplicate Stash refuses, the real name staying.
  Namer.prototype.of = function (kind, value, qual) {
    var rand = hasOwn(this.randoms, kind), salt = this.salt, clean = this.clean;
    if (STATELESS[kind] || !hasOwn(NAME_KINDS, kind)) {
      if (rand) return isRandom(value) ? value : randomWords(salt, String(value));
      if (isInvented(kind, value) && clean(value)) return value;
      for (var a = 0; a < RETRIES; a++) {
        var made = inventFor(salt, kind, value, a);
        if (clean(made)) return made;
      }
      return inventFor(salt, kind, value);
    }
    var map = this.maps[kind] || (this.maps[kind] = {});
    var key = String(value).toLowerCase() + (qual ? '\u0001' + String(qual).toLowerCase() : '');
    if (hasOwn(map, key)) return map[key];
    if (rand ? hasOwn(this.written, randomKey(kind, value)) : isInvented(kind, value, this.written, this.noLegacy) && clean(value)) return value;
    var invent = rand ? function (t) { return randomWords(salt, String(value), kind + '\u0001' + key + '\u0002' + t).slice(1); }
      : function (t) { return inventFor(salt, kind, value, t); };
    var used = this.space(kind), out = null, t, base = null, free = function (v) { return !hasOwn(used, v.toLowerCase()); };
    for (t = 0; t < RETRIES && !out; t++) {
      var c = invent(t);
      if (!clean(c)) continue;
      if (!base) base = c;
      if (free(c)) out = c;
    }
    base = base || invent(0);
    if (!out && kind === 'person' && !rand) {
      var sp = base.indexOf(' '), from = hash53(key, 13) % 26;
      for (t = 0; t < 26 && !out; t++) {
        var m = base.slice(0, sp) + ' ' + String.fromCharCode(65 + (from + t) % 26) + '.' + base.slice(sp);
        if (free(m)) out = m;
      }
    }
    for (var n = 2; !out; n++) if (free(base + ' ' + n)) out = base + ' ' + n;
    used[out.toLowerCase()] = true;
    map[key] = out;
    this.fresh.push(rand ? randomKey(kind, out) : writtenKey(kind, out));
    return out;
  };
  var NAME_KINDS = { person: true, studio: true, group: true, tag: true, filter: true };
  // The kinds a run's rules give random words: every name and title under Names, a saved filter's
  // name under Saved filters.
  function randomKinds(r) {
    var out = {};
    if (wayOf(r, 'names') === 'random') ['person', 'studio', 'group', 'tag', 'title'].forEach(function (k) { out[k] = true; });
    if (wayOf(r, 'filters') === 'random') out.filter = true;
    return out;
  }

  // ── The fields, per entity-type ───────────────────────────────────────────
  //
  // Core's `entityTypes` gives each type's queries, route and update mutation; what is read
  // and rewritten here is this plugin's own list, each field with its kind of data, its shape
  // (`string`, `list`, `map`, `ids` - the stash-ids - or `scalar`) and, for a name, which
  // namespace its pseudonym comes from. Which of them the running Stash has, on the type and
  // on its update input both, is asked once (`describe`).
  var TEXT = C.entityTypes('DSP');
  var ENTITIES = TEXT.types;
  var FIELD_LABEL = TEXT.fieldLabel;

  function F(name, cat, shape, kind) { return { name: name, cat: cat, shape: shape, kind: kind || null }; }
  var FACTS = ['gender', 'birthdate', 'death_date', 'country', 'ethnicity', 'eye_color', 'hair_color',
    'height_cm', 'weight', 'measurements', 'fake_tits', 'penis_length', 'circumcised', 'career_start', 'career_end'];
  var FIELDS = {
    performers: [F('name', 'names', 'string', 'person'), F('disambiguation', 'names', 'string', 'drop'),
      F('alias_list', 'names', 'list', 'person'), F('details', 'text', 'string'), F('tattoos', 'text', 'string'),
      F('piercings', 'text', 'string'), F('urls', 'links', 'list', 'url'), F('stash_ids', 'links', 'ids'),
      F('custom_fields', 'fields', 'map'), F('rating100', 'ratings', 'scalar')]
      .concat(FACTS.map(function (n) { return F(n, 'facts', 'scalar'); })),
    studios: [F('name', 'names', 'string', 'studio'), F('aliases', 'names', 'list', 'studio'),
      F('details', 'text', 'string'), F('urls', 'links', 'list', 'url'), F('stash_ids', 'links', 'ids'),
      F('custom_fields', 'fields', 'map'), F('rating100', 'ratings', 'scalar')],
    groups: [F('name', 'names', 'string', 'group'), F('aliases', 'names', 'string', 'group'),
      F('synopsis', 'text', 'string'), F('director', 'text', 'string'), F('urls', 'links', 'list', 'url'),
      F('custom_fields', 'fields', 'map'), F('date', 'dates', 'scalar'), F('rating100', 'ratings', 'scalar')],
    tags: [F('name', 'names', 'string', 'tag'), F('sort_name', 'names', 'string', 'drop'),
      F('aliases', 'names', 'list', 'tag'), F('description', 'text', 'string'), F('stash_ids', 'links', 'ids'),
      F('custom_fields', 'fields', 'map')],
    scenes: [F('title', 'names', 'string', 'title'), F('details', 'text', 'string'), F('director', 'text', 'string'),
      F('code', 'text', 'string'), F('urls', 'links', 'list', 'url'), F('stash_ids', 'links', 'ids'),
      F('custom_fields', 'fields', 'map'), F('date', 'dates', 'scalar'), F('rating100', 'ratings', 'scalar'),
      F('o_counter', 'ratings', 'counter'), F('play_count', 'ratings', 'counter'), F('resume_time', 'ratings', 'counter')],
    galleries: [F('title', 'names', 'string', 'title'), F('details', 'text', 'string'),
      F('photographer', 'text', 'string'), F('code', 'text', 'string'), F('urls', 'links', 'list', 'url'),
      F('custom_fields', 'fields', 'map'), F('date', 'dates', 'scalar'), F('rating100', 'ratings', 'scalar')],
    images: [F('title', 'names', 'string', 'title'), F('details', 'text', 'string'),
      F('photographer', 'text', 'string'), F('code', 'text', 'string'), F('urls', 'links', 'list', 'url'),
      F('custom_fields', 'fields', 'map'), F('date', 'dates', 'scalar'), F('rating100', 'ratings', 'scalar'),
      F('o_counter', 'ratings', 'counter')],
  };
  // A counter Stash keeps is not written through the update input - its field there is
  // deprecated and dropped unread - but by a reset mutation of its own. Undo adds back the
  // history the reset deleted, its times kept; an image keeps only a number, so that many
  // increments. A scene's resume time is on the update input too, and Stash's sceneUpdate never reads
  // it: `sceneSaveActivity` sets it, to 0 and back. Undo History has no way to call these, so only
  // the dialog's Undo puts one back.
  var COUNTERS = {
    scenes: { o_counter: { reset: 'sceneResetO', history: 'o_history', add: 'sceneAddO' },
      play_count: { reset: 'sceneResetPlayCount', history: 'play_history', add: 'sceneAddPlay' },
      resume_time: { save: 'sceneSaveActivity' } },
    images: { o_counter: { reset: 'imageResetO', inc: 'imageIncrementO' } },
  };
  function counterOf(typeKey, name) { return (COUNTERS[typeKey] || {})[name] || null; }
  // One counter reset, or put back (`back`), on one entity.
  function counterWrite(id, c, back) {
    var m = counterOf(c.typeKey, c.field);
    if (m.save) {
      return gqlRequest('mutation ' + (back ? 'DSP_Restore' : 'DSP_Reset') + '($id: ID!, $t: Float) { ' + m.save + '(id: $id, ' +
        c.field + ': $t) }', { id: id, t: back ? c.count : 0 });
    }
    if (!back) return gqlRequest('mutation DSP_Reset($id: ID!) { ' + m.reset + '(id: $id) }', { id: id });
    if (m.add) {
      // A count above its history (a counter older than Stash's history of it) is made up with the time now.
      var times = (c.history || []).slice();
      while (times.length < c.count) times.push(new Date().toISOString());
      return times.length ? gqlRequest('mutation DSP_Restore($id: ID!, $t: [Timestamp!]) { ' + m.add +
        '(id: $id, times: $t) { count } }', { id: id, t: times }) : Promise.resolve();
    }
    var k = 0;
    function more() {
      return k++ < c.count ? gqlRequest('mutation DSP_Restore($id: ID!) { ' + m.inc + '(id: $id) }', { id: id }).then(more) : null;
    }
    return Promise.resolve().then(more);
  }
  // Names first: their pseudonyms have to be settled before any text mentioning them is.
  var NAME_TYPES = ['performers', 'studios', 'groups', 'tags'];
  // Who a text belongs to, for a single-word name (`namesReplacer`): an owner key is a letter and an id.
  var OWNER = { performers: 'p', studios: 's', groups: 'g', tags: 't' };
  var REL_SEL = { scenes: 'performers { id } studio { id } groups { group { id } }', galleries: 'performers { id } studio { id }',
    images: 'performers { id } studio { id }', groups: 'studio { id }', studios: 'parent_studio { id }',
    tags: 'parents { id } children { id }' };
  // ' p1 s2 t6 ': an entity's performers, studio, groups and tags, a studio's parent, a tag's parents and
  // children - and itself, so a performer's own name is its own in its details.
  function relOf(typeKey, ent) {
    var out = ' ';
    function add(letter, x) { if (x && x.id != null) out += letter + x.id + ' '; }
    if (OWNER[typeKey]) add(OWNER[typeKey], ent);
    (ent.performers || []).forEach(function (x) { add('p', x); });
    add('s', ent.studio);
    add('s', ent.parent_studio);
    (ent.groups || []).forEach(function (x) { add('g', x && x.group); });
    (ent.tags || []).concat(ent.parents || [], ent.children || []).forEach(function (x) { add('t', x); });
    return out;
  }
  // The answers a review gave, by a hash of the salt, the kind of owner and the name, so no real name
  // is in the settings and an answer about the tag "Summer" never decides the performer "Summer".
  function answerKey(salt, e) { return writtenKey('answer' + e.kind, salt + '\u0001' + e.key); }
  function answersText(map) { return Object.keys(map).sort().map(function (k) { return k + ':' + map[k]; }).join(' '); }
  function parseAnswers(text) {
    var out = {};
    String(text || '').split(/\s+/).forEach(function (w) {
      var m = /^([0-9a-z]+):([ern])$/.exec(w);
      if (m) out[m[1]] = m[2];
    });
    return out;
  }
  var REST_TYPES = ['scenes', 'galleries', 'images'];
  // A name Stash refuses to be empty takes a placeholder where blank was asked for.
  var REQUIRED = { performers: 'name', studios: 'name', groups: 'name', tags: 'name' };

  // The images: read as a URL, written as the image itself, under another name on the input.
  // Stash serves a stand-in where an entity has none (`default=true`), which is left alone.
  function I(input, sel, read, label) { return { name: input, sel: sel, read: read, label: label, cat: 'images', shape: 'image' }; }
  var IMAGE_FIELDS = {
    scenes: [I('cover_image', 'paths { screenshot }', function (e) { return e.paths && e.paths.screenshot; }, 'Cover image')],
    performers: [I('image', 'image_path', function (e) { return e.image_path; }, 'Image')],
    studios: [I('image', 'image_path', function (e) { return e.image_path; }, 'Image')],
    tags: [I('image', 'image_path', function (e) { return e.image_path; }, 'Image')],
    groups: [I('front_image', 'front_image_path', function (e) { return e.front_image_path; }, 'Front image'),
      I('back_image', 'back_image_path', function (e) { return e.back_image_path; }, 'Back image')],
  };
  function realImage(url) { return typeof url === 'string' && url && !/[?&]default=true/.test(url); }

  // ── Drawing an image ──────────────────────────────────────────────────────
  //
  // In the browser, one image at a time: fetched from Stash and looked at as bytes first - one
  // De-Spicer drew already, an animation, an SVG - then drawn on a canvas, blurred or a card in
  // its place, and sent back as the entity's image with De-Spicer's mark in it (`drawImage`).
  // The suites replace `IMAGES`, since a fake page has no canvas; the bytes are read out here.
  var MIME = { GIF: 'image/gif', PNG: 'image/png', WebP: 'image/webp', JPEG: 'image/jpeg' };
  var CANNED_URL = 'plugin/' + PLUGIN_ID + '/assets/canned.png';
  var IMAGES = {
    fetch: function (url) {
      return fetch(url, { credentials: 'same-origin' }).then(function (resp) {
        if (!resp.ok) throw new Error('the image could not be read (' + resp.status + ')');
        var type = resp.headers.get('content-type') || '';
        return resp.arrayBuffer().then(function (buf) { return { bytes: new Uint8Array(buf), type: type }; });
      });
    },
    // The frame to draw: the middle one of an animation where the browser has `ImageDecoder`,
    // else the first. Decoded straight from the bytes, never through an <img> on a blob: URL -
    // Stash's Content-Security-Policy (`img-src data: *`) blocks blob: images.
    decode: function (bytes, info) {
      if (info.format === 'SVG') return svgRaster(bytes);
      var dims = dimsOf(bytes, info.format), cap = dims && capOf(dims[0], dims[1]);
      // Decoded at the capped size where the header gave one; a browser refusing the resize decodes it whole.
      var bitmap = function (src) {
        if (!cap) return createImageBitmap(src);
        return createImageBitmap(src, { resizeWidth: cap[0], resizeHeight: cap[1], resizeQuality: 'high' })
          .then(null, function () { return createImageBitmap(src); });
      };
      var first = function () {
        return bitmap(new Blob([bytes], { type: MIME[info.format] || '' })).then(function (img) {
          return { img: img, frame: 1 };
        });
      };
      if (info.frames < 2 || typeof ImageDecoder !== 'function') return first();
      var mid = Math.floor((info.frames - 1) / 2), dec;
      try { dec = new ImageDecoder({ data: bytes, type: MIME[info.format] }); } catch (e) { return first(); }
      return dec.decode({ frameIndex: mid }).then(function (r) {
        return bitmap(r.image).then(function (img) {
          r.image.close();
          return { img: img, frame: mid + 1 };
        });
      }).then(function (d) { dec.close(); return d; }, function () { dec.close(); return first(); });
    },
    // Whether any pixel is see-through, on a copy at most 256 pixels across.
    // ponytail: a transparent patch smaller than a 256th of the image averages away; logos and
    // cut-outs are far larger.
    hasAlpha: function (img) {
      var s = Math.min(1, 256 / Math.max(img.width, img.height, 1));
      var w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
      var ctx = canvas(w, h).getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      var d = ctx.getImageData(0, 0, w, h).data;
      for (var i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
      return false;
    },
    blur: function (img, strength, alpha) { return withMark(blurred(img, strength, alpha), 'blurred'); },
    // A card naming the entity in dark letters on a bright ground of its own (`cardColor`) or, for
    // a see-through original, in letters of that color outlined dark on none.
    card: function (label, name, portrait, alpha, ground) {
      var w = portrait ? 600 : 1280, h = portrait ? 800 : 720;
      var c = canvas(w, h), ctx = c.getContext('2d');
      if (!alpha) {
        ctx.fillStyle = ground;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(16,22,26,.85)';
      var line = function (text, color, font, y) {
        ctx.font = font;
        ctx.fillStyle = color;
        if (alpha) { ctx.lineWidth = Math.round(h / 90); ctx.strokeText(text, w / 2, y, w * 0.9); }
        ctx.fillText(text, w / 2, y, w * 0.9);
      };
      line(label, alpha ? ground : 'rgba(16,22,26,.7)', Math.round(h / 16) + 'px sans-serif', h / 2 - h / 14);
      line(String(name || '').slice(0, 40), alpha ? ground : '#10161a', 'bold ' + Math.round(h / 12) + 'px sans-serif', h / 2 + h / 18);
      return withMark(c.toDataURL('image/png'), 'card');
    },
    // The looping animation an animated original is replaced by, served from this plugin's folder
    // (`ui.assets`) and carrying its mark already.
    canned: function () {
      return fetch(CANNED_URL, { credentials: 'same-origin' }).then(function (resp) {
        if (!resp.ok) throw new Error('the canned animation could not be read (' + resp.status + ')');
        return resp.arrayBuffer();
      }).then(function (buf) { return 'data:image/png;base64,' + toBase64(new Uint8Array(buf)); });
    },
    // The settings' sample: a made-up cover - a sky, two suns and a title - blurred as a run would
    // blur it at `strength`. Drawn once, each strength's blur kept, so the slider stays smooth.
    sample: function (strength) {
      var memo = IMAGES._samples || (IMAGES._samples = {});
      if (memo[strength]) return memo[strength];
      if (!IMAGES._sample) {
        var c = canvas(320, 180), x = c.getContext('2d'), sky = x.createLinearGradient(0, 0, 320, 180);
        sky.addColorStop(0, '#3fa7d6');
        sky.addColorStop(1, '#f25f5c');
        x.fillStyle = sky;
        x.fillRect(0, 0, 320, 180);
        [['#ffe066', 70, 60, 34], ['#70c1b3', 250, 130, 26]].forEach(function (d) {
          x.fillStyle = d[0];
          x.beginPath();
          x.arc(d[1], d[2], d[3], 0, 2 * Math.PI);
          x.fill();
        });
        x.fillStyle = '#ffffff';
        x.font = 'bold 54px sans-serif';
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText('Sample', 160, 100);
        IMAGES._sample = c;
      }
      return (memo[strength] = blurred(IMAGES._sample, strength, false));
    },
  };

  // Blur Strength's slider shows the sample beside it, redrawn as it moves; a page with no canvas
  // shows none.
  function blurDemo(box, boxes, demos) {
    var col = el('div', 'gttxcore-demo dsp-blurdemo'), img = col.appendChild(el('img', 'dsp-blursample'));
    col.title = 'A made-up cover blurred at the strength the slider shows, as a run would blur an image.';
    img.alt = 'Blur sample';
    col.style.cssText = 'flex:0 0 auto;min-width:0;padding:.35rem;';   // hugs the picture, which Core's 21rem text box left off-center
    img.style.cssText = 'display:block;width:12rem;height:auto;border-radius:3px;';   // drawn on Stash's settings page, before any De-Spicer stylesheet
    demos.push(function () {
      var n = strengthOf(box.value), data = null;
      try { data = IMAGES.sample(n); } catch (e) { data = null; }
      col.style.display = data ? '' : 'none';
      if (data && img.src !== data) img.src = data;
    });
    return col;
  }

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // A bright color for an entity's card: hue, saturation and lightness from a hash of `seed`, so
  // neighboring ids land far apart on the wheel and the same entity always draws the same.
  function cardColor(seed) {
    var n = 2166136261;
    for (var i = 0; i < seed.length; i++) n = Math.imul(n ^ seed.charCodeAt(i), 16777619) >>> 0;
    return 'hsl(' + n % 360 + ',' + (70 + (n >>> 9) % 26) + '%,' + (55 + (n >>> 17) % 16) + '%)';
  }

  // Every image is blurred at one working size, BLUR_SIDE pixels on its longer side, and drawn back
  // at its own, by a radius that is `strength` percent of that longer side: Stash fits an image to
  // its card by the longer side, so a 512 by 84 logo and a 1999 by 831 one come out alike on the
  // page. The blur reads past every edge, so the image is set in a margin of three radii: for an
  // opaque one filled with itself stretched, so what bleeds in is its own colors, never the empty
  // canvas, which a JPEG would keep as a dark frame. A see-through one stays see-through, as PNG,
  // its margin empty, and fades to nothing toward its edges, where a wide logo's blur would
  // otherwise stop in a hard line.
  var BLUR_SIDE = 720;
  function blurGeometry(w, h, strength) {
    var k = BLUR_SIDE / Math.max(w, h);
    var r = Math.max(2, Math.round(BLUR_SIDE * strength / 100));
    return { ww: Math.max(1, Math.round(w * k)), wh: Math.max(1, Math.round(h * k)), r: r, pad: 3 * r };
  }

  // ponytail: a canvas without `filter` (an older Safari) is blurred by drawing it small and
  // back up, which is blockier; ctx.filter is the whole of the good path.
  function blurred(img, strength, alpha) {
    var w = img.width, h = img.height, g = blurGeometry(w, h, strength), ww = g.ww, wh = g.wh, r = g.r, pad = g.pad;
    var framed = canvas(ww + 2 * pad, wh + 2 * pad), fctx = framed.getContext('2d');
    if (!alpha) fctx.drawImage(img, 0, 0, framed.width, framed.height);
    fctx.drawImage(img, pad, pad, ww, wh);
    var work = canvas(ww, wh);
    var ctx = work.getContext('2d');
    if ('filter' in ctx) {
      ctx.filter = 'blur(' + r + 'px)';
      ctx.drawImage(framed, -pad, -pad);
      if (alpha) {
        var e = Math.min(r, Math.floor(Math.min(ww, wh) / 4)), mask = canvas(ww, wh), mctx = mask.getContext('2d');
        mctx.filter = 'blur(' + Math.max(1, Math.round(e / 2)) + 'px)';
        mctx.fillRect(e, e, ww - 2 * e, wh - 2 * e);
        ctx.filter = 'none';
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(mask, 0, 0);
      }
    } else {
      var small = canvas(Math.max(1, Math.round(ww / r)), Math.max(1, Math.round(wh / r)));
      small.getContext('2d').drawImage(img, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(small, 0, 0, ww, wh);
    }
    // Written back at its own size, or IMAGE_SIDE on its longer side where it was decoded whole.
    var size = capOf(w, h) || [w, h];
    var c = canvas(size[0], size[1]), out = c.getContext('2d');
    out.imageSmoothingEnabled = true;
    out.drawImage(work, 0, 0, size[0], size[1]);
    return alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
  }

  // An SVG drawn through a data: image (the policy allows data:, not blob:), 512 pixels on its
  // longer side in the shape its width and height or its viewBox give, square without either.
  // An <img> draws an SVG with its scripts and outside links off.
  function svgRaster(bytes) {
    var size = svgSize(new TextDecoder().decode(bytes));
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var c = canvas(size[0], size[1]);
        c.getContext('2d').drawImage(img, 0, 0, size[0], size[1]);
        resolve({ img: c, frame: 1 });
      };
      img.onerror = function () { reject(new Error('the SVG could not be drawn')); };
      img.src = 'data:image/svg+xml;base64,' + toBase64(bytes);
    });
  }
  function svgSize(text) {
    var root = (/<svg\b[^>]*>/i.exec(text) || [''])[0];
    var attr = function (n) {
      var m = new RegExp('\\s' + n + '\\s*=\\s*["\']([^"\']*)["\']', 'i').exec(root);
      return m ? m[1] : '';
    };
    var w = parseFloat(attr('width')), h = parseFloat(attr('height'));
    if (!(w > 0 && h > 0) || /%/.test(attr('width') + attr('height'))) {
      var vb = attr('viewBox').split(/[\s,]+/).map(parseFloat);
      w = vb[2];
      h = vb[3];
    }
    if (!(w > 0 && h > 0)) return [512, 512];
    return w >= h ? [512, Math.max(1, Math.round(512 * h / w))] : [Math.max(1, Math.round(512 * w / h)), 512];
  }

  // ── An image's bytes ──────────────────────────────────────────────────────
  //
  // The mark every image De-Spicer writes carries - a JPEG comment, a PNG text chunk - which Stash
  // keeps, storing an upload's bytes as sent: a later run leaves a blurred image alone rather than
  // blur the blur, and draws no card over a card. A new upload has no mark and is drawn.
  var MARK = 'GTTx De-Spicer: ';
  function markOf(bytes) {
    var s = latin1(bytes, 0, Math.min(bytes.length, 4096));
    // The word alone: what follows it in a PNG is the chunk's CRC, any byte at all.
    var m = /GTTx De-Spicer: (blurred|card|canned)/.exec(s);
    return m ? m[1] : null;
  }
  function withMark(url, kind) {
    var m = /^data:(image\/(?:jpeg|png));base64,(.*)$/.exec(url);
    if (!m) return url;
    var bin = atob(m[2]), text = MARK + kind, out;
    if (m[1] === 'image/jpeg' && bin.charCodeAt(0) === 0xFF && bin.charCodeAt(1) === 0xD8) {
      out = bin.slice(0, 2) + '\xFF\xFE' + String.fromCharCode((text.length + 2) >> 8, (text.length + 2) & 255) + text + bin.slice(2);
    } else if (m[1] === 'image/png' && bin.slice(12, 16) === 'IHDR') {
      var chunk = 'tEXtComment\u0000' + text;
      out = bin.slice(0, 33) + u32(chunk.length - 4) + chunk + u32(crc32(chunk)) + bin.slice(33);
    } else return url;
    return 'data:' + m[1] + ';base64,' + btoa(out);
  }
  function u32(n) { return String.fromCharCode(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); }
  var CRC = null;
  function crc32(s) {
    if (!CRC) {
      CRC = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < s.length; i++) crc = CRC[(crc ^ s.charCodeAt(i)) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function latin1(b, from, to) {
    var s = '';
    for (var i = from; i < to; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, Math.min(to, i + 8192)));
    return s;
  }
  function toBase64(b) { return btoa(latin1(b, 0, b.length)); }

  // What the bytes are, by their signature rather than the type served, and how many frames they hold.
  function sniff(b, type) {
    var head = latin1(b, 0, Math.min(b.length, 16));
    if (/^GIF8[79]a/.test(head)) return { format: 'GIF', frames: gifFrames(b) };
    if (head.slice(1, 4) === 'PNG') return { format: 'PNG', frames: pngFrames(b) };
    if (head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP') return { format: 'WebP', frames: webpFrames(b) };
    if (b[0] === 0xFF && b[1] === 0xD8) return { format: 'JPEG', frames: 1, opaque: true };
    if (/svg/i.test(type || '') || /^\s*</.test(head)) return { format: 'SVG', frames: 1 };
    return { format: (type || 'unknown').replace(/^image\//, ''), frames: 1 };
  }
  // Width and height off the header, so a large original is decoded straight to the size it is
  // drawn at (`capOf`); null where the header is not read, and the decode then takes it whole.
  function dimsOf(b, format) {
    var be16 = function (i) { return (b[i] << 8) | b[i + 1]; };
    var be32 = function (i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; };
    if (format === 'PNG' && b.length >= 24) return [be32(16), be32(20)];
    if (format === 'GIF' && b.length >= 10) return [b[6] | (b[7] << 8), b[8] | (b[9] << 8)];
    if (format === 'JPEG') {
      // As drawn: an EXIF Orientation of 5-8 turns it a quarter, and the browser draws it upright,
      // so width and height trade places - a decode resized to the header's own would squash it.
      var turned = false;
      for (var i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xFF) return null;
        var m = b[i + 1];
        if (m === 0xFF) { i++; continue; }
        if (m === 0xE1 && latin1(b, i + 4, i + 10) === 'Exif\0\0') turned = exifTurned(b, i + 10);
        // A start-of-frame: every 0xC0-0xCF but the Huffman, arithmetic and coding tables.
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
          return turned ? [be16(i + 5), be16(i + 7)] : [be16(i + 7), be16(i + 5)];
        }
        i += 2 + be16(i + 2);
      }
      return null;
    }
    if (format === 'WebP' && b.length >= 30) {
      var chunk = latin1(b, 12, 16);
      if (chunk === 'VP8 ') return [(b[26] | (b[27] << 8)) & 0x3FFF, (b[28] | (b[29] << 8)) & 0x3FFF];
      if (chunk === 'VP8L') return [1 + (((b[22] & 0x3F) << 8) | b[21]), 1 + (((b[24] & 0xF) << 10) | (b[23] << 2) | ((b[22] & 0xC0) >> 6))];
      if (chunk === 'VP8X') return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
    }
    return null;
  }
  // Whether the TIFF block at `t` (an EXIF APP1's) carries an Orientation (0x0112) of 5 to 8.
  function exifTurned(b, t) {
    var le = b[t] === 0x49;
    var u16 = function (o) { return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]; };
    var u32 = function (o) { return (le ? b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)
      : (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; };
    var ifd = t + u32(t + 4);
    if (ifd + 2 > b.length) return false;
    for (var k = 0, n = u16(ifd); k < n; k++) {
      var e = ifd + 2 + k * 12;
      if (e + 10 > b.length) return false;
      if (u16(e) === 0x0112) return u16(e + 8) >= 5 && u16(e + 8) <= 8;
    }
    return false;
  }

  // An image is drawn at most IMAGE_SIDE pixels on its longer side: the blur is worked out at
  // BLUR_SIDE, so nothing past it shows, and a 6000 by 4000 original held whole - decoded, then
  // drawn back - is about 200 MB. `[w, h]` to draw at, or null where it is small enough already.
  var IMAGE_SIDE = 2048;
  function capOf(w, h) {
    var k = IMAGE_SIDE / Math.max(w, h, 1);
    return k >= 1 ? null : [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
  }

  // A GIF's image descriptors, walked block by block past their color tables and data.
  function gifFrames(b) {
    var skip = function (i) { while (i < b.length && b[i]) i += b[i] + 1; return i + 1; };
    var table = function (packed) { return packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0; };
    var i = 13 + table(b[10]), n = 0;
    while (i < b.length) {
      if (b[i] === 0x2C) { n++; i += 10; i = skip(i + table(b[i - 1]) + 1); }
      else if (b[i] === 0x21) i = skip(i + 2);
      else break;
    }
    return Math.max(1, n);
  }
  // An APNG's frame count, in the acTL chunk before the first IDAT; a plain PNG has none.
  function pngFrames(b) {
    for (var i = 8; i + 8 <= b.length;) {
      var len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0, t = latin1(b, i + 4, i + 8);
      if (t === 'acTL') return Math.max(1, ((b[i + 8] << 24) | (b[i + 9] << 16) | (b[i + 10] << 8) | b[i + 11]) >>> 0);
      if (t === 'IDAT') break;
      i += 12 + len;
    }
    return 1;
  }
  // An animated WebP's ANMF chunks.
  function webpFrames(b) {
    var n = 0;
    for (var i = 12; i + 8 <= b.length;) {
      var len = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
      if (latin1(b, i, i + 4) === 'ANMF') n++;
      i += 8 + len + (len & 1);
    }
    return Math.max(1, n);
  }

  var MORE_LABEL = {
    sort_name: 'Sort name', stash_ids: 'Stash-ids', custom_fields: 'Custom field', date: 'Date',
    rating100: 'Rating', o_counter: 'O-counter', play_count: 'Play count', resume_time: 'Resume time',
    gender: 'Gender', birthdate: 'Birthdate', death_date: 'Death date', country: 'Country',
    ethnicity: 'Ethnicity', eye_color: 'Eye color', hair_color: 'Hair color', height_cm: 'Height',
    weight: 'Weight', fake_tits: 'Fake tits', penis_length: 'Penis length', circumcised: 'Circumcised',
    career_start: 'Career start', career_end: 'Career end',
  };
  function labelOf(field) { return FIELD_LABEL[field] || MORE_LABEL[field] || field; }

  // Scene markers and saved filters are not among Core's seven, and each has one thing here
  // to rewrite: a marker its title, a saved filter its name and the names in its criteria.
  ENTITIES.markers = { key: 'markers', label: 'Marker', plural: 'Markers', route: null,
    mutation: 'sceneMarkerUpdate', input: 'SceneMarkerUpdateInput' };
  ENTITIES.filters = { key: 'filters', label: 'Saved filter', plural: 'Saved filters', route: null };
  ENTITIES.descriptions = { key: 'descriptions', label: 'Custom field', plural: 'Custom field descriptions',
    route: null, noId: true };
  var TYPE_ORDER = NAME_TYPES.concat(REST_TYPES, ['markers', 'filters', 'descriptions']);


  // The tag Custom Fields Bulk Editor keeps its descriptions in, as JSON in its own
  // description: left out whole, its descriptions reached through the editor itself.
  var CFBE_ID = 'CustomFieldsBulkEditor', CFBE_NAME = 'ᝯㄝₓ Custom Fields Bulk Editor';
  function isPluginStore(ent) {
    var cf = ent && ent.custom_fields;
    if (!cf || typeof cf !== 'object') return false;
    for (var k in cf) if (hasOwn(cf, k) && /desc_store$/.test(k)) return true;
    return false;
  }
  function cfbeApi() {
    var api = (coop().api || {})[CFBE_ID];
    return api && typeof api.descriptions === 'function' && typeof api.updateDescriptions === 'function' ? api : null;
  }

  // Scene Filename Manager's archive of original filenames, asked for, never parsed here: a file
  // is renamed only where its original is archived, so Restore Original Filenames can take it back.
  var SFM_ID = 'SceneFilenameManager', SFM_NAME = 'ᝯㄝₓ Scene Filename Manager';
  function sfmApi() {
    var api = (coop().api || {})[SFM_ID];
    return api && typeof api.archiveField === 'function' && typeof api.archivedNames === 'function' ? api : null;
  }

  // A file's name, its extension kept: `stem.ext` → [stem, '.ext'].
  function splitName(name) {
    var i = String(name).lastIndexOf('.');
    return i > 0 ? [name.slice(0, i), name.slice(i)] : [String(name), ''];
  }
  // What no filesystem takes in a name, put back as a space.
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/ {2,}/g, ' ').replace(/^ +| +$/g, ''); }

  // ── Styles ────────────────────────────────────────────────────────────────

  var CSS =
    // Kept literally identical to the sibling plugins' stylesheets wherever the dialogs
    // overlap, down to the hex values. They are separate strings because the plugins
    // share no module, not because they are meant to look different - and two of them
    // did drift, from #202b33 to #30404d, because nothing compared them.
    // `.tests/style.test.js` pins the overlap. #202b33 is Blueprint's dark-gray2, the
    // step Stash's own page uses; every dim gray in these dialogs was chosen against it.
    '.dsp-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);' +
    'z-index:1600;display:flex;align-items:center;justify-content:center;}' +
    '.dsp-modal{background:var(--gttx-bg,#202b33);color:var(--gttx-fg,#f5f8fa);border:1px solid var(--gttx-border,#394b59);border-radius:4px;' +
    'width:min(100rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
    '.dsp-head{padding:.75rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);}' +
    '.dsp-title{font-size:1.1rem;font-weight:600;}' +
    '.dsp-warn{color:var(--gttx-highlight,#ffc107);margin-top:.35rem;}' +
    '.dsp-note{color:var(--gttx-muted,#a7b6c2);margin-top:.35rem;}' +
    '.dsp-legend{color:var(--gttx-dim,#7d8f9c);margin-top:.35rem;font-size:.8rem;}' +
    '.dsp-progress{padding:.5rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);color:var(--gttx-muted,#a7b6c2);' +
    'white-space:pre-wrap;}' +
    '.dsp-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;font-family:monospace;font-size:.8rem;' +
    'line-height:1.35;min-height:14rem;}' +
    // This dialog's log holds a checkbox per line, and a box drawn at a fractional offset
    // snaps a pixel taller: 1.35 of .8rem is 17.28px, so the lines here are a whole 18.
    '.dsp-modal .dsp-log{line-height:18px;}' +
    '.dsp-line{white-space:pre-wrap;word-break:break-word;}' +
    '.dsp-stale{margin:.5rem 0;padding:.6rem .75rem;border-left:4px solid #ff7373;' +
    'background:rgba(255,115,115,.14);color:#ff7373;font-size:.95rem;line-height:1.45;' +
    'font-weight:600;}' +
    '.dsp-ERROR{color:#ff7373;} .dsp-WARN{color:var(--gttx-highlight,#ffc107);} .dsp-INFO{color:var(--gttx-muted,#a7b6c2);}' +
    // The closing summary, and the log narrowed to its WARN or ERROR lines from it.
    '.dsp-closing{white-space:pre-wrap;margin:.4rem 0;padding:.3rem .5rem;border-left:3px solid var(--gttx-good,#3dcc91);}' +
    '.dsp-loglink{cursor:pointer;text-decoration:underline;}' +
    '.dsp-log.dsp-only-WARN>:not(.dsp-WARN):not(.dsp-closing),.dsp-log.dsp-only-ERROR>:not(.dsp-ERROR):not(.dsp-closing){display:none;}' +
    '.dsp-log:not(.dsp-only-WARN):not(.dsp-only-ERROR) .dsp-showall{display:none;}' +
    '.dsp-changed{cursor:help;}' +
    '.dsp-foot{padding:.75rem 1rem;border-top:1px solid var(--gttx-border,#394b59);display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.dsp-foot button{margin-right:.5rem;}' +
    // **`!important`, because a hidden utility that loses a cascade is not one.** Every
    // one of these rules is a single class, so the last one written wins - and this one
    // is written before the strips and rows that set their own `display`. A `-hidden` on
    // one of those did nothing at all, which is how Find & Replace shipped a row that
    // stayed on screen with the checkbox that reveals it switched off.
    '.dsp-hidden{display:none !important;}' +
    '.dsp-search{padding:.5rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);position:relative;' +
    'display:flex;gap:.5rem;align-items:center;}' +
    '.dsp-label{color:var(--gttx-muted,#a7b6c2);font-size:.85rem;white-space:nowrap;}' +
    '.dsp-check{display:flex;align-items:center;gap:.35rem;color:var(--gttx-muted,#a7b6c2);font-size:.85rem;' +
    'white-space:nowrap;cursor:pointer;margin:0;}' +
    // A checkbox carries browser margins that put it off the row's centre line.
    '.dsp-check input{margin:0;}' +
    '.dsp-textbox{background:var(--gttx-bg,#1f2b33);color:var(--gttx-fg,#f5f8fa);border:1px solid var(--gttx-border,#394b59);border-radius:3px;' +
    'padding:.25rem .5rem;flex:1 1 12rem;min-width:8rem;}' +
    // A fixed height rather than the shared `max-height` alone: ticking a box changes
    // the counters and the Proceed caption, and a content-sized modal would resize
    // under the pointer between two ticks. The modifier pattern
    // `CustomFieldsBulkEditor` established - a class beside the pinned rule, never an
    // edit to what the other plugins share - and the same 88vh, because two plugins
    // defining `.tall` differently is the drift `style` exists to stop.
    '.dsp-modal.dsp-tall{height:88vh;}' +
    // ── This dialog's own ───────────────────────────────────────────────────
    //
    // The filter strip wraps: there is one toggle per entity-type and one per attribute
    // name, and on a narrow window those are several lines. `.dsp-search` is pinned
    // across the plugins, so the wrap is a modifier beside it.
    '.dsp-search-wrap{flex-wrap:wrap;}' +
    // The two filter rows are a block of their own rather than more `.dsp-search`
    // strips, because they are built and rebuilt as one thing when a scan finishes.
    // The rows on the left, and on the right the buttons that act on them all - beside what they change
    // rather than in the footer, wrapping under the rows where the dialog is narrow.
    '.dsp-filters{padding:.4rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);display:flex;' +
    'flex-wrap:wrap;align-items:flex-start;gap:.3rem .75rem;}' +
    '.dsp-filterrows{flex:1 1 20rem;min-width:0;display:flex;flex-direction:column;gap:.3rem;}' +
    '.dsp-filterall{display:flex;gap:.35rem;flex-wrap:wrap;margin-left:auto;}' +
    '.dsp-filterrow{display:flex;gap:.35rem;align-items:center;flex-wrap:wrap;}' +
    // The filter toggles are Bootstrap buttons so they take Stash's own hover and focus
    // with them; only the size is ours, and it is small because there can be a dozen.
    // `.dsp-filterbtn` rather than `.dsp-toggle` for the same reason `.dsp-hitrow` is not
    // `.dsp-row`: `PropagateTagsAndPerformers` has a `.ptp2re-toggle` and it is a grid
    // cell in a settings table.
    '.dsp-filterbtn{font-size:.78rem;padding:.05rem .4rem;}' +
    // The review of single-word names, above the lines it changes.
    '.dsp-review{padding:.3rem 4px .5rem;margin-bottom:.4rem;border-bottom:1px solid var(--gttx-border,#394b59);}' +
    '.dsp-review-head{font-weight:600;margin-bottom:.2rem;}' +
    '.dsp-namerow{padding:2px 0;overflow-wrap:anywhere;}' +
    '.dsp-namerow>*{margin-right:8px;}' +
    '.dsp-review-more{margin:.2rem 0;color:var(--gttx-dim,#7d8f9c);}' +
    // One change per line. `.dsp-hitrow`, the name Entity Name Maintainer's identical rows carry.
    // Text that flows, not flex columns: as columns a long name either ran over the
    // attribute beside it or wrapped inside a column of its own. The box is inline, its
    // margins summing to the 18px line, and a hanging indent starts every wrapped line
    // after it.
    '.dsp-pager{position:sticky;top:-.5rem;z-index:2;background:var(--gttx-bg,#202b33);margin:0;padding:.25rem 0;}' +
    '.dsp-hitrow{padding:2px 4px 2px 25px;text-indent:-21px;margin:0;cursor:pointer;' +
    'overflow-wrap:anywhere;}' +
    '.dsp-hitrow>*{margin-right:8px;}' +
    '.dsp-hitrow input{width:13px;height:13px;margin:3px 8px 2px 0;vertical-align:top;}' +
    '.dsp-hitrow:hover{background:var(--gttx-raised,#3c4f5d);}' +
    '.dsp-hitrow-off{color:var(--gttx-dim,#7d8f9c);}' +
    '.dsp-ent{text-decoration:none;}' +
    '.dsp-ent:hover{text-decoration:underline;}' +
    '.dsp-attr{color:var(--gttx-muted,#a7b6c2);}' +
    '.dsp-was{color:var(--gttx-dim,#7d8f9c);}' +
    '.dsp-spacer{flex:1 1 auto;}' +
    // ── The change lines and the rules strip ─────────────────────────────────
    //
    // A change line: the value as it is, struck through, then what it becomes.
    '.dsp-before{color:var(--gttx-dim,#7d8f9c);text-decoration:line-through;}' +
    '.dsp-after{color:var(--gttx-fg,#f5f8fa);}' +
    // The part of a long value that changes (`changedParts`), as a match is marked in Entity Name Maintainer.
    '.dsp-mark{background:var(--gttx-match-bg,#3f6b46);border-radius:2px;padding:0 .1rem;}' +
    // The rules strip: the goals, then one choice per kind of data, wrapping on a narrow window.
    '.dsp-rules{padding:.5rem 1rem;border-bottom:1px solid var(--gttx-border,#394b59);display:flex;' +
    'flex-direction:column;gap:.35rem;}' +
    '.dsp-rulerow{display:flex;gap:.5rem 1rem;align-items:center;flex-wrap:wrap;}' +
    '.dsp-rule{display:flex;align-items:center;gap:.35rem;color:var(--gttx-muted,#a7b6c2);font-size:.85rem;white-space:nowrap;margin:0;}' +
    '.dsp-rulenote:empty{display:none;}' +
    '.dsp-rulesel{background:var(--gttx-bg,#1f2b33);color:var(--gttx-fg,#f5f8fa);border:1px solid var(--gttx-border,#394b59);' +
    'border-radius:3px;padding:.1rem .3rem;font-size:.85rem;}' +
    // The term editor: a narrower dialog, one row a term - two boxes and the button taking it out.
    '.dsp-modal.dsp-narrow{width:min(58rem,94vw);}' +
    // The run dialog stacks the rules, the filters and the after-the-run strip above its log, so the
    // log gives way to them rather than pushing the footer out of the dialog: a class of its own, not
    // the shared `.log` rule every plugin's dialog keeps.
    '.dsp-modal .dsp-log.dsp-giving{min-height:6rem;}' +
    '.dsp-termrow{display:flex;gap:.5rem;align-items:center;margin:0 0 .3rem;}' +
    '.dsp-termrow .dsp-textbox{flex:1 1 10rem;}' +
    '.dsp-termdel{padding:0 .5rem;}' +
    // A term listed twice, or a replacement two terms share (`markDups`).
    '.dsp-termrow .dsp-textbox.dsp-termdup{border-color:var(--gttx-highlight,#ffc107);color:var(--gttx-highlight,#ffc107);}' +
    '.dsp-readme{font-size:.8rem;margin-top:.35rem;display:inline-block;}' +
    // ── The settings page ───────────────────────────────────────────────────
    //
    // Stash renders the description as one text node in a `.sub-heading` that is
    // `white-space: normal`, and a description cannot carry markup - it is passed to
    // React as a child, so any tag in it is escaped. So the blank lines are made visible
    // by the class, and then rebuilt as divs.
    //
    // Scoped to our own group, never applied to `.sub-heading` at large - another
    // plugin's description is not ours to reflow.
    '.dsp-own-group .sub-heading{white-space:pre-wrap;}' +
    '.dsp-own-group .sub-heading .dsp-p{margin:0 0 .35em;}' +
    '.dsp-own-group .sub-heading .dsp-p:last-child{margin-bottom:0;}' +
    '.dsp-desc-collapsed .dsp-p:not(:first-child){display:none;}' +
    '.dsp-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:var(--gttx-accent,#7cc4ff);font-size:.8rem;cursor:pointer;' +
    'text-decoration:underline;}' +
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
    'margin-bottom:.4rem;border-radius:3px;background:var(--gttx-sunken,#111a20);}';

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

  // ── What a rule does to a value ───────────────────────────────────────────
  //
  // `ctx`: the run's namer, its words and name rewriters, the entity's label and id. Returns
  // the new value; the same value back means nothing changes.
  var EMPTY_OF = { string: '', list: [], ids: [], scalar: null };

  // Random words in place of a text: each run of letters becomes as many letters of one script -
  // Latin most often, accented Latin, Cyrillic, Greek, Hebrew, Arabic, Devanagari, kana or Han -
  // each punctuation mark another, and white space stays, so it keeps the original's size and
  // shape and says nothing of it. Drawn from the salt and the original, so the same text gives the
  // same words. It opens with an invisible word joiner (RANDOM_MARK), by which a later run, and the
  // final check, know it and leave it.
  var RANDOM_MARK = '\u2060';
  var RANDOM_SCRIPTS = ['abcdefghijklmnopqrstuvwxyz', 'abcdefghijklmnopqrstuvwxyz', 'abcdefghijklmnopqrstuvwxyz',
    'àáâãäåçèéêëìíîïñòóôõöøùúûüýßæœ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя', 'αβγδεζηθικλμνξοπρστυφχψω',
    'אבגדהוזחטיכלמנסעפצקרשת', 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي', 'अआइईउऊएऐओऔकखगघचछजझटठडढतथदधनपफबभमयरलवशसह',
    'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん',
    '的一是不了人我在有他这中大来上个国到说们为子和你地出道也时年'];
  var RANDOM_PUNCT = '.,;:!?…-–—\'"«»“”()¿¡/&·';
  // A run of numbers below `k`, the same for the same salt and seed.
  function seeded(salt, s) {
    var n = hash53(salt + '\u0000' + s, 7) % 4294967296;
    return function (k) { n = (Math.imul(n ^ (n >>> 15), 2246822507) + 2654435769) >>> 0; return n % k; };
  }
  // `seed`, where given, draws the letters; the text still gives their shape.
  function randomWords(salt, s, seed) {
    var next = seeded(salt, seed == null ? s : seed);
    var out = RANDOM_MARK, script = null;
    (s.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/g) || []).forEach(function (ch) {
      if (/\s/.test(ch)) { out += ch; script = null; return; }
      if (RANDOM_PUNCT.indexOf(ch) !== -1) { out += RANDOM_PUNCT.charAt(next(RANDOM_PUNCT.length)); script = null; return; }
      if (!script) script = RANDOM_SCRIPTS[next(RANDOM_SCRIPTS.length)];
      out += script.charAt(next(script.length));
    });
    return out;
  }
  // A random number of the original's shape: its sign, digits and decimals, the first and last
  // digit never 0 so the shape holds. Seeded by where it is, not by the value, so the next run draws
  // the same number and leaves it. One written in exponent form is kept.
  function randomNumber(salt, where, v) {
    var abs = String(Math.abs(v));
    if (!isFinite(v) || /e/i.test(abs)) return v;
    var next = seeded(salt, where), parts = abs.split('.'), ip = parts[0], dp = parts[1] || '', out = '';
    for (var i = 0; i < ip.length; i++) out += String(i === 0 && ip.length > 1 ? 1 + next(9) : next(10));
    if (dp) out += '.';
    for (var j = 0; j < dp.length; j++) out += String(j === dp.length - 1 ? 1 + next(9) : next(10));
    return v < 0 ? -Number(out) : Number(out);
  }
  // A performer's fact at random, a value of its own kind, drawn from where it is so the next run
  // draws it again. A date stays in the ten-year span of the original (1985-1994, 1995-2004…), which
  // the date it becomes is in too; a career starts in its span's first half and ends in its second,
  // so the end never comes first. Kept in the original's form: a year, a month, a day.
  var FACT_PICKS = {
    gender: ['MALE', 'FEMALE', 'TRANSGENDER_MALE', 'TRANSGENDER_FEMALE', 'INTERSEX', 'NON_BINARY'],
    circumcised: ['CUT', 'UNCUT'],
    country: ['US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'DE', 'FR', 'ES', 'PT', 'IT', 'NL', 'BE', 'SE', 'CZ', 'HU', 'PL', 'RO',
      'RU', 'UA', 'BR', 'CO', 'MX', 'AR', 'VE', 'JP', 'KR', 'TH', 'PH', 'IN', 'ZA', 'NG'],
    ethnicity: ['Caucasian', 'Black', 'Asian', 'Latin', 'Indian', 'Middle Eastern', 'Mixed', 'Other'],
    eye_color: ['Blue', 'Brown', 'Green', 'Gray', 'Hazel'],
    hair_color: ['Blonde', 'Brunette', 'Black', 'Red', 'Auburn', 'Gray', 'Bald', 'Various'],
    fake_tits: ['Natural', 'Augmented'],
  };
  var FACT_RANGES = { height_cm: [150, 195, 0], weight: [45, 100, 0], penis_length: [10, 22, 1] };
  var FACT_SPANS = { birthdate: [0, 9], death_date: [0, 9], career_start: [0, 4], career_end: [5, 9] };
  function randomFact(salt, where, name, value) {
    var next = seeded(salt, where), pad = function (n) { return ('0' + n).slice(-2); };
    if (FACT_PICKS[name]) return FACT_PICKS[name][next(FACT_PICKS[name].length)];
    var r = FACT_RANGES[name];
    if (r) { var k = Math.pow(10, r[2]); return (r[0] * k + next((r[1] - r[0]) * k + 1)) / k; }
    if (name === 'measurements') {
      return (30 + 2 * next(6)) + (/[a-z]/i.test(value) ? 'ABCDEF'.charAt(next(6)) : '') + '-' + (22 + next(11)) + '-' + (32 + next(11));
    }
    var span = FACT_SPANS[name], m = /^(\d{4})(-\d{2})?(-\d{2})?$/.exec(String(value));
    if (!span || !m) return value;
    // ponytail: a date in the span holding today can move on a later run, as today moves; ten years at most.
    var today = new Date(), now = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    var start = Math.floor((Number(m[1]) - 5) / 10) * 10 + 5, lo = start + span[0];
    var hi = Math.min(start + span[1], today.getFullYear()), year = lo > hi ? hi : lo + next(hi - lo + 1);
    var out = String(year) + (m[2] ? '-' + pad(1 + next(12)) : '') + (m[3] ? '-' + pad(1 + next(28)) : '');
    return out > now.slice(0, out.length) ? now.slice(0, out.length) : out;
  }
  function isRandom(s) { return typeof s === 'string' && s.charAt(0) === RANDOM_MARK; }

  function rewriteText(ctx, s, way) {
    if (typeof s !== 'string' || !s) return s;
    var out = s;
    if (way === 'blank') return '';
    if (way === 'random') return isRandom(out) ? out : randomWords(ctx.namer.salt, out);
    if (way === 'pseudonym' && ctx.names) out = ctx.names(out, ctx.rel, ctx.sink);
    if (ctx.words) out = ctx.words(out);
    return out;
  }

  // One field of one entity: [newValue] or null for no change.
  // Stash-ids as their input takes them, the date each was last matched kept so an undo puts it back.
  function stashIdsOf(v) {
    return (v || []).map(function (x) {
      var o = { endpoint: x.endpoint, stash_id: x.stash_id };
      if (x.updated_at) o.updated_at = x.updated_at;
      return o;
    });
  }

  // What tells two entities of one name apart, where Stash allows two: a performer's disambiguation.
  function qualOf(typeKey, ent) { return typeKey === 'performers' && ent && ent.disambiguation ? String(ent.disambiguation) : ''; }

  function treat(ctx, f, value, way) {
    if (way === 'never') return null;
    var label = ENTITIES[ctx.type].label;
    if (way === 'random' && f.cat === 'facts') {
      if (value == null || value === '') return null;
      var made = randomFact(ctx.namer.salt, ctx.type + '\u0000' + ctx.id + '\u0000' + f.name, f.name, value);
      return made === value ? null : [made];
    }
    if (f.shape === 'scalar' || f.shape === 'ids' || f.shape === 'counter') {
      if (way !== 'blank' && !(f.shape === 'ids' && way === 'pseudonym')) return null;
      var empty = f.shape === 'ids' ? [] : f.cat === 'ratings' && f.name !== 'rating100' ? 0 : null;
      if (f.shape === 'ids' ? !(value && value.length) : value == null || value === empty) return null;
      return [empty];
    }
    if (f.shape === 'list') {
      var list = (value || []).slice();
      var out;
      if (way === 'blank' || way === 'placeholder') out = [];
      else if ((way === 'pseudonym' || way === 'random') && f.kind) out = list.map(function (v) { return typeof v === 'string' ? ctx.namer.of(f.kind, v) : v; });
      else out = list;
      if (ctx.words && f.kind !== 'url') out = out.map(function (v) { return ctx.words(v); });
      // Aliases that the rewriting made one ("Blow Job" and "blow-job") are kept once, as Stash wants.
      var once = {};
      out = out.filter(function (v) {
        // A URL's path can be case-sensitive, so only an exact repeat of one is dropped.
        var k = typeof v === 'string' && f.kind !== 'url' ? v.toLowerCase() : JSON.stringify(v);
        if (hasOwn(once, k)) return false;
        once[k] = true;
        return true;
      });
      return same(out, list) ? null : [out];
    }
    // A string.
    if (typeof value !== 'string' || !value) {
      return null;
    }
    var next = value;
    if (f.cat === 'text') next = rewriteText(ctx, value, way);
    else if (way === 'blank') next = REQUIRED[ctx.type] === f.name ? label + ' ' + ctx.id : '';
    else if (way === 'placeholder') next = f.kind === 'drop' ? '' : label + ' ' + ctx.id;
    else if (way === 'pseudonym' || way === 'random' && f.cat === 'names') next = f.kind === 'drop' ? '' : ctx.namer.of(f.kind || 'title', value, f.name === 'name' ? ctx.qual : '');
    if (ctx.words && f.cat !== 'text' && next) next = ctx.words(next);
    return next === value ? null : [next];
  }

  // A custom field's value: strings only - a number or an object is no text to rewrite.
  // A custom field value: [newValue], [null] for one removed, or null for no change. A number or a
  // true/false has no empty form, so Blank removes it.
  function treatValue(ctx, key, value, way) {
    if (value == null || value === '' || way === 'never') return null;
    if (typeof value !== 'string') {
      if (way === 'blank') return [null];
      if (way !== 'random' || typeof value !== 'number') return null;
      var n = randomNumber(ctx.namer.salt, ctx.type + '\u0000' + ctx.id + '\u0000' + key, value);
      return n === value ? null : [n];
    }
    var next = value;
    if (way === 'random') return isRandom(value) ? null : [randomWords(ctx.namer.salt, value)];
    if (way === 'blank') next = '';
    else if (way === 'placeholder') next = key + ' ' + ctx.id;
    else if (way === 'pseudonym') next = ctx.namer.of('value', value);
    if (ctx.words && next) next = ctx.words(next);
    return next === value ? null : [next];
  }

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  // What a plan keeps of a value it no longer holds: enough to tell it moved before it is written.
  // Thirty bits, so it is stored in the change itself rather than as a number object beside it.
  function hashOf(v) { return hash53(JSON.stringify(v === undefined ? null : v), 0) % 1073741824; }

  // What a change line says a value is: an image by what happens to it, anything else as `shown`.
  var IMAGE_AFTER = { blur: 'blurred', placeholder: 'a card naming it, or the canned animation for an animated one' };
  function valueText(h, which, whole) {
    if (h.before === undefined && h.after === undefined && !KEEP_VALUES[h.shape]) {
      if (!h.read) return which === 'before' ? '(read when shown)' : '…';
      if (h.read.gone) return which === 'before' ? '(could not be read now)' : '…';
      if (h.read.moved && which === 'before') return shown(h.read.before, whole) + ' (changed since the scan)';
      if (which === 'after' && h.slot != null && h.read.after === null) return '(removed)';
      return shown(which === 'before' ? h.read.before : h.read.after, whole);
    }
    if (h.shape === 'image') {
      return which === 'before' ? (whole ? h.before : 'the image')
        : IMAGE_AFTER[h.after] + (h.after === 'blur' && h.strength ? ' at Blur Strength ' + h.strength : '');
    }
    if (h.shape === 'remove') return which === 'before' ? 'in the library' : 'removed';
    if (h.shape === 'rename') return (which === 'before' ? h.before : h.after) + (which === 'after' ? ' (renamed)' : '');
    if ((h.shape === 'archive' || h.slot != null && h.after === null) && which === 'after') return '(removed)';
    return shown(which === 'before' ? h.before : h.after, whole);
  }

  // Blur Strength as a percentage of the longer side, kept to what still shows something.
  function strengthOf(s) {
    var n = parseFloat(trim(s));
    if (!(n > 0)) n = parseFloat(DEFAULTS.d1BlurStrength);
    return Math.min(10, Math.max(1, n));
  }

  // A value as a change line shows it: empty said so, a list joined, a long one cut.
  function shown(v, whole) {
    var s;
    if (v == null || v === '') s = '(empty)';
    else if (Array.isArray(v)) {
      s = v.length ? v.map(function (x) {
        return x && typeof x === 'object' ? (x.endpoint ? x.endpoint + ' ' + x.stash_id : JSON.stringify(x)) : String(x);
      }).join(', ') : '(none)';
    } else if (typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    return whole || s.length <= SHOWN_CHARS ? s : s.slice(0, SHOWN_CHARS) + '…';
  }

  // A value too long to show whole, shown around the part that changes - as Entity Name
  // Maintainer and Find & Replace show a match (Core's `matchContext`) - so a change past the
  // cut is not two lines reading the same. The part is what lies between the longest common
  // start and end of the two, kept off a surrogate pair's halves.
  function changedParts(a, b) {
    var p = 0, n = Math.min(a.length, b.length);
    while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
    if (p && /[\ud800-\udbff]/.test(a.charAt(p - 1))) p--;
    var q = 0;
    while (q < n - p && a.charCodeAt(a.length - 1 - q) === b.charCodeAt(b.length - 1 - q)) q++;
    if (q && /[\udc00-\udfff]/.test(a.charAt(a.length - q))) q--;
    function part(s) {
      var c = matchContext(s, p, s.length - p - q);
      // A changed part longer than a line is cut too, and what follows it would say nothing.
      if (c.hit.length > SHOWN_CHARS) return { pre: c.pre, hit: c.hit.slice(0, SHOWN_CHARS) + '…', post: '' };
      return c;
    }
    return [part(a), part(b)];
  }
  function drawParts(node, c) {
    node.appendChild(document.createTextNode(c.pre));
    if (c.hit) node.appendChild(el('span', 'dsp-mark', c.hit));
    node.appendChild(document.createTextNode(c.post));
  }

  // A text file through the browser's download (Core's `download`).
  function saveText(text, name, type) { download(name, [text], type); }

  // A count as the summary gives it (12,345), a time taken (4 min 12 s) and a time left at the pace so far.
  function num(n) { return Number(n || 0).toLocaleString('en-US'); }
  function duration(ms) {
    var s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60);
    return m ? m + ' min ' + (s % 60 < 10 ? '0' : '') + (s % 60) + ' s' : s + ' s';
  }
  function aboutLeft(ms) {
    if (!(ms >= 0) || !isFinite(ms)) return '';
    var s = Math.round(ms / 1000);
    return s >= 90 ? 'about ' + Math.round(s / 60) + ' min left' : s >= 10 ? 'about ' + Math.round(s / 10) * 10 + ' s left'
      : 'a few seconds left';
  }

  // ── The task ──────────────────────────────────────────────────────────────
  //
  // Declared in the yml so Stash renders a button for it in Settings → Tasks, and handled
  // entirely here: a capture-phase listener on `document` runs before React's own handler
  // and stops the propagation, so the click never reaches the server. Ours only if the
  // caption matches *and* the group is headed with our name (Core's `ownTaskName`).
  var TASK_NAME = 'De-Spice Library...';
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
  var _opening = false;

  // Opens once the settings are read, fresh, so a change saved a moment ago in another tab
  // is what the dialog starts from. Unreadable, it starts from the defaults.
  function startRun() {
    if (_active) { _active.focus(); return; }
    if (_opening) return;
    _opening = true;
    // Unreadable, the run lists nothing it could write: the salt and the record of pseudonyms are
    // unknown, and writing from the defaults would replace both and leave other plugins' fields bare.
    loadSettings(true).then(null, function (e) {
      var d = {};
      for (var k in DEFAULTS) if (hasOwn(DEFAULTS, k)) d[k] = DEFAULTS[k];
      d.f1Terms = defaultTerms();
      d.unreadable = e && e.message ? e.message : String(e);
      return d;
    }).then(function (s) {
      _opening = false;
      _active = new Run(s);
      _active.begin();
    });
  }

  function Run(settings) {
    this.settings = settings;
    this.rules = rulesFrom(settings);
    this.terms = parseTerms(settings.f1Terms);
    // What the library is: the real one (all three on) or a copy (all off), or anything between.
    this.recordUndo = settings.g1RecordUndo !== false;
    this.offerBackup = settings.g2OfferBackup !== false;
    this.keepArchive = settings.g3KeepArchive !== false;
    this.removeTag = trim(settings.e1RemoveTag);
    this.removeDeletes = deletesOf(trim(settings.e2RemoveDeletes));
    this.excl = exclusionsOf(settings);
    // The salt this run's pseudonyms come from; a new one is stored by the first Proceed.
    this.salt = trim(settings.z1Salt);
    this.record = parseWritten(settings.z2Written);
    this.nameAnswers = parseAnswers(settings.z3NameAnswers);
    this.answersStored = answersText(this.nameAnswers);
    // The names this dialog's review answered, by entry (`namesReplacer`), and the old answers read for
    // them: both outlive a Rescan.
    this.answered = {};
    this.oldAnswers = {};
    this.newSalt = !this.salt;
    if (this.newSalt) this.salt = makeSalt();
    this.reset();
    this.logText = [];
    this.state = 'scanning';
    this.stale = false;
    this.build();
  }

  Run.prototype.reset = function () {
    this.hits = [];
    this.inFolder = {};
    this.journalBytes = 0;
    // Why the last scan stopped short, or ''. Unlike Propagate's partial plan, which adds and removes
    // links the next run completes, a run here renames the names themselves and keeps no record of
    // the real ones: a mention in what the scan did not reach could never be found again.
    this.scanFailed = '';
    this.quals = {};
    // Single-word names in free text: who each text belongs to, where each name was found, how often,
    // and how each is replaced - Only where related ('r') unless said otherwise.
    this.rels = {};
    this.occ = {};
    this.noted = 0;
    this.nameStats = {};
    this.policy = {};
    this.review = null;
    this.seenNow = null;
    this.typeOn = {};
    this.catOn = {};
    this.attrOn = {};
    this.pageAt = 0;
    this.changes = [];
    this.written = this.failed = this.scanned = this.skipped = this.lockedOut = this.imagesKept = 0;
    this.scannedPer = {};
    this.totals = {};
    this.ownedSeen = {};
    this.fieldKeys = {};
    this.renameCands = [];
    this.fieldRenames = {};
    this.fieldWords = null;
    this.excludedSeen = { entity: 0, image: 0 };
    this.ownedTagsSeen = [];
    this.tally = {};
    this.drawnStats = { drawn: 0, animated: 0, alpha: 0, svg: 0, canned: 0 };
    this.entitiesWritten = 0;
    this.doneHead = '';
    this.wrote = false;
    this.removed = 0;
    this.keptFiles = [];
    this.lean = false;
    this.undoKept = true;
    this.pageHits = [];
  };

  Run.prototype.build = function () {
    injectStyle();
    var self = this;
    this.backdrop = el('div', 'dsp-backdrop');
    this.modal = el('div', 'dsp-modal dsp-tall');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'dsp-head');
    head.appendChild(el('div', 'dsp-title', PLUGIN_SHORT_NAME + ' - De-Spice Library'));
    this.staleEl = el('div', 'dsp-stale dsp-hidden', '');
    head.appendChild(this.staleEl);
    var warn = el('div', 'dsp-warn',
      'Backing up your database before proceeding is strongly recommended. Undo only reverses what this dialog wrote, ' +
      'while it stays open, and cannot account for changes made elsewhere in the meantime. ');
    // Stash's own backup, one press away, on a library that is not marked as a copy.
    if (this.offerBackup) {
      this.backupBtn = button('Back Up Now', 'dsp-backup');
      this.backupBtn.title = 'Run Stash\'s Backup task now: a copy of the database, next to it on the ' +
        'server. Nothing in the library changes.';
      this.backupBtn.addEventListener('click', function () { self.backup(); });
      warn.appendChild(this.backupBtn);
    }
    head.appendChild(warn);
    var legend = el('div', 'dsp-legend');
    legend.appendChild(el('span', null,
      'One line per change: the entity, with its id in brackets, the attribute, then the value as it is, ' +
      'struck through, and what it becomes; a value too long for the line is shown around the part that ' +
      'changes, marked, and whole in its tooltip. Lines of one entity stand together. Untick a line to leave it ' +
      'alone; a filter turned off hides its lines and leaves them alone too.'));
    head.appendChild(legend);
    this.noteEl = el('div', 'dsp-note', '');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);

    this.buildRules();

    this.progressEl = el('div', 'dsp-progress', 'Scanning...');
    this.modal.appendChild(this.progressEl);
    // Stash's Clean, followed while it runs (`followClean`).
    this.jobEl = el('div', 'dsp-progress dsp-jobline dsp-hidden', '');
    this.modal.appendChild(this.jobEl);

    this.filtersEl = el('div', 'dsp-filters dsp-hidden');
    var filterRows = this.filtersEl.appendChild(el('div', 'dsp-filterrows'));
    this.typeRow = el('div', 'dsp-filterrow');
    this.catRow = el('div', 'dsp-filterrow');
    this.attrRow = el('div', 'dsp-filterrow');
    filterRows.appendChild(this.typeRow);
    filterRows.appendChild(this.catRow);
    filterRows.appendChild(this.attrRow);
    this.filterAllEl = this.filtersEl.appendChild(el('div', 'dsp-filterall'));
    this.modal.appendChild(this.filtersEl);

    this.logEl = el('div', 'dsp-log dsp-giving');
    this.modal.appendChild(this.logEl);

    // After a write: the final check again, and the two clean-ups it can offer. Each clean-up
    // deletes what nothing brings back, so it asks a second press first.
    this.cleanEl = el('div', 'dsp-search dsp-search-wrap dsp-hidden');
    this.cleanEl.appendChild(el('span', 'dsp-label', 'After the run'));
    this.checkBtn = button('Final Check', 'dsp-check-again');
    this.checkBtn.title = 'Scan the library again with these goals and rules, writing nothing, and say what is ' +
      'still left for them to change.';
    this.checkBtn.addEventListener('click', function () { self.finalCheck(); });
    this.deleteFilesBtn = button('Delete Media Files', 'dsp-delete-files');
    this.deleteFilesBtn.addEventListener('click', function () { self.armed('deleteFilesBtn', function () { return self.deleteKeptFiles(); }); });
    this.cleanBtn = button('Run Stash\'s Clean', 'dsp-clean');
    this.cleanBtn.addEventListener('click', function () { self.armed('cleanBtn', function () { return self.runClean(); }); });
    [this.checkBtn, this.deleteFilesBtn, this.cleanBtn].forEach(function (b) { self.cleanEl.appendChild(b); });
    // Orange as every button of ours that writes, its text the button's own: a level colors a
    // setting's name, and on an orange button it left the caption unreadable. Its danger is in the
    // tooltip and the second press it asks for.
    paintButton(this.deleteFilesBtn, PLUGIN_BTN_VARIANT);
    paintButton(this.cleanBtn, PLUGIN_BTN_VARIANT);
    this.modal.appendChild(this.cleanEl);

    var foot = el('div', 'dsp-foot');
    // Proceed until something has been written, Undo afterwards: after a write the listing
    // describes a library this dialog has already changed.
    this.goBtn = button('Proceed', 'dsp-go');
    paintButton(this.goBtn, PLUGIN_BTN_VARIANT);
    this.closeBtn = button('Close', 'dsp-close');
    this.closeBtn.title = 'Close this dialog, ending a scan that is still running. A scan is made again from the ' +
      'start the next time.';
    this.copyBtn = button('Copy log', 'dsp-copy');
    this.copyBtn.title = 'Copy the counters, the messages and every change in the listing as plain text, ' +
      'each value whole.';
    this.saveLogBtn = button('Save log', 'dsp-savelog');
    this.saveLogBtn.title = 'Download what Copy log copies as a text file named by the date and time: a long run\'s log ' +
      'may be too large to paste, and a file can be kept with the backup.';
    this.rescanBtn = button('Rescan', 'dsp-rescan');
    this.allOnBtn = button('All On', 'dsp-allon dsp-filterbtn');
    this.allOffBtn = button('All Off', 'dsp-alloff dsp-filterbtn');
    [this.allOnBtn, this.allOffBtn].forEach(function (b) {
      paintButton(b, PLUGIN_BTN_VARIANT);
      b.title = 'Turn every filter above on or off. A filter only decides what is shown and what ' +
        'Proceed covers; it never changes a tick.';
    });
    this.unselAllBtn = button('Unselect All', 'dsp-unselall');
    this.unselAllBtn.title = 'Untick every line shown in the listing.';
    this.selAllBtn = button('Select All', 'dsp-selall');
    this.selAllBtn.title = 'Tick every line shown in the listing.';

    this.goBtn.addEventListener('click', function () { self.go(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });
    this.copyBtn.addEventListener('click', function () { self.copyLog(); });
    this.saveLogBtn.addEventListener('click', function () { self.saveLog(); });
    this.rescanBtn.addEventListener('click', function () { self.rescan(); });
    this.allOnBtn.addEventListener('click', function () { self.setAllFilters(true); });
    this.allOffBtn.addEventListener('click', function () { self.setAllFilters(false); });
    this.unselAllBtn.addEventListener('click', function () { self.tickAll(false); });
    this.selAllBtn.addEventListener('click', function () { self.tickAll(true); });

    [this.goBtn, this.closeBtn, this.copyBtn, this.saveLogBtn, this.rescanBtn].forEach(function (b) { foot.appendChild(b); });
    foot.appendChild(el('div', 'dsp-spacer'));
    // The selection pair last, at the right end, where every sibling's dialog has it; All On / All Off
    // beside the filters they act on.
    foot.appendChild(this.unselAllBtn);
    foot.appendChild(this.selAllBtn);
    this.modal.appendChild(foot);
    this.filterAllEl.appendChild(this.allOnBtn);
    this.filterAllEl.appendChild(this.allOffBtn);

    wireEscape(this, 'dsp', escapeButton);
    document.body.appendChild(this.backdrop);
  };

  // The goals and one choice per kind of data, filled from the settings. A change here lasts
  // for this dialog and scans again; Save as Defaults stores it.
  Run.prototype.buildRules = function () {
    var self = this;
    var box = el('div', 'dsp-rules');
    var top = el('div', 'dsp-rulerow');
    top.appendChild(el('span', 'dsp-label', 'Goals'));
    this.goalBoxes = {};
    [['anonymize', 'Anonymize', 'Nothing in the library names a real person, studio, place, site or file: ' +
      'names become pseudonyms, free text, facts and dates are blanked, links replaced.'],
    ['vanillify', 'Vanillify', 'Nothing in the library\'s text is explicit: every word listed in Explicit Words ' +
      'is rewritten, in names, free text, custom fields and saved filters.']].forEach(function (g) {
      var lab = el('label', 'dsp-check');
      var cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!self.rules.goals[g[0]];
      cb.addEventListener('change', function () { self.rules.goals[g[0]] = !!cb.checked; self.rulesChanged(); });
      lab.appendChild(cb);
      lab.appendChild(el('span', null, g[1]));
      lab.title = g[2];
      self.goalBoxes[g[0]] = cb;
      top.appendChild(lab);
    });
    this.termsEl = el('span', 'dsp-label', '');
    top.appendChild(this.termsEl);
    top.appendChild(el('div', 'dsp-spacer'));
    this.saveRulesBtn = button('Save as Defaults', 'dsp-saverules');
    paintButton(this.saveRulesBtn, PLUGIN_BTN_VARIANT);
    this.saveRulesBtn.title = 'Store these goals and rules in this plugin\'s Goals and Rules setting, so ' +
      'the next run starts from them. Nothing in the library changes.';
    this.saveRulesBtn.addEventListener('click', function () { self.saveRules(); });
    top.appendChild(this.saveRulesBtn);
    box.appendChild(top);

    var row = el('div', 'dsp-rulerow');
    this.selects = {};
    this.ruleNotes = {};
    CATEGORIES.forEach(function (c) {
      var lab = el('label', 'dsp-rule');
      lab.title = c.tip;
      lab.appendChild(el('span', null, c.label));
      var sel = C.dropdown('dsp-rulesel');
      ['auto'].concat(c.ways).forEach(function (w) {
        var o = el('option', null, wayLabel(c.key, w));
        o.value = w;
        sel.appendChild(o);
      });
      sel.value = self.rules.ways[c.key] || 'auto';
      sel.addEventListener('change', function () {
        if (sel.value === 'auto') delete self.rules.ways[c.key]; else self.rules.ways[c.key] = sel.value;
        self.rulesChanged();
      });
      lab.appendChild(sel);
      self.ruleNotes[c.key] = lab.appendChild(el('span', 'dsp-rulenote'));
      self.selects[c.key] = sel;
      row.appendChild(lab);
    });
    box.appendChild(row);

    // The entity-types this run reads: one that is off is not read at all.
    var types = el('div', 'dsp-rulerow');
    types.appendChild(el('span', 'dsp-label', 'Entity-types'));
    this.typeBoxes = {};
    TYPE_KEYS.forEach(function (t) {
      var lab = el('label', 'dsp-check');
      var cb = el('input');
      cb.type = 'checkbox';
      cb.checked = self.rules.types[t[1]] !== false;
      cb.addEventListener('change', function () { self.rules.types[t[1]] = !!cb.checked; self.rulesChanged(); });
      lab.appendChild(cb);
      lab.appendChild(el('span', null, ENTITIES[t[1]].plural));
      lab.title = 'Read and rewrite ' + ENTITIES[t[1]].plural.toLowerCase() + ' in this run. Off: none is read at all.';
      self.typeBoxes[t[1]] = cb;
      types.appendChild(lab);
    });
    box.appendChild(types);

    // Removal: a tag, and how much goes with what carries it or any tag under it.
    var rem = el('div', 'dsp-rulerow');
    var remLab = el('label', 'dsp-rule');
    remLab.title = 'Everything carrying this tag or any of its child tags - scenes, images, galleries, groups, ' +
      'performers, studios and scene markers - is listed for removal, one line each. Empty, nothing is removed.';
    remLab.appendChild(el('span', null, 'Remove everything tagged'));
    this.removeInput = el('input', 'dsp-textbox');
    this.removeInput.type = 'text';
    this.removeInput.value = this.removeTag;
    this.removeInput.placeholder = 'a tag name';
    this.removeInput.addEventListener('change', function () {
      self.removeTag = trim(self.removeInput.value);
      self.rulesChanged();
    });
    remLab.appendChild(this.removeInput);
    rem.appendChild(remLab);
    var delLab = el('label', 'dsp-rule');
    delLab.title = 'What a removal deletes. Media files deleted are gone from the disk: not even the backup ' +
      'brings them back.';
    delLab.appendChild(el('span', null, 'Deleting'));
    this.deletesSel = C.dropdown('dsp-rulesel');
    Object.keys(REMOVE_DELETES).forEach(function (k) {
      var o = el('option', null, REMOVE_DELETES[k].label);
      o.value = k;
      self.deletesSel.appendChild(o);
    });
    this.deletesSel.value = this.removeDeletes;
    this.deletesSel.addEventListener('change', function () {
      self.removeDeletes = deletesOf(self.deletesSel.value);
      self.syncRemoval();
      self.syncFooter();
    });
    delLab.appendChild(this.deletesSel);
    rem.appendChild(delLab);
    box.appendChild(rem);
    this.modal.appendChild(box);
    this.syncRules();
    this.syncRemoval();
  };

  // The strong level on the removal controls while a tag is named.
  Run.prototype.syncRemoval = function () {
    C.markLevel(this.deletesSel, this.removeTag ? 'strong' : '');
    C.markLevel(this.removeInput, this.removeTag ? 'strong' : '');
  };

  // After each rule what it means right now (`autoNote`), and the words' count.
  Run.prototype.syncRules = function () {
    var self = this;
    CATEGORIES.forEach(function (c) {
      self.ruleNotes[c.key].textContent = autoNote(self.selects[c.key].value, self.rules.goals, c.key);
    });
    this.termsEl.textContent = this.terms.length ? plural(this.terms.length, 'explicit term') : 'No explicit terms';
    this.termsEl.title = this.terms.length
      ? 'Vanillify rewrites these, set in this plugin\'s Explicit Terms:\n' + this.terms.slice(0, 40).map(function (w) {
        return w.from + (w.to ? ' → ' + w.to : ' (removed)');
      }).join('\n') + (this.terms.length > 40 ? '\n…and ' + (this.terms.length - 40) + ' more' : '')
      : 'Vanillify rewrites the terms in this plugin\'s Explicit Terms setting, and it is empty.';
  };

  Run.prototype.rulesChanged = function () {
    this.syncRules();
    this.syncRemoval();
    if (this.state === 'listing' && !this.changes.length) this.rescan();
  };

  Run.prototype.saveRules = function () {
    var self = this;
    var patch = settingsFrom(this.rules);
    patch.e1RemoveTag = this.removeTag;
    patch.e2RemoveDeletes = this.removeDeletes;
    this.saveRulesBtn.disabled = true;
    C.writePluginSettings(PLUGIN_ID, patch, 'DSPRules').then(function () {
      self.msg('INFO', 'Saved as the defaults: the goals, the entity-types and the rule for each kind of data, ' +
        (self.removeTag ? 'removing everything tagged "' + self.removeTag + '" (' +
          REMOVE_DELETES[self.removeDeletes].label.toLowerCase() + ')' : 'removing nothing') + '.');
    }, function (e) {
      self.msg('ERROR', 'The defaults were not saved: ' + (e && e.message ? e.message : String(e)));
    }).then(function () { self.saveRulesBtn.disabled = self.state !== 'listing'; });
  };

  Run.prototype.backup = function () {
    var self = this;
    this.backupBtn.disabled = true;
    this.msg('INFO', 'Asking Stash to back up its database.');
    gqlRequest('mutation DSPBackup($input: BackupDatabaseInput!) { backupDatabase(input: $input) }',
      { input: { download: false } }).then(function () {
      self.msg('INFO', 'Stash has backed up its database, next to it on the server.');
    }, function (e) {
      self.msg('ERROR', 'The backup failed: ' + (e && e.message ? e.message : String(e)));
    }).then(function () { self.backupBtn.disabled = false; });
  };

  Run.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
  };

  Run.prototype.show = function (node, visible) {
    node.className = node.className.replace(/\s*dsp-hidden/g, '') + (visible ? '' : ' dsp-hidden');
  };

  Run.prototype.showStale = function (msg) {
    this.staleEl.textContent = msg || '';
    if (msg) staleReloadButton(this.staleEl);
    this.show(this.staleEl, !!msg);
  };

  Run.prototype.setState = function (state) {
    this.state = state;
    var busy = state !== 'listing';
    // A scan or a final check can always be left: closing ends it (`alive`). A write, an undo
    // or a clean-up cannot be walked away from halfway.
    this.closeBtn.disabled = busy && state !== 'scanning' && state !== 'checking';
    this.copyBtn.disabled = false;
    // A rule decides what a scan lists; changed under a write, it would change nothing the
    // write is doing, and after one the listing describes a library this dialog changed.
    var locked = busy || this.changes.length > 0;
    for (var g in this.goalBoxes) if (hasOwn(this.goalBoxes, g)) this.goalBoxes[g].disabled = locked;
    for (var k in this.selects) if (hasOwn(this.selects, k)) this.selects[k].disabled = locked;
    for (var t in this.typeBoxes) if (hasOwn(this.typeBoxes, t)) this.typeBoxes[t].disabled = locked;
    this.removeInput.disabled = this.deletesSel.disabled = locked;
    this.saveRulesBtn.disabled = busy;
    if (this.backupBtn) this.backupBtn.disabled = busy;
    this.syncFilterButtons();
    this.syncFooter();
    this.syncClean();
    paintButton(this.closeBtn, this.closeColor());
    this.spin(busy);
  };

  // Green when there is nothing more for this dialog to do: nothing listed, or nothing left after a write.
  Run.prototype.closeColor = function () {
    var done = !this.hits.length || (this.wrote && !this.leftOver().total);
    return this.state === 'listing' && done ? 'btn-success' : 'btn-secondary';
  };

  Run.prototype.syncFooter = function () {
    var open = this.openHits();
    this.selAllBtn.disabled = this.state !== 'listing' || open.every(function (h) { return h.checked !== false; });
    this.unselAllBtn.disabled = this.state !== 'listing' || open.every(function (h) { return h.checked === false; });
    var noScan = this.state !== 'listing' ? 'Still working.'
      : this.changes.length ? 'Undo first: a scan now would list what this dialog wrote.' : '';
    this.rescanBtn.disabled = !!noScan;
    this.rescanBtn.title = noScan || 'Read the library again from the start and list what the rules change. ' +
      'Every tick starts over.';
    if (this.changes.length) {
      this.goBtn.textContent = 'Undo';
      this.goBtn.disabled = this.state !== 'listing';
      this.goBtn.title = 'Put back what each field held before Proceed. Only what this dialog wrote, and ' +
        'only while it stays open.';
      return;
    }
    this.goBtn.textContent = 'Proceed';
    var picked = this.enabledHits().length, left = this.wrote ? this.leftOver() : null;
    var movedOut = left && left.moved ? ' ' + plural(left.moved, 'line') + ' changed since the scan ' +
      (left.moved === 1 ? 'is' : 'are') + ' left out: written now, each would only be found changed again - Rescan lists ' +
      (left.moved === 1 ? 'it' : 'them') + ' afresh.' : '';
    var why = this.state !== 'listing' ? 'Still working.'
      : this.settings.unreadable ? 'The settings could not be read: close and open again before writing.'
      : this.scanFailed ? 'The scan did not finish (' + this.scanFailed + '): a run renames names, and a mention in what ' +
        'it did not read would keep the real one, past any later run\u2019s finding. Rescan first.'
      : this.exclusionMissing && this.exclusionMissing.length ? 'No tag is named "' + this.exclusionMissing.join('" or "') +
        '", which Exclusions names: entities meant to be left alone would be rewritten. Name a tag that exists, or clear ' +
        'the setting, then close and open again.'
      : this.stale ? 'Reload the page first: this tab is running an older script.'
        : picked ? ''
          : !left ? 'Nothing is ticked and showing.'
            : !left.total ? 'Everything listed was written. Close, or Rescan to start over.'
              : 'Everything ticked was written; left: ' + leftText(left) + '.' + movedOut;
    this.goBtn.disabled = !!why;
    if (why) { this.goBtn.title = why; return; }
    var p = this.plan();
    if (left) {
      var failed = this.enabledHits().filter(function (h) { return h.failed; }).length;
      this.goBtn.title = 'Write the ' + plural(picked, 'line') + ' left: ' + [failed ? num(failed) + ' failed' : '',
        picked - failed ? num(picked - failed) + ' not written yet' : ''].filter(Boolean).join(', ') + '.' + movedOut;
      return;
    }
    this.goBtn.title = 'Write ' + plural(picked - p.removals.length, 'change') + ' to ' +
      plural(p.entities.length, 'entity', 'entities') + (p.removals.length ? ' and remove ' +
      plural(p.removals.length, 'entity', 'entities') : '') + '.';
  };

  Run.prototype.spin = function (on) {
    if (!on) {
      if (this.spinEl && this.spinEl.parentNode) this.spinEl.parentNode.removeChild(this.spinEl);
      this.spinEl = null;
      return;
    }
    if (!this.spinEl) this.spinEl = C.busyCursor('div', 'dsp-spin');
    this.logEl.appendChild(this.spinEl);
  };

  Run.prototype.msg = function (kind, message) {
    var line = el('div', 'dsp-line dsp-' + kind);
    line.textContent = '[' + kind + '] ' + message;
    this.logEl.appendChild(line);
    this.logText.push('[' + kind + '] ' + message);
    this.kinds = this.kinds || {};
    this.kinds[kind] = (this.kinds[kind] || 0) + 1;
    this.logDropped = (this.logDropped || 0) + keepLog(this.logText);
    if (this.spinEl) this.logEl.appendChild(this.spinEl);
    if (this.logEl && typeof this.logEl.scrollHeight === 'number') this.logEl.scrollTop = this.logEl.scrollHeight;
    if (logsToConsole(PLUGIN_ID)) dsp('[dsp] ' + kind + ': ' + message);
    return line;
  };

  // A line about one entity: its label a link carrying the listing's hover card, where its type has a
  // page, and what follows with a hover box of its own (`tip`), so the line stays short.
  Run.prototype.entityLine = function (kind, ent, text, tip) {
    var label = this.entityLabel(ent), line = this.msg(kind, label + text), route = ENTITIES[ent.typeKey].route;
    if (!route && !tip) return line;
    line.textContent = '[' + kind + '] ';
    if (route) {
      var a = el('a', 'dsp-ent', label);
      a.href = route + ent.entId;
      a.target = linkTarget();
      a.rel = 'noopener noreferrer';
      entityTip(a, ent.typeKey, ent.entId);
      line.appendChild(a);
    } else line.appendChild(document.createTextNode(label));
    var rest = line.appendChild(el('span', tip ? 'dsp-changed' : null, text));
    if (tip) rest.title = tip;
    return line;
  };

  Run.prototype.note = function (message) {
    this.msg('WARN', message);
    this.noteEl.textContent = this.noteEl.textContent ? this.noteEl.textContent + ' ' + message : message;
  };

  Run.prototype.checkVersion = function () {
    var self = this;
    C.installedVersion(PLUGIN_ID, 'DSPPluginVersion').then(function (installed) {
      if (!installed || installed === PLUGIN_VERSION) { self.showStale(''); return; }
      self.stale = true;
      var msg = '⚠ This page is running ' + PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION +
        ', but Stash has ' + installed + ' installed. Reload the page (F5) before writing ' +
        'anything; if this warning comes back, hard-refresh with Ctrl+Shift+R ' +
        '(⌘+Shift+R on a Mac).';
      self.msg('WARN', msg);
      self.showStale(msg);
      self.syncFooter();
    });
  };

  // ── The scan ──────────────────────────────────────────────────────────────

  Run.prototype.begin = function () {
    var self = this;
    this.setState('scanning');
    if (this.settings.unreadable) {
      this.msg('ERROR', 'This plugin\'s settings could not be read (' + this.settings.unreadable + '), so the scan ' +
        'runs on the defaults and nothing can be written: the secret pseudonyms come from and the record of those ' +
        'already written are unknown. Close and open again.');
    }
    this.checkVersion();
    var r = this.rules;
    var ways = CATEGORIES.map(function (c) { return c.label + ' ' + wayLabel(c.key, wayOf(r, c.key)).toLowerCase(); });
    this.msg('INFO', 'Goals: ' + ([r.goals.anonymize ? 'Anonymize' : '', r.goals.vanillify ? 'Vanillify' : '']
      .filter(Boolean).join(' and ') || 'none') + '. ' + ways.join(', ') + '.');
    var leaks = leaksOf(r);
    if (leaks.length) {
      this.msg('WARN', 'Anonymize is on, but these still lead back to the originals: ' + leaks.join('; ') + '. ' +
        'Their rules are in the settings and in this dialog.');
    }
    if (r.goals.anonymize) {
      this.msg('INFO', 'Left as Stash keeps them, out of any plugin\'s reach: each file\'s fingerprints (phash, ' +
        'oshash, checksum) and duration. A stash-box such as StashDB can match every scene by them, whatever its ' +
        'text says - so a copy shared as anonymous is not, to anyone who looks them up.');
    }
    if (r.goals.vanillify && !this.terms.length) {
      this.msg('INFO', 'Vanillify is on, but this plugin\'s Explicit Terms setting is empty, so it has no ' +
        'terms to rewrite.');
    }
    var off = TYPE_KEYS.filter(function (t) { return r.types[t[1]] === false; })
      .map(function (t) { return ENTITIES[t[1]].plural; });
    if (off.length) this.msg('INFO', 'Not read at all, as Entity-Types says: ' + off.join(', ') + '.');
    this.msg('INFO', this.recordUndo
      ? 'What is written is recorded in Undo History, so it can be undone after this dialog closes.'
      : 'What is written is not recorded in Undo History: Record in Undo History is off (Removal and Safety, Real Library or Copy).');
    this.isOwned = C.ownedFields(this.settings.others);   // what other ᝯㄝₓ plugins keep, left alone
    linesDrawn();   // asked now, so Core's settings are read by the time the listing is drawn
    this.ctxBase = { words: r.goals.vanillify ? termReplacer(this.terms, this.settings.f2Plurals) : null, names: null };
    this.ctxBase.namer = new Namer(this.salt, this.record, this.newSalt || hasOwn(this.record, NO_LEGACY), randomKinds(r), this.ctxBase.words);
    this.sfmField = null;
    this.unarchived = 0;
    this.textNames = wayOf(r, 'text') === 'pseudonym';
    this.noting = true;
    this.sinkFn = this.sink.bind(this);
    fieldLocks().then(function (locks) {
      self.locks = locks;
      return self.askArchive();
    }).then(function () {
      return self.resolveExclusions();
    }).then(function () {
      return self.describe();
    }).then(this.step('scanNames')).then(this.step('scanRest')).then(this.step('scanFieldNames')).then(this.step('scanMarkers'))
      .then(this.step('scanFilters')).then(this.step('scanDescriptions')).then(this.step('scanRemovals'))
      .then(function () {
        self.alive();
        self.finishScan();
      }).then(null, function (e) {
        if (e === CLOSED) return;
        self.scanFailed = e && e.message ? e.message : String(e);
        self.msg('ERROR', 'The scan failed: ' + self.scanFailed + '. Nothing can be written from a scan that did not ' +
          'finish - Rescan to read it all.');
        self.finishScan();
      });
  };

  // A scan stops where it is once its dialog is closed - the final check's run once the dialog
  // that started it is: `alive` throws CLOSED between steps and before and after every page read.
  var CLOSED = { closed: true };
  Run.prototype.alive = function () {
    if (this.closed || (this.parent && this.parent.closed)) throw CLOSED;
  };
  Run.prototype.step = function (name) {
    var self = this;
    return function () { self.alive(); return self[name](); };
  };

  // Each exclusion tag is found as the settings row's 🔗 finds it (Core's `tagMark`): by its name or an
  // alias, in any case. Found, the setting stands for the tag's own name, which is what an entity's
  // tags say. Not found, nothing can carry it, so no page reads every entity's tags for it: a default
  // name, prefilled, which most libraries have no tag for, is said in an INFO line; a name typed is
  // most likely a tag misspelled, so the log warns and Proceed waits (`exclusionMissing`) - the
  // entities meant to be left alone would be rewritten.
  var EXCLUSION_TAGS = { entityTag: 'h1ExcludeEntityWithTagName', imageTag: 'h3ExcludeImageWithTagName' };
  Run.prototype.resolveExclusions = function () {
    var self = this, x = this.excl = exclusionsOf(this.settings);
    var slots = Object.keys(EXCLUSION_TAGS).filter(function (k) { return x[k]; });
    this.exclusionMissing = [];
    if (!slots.length) return Promise.resolve();
    var vars = {}, parts = slots.map(function (k, i) {
      vars['v' + i] = x[k];
      return 'n' + i + ': findTags(tag_filter: { name: { value: $v' + i + ', modifier: EQUALS } }, filter: { per_page: -1 }) ' +
        '{ tags { name aliases } } a' + i + ': findTags(tag_filter: { aliases: { value: $v' + i + ', modifier: EQUALS } }, ' +
        'filter: { per_page: -1 }) { tags { name aliases } }';
    });
    return gqlRequest('query DSP_ExclusionTags(' + slots.map(function (k, i) { return '$v' + i + ': String!'; }).join(', ') +
      ') { ' + parts.join(' ') + ' }', vars).then(function (data) {
      slots.forEach(function (k, i) {
        var want = x[k], low = want.toLowerCase(), is = function (v) { return String(v).toLowerCase() === low; };
        // Stash's EQUALS is a LIKE, where _ stands for any character: the answer is checked here.
        var tag = ((data['n' + i] || {}).tags || []).filter(function (t) { return is(t.name); })[0] ||
          ((data['a' + i] || {}).tags || []).filter(function (t) { return (t.aliases || []).some(is); })[0];
        if (tag) { x[k] = tag.name; return; }
        x[k] = '';
        var key = EXCLUSION_TAGS[k], field = EXCLUSION_FIELDS.filter(function (f) { return f.key === key; })[0];
        if (want === DEFAULTS[key]) {
          self.msg('INFO', 'No tag is named "' + want + '" by its name or an alias, so "' + field.label + '" leaves nothing ' +
            'alone yet.');
          return;
        }
        self.exclusionMissing.push(want);
        self.msg('WARN', 'No tag is named "' + want + '" by its name or an alias, so "' + field.label + '" would leave ' +
          'nothing alone. Proceed waits: name a tag that exists, or clear the setting, in Settings, then close and open again.');
      });
    });
  };

  // The archive's field, where files are to be renamed at all; without Scene Filename Manager no
  // file is, and the log says why.
  Run.prototype.filesOn = function () {
    var way = wayOf(this.rules, 'files');
    return way === 'pseudonym' || (way === 'keep' && !!this.ctxBase.words);
  };
  Run.prototype.askArchive = function () {
    var self = this;
    if (!this.filesOn()) return Promise.resolve();
    var api = sfmApi();
    if (!api) {
      this.msg('INFO', 'Scene files are not renamed: ' + SFM_NAME + ' 2.2.0 or newer, which keeps the names they ' +
        'can be restored to, is not installed and enabled.');
      return Promise.resolve();
    }
    return api.archiveField().then(function (field) { self.sfmField = field || null; }, function (e) {
      self.msg('WARN', 'Scene files are not renamed: ' + SFM_NAME + ' could not say where it keeps its archive - ' +
        (e && e.message ? e.message : String(e)) + '.');
    });
  };

  // Which of the listed fields this Stash has, as a field of the type and of its update
  // input both: a field the server lacks would fail the whole query.
  Run.prototype.describe = function () {
    var self = this;
    if (_shapes) { this.shapes = _shapes; return Promise.resolve(); }
    return Promise.all([TEXT.introspect('gqlType', 'fields', 'DSP_Shapes'),
      TEXT.introspect('input', 'inputFields', 'DSP_Inputs')]).then(function (both) {
      var out = {};
      Object.keys(FIELDS).forEach(function (k) {
        out[k] = FIELDS[k].filter(function (f) {
          return hasOwn(both[0][k] || {}, f.name) && (f.shape === 'counter' || hasOwn(both[1][k] || {}, f.name));
        });
      });
      _shapes = self.shapes = out;
    });
  };
  var _shapes = null;

  function selectionOf(fields) {
    return fields.map(function (f) { return f.shape === 'ids' ? f.name + ' { endpoint stash_id updated_at }' : f.name; });
  }

  // Every page of one type, each row handed to `each` as it arrives.
  Run.prototype.readAll = function (typeKey, each) {
    var self = this, spec = ENTITIES[typeKey], fields = this.shapes[typeKey] || [];
    if (!fields.length || this.rules.types[typeKey] === false) return Promise.resolve();
    var sel = ['id'].concat(selectionOf(fields));
    if (spec.extra) sel.push(spec.extra);
    if (wayOf(this.rules, 'images') !== 'keep') (IMAGE_FIELDS[typeKey] || []).forEach(function (f) { sel.push(f.sel); });
    if (typeKey === 'scenes' && this.sfmField) sel.push('files { id basename parent_folder { id } }');
    if (fields.every(function (f) { return f.name !== 'custom_fields'; })) sel.push('custom_fields');
    var tagSel = [this.excl.entityTag || this.excl.imageTag ? 'name' : '', this.textNames ? 'id' : ''].filter(Boolean);
    if (typeKey !== 'tags' && tagSel.length) sel.push('tags { ' + tagSel.join(' ') + ' }');
    if (this.textNames && REL_SEL[typeKey]) sel.push(REL_SEL[typeKey]);
    var q = 'query DSP_Scan($f: FindFilterType) { ' + spec.find + '(filter: $f) { count ' + spec.list + ' { ' +
      sel.join(' ') + ' } } }';
    this.loadingWhat = spec.plural;
    function page(p) {
      self.alive();
      return gqlRequest(q, { f: { page: p, per_page: READ_PAGE, sort: 'id', direction: 'ASC' } }).then(function (data) {
        self.alive();
        var block = data[spec.find] || {}, rows = block[spec.list] || [];
        if (typeof block.count === 'number') self.totals[typeKey] = block.count;
        self.scannedPer[typeKey] = (self.scannedPer[typeKey] || 0) + rows.length;
        return inSlices(rows, function (ent) { self.scanned++; each(ent); }).then(function () {
          self.progress();
          if (rows.length === READ_PAGE) return page(p + 1);
        });
      });
    }
    return page(1);
  };

  // The names first, held whole: their pseudonyms are settled - every real name reserved,
  // then one handed out per name in id order - before any text that mentions them is read.
  Run.prototype.scanNames = function () {
    var self = this, rows = {};
    return NAME_TYPES.reduce(function (p, k) {
      return p.then(function () {
        rows[k] = [];
        return self.readAll(k, function (ent) { rows[k].push(ent); });
      });
    }, Promise.resolve()).then(function () {
      var namer = self.ctxBase.namer, kindOf = { performers: 'person', studios: 'studio', groups: 'group', tags: 'tag' };
      // Every real name and alias is taken before the first pseudonym is chosen.
      NAME_TYPES.forEach(function (k) {
        rows[k].forEach(function (ent) {
          namer.reserve(kindOf[k], ent.name);
          (ent.alias_list || (Array.isArray(ent.aliases) ? ent.aliases : [])).forEach(function (a) { namer.reserve(kindOf[k], a); });
        });
      });
      if (wayOf(self.rules, 'text') === 'pseudonym' || /^(pseudonym|random|placeholder)$/.test(wayOf(self.rules, 'filters'))) {
        var pairs = [], tagNamesInText = self.settings.c2bTagNamesInText !== false && self.settings.c2bTagNamesInText !== 'false';
        // What Names makes of a name, for the saved filters' criteria (`recompute`): its pseudonym, or
        // under Placeholder or Blank the entity's placeholder - its aliases go, so a mention of one
        // names the entity - or, kept, null. A name two entities share takes the first one's placeholder.
        // ponytail: matched by the words, as free text is; a criterion's {id, label} item could be
        // relabelled by its id instead, if two entities sharing a name under Placeholder matters.
        var nway = wayOf(self.rules, 'names');
        var asNamed = function (k, ent, to) {
          return nway === 'pseudonym' || nway === 'random' ? to : nway === 'placeholder' || nway === 'blank'
            ? ENTITIES[k].label + ' ' + ent.id : null;
        };
        NAME_TYPES.forEach(function (k) {
          rows[k].forEach(function (ent) {
            // An entity left alone keeps its name wherever it is mentioned, too.
            if (exclusionOf(self.excl, k, ent) === 'entity') return;
            var owner = OWNER[k] + ent.id;
            var to = typeof ent.name === 'string' && ent.name ? namer.of(kindOf[k], ent.name, qualOf(k, ent)) : null;
            // Tag Names in Free Text off: a tag is renamed in its own field alone, as its aliases always are.
            // A name that is its own pseudonym - one a run wrote - pairs with nothing: a match ignores case,
            // and ordinary words reading like it would be recased.
            if (to && to !== ent.name && (k !== 'tags' || tagNamesInText)) pairs.push([ent.name, to, owner, asNamed(k, ent, to)]);
            (ent.alias_list || (Array.isArray(ent.aliases) ? ent.aliases : [])).forEach(function (a) {
              if (typeof a !== 'string' || !a) return;
              var to = namer.of(kindOf[k], a);
              // A tag's aliases are its ordinary words ("Outdoor"): renamed in their own field, never
              // looked for in text.
              if (k !== 'tags' && to !== a) pairs.push([a, to, owner, asNamed(k, ent, to)]);
            });
          });
        });
        var names = self.ctxBase.names = namesReplacer(pairs, 3, self.policy);
        // What a review answered before, for the names it asked about, and what this dialog's answered
        // since it opened - kept across a Rescan.
        Object.keys(names ? names.entries : {}).forEach(function (key) {
          names.entries[key].forEach(function (e) {
            if (!e.single) return;
            e.hash = answerKey(self.salt, e);
            // COMPAT: answers stored by the name alone, unsalted (since De-Spicer 0.13.0); remove when no
            // library holds one. Read as the answer for every owner of that name now, stored afresh under
            // each one's own key at the next Proceed and the old key dropped (`answersToStore`), so an owner
            // added after that is asked.
            var old = writtenKey('name', key);
            if (!hasOwn(self.nameAnswers, e.hash) && hasOwn(self.nameAnswers, old)) {
              self.nameAnswers[e.hash] = self.nameAnswers[old];
              self.oldAnswers[old] = true;
            }
            if (hasOwn(self.nameAnswers, e.hash)) self.policy[e.id] = self.nameAnswers[e.hash];
            if (hasOwn(self.answered, e.id)) self.policy[e.id] = self.answered[e.id];
          });
        });
      }
      return NAME_TYPES.reduce(function (p, k) {
        return p.then(function () { return inSlices(rows[k], function (ent) { self.alive(); self.plan1(k, ent); }); });
      }, Promise.resolve());
    });
  };

  Run.prototype.scanRest = function () {
    var self = this;
    return REST_TYPES.reduce(function (p, k) {
      return p.then(function () { return self.readAll(k, function (ent) { self.plan1(k, ent); }); });
    }, Promise.resolve());
  };

  // Vanillify Custom Field Names: Vanillify on, and the switch.
  // Custom field names kept under Vanillify: their terms rewritten, as kept text's are; never on Never rename.
  Run.prototype.renamesFields = function () {
    this.fieldWords = this.ctxBase.words;
    return !!this.fieldWords && wayOf(this.rules, 'fieldnames') === 'keep';
  };

  // The field names Vanillify rewrites, decided once for the library once every name is read: one
  // field keeps one name everywhere, and a name already there, or taken by another field first in
  // order, is numbered ("Warm rating 2"). Each entity's line goes after its other lines.
  Run.prototype.scanFieldNames = function () {
    var self = this, words = this.fieldWords, map = this.fieldRenames = {}, taken = {};
    if (!this.renameCands.length) return Promise.resolve();
    Object.keys(this.fieldKeys).forEach(function (k) { taken[k.toLowerCase()] = true; });
    this.renameCands.map(function (c) { return c.key; }).sort().forEach(function (key) {
      if (hasOwn(map, key)) return;
      var base = words(key), out = base;
      // A name that is wholly a term with an empty replacement keeps its name: a field needs one.
      if (!trim(base)) return;
      for (var n = 2; hasOwn(taken, out.toLowerCase()); n++) out = base + ' ' + n;
      map[key] = out;
      taken[out.toLowerCase()] = true;
    });
    var f = F('custom_fields', 'fieldnames', 'rename'), extra = {};
    this.renameCands.forEach(function (c) {
      if (!hasOwn(map, c.key)) return;
      var at = c.typeKey + '/' + c.id;
      (extra[at] || (extra[at] = [])).push([c, map[c.key]]);
    });
    var hits = this.hits, add = function (list) {
      list.forEach(function (x) { self.addHit(x[0].typeKey, x[0].ent, x[0].name, f, x[0].key, x[0].key, x[1], x[0].id); });
    };
    this.hits = [];
    hits.forEach(function (h, i) {
      self.hits.push(h);
      var at = h.typeKey + '/' + h.entId, next = hits[i + 1];
      if (extra[at] && !(next && next.typeKey + '/' + next.entId === at)) { add(extra[at]); delete extra[at]; }
    });
    Object.keys(extra).forEach(function (at) { add(extra[at]); });
    this.renameCands = [];
    return Promise.resolve();
  };

  // The changes the rules make to one entity, each a line of its own.
  Run.prototype.plan1 = function (typeKey, ent) {
    var self = this;
    if (isPluginStore(ent)) { this.skipped++; return; }
    var ex = exclusionOf(this.excl, typeKey, ent);
    // This plugin's own exclusion tags are counted with the exclusions, as before.
    var owner = typeKey === 'tags' && ent.name !== this.excl.entityTag && ent.name !== this.excl.imageTag ? this.excl.ownedTag(ent) : null;
    if (owner) this.ownedTagsSeen.push('"' + ent.name + '" (' + owner + ')');
    else if (ex) this.excludedSeen[ex]++;
    // Every field name in the library, so a renamed one never takes a name already there.
    var held = ent.custom_fields && typeof ent.custom_fields === 'object' ? Object.keys(ent.custom_fields) : [];
    held.forEach(function (key) { self.fieldKeys[key] = true; });
    if (ex === 'entity') return;
    var ctx = { namer: this.ctxBase.namer, words: this.ctxBase.words, names: this.ctxBase.names,
      type: typeKey, id: String(ent.id), qual: qualOf(typeKey, ent), rel: this.textNames ? relOf(typeKey, ent) : '',
      sink: this.noting ? this.sinkFn : null };
    // Kept for `recompute`, which has the hit and not the entity; only where there is one.
    if (ctx.qual) (this.quals || (this.quals = {}))[typeKey + ':' + ctx.id] = ctx.qual;
    var hitsWere = this.hits.length, notedWere = this.noted;
    this.seenNow = null;
    var name = displayName(ent) || '';
    (this.shapes[typeKey] || []).forEach(function (f) {
      var way = wayOf(self.rules, f.cat);
      if (f.shape === 'map') {
        var cf = ent.custom_fields;
        if (!cf || typeof cf !== 'object') return;
        Object.keys(cf).sort().forEach(function (key) {
          if (self.isOwned(key)) { self.ownedSeen[key] = true; return; }
          // This plugin's own Leave Alone fields: renamed or blanked, they would stop protecting.
          if (key === self.excl.imageField || key === self.excl.entityField) return;
          if (self.renamesFields() && self.fieldWords(key) !== key) {
            if (self.fieldLocked(key)) self.lockedOut++;
            else self.renameCands.push({ typeKey: typeKey, ent: { id: ent.id }, name: name, key: key, id: ctx.id });
          }
          var r = treatValue(ctx, key, cf[key], way);
          if (!r) return;
          if (self.fieldLocked(key)) { self.lockedOut++; return; }
          self.addHit(typeKey, ent, name, f, key, cf[key], r[0], ctx.id);
        });
        return;
      }
      if (way === 'never' || (way === 'keep' && !ctx.words)) return;
      var r = treat(ctx, f, ent[f.name], way);
      if (r) self.addHit(typeKey, ent, name, f, null, ent[f.name], r[0], ctx.id);
      if (self.seenNow) self.noteField(typeKey, ctx.id, name, f, null, ent[f.name], !!r);
    });
    // Its relations, only where a line or a kept field may be worked out again: one string per entity
    // scanned was most of a large library's scan.
    if (ctx.rel.length > 1 && (this.hits.length > hitsWere || this.noted > notedWere)) this.rels[typeKey + ':' + ctx.id] = ctx.rel;
    if (typeKey === 'scenes' && this.sfmField) this.planFiles(ent, name, ctx);
    var iway = wayOf(this.rules, 'images');
    if (iway === 'keep' || ex === 'image') return;
    (IMAGE_FIELDS[typeKey] || []).forEach(function (f) {
      var url = f.read(ent);
      if (realImage(url)) self.addHit(typeKey, ent, name, f, null, url, iway, ctx.id);
    });
  };

  // A scene's files: each one whose original name is archived gets its new name, the extension
  // kept; one with none is counted and left. In copy mode the archive itself is cleared last -
  // it names the real files - and in live mode it is kept, so Restore still works.
  Run.prototype.planFiles = function (ent, name, ctx) {
    var self = this, api = sfmApi();
    var names = api ? api.archivedNames(ent, this.sfmField) : null;
    var way = wayOf(this.rules, 'files');
    var renamed = false;
    (ent.files || []).forEach(function (file) {
      var folder = file.parent_folder ? String(file.parent_folder.id) : '';
      (self.inFolder[folder] || (self.inFolder[folder] = {}))[String(file.basename).toLowerCase()] = String(file.id);
      if (!names || !hasOwn(names, String(file.id))) { self.unarchived++; return; }
      var parts = splitName(file.basename);
      var stem = way === 'pseudonym' ? ctx.namer.of('file', names[String(file.id)]) : parts[0];
      if (ctx.words) stem = ctx.words(stem);
      var next = safeName(stem) + parts[1];
      if (!stem || next === file.basename) return;
      renamed = true;
      self.hits.push({ typeKey: 'scenes', entId: String(ent.id), entName: name, field: 'files', cat: 'files',
        shape: 'file', label: 'File', slot: String(file.id), folder: folder || null,
        before: file.basename, after: next, checked: true });
    });
    var cf = ent.custom_fields || {};
    if (!this.keepArchive && hasOwn(cf, this.sfmField) && this.fieldLocked(this.sfmField)) this.lockedOut++;
    else if (!this.keepArchive && hasOwn(cf, this.sfmField)) {
      this.hits.push({ typeKey: 'scenes', entId: String(ent.id), entName: name, field: 'custom_fields', cat: 'files',
        shape: 'archive', label: 'Archived filenames "' + this.sfmField + '"', slot: this.sfmField,
        before: cf[this.sfmField], after: null, checked: true });
    }
  };

  // Two originals can draw one pseudonym, and Stash refuses a name already in the folder: in scan
  // order, a name another file there holds, or an earlier file is given, gets a number, as a name
  // does. A file's own name is never taken from it, so a second run settles on what the first gave.
  Run.prototype.settleFiles = function () {
    var held = this.inFolder, given = {};
    this.hits = this.hits.filter(function (h) {
      if (h.shape !== 'file') return true;
      var f = h.folder || '', hold = held[f] || {}, got = given[f] || (given[f] = {});
      var free = function (v) { var k = v.toLowerCase(); return (!hasOwn(hold, k) || hold[k] === h.slot) && !hasOwn(got, k); };
      var parts = splitName(h.after), out = h.after;
      for (var n = 2; !free(out); n++) out = parts[0] + ' ' + n + parts[1];
      got[out.toLowerCase()] = true;
      h.after = out;
      return out !== h.before;
    });
  };

  // A change: everything about it is a reference to something shared - the type, the entity's id and
  // name, the field - but its slot and its hash. `checked` is left out (absent is ticked) and `done`
  // is there from the start, so marking it written does not grow every change of a large plan.
  Run.prototype.addHit = function (typeKey, ent, name, f, slot, before, after, id) {
    var h = { typeKey: typeKey, entId: id || String(ent.id), entName: name, field: f.name, cat: f.cat, shape: f.shape,
      slot: slot, hash: hashOf(before), done: false };
    if (f.label) h.label = f.label;
    // An untitled entity is listed by its file's name, which its image's card must not show (`drawImage`).
    if (f.shape === 'image' && !(ent.title || ent.name)) h.untitled = true;
    if (!this.lean || KEEP_VALUES[f.shape]) { h.before = before; h.after = after; }
    if (after === 'blur') h.strength = strengthOf(this.settings.d1BlurStrength);
    // What its Undo History entry will weigh, counted while the values are here (`unkeptUndo`).
    // ponytail: string lengths plus a row's fixed fields, every hit counted ticked or not - an
    // estimate for a warning; Core weighs the real rows as it writes them.
    this.journalBytes += JOURNAL_ROW_BYTES + String(name).length + String(before).length + String(after).length;
    this.hits.push(h);
    if (!this.lean && this.hits.length > LEAN_ABOVE) this.goLean();
  };

  // Past LEAN_ABOVE changes: every change held so far gives its values up, and every one after
  // keeps only its hash (`addHit`).
  Run.prototype.goLean = function () {
    this.lean = true;
    this.hits.forEach(function (h) {
      if (KEEP_VALUES[h.shape]) return;
      h.before = h.after = undefined;
    });
  };

  // ── Single-word names in free text ────────────────────────────────────────
  //
  // While the scan plans, each single-word name found in text is counted - in related text, in
  // unrelated text, in lower case - and the fields it was found in are kept by name, the value too
  // where no line was made, so an answer re-plans those fields alone (`replanNames`).
  Run.prototype.sink = function (what, e, text, from, to) {
    var st = this.nameStats[e.id] || (this.nameStats[e.id] = { e: e, related: 0, unrelated: 0, lower: 0, snips: [] });
    st[what]++;
    if (what === 'lower') return;
    if (what === 'unrelated' && st.snips.length < 3) {
      var c = matchContext(text, from, to - from);
      st.snips.push(c.pre + '[' + c.hit + ']' + c.post);
    }
    var seen = this.seenNow || (this.seenNow = []);
    if (seen.indexOf(e.id) === -1) seen.push(e.id);
  };
  Run.prototype.noteField = function (typeKey, id, name, f, slot, value, hit) {
    var self = this, o = { t: typeKey, id: id, n: name, f: f, s: slot, v: hit ? undefined : value };
    this.noted++;
    this.seenNow.forEach(function (k) { (self.occ[k] || (self.occ[k] = [])).push(o); });
    this.seenNow = null;
  };

  // The fields these names were found in, worked out again under the answers as they are now: a line
  // made where there was none, changed, or dropped where nothing is left to change.
  // ponytail: a lean plan's line holds no value, so one left with nothing to change stays listed and
  // writes its field unchanged; dropping it would mean reading every such field first.
  Run.prototype.replanNames = function (keys) {
    var self = this, index = {}, pass = this.pass = (this.pass || 0) + 1;
    function idOf(t, id, field, slot) { return t + '|' + id + '|' + field + '|' + (slot == null ? '' : slot); }
    this.hits.forEach(function (h) { if (h.shape !== 'rename') index[idOf(h.typeKey, h.entId, h.field, h.slot)] = h; });
    keys.forEach(function (k) {
      (self.occ[k] || []).forEach(function (o) {
        // A field holding two of these names is worked out once.
        if (o.pass === pass) return;
        o.pass = pass;
        var id = idOf(o.t, o.id, o.f.name, o.s), h = index[id];
        if (h) {
          if (h.before === undefined) return;
          h.after = self.recompute(h, h.before);
          if (same(h.after, h.before)) {
            o.v = h.before;
            self.hits.splice(self.hits.indexOf(h), 1);
            delete index[id];
          }
          return;
        }
        if (o.v === undefined) return;
        var after = self.recompute({ typeKey: o.t, entId: o.id, field: o.f.name, slot: o.s }, o.v);
        if (same(after, o.v)) return;
        self.addHit(o.t, { id: o.id }, o.n, o.f, o.s, o.v, after, o.id);
        index[id] = self.hits[self.hits.length - 1];
        o.v = undefined;
      });
    });
  };

  // After the scan: the names found in unrelated text are the ones to decide. Never found there, a
  // name needs no answer - Everywhere and Only where related do the same. One answered before keeps
  // its answer; the first REVIEW_MAX of the rest are asked about at the top of the listing - a
  // performer's name before any other, then by how often - and each is preset: Only where related for
  // a word also written in lower case or found three times or more in unrelated text - a common word -
  // Everywhere for a rare one. A performer's name past REVIEW_MAX is preset Everywhere whatever it is:
  // not asked about, a person's name is never left in text that would tell who she is. What a field
  // was kept for (`occ`) goes for every name no answer can reach.
  Run.prototype.settleNames = function () {
    var self = this;
    this.noting = false;
    if (!this.ctxBase || !this.ctxBase.names) return;
    var rows = Object.keys(this.nameStats).map(function (k) { return self.nameStats[k]; })
      .filter(function (st) { return st.unrelated > 0; })
      .sort(function (a, b) {
        return (b.e.kind === 'p') - (a.e.kind === 'p') || b.unrelated - a.unrelated || (a.e.id < b.e.id ? -1 : 1);
      });
    var keep = {};
    rows.forEach(function (st) { keep[st.e.id] = true; });
    Object.keys(this.occ).forEach(function (k) { if (!hasOwn(keep, k)) delete self.occ[k]; });
    var rv = { asked: [], defaulted: [], remembered: [], open: false }, wide = [];
    rows.forEach(function (st) {
      if (hasOwn(self.nameAnswers, st.e.hash)) { rv.remembered.push(st); return; }
      var asked = rv.asked.length < REVIEW_MAX;
      st.preset = !asked && st.e.kind === 'p' ? 'e' : st.lower || st.unrelated >= 3 ? 'r' : 'e';
      // An answer given before a Rescan stands.
      if (st.preset === 'e' && !hasOwn(self.answered, st.e.id)) { self.policy[st.e.id] = 'e'; wide.push(st.e.id); }
      (asked ? rv.asked : rv.defaulted).push(st);
    });
    if (wide.length) this.replanNames(wide);
    if (!rows.length) return;
    this.review = rv;
    var everywhere = rv.defaulted.filter(function (st) { return st.preset === 'e'; }).length;
    this.msg('INFO', 'Names in free text: ' + plural(rows.length, 'single-word name') + ' also ' +
      (rows.length === 1 ? 'appears' : 'appear') + ' in text unrelated to ' + (rows.length === 1 ? 'it' : 'them') + ' - ' +
      [rv.asked.length ? rv.asked.length + ' to decide at the top of the listing' : '',
        rv.defaulted.length ? rv.defaulted.length + ' set by default (' + (rv.defaulted.length - everywhere) +
          ' only where related, ' + everywhere + ' everywhere)' : '',
        rv.remembered.length ? rv.remembered.length + ' answered before' : ''].filter(Boolean).join(', ') + '.');
  };

  // At Proceed: the answer to every name the listing asked about or remembered - shown, or changed and
  // hidden again - so a later scan asks only about names it has not shown; the old keys read for them
  // go. `{ map, text }`, kept by `storeSalt` once the write succeeds; null when nothing changes.
  // With `storedText`, the answers stored now: another dialog's are kept beside this one's.
  Run.prototype.answersToStore = function (storedText) {
    var self = this, rv = this.review, map = {}, k, stored = storedText == null ? {} : parseAnswers(storedText);
    for (k in stored) if (hasOwn(stored, k) && !hasOwn(this.oldAnswers, k)) map[k] = stored[k];
    for (k in this.nameAnswers) if (hasOwn(this.nameAnswers, k) && !hasOwn(this.oldAnswers, k)) map[k] = this.nameAnswers[k];
    if (rv) rv.asked.concat(rv.remembered).forEach(function (st) {
      map[st.e.hash] = hasOwn(self.policy, st.e.id) ? self.policy[st.e.id] : 'r';
    });
    var text = answersText(map);
    return text === (storedText == null ? this.answersStored : answersText(stored)) ? null : { map: map, text: text };
  };

  var ANSWERS = [
    ['e', 'Everywhere', 'Replace this name in every text it is found in, related to it or not.'],
    ['r', 'Only where related', 'Replace it only in the text of what it belongs to or is linked with: a performer\'s ' +
      'own details and its scenes, galleries and images, a studio\'s scenes, a group\'s scenes, a tag\'s tagged entities.'],
    ['n', 'Never', 'Leave this word in every text. The name itself, in its own field, is still renamed.'],
  ];
  var OWNER_LABEL = { p: 'Performer', s: 'Studio', g: 'Group', t: 'Tag' };
  Run.prototype.reviewBlock = function () {
    var self = this, rv = this.review, box = el('div', 'dsp-review');
    var head = box.appendChild(el('div', 'dsp-review-head', 'Names in free text - ' +
      (rv.asked.length ? plural(rv.asked.length, 'name') + ' to decide' : 'all answered before')));
    head.title = 'Single-word names found in text unrelated to them, where the word may be an ordinary one ("Summer", ' +
      '"Angel"). Each answer changes the lines below at once and is remembered at Proceed, so a later scan asks ' +
      'only about names it has not shown. A word in lower case is never replaced.';
    rv.asked.forEach(function (st) { box.appendChild(self.nameRow(st)); });
    if (rv.defaulted.length) {
      var wide = rv.defaulted.filter(function (st) { return st.preset === 'e'; }).length;
      var more = box.appendChild(el('div', 'dsp-review-more', 'And ' + plural(rv.defaulted.length, 'name') + ' more, set by ' +
        'default: ' + (rv.defaulted.length - wide) + ' only where related, ' + wide + ' everywhere.'));
      more.title = 'Past the names above, which go performers first, then by unrelated mentions. A performer\'s name is ' +
        'replaced everywhere; another ' +
        'word also in lower case, or in unrelated text three times or more, only where related, and a rarer one ' +
        'everywhere. Not remembered: a later scan may ask.';
    }
    if (rv.remembered.length) {
      var t = button((rv.open ? 'Hide' : 'Show') + ' the ' + plural(rv.remembered.length, 'name') + ' answered before',
        'dsp-review-toggle dsp-filterbtn');
      t.title = rv.open ? 'Hide the names a review answered before.' : 'Show the names a review answered before, to change ' +
        'an answer; a change is remembered at Proceed.';
      t.addEventListener('click', function () { rv.open = !rv.open; self.renderHits(); });
      box.appendChild(t);
      if (rv.open) rv.remembered.forEach(function (st) { box.appendChild(self.nameRow(st)); });
    }
    return box;
  };
  Run.prototype.nameRow = function (st) {
    var self = this, e = st.e, row = el('div', 'dsp-namerow');
    var cur = hasOwn(this.policy, e.id) ? this.policy[e.id] : 'r';
    var name = row.appendChild(el('span', 'dsp-ent', e.label));
    name.title = 'Found in unrelated text:\n' + st.snips.join('\n');
    var counts = row.appendChild(el('span', 'dsp-attr', (OWNER_LABEL[e.kind] || 'Name') + ' · ' + st.unrelated + ' in unrelated text · ' +
      st.related + ' in related' + (st.lower ? ' · ' + st.lower + ' in lower case' : '')));
    counts.title = 'Unrelated: text of entities not linked to this ' + (OWNER_LABEL[e.kind] || 'name').toLowerCase() +
      '. Related: its own and its linked entities\' text. Lower case: never replaced, and a sign of an ordinary word.' +
      (st.preset ? ' Preset: ' + (st.preset === 'e' ? 'Everywhere' : 'Only where related') + '.' : '');
    ANSWERS.forEach(function (a) {
      var b = button(a[1], 'dsp-answer dsp-filterbtn');
      paintButton(b, a[0] === cur ? PLUGIN_BTN_VARIANT : 'btn-secondary');
      b.title = a[2];
      b.disabled = self.state !== 'listing';
      b.addEventListener('click', function () { self.answer(e.id, a[0]); });
      row.appendChild(b);
    });
    return row;
  };
  Run.prototype.answer = function (key, a) {
    if (this.state !== 'listing' || this.wrote) return;
    if ((hasOwn(this.policy, key) ? this.policy[key] : 'r') === a) return;
    this.policy[key] = this.answered[key] = a;
    this.replanNames([key]);
    this.renderHits();
  };

  // A change's attribute, worked out rather than held: one string per change was most of a plan.
  function hitLabel(h) {
    return h.label || (h.slot != null ? labelOf(h.field) + ' "' + h.slot + '"' : labelOf(h.field));
  }

  var MARKER_FIELD = F('title', 'names', 'string', 'title');
  var DESCRIPTION_FIELD = F('description', 'text', 'string');
  // The field a change is in, as the scan described it.
  Run.prototype.specOf = function (h) {
    if (h.typeKey === 'markers') return MARKER_FIELD;
    if (h.typeKey === 'descriptions') return DESCRIPTION_FIELD;
    if (h.shape === 'image') return (IMAGE_FIELDS[h.typeKey] || []).filter(function (f) { return f.name === h.field; })[0];
    return (this.shapes[h.typeKey] || []).filter(function (f) { return f.name === h.field; })[0];
  };

  // What a value becomes, from the value as it is now: the scan, the page shown and the write all
  // ask this one function, and the pseudonyms it hands out are the run's, so they agree.
  Run.prototype.recompute = function (h, value) {
    var b = this.ctxBase;
    var ctx = { namer: b.namer, words: b.words, names: b.names, type: h.typeKey, id: h.entId,
      qual: (this.quals || {})[h.typeKey + ':' + h.entId] || '', rel: this.rels[h.typeKey + ':' + h.entId] || '',
      sink: this.noting ? this.sinkFn : null };
    var r;
    if (h.typeKey === 'filters') {
      var fway = wayOf(this.rules, 'filters');
      if (h.field === 'name') {
        var name = fway === 'placeholder' ? 'Filter ' + h.entId : fway === 'pseudonym' || fway === 'random' ? b.namer.of('filter', value) : value;
        return ctx.words ? ctx.words(name) : name;
      }
      // The names in its criteria follow Names, whether the filter's own is a pseudonym, random words or a placeholder.
      var named = fway === 'pseudonym' || fway === 'random' || fway === 'placeholder', renamed = this.fieldRenames || {}, keys = this.fieldKeys || {};
      ctx.names = named && b.names ? function (t, rel, sink) { return b.names(t, rel, sink, true); } : null;
      // A custom field named in the criteria - a custom-field criterion's `field` - follows its field:
      // renamed as it is, or kept with it - renames off, or this field's held back (locked). Any other
      // string is text, whatever field name it happens to equal.
      return walkStrings(value, function (s, key) {
        if (key === 'field' && hasOwn(renamed, s)) return renamed[s];
        if (key === 'field' && hasOwn(keys, s)) return s;
        return rewriteText(ctx, s, named ? 'pseudonym' : 'keep');
      });
    }
    if (h.typeKey === 'descriptions') return rewriteText(ctx, value, wayOf(this.rules, 'text'));
    var f = this.specOf(h), way = wayOf(this.rules, f.cat);
    if (h.slot != null) { r = treatValue(ctx, h.slot, value, way); return r ? r[0] : value; }
    r = treat(ctx, f, value, way);
    return r ? r[0] : value;
  };

  Run.prototype.fieldLocked = function (key) {
    if (this.locks === false) return true;
    return !!this.locks && this.locks.isLocked(key);
  };

  // A scene marker's title, which is a name.
  Run.prototype.scanMarkers = function () {
    var self = this;
    var way = wayOf(this.rules, 'names');
    if ((way === 'keep' && !this.ctxBase.words) || this.rules.types.markers === false) return Promise.resolve();
    var tags = this.excl.entityTag ? ' primary_tag { name } tags { name }' : '';
    var q = 'query DSP_Markers($f: FindFilterType) { findSceneMarkers(filter: $f) { count scene_markers { id title scene { id }' +
      tags + ' } } }';
    var f = F('title', 'names', 'string', 'title');
    this.loadingWhat = 'Markers';
    function page(p) {
      self.alive();
      return gqlRequest(q, { f: { page: p, per_page: READ_PAGE, sort: 'id', direction: 'ASC' } }).then(function (data) {
        self.alive();
        var block = data.findSceneMarkers || {}, rows = block.scene_markers || [];
        if (typeof block.count === 'number') self.totals.markers = block.count;
        self.scannedPer.markers = (self.scannedPer.markers || 0) + rows.length;
        rows.forEach(function (m) {
          self.scanned++;
          if (exclusionOf(self.excl, 'markers', m) === 'entity') { self.excludedSeen.entity++; return; }
          var ctx = { namer: self.ctxBase.namer, words: self.ctxBase.words, names: self.ctxBase.names, type: 'markers', id: String(m.id) };
          // A marker's title may be empty, which no rule but the words has anything to do with.
          var r = treat(ctx, f, m.title, way === 'blank' ? 'blank' : way);
          if (r) self.addHit('markers', m, m.title || '', f, null, m.title, r[0]);
        });
        self.progress();
        if (rows.length === READ_PAGE) return page(p + 1);
      });
    }
    return page(1);
  };

  // A saved filter's name, and every string inside its criteria the names or the words rewrite.
  Run.prototype.scanFilters = function () {
    var self = this;
    var way = wayOf(this.rules, 'filters');
    if (way === 'never' || (way === 'keep' && !this.ctxBase.words) || this.rules.types.filters === false) return Promise.resolve();
    this.loadingWhat = 'Saved filters';
    return gqlRequest('query DSP_Filters { findSavedFilters { id mode name find_filter { q page per_page sort direction } ' +
      'object_filter ui_options } }', null).then(function (data) {
      var list = data.findSavedFilters || [];
      self.totals.filters = list.length;
      self.scannedPer.filters = list.length;
      list.forEach(function (sf) {
        self.scanned++;
        var id = String(sf.id);
        var name = self.recompute({ typeKey: 'filters', field: 'name', entId: id }, sf.name);
        var f = F('name', 'filters', 'string');
        if (name !== sf.name) self.addHit('filters', sf, sf.name, f, null, sf.name, name);
        var crit = { find_filter: sf.find_filter, object_filter: sf.object_filter };
        self.seenNow = null;
        var walked = self.recompute({ typeKey: 'filters', field: 'criteria', entId: id }, crit);
        var cf = F('criteria', 'filters', 'object');
        if (!same(walked, crit)) self.addHit('filters', sf, sf.name, cf, null, crit, walked);
        if (self.seenNow) self.noteField('filters', id, sf.name, cf, null, crit, !same(walked, crit));
      });
      self.progress();
    });
  };

  // Every string in a JSON value, rewritten; the shape and every other value kept.
  // `fn(string, key)`: the key it is under, an array's items under the array's.
  function walkStrings(v, fn, key) {
    if (typeof v === 'string') return fn(v, key);
    if (Array.isArray(v)) return v.map(function (x) { return walkStrings(x, fn, key); });
    if (v && typeof v === 'object') {
      var out = {};
      Object.keys(v).forEach(function (k) { out[k] = walkStrings(v[k], fn, k); });
      return out;
    }
    return v;
  }

  // The descriptions Custom Fields Bulk Editor keeps for each custom field: free text, asked
  // for and written back through the editor, never by rewriting the JSON they are stored in.
  Run.prototype.scanDescriptions = function () {
    var self = this, api = cfbeApi();
    var way = wayOf(this.rules, 'text');
    if (!api || way === 'never' || (way === 'keep' && !this.ctxBase.words)) return Promise.resolve();
    this.loadingWhat = 'Custom field descriptions';
    return api.descriptions().then(function (map) {
      var names = Object.keys(map || {}).sort();
      self.descriptionsRead = names.length;
      names.forEach(function (name) {
        var text = map[name];
        if (typeof text !== 'string' || !text) return;
        if (self.fieldLocked(name)) { self.lockedOut++; return; }
        var ctx = { namer: self.ctxBase.namer, words: self.ctxBase.words, names: self.ctxBase.names, type: 'descriptions', id: name,
          rel: '', sink: self.sinkFn };
        self.seenNow = null;
        var next = rewriteText(ctx, text, way);
        if (next !== text) self.addHit('descriptions', { id: name }, name, DESCRIPTION_FIELD, null, text, next);
        if (self.seenNow) self.noteField('descriptions', name, name, DESCRIPTION_FIELD, null, text, next !== text);
      });
    }, function (e) {
      self.msg('WARN', CFBE_NAME + ' could not be asked for its custom field descriptions, so they are not in this ' +
        'listing: ' + (e && e.message ? e.message : String(e)));
    });
  };

  // Everything carrying the removal tag or any tag under it, by type. Markers first: removing a
  // scene removes its markers with it, and removing a marker already gone would fail.
  var REMOVE_TYPES = [
    { key: 'markers', find: 'findSceneMarkers', arg: 'scene_marker_filter', type: 'SceneMarkerFilterType', list: 'scene_markers', sel: 'id title' },
    { key: 'scenes', find: 'findScenes', arg: 'scene_filter', type: 'SceneFilterType', list: 'scenes', sel: 'id title files { id basename }' },
    { key: 'images', find: 'findImages', arg: 'image_filter', type: 'ImageFilterType', list: 'images',
      sel: 'id title visual_files { ... on ImageFile { id } ... on VideoFile { id } }' },
    { key: 'galleries', find: 'findGalleries', arg: 'gallery_filter', type: 'GalleryFilterType', list: 'galleries', sel: 'id title files { id }' },
    { key: 'groups', find: 'findGroups', arg: 'group_filter', type: 'GroupFilterType', list: 'groups', sel: 'id name' },
    { key: 'performers', find: 'findPerformers', arg: 'performer_filter', type: 'PerformerFilterType', list: 'performers', sel: 'id name' },
    { key: 'studios', find: 'findStudios', arg: 'studio_filter', type: 'StudioFilterType', list: 'studios', sel: 'id name' },
  ];

  // Everything of one type that carries the removal tag or a tag under it, with what Exclusions needs.
  Run.prototype.removalQuery = function (t) {
    var x = this.excl, sel = t.sel + (x.entityTag ? ' tags { name }' + (t.key === 'markers' ? ' primary_tag { name }' : '') : '') +
      (x.entityField && t.key !== 'markers' ? ' custom_fields' : '');
    return gqlRequest('query DSP_Removals($f: FindFilterType, $c: ' + t.type + ') { ' + t.find + '(filter: $f, ' +
      t.arg + ': $c) { ' + t.list + ' { ' + sel + ' } } }', { f: { per_page: -1, sort: 'id', direction: 'ASC' }, c: this.removeCrit })
      .then(function (d) { return (d[t.find] || {})[t.list] || []; });
  };

  Run.prototype.scanRemovals = function () {
    var self = this, name = this.removeTag;
    if (!name) return Promise.resolve();
    this.loadingWhat = 'Removals';
    // By name first, then by alias, as the settings row's link finds it (Core's `tagMark`).
    return gqlRequest('query DSP_RemoveTag($n: String!) { ' +
      'byName: findTags(tag_filter: { name: { value: $n, modifier: EQUALS } }, filter: { per_page: -1 }) { tags { id name } } ' +
      'byAlias: findTags(tag_filter: { aliases: { value: $n, modifier: EQUALS } }, filter: { per_page: -1 }) { tags { id name } } }',
    { n: name }).then(function (data) {
      var tag = ((data.byName || {}).tags || []).filter(function (t) {
        return String(t.name).toLowerCase() === name.toLowerCase();
      })[0];
      var aliased = ((data.byAlias || {}).tags || []);
      if (!tag && aliased.length > 1) {
        self.note('"' + name + '" is an alias of ' + aliased.length + ' tags (' + aliased.map(function (t) { return '"' + t.name + '"'; }).join(', ') +
          '), so nothing is listed for removal: type the one tag\'s name.');
        return null;
      }
      if (!tag && aliased.length) {
        tag = aliased[0];
        self.msg('WARN', 'No tag is named "' + name + '"; it is an alias of "' + tag.name + '", which is used instead.');
      }
      if (!tag) {
        self.note('No tag is named "' + name + '", so nothing is listed for removal.');
        return null;
      }
      self.msg('INFO', 'Listing for removal everything carrying the tag "' + tag.name + '" or a tag under it.');
      self.removeCrit = { tags: { value: [String(tag.id)], modifier: 'INCLUDES', depth: -1 } };
      return REMOVE_TYPES.filter(function (t) { return self.rules.types[t.key] !== false; }).reduce(function (p, t) {
        return p.then(function () {
          var x = self.excl;
          return self.removalQuery(t).then(function (list) {
              list.forEach(function (ent) {
                // Left alone means not removed either.
                if (exclusionOf(x, t.key, ent) === 'entity') { self.excludedRemovals = (self.excludedRemovals || 0) + 1; return; }
                var nm = displayName(ent) || ent.title || '';
                // The files it has, so a removal that keeps them can still offer to delete them after.
                var files = (ent.files || ent.visual_files || []).map(function (f) { return String(f.id); }).filter(Boolean);
                self.hits.push({ typeKey: t.key, entId: String(ent.id), entName: nm, field: '(entity)', cat: 'remove',
                  shape: 'remove', label: 'Removed', slot: null, before: nm, after: 'remove', checked: true, files: files });
              });
            });
        });
      }, Promise.resolve());
    });
  };

  Run.prototype.finishScan = function () {
    this.loadingWhat = '';
    this.settleFiles();
    this.settleNames();
    this.setState('listing');
    var owners = Object.keys(this.ownedSeen).sort();
    if (owners.length) {
      this.msg('INFO', 'Left alone: ' + plural(owners.length, 'custom field') + ' another ᝯㄝₓ plugin keeps - ' +
        owners.map(function (k) { return '"' + k + '"'; }).join(', ') + '. Rewriting one would break its owner.');
    }
    if (this.ownedTagsSeen.length) {
      this.msg('INFO', 'Left alone: ' + plural(this.ownedTagsSeen.length, 'tag') + ' a ᝯㄝₓ plugin\'s settings name - ' +
        this.ownedTagsSeen.join(', ') + '. Renamed, the setting would name nothing.');
    }
    var ex = this.excludedSeen, x = this.excl;
    if (ex.entity || ex.image || this.excludedRemovals) {
      var why = function (tag, field) {
        return [tag ? 'carrying the tag "' + tag + '"' : '', field ? 'holding the custom field "' + field + '"' : '']
          .filter(Boolean).join(' or ');
      };
      this.msg('INFO', 'Left alone, as Exclusions says: ' + [
        ex.entity ? plural(ex.entity, 'entity', 'entities') + ' ' + why(x.entityTag, x.entityField) + ', names included' : '',
        this.excludedRemovals ? plural(this.excludedRemovals, 'entity', 'entities') + ' tagged for removal but excluded, not removed' : '',
        ex.image ? 'the images of ' + plural(ex.image, 'entity', 'entities') + ' ' + why(x.imageTag, x.imageField) : '']
        .filter(Boolean).join('; ') + '.');
    }
    if (this.skipped) {
      this.msg('INFO', 'Left out: the tag ' + CFBE_NAME + ' keeps its custom field descriptions in, as JSON. ' +
        (this.descriptionsRead == null ? 'Its descriptions are reached through ' + CFBE_NAME + ' when it is installed.'
          : 'Its ' + plural(this.descriptionsRead, 'description') + ' went through ' + CFBE_NAME + ' itself.'));
    }
    if (this.lockedOut) {
      this.msg('INFO', 'Left out: ' + plural(this.lockedOut, 'custom field value') + ' in fields ' + CFBE_NAME +
        '’s Locked Custom Fields locks.');
    }
    // What Undo History has no place for, said before Proceed rather than after it.
    var unkept = [];
    if (this.hits.some(function (h) { return h.field === 'stash_ids'; })) unkept.push('stash-ids');
    if (this.hits.some(function (h) { return h.typeKey === 'markers'; })) unkept.push('scene marker titles');
    if (this.hits.some(function (h) { return h.typeKey === 'filters'; })) unkept.push('saved filters');
    if (this.unarchived) {
      this.msg('INFO', 'Not renamed: ' + plural(this.unarchived, 'scene file') + ' with no original name archived by ' +
        SFM_NAME + '. Its Archive Original Filenames task keeps one, after which a run renames them.');
    }
    var planned = this.plan().entities.length;
    if (planned > UNDO_KEEP) {
      this.msg('INFO', 'This plan changes ' + plural(planned, 'entity', 'entities') + ', more than the ' + UNDO_KEEP +
        ' the dialog keeps a copy of for its own Undo: ' + (this.recordUndo ? 'Undo History records it, and is ' +
        'where it is undone.' : 'nothing records it, since Record in Undo History is off.'));
    }
    if (this.lean) {
      this.msg('INFO', 'A plan this large keeps no copy of the values it changes: a page of the listing reads its ' +
        'own when shown, and each field is read again, checked and worked out afresh as it is written.');
    }
    var removals = this.hits.filter(function (h) { return h.shape === 'remove'; }).length;
    if (removals) {
      this.msg('WARN', plural(removals, 'entity', 'entities') + ' listed for removal. A removal is not undone here ' +
        'and not recorded in Undo History; deleted media files are gone from the disk, beyond even the backup.');
    }
    if (this.hits.some(function (h) { return h.shape === 'image'; })) {
      this.msg('WARN', 'Entity images are not recorded in Undo History, and Undo here does not put them back: ' +
        'the backup is the way back for them.');
    }
    if (unkept.length && this.recordUndo) {
      this.msg('INFO', 'Not recorded in Undo History: ' + unkept.join(', ') + '. Undo in this dialog puts ' +
        (unkept.length === 1 ? 'it' : 'them') + ' back while it stays open.');
    }
    if (!this.hits.length) this.msg('INFO', 'Nothing in the library is changed by these goals and rules.');
    else {
      var ents = {};
      this.hits.forEach(function (h) { ents[h.typeKey + '/' + h.entId] = true; });
      this.msg('INFO', plural(this.hits.length, 'change') + ' listed across ' +
        plural(Object.keys(ents).length, 'entity', 'entities') + '.');
    }
    this.buildFilters();
    this.renderHits();
  };

  Run.prototype.progress = function () {
    var self = this;
    var picked = this.state === 'listing' ? this.enabledHits().length : 0;
    var lead = '';
    if (this.state === 'writing' && this.writeTotal) {
      var pace = this.paceFrom, eta = '';
      if (pace && this.writeDone > pace.done && this.writeDone < this.writeTotal) {
        eta = aboutLeft((Date.now() - pace.at) / (this.writeDone - pace.done) * (this.writeTotal - this.writeDone));
      }
      lead = 'Writing ' + num(this.writeDone) + ' of ' + num(this.writeTotal) + ' ' +
        (this.writeTotal === 1 ? 'entity' : 'entities') + (eta ? '  ·  ' + eta : '') + '\n';
    } else if (this.doneHead && this.state === 'listing') lead = this.doneHead + '\n';
    var head = lead + 'Scanned ' + plural(this.scanned, 'entity', 'entities') +
      (this.loadingWhat && this.state === 'scanning' ? ' (' + this.loadingWhat + ')' : '') +
      '  ·  ' + plural(this.hits.length, 'change') + ' found' +
      (this.state === 'listing' ? '  ·  ' + picked + ' to write' : '') +
      (this.written ? '  ·  written ' + this.written : '') +
      (this.failed ? '  ·  ' + plural(this.failed, 'failure') : '');
    var per = TYPE_ORDER.filter(function (k) { return hasOwn(self.scannedPer, k); }).map(function (k) {
      var there = self.totals[k];
      return ENTITIES[k].plural + ' ' + self.scannedPer[k] + (there == null ? '' : '/' + there);
    }).join('  ·  ');
    this.progressEl.textContent = per ? head + '\n' + per : head;
  };

  // ── The filters ───────────────────────────────────────────────────────────
  //
  // Only the types and the kinds of data the scan found changes in. A filter decides what
  // is shown and what Proceed covers; it never touches a tick.
  Run.prototype.buildFilters = function () {
    var self = this;
    this.typeRow.textContent = '';
    this.catRow.textContent = '';
    this.attrRow.textContent = '';
    var types = [], cats = [], attrs = [];
    this.hits.forEach(function (h) {
      if (types.indexOf(h.typeKey) === -1) types.push(h.typeKey);
      if (cats.indexOf(h.cat) === -1) cats.push(h.cat);
      if (attrs.indexOf(attrOf(h)) === -1) attrs.push(attrOf(h));
    });
    this.show(this.filtersEl, types.length > 0);
    types.sort(function (a, b) { return TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b); });
    cats.sort(function (a, b) { return CATEGORIES.indexOf(CAT[a]) - CATEGORIES.indexOf(CAT[b]); });
    if (types.length) {
      this.typeRow.appendChild(el('span', 'dsp-label', 'Entity-types'));
      types.forEach(function (k) { self.typeOn[k] = true; self.typeRow.appendChild(self.toggle(ENTITIES[k].plural, self.typeOn, k)); });
      this.catRow.appendChild(el('span', 'dsp-label', 'Kinds of data'));
      cats.forEach(function (c) { self.catOn[c] = true; self.catRow.appendChild(self.toggle(CAT[c].label, self.catOn, c)); });
      this.attrRow.appendChild(el('span', 'dsp-label', 'Attributes'));
      attrs.sort().forEach(function (a) { self.attrOn[a] = true; self.attrRow.appendChild(self.toggle(a, self.attrOn, a)); });
    }
    this.syncFilterButtons();
  };

  Run.prototype.toggle = function (label, bag, key) {
    var self = this;
    var b = button(label, 'dsp-filterbtn');
    b._bag = bag;
    b._key = key;
    paintButton(b, PLUGIN_BTN_VARIANT);
    b.addEventListener('click', function () {
      if (self.state !== 'listing') return;
      bag[key] = !bag[key];
      paintButton(b, bag[key] ? PLUGIN_BTN_VARIANT : 'btn-secondary');
      self.pageAt = 0;
      self.syncFilterButtons();
      self.renderHits();
    });
    return b;
  };

  Run.prototype.toggles = function () {
    var out = [];
    [this.typeRow, this.catRow, this.attrRow].forEach(function (row) {
      for (var i = 0; i < row.childNodes.length; i++) if (row.childNodes[i]._bag) out.push(row.childNodes[i]);
    });
    return out;
  };

  Run.prototype.syncFilterButtons = function () {
    var toggles = this.toggles(), busy = this.state !== 'listing';
    toggles.forEach(function (b) {
      b.disabled = busy;
      b.title = busy ? 'Not while this dialog is working - what Proceed covers was decided when it started.'
        : 'Show or hide these lines. A hidden line is not written.';
    });
    this.allOnBtn.disabled = busy || !toggles.length || toggles.every(function (b) { return b._bag[b._key]; });
    this.allOffBtn.disabled = busy || !toggles.length || toggles.every(function (b) { return !b._bag[b._key]; });
  };

  Run.prototype.setAllFilters = function (on) {
    if (this.state !== 'listing') return;
    this.toggles().forEach(function (b) {
      b._bag[b._key] = on;
      paintButton(b, on ? PLUGIN_BTN_VARIANT : 'btn-secondary');
    });
    this.pageAt = 0;
    this.syncFilterButtons();
    this.renderHits();
  };

  // A line's attribute as the Attributes filter names it: the field, one toggle for every custom field.
  function attrOf(h) { return h.shape === 'remove' ? 'Removed' : h.shape === 'file' ? 'File' : labelOf(h.field); }

  Run.prototype.visible = function (h) {
    return this.typeOn[h.typeKey] !== false && this.catOn[h.cat] !== false && this.attrOn[attrOf(h)] !== false;
  };
  Run.prototype.enabledHits = function () {
    var self = this;
    return this.hits.filter(function (h) { return h.checked !== false && !h.done && !h.moved && self.visible(h); });
  };
  Run.prototype.openHits = function () {
    var self = this;
    return this.hits.filter(function (h) { return !h.done && self.visible(h); });
  };
  Run.prototype.tickAll = function (on) {
    if (this.state !== 'listing') return;
    this.openHits().forEach(function (h) { h.checked = on; });
    this.renderHits();
  };

  // ── The listing ───────────────────────────────────────────────────────────

  Run.prototype.renderHits = function () {
    var self = this;
    if (!this.listEl) {
      this.listEl = el('div', 'dsp-hits');
      this.logEl.appendChild(this.listEl);
      if (this.spinEl) this.logEl.appendChild(this.spinEl);
    }
    this.listEl.textContent = '';
    if (this.review && this.state === 'listing' && !this.wrote) this.listEl.appendChild(this.reviewBlock());
    // One page of Core's Lines Drawn at Once, the rest kept and paged through: drawing every line of
    // a large library at once froze the tab and ran it out of memory.
    var shown = this.hits.filter(function (h) { return self.visible(h); });
    var size = linesDrawn();
    if (this.pageAt >= shown.length) this.pageAt = Math.max(0, Math.floor((shown.length - 1) / size) * size);
    var end = Math.min(shown.length, this.pageAt + size);
    var page = shown.slice(this.pageAt, end);
    // Above the lines and pinned there as they scroll (`position: sticky`), so it is in reach anywhere on the page.
    this.pagerBar = shown.length > size ? this.listEl.appendChild(this.pager(shown.length, size, end)) : null;
    for (var i = 0; i < page.length; i++) this.listEl.appendChild(this.hitRow(page[i]));
    this.progress();
    this.syncFooter();
    // A lean plan reads the values of the page it shows, and lets the last page's go.
    if (this.lean) {
      this.pageHits.forEach(function (h) { if (page.indexOf(h) === -1) h.read = null; });
      this.pageHits = page;
      var unread = page.filter(function (h) { return !KEEP_VALUES[h.shape] && !h.read; });
      if (unread.length) {
        // Every line of the page is settled once, read or not, so a redraw never asks again.
        var settleAll = function () {
          unread.forEach(function (h) { if (!h.read) h.read = { before: null, after: null, moved: true, gone: true }; });
          if (self.pageHits === page) self.renderHits();
        };
        this.readPage(unread).then(settleAll, function (e) {
          self.msg('WARN', 'The values of this page could not be read: ' + (e && e.message ? e.message : String(e)));
          settleAll();
        });
      }
    }
  };

  // A page's values, read now: each entity as it is, by id, fifty to a request - its value, what
  // the rules make of it, and whether it has moved since the scan.
  Run.prototype.readPage = function (hits) {
    var self = this, by = {};
    hits.forEach(function (h) { (by[h.typeKey] = by[h.typeKey] || []).push(h); });
    function settle(h, value) {
      h.read = { before: value, after: self.recompute(h, value), moved: hashOf(value) !== h.hash };
    }
    return Object.keys(by).reduce(function (p, type) {
      var list = by[type];
      return p.then(function () {
        if (type === 'filters') {
          return gqlRequest('query DSP_Filters { findSavedFilters { id mode name find_filter { q page per_page sort direction } ' +
            'object_filter ui_options } }', null).then(function (d) {
            list.forEach(function (h) {
              var f = (d.findSavedFilters || []).filter(function (x) { return String(x.id) === h.entId; })[0];
              if (f) settle(h, h.field === 'name' ? f.name : { find_filter: f.find_filter, object_filter: f.object_filter });
            });
          });
        }
        if (type === 'descriptions') {
          var api = cfbeApi();
          return api ? api.descriptions().then(function (m) { list.forEach(function (h) { settle(h, (m || {})[h.entId]); }); }) : null;
        }
        if (type === 'markers') {
          return gqlRequest('query DSP_PageMarkers($ids: [ID!]) { findSceneMarkers(ids: $ids) { scene_markers { id title } } }',
            { ids: list.map(function (h) { return h.entId; }) }).then(function (d) {
            ((d.findSceneMarkers || {}).scene_markers || []).forEach(function (m) {
              list.forEach(function (h) { if (h.entId === String(m.id)) settle(h, m.title); });
            });
          });
        }
        var spec = ENTITIES[type], ids = [];
        list.forEach(function (h) { if (ids.indexOf(h.entId) === -1) ids.push(h.entId); });
        var sel = rereadQuery(spec, list).replace(/^query DSP_One\(\$id: ID!\) \{ \w+\(id: \$id\) \{ /, '').replace(/ \} \}$/, '');
        var chunks = [];
        for (var i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
        return chunks.reduce(function (q, chunk) {
          return q.then(function () {
            return gqlRequest('query DSP_Page { ' + chunk.map(function (id, n) {
              return 'e' + n + ': ' + spec.one + '(id: ' + JSON.stringify(id) + ') { ' + sel + ' }';
            }).join(' ') + ' }', null).then(function (d) {
              chunk.forEach(function (id, n) {
                var live = d['e' + n];
                if (!live) return;
                list.forEach(function (h) {
                  if (h.entId !== id) return;
                  var v = h.slot != null ? (live.custom_fields || {})[h.slot] : live[h.field];
                  if (h.shape === 'ids') v = stashIdsOf(v);
                  settle(h, v);
                });
              });
            });
          });
        }, Promise.resolve());
      });
    }, Promise.resolve());
  };

  // Lines a to b of n, and the pages either side; every tick and filter acts on all n, not the page.
  // Previous and Next land on the new page's first line; Top and Bottom jump within this one.
  Run.prototype.jump = function (top) {
    var to = top ? this.pagerBar : this.listEl.lastChild;
    if (to && to.scrollIntoView) to.scrollIntoView({ block: top ? 'start' : 'end' });
  };
  Run.prototype.pager = function (total, size, end) {
    var self = this, bar = el('div', 'dsp-search dsp-search-wrap dsp-pager');
    bar.appendChild(el('span', 'dsp-label', 'Lines ' + (this.pageAt + 1) + '-' + end + ' of ' + total +
      ' - Select All and the filters reach every one.'));
    var prev = button('Previous ' + size, 'dsp-prevpage'), next = button('Next ' + Math.min(size, total - end), 'dsp-nextpage');
    prev.disabled = this.pageAt === 0;
    next.disabled = end >= total;
    prev.title = 'Show the ' + size + ' lines before these.';
    next.title = 'Show the lines after these.';
    prev.addEventListener('click', function () { if (!prev.disabled) { self.pageAt = Math.max(0, self.pageAt - size); self.renderHits(); self.jump(true); } });
    next.addEventListener('click', function () { if (!next.disabled) { self.pageAt += size; self.renderHits(); self.jump(true); } });
    var top = button('\u2912 Top', 'dsp-toppage'), bottom = button('\u2913 Bottom', 'dsp-bottompage');
    top.title = 'Scroll to the first line of this page.';
    bottom.title = 'Scroll to the last line of this page.';
    top.addEventListener('click', function () { self.jump(true); });
    bottom.addEventListener('click', function () { self.jump(false); });
    bar.appendChild(prev);
    bar.appendChild(next);
    bar.appendChild(top);
    bar.appendChild(bottom);
    return bar;
  };

  Run.prototype.entityLabel = function (h) {
    var spec = ENTITIES[h.typeKey];
    if (spec.noId) return spec.label + ' "' + h.entName + '"';
    return spec.label + ' ' + h.entId + ' "' + (h.entName || '(untitled)') + '"';
  };

  Run.prototype.hitRow = function (h) {
    var self = this;
    // A div with a click of its own rather than a `<label>`: the row holds a link to the
    // entity, and a label would tick the line on the way out to it.
    var row = el('div', 'dsp-hitrow' + (h.done ? ' dsp-hitrow-off' : ''));
    var box = el('input');
    box.type = 'checkbox';
    box.checked = h.checked !== false;
    box.disabled = this.state !== 'listing' || !!h.done;
    function set(on) {
      if (box.disabled || self.state !== 'listing') { box.checked = h.checked !== false; return; }
      box.checked = on;
      h.checked = on;
      self.progress();
      self.syncFooter();
    }
    box.addEventListener('change', function () { set(!!box.checked); });
    row.addEventListener('click', function (ev) {
      var t = ev && ev.target;
      if (t === box || (t && t.tagName === 'A')) return;
      set(!box.checked);
    });
    row.appendChild(box);
    var route = ENTITIES[h.typeKey].route;
    if (route) {
      var link = el('a', 'dsp-ent', (h.entName || '(untitled)') + ' (' + h.entId + ')');
      link.href = route + h.entId;
      link.target = linkTarget();
      link.rel = 'noopener noreferrer';
      entityTip(link, h.typeKey, h.entId);
      row.appendChild(link);
    } else {
      row.appendChild(el('span', 'dsp-ent', (h.entName || '(untitled)') + (ENTITIES[h.typeKey].noId ? '' : ' (' + h.entId + ')')));
    }
    var attr = row.appendChild(el('span', 'dsp-attr', ENTITIES[h.typeKey].label + ' · ' + hitLabel(h)));
    if (h.shape === 'remove') C.markLevel(attr, 'strong');
    var a = valueText(h, 'before'), b = valueText(h, 'after');
    var wholeA = valueText(h, 'before', true), wholeB = valueText(h, 'after', true);
    var was = el('span', 'dsp-before'), now = el('span', 'dsp-after', '→ ');
    if (a !== wholeA || b !== wholeB) {
      var parts = changedParts(wholeA, wholeB);
      drawParts(was, parts[0]);
      drawParts(now, parts[1]);
    } else {
      was.textContent = a;
      now.textContent = '→ ' + b;
    }
    was.title = wholeA;
    now.title = wholeB;
    row.appendChild(was);
    row.appendChild(now);
    return row;
  };

  Run.prototype.logLines = function () {
    var self = this;
    var lines = [this.progressEl.textContent, ''];
    this.hits.forEach(function (h) {
      if (!self.visible(h)) return;
      lines.push((h.checked !== false ? '[x] ' : '[ ] ') + self.entityLabel(h) + ' · ' + hitLabel(h) + ': ' +
        valueText(h, 'before', true) + ' → ' + valueText(h, 'after', true));
    });
    if (this.lean) lines.push('', 'Values are given for the page shown: a plan this large keeps none of its own.');
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
  Run.prototype.saveLog = function () {
    var d = new Date(), two = function (n) { return (n < 10 ? '0' : '') + n; };
    var name = 'de-spicer-log-' + d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + '-' +
      two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()) + '.txt';
    this.savedLog = { name: name, text: this.logLines() };
    saveText(this.savedLog.text, name, 'text/plain');
  };

  // ── Writing ───────────────────────────────────────────────────────────────

  Run.prototype.go = function () {
    if (this.changes.length) { this.undo(); return; }
    var self = this, lost = this.unkeptUndo(this.plan());
    if (!lost.length) { this.apply(); return; }
    if (this._armedKey !== 'goBtn') {
      this.msg('WARN', 'This run will have no Undo for ' + lost.join(', nor for ') + '. Press Proceed again within ' +
        ARM_SECONDS + ' seconds to write it anyway.');
    }
    this.armed('goBtn', function () { return self.apply(); });
  };

  // What no Undo will cover once this plan is written, said before Proceed: an entity picture
  // never is; past UNDO_KEEP the dialog keeps no copy, so Undo History is the only way back, and it
  // drops a run over half its Size Limit and, under Core's Record Library-Wide Image Writes off,
  // leaves Image entities out.
  var JOURNAL_ROW_BYTES = 200;
  Run.prototype.unkeptUndo = function (p) {
    var pics = 0;
    p.entities.forEach(function (e) { e.hits.forEach(function (h) { if (h.shape === 'image') pics++; }); });
    var lost = pics ? [plural(pics, 'entity picture') + ': no Undo puts a picture back, only the backup'] : [];
    var counters = 0;
    p.entities.forEach(function (e) { e.hits.forEach(function (h) { if (h.shape === 'counter') counters++; }); });
    if (counters) {
      lost.push(plural(counters, 'counter') + ' (O-counter, play count, resume time): Undo History cannot put one back, ' +
        (p.entities.length <= UNDO_KEEP ? 'only this dialog\u2019s Undo while it stays open'
          : 'and past ' + UNDO_KEEP + ' entities the dialog keeps no copy, so nothing does'));
    }
    if (p.entities.length <= UNDO_KEEP) return lost;
    if (!this.recordUndo) return ['any of it: Record in Undo History is off, and the dialog keeps no copy past ' + UNDO_KEEP + ' entities'];
    var lim = coop().journal.limits(), mb = function (n) { return Math.ceil(n / 1048576) + ' MB'; };
    if (this.journalBytes > lim.bytes / 2) {
      return ['any of it: at about ' + mb(this.journalBytes) + ' it is over half Undo History\u2019s Size Limit (' +
        mb(lim.bytes) + '), which records it whole or not at all'];
    }
    var images = p.entities.filter(function (e) { return e.typeKey === 'images'; }).length;
    return lost.concat(images && !lim.imageRuns ? [plural(images, 'Image entity', 'Image entities') +
      ': ᝯㄝₓ Core\u2019s Record Library-Wide Image Writes is off'] : []);
  };

  // One write per entity, carrying every ticked change it has - none for an entity that is to be
  // removed - and the removals apart, written last.
  Run.prototype.plan = function () {
    var by = {}, order = [], gone = {};
    var hits = this.enabledHits();
    var removals = hits.filter(function (h) { return h.shape === 'remove'; });
    removals.forEach(function (h) { gone[h.typeKey + '/' + h.entId] = true; });
    hits.forEach(function (h) {
      var key = h.typeKey + '/' + h.entId;
      if (h.shape === 'remove' || gone[key]) return;
      if (!by[key]) { by[key] = { typeKey: h.typeKey, entId: h.entId, entName: h.entName, hits: [] }; order.push(key); }
      by[key].hits.push(h);
    });
    return { entities: order.map(function (k) { return by[k]; }), removals: removals };
  };

  Run.prototype.apply = function () {
    var self = this;
    // Held at the handler too, not only by the disabled button: a protection that names no tag.
    if (this.exclusionMissing && this.exclusionMissing.length) return;
    var p = this.plan();
    if (!p.entities.length && !p.removals.length) return;
    var other = foreignLease(PLUGIN_ID);
    if (other) {
      this.note('Another plugin is applying bulk changes right now (' + other.owner + ' - ' + other.label +
        '). Running both at once means each may undo part of the other.');
    }
    this.undoKept = p.entities.length <= UNDO_KEEP;
    this.startedAt = Date.now();
    this.writeTotal = p.entities.length;
    this.writeDone = 0;
    this.paceFrom = null;
    this.doneHead = '';
    this.setState('writing');
    this.msg('INFO', 'Writing ' + plural(this.enabledHits().length - p.removals.length, 'change') + ' to ' +
      plural(p.entities.length, 'entity', 'entities') + (p.removals.length ? ', then removing ' +
      plural(p.removals.length, 'entity', 'entities') + ' (' + REMOVE_DELETES[this.removeDeletes].label.toLowerCase() + ')' : '') + '.');
    // Renewed before every write (`writeAll`, `removeAll`): a lease lapses on its own after five
    // minutes, and once it had, Entity Name Maintainer took each rename for a user's and opened on it.
    var lease = this.lease = C.lease(PLUGIN_ID, 'De-Spice');
    this.describeExclusions();
    this.storeSalt().then(function () {
      return fieldLocks();
    }).then(function (locks) {
      self.locks = locks;
      return self.writeAll(p);
    }).then(function () {
      return self.removeAll(p.removals);
    }).then(function () {
      lease.release();
      self.wrote = true;
      self.setState('listing');
      self.renderHits();
      return self.finalCheck();
    }, function (e) {
      lease.release();
      self.wrote = true;
      self.setState('listing');
      self.renderHits();
      self.msg('ERROR', 'The write stopped: ' + (e && e.message ? e.message : String(e)));
      self.checkPhrase = 'not run, since the write stopped.';
    }).then(function () { if (!self.closed) self.summarize(); });
  };

  // The lines a write left, by why: changed since the scan, failed, unticked or filtered out.
  Run.prototype.leftOver = function () {
    var self = this, out = { moved: 0, failed: 0, unticked: 0, hidden: 0, total: 0 };
    this.hits.forEach(function (h) {
      if (h.done) return;
      out.total++;
      if (h.moved) out.moved++;
      else if (!self.visible(h)) out.hidden++;
      else if (h.checked === false) out.unticked++;
      else out.failed++;   // ticked and shown, but its write failed or never came
    });
    return out;
  };
  function leftText(l) {
    return [l.moved ? num(l.moved) + ' changed since the scan' : '', l.failed ? num(l.failed) + ' failed' : '',
      l.unticked ? num(l.unticked) + ' unticked' : '', l.hidden ? num(l.hidden) + ' filtered out' : ''].filter(Boolean).join(' · ');
  }

  // The closing block, once Proceed and its final check are done: what was written, removed and left,
  // the log's warnings and errors - each count narrowing the log to its lines - and the check's word.
  // The progress line opens with the same figures; Copy log and Save log carry the block.
  var SUMMARY_WORD = { names: 'names', text: 'details', links: 'links', fields: 'custom fields', fieldnames: 'custom field names', facts: 'facts',
    dates: 'dates', ratings: 'ratings', filters: 'saved filters', files: 'files', images: 'images' };
  Run.prototype.summarize = function () {
    var self = this, t = this.tally, d = this.drawnStats, left = this.leftOver();
    var kinds = CATEGORIES.map(function (c) { return t[c.key] ? num(t[c.key]) + ' ' + SUMMARY_WORD[c.key] : ''; }).filter(Boolean);
    var took = duration(Date.now() - this.startedAt);
    var lines = ['Done in ' + took + '.',
      '  Written:  ' + num(this.written) + ' ' + (this.written === 1 ? 'change' : 'changes') + ' to ' + num(this.entitiesWritten) + ' ' +
        (this.entitiesWritten === 1 ? 'entity' : 'entities') + (kinds.length ? ' (' + kinds.join(', ') + ')' : '')];
    var img = [d.animated ? num(d.animated) + ' animated, a still of each' : '', d.canned ? num(d.canned) + ' animated, the canned animation' : '',
      d.alpha ? num(d.alpha) + ' see-through, kept so as PNG' : '', d.svg ? num(d.svg) + ' SVG' : '',
      this.imagesKept ? num(this.imagesKept) + ' left alone, drawn by De-Spicer already' : ''].filter(Boolean);
    if (img.length) lines.push('  Images:   ' + img.join(' · '));
    if (this.removed) {
      lines.push('  Removed:  ' + num(this.removed) + ' ' + (this.removed === 1 ? 'entity' : 'entities') + ', markers first; media files ' +
        (REMOVE_DELETES[this.removeDeletes].files ? 'deleted' : 'kept'));
    }
    lines.push('  Left:     ' + (leftText(left) || 'nothing'));
    var k = this.kinds || {};
    var logText = (k.WARN ? num(k.WARN) + ' WARN' : '') + (k.WARN && k.ERROR ? ' · ' : '') + (k.ERROR ? num(k.ERROR) + ' ERROR' : '');
    lines.push('  Log:      ' + (logText || 'no WARN or ERROR line'));
    lines.push('  Final check: ' + (this.checkPhrase || 'not run.'));

    var box = el('div', 'dsp-closing dsp-INFO');
    lines.forEach(function (l) {
      if (!/^  Log:/.test(l) || !logText) { box.appendChild(el('div', null, l)); return; }
      var row = box.appendChild(el('div', null, '  Log:      '));
      ['WARN', 'ERROR'].forEach(function (kind) {
        if (!k[kind]) return;
        if (kind === 'ERROR' && k.WARN) row.appendChild(document.createTextNode(' · '));
        var a = row.appendChild(el('a', 'dsp-loglink dsp-' + kind, num(k[kind]) + ' ' + kind));
        a.title = 'Show only the ' + kind + ' lines of the log, and this summary.';
        a.addEventListener('click', function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); self.onlyKind(kind); });
      });
      row.appendChild(document.createTextNode(' - click to show only those lines '));
      var all = row.appendChild(el('a', 'dsp-loglink dsp-showall', 'Show all'));
      all.title = 'Show every line of the log again.';
      all.addEventListener('click', function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); self.onlyKind(null); });
    });
    this.logEl.appendChild(box);
    if (this.spinEl) this.logEl.appendChild(this.spinEl);
    if (typeof this.logEl.scrollHeight === 'number') this.logEl.scrollTop = this.logEl.scrollHeight;
    lines.forEach(function (l) { self.logText.push(l); });
    keepLog(this.logText);
    this.doneHead = 'Done in ' + took + '  ·  ' + num(this.written) + ' written to ' + num(this.entitiesWritten) + ' ' +
      (this.entitiesWritten === 1 ? 'entity' : 'entities') + (this.removed ? '  ·  ' + num(this.removed) + ' removed' : '') +
      '  ·  ' + (left.total ? num(left.total) + ' left' : 'nothing left') + (logText ? '  ·  ' + logText : '');
    this.progress();
    this.syncFooter();
    paintButton(this.closeBtn, this.closeColor());
  };

  // The log narrowed to one kind of line - the summary always shown - or, with null, every line again.
  Run.prototype.onlyKind = function (kind) {
    this.logEl.className = this.logEl.className.replace(/\s*dsp-only-\w+/g, '') + (kind ? ' dsp-only-' + kind : '');
  };

  // The salt goes with the first write made from it: a pseudonym written to the library
  // must come out the same the next time. The record of the names this run made goes with every
  // write that made one, so the next run knows them for pseudonyms (`isInvented`).
  // Each is taken into memory only once the settings write succeeds: after a failed one, the next
  // Proceed stores them all again.
  Run.prototype.storeSalt = function () {
    var self = this, fresh = (this.ctxBase && this.ctxBase.namer ? this.ctxBase.namer.fresh : []).filter(function (k) {
      return !hasOwn(self.record, k);
    });
    if (!this.newSalt && !fresh.length && this.answersToStore() == null) return Promise.resolve();
    // Read again just before the write: each value is sent whole, and another dialog may have stored
    // its own record and answers since this one opened - theirs are kept, not overwritten.
    return loadSettings(true).then(function (now) {
      var written = self.record, stored = parseWritten(now.z2Written), added = [], seen = {}, k;
      for (k in stored) if (hasOwn(stored, k)) written[k] = true;
      if (self.newSalt && !hasOwn(written, NO_LEGACY)) added.push(NO_LEGACY);
      fresh.forEach(function (k) {
        if (!hasOwn(written, k) && !hasOwn(seen, k)) { seen[k] = true; added.push(k); }
      });
      var answers = self.answersToStore(now.z3NameAnswers);
      if (!self.newSalt && !added.length && answers == null) return;
      var patch = {};
      if (self.newSalt) patch.z1Salt = self.salt;
      if (added.length) patch.z2Written = Object.keys(written).concat(added).join(' ');
      if (answers != null) patch.z3NameAnswers = answers.text;
      // `…State`: the plugin's own state, which Undo History leaves out (Core's `journalSettingsSave`).
      return C.writePluginSettings(PLUGIN_ID, patch, self.newSalt ? 'DSPSaltState' : 'DSPRecordState').then(function () {
        self.newSalt = false;
        added.forEach(function (k) { written[k] = true; });
        if (answers != null) { self.nameAnswers = answers.map; self.answersStored = answers.text; self.oldAnswers = {}; }
      });
    });
  };

  // The two exclusion fields, documented in Custom Fields Bulk Editor's description store where they
  // have no description yet - with a Proceed, not on a page: nothing is written without a plan in front of it.
  var EXCLUSION_DESCRIPTIONS = {
    entityField: 'Set to anything, keeps ' + PLUGIN_NAME + ' from changing this entity at all: its name, text, ' +
      'images and files stay as they are, it is not removed, and its name is not replaced where other entities ' +
      'mention it.\n\nRead by ' + PLUGIN_NAME + ', never written by it.',
    imageField: 'Set to anything, keeps ' + PLUGIN_NAME + ' from blurring this entity\'s image or replacing it with ' +
      'a card; the rest of the entity is rewritten as usual.\n\nRead by ' + PLUGIN_NAME + ', never written by it.',
  };
  Run.prototype.describeExclusions = function () {
    var self = this, api = (coop().api || {})[CFBE_ID];
    if (!api || typeof api.describeField !== 'function') return;
    ['entityField', 'imageField'].forEach(function (k) {
      var name = self.excl[k];
      if (!name) return;
      api.describeField(name, EXCLUSION_DESCRIPTIONS[k]).then(function (outcome) {
        if (outcome === 'added') self.msg('INFO', 'Described the custom field "' + name + '" in ' + CFBE_NAME + '\'s description store.');
        else if (outcome === 'queued') {
          self.msg('INFO', 'A description of the custom field "' + name + '" is waiting for ' + CFBE_NAME + '\'s description ' +
            'store: open its "Manage Custom Field Descriptions and Locks..." and press Apply to file it.');
        }
      }, function () { /* a sentence is not worth an error */ });
    });
  };

  // The fields a by-id read selects to check an entity before writing it.
  function rereadQuery(spec, hits) {
    var names = [];
    hits.forEach(function (h) {
      var n = h.shape === 'image' ? (IMAGE_FIELDS[spec.key] || []).filter(function (f) { return f.name === h.field; })[0].sel
        : h.shape === 'ids' ? h.field + ' { endpoint stash_id updated_at }' : h.shape === 'file' ? 'files { id basename }'
          : h.slot != null ? 'custom_fields' : h.field;
      if (names.indexOf(n) === -1) names.push(n);
      var c = h.shape === 'counter' && counterOf(spec.key, h.field);
      if (c && c.history && names.indexOf(c.history) === -1) names.push(c.history);
    });
    return 'query DSP_One($id: ID!) { ' + spec.one + '(id: $id) { id ' + names.join(' ') + ' } }';
  }

  // Re-read before writing: a field that has moved since the scan is left alone and said
  // out loud, never overwritten with what the scan saw.
  Run.prototype.buildUpdate = function (ent) {
    var self = this, spec = ENTITIES[ent.typeKey];
    if (ent.typeKey === 'filters') return this.buildFilterUpdate(ent);
    if (ent.typeKey === 'descriptions') return this.buildDescriptionUpdate(ent);
    if (ent.typeKey === 'markers') {
      return gqlRequest('query DSP_Marker($id: ID!) { findSceneMarkers(ids: [$id]) { scene_markers { id title } } }',
        { id: ent.entId }).then(function (data) {
        var live = ((data.findSceneMarkers || {}).scene_markers || [])[0];
        var h = ent.hits[0];
        if (!live) throw new Error('Marker ' + ent.entId + ' no longer exists.');
        if (hashOf(live.title) !== h.hash) { self.moved(ent, h); return null; }
        return { spec: spec, input: { id: ent.entId, title: self.recompute(h, live.title) }, before: { id: ent.entId, title: live.title },
          count: 1, hits: ent.hits, noJournal: true };
      });
    }
    return gqlRequest(rereadQuery(spec, ent.hits), { id: ent.entId }).then(function (data) {
      var live = data[spec.one];
      if (!live) throw new Error(spec.label + ' ' + ent.entId + ' no longer exists.');
      var input = { id: ent.entId }, before = { id: ent.entId }, partial = {}, oldPartial = {}, n = 0, done = [];
      var images = [], moves = [], remove = [], notes = [], renames = [], beforeRemove = [], counters = [];
      ent.hits.forEach(function (h) {
        if (h.shape === 'counter') {
          if (hashOf(live[h.field]) !== h.hash) { self.moved(ent, h); return; }
          var c = counterOf(ent.typeKey, h.field);
          counters.push({ typeKey: ent.typeKey, field: h.field, count: live[h.field] || 0,
            history: c.history ? (live[c.history] || []).slice() : null, hit: h });
          n++;
          done.push(h);
          return;
        }
        if (h.shape === 'image') { images.push([h, self.specOf(h).read(live)]); return; }
        if (h.shape === 'rename') { renames.push(h); return; }
        if (h.shape === 'file') {
          var file = (live.files || []).filter(function (x) { return String(x.id) === h.slot; })[0];
          if (!file || file.basename !== h.before) { self.moved(ent, h); return; }
          moves.push({ file: h.slot, folder: h.folder, from: h.before, to: h.after, hit: h });
          n++;
          done.push(h);
          return;
        }
        if (h.shape === 'archive') {
          if ((live.custom_fields || {})[h.slot] !== h.before || self.fieldLocked(h.slot)) { self.moved(ent, h); return; }
          remove.push(h.slot);
          oldPartial[h.slot] = h.before;
          n++;
          done.push(h);
          return;
        }
        // Checked against the hash the scan kept and worked out afresh: the plan may hold no copy.
        if (h.slot != null) {
          var cur = (live.custom_fields || {})[h.slot];
          if (hashOf(cur) !== h.hash || self.fieldLocked(h.slot)) { self.moved(ent, h); return; }
          var next = self.recompute(h, cur);
          if (next === null) remove.push(h.slot); else partial[h.slot] = next;
          oldPartial[h.slot] = cur;
        } else {
          var now = live[h.field];
          var was = h.shape === 'ids' ? stashIdsOf(now) : now;
          if (hashOf(was) !== h.hash) { self.moved(ent, h); return; }
          input[h.field] = self.recompute(h, was);
          before[h.field] = was;
        }
        n++;
        done.push(h);
      });
      // A field renamed takes its value as this write leaves it to its new name; Undo takes the new
      // name off and puts the old back.
      renames.forEach(function (h) {
        var held = live.custom_fields || {};
        if (!hasOwn(held, h.before) || hasOwn(held, h.after)) { self.moved(ent, h); return; }
        var v = hasOwn(partial, h.before) ? partial[h.before] : held[h.before];
        delete partial[h.before];
        if (remove.indexOf(h.before) === -1) {
          partial[h.after] = v;
          remove.push(h.before);
        }
        if (!hasOwn(oldPartial, h.before)) oldPartial[h.before] = held[h.before];
        beforeRemove.push(h.after);
        n++;
        done.push(h);
      });
      if (Object.keys(partial).length || remove.length) {
        input.custom_fields = { partial: partial };
        if (remove.length) input.custom_fields.remove = remove;
        before.custom_fields = { partial: oldPartial };
        if (beforeRemove.length) before.custom_fields.remove = beforeRemove;
      }
      // An image is drawn now, one at a time, and goes with the entity's other changes. It is
      // not in `before`: holding every original image for an Undo would hold the library's.
      return images.reduce(function (p, pair) {
        var h = pair[0];
        return p.then(function () { return self.drawImage(ent, h, input, pair[1]); }).then(function (r) {
          if (r.keep) {
            h.done = true;
            self.imagesKept++;
            notes.push(hitLabel(h).toLowerCase() + ' left alone - ' + (r.keep === 'blurred' ? 'blurred' : 'drawn') +
              ' by De-Spicer already');
            return;
          }
          input[h.field] = r.data;
          h.drawn = r.info;
          if (r.note) h.note = r.note;
          n++;
          done.push(h);
        }, function (e) {
          h.failed = true;
          self.entityLine('WARN', ent, ': ' + hitLabel(h).toLowerCase() + ' left as it is - ' +
            (e && e.message ? e.message : String(e)) + '.');
        });
      }, Promise.resolve()).then(function () {
        if (!n && notes.length && !self.lean) self.entityLine('INFO', ent, ': ' + notes.join(', ') + '.');
        return n ? { spec: spec, input: input, before: before, count: n, hits: done, moves: moves, notes: notes,
          counters: counters } : null;
      });
    });
  };

  // The image an entity gets: blurred, or a card with its name - the name this same write gives
  // it, where it is renamed. Resolves to `{ data, note, info }`, or `{ keep }` for an image a run
  // already drew: blurred, it is never blurred again; a card or the canned animation is never
  // drawn again, though a blurred one still gives way to a card. An animated original keeps a
  // still of its middle frame when blurred and becomes the canned animation when replaced; a
  // see-through one stays see-through, as PNG.
  // One image at a time across the whole run, not only within an entity: the writes go 25
  // entities at once, and 25 originals decoded and drawn together could take the tab down.
  Run.prototype.drawImage = function (ent, h, input, url) {
    var self = this, go = function () { return self.drawOne(ent, h, input, url); };
    var turn = (this.drawQueue || Promise.resolve()).then(go);
    this.drawQueue = turn.then(null, function () {});
    return turn;
  };

  Run.prototype.drawOne = function (ent, h, input, url) {
    var spec = ENTITIES[ent.typeKey], blur = h.after === 'blur';
    var name = input[REQUIRED[ent.typeKey] || 'title'] || (h.untitled ? '' : ent.entName) || spec.label + ' ' + ent.entId;
    var portrait = ent.typeKey === 'performers' || ent.typeKey === 'groups';
    var strength = strengthOf(this.settings.d1BlurStrength);
    var card = function (alpha, note, info) {
      return { data: IMAGES.card(spec.label, name, portrait, alpha, cardColor(ent.typeKey + ' ' + ent.entId)),
        note: note || '', info: info || {} };
    };
    if (!realImage(url)) {
      return blur ? Promise.reject(new Error('it has no image of its own any more')) : Promise.resolve(card(false));
    }
    return IMAGES.fetch(url).then(function (got) {
      var mark = markOf(got.bytes), info = sniff(got.bytes, got.type);
      if (mark && (blur || mark !== 'blurred')) return { keep: mark };
      var what = info.frames > 1 ? 'an animated ' + info.format + ' (' + info.frames + ' frames)'
        : info.format === 'SVG' ? 'an SVG' : '';
      if (!blur && info.frames > 1) {
        return IMAGES.canned().then(function (data) {
          return { data: data, note: what + ', replaced by the canned animation', info: info };
        }, function (e) {
          return card(false, what + ', a card instead of the canned animation - ' + (e && e.message ? e.message : String(e)), info);
        });
      }
      return IMAGES.decode(got.bytes, info).then(null, function () {
        throw new Error('the image could not be decoded (' + (got.type || 'no type') + ', ' + got.bytes.length + ' bytes)');
      }).then(function (d) {
        try {
          info.alpha = !info.opaque && IMAGES.hasAlpha(d.img);
          var notes = [];
          if (info.frames > 1) notes.push(what + ', blurred to a still of frame ' + d.frame + ' of ' + info.frames);
          else if (what) notes.push(what + ', drawn as an image first');
          if (info.alpha) notes.push('see-through, kept so as PNG');
          if (!blur) return card(info.alpha, notes.join('; '), info);
          return { data: IMAGES.blur(d.img, strength, info.alpha), note: notes.join('; '), info: info };
        } finally {
          if (d.img.close) d.img.close();
        }
      }, function (e) {
        // A card needs nothing from the original but whether it is see-through.
        if (blur) throw e;
        return card(info.format === 'SVG', what, info);
      });
    });
  };

  // Left out of every later Proceed: written now, it would only be found moved again. A Rescan lists it afresh.
  Run.prototype.moved = function (ent, h) {
    h.moved = true;
    this.entityLine('WARN', ent, ': ' + hitLabel(h) + ' has changed since the scan and is left alone.');
  };

  Run.prototype.buildFilterUpdate = function (ent) {
    var self = this;
    return gqlRequest('query DSP_Filters { findSavedFilters { id mode name find_filter { q page per_page sort direction } ' +
      'object_filter ui_options } }', null).then(function (data) {
      var live = (data.findSavedFilters || []).filter(function (f) { return String(f.id) === ent.entId; })[0];
      if (!live) throw new Error('Saved filter ' + ent.entId + ' no longer exists.');
      var after = { id: live.id, mode: live.mode, name: live.name, find_filter: live.find_filter,
        object_filter: live.object_filter, ui_options: live.ui_options };
      var back = JSON.parse(JSON.stringify(after)), n = 0, done = [];
      ent.hits.forEach(function (h) {
        if (h.field === 'name') {
          if (hashOf(live.name) !== h.hash) { self.moved(ent, h); return; }
          after.name = self.recompute(h, live.name);
        } else {
          var crit = { find_filter: live.find_filter, object_filter: live.object_filter };
          if (hashOf(crit) !== h.hash) { self.moved(ent, h); return; }
          var walked = self.recompute(h, crit);
          after.find_filter = walked.find_filter;
          after.object_filter = walked.object_filter;
        }
        n++;
        done.push(h);
      });
      if (!n) return null;
      var write = function (input) {
        return gqlRequest('mutation DSP_SaveFilter($input: SaveFilterInput!) { saveFilter(input: $input) { id } }', { input: input });
      };
      return { spec: ENTITIES.filters, input: after, before: back, count: n, hits: done, write: write };
    });
  };

  Run.prototype.buildDescriptionUpdate = function (ent) {
    var self = this, api = cfbeApi(), h = ent.hits[0];
    if (!api) {
      this.msg('WARN', CFBE_NAME + ' is no longer available, so its descriptions are left alone.');
      return Promise.resolve(null);
    }
    return api.descriptions().then(function (live) {
      if (hashOf(live[ent.entId]) !== h.hash) { self.moved(ent, h); return null; }
      var after = {}, before = {};
      after[ent.entId] = self.recompute(h, live[ent.entId]);
      before[ent.entId] = live[ent.entId];
      return { spec: ENTITIES.descriptions, input: after, before: before, count: 1, hits: ent.hits,
        write: function (input) { return api.updateDescriptions(input); } };
    });
  };

  // Undo History, which ᝯㄝₓ Core keeps: a write to one of Core's seven types is recorded
  // from the input sent and the one that puts it back. A write with a writer of its own -
  // a saved filter, a description in another plugin's store - and a marker are not entity
  // writes Core keeps, and a library marked as a copy keeps none.
  function journalPass(label) {
    return coop().journal.pass({ plugin: PLUGIN_SHORT_NAME, label: label, libraryWide: true });
  }

  // What Undo History is handed: the write less its images, which it has no place for and the
  // dialog has already said so about.
  function withoutImages(input) {
    var out = {};
    for (var k in input) if (hasOwn(input, k) && !/^(cover_image|image|front_image|back_image)$/.test(k)) out[k] = input[k];
    return out;
  }

  function sendJob(job, input, op) {
    if (job.write) return job.write(input);
    return gqlRequest('mutation ' + op + '($input: ' + job.spec.input + '!) { ' + job.spec.mutation +
      '(input: $input) { id } }', { input: input });
  }

  // What one write did, counted for the closing summary: changes by kind of data, entities, images by what they were.
  Run.prototype.tallied = function (job) {
    var self = this, d = this.drawnStats;
    this.entitiesWritten++;
    job.hits.forEach(function (h) {
      if (!h.done) return;
      self.tally[h.cat] = (self.tally[h.cat] || 0) + 1;
      if (!h.drawn) return;
      d.drawn++;
      if (h.drawn.frames > 1) d[h.after === 'blur' ? 'animated' : 'canned']++;
      if (h.drawn.alpha) d.alpha++;
      if (h.drawn.format === 'SVG') d.svg++;
    });
  };

  // What one write changed, by field, the new name in front - `Studio 1494 "Only A/Cs" → "Quiet Harbor
  // Films": name, aliases (2), details blanked` - and each value, before and after, in its hover box.
  Run.prototype.changedLine = function (ent, job) {
    var nameField = ent.typeKey === 'filters' ? 'name' : REQUIRED[ent.typeKey] || 'title';
    var renamed = typeof job.input[nameField] === 'string' && job.input[nameField] !== ent.entName &&
      job.hits.some(function (h) { return h.field === nameField; });
    var parts = job.hits.filter(function (h) { return h.done; }).map(changePhrase).concat(job.notes || []);
    var tip = job.hits.filter(function (h) { return h.done; }).map(function (h) { return hitLabel(h) + ': ' + changePair(h); }).join('\n');
    this.entityLine('INFO', ent, (renamed ? ' → "' + job.input[nameField] + '"' : '') + ': ' + parts.join(', ') + '.', tip);
  };
  function changePhrase(h) {
    var label = hitLabel(h);
    label = label.charAt(0).toLowerCase() + label.slice(1);
    if (h.shape === 'image') return label + (h.after === 'blur' ? ' blurred' : ' replaced') + (h.note ? ' (' + h.note + ')' : '');
    if (h.shape === 'file') return 'file renamed';
    if (h.shape === 'archive') return label + ' cleared';
    var a = h.after, b = h.before;
    if (a === '' || a === null || (Array.isArray(a) && !a.length)) return label + ' blanked';
    if (Array.isArray(a)) {
      var n = a.filter(function (x) { return !(Array.isArray(b) && b.some(function (y) { return same(x, y); })); }).length;
      return label + ' (' + n + ')';
    }
    return label;
  }
  // A value before and after, cut around the change where it is long, as the listing cuts it.
  function changePair(h) {
    var a = valueText(h, 'before', true), b = valueText(h, 'after', true);
    if (a.length <= SHOWN_CHARS && b.length <= SHOWN_CHARS) return a + ' → ' + b;
    var p = changedParts(a, b);
    return p[0].pre + p[0].hit + p[0].post + ' → ' + p[1].pre + p[1].hit + p[1].post;
  }

  Run.prototype.writeAll = function (p) {
    var self = this, list = p.entities;
    var pass = this.recordUndo ? journalPass('De-Spiced') : null;
    function batch(i) {
      if (i >= list.length) {
        if (pass) pass.finish().then(function (line) { if (line) self.msg('INFO', line); });
        return Promise.resolve();
      }
      return Promise.all(list.slice(i, i + WRITE_CHUNK).map(function (ent) {
        var what = self.entityLabel(ent);
        return self.buildUpdate(ent).then(function (job) {
          if (self.lease) self.lease.renew();   // per entity: its images alone can take a while
          if (!job) return null;
          var update = job.write || Object.keys(job.input).length > 1 ? sendJob(job, job.input, 'DSP_Write') : Promise.resolve();
          // Recorded the moment the update lands, each file move added as it lands after it: a move
          // that fails leaves the fields written, and they must still be undone, by either Undo.
          var entry = null, moves = job.moves || [];
          return update.then(function () {
            var kept = pass && !job.write && !job.noJournal;
            if (self.undoKept) {
              entry = { spec: job.spec, input: job.before, write: job.write, label: what,
                run: kept ? pass.id : null, moves: [], counters: [], sceneName: ent.entName };
              self.changes.push(entry);
            }
            if (kept && Object.keys(job.input).length > 1) {
              pass.add(job.spec.key, job.input.id, ent.entName || '', withoutImages(job.input), job.before);
            }
            job.hits.forEach(function (h) { if (h.shape !== 'file' && h.shape !== 'counter') h.done = true; });
            return self.resetCounters(job, entry).then(null, function (e) {
              var left = (job.counters || []).filter(function (c) { return !c.hit.done; }).length;
              self.written += job.count - left - moves.length;
              self.tallied(job);
              throw new Error('its other fields were written, but ' + plural(left, 'counter') + ' could not be reset' +
                (moves.length ? ' and its files were not renamed' : '') + ' - ' + (e && e.message ? e.message : String(e)));
            }).then(function () {
              // Named in Undo History as the scene's other fields are, never "untitled".
              job.sceneName = ent.entName;
              return self.moveFiles(job, pass, false, function (mv) {
                if (entry) entry.moves.push(mv);
                mv.hit.done = true;
              }).then(null, function (e) {
                var left = moves.filter(function (mv) { return !mv.hit.done; }).length;
                self.written += job.count - left;
                self.tallied(job);
                throw new Error('its other changes were written, but ' + plural(left, 'file') + ' could not be renamed - ' +
                  (e && e.message ? e.message : String(e)));
              });
            });
          }).then(function () {
            self.written += job.count;
            self.tallied(job);
            // One line an entity, where a run is small enough to read them; a count every thousand where not.
            if (!self.lean) self.changedLine(ent, job);
            else if (self.entitiesWritten % 1000 === 0) {
              self.msg('INFO', plural(self.entitiesWritten, 'entity', 'entities') + ' written so far.');
            }
          });
        }).then(null, function (e) {
          self.failed++;
          ent.hits.forEach(function (h) { if (!h.done) h.failed = true; });
          self.entityLine('ERROR', ent, ': ' + (e && e.message ? e.message : String(e)));
        });
      })).then(function () {
        self.writeDone = Math.min(list.length, i + WRITE_CHUNK);
        // The pace is taken from the third batch on: images make the first ones uneven.
        if (i === 2 * WRITE_CHUNK) self.paceFrom = { at: Date.now(), done: self.writeDone };
        self.progress();
        return batch(i + WRITE_CHUNK);
      });
    }
    return batch(0);
  };

  // The entity's counters, one reset each, after its update: each that lands is marked written and
  // kept on the dialog's Undo entry, with the count and history it had.
  Run.prototype.resetCounters = function (job, entry) {
    var id = job.input.id;
    return (job.counters || []).reduce(function (p, c) {
      return p.then(function () { return counterWrite(id, c, false); }).then(function () {
        c.hit.done = true;
        if (entry) entry.counters.push(c);
      });
    }, Promise.resolve());
  };

  // A scene's files, one move each, in the folder they are in: Stash refuses a name already taken
  // there, which lands as that file's error. Recorded in Undo History as Scene Filename Manager
  // records its own: `files.<file id>`, from and to.
  // What Stash's Clean takes, said wherever this plugin points to it.
  var CLEAN_WARNING = 'Clean removes every entry whose file is not on the disk or is outside Stash\'s library folders - ' +
    'in a copy whose folders point elsewhere, every entry';
  var MISSING_FILE = /cannot find the (?:file|path) specified|no such file or directory/i;
  Run.prototype.moveFiles = function (job, pass, back, landed) {
    var self = this, moves = job.moves || [];
    return moves.reduce(function (p, mv) {
      return p.then(function () {
        var to = back ? mv.from : mv.to, from = back ? mv.to : mv.from;
        var input = { ids: [mv.file], destination_basename: to };
        if (mv.folder) input.destination_folder_id = mv.folder;
        return gqlRequest('mutation DSP_Move($input: MoveFilesInput!) { moveFiles(input: $input) }', { input: input })
          .then(null, function (e) {
            var said = e && e.message ? e.message : String(e);
            // Stash moves the file from the path it has on record: one moved or deleted outside Stash
            // since the last scan is not there, and Windows, Linux and macOS each say so in their words.
            if (!MISSING_FILE.test(said)) throw e;
            throw new Error(said + ' - the file is not where the library says it is; a Scan of its folder, ' +
              'then Clean, brings the library up to date - but ' + CLEAN_WARNING);
          })
          .then(function () {
            if (pass) {
              pass.entries([{ type: 'scenes', id: String(job.input ? job.input.id : job.id), name: job.sceneName || '',
                field: 'files.' + mv.file, before: from, after: to, folder: mv.folder }]);
            }
            if (landed) landed(mv);
          });
      });
    }, Promise.resolve());
  };

  // The removals, type by type in `REMOVE_TYPES` order, fifty ids a request, at the level the
  // dialog says. Nothing here is undone or recorded: the log said so before Proceed.
  var REMOVE_MUTATION = {
    markers: { m: 'sceneMarkersDestroy', ids: true }, groups: { m: 'groupsDestroy', ids: true },
    performers: { m: 'performersDestroy', ids: true }, studios: { m: 'studiosDestroy', ids: true },
    scenes: { m: 'scenesDestroy', input: 'ScenesDestroyInput' }, images: { m: 'imagesDestroy', input: 'ImagesDestroyInput' },
    galleries: { m: 'galleryDestroy', input: 'GalleryDestroyInput' },
  };

  // Asked again just before the delete, which cannot be undone: an entity untagged or excluded since
  // the scan is left alone and said, like any other line that changed since the scan.
  Run.prototype.removeAll = function (removals) {
    var self = this, level = REMOVE_DELETES[this.removeDeletes];
    var jobs = [], still = {};
    var types = REMOVE_TYPES.filter(function (t) { return removals.some(function (h) { return h.typeKey === t.key; }); });
    return types.reduce(function (p, t) {
      return p.then(function () {
        return self.removalQuery(t).then(function (list) {
          list.forEach(function (ent) {
            if (exclusionOf(self.excl, t.key, ent) !== 'entity') still[t.key + ':' + ent.id] = true;
          });
        });
      });
    }, Promise.resolve()).then(function () {
      REMOVE_TYPES.forEach(function (t) {
        var list = removals.filter(function (h) {
          if (h.typeKey !== t.key) return false;
          if (hasOwn(still, t.key + ':' + h.entId)) return true;
          self.moved(h, h);
          return false;
        });
        for (var i = 0; i < list.length; i += 50) jobs.push({ key: t.key, hits: list.slice(i, i + 50) });
      });
    }, function (e) {
      self.failed++;
      removals.forEach(function (h) { h.failed = true; });
      self.msg('ERROR', 'Nothing removed: what carries the removal tag could not be read again (' +
        (e && e.message ? e.message : String(e)) + ').');
    }).then(function () { return jobs.reduce(function (p, job) {
      return p.then(function () {
        if (self.lease) self.lease.renew();
        var mut = REMOVE_MUTATION[job.key], ids = job.hits.map(function (h) { return h.entId; });
        var q = mut.ids ? 'mutation DSP_Remove($ids: [ID!]!) { ' + mut.m + '(ids: $ids) }'
          : 'mutation DSP_Remove($input: ' + mut.input + '!) { ' + mut.m + '(input: $input) }';
        var vars = mut.ids ? { ids: ids } : { input: { ids: ids, delete_file: level.files, delete_generated: level.generated } };
        return gqlRequest(q, vars).then(function () {
          job.hits.forEach(function (h) { h.done = true; });
          // Media kept on the disk by this level, which the final check offers to delete.
          if (!level.files) job.hits.forEach(function (h) { (h.files || []).forEach(function (f) { self.keptFiles.push(f); }); });
          self.removed = (self.removed || 0) + ids.length;
          self.msg('INFO', 'Removed ' + plural(ids.length, ENTITIES[job.key].label.toLowerCase()) + ': ' +
            job.hits.map(function (h) { return '"' + (h.entName || h.entId) + '" (' + h.entId + ')'; }).join(', ') + '.');
        }, function (e) {
          self.failed++;
          job.hits.forEach(function (h) { h.failed = true; });
          self.msg('ERROR', ENTITIES[job.key].plural + ' not removed (' + ids.join(', ') + '): ' +
            (e && e.message ? e.message : String(e)));
        });
      });
    }, Promise.resolve()); });
  };

  // Replays the recorded previous values, newest first.
  Run.prototype.undo = function () {
    var self = this, jobs = this.changes.slice().reverse();
    this.setState('undoing');
    this.msg('INFO', 'Putting back what ' + plural(jobs.length, 'entity', 'entities') + ' held before.');
    var lease = C.lease(PLUGIN_ID, 'De-Spice (undo)');
    var pass = this.recordUndo ? journalPass('De-Spiced, undone') : null;
    var undone = 0, failed = 0, retry = [];
    function step(i) {
      if (i >= jobs.length) {
        if (pass) pass.finish().then(function (line) { if (line) self.msg('INFO', line); });
        return Promise.resolve();
      }
      var job = jobs[i];
      lease.renew();
      var put = job.write || Object.keys(job.input).length > 1 ? sendJob(job, job.input, 'DSP_Undo') : Promise.resolve();
      return put.then(function () {
        // Each move once, as each counter below: one put back is taken off the list, so a retry
        // after a later failure does not move a file to the name it already has.
        return self.moveFiles({ moves: (job.moves || []).slice(), id: job.input.id, sceneName: job.sceneName }, pass, true,
          function (mv) { job.moves.splice(job.moves.indexOf(mv), 1); });
      }).then(function () {
        // Each counter once: one put back is taken off the list, so a retry does not add it twice.
        return (job.counters || []).slice().reduce(function (p, c) {
          return p.then(function () { return counterWrite(job.input.id, c, true); }).then(function () {
            job.counters.splice(job.counters.indexOf(c), 1);
          });
        }, Promise.resolve());
      }).then(function () {
        undone++;
        if (pass && job.run && job.spec) pass.reverse(job.run, job.spec.key, job.input.id);
      }, function (e) {
        failed++;
        retry.push(job);
        self.msg('ERROR', job.label + ': ' + (e && e.message ? e.message : String(e)));
      }).then(function () { return step(i + 1); });
    }
    step(0).then(function () {
      lease.release();
      // A put-back that failed is still this dialog's to undo: it stays, and Undo with it.
      self.changes = retry.reverse();
      self.written = self.changes.length;
      self.doneHead = '';
      // An image written stays written: the backup is the way back for it.
      self.hits.forEach(function (h) { if (h.shape !== 'image' && h.shape !== 'remove') h.done = false; });
      self.setState('listing');
      self.renderHits();
      self.msg('INFO', 'Undone: ' + plural(undone, 'entity', 'entities') + ' put back' +
        (failed ? ', ' + plural(failed, 'failure') + ' - press Undo again to retry' + (failed === 1 ? ' it' : ' them') : '') + '.');
    });
  };

  // ── After the run ─────────────────────────────────────────────────────────

  Run.prototype.syncClean = function () {
    var busy = this.state !== 'listing';
    this.show(this.cleanEl, this.wrote);
    this.checkBtn.disabled = busy;
    var n = this.keptFiles.length;
    this.show(this.deleteFilesBtn, n > 0);
    if (!this._armedKey) this.deleteFilesBtn.textContent = 'Delete Media Files (' + n + ')';
    this.deleteFilesBtn.title = 'Delete from the disk the ' + plural(n, 'media file') + ' of what this run removed ' +
      'while keeping its files. Press twice: not even the backup brings them back.';
    this.deleteFilesBtn.disabled = busy;
    this.cleanBtn.disabled = busy || !!this.cleanJob;
    this.cleanBtn.title = this.cleanJob ? 'Stash\'s Clean is running: its progress is under the progress line above.'
      : 'Start Stash\'s Clean task. ' + CLEAN_WARNING + '. Press twice: nothing brings them back.';
  };

  // A clean-up asks a second press within a few seconds, its caption counting down, before it
  // runs: nothing it deletes can be brought back.
  var ARM_SECONDS = 5;
  Run.prototype.armed = function (key, run) {
    var self = this, btn = this[key];
    if (this._armedKey === key) { this.disarm(); return run(); }
    this.disarm();
    this._armedKey = key;
    this._armLabel = btn.textContent;
    var left = ARM_SECONDS;
    var tick = function () {
      btn.textContent = 'Press again to confirm (' + left + ')';
      if (left-- <= 0) self.disarm();
    };
    tick();
    this._armTimer = setInterval(tick, 1000);
    return null;
  };
  Run.prototype.disarm = function () {
    if (this._armTimer) clearInterval(this._armTimer);
    this._armTimer = null;
    if (!this._armedKey) return;
    this[this._armedKey].textContent = this._armLabel;
    this._armedKey = null;
  };

  // The same scan, from the start, into a run of its own that writes nothing and shows nothing:
  // what it lists is what these goals and rules would still change.
  Run.prototype.finalCheck = function () {
    var self = this;
    this.setState('checking');
    this.msg('INFO', 'Final check: scanning the library again with the same goals and rules.');
    var probe = Object.create(Run.prototype);
    ['settings', 'rules', 'terms', 'recordUndo', 'offerBackup', 'keepArchive', 'removeTag', 'removeDeletes', 'salt',
      'locks', 'isOwned', 'shapes', 'excl', 'nameAnswers', 'answered', 'oldAnswers', 'textNames']
      .forEach(function (k) { probe[k] = self[k]; });
    probe.reset();
    // The names in free text checked under this run's answers, the presets among them.
    probe.policy = self.policy;
    probe.unarchived = 0;
    probe.sfmField = null;
    probe.newSalt = false;
    probe.notes = [];
    probe.msg = probe.note = function (kind, m) { probe.notes.push(m === undefined ? kind : m); };
    probe.progress = function () {};
    probe.ctxBase = { namer: new Namer(this.salt, this.record, this.newSalt || hasOwn(this.record, NO_LEGACY), randomKinds(this.rules), this.ctxBase.words),
      words: this.ctxBase.words, names: null };
    probe.parent = this;
    return probe.askArchive().then(function () { return probe.describe(); })
      .then(probe.step('scanNames')).then(probe.step('scanRest')).then(probe.step('scanFieldNames')).then(probe.step('scanMarkers'))
      .then(probe.step('scanFilters')).then(probe.step('scanDescriptions')).then(probe.step('scanRemovals'))
      .then(function () { probe.alive(); probe.settleFiles(); self.reportCheck(probe.hits); self.setState('listing'); }, function (e) {
        if (e === CLOSED) return;
        self.msg('ERROR', 'The final check failed: ' + (e && e.message ? e.message : String(e)));
        self.checkPhrase = 'failed - see above.';
        self.setState('listing');
      });
  };

  var CHECK_EXAMPLES = 5;
  // Images are drawn anew every run, so a written image is listed again by any scan: the check
  // leaves them out rather than report every image as left.
  Run.prototype.reportCheck = function (hits) {
    var self = this;
    var left = hits.filter(function (h) { return h.shape !== 'image'; });
    if (!left.length) {
      this.msg('INFO', 'Final check: nothing is left for these goals and rules to change.');
      this.checkPhrase = 'nothing left for these rules to change.';
      return;
    }
    this.checkPhrase = plural(left.length, 'change') + ' these rules would still make - listed above.';
    var by = {};
    left.forEach(function (h) { (by[h.typeKey + ' ' + h.cat] = by[h.typeKey + ' ' + h.cat] || []).push(h); });
    this.msg('WARN', 'Final check: ' + plural(left.length, 'change') + ' these goals and rules would still make - a ' +
      'field that failed or moved, an unticked or hidden line, a removal not made. Close and run again to list them.');
    Object.keys(by).sort().forEach(function (k) {
      var list = by[k], first = list[0];
      self.msg('WARN', '  ' + ENTITIES[first.typeKey].plural + ', ' + CAT[first.cat].label.toLowerCase() + ': ' +
        list.slice(0, CHECK_EXAMPLES).map(function (h) { return self.entityLabel(h) + ' (' + hitLabel(h) + ')'; }).join('; ') +
        (list.length > CHECK_EXAMPLES ? '; and ' + (list.length - CHECK_EXAMPLES) + ' more' : '') + '.');
    });
  };

  Run.prototype.deleteKeptFiles = function () {
    var self = this, ids = this.keptFiles.slice();
    if (!ids.length) return Promise.resolve();
    this.setState('cleaning');
    this.msg('INFO', 'Deleting ' + plural(ids.length, 'media file') + ' from the disk.');
    var chunks = [];
    for (var i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    var gone = 0;
    return chunks.reduce(function (p, chunk) {
      return p.then(function () {
        return gqlRequest('mutation DSP_DeleteFiles($ids: [ID!]!) { deleteFiles(ids: $ids) }', { ids: chunk })
          .then(function () {
            gone += chunk.length;
            self.keptFiles = self.keptFiles.filter(function (f) { return chunk.indexOf(f) === -1; });
          }, function (e) {
            self.msg('ERROR', plural(chunk.length, 'media file') + ' not deleted: ' + (e && e.message ? e.message : String(e)));
          });
      });
    }, Promise.resolve()).then(function () {
      self.msg('INFO', 'Deleted ' + plural(gone, 'media file') + ' from the disk.');
      self.setState('listing');
    });
  };

  Run.prototype.runClean = function () {
    var self = this;
    this.setState('cleaning');
    return gqlRequest('mutation DSP_Clean($input: CleanMetadataInput!) { metadataClean(input: $input) }',
      { input: { dryRun: false } }).then(function (data) {
      var id = data && data.metadataClean;
      self.msg('INFO', 'Stash\'s Clean task has started; it runs on in Stash\'s own task queue (Settings - Tasks)' +
        (id != null ? ', followed here while this dialog stays open.' : '.'));
      if (id != null) self.followClean(String(id));
    }, function (e) {
      self.msg('ERROR', 'Stash\'s Clean task did not start: ' + (e && e.message ? e.message : String(e)));
    }).then(function () { self.setState('listing'); });
  };

  // Stash's Clean, asked about by its job id every two seconds while the dialog is open - what Stash's own
  // Tasks page reads: a live line under the progress line, the time left from its progress against the
  // time taken, and a line in the log when it ends. Run Stash's Clean waits for it.
  var JOB_POLL_MS = 2000;
  Run.prototype.followClean = function (id) {
    var self = this, started = Date.now(), running = null, misses = 0;
    this.cleanJob = id;
    this.syncClean();
    var end = function (kind, message) {
      self.cleanJob = null;
      self.jobEl.textContent = '';
      self.show(self.jobEl, false);
      self.msg(kind, message);
      self.syncClean();
    };
    var poll = function () {
      if (self.closed) return;
      gqlRequest('query DSP_Job($input: FindJobInput!) { findJob(input: $input) { id status progress error } }',
        { input: { id: id } }).then(function (d) {
        if (self.closed) return;
        misses = 0;
        var job = d && d.findJob, status = job ? job.status : null, took = duration(Date.now() - started);
        if (status === 'READY' || status === 'RUNNING' || status === 'STOPPING') {
          var p = typeof job.progress === 'number' ? Math.max(0, Math.min(1, job.progress)) : null, eta = '';
          if (status === 'RUNNING' && running == null) running = Date.now();
          if (p != null && p >= 0.02 && running != null && Date.now() - running >= 4000) {
            eta = aboutLeft((Date.now() - running) * (1 - p) / p);
          }
          self.jobEl.textContent = 'Stash\'s Clean: ' + (status === 'READY' ? 'waiting in Stash\'s queue'
            : status === 'STOPPING' ? 'stopping' : p == null ? 'running' : Math.floor(p * 100) + '%' + (eta ? ' · ' + eta : ''));
          self.show(self.jobEl, true);
          setTimeout(poll, JOB_POLL_MS);
          return;
        }
        var again = ' Final Check scans again without the entries it removed.';
        if (status === 'FINISHED') end('INFO', 'Stash\'s Clean finished in ' + took + '.' + again);
        else if (status === 'FAILED') end('ERROR', 'Stash\'s Clean failed: ' + (job.error || 'Stash gave no reason') + '.');
        else if (status === 'CANCELLED') end('WARN', 'Stash\'s Clean was canceled in Stash.');
        else end('INFO', 'Stash\'s Clean is no longer in Stash\'s queue, after ' + took + ': it ended there.' + again);
      }, function (e) {
        if (self.closed) return;
        if (++misses < 3) { setTimeout(poll, JOB_POLL_MS); return; }
        end('WARN', 'Stash\'s Clean could not be followed (' + (e && e.message ? e.message : String(e)) + '); it runs on in ' +
          'Stash\'s own task queue (Settings - Tasks).');
      });
    };
    poll();
  };

  // ── Escape and closing ────────────────────────────────────────────────────

  // Escape acts through a footer exit that is showing and enabled, never by calling
  // `close()` itself, so the key cannot reach a hidden or disabled button.
  function escapeButton(run) {
    var b = run.closeBtn;
    return b && !b.disabled && !hasClass(b, 'dsp-hidden') ? b : null;
  }

  // The same scan from the start: every count, filter, tick and message goes.
  Run.prototype.rescan = function () {
    if (this.state !== 'listing' || this.changes.length) return;
    this.reset();
    this.noteEl.textContent = '';
    while (this.logEl.firstChild) this.logEl.removeChild(this.logEl.firstChild);
    this.listEl = null;
    this.logText = [];
    this.logDropped = 0;
    this.kinds = {};
    this.logEl.className = this.logEl.className.replace(/\s*dsp-only-\w+/g, '');
    this.begin();
  };

  Run.prototype.close = function () {
    this.closed = true;   // also what ends a scan or a final check (`alive`)
    unwireEscape(this);
    this.disarm();
    this.spin(false);
    if (this.backdrop && this.backdrop.parentNode) this.backdrop.parentNode.removeChild(this.backdrop);
    _active = null;
  };

  // ── The settings page ─────────────────────────────────────────────────────
  //
  // Core's shared treatment of the group - the description split with the rest behind **Show
  // more**, a labelled README link, the stale-script banner - and every setting in a row of its
  // own opening a dialog (Core's `settingsDialog`): a heading, a line saying what is inside,
  // what the settings say now, and a button. Nothing is a row of Stash's own.
  var page = C.settingsPage({
    id: PLUGIN_ID, name: PLUGIN_NAME, shortName: PLUGIN_SHORT_NAME, version: PLUGIN_VERSION,
    prefix: 'dsp', keys: [], tasks: TASKS, readmeUrl: README_URL,
    readmeLabel: 'GTTx-DeSpicer/README.md', injectStyle: injectStyle,
  });

  // What the rows' summaries read, refreshed through Core's one shared read of every plugin's
  // settings, and taken in at once when a dialog saves.
  var _stored = null;
  function storedSettings() {
    if (!_stored) {
      _stored = {};
      for (var k in DEFAULTS) if (hasOwn(DEFAULTS, k)) _stored[k] = k === 'f1Terms' ? defaultTerms() : DEFAULTS[k];
    }
    loadSettings(false).then(function (st) { _stored = st; }, function () {});
    return _stored;
  }
  function dialogLoad() { return loadSettings(true); }
  function dialogSaved(patch) { var c = storedSettings(); for (var k in patch) if (hasOwn(patch, k)) c[k] = patch[k]; }

  function onOff(v) { return v ? '"On"' : '"Off"'; }

  var GOAL_FIELDS = [
    { key: 'a1Anonymize', label: 'Anonymize', warn: 'semi',
      tip: 'Nothing in the library names a real person, studio, place, site or file.\n\nOn: each kind of data ' +
        'that follows the goals takes Anonymize\'s treatment - names and custom field values become pseudonyms, ' +
        'links made-up ones, free text, performer\'s facts and dates are blanked, images replaced by a card, scene ' +
        'files renamed. Off: they are kept, unless Vanillify asks otherwise. A rule of its own in Rules wins ' +
        'over either.' },
    { key: 'a2Vanillify', label: 'Vanillify', warn: 'semi',
      tip: 'Nothing in the library\'s text is explicit.\n\nOn: every term in Explicit Terms is rewritten wherever ' +
        'text is kept - names, free text, custom field values and names, saved filters, file names - and images are blurred ' +
        'unless Anonymize replaces them. Off: no term is rewritten.\n\nIt makes text inoffensive, not anonymous: ' +
        'each term has a replacement of its own, so the rewording can be undone, and kept text can be searched ' +
        'online. Anonymity is Anonymize\'s blank and pseudonym rules.' },
  ];
  function goalsSummary(st) {
    return ['Anonymize ', { text: onOff(st.a1Anonymize), hl: st.a1Anonymize ? 'semi' : null }, ', Vanillify ',
      { text: onOff(st.a2Vanillify), hl: st.a2Vanillify ? 'semi' : null }, '.'];
  }

  var TYPE_FIELDS = TYPE_KEYS.map(function (t) {
    var plural = ENTITIES[t[1]].plural;
    // Two to a line, saved filters - no entity-type - on a line of their own after them.
    return { key: t[0], label: plural, warn: 'semi', half: t[1] !== 'filters',
      tip: 'Whether a run reads ' + plural.toLowerCase() + '.\n\nOn: they are read, and every rule applies to ' +
        'them. Off: none is read or changed, and the run is faster for it. The dialog can turn a type on or ' +
        'off for one run.' };
  });
  // Saved filters are the ninth switch but no entity-type, so the summary names them apart.
  function typesSummary(st) {
    var on = TYPE_KEYS.filter(function (t) { return st[t[0]] !== false; });
    var types = on.filter(function (t) { return t[1] !== 'filters'; }), filters = types.length < on.length;
    if (on.length === TYPE_KEYS.length) return 'Every entity-type, and saved filters.';
    if (!on.length) return 'No entity-type and no saved filter: a run reads nothing.';
    if (types.length === TYPE_KEYS.length - 1) return 'Every entity-type, but no saved filter.';
    if (!types.length) return ['No entity-type: only ', { text: 'saved filters', hl: 'semi' }, '.'];
    return ['Only '].concat(types.map(function (t, n) {
      return { text: (n ? ', ' : '') + ENTITIES[t[1]].plural, hl: 'semi' };
    })).concat(filters ? [', and ', { text: 'saved filters', hl: 'semi' }, '.'] : '.');
  }

  var RULE_FIELDS = RULE_KEYS.map(function (k) {
    var c = CAT[k[1]];
    return { key: k[0], label: c.label, warn: 'semi', dflt: 'auto',
      choices: [['auto', WAY_LABEL.auto]].concat(c.ways.map(function (w) { return [w, wayLabel(k[1], w)]; })),
      aside: function (v, boxes) {
        return autoNote(v, { anonymize: boxes.a1Anonymize.checked, vanillify: boxes.a2Vanillify.checked }, k[1]);
      },
      tip: c.tip + '\n\nAs the goals say: ' + wayLabel(k[1], ANONYMIZE[k[1]]).toLowerCase() + ' under Anonymize; ' +
        (VANILLIFY[k[1]] ? wayLabel(k[1], VANILLIFY[k[1]]).toLowerCase() : 'kept') + ' under Vanillify alone. Any other ' +
        'choice holds whatever the goals say.' };
  });
  // Right after Free text, which it narrows: a tag's name is looked for in other text, or only renamed in
  // its own field, as its aliases always are.
  RULE_FIELDS.splice(RULE_KEYS.map(function (k) { return k[0]; }).indexOf('c2Text') + 1, 0,
    { key: 'c2bTagNamesInText', label: 'Tag Names in Free Text', warn: 'semi',
      // Tag names are looked for only where names are replaced in text: free text, or a filter's criteria.
      aside: function (v, boxes) {
        var goals = { anonymize: boxes.a1Anonymize.checked, vanillify: boxes.a2Vanillify.checked };
        var way = function (k, cat) { return boxes[k].value === 'auto' ? presetOf(goals, cat) : boxes[k].value; };
        var text = way('c2Text', 'text'), filters = way('c8Filters', 'filters');
        return text === 'pseudonym' || filters !== 'keep' ? ''
          : '→ no effect while Free text is ' + wayLabel('text', text);
      },
      tip: 'On: a tag\'s name is replaced in free text as other names are - a one-word name in its own family of ' +
        'tags, a name of several words wherever it appears. Off: a tag is still renamed in its own name field, ' +
        'but its name is never looked for in other text, as its aliases never are.\n\nTag names are mostly ' +
        'ordinary words: turn it off where a name of several words, like "Hair Color", reads in your scenes\' ' +
        'details as a phrase rather than as the tag. On by default.' });
  RULE_FIELDS = RULE_FIELDS.concat([{ key: 'd1BlurStrength', label: 'Blur Strength', warn: 'semi', number: true, dflt: '5',
    range: [1, 10], demo: blurDemo,
    // Gray, "(inactive)", while Entity images does not blur - what the goals make of it where it is left to them.
    inactive: function (boxes) {
      var w = boxes.c9Images.value;
      return (w === 'auto' ? presetOf({ anonymize: boxes.a1Anonymize.checked, vanillify: boxes.a2Vanillify.checked }, 'images') : w) !== 'blur';
    },
    tip: 'How strongly an image is blurred where its rule says blur, as a percentage of its longer side - the ' +
      'side Stash fits a card by, so a wide logo and a photo blur alike: 5 by default, 1 to 10. The sample beside ' +
      'the slider is blurred as a run would blur it.' }]);
  function rulesSummary(st) {
    var own = RULE_KEYS.filter(function (k) { return st[k[0]] && st[k[0]] !== 'auto'; });
    var parts = own.length ? [] : ['Every kind of data as the goals say'];
    own.forEach(function (k, n) {
      parts.push((n ? ', ' : '') + CAT[k[1]].label + ' ', { text: '"' + wayLabel(k[1], st[k[0]]) + '"', hl: 'semi' });
    });
    if (own.length && own.length < RULE_KEYS.length) parts.push('; the rest as the goals say');
    if (st.c2bTagNamesInText === false || st.c2bTagNamesInText === 'false') parts.push('. Tag names in free text ', { text: '"Off"', hl: 'semi' });
    return parts.concat('. Blur strength "' + strengthOf(st.d1BlurStrength) + '".');
  }

  // The terms are a dialog of this plugin's own (`openTermsEditor`); the field here only lends
  // the row its level and its name.
  var TERMS_FIELDS = [{ key: 'f1Terms', label: 'Explicit Terms', warn: 'semi', tip: '' },
    { key: 'f2Plurals', label: 'Plural Rules', warn: 'semi', tip: '' }];
  function termsSummary(st) {
    var n = parseTerms(st.f1Terms).length, lang = PLURALS[st.f2Plurals] ? st.f2Plurals : DEFAULTS.f2Plurals;
    if (!n) return ['No explicit terms: Vanillify rewrites nothing.'];
    return ['"' + n + '" explicit ' + (n === 1 ? 'term' : 'terms') +
      (lang === 'none' ? ', plurals must be specified.' : ', plurals by "' + PLURALS[lang].label + '" rules.')];
  }

  var REMOVAL_FIELDS = [
    { key: 'e1RemoveTag', label: 'Remove Everything Tagged', text: true, wide: true, warn: true, tag: true,
      mark: function (v) { return C.tagMark(v); },
      tip: 'The name of a tag: every scene, image, gallery, group, performer, studio and scene marker carrying it, ' +
        'or any tag under it, is listed for removal - a line each, to untick or keep - and removed after the rest ' +
        'of the run, never undone. An entity What a Run Reads leaves alone is not removed. Empty, nothing is removed. 🔗 beside the box opens the tag; a red ? says no tag has ' +
        'that name or alias.' },
    { key: 'e2RemoveDeletes', label: 'Removal Deletes', warn: true, dflt: 'generated',
      choices: Object.keys(REMOVE_DELETES).map(function (k) { return [k, REMOVE_DELETES[k].label]; }),
      tip: 'What a removal deletes with the entity: nothing more, its generated files (previews, sprites, ' +
        'screenshots), or its media files as well. Media files deleted are gone from the disk, beyond even the ' +
        'backup. The dialog can choose otherwise for one run.' },
  ];
  function removalSummary(st) {
    var tag = trim(st.e1RemoveTag);
    if (!tag) return 'Nothing is removed.';
    return ['Removing everything tagged ', { text: '"' + tag + '"', hl: true, tag: true, mark: function () { return C.tagMark(tag); } }, ' - ',
      { text: '"' + REMOVE_DELETES[deletesOf(st.e2RemoveDeletes)].label + '"', hl: true }, '.'];
  }

  var EXCLUSION_TAG_TIP = ' Matched by the tag\'s name or an alias, in any case, carried directly - a parent of it does ' +
    'not count; a marker\'s primary tag counts. The tag itself is left alone too. 🔗 beside the box opens the tag; a red ? ' +
    'says no tag has that name or alias, so nothing carries it yet, and a run warns and holds Proceed back unless the box ' +
    'holds its default. Empty, this exclusion is off.';
  var EXCLUSION_FIELD_TIP = ' Only the presence of the field matters - any value at all, even an empty one. ' +
    'Scene markers and saved filters have no custom fields. Empty, this exclusion is off.';
  var EXCLUSION_FIELDS = [
    { key: 'h1ExcludeEntityWithTagName', warn: 'semi', label: 'Leave Alone Entities Carrying This Tag', text: true, wide: true,
      tag: true, mark: function (v) { return C.tagMark(v); },
      tip: 'An entity carrying this tag is left out of every run: its name, text, links, facts, images and files ' +
        'stay as they are, it is not removed, and its name is not replaced where other entities mention it.' +
        EXCLUSION_TAG_TIP },
    { key: 'h2ExcludeEntityWithCustomFieldName', warn: 'semi', label: 'Leave Alone Entities Marked via This Custom Field', text: true,
      wide: true, mark: function (v) { return v ? C.cfTipMark(v) : null; },
      tip: 'An entity holding this custom field is left out of every run, as with the tag above.' + EXCLUSION_FIELD_TIP },
    { key: 'h3ExcludeImageWithTagName', warn: 'semi', label: 'Keep the Image of Entities Carrying This Tag', text: true, wide: true,
      tag: true, mark: function (v) { return C.tagMark(v); },
      tip: 'An entity carrying this tag keeps its image - neither blurred nor replaced by a card - and the rest of it ' +
        'is rewritten as usual - a studio\'s logo, say.' + EXCLUSION_TAG_TIP },
    { key: 'h4ExcludeImageWithCustomFieldName', warn: 'semi', label: 'Keep the Image of Entities Marked via This Custom Field',
      text: true, wide: true, mark: function (v) { return v ? C.cfTipMark(v) : null; },
      tip: 'An entity holding this custom field keeps its image, as with the tag above.' + EXCLUSION_FIELD_TIP },
  ];
  function exclusionSummary(st) {
    var x = exclusionsOf(st);
    var tag = function (n) { return { text: '"' + n + '"', hl: 'semi', tag: true, mark: function () { return C.tagMark(n); } }; };
    var either = function (t, f) {
      var out = [];
      if (t) out.push('tagged ', tag(t));
      if (t && f) out.push(' or ');
      if (f) out.push('holding ', { cf: f, hl: 'semi' });
      return out;
    };
    var parts = [];
    if (x.entityTag || x.entityField) parts = parts.concat(['Leaving alone entities '], either(x.entityTag, x.entityField));
    if (x.imageTag || x.imageField) {
      parts = parts.concat(parts.length ? ['; keeping the image of those '] : ['Keeping the image of entities '],
        either(x.imageTag, x.imageField));
    }
    return parts.length ? parts.concat('.') : 'Nothing is excluded.';
  }

  // Three settings for the one question of what this library is, so either answer is one press:
  // the dialog's All On and All Off say in their tooltips what each end means.
  var REAL_TIP = 'This library is your real one: a run is recorded in Undo History so it can be undone after the ' +
    'dialog closes, Stash\'s backup is offered before it, and Scene Filename Manager\'s archive of original ' +
    'filenames is kept, so its Restore Original Filenames still works.';
  var COPY_TIP = 'This library is a copy - a second Stash opened on a backup of your library: a run is not ' +
    'recorded in Undo History, no backup is offered, and Scene Filename Manager\'s archive of original ' +
    'filenames is cleared, since it names your real files.';
  var LIBRARY_FIELDS = [
    { key: 'g1RecordUndo', label: 'Record in Undo History', warn: true,
      tip: 'On: a run is recorded in ᝯㄝₓ Core\'s Undo History, so it can be undone after the dialog closes - ' +
        'all but its images, its removals, stash-ids, scene marker titles and saved filters. Off: nothing is ' +
        'recorded, and Undo in the dialog is the only way back while it stays open.' },
    { key: 'g2OfferBackup', label: 'Offer Stash\'s Backup First',
      tip: 'On: the dialog carries Back Up Now, which runs Stash\'s own backup before you press Proceed. Off: it ' +
        'does not.' },
    { key: 'g3KeepArchive', label: 'Keep Scene Filename Manager\'s Archive', warn: true,
      tip: 'On: the archive of original filenames ᝯㄝₓ Scene Filename Manager keeps on each scene is left as it ' +
        'is, so Restore Original Filenames can take a renamed file back. Off: a run lists it to be cleared, a ' +
        'line per scene - it names your real files.' },
  ];
  function librarySummary(st) {
    var r = st.g1RecordUndo !== false, b = st.g2OfferBackup !== false, a = st.g3KeepArchive !== false;
    if (r && b && a) return 'Your real library: recorded in Undo History, backup offered, archive kept.';
    if (!r && !b && !a) return [{ text: 'A copy', hl: true }, ': not recorded in Undo History, no backup offered, ' +
      'Scene Filename Manager\'s archive cleared.'];
    return ['Undo History ', { text: onOff(r), hl: r ? null : true }, ', backup offer ', onOff(b),
      ', archive ', { text: a ? '"Kept"' : '"Cleared"', hl: a ? null : true }, '.'];
  }

  function row(key, title, line, fields, summary, extra) {
    var o = { id: PLUGIN_ID, shortName: PLUGIN_SHORT_NAME, prefix: 'dsp', key: key, title: title, line: line,
      fields: fields, summary: summary, settings: storedSettings, load: dialogLoad, saved: dialogSaved };
    for (var k in extra || {}) if (hasOwn(extra, k)) o[k] = extra[k];
    return C.settingsDialog(o);
  }
  // Four rows, each one level: what a run is for and does to each kind of data, the terms, what it
  // reads, and what lasts beyond the rewrite - removal, and whether the library is the real one.
  // The keys keep their letters wherever their row moved: a key is what is stored.
  function both(a, b) { return function (st) { return [].concat(a(st), ' ', b(st)); }; }
  var ROWS = [
    row('goals', 'Goals and Rules', 'Anonymize, Vanillify or both - what a run is for - and how each kind of data ' +
      'is treated: as the goals say, or kept, blanked, a placeholder, a pseudonym or random words, and how strongly an image is ' +
      'blurred. Fifteen settings, in a dialog.',
    [fieldHeading('Goals', 'What a run is for. Each kind of data follows them unless its own rule below says otherwise.')]
      .concat(GOAL_FIELDS, [fieldHeading('Rules', 'How each kind of data is treated: as the goals say, or a treatment of ' +
        'its own that holds whatever the goals say.')], RULE_FIELDS), both(goalsSummary, rulesSummary), { columns: 2 }),
    row('terms', 'Explicit Terms', 'The terms Vanillify rewrites, each with what replaces it, or removed. A list, ' +
      'in an editor that imports and exports YAML.', TERMS_FIELDS, termsSummary,
    { open: function () { openTermsEditor(); } }),
    row('reads', 'What a Run Reads', 'Which of the eight entity-types a run reads, and saved filters; and the ' +
      'entities it leaves alone, or whose image it keeps, by a tag they carry or a custom field they hold. Thirteen ' +
      'settings, in a dialog.',
    [fieldHeading('Entity-Types', 'Which of the eight entity-types a run reads, and whether it reads saved filters, which ' +
      'are not one; what is off is not read at all.', { onTip: 'A run reads every entity-type, and saved filters.',
      offTip: 'A run reads no entity-type and no saved filter - turn on the ones it should.' })]
      .concat(TYPE_FIELDS, [fieldHeading('Exclusions', 'Entities a run leaves alone, or whose image it keeps, by a tag ' +
        'they carry or a custom field they hold. An entity left alone is not removed either.')], EXCLUSION_FIELDS),
    both(typesSummary, exclusionSummary)),
    row('removal', 'Removal and Safety', 'Removing everything carrying a tag, and how much goes with it; and ' +
      'whether this is your real library or a copy - Undo History, the backup offer, Scene Filename Manager\'s ' +
      'archive. Five settings, in a dialog.',
    [fieldHeading('Removal', 'Removing everything carrying a tag, and how much goes with it.')]
      .concat(REMOVAL_FIELDS, [fieldHeading('Real Library or Copy', 'Whether a run is recorded in Undo History, whether ' +
        'the backup is offered first, and whether Scene Filename Manager\'s archive is kept - all on for your real ' +
        'library, all off for a copy.', { onTip: REAL_TIP, offTip: COPY_TIP })], LIBRARY_FIELDS),
    both(removalSummary, librarySummary)),
  ];

  function settingsTick() {
    var group = page.group();
    page.decorate(group);
    if (group) ROWS.forEach(function (r) { r.tick(group); });
  }

  // ── The term editor ───────────────────────────────────────────────────────
  //
  // A list, one row a term: the term, what replaces it - empty removes it - and a button taking
  // the row out. Filtered by a box, added to a row at a time, imported from and exported to YAML,
  // set back to the default list or cleared. Nothing is stored until Save.
  var _termsOpen = null;
  function openTermsEditor() {
    if (_termsOpen) { if (_termsOpen.modal.scrollIntoView) _termsOpen.modal.scrollIntoView(); return; }
    _termsOpen = new TermsEditor();
  }

  // The YAML this editor writes and reads: a `terms:` map of quoted strings, "" for a term removed.
  function termsYaml(list, lang) {
    return ['# ᝯㄝₓ De-Spicer - Explicit Terms', '# term: replacement ("" removes the term)',
      '# plurals: ' + PLURAL_KEYS.join(' or ') + ' - how a plural of a term is found and replaced',
      'plurals: ' + (PLURALS[lang] ? lang : DEFAULTS.f2Plurals), 'terms:']
      .concat(list.map(function (t) { return '  ' + JSON.stringify(t.from) + ': ' + JSON.stringify(t.to || ''); }))
      .join('\n') + '\n';
  }
  // Reads that map back, a bare `term: replacement` and a `- term` list too; anything else is skipped.
  function parseTermsYaml(text) {
    var out = [];
    var q = '"(?:[^"\\\\]|\\\\.)*"';
    var re = new RegExp('^\\s*(?:-\\s*)?(' + q + "|'[^']*'|[^:#\"']+?)\\s*(?::\\s*(" + q + "|'[^']*'|[^#]*?))?\\s*(?:#.*)?$");
    function val(v) {
      if (v == null) return '';
      v = trim(v);
      if (/^"/.test(v)) { try { return JSON.parse(v); } catch (e) { return v; } }
      return /^'.*'$/.test(v) ? v.slice(1, -1) : v;
    }
    String(text).split(/\r?\n/).forEach(function (line) {
      if (!trim(line) || /^\s*#/.test(line) || /^\s*terms\s*:\s*$/.test(line) || /^plurals\s*:/.test(line)) return;
      var m = re.exec(line);
      if (!m) return;
      var from = trim(val(m[1]));
      var t = storableTerm({ from: from, to: val(m[2]) });
      if (t.from) out.push(t);
    });
    return out;
  }

  // The file's `plurals:` line, where it names rules this plugin has; else null.
  function yamlPlurals(text) {
    var m = /^plurals\s*:\s*["']?(\w+)["']?\s*(?:#.*)?$/m.exec(String(text));
    return m && PLURALS[m[1].toLowerCase()] ? m[1].toLowerCase() : null;
  }

  function TermsEditor() {
    var self = this;
    injectStyle();
    this.list = [];
    this.stored = null;
    this.backdrop = el('div', 'dsp-backdrop');
    this.modal = el('div', 'dsp-modal dsp-narrow dsp-tall');
    this.backdrop.appendChild(this.modal);
    var head = el('div', 'dsp-head');
    head.appendChild(el('div', 'dsp-title', PLUGIN_SHORT_NAME + ' - Explicit Terms'));
    this.noteEl = el('div', 'dsp-note', 'Reading the current settings…');
    head.appendChild(this.noteEl);
    var legend = el('div', 'dsp-legend');
    legend.appendChild(el('span', null, 'A term may be several words: between them a space, a dash, an underscore, ' +
      'a dot or nothing at all is the same term - "blow job" finds "blowjob" - and Plural Rules finds its plural and ' +
      'makes the replacement plural. A term ending in + is a verb: English finds its -ing and -ed forms too. ' +
      'The longest term is found first. An empty replacement removes the term. A term listed twice, and a replacement ' +
      'two terms share, are in the highlight color.'));
    head.appendChild(legend);
    this.modal.appendChild(head);

    var bar = el('div', 'dsp-search dsp-search-wrap');
    this.nameEl = C.markLevel(el('span', 'dsp-label dsp-terms-name', 'Explicit Terms'), 'semi');
    bar.appendChild(this.nameEl);
    this.countEl = bar.appendChild(el('span', 'dsp-label', ''));
    bar.appendChild(C.markLevel(el('span', 'dsp-label dsp-terms-name', 'Plural Rules'), 'semi'));
    this.pluralsSel = C.markLevel(C.dropdown('dsp-rulesel dsp-plurals'), 'semi');
    PLURAL_KEYS.forEach(function (k) {
      var o = el('option', null, PLURALS[k].label);
      o.value = k;
      self.pluralsSel.appendChild(o);
    });
    this.pluralsSel.value = DEFAULTS.f2Plurals;
    this.pluralsSel.title = 'How a plural of a term is found and replaced. English: "hand jobs" is found with ' +
      '"hand job" and becomes "hand massages", and "orgies" is found with "orgy". None: a term is found only as ' +
      'written, so every plural is a term of its own - for a list in another language. A plural listed as a ' +
      'term is always found as written.';
    this.pluralsSel.addEventListener('change', function () { self.sync(); });
    bar.appendChild(this.pluralsSel);
    this.filterEl = el('input', 'dsp-textbox');
    this.filterEl.type = 'text';
    this.filterEl.placeholder = 'Filter';
    this.filterEl.title = 'Show only the terms and replacements holding this text.';
    this.filterEl.addEventListener('input', function () { self.render(); });
    bar.appendChild(this.filterEl);
    function tool(label, title, fn) {
      var b = bar.appendChild(button(label, 'dsp-termtool'));
      b.title = title;
      b.addEventListener('click', function () { if (!b.disabled) fn(); });
      return b;
    }
    this.addBtn = tool('Add Term', 'Add an empty row at the top of the list, for a new term.', function () {
      self.filterEl.value = '';
      self.list.unshift({ from: '', to: '' });
      self.render();
    });
    this.importBtn = tool('Import YAML...', 'Add the terms of a YAML file - one this editor exported, or any ' +
      '"term: replacement" lines. A term already listed takes the file\'s replacement.', function () { self.pick(); });
    this.exportBtn = tool('Export YAML', 'Save the list as it stands here as a YAML file.', function () { self.exportYaml(); });
    this.defaultsBtn = tool('Restore Defaults', 'Put the list the plugin ships, and English plural rules, back in place ' +
      'of these. Nothing is stored until Save.', function () {
      self.list = parseTerms(defaultTerms());
      self.pluralsSel.value = DEFAULTS.f2Plurals;
      self.render();
    });
    this.clearBtn = tool('Clear All', 'Take every term out of the list. Nothing is stored until Save; Close keeps ' +
      'the list as it was.', function () { self.list = []; self.render(); });
    this.modal.appendChild(bar);

    this.listEl = el('div', 'dsp-log dsp-terms');
    this.modal.appendChild(this.listEl);

    var foot = el('div', 'dsp-foot');
    this.saveBtn = button('Save', 'dsp-termsave');
    paintButton(this.saveBtn, 'btn-primary');   // Stash's blue: it writes a setting, never the library
    this.closeBtn = button('Close', 'dsp-termclose');
    this.closeBtn.title = 'Close without saving.';
    this.saveBtn.addEventListener('click', function () { if (!self.saveBtn.disabled) self.save(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });
    foot.appendChild(this.saveBtn);
    foot.appendChild(this.closeBtn);
    this.modal.appendChild(foot);
    wireEscape(this, 'dsp', function (run) { return run.closeBtn.disabled ? null : run.closeBtn; });
    document.body.appendChild(this.backdrop);
    this.render();
    loadSettings(true).then(function (st) {
      self.list = parseTerms(st.f1Terms);
      self.stored = formatTerms(self.list);
      self.storedPlurals = PLURALS[st.f2Plurals] ? st.f2Plurals : DEFAULTS.f2Plurals;
      self.pluralsSel.value = self.storedPlurals;
      self.noteEl.textContent = 'Edit the list; nothing is stored until Save.';
      self.render();
    }, function (e) {
      self.noteEl.textContent = 'The settings could not be read: ' + (e && e.message ? e.message : String(e));
    });
  }

  TermsEditor.prototype.render = function () {
    var self = this, f = trim(this.filterEl.value).toLowerCase();
    this.listEl.textContent = '';
    this.boxes = [];
    var shown = 0;
    this.list.forEach(function (t) {
      if (f && (t.from + ' ' + t.to).toLowerCase().indexOf(f) === -1) return;
      shown++;
      var row = el('div', 'dsp-termrow');
      var from = el('input', 'dsp-textbox dsp-termfrom');
      from.type = 'text';
      from.value = t.from;
      from.placeholder = 'term';
      from.title = 'The term: one word or several. It cannot hold = or start with #, which the stored list ' +
        'reads as a separator and a note.';
      from.addEventListener('input', function () { t.from = from.value; self.sync(); self.markDups(); });
      var to = el('input', 'dsp-textbox dsp-termto');
      to.type = 'text';
      to.value = t.to;
      to.placeholder = '(removed)';
      to.title = 'What replaces it, in the case the term was written in. Empty, the term is removed.';
      to.addEventListener('input', function () { t.to = to.value; self.sync(); self.markDups(); });
      var del = button('×', 'dsp-termdel');
      del.title = 'Take "' + (t.from || 'this term') + '" out of the list.';
      del.addEventListener('click', function () {
        var at = self.list.indexOf(t);
        if (at !== -1) self.list.splice(at, 1);
        self.render();
      });
      self.boxes.push({ t: t, from: from, to: to });
      row.appendChild(from);
      row.appendChild(el('span', 'dsp-label', '→'));
      row.appendChild(to);
      row.appendChild(del);
      self.listEl.appendChild(row);
    });
    if (!this.list.length) this.listEl.appendChild(el('div', 'dsp-line dsp-INFO', 'No terms. Add Term, Import YAML or ' +
      'Restore Defaults fills the list.'));
    this.sync(shown);
    this.markDups();
  };

  // In the Highlighted Text Color: a term listed twice - the same once spaces, dashes, underscores
  // and dots are taken out - and a replacement two terms share, which leaves a run's text unable to
  // say which of them was there. Over the whole list, filtered or not.
  TermsEditor.prototype.markDups = function () {
    var byKey = {}, byTo = {}, keyOf = function (t) { return termKey(t.from); }, toOf = function (t) { return trim(t.to).toLowerCase(); };
    this.list.forEach(function (t) {
      var k = keyOf(t), r = toOf(t);
      if (k) (byKey[k] = byKey[k] || []).push(t);
      if (r) (byTo[r] = byTo[r] || []).push(t);
    });
    var twice = 0, shared = 0;
    Object.keys(byKey).forEach(function (k) { if (byKey[k].length > 1) twice += byKey[k].length - 1; });
    Object.keys(byTo).forEach(function (r) { if (byTo[r].length > 1) shared += byTo[r].length; });
    var mark = function (box, list, what) {
      var dup = list && list.length > 1;
      box.className = box.className.replace(/\s*dsp-termdup/g, '') + (dup ? ' dsp-termdup' : '');
      if (dup) {
        box.title = what + ' ' + list.filter(function (x) { return x !== box._t; }).map(function (x) { return '"' + x.from + '"'; }).join(', ') + '.';
      }
    };
    (this.boxes || []).forEach(function (b) {
      b.from._t = b.to._t = b.t;
      mark(b.from, byKey[keyOf(b.t)], 'The same term as');
      mark(b.to, byTo[toOf(b.t)], 'The same replacement as');
    });
    this.dupsEl = this.dupsEl || this.countEl.parentNode.insertBefore(el('span', 'dsp-label dsp-termdups', ''), this.countEl.nextSibling);
    this.dupsEl.textContent = (twice ? plural(twice, 'term') + ' listed twice' : '') + (twice && shared ? ', ' : '') +
      (shared ? plural(shared, 'term') + ' sharing a replacement' : '');
    C.markLevel(this.dupsEl, twice || shared ? true : '');
  };

  TermsEditor.prototype.clean = function () {
    return parseTerms(formatTerms(this.list.map(storableTerm)));
  };

  TermsEditor.prototype.sync = function (shown) {
    var n = this.clean().length;
    if (shown != null) this.countEl.textContent = plural(n, 'term') + (shown < this.list.length ? ', ' + shown + ' shown' : '');
    else this.countEl.textContent = plural(n, 'term');
    var moved = this.stored != null && (formatTerms(this.clean()) !== this.stored || this.pluralsSel.value !== this.storedPlurals);
    this.saveBtn.disabled = !moved;
    this.saveBtn.title = this.stored == null ? 'Still reading the current settings.'
      : moved ? 'Store this list and its plural rules in the Explicit Terms setting.' : 'Nothing has changed since this opened.';
    this.clearBtn.disabled = !this.list.length;
    this.exportBtn.disabled = !n;
  };

  TermsEditor.prototype.save = function () {
    var self = this, text = formatTerms(this.clean()), lang = this.pluralsSel.value;
    this.saveBtn.disabled = this.closeBtn.disabled = true;
    this.noteEl.textContent = 'Saving…';
    C.writePluginSettings(PLUGIN_ID, { f1Terms: text, f2Plurals: lang }, 'DSPTerms').then(function () {
      dialogSaved({ f1Terms: text, f2Plurals: lang });
      self.close();
    }, function (e) {
      self.closeBtn.disabled = false;
      self.noteEl.textContent = 'The terms could not be saved: ' + (e && e.message ? e.message : String(e));
      self.sync();
    });
  };

  // A file picked, read, and its terms taken in: new ones added, listed ones given the file's replacement.
  TermsEditor.prototype.pick = function () {
    var self = this, input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yml,.yaml,.txt';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { self.importText(String(reader.result || '')); };
      reader.readAsText(file);
    });
    input.click();
  };
  TermsEditor.prototype.importText = function (text) {
    var self = this, got = parseTermsYaml(text), added = 0, changed = 0, lang = yamlPlurals(text);
    if (lang) this.pluralsSel.value = lang;
    got.forEach(function (t) {
      var have = self.list.filter(function (x) { return termKey(x.from) === termKey(t.from); })[0];
      if (!have) { self.list.push(t); added++; } else if (have.to !== t.to) { have.to = t.to; changed++; }
    });
    this.noteEl.textContent = got.length ? 'Imported: ' + plural(added, 'term') + ' added, ' + changed + ' with a new ' +
      'replacement' + (lang ? ', plural rules ' + PLURALS[lang].label.split(' ')[0] : '') + '. Nothing is stored until ' +
      'Save.' : 'That file holds no terms this editor can read.';
    this.render();
  };
  TermsEditor.prototype.exportYaml = function () {
    var text = termsYaml(this.clean(), this.pluralsSel.value);
    saveText(text, 'de-spicer-terms.yml', 'text/yaml');
    this.exported = text;
  };

  TermsEditor.prototype.close = function () {
    unwireEscape(this);
    if (this.backdrop.parentNode) this.backdrop.parentNode.removeChild(this.backdrop);
    _termsOpen = null;
  };

  // ── Ticking ───────────────────────────────────────────────────────────────
  function tick() {
    try { settingsTick(); } catch (e) { console.error('[dsp] settings tick failed', e); }
    try {
      C.paintTaskButtons(PLUGIN_NAME, TASKS, function () { return PLUGIN_BTN_VARIANT; });
    } catch (e) { console.error('[dsp] task paint failed', e); }
  }

  if (window.addEventListener) {
    window.addEventListener('load', function () { tick(); });
    window.addEventListener('popstate', function () { setTimeout(tick, 300); });
  }
  setInterval(tick, TICK_MS);
  tick();

  // The question Find & Replace's Term counts asks of every phrase it counted: is it an Explicit Term,
  // and what does it become? Resolves to a worker answering `lookup(phrase)` synchronously - the
  // replacement, '' for a term removed, null for none - by this plugin's own matching, from the terms
  // and Plural Rules stored now (the default list where none is). A failed read rejects.
  function apiTerms() {
    return loadSettings(true).then(function (s) {
      var terms = parseTerms(s.f1Terms), table = termTable(terms, s.f2Plurals);
      var replace = termReplacer(terms, s.f2Plurals) || function (text) { return text; };
      return { count: table.list.length, lookup: table.lookup, replace: replace };
    });
  }

  // The two questions Find & Replace's De-Spicer buttons ask, of the types a run reads now: which fields its
  // goals and rules would change (`fields`) - a rule other than Keep, or Vanillify rewriting the Explicit Terms
  // in what a rule keeps - and in which the original words survive (`kept`) - Keep or Never rename, or a
  // pseudonym in free text, which keeps every word but the names. Every field of a category counts, whatever
  // its shape: a performer's measurements are a fact here and text there. Custom fields come as
  // `custom_fields.value` and `custom_fields.name`, the scene files' names as `files`; `types` keeps markers
  // and saved filters for the caller to set aside.
  function apiScope() {
    return loadSettings(true).then(function (s) {
      var r = rulesFrom(s);
      var touched = function (cat) {
        var w = wayOf(r, cat);
        return (w !== 'keep' && w !== 'never') || (r.goals.vanillify && !NO_WORDS[cat] && !NO_WORDS[w]);
      };
      var survives = function (cat) {
        var w = wayOf(r, cat);
        return w === 'keep' || w === 'never' || (cat === 'text' && w === 'pseudonym');
      };
      var types = TYPE_KEYS.map(function (t) { return t[1]; }).filter(function (k) { return r.types[k]; });
      var fields = [], kept = [];
      var add = function (list, n) { if (list.indexOf(n) === -1) list.push(n); };
      var each = function (cat, n) {
        if (touched(cat)) add(fields, n);
        if (survives(cat)) add(kept, n);
      };
      types.forEach(function (k) {
        (FIELDS[k] || []).forEach(function (f) {
          if (f.shape === 'ids' || /^(images|ratings|dates)$/.test(f.cat)) return;   // no text to find
          if (f.shape === 'map') {
            each('fields', 'custom_fields.value');
            each('fieldnames', 'custom_fields.name');
          } else each(f.cat, f.name);
        });
      });
      if (r.types.scenes) each('files', 'files');
      return { types: types, fields: fields, kept: kept };
    });
  }
  // The question Find & Replace's "Skip what De-Spicer removes" asks: what a run would remove now - the same lookup
  // as `scanRemovals` (the Remove Everything Tagged tag by name or alias, every tag under it, the types turned on,
  // Leave Alone exempting), on a Run with no dialog, as the final check builds one. Resolves to `{ tag, ids, notes }`:
  // the tag as set ('' for none), the ids per type, and what the lookup would have said in a dialog.
  function apiRemovals() {
    return loadSettings(true).then(function (s) {
      var p = Object.create(Run.prototype);
      p.settings = s;
      p.rules = rulesFrom(s);
      p.removeTag = trim(s.e1RemoveTag);
      p.hits = [];
      p.notes = [];
      p.msg = function (kind, m) { p.notes.push(m === undefined ? kind : m); };
      p.note = function (m) { p.notes.push(m); };
      if (!p.removeTag) return { tag: '', ids: {}, notes: [] };
      return p.resolveExclusions().then(function () { return p.scanRemovals(); }).then(function () {
        var ids = {};
        p.hits.forEach(function (h) { (ids[h.typeKey] = ids[h.typeKey] || []).push(h.entId); });
        return { tag: p.removeTag, ids: ids, notes: p.notes };
      });
    });
  }
  coop().api[PLUGIN_ID] = { version: PLUGIN_VERSION, terms: apiTerms, scope: apiScope, removals: apiRemovals };
  window.__GTTx__.dsp = {
    rulesFrom: rulesFrom, settingsFrom: settingsFrom, leaksOf: leaksOf, typesSummary: typesSummary, wayOf: wayOf, parseTerms: parseTerms, formatTerms: formatTerms,
    termReplacer: termReplacer, termsYaml: termsYaml, parseTermsYaml: parseTermsYaml, yamlPlurals: yamlPlurals, defaultTerms: defaultTerms,
    terms: function () { return _termsOpen; },
    namesReplacer: namesReplacer, Namer: Namer, blurGeometry: blurGeometry, cardColor: cardColor, randomWords: randomWords, randomNumber: randomNumber, randomFact: randomFact, inventFor: inventFor, isInvented: isInvented, treat: treat, images: IMAGES,
    writtenKey: writtenKey,
    // For the suites: a plan's limits, made small enough to reach with a small library.
    limits: function (o) { if (o.lean) LEAN_ABOVE = o.lean; if (o.undo) UNDO_KEEP = o.undo; if (o.jobPoll) JOB_POLL_MS = o.jobPoll; if (o.review) REVIEW_MAX = o.review; },
    bytes: { sniff: sniff, markOf: markOf, withMark: withMark, svgSize: svgSize, dimsOf: dimsOf, capOf: capOf },
    time: { num: num, duration: duration, aboutLeft: aboutLeft },
    open: startRun,
    dialog: function () { return _active; },
  };
}());
