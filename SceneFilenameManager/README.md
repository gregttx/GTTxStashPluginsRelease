# ᝯㄝₓ Scene Filename Manager

Requires Stash 0.31.0 or newer and [ᝯㄝₓ Core](../GTTxCore/README.md), installed and enabled alongside
it. A source index (Stash's Settings → Plugins → Available Plugins) installs Core for you; a hand
copy must copy the `GTTxCore` folder too.

A file's name is metadata nothing else in Stash remembers. Rename a file — by hand, with a renamer,
with a tidy-up script — and the name it had is gone. This plugin keeps a copy of every scene's
filename in a custom field before that happens, and can put it back.

## Usage

Two tasks, in **Settings → Tasks**, each opening a dialog that lists every scene it would touch
before anything is written.

### Archive Original Filenames...

Writes the name of each scene's primary file, **without its extension**, into the custom field
(`ᱜ╦╦🞮_Original_Filename` by default) on every scene that does not carry that field yet.

```
[PLAN] Cool Shoot [412]: "cool.shoot.2024.1080p"
[PLAN] Scene 413 [413]: "IMG_0413"
```

A scene that already carries the field is **never overwritten** and never listed: the field keeps
the first name the plugin saw. To archive a scene again under its current name, delete the field on
that scene (in Stash's own custom fields panel) and run the task again.

A scene with no file is counted in the dialog's counters and skipped.

### Restore Original Filenames...

Renames the primary file of every scene back to the archived name wherever the two differ, keeping
the file's **current extension** and its folder.

```
[PLAN] Cool Shoot [412]: "Cool Shoot (2024).mp4" → "cool.shoot.2024.1080p.mp4"
```

A value in the field that cannot be a filename — empty, containing `/` or `\`, or `.`/`..` — is
reported as skipped rather than renamed. A name already taken in the folder fails for that scene
alone, and the log says so.

### Proceed, Stop, Undo

Nothing is written until you press **Proceed**. **Stop** ends a write after the scene in flight.
**Undo** reverses what this dialog wrote — the fields taken back off, the files renamed back — for as
long as the dialog stays open. **Copy log** puts the counters and every line on the clipboard.
**Close** turns green once there is nothing left to write.

Backing up your database before proceeding is recommended.

**Locked field.** If the field is listed in ᝯㄝₓ Custom Fields Bulk Editor's **Locked Custom Fields**
— which is a good way to protect the archive — Archive still writes it where it is missing, but
**Undo** of an Archive is refused, since it would remove a locked field.

## Settings

| Setting | Default | What it does |
|---|---|---|
| **Original Filename Custom Field** | `ᱜ╦╦🞮_Original_Filename` | The custom field both tasks use. Written into the box the first time the plugin loads; clearing the box goes back to the default. Renaming it does not move what is already written. |

## Relationship to the other plugins in this repo

With [ᝯㄝₓ Custom Fields Bulk Editor](../CustomFieldsBulkEditor/README.md) installed, the field is
given a description in its description store, shown wherever that plugin shows the field. A
description already filed under the name is left alone.

Both tasks take the shared bulk-edit lease while they write, so a sibling that reacts to saves
stands down for them.

## Notes and limitations

- **Only the primary file** (a scene's first) is archived and renamed. A scene with several files
  keeps the others as they are.
- The field holds the name as it was when it was archived; the extension is not kept, because a
  transcode or remux changes it and Restore should not undo that.
- Generating a new filename from a scene's metadata is not built yet.

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
