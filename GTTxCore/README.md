# ᝯㄝₓ Core

The shared half of the ᝯㄝₓ plugins, and the home for the things that belong to none of them.

**Install this alongside any other ᝯㄝₓ plugin.** Each one declares it as a dependency, so Stash
installs it with them and loads it before them. On its own it changes nothing about your library
and adds no task to Settings → Tasks.

Requires Stash 0.31.0 or newer.

---

## What it is

The one copy of everything the ᝯㄝₓ plugins have in common: the card that opens on an entity's
name, the tooltip on a tag or a setting, the mark beside a setting that names a custom field, the
red **Reload UI** button, the rules that decide where a plugin's button lands in one of Stash's own
rows and in what order when two plugins want the same row, and the bulk-edit lease they use to keep
out of each other's way while one of them is rewriting your library.

## Installing

Copy the `GTTxCore` folder into your Stash config directory's `plugins/` folder, like any plugin,
then **Settings → Plugins → Reload plugins** and reload the page.

Installing another ᝯㄝₓ plugin through a **source index** (Stash's Settings → Plugins → Available
Plugins) installs this one as its dependency automatically. A hand copy must copy the `GTTxCore`
folder too.

It must also be **enabled**. Stash silently skips a plugin whose dependency is missing, and treats a
disabled dependency the same as an absent one - so disabling this plugin disables every other ᝯㄝₓ
plugin you have, with no warning from Stash. See [Troubleshooting](#troubleshooting).

## What you actually see

Four things, and all of them are off until you turn them on.

### The Scene Tagger's duration mismatch

Stash's tagger prints **“Duration off by at least Ns”** among the other fields on a search result,
in the same weight and colour as everything beside it — and it is the one line on that card that
decides whether a match is the right file.

Turn on **Emphasise a Tagger Duration Mismatch** and that sentence is drawn:

| Gap | How it looks |
|---|---|
| more than 5 seconds | larger, capitalised, **red** |
| more than 1 second | **amber** |
| 1 second or less | left exactly as Stash wrote it |

It changes only how the sentence looks. Nothing is hidden, reordered, acted on or written, and
turning it off puts every sentence back the way Stash wrote it.

It is off by default because it restyles a page this plugin does not own.

### Right-click Paste in the Tags, Performers and Groups boxes

Right-click inside **Title** and the browser offers **Paste**. Right-click inside **Tags**,
**Performers** or **Groups** and it does not, though Ctrl+V works from the same box
([stashapp/stash#7139](https://github.com/stashapp/stash/issues/7139)).

Ctrl+V working is the clue. There is a real text input in those boxes, but it is sized to what
has been typed — with nothing typed it is about two pixels wide, so a right-click "in the field"
lands on the box around it, and a browser offers Paste over an input and not over a box.

Turn on **Right-Click Paste in Tags and Performers Boxes** and the input is widened to fill the
rest of the row. The pointer is then over an input, the browser offers its own Paste, and the
paste takes the exact path Ctrl+V already takes.

No clipboard permission is asked for and no menu of ours is drawn — this is one CSS rule. The
tags already in the box keep their own space and their remove buttons, because the input only
takes the empty tail of the row.

It is off by default because it restyles a page this plugin does not own. When a Stash release
fixes #7139 it should become a no-op, so it changes nothing you can see: harmless to leave on,
and fine to turn off.

### Where every link opens

The ᝯㄝₓ dialogs, listings and cards name entities as links — a scene, a tag, a performer, the
plugin's own README. Every one of them opens a **new tab**, which is what keeps the dialog you are
reading open behind it.

Turn on **Open Links in the Same Tab** and they all open in the tab you are already in, the way
Stash's own links do. It reaches every ᝯㄝₓ plugin at once — this is the one place the answer is
kept — and takes effect on the next link drawn rather than on the next page load.

It is off by default, which is a new tab.

### Dev Mods

Three switches for working on these plugins rather than for using them. Press **Dev Mods…** in the
settings to open them; all three are off by default, none of them writes anything, and none is
meant to be left on.

| Switch | What it does |
|---|---|
| **Debug mode** | The [debug switch](#the-debug-switch): every control a ᝯㄝₓ plugin draws into Stash's own rows explains on the console whether it is shown or hidden and why. |
| **Layout edit mode** | Outlines every control these plugins have injected into Stash's chrome and labels it with the plugin that put it there — for working out who owns a button in a row that holds several. |
| **Stale UI demo** | Makes the red **Reload UI** button appear beside Stash's own **Reload plugins** without waiting for a real version mismatch. |

They set flags on the object the ᝯㄝₓ plugins share, so each one reaches all of them at once. The
console still works and uses the same flags:

```js
__GTTx__.StashPluginCoop.debugButtons = true;   // Debug mode
__GTTx__.StashPluginCoop.layoutEdit   = true;   // Layout edit mode
```

## Links, cards and tooltips

Every link a ᝯㄝₓ plugin draws opens where the [Core setting](#where-every-link-opens) says: a new
tab by default, or the tab you are in.

An **entity name** - a scene, performer, studio, tag, gallery, image or group named in a dialog, a
listing or a log - hovers to a **card**: its picture, with the rating as an amber banner and a 📦
mark where the entity is Organized. A **tag** or a **setting** hovers to a **tooltip**: the tag's
description, or the setting's own help text. Both are fetched on the first hover and kept for the
page.

A setting that names a **custom field** carries a grey **ⓘ** mark at the end of its value. Hover
it and the tooltip names the field, its description if it has one, and what in the library carries
it - a count and the first few entities by name and id. The tooltip opens *above* the mark rather
than under the pointer, so the pointer does not cover its first line.

## The bulk-edit lease

A **lease** is the note a ᝯㄝₓ plugin leaves for its siblings while it is rewriting your library in
bulk: who is writing, what, and until when.

- A plugin that **bulk-writes** takes one for every run, its Undo included, renews it as the run
  goes, and releases it when the run ends.
- A plugin that **reacts to saves** - one that merges or adds something the moment you press Save
  on a scene or a performer - checks for a foreign lease before it lets the write through, and
  stands down while one is held, so the two are not editing the same entity at once.

It is **advisory**. A foreign lease makes a manual action warn you in its dialog; it never blocks
one. Only the automatic, react-to-save modes stand down.

## The debug switch

```js
__GTTx__.StashPluginCoop.debugButtons = true;
```

Every control a ᝯㄝₓ plugin draws into Stash's own chrome then explains itself on the
`[<prefix>] gate` console channel: shown or hidden, and why. It takes effect on the next tick, so
no reload is needed, and **Debug mode** under [Dev Mods](#dev-mods) sets the same flag (`debugMode`
is read as well). It is not the plugins' user-facing logging.

## The stale-script banner and the Reload UI button

Stash pins its plugin scripts when the app boots. **Settings → Plugins → Reload plugins** re-reads
the manifests on the server but does not re-run the scripts, so after an install or an upgrade the
version Stash *reports* and the version your tab is *running* can disagree. When they do, the plugin
draws a red banner on its settings group saying so, and one red **Reload UI** button beside Stash's
own **Reload plugins**, shared by every ᝯㄝₓ plugin that is stale. A dialog opened from a stale
plugin carries the same button under its own banner.

A page reload (F5) is the only fix, and **Reload UI** does exactly that. The version in the settings
heading comes from the manifest, so it does not prove the script reloaded; the banner going away
does.

## Troubleshooting

- **A plugin prints `ᝯㄝₓ Core is not installed or is disabled. Install it from the same source as
  this plugin and reload the page.`** in the browser console and does nothing else. It stops rather
  than limping because there is no half of it left to limp with - the dialogs, the tooltips and the
  buttons all live here. Install this plugin, or enable it, and reload the page. Stash does not warn
  about either case: a missing dependency is skipped silently, and a disabled one is the same as an
  absent one.
- **A red banner on a plugin's settings group or dialog, and a red Reload UI button.** The script
  your tab is running is not the one on disk. Press the button, or reload the page - see
  [above](#the-stale-script-banner-and-the-reload-ui-button).

## Nothing here touches your library

No task, no mutation, no write of any kind — the only thing this plugin stores is its own
settings. Every other ᝯㄝₓ plugin still asks before it writes, exactly as it did.

## Licence

Same terms as the rest of this repository.
