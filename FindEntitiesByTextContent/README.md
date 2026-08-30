# ᝯㄝₓ Find & Replace Entities by Text Content

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

Which entities in your library mention this text — and can I change it everywhere at once?

Stash cannot be asked. It will filter a scene list on a scene's own `details`, and a
performer list on a performer's own `details`, and nothing at all on whichever custom fields
an entity happens to carry. This plugin is that one question, with one box to type it into.

Requires Stash 0.31.0 or newer.

## Using it

**Settings → Tasks → Plugin Tasks → Find & Replace Entities by Text Content...**

Type what to look for, turn on the entity types you want searched — they all start **off**,
so nothing is read until you say so — and press **Search**. The amber **All On** and **All
Off** pair sets them all at once, and each is disabled when pressing it would change nothing,
so All Off is dead the moment the dialog opens.

It looks in every text field of every type you turned on:

| Type | Fields |
|---|---|
| Scene | title, code, details, director, URLs, custom field names and values |
| Image | title, code, details, photographer, URLs, custom field names and values |
| Gallery | title, code, details, photographer, URLs, custom field names and values |
| Performer | name, disambiguation, aliases, details, URLs, tattoos, piercings, measurements, career length, custom field names and values |
| Studio | name, aliases, details, URLs, custom field names and values |
| Group | name, aliases, synopsis, director, URLs, custom field names and values |
| Tag | name, aliases, description, custom field names and values |

Which of those your Stash actually has is settled by asking it, once per search, rather than
assumed — a field this plugin looks for and your server does not have is skipped instead of
failing the whole search.

Scene markers are not searched: a marker carries a title and no page of its own to open.

## The results

One line per entity that matched, reading: the entity with its id in brackets, then which
attributes matched and how many times each, then the text around the first match with the
match marked.

The entity's name is a link to it, and **hovering it opens a card**: its picture and the
handful of fields it is recognised by — for a tag, its aliases, parents, children and
description. It is read on the first hover rather than while the list is drawn, so a search
that finds thousands of entities costs nothing for the ones you never point at.

```
Beach day (1)      Scene · Title, Details ×2, URLs, Custom field value   …Beach day…
Sandy (7)          Performer · Details                                   Likes the BEACH
Outdoors (3)       Tag · Aliases, Custom field name                      beachy
```

Click one to open it in a new tab, or in this one if ᝯㄝₓ Core is set that way. A second row of filters appears above the list as the
search finds attributes to offer — Title, Details, Aliases, Custom field name, and so on,
one for every attribute something has actually matched in. Turning one off hides the
entities that only matched there, and drops that attribute's chip from the ones that also
matched elsewhere, so a line never claims a match it is hiding. They start on; the amber
**All On** / **All Off** pair covers both rows.

The two rows are not the same kind of control. **Entity types decide what is read** — they
are the whole list from the start, and turning one on is what sends the search looking.
**Attributes decide what is shown**, over results already found, so the list can only be what
the search has hit so far.

The results and the messages share one box and read in
the order things happened — the line saying what is being looked for, then the results, then
whatever the run had to say afterwards.

Counters and a cycling cursor across the top say how far it has read, out of how many, and
that it is still going:

```
Scanned 4200 of 18300 entities (Images)  ·  37 matches  ·  37 on screen
Scenes 1200/1200  ·  Galleries 0/0  ·  Images 3000/17000  ·  Tags 0/100
```

The first line says how far the whole search has got; the second says **where** it is. On a
library whose Images outnumber everything else, that is the difference between a number that
seems to have stopped and one that is working through the biggest type.

The totals are read once before the first page and cover only the types you turned on, so
they mean the same thing from the first page to the last. A type this Stash has none of the
searched fields on is left out of the breakdown — the log says it was skipped.

## Pausing, and the list on screen

- **Search** becomes **Pause** while it runs and **Resume** after, so a long search can be
  stopped and picked up rather than started again. Resume carries on from the page it
  stopped at; nothing is read twice.
- When the list on screen is full it **pauses itself** and the button reads **Continue**,
  which clears the screen and carries on.
- **Copy log** hands over the counters, the messages and every result the attribute filters
  leave, as plain text — including the ones the screen no longer shows. A filter is a choice
  about what you are looking at, so it is honoured; the buffer is not a choice, so it is not.
- **Refresh** throws away what this search has found and starts it again from the
  beginning, with whatever the box now says. It only appears while the other button has
  become Pause, Resume or Continue — those are the states where **Search** carries the
  current search *on* and there is no other way to say *start over*. When that button
  already says Search, Refresh would do the same thing, so it is not offered.
- **Cancel**, or the Escape key, closes it. Once a search has run out it reads **Close**
  instead — the same button, saying which of the two pressing it now means.

The **×** at the right-hand end of the box empties it. It is there only while there is
something to empty.

## Remembering

Two things the dialog can keep, both off until you ask for them, and both in **this browser**
rather than on the server:

- **Remember filters** — the entity types you turned on come back the next time it is opened.
- **Recent searches kept** — how many previous searches the **box itself** offers back as you
  type, the way the other boxes in these plugins do. Setting it to **zero** keeps none, and is
  also what throws away the ones already kept. The **Replace by** box keeps its own list of
  the same size: one number to answer, two lists, because offering a replacement back in the
  search box would suggest a value that has never been typed there.

**Replace itself is never remembered.** It is off every time the dialog opens. "Remember
filters" keeps the types, which decide what is *read*; whether a write is on offer at all is
the one default worth being conservative about.

Neither is a plugin setting, and neither writes anything: they live in the browser's own
storage. A private window, or a browser set to block site data, simply remembers nothing.

## Replacing

**Back up your database before the first replace.** This rewrites text across your library.

Tick **Replace** and a second line appears: what to put in place of the text you searched
for. The tick is only available once the box above says what to look for - a replacement
replaces what a search found, so there is nothing for it to offer before that. The **Replace** button then rewrites every entity on the list — so **the list you are
looking at is the plan**. There is no second review dialog, because the list already names
every entity, which attributes matched and how many times each; putting a plan in front of a
plan would say nothing new.

Three things follow from that, and all three are worth knowing before the first press:

Every entity it rewrites gets its own **`[EDIT]`** line in the log, naming the entity and which
attributes were rewritten. It is the only kind of line that says something in your library
changed — everything else the dialog writes is about the run — so a long log can be read for the
writes alone.

- **The attribute filters narrow what a press covers.** Turn Details off and a scene that
  matched in Title and Details is still on the list as a Title match — and only its title is
  rewritten. The button's tooltip always says how many entities a press covers.
- **Matching follows Case-sensitive, and the replacement goes in exactly as typed.** With
  the box unticked — the default — `beach` finds `Beach day`, and replacing with `shore`
  leaves `shore day`; ticked, only `beach` exactly as typed is found. A replacement acts on
  the setting the *search* ran with, which is what makes the list on screen the plan.
  Guessing that a capitalised match wanted a capitalised replacement is a rule nobody asked
  for, and a wrong guess is a wrong word in your library.
- **An empty box deletes the text it finds.** That is a thing to want, so it is allowed; a
  replacement that is *the same* as what you searched for is refused, because it would
  change nothing.

While a replacement is running, **Stop** is the only way out of the dialog — the exit and
Escape are both unavailable, because closing would leave the mutations running with nothing
on screen and take Undo's records with them. Stop finishes the batch already in flight and
leaves everything it wrote in place, still reachable by **Undo**; what it did not reach is
simply not written. An Undo can be stopped the same way, and what it did not put back stays
on the pile, so pressing Undo again carries on.

A field whose text contains a character whose lower case is *longer than itself* — a handful
exist, such as `İ` — cannot be matched case-insensitively without the positions in it
pointing at the wrong characters, so it is skipped and the log says how many were. Tick
**Case-sensitive** to search those exactly as typed.

A custom field **name** that matches is renamed, carrying its value across; a custom field
**value** that matches is updated in place. List fields — aliases, URLs — are replaced
element by element.

Every entity is **re-read immediately before it is rewritten**: the values the search found
are as old as the search, which on a large library is minutes. And every field is checked
against the update input your Stash actually has, so a field it spells differently is left
alone with a line saying so, rather than failing that entity's whole write.

**Undo** puts back what the press changed, field by field, while the dialog stays open. It
is an exact per-field inverse, not a restore of the whole record, so an unrelated edit made
in between is not reverted. The list on screen still describes what was found *before* the
write — press **Refresh** to search again.

While it writes it takes the shared bulk lease, so the other ᝯㄝₓ plugins' automatic modes
stand down for it.

## Nothing is written until you ask

With **Replace** off this is a read of your library and a list of links: there is no undo
because there is nothing to undo, and the head says so where a writing dialog would tell you
to back up first. Ticking Replace swaps that sentence for the backup one, which is the only
honest thing either of them can say in the other's state.

Either way it does note in its head when another ᝯㄝₓ plugin is rewriting the library while
you search, since a result may then be a moment behind.

## Matching

A plain substring. A short word matches inside longer ones — "sea" inside "season" — which is
why the text around every result is on the line: so you can see which it was.

**Case-sensitive** is off by default, which is what every search here has always done: `beach`
also finds `Beach`. Tick it and the text must match exactly as typed. Three things follow:

- It applies to a **replacement** as well, which finds what the search found.
- A search reads it when it **starts**, so changing it takes effect on the next search — and a
  Replace pressed afterwards still matches the way the search that drew the list did. The list is
  the plan, and a press that matched on different terms would not be acting on it.
- It is locked while a search is running, like the entity types and for the same reason: the run
  already has its answer, so a control left live there would look like it steers something it
  cannot reach.

**It is remembered**, in this browser, without needing **Remember filters** on — that box keeps
the entity types, and somebody who wants case-sensitive matching usually wants it every search.

## Why it reads everything

There is no server-side filter that can answer "does any text field of any type contain this
string". Each type's filter names its own fields, so a query would have to be built per type
and OR-ed across fields; and custom fields can only be filtered by naming the key up front,
with no way to ask for whichever keys an entity happens to carry. So the rows come back and
the matching happens in the browser, one page of one type at a time, with counters and a
Pause.

Turning off the types you do not need is the way to make it quick — which is why they all
start off.

## No settings

There are none, on purpose. Every choice this plugin offers — what to look for, which types
to read, what to replace with, what to remember — is made inside the dialog, where you
already are. Its group on the settings page carries the description and nothing else.

## Installing

Copy the `FindEntitiesByTextContent` folder into your Stash plugins directory
(`<stash-config-dir>/plugins/`) and press **Reload plugins** in Settings → Plugins.

## Troubleshooting

**The task button does nothing.** The click is handled in the browser — there is no
server-side job behind it. If Stash instead shows an "added job to queue" toast, the page is
running a script that does not recognise the button; reload with Ctrl+Shift+R.

**A red banner says the page is running an older script.** Stash serves plugin JS with
caching on, so the browser can still be running the file it fetched before the update. Press
Ctrl+Shift+R (⌘+Shift+R on a Mac).

**A red Reload UI button appears beside Stash's own Reload plugins** while any ᝯㄝₓ plugin's script is out of date, at the top of Settings → Plugins. Pressing it reloads the page, which is the whole fix: **Reload plugins** re-reads the plugin folder on the server and cannot replace a script this page has already run. Any other Stash tab you have open needs the same. **The same red button is in every dialog's own stale banner**, so a warning found while a dialog is open can be acted on where it is read.

**A type is skipped with a warning.** Your Stash has none of the text fields this plugin
looks for on that type. That is the introspection check doing its job rather than a failure;
the other types are searched normally.
