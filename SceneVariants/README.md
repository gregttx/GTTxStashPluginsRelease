# ᝯㄝₓ Scene Variants

> ## ⚠ This release needs ᝯㄝₓ Core
>
> From this version on, this plugin needs **[ᝯㄝₓ Core](../GTTxCore/README.md)** installed and
> enabled. It holds the code every ᝯㄝₓ plugin used to carry its own copy of — the hover cards, the
> tooltips, the Reload UI button, the rules that place a button in one of Stash's rows.
>
> **If you install through a source index**, Stash installs it for you: it is declared as a
> dependency and loaded first. **If you copy folders by hand, copy `GTTxCore/` too.**
>
> Without it this plugin stops at load and says so once in the browser console. Your settings and
> your library are untouched either way — the plugin id, every setting key and everything stored
> under them are unchanged.

A scene is often in your library twice: the whole thing, and a cut out of it. Stash has no way to
say the two are the same work — [the request to link scenes to each other](https://github.com/stashapp/stash/issues/3201)
was closed with "Groups cover scene to scene linking", and a Group is a heavy object to mint for
"these two files are the same scene". So this plugin derives the relation instead of storing it.

Open a scene. Beside **Details**, **File Info** and **Edit** there is now a **Variants** tab:

```
Details   Queue   Markers   Filter   File Info   History   Variants   Edit
──────────────────────────────────────────────────────────┴────────────────
2 other variants of this scene. Matched on 1 stash-id.
  ┌────────┐  Cool Shoot
  │ cover  │  Full-length · 1920×1080 · 41:12
  └────────┘
  ┌────────┐  Cool Shoot - Clip 2
  │ cover  │  Partial-length · 1920×1080 · 4:03
  └────────┘
```

The tab sits just before **Edit**, which stays last, and is amber — the one tab in that strip Stash
did not put there.

Each cover and title is a link, opening in a new tab so the scene you are comparing against stays
where it is, and a cover plays the scene's preview loop while the pointer is over it — the same
preview the scene cards use. A cover also wears the scene's rating as an amber banner in its top
corner and a 📦 mark where the scene is organized, so the two facts read at a glance without the
hover. With **Compare Cover Images** on, a variant whose cover is a different picture from the
scene you are on gets a 🖼≠ badge — the list already shows both covers, and the badge is the half
that says they disagree. The pictures are read after the rows are drawn, never before, so the tab
never waits on them; the browser is fetching the same images to draw the thumbnails anyway.
The tab itself writes nothing: it is two read queries and
a list of links. The one thing here that writes is the migration task below, and it shows you every
scene it would touch first.

Rows say **Full-length** and **Partial-length** rather than echoing your tag names back. The tag
that decided a row is on its hover text, which is where it is useful and where it is not in the way
of reading the column.

The tab is always there, including on the scenes that have no variants to show, and it says which of
the reasons applies. That is deliberate: a tab that came and went as a query landed would move the
strip under your pointer, and "this scene carries no stash-id" is the most useful thing it has to
say on most scenes today.

## What it needs from you

A handful of settings, all optional, all under **Settings → Plugins → ᝯㄝₓ Scene Variants**:

| Setting | What it does |
|---|---|
| Full-length Tag | The name of the tag you put on a scene that is the whole work |
| Partial-length Tag | The name of the tag you put on a cut of one |
| Variant Stash-ID Custom Field | The custom field the migration task writes into. The default `ᱜ╦╦🞮_Variant_Stash_ID` is written into the box the first time the plugin loads, so the page shows the name it is actually using; clearing it goes back to that same default, and a box you have cleared stays cleared. A **ⓘ** beside the value hovers to the field's description, how many scenes carry it and the first ten — read on hover The tooltip opens above the mark rather than under the pointer, where the cursor would sit on top of its first line. |
| Variant Flag Tag | The tag the **Flag Variants** task keeps on every scene that has at least one other variant. The default `ᱜ╦╦🞮⸎✱MultiVariants❌∙` is seeded the same way; the task's Proceed creates the tag if it does not exist yet — see below for what the created tag carries. |

Names are typed rather than picked, and compared without regard to case or surrounding spaces. A
name finds the tag by any of its **aliases** as well as by its name, and a scene tagged with any
**descendant** of that tag counts as tagged with it — so naming the general tag covers every specific
one you have filed under it, and you do not have to keep the setting in step with your taxonomy.
Leave both empty and the tab still lists the variants — it just says nothing about which is which.

Once a name resolves, a **🔗** appears on that setting's own line, just after the value and left of
**Edit**, linking to the tag it found — so a name matching nothing shows up as a missing link rather
than as a tab where every scene lists unclassified. **Hover it for what that tag is**: its picture, its name
and id, what it matched on where that was an alias or a difference of case, its aliases, its
parents, its children and its description — and, where a name reaches more than one tag, how many there are.
The plugin uses all of them; the link goes to the first.

The row's hover text names the tag the **scene** carries, which is how an alias or a child tag says
which one it matched.

## Migrating a partial-length scene's stash-id

A stash-id names the **work**. A stash-box has one entry for the whole scene, so a partial-length cut
wearing that same stash-id is claiming to be the thing it was cut out of — and everything in Stash
that reads a stash-id as a fact about the file believes it: scraping, **Submit to Stash-box**,
duplicate detection.

**Settings → Tasks → ᝯㄝₓ Scene Variants → Migrate Variant Stash-IDs...** moves that claim somewhere
it is true. For every scene carrying your partial-length tag, it writes the stash-id into a custom
field and takes the stash-id off:

```
ᱜ╦╦🞮_Variant_Stash_ID   stashdb.org:9f3c1e2a-…-8b71
```

One line per stash-id, written as `<provider>:<stash-id>`, so a scene that carries two ids keeps
both. Full-length scenes get the same field **and keep their stash-ids**, which is what lets the tab
find a whole variant set with one query instead of two.

Nothing is written until you press **Proceed**: the dialog lists every scene it would touch, what
the field will hold and whether the stash-ids come off, and the counters say how far the scan has
got. **Each scene in that list is a link to it**, opening in a new tab like every other link these
plugins draw, and hovering one opens a
card — its cover, its studio, its performers and its tags — since a title and an id are exactly
what does not say which scene it is. **Undo** puts every one of them back — the field to what it said before, or removed where the
scene had none, and the stash-ids back on — for as long as the dialog stays open.

**Copy log** hands over the counters and every line as plain text, including the ones a long
list no longer shows: the dialog keeps the last thousand lines on screen so a library-sized
migration cannot bog the page down, and says how many it is hiding.

**Close** (or Escape) ends the scan at any point — nothing has been written, so there is nothing to
leave half-done, and reopening the task starts a fresh one. Once a write is under way that exit is
gone and **Stop** takes over: it ends after the batch in flight, what landed stays landed, and Undo
still covers exactly the scenes that were written.

Running it twice is safe: a scene whose field already says the right thing, and which has no
stash-id left to move, is not written again.

The **Variants** tab then matches on both — a scene is found by its stash-id, by this field, or by
either, and a field holding several ids matches on any one of them — so a half-migrated library
keeps working throughout.

## Flagging the scenes that have variants

**Settings → Tasks → ᝯㄝₓ Scene Variants → Flag Variants...** puts the variant flag tag on every
scene that shares a stash-id line — real or migrated — with at least one other scene, and takes it
off every scene it marks that no longer does. Filter by that tag, or click it, and you have every
scene offering a choice of variants.

The matching is the tab's own: a scene's lines are its stash-ids plus whatever its variant field
holds, and sharing any one line is sharing the work. The plan lists every scene the task would
touch and closes with how many **multi-variant sets** the scan found — **[FLAG]** with how many other
scenes share its ids (the count in blue for exactly one, amber for a real choice), **[UNFLAG]**
where none does any more — and nothing is written until **Proceed**. **Undo** puts the tag back the
way it was on every scene written, for as long as the dialog stays open.

### Grouping scenes by hand

A scene carrying the flag with **no stash-id and no variant field value at all** is not unflagged
by machine. The task cannot tell a flag that outlived its evidence from one you just put on
yourself to say "these are variants of each other" — so those scenes are listed as **[GROUP?]**
lines instead, each with a checkbox, all ticked by default, and the decision is yours, through two
buttons in the same footer:

- **Create Variant Group** writes one shared **pseudo stash-id** — `pseudo:` and 32 hex digits,
  minted on the press — into the variant field of the ticked scenes. From then on they are a
  variant set like any other: the Variants tab lists them, the flag task matches on them, and the
  flag they carry is now true. It takes at least two ticked scenes, because one scene cannot be a
  set; the `pseudo` prefix sits where a real line carries the provider's host, so the field never
  pretends a stash-box was consulted.
- **Remove Tag** takes the flag off the ticked scenes — for the ones whose flag is a leftover.

So making a set out of scenes no stash-box knows about is: put the flag tag on them, run
**Flag Variants...**, tick them, press **Create Variant Group**. Each press mints a fresh id, so
two presses over two selections make two separate sets. **Undo** covers both buttons the way it
covers Proceed, and closing the dialog leaves the undecided candidates for the next run.

If no tag answers to the configured name yet, Proceed creates it first, fully furnished: an
**orphan** (no parents, so hierarchy plugins never touch it), **ignored by auto-tagging**, aliased
`GTTx Multiple Variants`, described so the tag's own page says what it means, carrying the
never-propagate mark (`ᱜ╦╦🞮_Do_Not_Propagate_Tag: 1`) the merge plugins read, and the
hide-from-add-lists mark present but off (`ᱜ╦╦🞮_exclude_from_add_list: 0`) so you can flip it on
without retyping the name. A tag Proceed created stays after an Undo, empty.

The tag is **not a source of truth**: it says what the last run found, nothing fresher. Scenes
scraped, migrated or merged since then are out of step until the task runs again — running it twice
in a row changes nothing, so run it whenever you want the flags current.

## Finding the sets worth synchronizing

The Variants tab and the save dialog both start from a scene you are already looking at. The
**Review Variant Sets...** task in Settings → Tasks starts from the library instead: it finds every
multi-variant set and scores how far its members have drifted apart, worst first.

```
 A difference is worth: title [1] cover [5] other attribute [5] tag [1] performer [1] group [1]   ☐ Remember
──────────────────────────────────────────────────────────────────────────────────────────
▸ 28  3 scenes: Work - Variant A + 2 more   (1 title, 4 attr, 5 tag, 2 perf, 0 group)
▸ 12  2 scenes: Rescanned One + 1 more      (1 title, 1 attr, 1 tag, 0 perf, 0 group, 1 cover)
▸  7  2 scenes: Another Work + 1 more       (1 title, 1 attr, 1 tag, 0 perf, 0 group)
```

**Hover a set line for how it is split.** A column per variant (four at most), each header naming
the scene with its resolution and running time under it, and a row per dimension they do not all
agree on, with a **✔** where a variant has company on that value and a **✘** where something else
disagrees:

```
                  A full [1]   A clip [2]   A promo [3]
  Title              ✔✘           ✔✘            ✘
  Date               ✘            ✘             ✘
  Tags               ✔✘           ✔✘            ✘
```

Both marks in one cell is the case it exists for: two variants agreeing and a third apart reads as
a 2-1 split at a glance, while crosses all the way across say "these three need looking at side by
side" without the table pretending to say more than it can. Past four variants it shows four and
says how many it left out; a set that agrees on everything says so rather than opening an empty
table.

**The title is priced on its own**, and cheaply — one point where an attribute is five. Variants
are *named* apart on purpose, so a differing title says less about drift than anything else here;
pricing it at zero would be the plugin deciding that rather than you, so it has a column of its own
and you can set it to whatever it is worth in your library.

**Cover mismatches are counted here when *Compare Cover Images* is on** — which is what makes a
variant that lost its cover *findable*, at the top of the listing, instead of something you have to
open every set to notice. The covers are read once, after the sets are known, and only for scenes
that are actually in one: a scene sharing evidence with nobody cannot have a cover mismatch, so the
read is bounded by the variants in your library rather than by the library. With the setting off,
nothing is fetched and no set mentions a cover — **and the listing says so, naming the setting**,
so a comparison that is switched off never looks like one that is broken. It also counts what it
read: `340 covers read; 6 sets disagree about one.`, or the covers it could not read at all, which
is what a Stash serving its images from another origin looks like from inside the page.

The number is coloured by how far apart the set is — **green** where there is nothing to do,
**yellow** below five of the cheapest difference the strip prices, **amber** from there, and **red**
from whichever is larger of three attribute differences and ten cheap ones. The bands are read off
your own weights rather than fixed in points, so repricing a difference reprices the colours with
it.

The score is those counts, each priced by the strip above the listing: for every attribute, the
members that disagree with the set's most common value; for tags, performers and groups, every
membership a member is missing from what the set carries between them. For a pair that is exactly
"one differing attribute" and "one tag on one side only", and it stays meaningful for larger sets,
which counting pairs does not.

The full-length, partial-length and flag tags are deliberately **not** counted: a cut differs from
the whole work by those *by definition*, so counting them would put one baseline under every set in
the library and rank nothing. They are still offered in the plan; they never move a score.

Each number is editable from 0 to 100, and the listing re-scores and re-sorts as you type. Tick
**Remember** and they are kept in the plugin's settings for next time; untick it and they are
forgotten — an absent weight is what "not remembered" means, which is why forgetting removes the
keys rather than writing zeros.

The listing and the log below it share the dialog, and the divider between them is draggable —
grab the bottom edge of the listing and pull. The counter line says what the scan has found **as it
goes**, page by page, not only at the end: `Scanned 812 scenes. 37 variant sets found. 0 changes
listed.` — a library-wide scan is the one pass here that runs for minutes, and a count of scenes
read says nothing about whether it is finding anything.

**Rescan** reads the library again and replaces the plan with whatever is left to do — the log is
kept, with a `--- Rescan ---` line between the passes, and so is anything Undo can still reverse.
It is in every one of this plugin's dialogs, not only this one.

Open a set and pick the scene whose values are right — that one radio picks the set *and* the
source, because they are one decision — then press **Synchronize Set...**. What follows is exactly
the listing the tab's own button produces: one checkbox line per difference, adds and replaces,
the All boxes, the ▸ pickers, and nothing written until **Proceed**. Each press of **Synchronize Set...** re-reads that set's scenes first, so a second source picked
out of a set you have just written to is planned from what the library holds now rather than from
what the scan saw. The set's score and counts are restated on the line they are already drawn on —
**the listing does not re-sort**, because a set that has just been synchronized would otherwise
slide away from the pointer working on it. Re-sorting is what **Rescan** is for.

Moving on to another set
commits what the last one wrote (Undo reaches the set in front of you, and the log says when it
stops reaching an earlier one) — which is why the button goes unavailable on a set it has already
listed, with the reason on it: pressing it again there would commit the write you just made and
take Undo away, while looking like it did nothing.

## Synchronizing a variant set

Variants of one work drift apart: a date corrected on one, a performer added to another, tags that
only ever landed on the copy you happened to edit. The **Synchronize Variants...** button at the
top of the Variants tab — the pane's one control, amber because pressing through it leads to
writes — pushes **this scene's** values out to its variants. The scene you are standing on is the
source; that is the whole reason the button lives on the scene page rather than in a list view,
where "which of the selected wins" would have no answer.

The same dialog also opens **by itself when you save a scene that has variants** — scoped to
exactly the attributes that save changed, so an edit made on one variant can be pushed to the
others while it is still fresh. It only appears when the save changed something the variants do
not have; an unremarkable save shows nothing at all. Because the watch saw the scene before the
save, it also knows what the save **removed** — a tag taken off, a URL replaced — and offers the
same removal on variants still carrying the value, which the manual button never can: it has no
way to tell a value the source dropped from a value the variant deliberately owns. A replaced URL
is one combined *Update URLs* line per variant (an add line and a remove line would each write the
whole list and clobber each other), and the dimension and flag tags are protected from removal
exactly as they are from the adds. Unlike the manual dialog, **everything here starts ticked** —
each line is the edit you just made by hand, which is stronger evidence of intent than a
long-standing difference — except title lines, which start unticked even when opted in: a title is
the one value a variant most deliberately owns. The offer is on by default and switchable off
(**Offer to Propagate Edits to Variants**), and title changes are only listed when a second
setting opts them in (**Offer Title Changes Too**, off by default — a title is the one value a
variant most deliberately owns; while it is off, a dialog raised by a save that changed the title
says so in its listing). The write button reads **Proceed all** while every line is ticked and
**Proceed selected** once any line is not.

The dialog re-reads the variants and lists every difference first, one checkbox line per attribute
per variant, nothing written until **Proceed**. Closing the dialog after it has written — or after
an Undo — re-reads the list behind it, so the tab shows the variants as the run left them:

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

**Hovering gives the same diff with nothing left out**, in a box that carries the same colours,
with the unchanged text in white: the line is one row among many, where the blue says *this row's
value is the change*, while the box holds nothing but the value and the blue would only dim what
you opened it to read. A word replaced by another is separated from it by a white
arrow, so `sunlit → candlelit` cannot read as one invented word. Values short enough to show whole,
and two values with no word in common to anchor on, keep the plain `"old" -> "new"`.

**The change is coloured, not the line** — green for what a variant gains, red for what it loses,
blue for a value replaced, and everything around them (the label, the scene's name, the counts)
white. So `Add 2 tags: **Blonde, Outdoor**` is green only in the names, and
`Date: **"2023-12-31" -> "2024-01-05"**` is blue only in the values. A line that both removes and
adds — a replaced URL, a swapped group — carries both colours in the halves that earned them. The
same three colours read the hover delta on the Variants tab: extra tags green, missing tags red,
differing attributes blue. Each dialog's head says so, so the vocabulary is never something you
have to have been told.

The rules, each visible in the listing:

- **Adds start ticked, replaces start unticked.** An add only ever adds, while a replace (amber)
  overwrites the variant's own value — so overwriting is opted into, never out of, and an [INFO]
  line says so. Titles are replaces like any other, which is what protects a
  `- Variant <name>` postfix convention by default.
- **The All boxes above the listing tick a whole attribute at once** — `All Date` across every
  variant in one click — and each box restates its attribute's state as you tick lines by hand.
- **Scalars are replaces**, shown old → new: title, date, studio, rating, studio code, director,
  details, organized. Untick a line and that variant keeps its own value. A long value — a details
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
  picked counts as no change at all, whatever its own checkbox says. Each name is a link with the
  usual hover card, which is exactly what a pick is decided from.
- **The full-length, partial-length and flag tags are never pushed at all**, descendants included:
  they are what makes a variant a variant, and the flag is the flag task's to keep.
- **The cover is pushed too, where it differs — with *Compare Cover Images* turned on.** A variant
  that was rescanned and lost the cover that came from a stash-box gets the source's back. It is
  compared by the image bytes rather than by the URL — every scene has a URL of its own whatever
  the pictures are — so a set already sharing a cover lists nothing, and a variant whose own cover
  cannot be read is not offered one, since Undo would then have nothing to put back. The setting
  is **off by default** because it is the one comparison that costs a picture downloaded per scene
  rather than a field already read; with it off, nothing is fetched at all. The set scores never
  count covers either way, which would be an image per scene in the library.

  With it on, **setting a cover on a scene that has variants raises the propagate dialog for it**,
  ticked like everything else that dialog lists. A rescan does not — that happens on the server and
  nothing about it reaches your browser — which is why the manual button stays the way to fix one.
- **A tag the hierarchy makes redundant is not pushed.** A scene tagged both `Blonde` and its
  parent `Hair Colour` carries one tag that says nothing the other does not, and copying that onto
  every variant spreads it. What counts as redundant is not decided here — **ᝯㄝₓ Normalize Parent
  Tags** is asked, so its hierarchy and its own tag exclusions are what answer, and a tag you have
  told that plugin to leave alone is never dropped here either. The listing says how many it left
  out; it needs that plugin at 3.2.0 or newer, and with it absent, disabled or older the listing
  says so instead of filtering silently. On by default (**Skip Tags the Hierarchy Makes Redundant**), and it only ever changes
  what is *offered* — this plugin never prunes a scene.

Hovering a **Cover** line shows the two pictures side by side — the variant's own bordered red and
the one it would get bordered green — because "is that the right cover?" is a question no amount of
text answers.

**Proceed** writes only the ticked lines; **Undo** appears beside it once something has been
written and puts back exactly what was replaced or added, for as long as the dialog stays open. A written line's checkbox is disabled until an Undo frees
it, so a line cannot be written twice.

## What the hover box tells you

Each row wears the delta at a glance first: up to three badges after the resolution and running
time — `🏷️+3` for tags the variant has that this scene does not, `🏷️−1` for the ones it is
missing, `📋⚙4` for attributes that disagree. A badge whose count is zero is not shown, and
hovering one says what it counts.

Hover anywhere on the row and a box says the same thing in full, one amber-headed section per
kind:

```
Extra 3 tags: Blonde, Outdoor, Solo
Missing 1 tag: Anal
Differing attributes: Title, Date, Performers
```

**Extra** are the tags the variant carries and this scene does not; **missing** are the ones this
scene carries and it does not. The last section names the attributes that disagree — title, date,
studio, performers, groups, rating, studio code, director, details, URLs, organised — and **only
their names**. Which fields differ is what sends you to the two pages; what each of them says is a
question for those pages, and a box quoting both sides would be a diff view rather than a hint.

A list attribute in a different order is not a difference: the same three performers on both scenes
agree, however each page happens to have them sorted. A variant that differs in nothing says so.

Rows are ordered full-length first, then longest running time, because "which of these is the whole
thing" is the question the tab exists to answer. The value starts the line under each title, so a
short list reads as a column: full-length is green and partial-length amber; a scene with neither tag simply has no label. A scene carrying
**both** is shown in red — the two are mutually exclusive by definition, so the contradiction is
reported rather than resolved.

If the two settings resolve to the **same tag**, or to two tags one of which sits under the other,
the tab says so in a line above the list. That is a settings mistake rather than a scene one, and
left unsaid it shows up as every scene under the overlap being flagged red individually.

## What it does not do

**A stash-id, or the field the migration task writes, is the only evidence used.** A scene that
never got one, or whose variants never got one, gets a tab that says so and lists nothing. Matching
on a title convention (`<title> - Clip 2`) and on shared performers is the obvious next step and is
not built — expect a list on the scenes that carry the id convention and nowhere else. What *is*
built is the manual route: the flag task's hand-grouping above gives any set of scenes the field,
pseudo stash-id and all, without a stash-box ever having heard of them.

**The tab itself never writes.** Everything it notices that looks wrong is shown and left alone.
The things that write — the two tasks, and the Synchronize Variants dialog the tab's one button
opens — are all started by hand and all show their whole plan before anything moves.

**Scene pages only.** There is nothing on a performer, studio or group.

**One dimension, and it is built in.** Full-length versus partial-length is the only distinction the
plugin knows; the two tag names are the only part of it you can configure. A settings-driven table of
dimensions — resolution, cut, release — is a later level, and deliberately not guessed at now.

**No count on the tab caption.** The strip and the pane are two separate extension points rendering
two separate components, so a count beside the word would mean sharing the query's answer between
them to save you one click. The pane counts its own rows in its first line instead.

**No scrubber on the covers**, and no rating, organised flag or O-counter. Stash's own `SceneCard`
has all of that and the plugin API offers it — but it wants a forty-odd-field scene fragment to
render, hand-copied into a query here and silently wrong the day the card reads one more field. Two
path fields buy the cover and the preview, which is what was asked for.

## Installing

Copy the `SceneVariants` folder into your Stash plugins directory, then **Settings → Plugins →
Reload plugins**. There is no build step and nothing to install.

**Requires Stash 0.28.0 or newer.** The tab is added through the scene page's own plugin extension
points (`ScenePage.Tabs` and `ScenePage.TabContent`), which arrived in that release. On anything
older there is no tab at all and one line in the browser console saying why — there is deliberately
no hand-built imitation of a tab to fall back to.

## Troubleshooting

**No Variants tab at all.** Either Stash is not 0.28.0 or newer, or the browser is running an older
copy of the script. The console says which, once, at load, and the settings page shows a
stale-script banner when it can tell.

**A red Reload UI button appears beside Stash's own Reload plugins** while any ᝯㄝₓ plugin's script is out of date, at the top of Settings → Plugins. Pressing it reloads the page, which is the whole fix: **Reload plugins** re-reads the plugin folder on the server and cannot replace a script this page has already run. Any other Stash tab you have open needs the same. **The same red button is in every dialog's own stale banner**, so a warning found while a dialog is open can be acted on where it is read.

**To find out which script Stash is actually serving**, open `/plugin/SceneVariants/javascript` on
your Stash and search it for `PLUGIN_VERSION`. Those are the exact bytes your browser is given.
Stash sends that with `Cache-Control: no-cache` and an ETag, so **the browser cannot be serving you a
stale copy** — if the version there is old, the file in your plugins directory is old, and the copy
never landed. Check for a second `SceneVariants` folder there under a different name too: Stash keys
on the `id:` in the manifest, so a duplicate shadows the one you are updating.

A JS change needs **no plugin reload** — Stash reads the file on every request, so overwriting it
and reloading the page is enough. Reload plugins only when the `.yml` changes.

**The tab is empty on a scene you know has variants.** The tab tells you why in its first line.
Check the scene has a stash-id at all (**Edit → Stash IDs**), or the variant stash-id custom field if
it has been migrated, and that its variants carry the same one. A failed query is always reported to the console, whatever the settings say.

**Every row is unclassified.** The two tag names in the settings match no tag at all — neither a
name nor an alias. Copy the name from the tag's own page rather than retyping it. If the tag list
itself could not be read, the console says so: nothing can be classified without it.

**The tab appeared and then stopped after a Stash upgrade.** The extension points it hangs off are
Stash's and can move. That is the first thing to suspect, and the console line at load is where it
will show.
