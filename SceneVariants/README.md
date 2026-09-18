# ᝯㄝₓ Scene Variants

Requires Stash 0.28.0 or newer and [ᝯㄝₓ Core](../GTTxCore/README.md), installed and enabled
alongside it. A source index installs Core for you; a hand copy must copy the `GTTxCore` folder too.

A scene is often in your library twice: the whole thing, and a cut out of it. Stash has no way to
say the two are the same work — [the request to link scenes to each other](https://github.com/stashapp/stash/issues/3201)
was closed with "Groups cover scene to scene linking", and a Group is a heavy object to mint for
"these two files are the same scene". So this plugin derives the relation instead of storing it.

The relation is derived from stash-ids. A **stash-box** is an external metadata server Stash
scrapes from (stashdb.org is one); a **stash-id** is a scene's identifier there, and it names the
**work**, not the file — so two scenes carrying the same stash-id are the same work. The stash-ids
a scene carries, plus the lines in the custom field this plugin's migration task writes, are its
**evidence**: sharing any one line with another scene is being the same work. Full-duration versus
partial-duration — the whole work or a cut out of it — is the one **dimension** the plugin knows,
told apart by two tags you name in the settings.

## Usage

### The Variants tab

Open a scene. Beside **Details**, **File Info** and **Edit** there is now a **Variants** tab:

```
Details   Queue   Markers   Filter   File Info   History   Variants   Edit
──────────────────────────────────────────────────────────┴────────────────
2 other variants of this scene. Matched on 1 stash-id.
  ┌────────┐  Cool Shoot
  │ cover  │  Full-duration · 1920×1080 · 41:12
  └────────┘
  ┌────────┐  Cool Shoot - Clip 2
  │ cover  │  Partial-duration · 1920×1080 · 4:03
  └────────┘
```

The tab sits just before **Edit**, which stays last, and is amber — the one tab in the tab strip
Stash did not put there. It is always there, including on scenes with no variants to show, and its
first line says which of the reasons applies.

Under that line, a scene with variants shows its set's **drift score** — the same number the
[Review Variant Sets](#finding-the-sets-worth-synchronizing) listing sorts by, counted the same
way, priced by the weights you remembered there (or that dialog's defaults until you do), and
coloured by the same bands: green at one or nothing to do, then yellow, amber and red as the
set drifts further apart. Hovering it gives the counts behind it, the six weights in force, and
where to change them. With **Compare Cover Images**
on, a differing cover is priced in once the pictures have been read, after the rows. The number
is re-read whenever the pane is: after a **Synchronize Variants...** run that wrote, after a save,
and after the review dialog's weights have been changed and remembered.

Each cover and title is a link — every link this plugin draws opens where
[ᝯㄝₓ Core's link setting](../GTTxCore/README.md#links-cards-and-tooltips) says — and a cover plays
the scene's preview loop while the pointer is over it, the same preview the scene cards use. Under
the first line, each stash-box entry the lookup matched on — a real stash-id, or a `host:id` line
from the variant stash-id field — is a link opening the work's page at that stash-box
(`https://stashdb.org/scenes/<id>`), one link per entry, so a scene named at two providers offers
both. A `pseudo:` line names nothing upstream, so it gets none. The same links appear on the custom
field's own display in a detail panel's **Custom Fields** section: a `↗stashdb.org` link beside the
value, one per `host:id` line it holds.

Rows are ordered full-duration first, then longest running time. The value starts the line under
each title, so a short list reads as a column: **Full-duration** is green and **Partial-duration**
amber; a scene with neither tag has no label; a scene carrying **both** is shown in red — the two
are mutually exclusive by definition, so the contradiction is reported rather than resolved. If the
two settings resolve to the **same tag**, or to two tags one of which sits under the other, the tab
says so in a line above the list: that is a settings mistake rather than a scene one.

The tab itself writes nothing: it is two read queries and a list of links. Its one control, the
**Synchronize Variants...** button at the top of the pane (**Synchronize Variant...** when there is one), opens the dialog described under
[Synchronizing a variant set](#synchronizing-a-variant-set) — amber because pressing through it
leads to writes. While any of this plugin's dialogs is open the button is unavailable, and its
tooltip says so; close that dialog first.

### What a variant's card tells you

Each row wears its differences from the scene you are on at a glance: a cover carries the scene's
rating as an amber banner in its top corner and a 📦 mark where the scene is Organized; after the
resolution and running time come up to three badges — `🏷️+3` for tags the variant has that this
scene does not, `🏷️−1` for the ones it is missing, `📋⚙4` for attributes that disagree — and, with
**Compare Cover Images** on, a 🖼≠ badge where the variant's cover is a different picture from this
scene's. A badge whose count is zero is not shown, and hovering one says what it counts. The
pictures are read after the rows are drawn, so the tab never waits on them.

Hover anywhere on the row and its card says the same thing in full, one amber-headed section per
kind:

```
Extra 3 tags: Blonde, Outdoor, Solo
Missing 1 tag: Anal
Differing attributes: Title, Date, Performers
```

**Extra** are the tags the variant carries and this scene does not; **missing** are the ones this
scene carries and it does not. The last section names the attributes that disagree — title, date,
studio, performers, groups, rating, studio code, director, details, URLs, Organized — and **only
their names**: which fields differ is what sends you to the two pages; what each of them says is a
question for those pages. A list attribute in a different order is not a difference: the same three
performers on both scenes agree, however each page has them sorted. A variant that differs in
nothing says so. The tag that decided a row's label is on the row's tooltip, which is how an alias
or a child tag says which one it matched.

### Migrating a partial-duration scene's stash-id

A stash-box has one entry for the whole scene, so a partial-duration cut wearing that same stash-id
is claiming to be the thing it was cut out of — and everything in Stash that reads a stash-id as a
fact about the file believes it: scraping, **Submit to Stash-box**, duplicate detection.

**Settings → Tasks → ᝯㄝₓ Scene Variants → Migrate Variant Stash-IDs...** moves that claim somewhere
it is true. For every scene carrying your partial-duration tag, it writes the stash-id into a custom
field and takes the stash-id off:

```
ᱜ╦╦🞮_Variant_Stash_ID   stashdb.org:9f3c1e2a-…-8b71
```

One line per stash-id, written as `<provider>:<stash-id>`, so a scene that carries two ids keeps
both. Full-duration scenes get the same field **and keep their stash-ids**, which is what lets the tab
find a whole variant set with one query instead of two.

The scan also flags an inconsistent state it does not resolve: a scene carrying a `pseudo:` line —
a hand-made variant group — **and** a real stash-id at once is making two different claims about
what names the work. Each such scene gets a *Potential drift* line saying so, and saying that a
Proceed would rewrite the field from the real stash-id and drop the pseudo line, taking the scene
out of its hand-made set. A full-duration scene carrying only its real stash-id is the ordinary case
and is never flagged.

Nothing is written until you press **Proceed**: the review dialog lists every scene it would touch
— the plan — what the field will hold and whether the stash-ids come off, and the counters say how
far the scan has got. **Each scene in the plan is a link to it**, and hovering one opens a card —
its cover, its studio, its performers and its tags — since a title and an id are exactly what does
not say which scene it is. **Undo** puts every one of them back — the field to what it said before,
or removed where the scene had none, and the stash-ids back on — for as long as the dialog stays
open.

**Copy log** hands over the counters and every line as plain text, including the ones a long list
no longer shows: the dialog keeps the last thousand lines on screen so a library-sized migration
cannot bog the page down, and says how many it is hiding.

**Close** (or Escape) ends the scan at any point — nothing has been written, so there is nothing to
leave half-done, and reopening the task starts a fresh one. It turns green once nothing is left to
write: the scan found nothing, or everything it listed has been written, whether or not you take
Undo up on its offer. Once a write is under way that exit is
gone and **Stop** takes over: it ends after the batch in flight, what landed stays landed, and Undo
still covers exactly the scenes that were written.

**Rescan** reads the library again and replaces the plan with whatever is left to do — the log is
kept, with a `--- Rescan ---` line between the passes, and so is anything Undo can still reverse.
It is in every one of this plugin's dialogs, shown whenever the dialog is not busy.

Running it twice is safe: a scene whose field already says the right thing, and which has no
stash-id left to move, is not written again. The **Variants** tab matches on both — a scene is found
by its stash-id, by this field, or by either, and a field holding several ids matches on any one of
them — so a half-migrated library keeps working throughout.

### Flagging the scenes that have variants

**Settings → Tasks → ᝯㄝₓ Scene Variants → Flag Variants...** puts the variant flag tag on every
scene that shares a stash-id line — real or migrated — with at least one other scene, and takes it
off every scene it marks that no longer does. Filter by that tag, or click it, and you have every
scene offering a choice of variants.

The matching is the tab's own: a scene's lines are its stash-ids plus whatever its variant field
holds, and sharing any one line is sharing the work. The plan lists every scene the task would
touch and closes with how many **multi-variant sets** the scan found — **[FLAG]** with how many other
scenes share its ids (the count in blue for exactly one, amber for a real choice), **[UNFLAG]**
where none does any more — and nothing is written until **Proceed**, captioned in the footer with
**[Flag]/[Unflag]:** for what it writes. A scene with no title is named by its file, the way
Stash's own lists name it, a long name cut to the start of its stem and its extension. **Undo**
puts the tag back the way it was on every scene written, for as long as the dialog stays open.

If no tag answers to the configured name yet, Proceed creates it first, fully furnished: an
**orphan** (no parents, so hierarchy plugins never touch it), **ignored by auto-tagging**, aliased
`GTTx Multiple Variants`, described so the tag's own page says what it means, carrying the
never-propagate mark (`ᱜ╦╦🞮_Do_Not_Propagate_Tag: 1`) the merge plugins read, and the
hide-from-add-lists mark present but off (`ᱜ╦╦🞮_exclude_from_add_list: 0`) so you can flip it on
without retyping the name. A tag Proceed created stays after an Undo, empty.

The tag is **not a source of truth**: it says what the last run found, nothing fresher. Scenes
scraped, migrated or merged since then are out of step until the task runs again — running it twice
in a row changes nothing, so run it whenever you want the flags current.

#### Grouping scenes by hand

A scene carrying the flag with **no stash-id and no variant field value at all** is not unflagged
by machine. The task cannot tell a flag that outlived its evidence from one you just put on
yourself to say "these are variants of each other" — so those scenes are listed as **[GROUP?]**
lines instead, each with a checkbox, all ticked by default, and the decision is yours, through two
buttons in the same footer, captioned **Selected [Group?]:** and set apart from Copy log:

- **Create Variant Group** writes one shared **pseudo stash-id** — `pseudo:` and 32 hex digits,
  minted on the press — into the variant field of the ticked scenes. From then on they are a
  variant set like any other: the Variants tab lists them, the flag task matches on them, and the
  flag they carry is now true. It takes at least two ticked scenes, because one scene cannot be a
  set; the `pseudo` prefix sits where a real line carries the provider's host, so the field never
  pretends a stash-box was consulted.
- **Remove Tag** takes the flag off the ticked scenes — for the ones whose flag is a leftover.

**Select All** and **Unselect All**, at the right end of the footer, tick or untick every
[GROUP?] line still open; a line already written stays as it is.

So making a set out of scenes no stash-box knows about is: put the flag tag on them, run
**Flag Variants...**, tick them, press **Create Variant Group**. Each press mints a fresh id, so
two presses over two selections make two separate sets. **Undo** covers both buttons the way it
covers Proceed, and closing the dialog leaves the undecided candidates for the next run.

### Finding the sets worth synchronizing

The Variants tab and the save dialog both start from a scene you are already looking at. The
**Review Variant Sets...** task in Settings → Tasks starts from the library instead: it finds every
multi-variant set and gives each a **drift score** for how far its members have drifted apart, worst first.

```
 Drift score weights: title [1] cover [5] other attribute [5] tag [1] performer [1] group [1]   ☐ Remember
──────────────────────────────────────────────────────────────────────────────────────────
▸ 28  3 scenes: Work - Variant A + 2 more   (1 title, 4 attr, 5 tag, 2 perf, 0 group)
▸ 12  2 scenes: Rescanned One + 1 more      (1 title, 1 attr, 1 tag, 0 perf, 0 group, 1 cover)
▸  7  2 scenes: Another Work + 1 more       (1 title, 1 attr, 1 tag, 0 perf, 0 group)
```

The line above the listing is the **weight strip**: six numbers, one per kind of difference, each
editable from 0 to 100, and the listing re-scores and re-sorts as you type. The title has a weight
of its own, one point by default where another attribute is five, because variants are named
apart on purpose. Tick **Remember** and the six are kept in the plugin's settings for next time;
untick it and they are forgotten — the keys are removed rather than written as zeros. The
remembered weights are also what the Variants tab prices its own drift score by.

The drift score is the set's counts, each priced by the weight strip: for every attribute, the members
that disagree with the set's most common value; for tags, performers and groups, every membership
a member is missing from what the set carries between them — then divided by the number of other
scenes in the set and rounded up, so it reads as how far one variant typically stands from the rest
and a pair and a set of five are scored alike. Hovering the number says so — it is a
sorting value, not a count of anything. The full-duration, partial-duration and flag tags are **not**
counted: a cut differs from the whole work by those by definition. They are still offered in the
plan; they never move a drift score.

**Hover a set line for how it is split.** A column per variant (four at most), each header naming
the scene with its resolution and running time under it, and a row per attribute or list they do
not all agree on, with a **✔** where a variant has company on that value and a **✘** where
something else disagrees:

```
                  A full [1]   A clip [2]   A promo [3]
  Title              ✔✘           ✔✘            ✘
  Date               ✘            ✘             ✘
  Tags               ✔✘           ✔✘            ✘
```

Both marks in one cell is the case it exists for: two variants agreeing and a third apart reads as
a 2-1 split at a glance, while crosses all the way across say "these three need looking at side by
side". Past four variants it shows four and says how many it left out; a set that agrees on
everything says so rather than opening an empty table.

**Cover mismatches are counted when *Compare Cover Images* is on** — which is what makes a variant
that lost its cover findable, at the top of the listing. The covers are read once, after the sets
are known, and only for scenes that are in one, so the read is bounded by the variants in your
library rather than by the library. With the setting off, nothing is fetched and no set mentions a
cover — **and the listing says so, naming the setting**, so a comparison that is switched off never
looks like one that is broken. It also counts what it read: `340 covers read; 6 sets disagree
about one.`, or the covers it could not read at all, which is what a Stash serving its images from
another origin looks like from inside the page.

The number is coloured by how far apart the set is — **green** at one or nothing to do,
**yellow** from two and below five of the cheapest difference the weight strip prices, **amber** from there, and
**red** from whichever is larger of three attribute differences and ten cheap ones. The bands are
read off your own weights rather than fixed in points, so repricing a difference reprices the
colours with it.

The listing and the log below it share the dialog, and the bar between them is the divider — grab
it anywhere along its width and pull to resize the listing. The counter line says what the scan
has found **as it goes**, page by page: `Scanned 812 scenes. 37 variant sets found. 0 changes
listed.`

Open a set and pick the scene whose values are right — that one radio picks the set *and* the
source, because they are one decision — then press **Synchronize Set...**. What follows is exactly
the plan the tab's own button produces: one checkbox line per difference, adds and replaces, the
All boxes, the ▸ pickers, and nothing written until **Proceed**. Each press of **Synchronize
Set...** re-reads that set's scenes first, so a second source picked out of a set you have just
written to is planned from what the library holds now rather than from what the scan saw. The
set's drift score and counts are restated on the line they are already drawn on — **the listing does not
re-sort**; re-sorting is what **Rescan** is for. **Undo** reaches every set written while the
dialog has been open, in reverse order. On the set already listed the button is unavailable, with
the reason on it.

### Synchronizing a variant set

Variants of one work drift apart: a date corrected on one, a performer added to another, tags that
only ever landed on the copy you happened to edit. The **Synchronize Variants...** button at the
top of the Variants tab pushes **this scene's** values out to its variants. The scene you are
standing on is the source; that is why the button lives on the scene page rather than in a list
view, where "which of the selected wins" would have no answer. Its tooltip says the rules in one
breath: "…tags, performers and URLs are only ever added, a group is joined at this scene's own
position, and nothing is written until you approve."

The review dialog re-reads the variants and lists every difference first, one checkbox line per
attribute per variant, nothing written until **Proceed**. Closing the dialog after it has written —
or after an Undo — re-reads the list behind it, so the tab shows the variants as the run left them:

```
 All ☐ Title   ☐ Date   ☑ Tags   ☑ Performers
─────────────────────────────────────────────────────────────────────────────────
☐ [SYNC]  Work - Variant B [77]  Title: "Work - Variant B" -> "Work - Variant A"
☐ [SYNC]  Work - Variant B [77]  Date: "2023-12-31" -> "2024-01-05"
☑ [SYNC]  Work - Variant B [77] ▸ Add 2 tags: Blonde, Outdoor
```

**A changed value is shown once, as a word diff**, rather than twice for you to compare. Two
60-character cuts of one opening sentence are identical and say nothing about the edit:

```
before   Details: "Porcelain-skinned, blonde princess flirting with th..." -> "Porcelain-skin..."
now      Details: …flirting with the camera in a sunlit → candlelit room, then moving to the
                  terrace for the second half → closing act of the scene.
```

The words only the old value has are red, the words only the new one has are green, and the text
they share is the light blue every changed value wears. It applies to short values too —
`Title: Ella meets Adira - Promo 1 → 2` puts the `1` in red and the `2` in green — and where two
values share no word at all, the whole of one goes red and the whole of the other green.

**Hovering gives the same diff with nothing left out**, in a tooltip that carries the same colours,
with the unchanged text in white. A word replaced by another is separated from it by a white arrow,
so `sunlit → candlelit` cannot read as one invented word. Values short enough to show whole, and
two values with no word in common to anchor on, keep the plain `"old" -> "new"`.

**The change is coloured, not the line** — green for what a variant gains, red for what it loses,
blue for a value replaced, and everything around them (the label, the scene's name, the counts)
white. So `Add 2 tags: **Blonde, Outdoor**` is green only in the names, and
`Date: **"2023-12-31" -> "2024-01-05"**` is blue only in the values. A line that both removes and
adds — a replaced URL, a swapped group — carries both colours in the halves that earned them. The
same three colours read the card on the Variants tab: extra tags green, missing tags red, differing
attributes blue. Each dialog's head says so.

The rules, each visible in the plan:

- **Adds start ticked, replaces start unticked.** An add only ever adds, while a replace (amber)
  overwrites the variant's own value — so overwriting is opted into, never out of, and an [INFO]
  line says so. Titles are replaces like any other, which is what protects a
  `- Variant <name>` postfix convention by default.
- **The All boxes above the listing tick a whole attribute at once** — `All Date` across every
  variant in one click — and each box restates its attribute's state as you tick lines by hand.
- **Scalars are replaces**, shown old → new: title, date, studio, rating, studio code, director,
  details, Organized. Untick a line and that variant keeps its own value. A long value — a details
  paragraph — is cut to fit the line and flattened onto it; hover it and the tooltip has the whole
  thing, newlines included.
- **Groups are joined at this scene's own `scene_index`** — a variant is the same work, so it
  belongs at the same position in the group. Membership is what is compared; a shared group whose
  index differs is not listed. The write is the whole group list (the API has no add-mode for
  it), so Undo restores the variant's old list exactly.
- **Tags, performers and URLs are added only, never removed.** A variant's extra tags — the ones
  that make it deliberately different — are never listed and never touched, so Proceed with
  everything ticked cannot flatten a variant's uniqueness.
- **A tag or performer line opens into individual picks.** The `▸` arrow on the line unfolds one
  linked checkbox per tag or performer, so two of a line's three tags can go over without the
  third. The line re-says what is picked — `Add 1 of 2 tags: Blonde` — and a line with nothing
  picked counts as no change at all, whatever its own checkbox says. Each name is a link with its
  card, which is exactly what a pick is decided from.
- **The full-duration, partial-duration and flag tags are never pushed at all**, descendants included:
  they are what makes a variant a variant, and the flag is the flag task's to keep.
- **The cover is pushed too, where it differs — with *Compare Cover Images* turned on.** A variant
  that was rescanned and lost the cover that came from a stash-box gets the source's back. It is
  compared by the image bytes rather than by the URL — every scene has a URL of its own whatever
  the pictures are — so a set already sharing a cover lists nothing, and a variant whose own cover
  cannot be read is not offered one, since Undo would then have nothing to put back. The setting
  is **off by default** because it is the one comparison that costs a picture downloaded per scene
  rather than a field already read; with it off, nothing is fetched at all. Hovering a **Cover**
  line shows the two pictures side by side — the variant's own bordered red and the one it would
  get bordered green. With the setting on, **setting a cover on a scene that has variants raises
  the propagate dialog for it**, ticked like everything else that dialog lists. A rescan does not
  — that happens on the server and nothing about it reaches your browser — which is why the manual
  button stays the way to fix one.
- **A tag the hierarchy makes redundant is not pushed** (**Skip Tags the Hierarchy Makes
  Redundant**, on by default). A scene tagged both `Blonde` and its parent `Hair Colour` carries
  one tag that says nothing the other does not, and copying that onto every variant spreads it.
  What counts as redundant is [ᝯㄝₓ Normalize Parent Tags' answer](#relationship-to-the-other-plugins-in-this-repo),
  not this plugin's; the listing says how many it left out. It only ever changes what is
  *offered* — this plugin never prunes a scene.

**Proceed** writes only the ticked lines; **Undo** appears beside it once something has been
written and puts back exactly what was replaced or added, for as long as the dialog stays open. A
written line's checkbox is disabled until an Undo frees it, so a line cannot be written twice.

### Propagating an edit when you save

The same dialog also opens **by itself when you save a scene that has variants** — scoped to
exactly the attributes that save changed, so an edit made on one variant can be pushed to the
others while it is still fresh. It only appears when the save changed something the variants do
not have; an unremarkable save shows nothing at all. Because the watch saw the scene before the
save, it also knows what the save **removed** — a tag taken off, a URL replaced — and offers the
same removal on variants still carrying the value, which the manual button never can: it has no
way to tell a value the source dropped from a value the variant deliberately owns. A replaced URL
is one combined *Update URLs* line per variant (an add line and a remove line would each write the
whole list and clobber each other), and the full-duration, partial-duration and flag tags are
protected from removal exactly as they are from the adds. Unlike the manual dialog, **everything
here starts ticked** — each line is the edit you just made by hand, which is stronger evidence of
intent than a long-standing difference — except title lines, which start unticked even when opted
in: a title is the one value a variant most deliberately owns. The offer is on by default and
switchable off (**Offer to Propagate Edits to Variants**), and title changes are only listed when a
second setting opts them in (**Offer Title Changes Too**, off by default; while it is off, a
dialog raised by a save that changed the title says so in its listing). The write button reads
**Proceed all** while every line is ticked and **Proceed selected** once any line is not.

### Taking a stash-id off a scene

Deleting a stash-id in the edit form (the bin beside it) only edits the form; the id leaves the
scene when you press **Save**. So that is when the plugin asks. If the scene has anything of this
plugin's that the id was holding up, the save is held behind a small dialog listing what would
follow, with **OK** and **Cancel**:

- the id's line comes off the scene's variant stash-id custom field (a field holding lines from
  another provider keeps those, and the field itself comes off when the deleted line was its last);
- the flag tag comes off the scene, unless another line or stash-id it still carries ties it to a
  set, in which case the dialog says so and the tag stays;
- if exactly one other scene is left in the set an id named, the flag tag comes off that scene
  too, since a set of one is not a choice — unless its own stash-ids and field lines put it in
  another set, in which case the dialog says it keeps its tag. Several ids deleted in one save are
  each looked at as their own set, and the dialog names the set each survivor is left in.

**OK** folds the first two into the save itself — the form posts the whole tag list and the whole
custom-field map, so a tag or line taken off separately would have been put straight back — and
removes the survivor's tag right after the save lands. **Cancel** lets the save through with the
stash-id put back into it, so every other edit you made still lands and the id stays; Escape is
Cancel. A deletion with nothing to tidy — no field line, no flag on the scene, no lone survivor —
is not asked about at all, and neither is a save that keeps its ids. The question does not depend
on the propagate setting below.

The mirror case is a notice rather than a question. When a save **adds** a stash-id that other
scenes already carry, the save goes through and a message box then says which scenes share it,
whether that creates a multi-variant set or extends one (by whether those scenes wear the flag
tag), and that running **Migrate Variant Stash-IDs** and **Flag Variants** is recommended, since
the field line and the flag tag that record the set are those two tasks' to write. Nothing is
written by the box itself. An added id nobody else carries is not a set and raises nothing.

## Settings

All under **Settings → Plugins → ᝯㄝₓ Scene Variants**, all optional:

| Setting | Default | What it does |
|---|---|---|
| Full-duration Tag | empty | The name of the tag you put on a scene that is the whole work. |
| Partial-duration Tag | empty | The name of the tag you put on a cut of one. |
| Variant Stash-ID Custom Field | `ᱜ╦╦🞮_Variant_Stash_ID` | The custom field the [migration task](#migrating-a-partial-duration-scenes-stash-id) writes into. A **ⓘ** beside the value carries a tooltip with the field's description, how many scenes carry it and the first ten ([placement](../GTTxCore/README.md#links-cards-and-tooltips)). |
| Variant Flag Tag | `ᱜ╦╦🞮⸎✱MultiVariants✅∙` | The tag the [Flag Variants task](#flagging-the-scenes-that-have-variants) keeps on every scene that has at least one other variant; the task's Proceed creates it if it does not exist yet. |
| Log to the Browser Console | off | Print each variant lookup to the console under `[svr]`: the scene, how many variants were found and what they were matched on. A failed query is reported whatever this says. |
| Offer to Propagate Edits to Variants | on | Open the [propagate dialog](#propagating-an-edit-when-you-save) when a save changed something the variants do not have. |
| Offer Title Changes Too | off | Also list the title in the [propagate dialog](#propagating-an-edit-when-you-save); the manual button always lists titles. |
| Skip Tags the Hierarchy Makes Redundant | on | Leave out a tag another tag on the same scene already implies, as [ᝯㄝₓ Normalize Parent Tags](#relationship-to-the-other-plugins-in-this-repo) decides — see [the rules](#synchronizing-a-variant-set). |
| Compare Cover Images | off | Also compare the variants' cover images and offer this scene's where they differ — see [the rules](#synchronizing-a-variant-set) and [the set listing](#finding-the-sets-worth-synchronizing). |

The two defaults with a value are written into their boxes the first time the plugin loads, so the
page shows the name the plugin is actually using; clearing one goes back to that same default, and
a box you have cleared stays cleared.

Tag names are typed rather than picked, and compared without regard to case or surrounding spaces.
A name finds the tag by any of its **aliases** as well as by its name, and a scene tagged with any
**descendant** of that tag counts as tagged with it — so naming the general tag covers every
specific one you have filed under it, and you do not have to keep the setting in step with your
taxonomy. Leave both empty and the tab still lists the variants — it just says nothing about which
is which.

Once a name resolves, a **🔗** appears on that setting's own line, just after the value and left of
**Edit**, linking to the tag it found — so a name matching nothing shows up as a missing link rather
than as a tab where every scene lists unclassified. **Hover it for what that tag is**: its picture,
its name and id, what it matched on where that was an alias or a difference of case, its aliases,
its parents, its children and its description — and, where a name reaches more than one tag, how
many there are. The plugin uses all of them; the link goes to the first.

## Relationship to the other plugins in this repo

- **[ᝯㄝₓ Core](../GTTxCore/README.md)** is required. It supplies the
  [link target, the cards, the tooltips and the ⓘ mark](../GTTxCore/README.md#links-cards-and-tooltips),
  the [bulk-edit lease](../GTTxCore/README.md#the-bulk-edit-lease), the
  [stale-script banner and the Reload UI button](../GTTxCore/README.md#the-stale-script-banner-and-the-reload-ui-button)
  and the [debug switch](../GTTxCore/README.md#the-debug-switch).
- **ᝯㄝₓ Normalize Parent Tags**, 3.2.0 or newer, is asked which tags are redundant when **Skip
  Tags the Hierarchy Makes Redundant** is on, so its hierarchy and its own tag exclusions are what
  answer, and a tag you have told that plugin to leave alone is never dropped here either. With it
  absent, disabled or older, every listing says so instead of filtering silently.
- **ᝯㄝₓ Entity Name Maintainer** and this plugin never call each other. Both wrap the page's
  `fetch`, both intercept a scene save and hold it for one read before forwarding it, and a save
  passes through both exactly once. What keeps them apart is the lease: every write this plugin
  makes is made under one, and the save watch samples the lease before letting a write through, so
  a bulk edit by another plugin never raises this plugin's dialog, and this plugin's writes never
  read to that plugin as a user's own edit. The same lease is what makes a library-wide rewrite
  unable to raise one dialog per scene.
- **ᝯㄝₓ Custom Fields Bulk Editor**, where it is present, is handed a description of the variant
  stash-id field for its description store at load; the console says whether it was filed or is
  waiting for an Apply in that plugin's **Manage Custom Field Descriptions...** dialog.
- **The merge plugins** read the never-propagate mark the flag tag is created with, so the flag is
  never merged onto anything.

## Notes and limitations

**A stash-id, or the field the migration task writes, is the only evidence used.** A scene that
never got one, or whose variants never got one, gets a tab that says so and lists nothing. Matching
on a title convention (`<title> - Clip 2`) and on shared performers is not built — expect a list on
the scenes that carry the id convention and nowhere else. What *is* built is the manual route: the
flag task's hand-grouping gives any set of scenes the field, pseudo stash-id and all, without a
stash-box ever having heard of them.

**The tab itself never writes.** Everything it notices that looks wrong is shown and left alone.
The things that write — the three tasks, the Synchronize Variants dialog the tab's one button opens,
the dialog a save raises and the stash-id question — all show their whole plan before anything
moves, and only the last two open by themselves.

**The tab is always there**, including on the scenes that have no variants to show, and its first
line says which of the reasons applies — "this scene carries no stash-id" is the usual one. It
carries no count in its caption; the pane counts its own rows in its first line instead.

**Rows say Full-duration and Partial-duration** rather than echoing your tag names back; the tag that
decided a row is on the row's tooltip.

**Scene pages only.** There is nothing on a performer, studio or group.

**One dimension, and it is built in.** Full-duration versus partial-duration is the only distinction
the plugin knows; the two tag names are the only part of it you can configure.

**No scrubber on the covers, and no O-counter.** A cover carries the preview loop, the rating and
the Organized mark, and nothing else of Stash's own scene card.

## Troubleshooting

**No Variants tab at all.** Either Stash is not 0.28.0 or newer, or the browser is running an older
copy of the script. The console says which, once, at load, and the settings page shows a
stale-script banner when it can tell. A red **Reload UI** button beside Stash's own **Reload
plugins**, and in every dialog's own stale banner, reloads the page, which is the whole fix — see
[ᝯㄝₓ Core](../GTTxCore/README.md#the-stale-script-banner-and-the-reload-ui-button).

### Checking which version is actually running

Open `/plugin/SceneVariants/javascript` on your Stash and search it for `PLUGIN_VERSION`. Those are
the exact bytes your browser is given — if the version there is old, the file in your plugins
directory is old, and the copy never landed. Check for a second `SceneVariants` folder there under a
different name too: Stash keys on the `id:` in the manifest, so a duplicate shadows the one you are
updating.

A JS change needs **no plugin reload** — Stash reads the file on every request, so overwriting it
and reloading the page is enough. Reload plugins only when the `.yml` changes.

**The tab is empty on a scene you know has variants.** The tab tells you why in its first line.
Check the scene has a stash-id at all (**Edit → Stash IDs**), or the variant stash-id custom field if
it has been migrated, and that its variants carry the same one. A failed query is always reported
to the console, whatever the settings say.

**Every row is unclassified.** The two tag names in the settings match no tag at all — neither a
name nor an alias. Copy the name from the tag's own page rather than retyping it. If the tag list
itself could not be read, the console says so: nothing can be classified without it.

**A control is drawn where you did not expect it, or missing.** Type
`__GTTx__.StashPluginCoop.debugButtons = true` into the console and every control this plugin draws
into Stash's chrome explains itself on `[svr gate]` — see
[ᝯㄝₓ Core](../GTTxCore/README.md#the-debug-switch).

**The tab appeared and then stopped after a Stash upgrade.** The extension points it hangs off
(`ScenePage.Tabs` and `ScenePage.TabContent`) are Stash's and can move. That is the first thing to
suspect, and the console line at load is where it will show.

## Installing

Copy the `SceneVariants` folder — and `GTTxCore` beside it — into your Stash plugins directory,
then **Settings → Plugins → Reload plugins**. There is no build step and nothing to install. Without
Stash 0.28.0 or newer there is no tab at all and one line in the browser console saying why —
there is no hand-built imitation of a tab to fall back to.

## Licence

Same terms as the rest of this repository.
