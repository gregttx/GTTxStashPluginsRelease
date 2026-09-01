# ᝯㄝₓ Core

The shared half of the ᝯㄝₓ plugins, and the home for the things that belong to none of them.

**Install this alongside any other ᝯㄝₓ plugin.** Each one declares it as a dependency, so Stash
installs it with them and loads it before them. On its own it changes nothing about your library
and adds no task to Settings → Tasks.

Requires Stash 0.31.0 or newer.

---

## Why it exists

Every ᝯㄝₓ plugin used to carry its own copy of the same few thousand lines: the hover card that
opens on an entity's name — its picture wearing the rating as an amber banner and a 📦 mark where
the entity is organized — the tooltip on a tag, the mark beside a setting that names a custom
field, the red **Reload UI** button, the rules that decide where a plugin's button lands in one of
Stash's own rows and in what order when two plugins want the same row, and the small protocol they
use to keep out of each other's way while one of them is rewriting your library.

Eight copies of one thing is eight places for it to drift, and a test could only ever prove the
copies were *identical* — never that any given plugin could actually run one. (One of them
couldn't: it spelled a helper differently and threw on a branch no test reached, which took its
settings page down with it.) There is one copy now.

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

The ᝯㄝₓ dialogs, listings and hover cards name entities as links — a scene, a tag, a performer,
the plugin's own README. Every one of them opens a **new tab**, which is what keeps the dialog you
are reading open behind it.

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
| **Debug mode** | Turns on the `[<prefix> gate]` console channel in every ᝯㄝₓ plugin that draws a control into Stash's own rows, saying for each one whether it is shown or hidden and why. |
| **Layout edit mode** | Outlines every control these plugins have injected into Stash's chrome and labels it with the plugin that put it there — for working out who owns a button in a row that holds several. |
| **Stale UI demo** | Makes the red **Reload UI** button appear beside Stash's own **Reload plugins** without waiting for a real version mismatch. |

They set flags on the object the ᝯㄝₓ plugins share, so each one reaches all of them at once. The
console still works and uses the same flags:

```js
__GTTx__.StashPluginCoop.debugMode  = true;   // Debug mode
__GTTx__.StashPluginCoop.layoutEdit = true;   // Layout edit mode
```

`debugButtons` is still read and still written, because it is the name people have written down.

## If it is missing

A plugin that cannot find this one **stops**, and says so once in the browser console:

```
[npt] ᝯㄝₓ Core is not installed or is disabled, so this plugin cannot start.
      Install it from the same source and reload the page.
```

It stops rather than limping because there is no half of it left to limp with — the dialogs, the
tooltips and the buttons all live here. Two things Stash will *not* warn you about:

- **A missing dependency is skipped silently.** Stash orders plugin scripts by their declared
  dependencies but does not enforce that they are present.
- **A disabled one is the same as an absent one.** Disabling this plugin disables the visible half
  of every other ᝯㄝₓ plugin you have.

If you install by copying folders by hand rather than through a source index, copy this one too.

## Nothing here touches your library

No task, no mutation, no write of any kind — the only thing this plugin stores is its own
settings. Every other ᝯㄝₓ plugin still asks before it writes, exactly as it did.
