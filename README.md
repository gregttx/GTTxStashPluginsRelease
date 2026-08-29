# ᝯㄝₓ Stash Plugins

Nine client-side plugins for [Stash](https://github.com/stashapp/stash) — eight that each do
something Stash's own UI cannot (bulk-edit a custom field, copy tags along a relationship, rename
one thing and fix every mention of it, find text anywhere in the library), and **ᝯㄝₓ Core**, which
all eight require.

They are written to be installed **together**. They share one namespace, one visual language and a
handful of cooperation protocols, so two of their buttons in the same row agree on order and
spacing, a bulk run tells its siblings to stand down while it writes, and one plugin asks another
for an answer rather than reimplementing it.

Requires **Stash 0.31.0 or newer**.

---

## The plugins

| Plugin | What it does |
|---|---|
| [ᝯㄝₓ Core](GTTxCore/README.md) | **Required by all of the others.** The shared half: the hover cards, the tooltips, the Reload UI button, the button-placement rules. Plus the two features that belong to no single plugin — emphasising the Scene Tagger's duration mismatch, and the developer switches. |
| [ᝯㄝₓ Custom Fields Bulk Editor](CustomFieldsBulkEditor/README.md) | Set, rename or clear a custom field across a whole selection — the seven entity types that carry them. Stash's API supports this; its UI does not expose it. |
| [ᝯㄝₓ Entity Name Maintainer](EntityNameMaintainer/README.md) | Rename a performer, studio, tag or scene, and it finds every *other* place in the library that mentioned the old name and offers to bring them along. |
| [ᝯㄝₓ Find & Replace Entities by Text Content](FindEntitiesByTextContent/README.md) | One box: which entities mention this text? Searches every text field of every type, then optionally replaces it. |
| [ᝯㄝₓ Merge Performer Tags To Scenes](MergePerformerTagsToScenes/README.md) | Copy a performer's tags onto every scene they appear in — one performer, one scene, or the whole library. |
| [ᝯㄝₓ Normalize Parent Tags](NormalizeParentTags/README.md) | Two operations over the tag hierarchy: **Prune** removes a tag an entity's more specific tag already implies, **Roll Up** adds the ancestors it does not carry. |
| [ᝯㄝₓ Propagate Tags and Performers to Related Entities](PropagateTagsAndPerformers/README.md) | Thirteen relationship paths — studio→scene, performer→gallery, gallery→image and the rest — each copying tags or performers along one of Stash's own links. |
| [ᝯㄝₓ Scene Variants](SceneVariants/README.md) | A scene is often in your library twice, whole and cut. This derives the relation from what the scenes already carry rather than storing it. |
| [ᝯㄝₓ Tag Bundle Clipboard](TagBundleClipboard/README.md) | Copy a set of tags off one entity and paste it onto another, however unrelated the two are. |

## Installing

There is **no build step**. A plugin folder is copied as-is:

1. Copy **`GTTxCore/`** and the folder you want — say `NormalizeParentTags/` — into your Stash
   config directory's `plugins/` folder (`~/.stash/plugins/` on a default install). Every plugin
   here requires `GTTxCore`; installing through a source index brings it in automatically, but a
   hand-copied folder does not.
2. In Stash, go to **Settings → Plugins** and press **Reload plugins**.
3. Reload the browser page. Stash pins its plugin scripts at app boot, so a reload of the *plugins*
   is not a reload of the *script your tab is running* — the plugins say so themselves with a red
   banner and a **Reload UI** button when the two disagree.

Repeat per plugin. Beyond `GTTxCore`, nothing here depends on anything else being installed, and
every cross-plugin feature degrades quietly when its sibling is absent or older. **A plugin that
cannot find `GTTxCore` stops at load and says so once in the browser console** — Stash orders
plugin scripts by their declared dependencies but does not object when one is missing or disabled.

## Conventions worth knowing before you press anything

- **No write happens without a plan in front of you.** Every deliberate write opens a dialog listing
  every change first, with **Proceed**, **Stop**, **Copy log** and **Undo**. The automatic modes are
  the exception and say so in their own settings.
- **A caption ending in `...` asks before it acts.** One without it either writes nothing or stages
  something into the form in front of you, where Stash's own Save is the next step.
- **Amber means a control of ours writes; teal means it only reads.** Stash's own buttons are grey
  and blue, so the colour is also how you tell one of these plugins' controls from Stash's.
- **An id in brackets is Stash's own database id** — the number in the URL — never a stash-box
  Stash ID.
- **Back up your database before the first library-wide run.** Undo reaches only what the open
  dialog wrote, and Stash has no undo of its own.

## Repository layout

| | |
|---|---|
| `<PluginName>/` | one folder per plugin: `.yml` manifest, `.js`, `manifest`, `README.md`, `CLAUDE.md`, `RELEASES.md` |
| `GTTxCore/` | the shared half every other plugin binds at load, and requires |
| `tests/` | `node tests/run.js` (or `npm test`). See [tests/README.md](tests/README.md) |
| `tools/` | repo tooling — release-row generation and two live-Stash probes. See [tools/README.md](tools/README.md) |
| `RELEASES.md` | every release of every plugin, one row per commit. **Generated** |
| `CLAUDE.md` | the conventions above, argued rather than listed — the onboarding document |

## Contributing

- **`node tests/run.js`** runs all suites. Most need no install; the `placement` suite needs
  `jsdom` and skips itself without it, so `npm install` enables it. `package.json` exists only for
  that and is part of no plugin.
- **A new plugin starts at `version: 0.0.1`.** The major digit says the thing has been run in a real
  Stash, not that the code is finished.
- **Bump the version in three places in one edit**: the `.yml`, the `manifest` (including its
  `date:`, read off the clock), and `PLUGIN_VERSION` in the `.js`.
- **`RELEASES.md` is generated, never written.** A release *is* a commit that moved a `version:`, so
  run `node tools/gen-releases.js` in the commit *after* the one that shipped it — a release row
  cannot name the commit that adds it.
- **READMEs and source describe the plugin, not its history.** No "since 1.2.0" in either; that
  argument belongs in the plugin's own `CLAUDE.md`, which does not ship.
- **Read [CLAUDE.md](CLAUDE.md) before adding a button, a dialog or a shared block.** Nearly every
  rule in it exists because something here guessed about Stash's markup and was wrong.
- **Releasing to the public mirror goes through `node tools/release-drop.js`**, which
  copies an allowlist - never a denylist - and scans every staged file before it writes
  anything. See [`tools/README.md`](tools/README.md).
- **The repo enforces some of this after every turn**, through the Stop hooks in
  the repo's own Stop hooks: a plugin's docs left behind by a change to its
  source, a script changed without its version moving, a release missing from `RELEASES.md`, a new
  plugin starting above `0.0.1`. They are tracked; the `settings.local.json` that calls them is not,
  so a fresh clone has to wire them once.

## Licence

[MIT](LICENSE).
