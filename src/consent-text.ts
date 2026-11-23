import { PDFDocument } from 'pdf-lib';
import type { ConsentResponse, ConsentTemplate } from './consent-types';

export async function completeTextConsent(template: ConsentTemplate, response: ConsentResponse) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(template.title);
  const canvas = document.createElement('canvas');
  canvas.width = 1224;
  canvas.height = 1584;
  const context = canvas.getContext('2d')!;
  let y = 0;
  const writePage = async () => {
    const image = await pdf.embedPng(canvas.toDataURL('image/png'));
    pdf.addPage([612, 792]).drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
    context.clearRect(0, 0, canvas.width, canvas.height);
    y = 100;
  };
  const write = async (text: string, size: number, bold = false) => {
    const font = `${bold ? '600' : '400'} ${size}px sans-serif`;
    context.font = font;
    context.fillStyle = '#172031';
    context.textBaseline = 'top';
    for (const paragraph of text.split(/\r?\n/)) {
      let line = '';
      for (const character of paragraph) {
        if (!line || context.measureText(line + character).width <= 1024) {
          line += character;
          continue;
        }
        const breakAt = line.lastIndexOf(' ');
        const current = breakAt > 0 ? line.slice(0, breakAt) : line;
        if (y + size * 1.45 > 1484) await writePage();
        context.fillText(current, 100, y);
        y += size * 1.45;
        line = (breakAt > 0 ? line.slice(breakAt + 1) : '') + character;
      }
      if (y + size * 1.45 > 1484) await writePage();
      context.fillText(line, 100, y);
      y += size * 1.45;
    }
  };
  y = 100;
  await write(template.title, 42, true);
  y += 24;
  await write(template.text, 26);
  y += 32;
  for (const field of template.fields) {
    const signature = response.signatures[field.id];
    if (signature) {
      if (y + 215 > 1484) await writePage();
      await write(field.label, 25, true);
      const bytes = Uint8Array.from(atob(signature.split(',')[1]), character => character.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      try {
        const scale = Math.min(500 / image.width, 150 / image.height);
        context.drawImage(image, 100, y, scale * image.width, scale * image.height);
        y += 170;
      } finally { image.close(); }
    } else {
      const answer = response.values[field.id];
      const display = typeof answer === 'boolean' ? (answer ? 'Checked' : 'Unchecked') : answer;
      if (display) await write(field.label + ' — ' + display, 25);
    }
  }
  await write(new Date().toISOString(), 20);
  await writePage();
  return pdf.save();
}
