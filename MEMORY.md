# Memory high watermark

What each task holds in the browser, measured against a synthetic library of 100,000 scenes and 1,000,000 images (20,000 galleries, 5,000 performers, 2,000 tags, 300 studios, 1,000 groups, 20,000 markers), with every task set to cover the whole library and plan as much as it can.

MB of JavaScript heap above what the page held before the task opened, read after a full garbage collection: **scan** is the highest point while it reads and plans, **plan** what the listed plan holds, **write** the highest point while Proceed writes, **undo** what is held afterwards with Undo on offer, **closed** what is left once the dialog is closed. Measured in Node's V8, the engine Chrome uses, not in a browser. The dialog's DOM is the test harness's, at about 370 bytes a node, close to what a browser spends on one; a browser's own overhead for the page and the plugins' code is not in these numbers.

| Plugin | Task | scan | plan | write | undo | closed | scan time | write time |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| SceneFilenameManager 1.0.0 | Archive Original Filenames | 58.1 | 58.2 | 78.6 | 78.0 | 0.4 | 2.0 s | 1.6 s |
| SceneFilenameManager 1.0.0 | Restore Original Filenames | 49.3 | 49.4 | 68.7 | 68.8 | 0.1 | 1.6 s | 1.3 s |
| SceneFilenameManager 1.0.0 | Rename Files From Metadata | 154.0 | 154.1 | 184.8 | 183.0 | 0.4 | 9.3 s | 3.3 s |
| SceneVariants 1.21.4 | Migrate Variant Stash-IDs | 58.3 | 58.4 | 73.4 | 72.6 | 0.9 | 2.5 s | 4.9 s |
| SceneVariants 1.21.4 | Flag Variants | 45.8 | 45.9 | 64.1 | 58.4 | 0.7 | 3.1 s | 7.2 s |
| SceneVariants 1.21.4 | Review Variant Sets | 1936.3 | 1936.3 | - | - | -0.2 | 53.1 s | - |
| SceneVariants 1.21.4 | Rename Variants | 628.8 | 622.3 | 634.8 | 634.9 | 1.0 | 44.3 s | 4.2 s |
| CustomFieldsBulkEditor 3.3.2 | Edit Custom Fields Across the Whole Library | 551.0 | 551.0 | 1064.8 | 1064.8 | -1.0 | 25.5 s | 28.7 s |
| CustomFieldsBulkEditor 3.3.2 | Manage Custom Field Descriptions | 213.4 | 213.4 | 266.7 | 266.7 | 0.1 | 4.6 s | 4.2 s |
| FindEntitiesByTextContent 3.2.5 | Find & Replace Entities by Text Content | 768.8 | 768.8 | 1524.0 | 1517.4 | 0.4 | 110.6 s | 241.9 s |
| NormalizeParentTags 5.5.6 | Normalize Parent Tags | 3813.4 | 3813.3 | 4155.4 | 4052.5 | -0.9 | 383.4 s | 576.6 s |
| NormalizeParentTags 5.5.6 | Auto Mode Settings | 0.1 | 0.1 | - | - | 0.0 | 0.4 s | - |
| NormalizeParentTags 5.5.6 | Show Tag Hierarchy | 14.8 | 14.8 | - | - | 0.2 | 0.9 s | - |
| MergePerformerTagsToScenes 4.1.5 | Merge Performer Tags into All Their Scenes | 271.3 | 268.3 | 294.2 | 281.5 | 0.4 | 24.9 s | 17.3 s |
| PropagateTagsAndPerformers 5.2.5 | Propagate All | 1776.5 | 1776.5 | 1821.8 | 1819.4 | -0.3 | 174.1 s | 152.4 s |

## Against the baseline

No marker moved by more than 15% or 8 MB. **Pass.**

## What each task planned and wrote

- **SceneFilenameManager / Archive Original Filenames** - Every scene; half have no archived name. Scanned 100000 of 100000 scenes. 60000 scenes to archive. showing the last 1000 of 60001 lines. Then: Scanned 100000 of 100000 scenes. 60000 scenes to archive. 60000 written. showing the last 1000 of 120001 lines. (804 requests)
- **SceneFilenameManager / Restore Original Filenames** - Every scene whose archived name differs from its file's. Scanned 100000 of 100000 scenes. 50000 files to rename. showing the last 1000 of 50001 lines. Then: Scanned 100000 of 100000 scenes. 50000 files to rename. 50000 written. showing the last 1000 of 100001 lines. (704 requests)
- **SceneFilenameManager / Rename Files From Metadata** - The default template, which has an index, so every file of every scene. Scanned 100000 of 100000 scenes. 110000 files to rename. showing the last 1000 of 110005 lines. Then: Scanned 100000 of 100000 scenes. 110000 files to rename. 110000 written. showing the last 1000 of 220005 lines. (2104 requests)
- **SceneVariants / Migrate Variant Stash-IDs** - Every scene carries a duration tag; four in five have a stash-id, shared in threes. Scanned 100000 of 100000 tagged scenes. 80000 scenes to migrate. showing the last 1000 of 80002 lines. Then: Scanned 100000 of 100000 tagged scenes. 80000 scenes to migrate. 80000 scenes written. showing the last 1000 of 160003 lines. (80206 requests)
- **SceneVariants / Flag Variants** - Variant triples across the library, none flagged yet. Scanned 100000 scenes. 99999 scenes to flag or unflag. showing the last 1000 of 100002 lines. Then: Scanned 100000 scenes. 99999 scenes to flag or unflag. 99999 scenes written. showing the last 1000 of 200003 lines. (100208 requests)
- **SceneVariants / Review Variant Sets** - Every variant set listed; no library-wide write exists. Scanned 100000 scenes. 33333 variant sets found. 0 changes listed. (408 requests)
- **SceneVariants / Rename Variants** - Renumber by duration on, every proposal selected. Scanned 100000 scenes. 33333 variant sets found. 57692 renames proposed. showing the last 1000 of 62182 lines. Then: Scanned 100000 scenes. 33333 variant sets found. 57692 renames proposed. 57692 renames written. showing the last 1000 of 119875 lines. (58100 requests)
- **CustomFieldsBulkEditor / Edit Custom Fields Across the Whole Library** - Overwrite one field with a new value on every entity of all seven types. 1128300 entities read, 205000 with custom fields, 275000 fields in total, 1198300 lines listed. Apply covers 1128300 entities. Then: Applied. 1128300 entity changes written (13798 requests)
- **CustomFieldsBulkEditor / Manage Custom Field Descriptions** - One field, held by every scene and performer and one image in ten, renamed. 4 custom fields, 1 described, 1 unsaved change Then: 4 custom fields, 1 described, no unsaved changes - last Apply written (14438 requests)
- **FindEntitiesByTextContent / Find & Replace Entities by Text Content** - All seven types, searching "e" - in nearly every text - and replacing every match. Scanned 1128300 of 1128300 entities · 881274 matches · 0 on screen · finished Scenes 100000/100000 · Images 1000000/1000000 · Galleries 20000/20000 · Performers (901168 requests)
- **NormalizeParentTags / Normalize Parent Tags** - Roll Up on all seven types, over a tag tree five levels deep. Review complete. 1146296 entity changes planned, 9847213 log lines - showing the last 1000 of 9847213 lines Performers 5000 / 5000 Studios 300 / 300 Groups 1000 Then: Finished. 1146296 entity changes applied - showing the last 1000 of 19694425 lines Performers 5000 / 5000 Studios 300 / 300 Groups 1000 / 1000 Galleries 20000 / (1017643 requests)
- **NormalizeParentTags / Auto Mode Settings** - The dialog opened; it reads nothing. no counters (2 requests)
- **NormalizeParentTags / Show Tag Hierarchy** - Every tag expanded, with its counts loaded. 2000 tags, 20 roots. 2000 rows shown - click a tag for what Prune and Roll Up would do with it. (4 requests)
- **MergePerformerTagsToScenes / Merge Performer Tags into All Their Scenes** - Every performer's tags onto every scene of theirs. Review complete. 100000 scenes to update, 1192070 tag assignments to add. Nothing has been written. - showing the last 1000 of 300004 lines Then: Finished. 100000 scenes updated, 1192070 tag assignments added - showing the last 1000 of 400007 lines (100517 requests)
- **PropagateTagsAndPerformers / Propagate All** - Every path, one direction of each reversible pair, union rather than common. Review complete. 221000 entity changes planned, 2724690 log lines - showing the last 1000 of 2724690 lines Images 1: 1000000 / 1000000 Galleries 1: 20000 / 2000 Then: Finished. 221000 entity changes applied - showing the last 1000 of 5449368 lines Images 1: 1000000 / 1000000 Galleries 1: 20000 / 20000 Scenes 1: 100000 / 10000 (145195 requests)

## What the synthetic server could not answer

Answered with null, or matching everything; where a task depends on one, its numbers understate what a real Stash would cost: `field studio.organized`.

<sub>Fingerprint d94f4a664a334fed (the plugins, the harness and this tool). Generated by `node tools/memory-watermark.js`.</sub>
