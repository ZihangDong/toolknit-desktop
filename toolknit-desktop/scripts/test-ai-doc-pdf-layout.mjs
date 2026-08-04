import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { buildAiDocPdf } from '../src/ai-doc-pdf-core.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const fontRoot = path.join(projectRoot, 'public', 'assets', 'fonts');
const [fontRegularBytes, fontBoldBytes] = await Promise.all([
  readFile(path.join(fontRoot, 'MiSans-Regular.ttf')),
  readFile(path.join(fontRoot, 'MiSans-Semibold.ttf'))
]);

function region(type, text, y, options = {}) {
  return {
    type,
    x: 56,
    y,
    w: 682,
    // These deliberately oversized model estimates used to create a third
    // physical page even when the model correctly returned two logical pages.
    h: options.h ?? 118,
    text,
    fontSize: options.fontSize ?? 14,
    bold: options.bold ?? false,
    align: options.align ?? 'left'
  };
}

const leaseLayout = {
  ready: true,
  summary: 'Two-page lease regression fixture',
  pages: [
    {
      regions: [
        region('title', '民用房屋租赁合同', 60, { h: 56, fontSize: 30, bold: true, align: 'center' }),
        region('subtitle', 'HOUSING LEASE AGREEMENT', 124, { h: 24, fontSize: 14, align: 'center' }),
        region('table-row', '合同编号 | 待确认 | 签订日期 | 待确认', 164, { h: 48, fontSize: 13 }),
        region('table-row', '甲方（出租方） | 董子航 | 乙方（承租方） | ToolKnit 的粉丝', 212, { h: 48, fontSize: 13 }),
        region('section-heading', '第一条 租赁期限', 282, { h: 36, fontSize: 18, bold: true }),
        region('body', '租赁期限、起止日期及房屋交付安排以双方书面确认内容为准。', 336),
        region('section-heading', '第二条 租金与支付方式', 480, { h: 36, fontSize: 18, bold: true }),
        region('body', '租金、押金、付款周期和收款账户由双方在签约时填写；未提供的信息均标注为待确认。', 534),
        region('section-heading', '第三条 房屋使用与维修', 678, { h: 36, fontSize: 18, bold: true }),
        region('body', '承租方应合理使用房屋及设施，维修责任按照法律规定和双方书面约定承担。', 732)
      ]
    },
    {
      regions: [
        region('section-heading', '第四条 费用与交接', 60, { h: 36, fontSize: 18, bold: true }),
        region('body', '水、电、燃气、网络和物业等费用按实际使用情况结算，交接时共同核验表计和房屋状况。', 114),
        region('section-heading', '第五条 违约责任', 258, { h: 36, fontSize: 18, bold: true }),
        region('body', '任一方违反约定造成损失的，应在法律允许范围内承担相应责任；具体金额和处理方式由双方协商确认。', 312),
        region('section-heading', '第六条 提前退租与续约', 456, { h: 36, fontSize: 18, bold: true }),
        region('body', '提前退租、续约和费用结算应提前书面沟通，避免影响下一步交接安排。', 510),
        region('section-heading', '第七条 其他约定', 654, { h: 36, fontSize: 18, bold: true }),
        region('body', '本合同一式两份，甲乙双方各执一份，自双方签字之日起生效。', 708),
        region('table-row', '甲方签字：董子航 | 日期：____年__月__日', 862, { h: 48, fontSize: 13, bold: true }),
        region('table-row', '乙方签字：ToolKnit 的粉丝 | 日期：____年__月__日', 910, { h: 48, fontSize: 13, bold: true })
      ]
    }
  ]
};

const rendered = await buildAiDocPdf({
  layout: leaseLayout,
  fontRegularBytes,
  fontBoldBytes,
  footerText: (current, total) => `第 ${current} 页 / 共 ${total} 页`
});
assert.equal(rendered.pageCount, 2, 'A two-page layout must not create a spill page from stale height estimates.');
assert.equal((await PDFDocument.load(rendered.bytes)).getPageCount(), 2);
assert.equal(rendered.renderedControls.length, 0);

const explicitlySizedProjectLayout = {
  ready: true,
  summary: 'Explicit agent resize regression fixture',
  pages: [{
    regions: [
      { ...region('body', '保留由 Agent 明确设置的空白高度。', 60, { h: 620 }), controlId: 'P1-01' },
      { ...region('body', '第二个控件必须进入新页，不能因为自动紧凑逻辑而与前一控件重叠。', 692, { h: 420 }), controlId: 'P1-02' }
    ]
  }]
};
const explicitlySized = await buildAiDocPdf({
  layout: explicitlySizedProjectLayout,
  fontRegularBytes,
  fontBoldBytes
});
assert.equal(explicitlySized.pageCount, 2, 'Explicit CLI/Agent control heights must remain authoritative.');

if (process.env.TOOLKNIT_AI_DOC_PDF_QA_OUTPUT) {
  await writeFile(path.resolve(process.env.TOOLKNIT_AI_DOC_PDF_QA_OUTPUT), rendered.bytes);
}

console.log('AI document two-page PDF layout regression check passed');
