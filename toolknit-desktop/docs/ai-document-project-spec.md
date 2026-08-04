# ToolKnit AI Document Project Specification

Status: v1, ToolKnit 1.2

## Purpose

A ToolKnit AI document project is the editable source of truth for a generated PDF. The PDF and PNG files are derived artifacts. Agents must inspect and edit the project through ToolKnit tools instead of modifying JSON or PDF bytes directly.

ToolKnit guarantees editing only for projects it created. Importing an arbitrary external PDF into this semantic control model is outside v1.

## Artifact bundle

For an output named `document.pdf`, ToolKnit publishes this bundle on the same volume:

```text
document.pdf
document.toolknit.json
document.toolknit/
  assets/
  preview/page-01.png
  demo/controls-overview.png
  demo/page-01-controls.png
  demo/page-02-controls.png
  revisions/revision-0001.json
```

Each `page-XX-controls.png` is a high-resolution, full-page numbered map and is the preferred artifact for IDE editing. `controls-overview.png` is a single-column index for browsing, not the primary precision-editing image. MCP creation and inspection results return absolute paths for every per-page map so an IDE can expose them directly in its file tree.

For an IDE request such as "save in this project," the Agent resolves the active workspace root and passes an absolute output path under `<workspace>/toolknit-output/`. ToolKnit may create that directory, but it never guesses the IDE workspace from the MCP process working directory.

Publication is staged before any target is replaced. A failed publication restores the previous artifacts. Creation refuses existing targets unless overwrite was explicitly enabled. An edit is an authorized update of its own bundle and always preserves a revision snapshot.

## Identity

Every page and control has an internal stable `id`. Every control also has a stable human-facing `number`, such as `P1-01`.

- Agents should show and accept the human-facing number.
- The number belongs to the control. It does not change when positions are swapped.
- The `P1` prefix records the page on which the control was created. After a cross-page move or reflow, it does not claim that the control is still on physical page 1.
- New controls receive the next unused number for their insertion page. Deleted numbers are not reused.
- Internal ids and public numbers must be unique across the project.

## Layout

The v1 page coordinate system is 794 by 1123 pixels and maps to A4. Coordinates begin at the top-left.

`layoutMode: "flow"` places controls in array order and lets the renderer calculate final vertical positions and heights. This is the default and is preferred for prose, tables, and edits that may change text length.

`layoutMode: "absolute"` uses explicit `x`, `y`, `w`, and `h`. It is intended for controlled overlays and fixed compositions. Text in an undersized absolute box may produce a `text_may_overflow` diagnostic.

## Style

Colors use six-digit hexadecimal notation. A `null` color removes an override and restores the renderer default.

Supported style fields are:

```json
{
  "fontSize": 16,
  "bold": true,
  "align": "left",
  "textColor": "#FFFFFF",
  "backgroundColor": "#000000",
  "borderColor": "#111111",
  "borderWidth": 1,
  "dividerColor": "#111111",
  "dividerWidth": 2,
  "padding": 12,
  "opacity": 1,
  "lineHeight": 1.5
}
```

`dividerColor` and `dividerWidth` control table cell separators and divider controls. `fontSize`, `bold`, and `align` are stored as control typography fields even though they are supplied through `update_style`.

## Edit operations

An edit request contains one to 100 operations. The complete batch is atomic. Unknown fields, missing controls, locked controls, invalid colors, or invalid geometry reject the whole batch.

```json
[
  { "type": "update_text", "control": "P1-01", "text": "New title" },
  { "type": "update_style", "control": "P1-01", "style": { "backgroundColor": "#000000", "textColor": "#FFFFFF" } },
  { "type": "update_document_style", "style": { "align": "left", "lineHeight": 1.65 }, "types": ["body", "body-indent", "list-item"] },
  { "type": "swap_positions", "first": "P1-01", "second": "P1-02" },
  { "type": "move", "control": "P1-03", "x": 80, "y": 420, "layoutMode": "absolute" },
  { "type": "resize", "control": "P1-03", "w": 500, "h": 180 },
  { "type": "group_controls", "controls": ["P1-03", "P1-04"], "group": "summary-block" },
  { "type": "align_controls", "controls": ["P1-03", "P1-04"], "anchor": "P1-03", "alignment": "left" },
  { "type": "lock_control", "control": "P1-01", "locked": true }
]
```

`swap_positions` exchanges placement and flow order, not content or identity.

`update_document_style` applies one style rule atomically across the document. With no `types`, it targets unlocked text controls and deliberately skips images, dividers, page headers, and page footers. Supplying `types` limits the rule to the listed control types. It is intended for explicit requests such as “make the whole body left aligned” or “set all table rows to a white background”; it never guesses which kinds of content a global request should include.

`group_controls` assigns a shared group id without merging control identity. `ungroup_controls` accepts either explicit controls or a group id. `align_controls` aligns all listed controls to a listed anchor; vertical alignment changes those controls to absolute layout. `resolve_overlaps` deterministically moves selected absolute controls vertically or horizontally until they no longer intersect, using an optional gap. The result is still subject to page-boundary validation.

Image insertion reads a local PNG or JPEG. Source bytes never enter tool results or revision operations. ToolKnit copies the image into the project, records its dimensions and SHA-256 digest, and verifies the digest before each render.

The external `source_path` must be absolute, point to a regular decodable file, and be no larger than 10 MB. An image insertion without `source_path`, a relative path, base64 data, and unsupported formats are rejected instead of creating a silent placeholder. IDE Agents resolve project-relative user phrases against the active workspace before calling ToolKnit.

```json
[
  {
    "type": "insert_control",
    "after": "P1-02",
    "control": {
      "type": "image",
      "source_path": "D:\\Images\\diagram.png",
      "label": "Architecture diagram",
      "w": 520,
      "h": 260
    }
  }
]
```

Undo must be the only operation in its request:

```json
[{ "type": "undo", "steps": 1 }]
```

Undo restores an earlier snapshot as a new revision. It never deletes history and can therefore be audited or reversed.

`delete_control` removes exactly one referenced unlocked control. It cannot leave a page empty. Deleted display numbers are not reused and surviving controls are not renumbered. Asset records remain available because earlier revisions and undo may still reference them.

## Validation and dry run

`dry_run=true` applies the complete batch in memory, renders final geometry, and returns the proposed revision, change list, and diagnostics without writing any artifact.

Diagnostic codes currently include:

- `control_out_of_bounds`
- `controls_overlap`
- `text_may_overflow`
- `low_contrast`
- `low_resolution_image`
- `page_count_changed`

`page_count_changed` is blocking. Creation, edit, undo, and deterministic re-render must preserve the project's exact logical page count. An Agent should reduce or move content and dry-run again instead of silently publishing an extra page.

Agents must report diagnostics before committing. They must not silently remove or reinterpret an operation to make validation pass.

## Required Agent workflow

1. Inspect the project and identify targets by stable number.
2. Construct the smallest structured operation batch that exactly matches the request.
3. Dry-run that batch.
4. Report the changes and diagnostics.
5. Commit the same batch only when execution is authorized.
6. Report the new revision and all output paths.
7. Re-inspect when a later instruction refers to a changed document.

Agents must not edit `.toolknit.json`, revision JSON, assets, generated PDF bytes, or preview PNGs directly.

## Security and privacy

- AI provider keys are read only from the MCP or CLI process environment.
- Keys are forbidden in prompts, operation arguments, paths, project files, revisions, logs, and results.
- Project paths and image paths are validated as regular files; symbolic links are rejected at trust boundaries.
- Asset paths stored in a project are relative and cannot contain parent traversal.
- Existing output is never silently replaced during creation.

## Compatibility

The root fields `schema: "toolknit.ai-document"` and `schemaVersion: 1` are mandatory. A reader must reject unsupported versions instead of guessing. The normative project shape is published in `ai-document-project.schema.json`.
