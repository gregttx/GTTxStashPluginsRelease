# Memory high watermark

What each task holds in the browser, measured against a synthetic library of 100,000 scenes and 1,000,000 images (20,000 galleries, 5,000 performers, 2,000 tags, 300 studios, 1,000 groups, 20,000 markers), with every task set to cover the whole library and plan as much as it can.

MB of JavaScript heap above what the page held before the task opened, read after a full garbage collection: **scan** is the highest point while it reads and plans, **plan** what the listed plan holds, **write** the highest point while Proceed writes, **undo** what is held afterwards with Undo on offer, **closed** what is left once the dialog is closed. Measured in Node's V8, the engine Chrome uses, not in a browser. The dialog's DOM is the test harness's, at about 370 bytes a node, close to what a browser spends on one; a browser's own overhead for the page and the plugins' code is not in these numbers. Each pass is recorded in Undo History as it would be in a browser - what the pass collects and the writing of it are counted, while the rows IndexedDB keeps, which a browser holds outside this heap, are not.

| Plugin | Task | scan | plan | write | undo | closed | scan time | write time |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| SceneFilenameManager 1.5.4 | Archive Original Filenames | 114.0 | 114.0 | 157.4 | 157.3 | 0.6 | 3.0 s | 3.4 s |
| SceneFilenameManager 1.5.4 | Restore Original Filenames | 55.6 | 55.6 | 81.8 | 81.7 | 0.5 | 2.0 s | 1.7 s |
| SceneFilenameManager 1.5.4 | Rename Files From Metadata | 194.1 | 194.1 | 253.1 | 253.1 | 0.8 | 11.3 s | 8.0 s |
| SceneVariants 2.6.0 | Migrate Variant Stash-IDs | 58.4 | 58.4 | 91.7 | 90.8 | 1.2 | 2.9 s | 6.7 s |
| SceneVariants 2.6.0 | Flag Variants | 46.0 | 46.1 | 86.1 | 81.2 | 1.3 | 3.8 s | 8.9 s |
| SceneVariants 2.6.0 | Review Variant Sets | 1949.1 | 1949.1 | - | - | 1.3 | 66.7 s | - |
| SceneVariants 2.6.0 | Rename Variants | 634.8 | 627.8 | 664.3 | 663.7 | 1.6 | 50.1 s | 5.6 s |
| CustomFieldsBulkEditor 3.5.7 | Edit Custom Fields Across the Whole Library | 551.2 | 551.1 | 1149.0 | 1149.0 | -0.5 | 27.7 s | 54.6 s |
| CustomFieldsBulkEditor 3.5.7 | Manage Custom Field Descriptions and Locks | 213.6 | 213.5 | 311.4 | 311.4 | 0.5 | 5.4 s | 12.0 s |
| FindEntitiesByTextContent 3.6.1 | Find & Replace Entities by Text Content | 782.7 | 782.8 | 1738.9 | 1537.5 | 0.8 | 123.3 s | 312.2 s |
| NormalizeParentTags 5.6.3 | Normalize Parent Tags | 3817.7 | 3817.4 | 4180.6 | 4079.5 | -0.2 | 427.4 s | 619.5 s |
| NormalizeParentTags 5.6.3 | Auto Mode Settings | 0.1 | 0.1 | - | - | 0.1 | 0.5 s | - |
| NormalizeParentTags 5.6.3 | Show Tag Hierarchy | 14.9 | 14.9 | - | - | 0.3 | 1.0 s | - |
| MergePerformerTagsToScenes 4.2.2 | Merge Performer Tags into All Their Scenes | 269.9 | 268.4 | 293.3 | 282.4 | 0.6 | 23.6 s | 23.3 s |
| PropagateTagsAndPerformers 5.3.4 | Propagate All | 1776.8 | 1776.8 | 1819.2 | 1802.0 | 0.8 | 169.3 s | 130.2 s |

## Against the baseline

**Accepted** as the baseline, with these changes from the one before it:

| Task | Marker | Baseline | Now | Change |
|---|---|--:|--:|---|
| CustomFieldsBulkEditor / Edit Custom Fields Across the Whole Library | closed | 0.6 | -0.5 | -1.1 MB |

## What each task planned and wrote

- **SceneFilenameManager / Archive Original Filenames** - Every scene; half have no archived name. Scanned 100000 of 100000 scenes. 100000 scenes to archive. showing the last 1000 of 110001 lines. Then: Scanned 100000 of 100000 scenes. 100000 scenes to archive. 100000 written. showing the last 1000 of 210001 lines. (1204 requests)
- **SceneFilenameManager / Restore Original Filenames** - Every scene whose archived name differs from its file's. Scanned 100000 of 100000 scenes. 50000 files to rename. showing the last 1000 of 60001 lines. Then: Scanned 100000 of 100000 scenes. 50000 files to rename. 50000 written. showing the last 1000 of 110001 lines. (704 requests)
- **SceneFilenameManager / Rename Files From Metadata** - The default template, which has an index, so every file of every scene. Scanned 100000 of 100000 scenes. 110000 files to rename. showing the last 1000 of 120005 lines. Then: Scanned 100000 of 100000 scenes. 110000 files to rename. 110000 written. showing the last 1000 of 230005 lines. (2106 requests)
- **SceneVariants / Migrate Variant Stash-IDs** - Every scene carries a duration tag; four in five have a stash-id, shared in threes. Scanned 100000 of 100000 tagged scenes. 80000 scenes to migrate. showing the last 1000 of 80002 lines. Then: Scanned 100000 of 100000 tagged scenes. 80000 scenes to migrate. 80000 scenes written. showing the last 1000 of 160003 lines. (80207 requests)
- **SceneVariants / Flag Variants** - Variant triples across the library, none flagged yet. Scanned 100000 scenes. 99999 scenes to flag or unflag. showing the last 1000 of 100002 lines. Then: Scanned 100000 scenes. 99999 scenes to flag or unflag. 99999 scenes written. showing the last 1000 of 200003 lines. (100208 requests)
- **SceneVariants / Review Variant Sets** - Every variant set listed; no library-wide write exists. Scanned 100000 scenes. 33333 variant sets found. 0 changes listed. (408 requests)
- **SceneVariants / Rename Variants** - Renumber by duration on, every proposal selected. Scanned 100000 scenes. 33333 variant sets found. 57692 renames proposed. showing the last 1000 of 62182 lines. Then: Scanned 100000 scenes. 33333 variant sets found. 57692 renames proposed. 57692 renames written. showing the last 1000 of 119875 lines. (58100 requests)
- **CustomFieldsBulkEditor / Edit Custom Fields Across the Whole Library** - Overwrite one field with a new value on every entity of all seven types. 1128300 entities read, 205000 with custom fields, 275000 fields in total, 1198300 lines listed. Apply covers 1128300 entities. Then: Applied. 1128300 entity changes written (13799 requests)
- **CustomFieldsBulkEditor / Manage Custom Field Descriptions and Locks** - One field, held by every scene and performer and one image in ten, renamed. 4 custom fields, 1 described, 1 unsaved change Then: 4 custom fields, 1 described, no unsaved changes - last Apply written (14438 requests)
- **FindEntitiesByTextContent / Find & Replace Entities by Text Content** - All seven types, searching "e" - in nearly every text - and replacing every match. Scanned 1128300 of 1128300 entities · 881274 matches · 0 on screen · finished Scenes 100000/100000 · Images 1000000/1000000 · Galleries 20000/20000 · Performers (901169 requests)
- **NormalizeParentTags / Normalize Parent Tags** - Roll Up on all seven types, over a tag tree five levels deep. Review complete. 1146296 entity changes planned, 9847213 log lines - showing the last 1000 of 9847213 lines Performers 5000 / 5000 Studios 300 / 300 Groups 1000 Then: Finished. 1146296 entity changes applied - showing the last 1000 of 19694426 lines Performers 5000 / 5000 Studios 300 / 300 Groups 1000 / 1000 Galleries 20000 / (1017644 requests)
- **NormalizeParentTags / Auto Mode Settings** - The dialog opened; it reads nothing. no counters (2 requests)
- **NormalizeParentTags / Show Tag Hierarchy** - Every tag expanded, with its counts loaded. 2000 tags, 20 roots. 2000 rows shown - click a tag for what Prune and Roll Up would do with it. (4 requests)
- **MergePerformerTagsToScenes / Merge Performer Tags into All Their Scenes** - Every performer's tags onto every scene of theirs. Review complete. 100000 scenes to update, 1192070 tag assignments to add. Nothing has been written. - showing the last 1000 of 300004 lines Then: Finished. 100000 scenes updated, 1192070 tag assignments added - showing the last 1000 of 400008 lines (100518 requests)
- **PropagateTagsAndPerformers / Propagate All** - Every path, one direction of each reversible pair, union rather than common. Review complete. 221000 entity changes planned, 2724690 log lines - showing the last 1000 of 2724690 lines Images 1: 1000000 / 1000000 Galleries 1: 20000 / 2000 Then: Finished. 221000 entity changes applied - showing the last 1000 of 5449369 lines Images 1: 1000000 / 1000000 Galleries 1: 20000 / 20000 Scenes 1: 100000 / 10000 (145196 requests)

## What the synthetic server could not answer

Answered with null, or matching everything; where a task depends on one, its numbers understate what a real Stash would cost: `field studio.organized`.

<sub>Fingerprint 93d4560aa7b4d358 (the plugins, the harness and this tool). Generated by `node .tools/memory-watermark.js`.</sub>
