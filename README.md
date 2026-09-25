# ᝯㄝₓ Stash Plugins

Nine client-side plugins for [Stash](https://github.com/stashapp/stash) — eight that each do
something Stash's own UI cannot (bulk-edit a custom field, copy tags along a relationship, rename
one thing and fix every mention of it, find text anywhere in the library), and **ᝯㄝₓ Core**, which
all eight require.

They are written to be installed **together**. They share one namespace, one visual language and a
handful of cooperation protocols, so two of their buttons in the same row agree on order and
spacing, a bulk run takes a lease its siblings stand down for while it writes, and one plugin asks another
for an answer rather than reimplementing it.

Requires **Stash 0.31.0 or newer** (Scene Variants: 0.28.0).

---

## The plugins

| Plugin | What it does |
|---|---|
| [ᝯㄝₓ Core](GTTxCore/README.md) | **Required by all of the others.** The shared half: the hover cards, the tooltips, the Reload UI button, the button-placement rules. Plus the three features that belong to no single plugin — emphasising the Scene Tagger's duration mismatch, a right-click **Paste** in the Tags and Performers boxes, and the developer switches. |
| [ᝯㄝₓ Custom Fields Bulk Editor](CustomFieldsBulkEditor/README.md) | View and bulk edit custom fields across a whole selection, or across the whole library — the seven entity types that carry them. Stash's API supports this; its UI does not expose it. |
| [ᝯㄝₓ Entity Name Maintainer](EntityNameMaintainer/README.md) | Rename a performer, studio, tag or scene, and it finds every *other* place in the library that mentioned the old name and offers to bring them along. |
| [ᝯㄝₓ Find & Replace Entities by Text Content](FindEntitiesByTextContent/README.md) | One box: which entities mention this text? Searches every text field of every type, then optionally replaces it. |
| [ᝯㄝₓ Merge Performer Tags To Scenes](MergePerformerTagsToScenes/README.md) | Add a performer's tags to every scene they appear in — one performer, one scene, or the whole library. |
| [ᝯㄝₓ Normalize Parent Tags](NormalizeParentTags/README.md) | Two operations over the tag hierarchy: **Prune** removes a tag an entity's more specific tag already implies, **Roll Up** adds the ancestors it does not carry. |
| [ᝯㄝₓ Propagate Tags and Performers to Related Entities](PropagateTagsAndPerformers/README.md) | Thirteen relationship paths — studio→scene, performer→gallery, gallery→image and the rest — each carrying tags or performers along one of Stash's own links. |
| [ᝯㄝₓ Scene Filename Manager](SceneFilenameManager/README.md) | Keeps a copy of every scene's filename in a custom field before a rename can lose it, and renames the file back on request. |
| [ᝯㄝₓ Scene Variants](SceneVariants/README.md) | A scene is often in your library twice, whole and cut. This works out which scenes are the same work from the stash-id they share — the identifier a stash-box, a shared metadata database, gives a scene — and puts a Variants tab on the scene page. |
| [ᝯㄝₓ Tag Bundle Clipboard](TagBundleClipboard/README.md) | Copy a set of tags off one entity and paste it onto another, however unrelated the two are. |

The ᝯㄝₓ prefix is the shared mark of this collection, put in front of every plugin name so they
sort together and are found with one search in **Settings → Plugins**.

## What they do together

Every plugin works on its own with ᝯㄝₓ Core. Install two of them and each asks the other the
questions only it can answer, rather than copying its rules. Nothing below needs configuring: a
plugin finds its sibling at load, and says in its log when one it would have asked is absent.

| This plugin | Asks | For what | Without it |
|---|---|---|---|
| Every plugin that writes | **all the others** | a shared **bulk-edit lease** while it writes, so the automatic modes stand down instead of reacting to every entity of a library-wide run | the automatic modes react to another plugin's bulk run, each possibly undoing part of the other |
| **Entity Name Maintainer**, **Find & Replace**, **Scene Filename Manager**, **Scene Variants** | **Custom Fields Bulk Editor** | which custom fields are **locked**: a locked field's name, value and presence are left alone, and no Undo removes one | nothing is locked, and each says so in its log. With that plugin present but unable to answer, no custom field is written at all |
| **Entity Name Maintainer** | **Custom Fields Bulk Editor** | the **field descriptions** it keeps, so a rename can carry into the prose you wrote about a field | descriptions are not listed and nothing else changes |
| **Scene Filename Manager**, **Scene Variants**, **Propagate**, **Find & Replace** | **Custom Fields Bulk Editor** | a **description filed** for the custom field they create, shown wherever that plugin shows a field | the field carries no description |
| **Scene Filename Manager** | **Scene Variants** | the **base title** and **partial postfix** of a variant set for the `basetitle` and `variantpostfix` tokens, and a scene's **stash-id** for `stashid` | `basetitle` is the scene's title, `variantpostfix` and `stashid` are empty, and the log says so |
| **Scene Variants**, **Propagate**, **Tag Bundle Clipboard** | **Normalize Parent Tags** | whether a tag is **redundant** under the hierarchy, so none of them copies a parent a more specific tag already implies | every tag is copied, and the sibling would prune it again afterwards |
| **Scene Variants** | **Entity Name Maintainer** | to **carry a renamed title** into everything that mentioned the old one, for every title it writes | the rename stands on its own |
| **Propagate**, **Merge Performer Tags**, **Scene Variants** | **each other** | a registry of the **relationship paths** each performs, so an overlap is noted in the log | overlapping paths are not pointed out |
| Every plugin that writes | **ᝯㄝₓ Core** | its **Undo History**: each pass and each automatic write is recorded, so it can be undone after the dialog has closed, in this browser | only the dialog's own Undo, while it is open (Core is always installed; a browser with no IndexedDB has no history) |
| **Merge Performer Tags** ↔ **Normalize Parent Tags** | each other | the lease above, in both directions: auto-merge stands down while the other applies, and the library-wide merge takes a lease of its own | each reacts to the other's writes, merging back what was just pruned |

Each plugin's own README has the detail, under **Relationship to the other plugins in this repo**.

## Installing

There is **no build step**. A plugin folder is copied as-is:

1. Copy **`GTTxCore/`** and the folder you want — say `NormalizeParentTags/` — into your Stash
   config directory's `plugins/` folder (`~/.stash/plugins/` on a default install). Every plugin
   here requires `GTTxCore`; installing through a source index brings it in automatically, but a
   hand-copied folder does not.
2. In Stash, go to **Settings → Plugins** and press **Reload plugins**.
3. Reload the browser page. Stash pins its plugin scripts at app boot, so a reload of the *plugins*
   is not a reload of the *script your tab is running* — the plugins say so themselves with a red
   banner and a **Reload UI** button when the two disagree, see
   [the stale-script banner and the Reload UI button](GTTxCore/README.md#the-stale-script-banner-and-the-reload-ui-button).

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
- **An id in brackets is Stash's own database id** — the number in the URL — never a stash-id.
- **Back up your database before the first library-wide run.** Undo reaches only what the open
  dialog wrote, and Stash has no undo of its own.
- **How much memory a task takes** in your browser tab, against 100,000 scenes and 1,000,000
  images, is in [MEMORY.md](MEMORY.md), measured again for every release.

## What a run costs in memory

<!-- memory:start -->
Measured against 100,000 scenes and 1,000,000 images, with every task set to cover the whole library and plan as much as it can — the worst case, not a typical run. In MB of browser memory, from [MEMORY.md](MEMORY.md), which is measured again for every release.

| Plugin | Task | While it reads and plans | While it writes | Held for Undo |
|---|---|--:|--:|--:|
| SceneFilenameManager | Archive Original Filenames | 111 MB | 151 MB | 144 MB |
| SceneFilenameManager | Restore Original Filenames | 52 MB | 74 MB | 74 MB |
| SceneFilenameManager | Rename Files From Metadata | 191 MB | 251 MB | 239 MB |
| SceneVariants | Migrate Variant Stash-IDs | 58 MB | 91 MB | 91 MB |
| SceneVariants | Flag Variants | 46 MB | 86 MB | 81 MB |
| SceneVariants | Review Variant Sets | 1949 MB | — | — |
| SceneVariants | Rename Variants | 635 MB | 646 MB | 646 MB |
| CustomFieldsBulkEditor | Edit Custom Fields Across the Whole Library | 551 MB | 1149 MB | 1148 MB |
| CustomFieldsBulkEditor | Manage Custom Field Descriptions and Locks | 214 MB | 267 MB | 267 MB |
| FindEntitiesByTextContent | Find & Replace Entities by Text Content | 769 MB | 1734 MB | 1524 MB |
| NormalizeParentTags | Normalize Parent Tags | 3818 MB | 4147 MB | 4042 MB |
| NormalizeParentTags | Auto Mode Settings | 0 MB | — | — |
| NormalizeParentTags | Show Tag Hierarchy | 15 MB | — | — |
| MergePerformerTagsToScenes | Merge Performer Tags into All Their Scenes | 271 MB | 293 MB | 282 MB |
| PropagateTagsAndPerformers | Propagate All | 1779 MB | 1821 MB | 1804 MB |

A task gives all of it back when its dialog is closed.
<!-- memory:end -->

## Repository layout

| | |
|---|---|
| `<PluginName>/` | one folder per plugin: `.yml` manifest, `.js`, `manifest`, `README.md`, `AGENTS.md` (the rules), `NOTES.md` (the reasoning), `RELEASES.md` |
| `GTTxCore/` | the shared half every other plugin binds at load, and requires |
| `tests/` | `node tests/run.js` (or `npm test`). See [tests/README.md](tests/README.md) |
| `tools/` | repo tooling — release-row generation, the release drop, the memory watermark and the live-Stash probes. See [tools/README.md](tools/README.md) |
| `RELEASES.md` | every release of every plugin, one row per commit. **Generated** |
| `MEMORY.md` | what every task holds in memory against 100,000 scenes and 1,000,000 images. **Generated** by `node tools/memory-watermark.js`; a release waits for it |
| `AGENTS.md` | the rules, one table per kind — the onboarding document |
| `docs/` | the reasoning behind each rule (`decisions/`), and dated readings of Stash's source (`stash-reference.md`) |

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
  argument belongs in the plugin's own `NOTES.md`, which does not ship.
- **Read [AGENTS.md](AGENTS.md) before adding a button, a dialog or a shared block.** Nearly every
  rule in it exists because something here guessed about Stash's markup and was wrong.
- **Releasing to the public mirror goes through `node tools/release-drop.js`**, which
  copies an allowlist - never a denylist - and scans every staged file before it writes
  anything. See [`tools/README.md`](tools/README.md).
- **The repo enforces some of this after every turn**, through the Stop hooks in
  the repo's own Stop hooks: a plugin's docs left behind by a change to its
  source, a script changed without its version moving, a release missing from `RELEASES.md`, a new
  plugin starting above `0.0.1`. They are tracked; the `settings.local.json` that calls them is not,
  so a fresh clone has to wire them once. A git pre-commit hook in `.githooks/` refuses a commit
  that stages a plugin's script without moving its version, before the commit exists; wire it with
  `git config core.hooksPath .githooks`.

## Licence

[MIT](LICENSE).
