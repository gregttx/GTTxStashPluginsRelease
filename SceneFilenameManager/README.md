# ᝯㄝₓ Scene Filename Manager

Requires Stash 0.31.0 or newer and [ᝯㄝₓ Core](../GTTxCore/README.md), installed and enabled alongside
it. A source index (Stash's Settings → Plugins → Available Plugins) installs Core for you; a hand
copy must copy the `GTTxCore` folder too.

A file's name is metadata nothing else in Stash remembers. Rename a file — by hand, with a renamer,
with a tidy-up script — and the name it had is gone. This plugin keeps a copy of every scene's
filenames in a custom field before that happens, can put them back, and can rename files from the
scene's own metadata.

## Usage

Three tasks, in **Settings → Tasks**, each opening a dialog that lists every scene or file it would
touch before anything is written.

### Archive Original Filenames...

Writes the names of each scene's files, **without their extensions**, into the custom field
(`ᱜ╦╦🞮_Original_Filename` by default), wherever a file's name is not there yet.

```
[PLAN] Cool Shoot [412]: "cool.shoot.2024.1080p"
[PLAN] Two Angles [414]: "cam-a", "cam-b"
[PLAN] Scene 413 [413]: "IMG_0413_b" (added to the archive)
```

A scene with one file stores its name as it is. A scene with more than one stores every file's name
by file id, as JSON: `{"88":"cam-a","89":"cam-b"}`. A file added to a scene that is already
archived is added to its value.

A name already archived is **never overwritten**: the field keeps the first name the plugin saw.
To archive a scene again under its current names, delete the field on that scene (in Stash's own
custom fields panel) and run the task again.

A scene with no file is counted in the dialog's counters and skipped.

### Restore Original Filenames...

Renames every file the field names back to its archived name wherever the two differ, keeping the
file's **current extension** and its folder.

```
[PLAN] Cool Shoot [412]: "Cool Shoot (2024).mp4" → "cool.shoot.2024.1080p.mp4"
```

A value in the field that cannot be a filename — empty, containing `/` or `\`, or `.`/`..` — is
reported as skipped rather than renamed. A name already taken in the folder fails for that file
alone, and the log says so.

### Rename Files From Metadata...

Renames the primary file of every scene to the name the **Rename Template** builds from its
metadata, keeping the extension and folder, wherever the two differ. With an index in the template,
**every file** of a scene is renamed.

```
[PLAN] Song - Promo 2 [20]: "old.mp4" → "Song (2021) - Promo 2 [Bea, Ada, Cleo, +2] by Kim.mp4" (archived first)
```

The template is plain text with `{prefix|token|postfix}` groups. A group is written only where its
token has a value — prefix and postfix included — so `{ (|year|)}` adds ` (2021)` to a dated scene
and nothing to an undated one. `{token}` alone has no prefix or postfix; text outside braces is
always written. A token is read in any case: `|Title|` is `title`.

`{prefix|!token|postfix}` is the opposite: written only where the token has **no** value, and it
writes no value of its own. A prefix or postfix can hold groups of its own, written only when the
group around them is. So `{|basetitle|{ (|year|)}}` adds the year only to a scene that has a base
title, and

```
{|basetitle|}{|!basetitle|{|studio|{ - |code|}}}
```

names a scene without a title after its studio and code — `Acme - X7`, or `Acme` without a code.
A `{`, `}` or `|` the template cannot pair up stops the scan, with the character it is at. The
default:

```
{[|studio|] }{|basetitle|}{|!basetitle|{|origfilename|}}{ (|year|)}{ |variantpostfix|}{ [|performers|]}{ by |director|}{ |autoindex2|}
```

gives `[BBC 4 Fun] Cleo Does Vegas with her Friends - Scene #3 (2021) - Promo 2 [Ada, Bea, Cleo, +1] by Keen Key`,
falls back to the file's archived name for a scene with no title, the same on every run, and renames every file of a scene, since it
has an index.

| Token | Value |
|---|---|
| `title` | the scene's title |
| `basetitle` | the variant set's base title, from [ᝯㄝₓ Scene Variants](../SceneVariants/README.md); else the title |
| `variantpostfix` | a partial-duration scene's postfix and index (` - Promo 2`), from Scene Variants; else nothing |
| `year`, `date` | from the scene's date |
| `studio`, `code`, `director` | as on the scene |
| `performers` | the **Max Performers In Filename** with the most scenes, then `+N` for the rest; nothing at all when that setting is 0 |
| `performercount` | how many performers the scene has, whatever the filename names |
| `rating5` … `rating100` | the rating on that scale, rounded up: `rating5` gives 4 for 70/100, and `rating` alone is `rating5` |
| `ocount` | the O-count, when it is not 0 |
| `organized` | present when the scene is organized |
| `tag=<name>` | present when the scene has the tag named by its name or an alias, or any tag under it: `{ [LowQuality]\|tag=LowQ\|}` |
| `stashid` | the scene's stash-id as `stashdb.org:<id>`, else its Variant Stash ID, from Scene Variants |
| `filename` | the file's name now, without its extension |
| `origfilename` | the file's archived name, else its name now |
| `fileresolution` | `1920x1080` |
| `filereslabel` | the resolution as Stash shows it: `144p-` (below 144p), `144p` … `8K`, `Huge`, `Huge+` (10000 and over) |
| `fileduration` | `01h02m03s` |
| `autoindex2` | an index, given only when the name is taken — see below. `autoindex` alone starts at 2, `autoindex1` at 1 |

A **present** token (`organized`, `tag=`) has no text of its own: in a group it writes the prefix and
postfix alone, and bare — `{organized}` — it writes `1`. A template that still names `base` or
`postfix` is saved with `basetitle` and `variantpostfix` the first time the plugin loads.

`filename` is the name the file has **now**, so a template that writes it grows the name on every
run; `origfilename` is the archived one, and gives the same name each time.

An unknown token, a rating scale outside 5–100, or a tag no tag or alias is named stops the scan and
is named. `/` and `\` are dropped; the other characters a filename cannot hold become look-alikes it
can — `:` becomes `∶`, `?` `？`, `*` `∗`, `"` `＂`, `<` `‹`, `>` `›`, `|` `∣`. Spaces are collapsed, a
trailing dot or space trimmed, and the name capped at the **Maximum Filename Length**, and its full
path at the **Maximum Full Path Length** when one is set. A scene whose template gives an
empty name is skipped.

**Names already taken.** A name another file in the same folder has now, or that an earlier file in
the plan was given — compared ignoring case — is not given twice. Without an index the later file is
skipped with a warning. With one, `{ (|autoindex|)}` gives it the lowest free index — `Song (2)`,
`Song (3)` — and a file already named that way keeps its name, so a second run changes nothing. A
name cut to fit either limit is cut before the index, never through it, and ends in `…`. What
follows the index is kept as it is, bar the trailing dots and spaces every name loses.

A file whose name is not archived yet has it **archived first**, in the same Proceed, so Restore
Original Filenames can always put it back; a file whose archive fails is not renamed. Undo renames
the files back and leaves the archived names, which are still true.

### Editing the template

**Edit** on the Rename Template setting opens an editor instead of Stash's one-line box:

- the template **coloured** as it is read — a token green, a `!token` blue, anything that is not a
  token (or a tag no tag has) red; paired braces teal, a brace without its pair orange. When the
  template cannot be read, the error is shown and the character it stopped at is marked;
- every token as a button, with what it gives on hover, put in at the cursor;
- a **test value** for each token the template names, each with a **Missing** box. The token's
  name is green where it has a value in the test and red where it has none. The values you type
  are kept per token in this browser and offered again, as many as **Recent values kept** says
  (8 at first; 0 keeps none and throws away the ones kept);
- the **test output**, with a warning for each character dropped or turned into a look-alike, for a
  name cut to the Maximum Filename Length - which says what it would have been - and for an empty one. The editor does not know a
  file's folder, so the path limit is not in its test output.

**Save** writes the setting, and is off while the template has an error. **Default Template**
puts the default template in the box, and **Default Test Values** puts the sample value back in
every test box, leaving the template alone.

### When a file moves to another scene

Stash moves a file to another scene with **Reassign** on a scene's File Info tab, or with
**Merge**, which deletes the scenes merged away together with their custom fields. Either way, the
file's archived name would stay behind. So when you reassign or merge in this browser, the plugin
reads the scenes the files leave before Stash moves them, and if a moved file had an archived name,
opens a dialog offering to add it to the field of the scene it went to:

```
[PLAN] Dest [50]: "a51", "b52", "c53" (added to the archive)
```

A file with no archived name moves without a dialog. If Merge copied a source's value into a
scene that had none, the value is rebuilt by file id rather than kept as it came. Undo puts the
field back as the move left it. A locked field that already holds a value is not changed.

### Proceed, Stop, Undo

Nothing is written until you press **Proceed**. **Stop** ends a write after the scene in flight.
**Undo** reverses what this dialog wrote — the fields put back as they were, the files renamed back —
for as long as the dialog stays open. **Copy log** puts the counters and every line on the clipboard.
**Close** turns green once there is nothing left to write.

Backing up your database before proceeding is recommended.

**Locked field.** If the field is listed in ᝯㄝₓ Custom Fields Bulk Editor's **Locked Custom Fields**
— which is a good way to protect the archive — Archive still writes it where it is missing, but
never adds a file to a value already there, and **Undo** of an Archive is refused, since it would
remove a locked field. A file Rename cannot archive for that reason is not renamed.

## Settings

| Setting | Default | What it does |
|---|---|---|
| **Original Filename Custom Field** | `ᱜ╦╦🞮_Original_Filename` | The custom field the tasks archive into and restore from: a file's name, or every file's by id. Written into the box the first time the plugin loads; clearing the box goes back to the default. Renaming it does not move what is already written. |
| **Rename Template** | `{[\|studio\|] }{\|basetitle\|}{\|!basetitle\|{\|origfilename\|}}{ (\|year\|)}{ \|variantpostfix\|}{ [\|performers\|]}{ by \|director\|}{ \|autoindex2\|}` | The name Rename Files From Metadata builds, before the extension. Seeded like the field; clearing it goes back to the default. **Edit** opens the template editor. |
| **Max Performers In Filename** | 3 | How many performers the `performers` token names — the ones with the most scenes, ties by name. The rest are counted as `+N`. **0 names none**, so the token writes nothing; `performercount` gives the number on its own. |
| **List Performers Alphabetically** | off | Off: the kept performers by scene count, most first. On: the same performers alphabetically. |
| **Maximum Filename Length** | 200 | The longest name Rename gives, extension included, in UTF-8 bytes (an accented letter is 2, an emoji 4), from 60 to 255. Most filesystems allow 255; an encrypted Synology shared folder or any eCryptfs folder about 143, so use 140 there. |
| **Maximum Full Path Length** | none | The longest full path - folder, separator and name - in characters as Windows counts them. A name that would pass it is cut further; a folder whose own path leaves no room is skipped with a warning. Use 259 when the files are opened from Windows without long paths turned on. |

## Relationship to the other plugins in this repo

With [ᝯㄝₓ Custom Fields Bulk Editor](../CustomFieldsBulkEditor/README.md) installed, the field is
given a description in its description store, shown wherever that plugin shows the field. A
description already filed under the name is left alone.

With [ᝯㄝₓ Scene Variants](../SceneVariants/README.md) installed, the `basetitle` and
`variantpostfix` tokens come from its naming rule, asked once per run over the whole library, and
`stashid` from its reading of a scene's stash-ids and variant field. Without it, `basetitle` is the
title, `variantpostfix` and `stashid` are empty, and the log says so.

Every task takes the shared bulk-edit lease while they write, so a sibling that reacts to saves
stands down for them; a reassign or merge made during another plugin's bulk edit raises no dialog.

## Notes and limitations

- **Rename renames only the primary file** (a scene's first) unless the template has an index.
- A name another file has now counts as taken even when that file is being renamed away in the same
  run, so a reshuffle takes an index and settles on the next run.
- The field holds the name as it was when it was archived; the extension is not kept, because a
  transcode or remux changes it and Restore should not undo that.

## What a run costs in memory

<!-- memory:start -->
Against a library of 100,000 scenes and 1,000,000 images, with each task set to cover everything it can — the worst case, not a typical run:

| Task | While it reads and plans | While it writes | Held for Undo |
|---|--:|--:|--:|
| Archive Original Filenames | 58 MB | 79 MB | 78 MB |
| Restore Original Filenames | 49 MB | 69 MB | 69 MB |
| Rename Files From Metadata | 154 MB | 185 MB | 183 MB |

All of it is given back when the dialog is closed. The figures come from [MEMORY.md](../MEMORY.md), measured again for every release.
<!-- memory:end -->

A dialog shows its last 1,000 log lines and keeps the rest so **Copy log** can hand over the
whole run. Past ᝯㄝₓ Core's **Log Lines Kept** (200,000 by default) the oldest lines are dropped
and the copy says how many went; nothing else changes — the plan, the counters, what is written
and what Undo takes back are all whole.

## Troubleshooting

### Checking which version is actually running

The browser console prints `[sfm] SceneFilenameManager.js <version> loaded.` at load. That is the
running script's own version; the settings page reads the manifest, which can be newer than the
script your browser has cached. A red banner in the plugin's settings group says when the two
disagree, with a **Reload UI** button.

## Installing

Copy the `SceneFilenameManager/` folder and `GTTxCore/` into your Stash `plugins/` directory, press
**Reload plugins** in Settings → Plugins, and reload the page.

## Licence

See [LICENSE](../LICENSE).
