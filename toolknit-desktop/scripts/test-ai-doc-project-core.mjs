import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AiDocProjectError,
  applyAiDocProjectOperations,
  createAiDocProjectFromLayout,
  inspectAiDocProject,
  normalizeAiDocProject,
  projectToAiDocLayout,
  validateAiDocProject
} from '../src/ai-doc-project-core.js';

let idSequence = 0;
const createId = kind => `${kind}-${++idSequence}`;
const initialTime = '2026-08-02T00:00:00.000Z';
const nextTime = '2026-08-02T01:00:00.000Z';
const layout = {
  ready: true,
  summary: 'Stable editable document',
  pages: [
    { regions: [
      { type: 'title', x: 56, y: 60, w: 682, h: 52, text: 'Title', fontSize: 30, bold: true, align: 'center' },
      { type: 'body', x: 56, y: 140, w: 682, h: 80, text: 'Body copy', fontSize: 14, bold: false, align: 'left' },
      { type: 'table-row', x: 56, y: 250, w: 682, h: 44, text: 'Name | Value', fontSize: 13, bold: true, align: 'left' }
    ] },
    { regions: [
      { type: 'section-heading', x: 56, y: 60, w: 682, h: 36, text: 'Second page', fontSize: 18, bold: true, align: 'left' }
    ] }
  ]
};

const project = createAiDocProjectFromLayout(layout, {
  createId,
  now: initialTime,
  locale: 'en',
  title: 'Project contract'
});
assert.equal(project.schema, 'toolknit.ai-document');
assert.equal(project.schemaVersion, 1);
assert.equal(project.revision, 1);
assert.deepEqual(project.pages.flatMap(page => page.controls.map(control => control.number)), ['P1-01', 'P1-02', 'P1-03', 'P2-01']);

const grouped = applyAiDocProjectOperations(project, [
  { type: 'group_controls', controls: ['P1-01', 'P1-02'], group: 'hero-group' }
], { now: nextTime }).project;
assert.equal(grouped.pages[0].controls[0].groupId, 'hero-group');
assert.equal(grouped.pages[0].controls[1].groupId, 'hero-group');
const ungrouped = applyAiDocProjectOperations(grouped, [
  { type: 'ungroup_controls', group: 'hero-group' }
], { now: nextTime }).project;
assert.equal(ungrouped.pages[0].controls[0].groupId, undefined);
assert.equal(ungrouped.pages[0].controls[1].groupId, undefined);

const positioned = applyAiDocProjectOperations(project, [
  { type: 'move', control: 'P1-01', x: 100, y: 300, layoutMode: 'absolute' },
  { type: 'resize', control: 'P1-01', w: 240, h: 100 },
  { type: 'move', control: 'P1-02', x: 150, y: 320, layoutMode: 'absolute' },
  { type: 'resize', control: 'P1-02', w: 240, h: 100 },
  { type: 'align_controls', controls: ['P1-01', 'P1-02'], anchor: 'P1-01', alignment: 'left' }
], { now: nextTime }).project;
assert.equal(positioned.pages[0].controls[1].x, 100);
const resolved = applyAiDocProjectOperations(positioned, [
  { type: 'resolve_overlaps', controls: ['P1-01', 'P1-02'], direction: 'vertical', gap: 10 }
], { now: nextTime });
const resolvedFirst = resolved.project.pages[0].controls.find(control => control.number === 'P1-01');
const resolvedSecond = resolved.project.pages[0].controls.find(control => control.number === 'P1-02');
assert.equal(resolvedSecond.y, resolvedFirst.y + resolvedFirst.h + 10);
assert.equal(resolved.changes[0].moved, 1);

const originalSnapshot = JSON.stringify(project);
const edited = applyAiDocProjectOperations(project, [
  { type: 'update_text', control: 'P1-01', text: 'Updated title' },
  { type: 'update_style', control: 'P1-01', style: { backgroundColor: '#000000', textColor: '#ffffff', fontSize: 32, align: 'left' } },
  { type: 'swap_positions', first: 'P1-01', second: 'P1-02' },
  { type: 'insert_control', after: 'P1-02', control: { type: 'image', label: 'New image', x: 56, y: 330, w: 682, h: 220 } }
], { createId, now: nextTime });

assert.equal(JSON.stringify(project), originalSnapshot, 'Applying operations must not mutate the source project.');
assert.equal(edited.project.revision, 2);
assert.equal(edited.project.updatedAt, nextTime);
assert.equal(edited.changes.length, 4);
const updatedTitle = edited.project.pages[0].controls.find(control => control.number === 'P1-01');
assert.equal(updatedTitle.text, 'Updated title');
assert.equal(updatedTitle.style.backgroundColor, '#000000');
assert.equal(updatedTitle.style.textColor, '#FFFFFF');
assert.equal(updatedTitle.fontSize, 32);
assert.equal(updatedTitle.align, 'left');

const documentStyled = applyAiDocProjectOperations(edited.project, [
  { type: 'update_document_style', style: { align: 'right', textColor: '#112233', lineHeight: 1.7 }, types: ['body', 'table-row'] }
], { now: nextTime });
const styledBody = documentStyled.project.pages[0].controls.find(control => control.number === 'P1-02');
const styledTable = documentStyled.project.pages[0].controls.find(control => control.number === 'P1-03');
assert.equal(styledBody.align, 'right');
assert.equal(styledBody.style.textColor, '#112233');
assert.equal(styledBody.style.lineHeight, 1.7);
assert.equal(styledTable.align, 'right');
assert.equal(documentStyled.changes[0].changed.length, 2);
assert.deepEqual(edited.project.pages[0].controls.map(control => control.number), ['P1-02', 'P1-04', 'P1-01', 'P1-03']);
assert.equal(edited.project.pages[0].controls[2].id, project.pages[0].controls[0].id, 'A stable number and id must follow the control when positions change.');

const layoutRoundTrip = projectToAiDocLayout(edited.project);
const titleRegion = layoutRoundTrip.pages[0].regions.find(region => region.controlNumber === 'P1-01');
assert.equal(titleRegion.controlId, updatedTitle.id);
assert.equal(titleRegion.editorId, updatedTitle.id);
assert.equal(titleRegion.style.textColor, '#FFFFFF');

const inspection = inspectAiDocProject(edited.project);
assert.equal(inspection.pages[0].controls[0].number, 'P1-02');
assert.equal(inspection.pages[0].controls[1].number, 'P1-04');
assert.equal(inspection.revision, 2);

const locked = applyAiDocProjectOperations(edited.project, [
  { type: 'lock_control', control: 'P1-01', locked: true }
], { now: nextTime }).project;
assert.throws(
  () => applyAiDocProjectOperations(locked, [{ type: 'update_text', control: 'P1-01', text: 'Blocked' }]),
  error => error instanceof AiDocProjectError && error.code === 'control_locked' && error.details.operationIndex === 0
);
const unlocked = applyAiDocProjectOperations(locked, [
  { type: 'lock_control', control: 'P1-01', locked: false },
  { type: 'resize', control: 'P1-01', w: 500, h: 100 },
  { type: 'move', control: 'P1-01', x: 100, y: 400, layoutMode: 'absolute' }
], { now: nextTime }).project;
assert.equal(unlocked.pages[0].controls.find(control => control.number === 'P1-01').layoutMode, 'absolute');

const invalidAtomicSource = JSON.stringify(unlocked);
assert.throws(
  () => applyAiDocProjectOperations(unlocked, [
    { type: 'update_text', control: 'P1-02', text: 'Would have changed' },
    { type: 'update_text', control: 'missing', text: 'Failure' }
  ]),
  error => error instanceof AiDocProjectError && error.code === 'control_not_found' && error.details.operationIndex === 1
);
assert.equal(JSON.stringify(unlocked), invalidAtomicSource, 'A failed batch must be atomic.');

const deleted = applyAiDocProjectOperations(unlocked, [{ type: 'delete_control', control: 'P1-04' }], { now: nextTime }).project;
assert.equal(deleted.pages[0].controls.some(control => control.number === 'P1-04'), false);
assert.throws(
  () => applyAiDocProjectOperations(deleted, [{ type: 'insert_control', page: 9, control: { type: 'body', text: 'Bad page' } }]),
  error => error instanceof AiDocProjectError && error.code === 'invalid_operation'
);

const diagnosticProject = normalizeAiDocProject({
  ...deleted,
  pages: deleted.pages.map((page, pageIndex) => pageIndex ? page : ({
    ...page,
    controls: page.controls.map((control, index) => index === 0
      ? { ...control, layoutMode: 'absolute', x: 760, y: 1100, w: 100, h: 100, style: { backgroundColor: '#FFFFFF', textColor: '#F8F8F8' } }
      : control)
  }))
});
const diagnostics = validateAiDocProject(diagnosticProject);
assert.ok(diagnostics.some(item => item.code === 'control_out_of_bounds'));
assert.ok(diagnostics.some(item => item.code === 'low_contrast'));

assert.throws(
  () => normalizeAiDocProject({ ...deleted, unsupported: true }),
  error => error instanceof AiDocProjectError && error.code === 'invalid_project'
);
const projectSchema = JSON.parse(await readFile(new URL('../docs/ai-document-project.schema.json', import.meta.url), 'utf8'));
assert.equal(projectSchema.properties.schema.const, 'toolknit.ai-document');
assert.equal(projectSchema.properties.schemaVersion.const, 1);

console.log('AI document project core checks passed');
