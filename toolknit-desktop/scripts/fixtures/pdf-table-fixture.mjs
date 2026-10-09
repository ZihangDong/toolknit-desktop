import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

// A synthetic equivalent of the reported schedule. No user document is embedded.
export async function createTablePdf({ filled = false, rotation = 0, continuation = false } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const xs = [40, 120, 230, 410, 490, 570];
  for (let index = 0; index < 2; index++) {
    const page = pdf.addPage([620, 800]);
    page.setRotation(degrees(rotation));
    const ys = continuation ? [740, 690, 500, 290, 80] : [740, 700, 620, 540, 460];
    const line = (x1, y1, x2, y2) => filled
      ? page.drawRectangle({ x: x1, y: y1, width: Math.max(.6, x2-x1), height: Math.max(.6, y2-y1), color: rgb(0,0,0) })
      : page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: .6 });
    for (const x of xs) line(x, ys.at(-1), x, ys[0]);
    for (const [r, y] of ys.entries()) line(r === 2 ? xs[1] : xs[0], y, xs.at(-1), y);
    const cell = (r, c, lines, strong = false) => {
      const activeFont = strong ? bold : font;
      lines.forEach((text, i) => {
        const x = (xs[c] + xs[c+1] - activeFont.widthOfTextAtSize(text, 10))/2;
        page.drawText(text, { x, y: ys[r]-24-i*14, size: 10, font: activeFont });
      });
    };
    const headers = continuation && index === 1
      ? ['Day 2','08:30','Continued session','Dora','Hall 3']
      : ['Date','Time','Course','Lecturer','Room'];
    headers.forEach((text,c)=>cell(0,c,[text],true));
    cell(1,0,[`Day ${index+1}`]);
    cell(1,1,['09:00','10:00']); cell(1,2,['First lesson','continued in the same cell']);
    cell(1,3,['Alice']); cell(1,4,['Hall 1']);
    cell(2,1,['10:30','11:30']); cell(2,2,['<tag> a|b $5 *literal*']);
    cell(2,3,['Bob']); cell(2,4,['Hall 2']);
    cell(3,0,[`Day ${index+2}`]); cell(3,1,['13:00']); cell(3,2,['Closing session']);
    cell(3,3,['Carol']); // Last cell is intentionally blank.
    page.drawText('Schedule', { x: 40, y: 770, size: 18, font: bold });
    page.drawText('This paragraph follows the table.', { x: 40, y: continuation ? 40 : 420, size: 12, font });
  }
  return pdf.save();
}
