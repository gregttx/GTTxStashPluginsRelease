# ᝯㄝₓ Core

The shared half of the ᝯㄝₓ plugins, and the home for the things that belong to none of them.

**Install this alongside any other ᝯㄝₓ plugin.** Each one declares it as a dependency, so Stash
installs it with them and loads it before them. It adds one task, **Undo History...**, and writes to
your library only when you undo something there.

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

Six things: five are off until you turn them on, and one is a number with a default — and
[Undo History](#undo-history), which is on.

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

### The counts on the Tags, Performers and Custom Fields headings

The word **Tags** above a tag list says nothing about how long the list is, and on a scene
carrying forty the number is what you want before reading them.

Turn on **Show Counts on Headings** and the heading reads **Tags (12)** — Stash's own word, with
the count in brackets after it — on the details view and the edit form of every scene, image,
gallery, performer, studio, group and tag. **Performers (3)** and **Custom Fields (5)** read the
same way wherever an entity has them, and on a tag's own page so do **Parent Tags** and
**Sub-Tags**. On a details page with the colon style, it reads **Tags (12):**.

The count is what the page shows: the tags, performer cards or fields listed under the heading,
or the chips and rows in the form you are editing, so on the edit form it follows every one you
add or remove before you save. The empty row for the next custom field is not counted. Nothing is
read from your library for it, and nothing but the heading's text changes.

It is off by default because it changes a page this plugin does not own. Turn it off and every
heading goes back to Stash's own word on the next tick.

### How many log lines a dialog keeps

Every ᝯㄝₓ dialog shows the last 1,000 lines of its log — a node per line is a page that stops
responding — and keeps the rest so **Copy log** can hand over the whole run. That buffer is what a
library-wide run grows: ᝯㄝₓ Normalize Parent Tags over 100,000 scenes and 1,000,000 images writes
9.8 million lines, several gigabytes of them, beside a plan that is already the largest thing in
the page.

**Maximum Log Lines Kept** is how many are kept, 200,000 by default and anywhere from 1,000 to
5,000,000; a number outside that is clamped. The box is filled with the default the first time the
Plugins tab of the settings page is opened, so it shows the number in force.
Past it the oldest lines are dropped and the copy opens by saying how many went. Nothing else is
affected: the listing, the counters, what is written and what Undo can take back are all whole.

About 200 bytes a line, so 200,000 lines is roughly 40 MB. Raise it if you copy the logs of very
large runs; lower it on a machine short of memory. A run of a few thousand lines never reaches it.

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
it - a count and the first few entities by name and id, a scene, image or gallery with no title by
its file. The tooltip opens *above* the mark rather
than under the pointer, so the pointer does not cover its first line. A setting that names
**several** fields - Custom Fields Bulk Editor's Locked Custom Fields - shows each name with a mark
of its own behind it.

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

## Undo History

What the ᝯㄝₓ plugins write, and what you save in Stash's own pages in this browser, is kept in this
browser so it can be undone later — after the dialog that wrote it has closed, days later if need be.
Open it from **Settings → Tasks → Undo History...**, or from the **↶** button in Stash's top bar,
beside Settings.

- **The list** shows the history newest first, a run a row: when, who — *Your edit*, a plugin, or an
  *Undo* — what, and how many changes. Click a row for its changes: the entity, with its hover card,
  the field, and the value before and after; a custom field is named in teal, with the box its
  name opens elsewhere. Tags, performers, studios, groups and the other related
  entities are named with their id — `+Blonde (105)` — each a link with its hover card, and so is
  the tag a merge went into: `merged into Tag "Blonde" [105]`. The list
  says what the change did; the review and the undo's result say what the undo does, so the same
  change reads `−Blonde (105)` there. Filter by text, type, who, and a range of days.
- **Undo Selected...** — tick runs or single changes, then press it. Every ticked change is checked
  against what your library holds now, and the list says which can be undone and which are skipped,
  before anything is written. **Proceed** writes it. **back to here**, at the end of a run's row,
  ticks that run and every newer one, to take the library back to before it.
- **Take it out of the history**, ticked in the review before Proceed, makes the undo a *pop*: what
  it undoes leaves the history instead of an undo run joining it, so the history reads as it did
  before those changes. It cannot then be redone from here. A change and the undo of it, both
  ticked, cancel out: nothing is written, and a pop takes both out.
- **Delete Selected...** takes the ticked runs and changes out of the history — test runs, say —
  without touching your library. It asks twice.
- **A change is undone only while its field still holds what was written.** Anything else — a later
  edit by hand, in another browser, by a Stash task — makes it *changed since*, and it is skipped
  rather than overwritten. A later edit to a *different* field of the same entity does not stop it.
  A custom field locked in ᝯㄝₓ Custom Fields Bulk Editor is never changed or removed by an undo; one
  an edit removed can be put back.
- **An undo is recorded too**, so undoing it is redo.
- **Undoing a create deletes what was created** — never its files.
- **Export** saves the whole history to a file; **Import...** brings files back, here or in another
  browser, without doubling what is already there. **Back Up and Export** takes a backup of the
  Stash database, as Settings → Tasks does, and saves the history with it, says which folder the
  backup went to, then offers **Drop What the Backup Holds...**: the runs recorded before the backup
  leave this browser, kept in the file just saved. It and **Clear History...** ask twice. With
  nothing recorded, only Import... can be pressed.

What is recorded and what is not:

| Recorded | Not recorded |
|---|---|
| every write a ᝯㄝₓ plugin makes, as it lands | edits made in another browser or on another device |
| edits you save in Stash's own pages in this browser — edit forms and bulk edits of scenes, images, galleries, performers, studios, groups and tags, and creating one | Stash's own tasks: Scan, Identify, Auto Tag, Clean |
| deleting a tag, performer, studio, group or scene, and merging tags — undone by creating it again under a new id and putting it back on what still carries it; older changes naming the old id follow it to the new one | scripts using Stash's API |
| deleting an image or a gallery, or a scene with its files, and merging scenes — recorded, not undone: the review says why | a scene's play history and O-count, markers and pictures, which a delete takes for good |
| | a cover image, a picture or a stash-id in a save — the run says so |

To record an edit of yours, the entity is read just before Stash saves it and again just after, so
a save waits for one small read; a large bulk edit pauses a moment. If that read fails, the save still
goes through and the history shows a gap there.

**Its settings**, in this plugin's group:

| Setting | Default | |
|---|---|---|
| Keep For (Days) | 90 | 1 to 999, or Forever. A run you imported is kept past it |
| Size Limit (MB) | 256 | 16 to 4096. A single run over half of it is not recorded, and its dialog's own Undo still covers it |
| Only Since the Last Backup | off | keeps only what came after the last backup this browser saw; a run you imported is kept |
| Record Edits Made in Stash's Pages | on | deletes and merges have a switch of their own |
| Record Library-Wide Image Writes | off | a pass over a million images would crowd everything else out |
| Protect Its Storage | on | asks the browser not to clear it when the disk is nearly full |
| Record Deletes and Merges | on | keeps what a delete or a tag merge takes away, so it can be put back; a delete of something large reads a lot first |

The history lives in this browser's own storage, per browser and per device, and goes if you clear
this site's data. The dialog says how much it holds, how old the oldest run is, whether the browser
protects it, and warns — offering Back Up and Export — when it nears its size or age limit or the
browser runs short of space.

## Nothing else touches your library

Apart from an undo you proceed with in Undo History, nothing here writes to your library — the
only other thing this plugin stores is its own settings. Every other ᝯㄝₓ plugin still asks before
it writes, exactly as it did.

## Licence

Same terms as the rest of this repository.
