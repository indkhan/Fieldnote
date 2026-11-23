import JSZip from 'jszip';
import type { ConsentField, ConsentResponse } from './consent-types';

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const word14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const mainPart = 'word/document.xml';
const descendants = (root: Document | Element, ns: string, local: string) => Array.from(root.getElementsByTagNameNS(ns, local));
const child = (root: Element, ns: string, local: string) => Array.from(root.children).find(e => e.namespaceURI === ns && e.localName === local);
const value = (el: Element | undefined, ns = word, attribute = 'val') => el?.getAttributeNS(ns, attribute) || undefined;
const textContents = (root: Element) => descendants(root, word, 't').map(el => el.textContent ?? '').join('');

export async function openWordConsent(bytes: Uint8Array) {
  const archive = await JSZip.loadAsync(bytes);
  const xml = await archive.file(mainPart)?.async('string');
  if (!xml || xml.length > 12_000_000) throw new Error('This Word document could not be opened.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = descendants(doc, word, 'body')[0];
  if (!body) throw new Error('This file does not contain a Word document.');
  const controls = descendants(body, word, 'sdt').flatMap((element, index) => {
    const props = child(element, word, 'sdtPr');
    const content = child(element, word, 'sdtContent');
    if (!props || !content || descendants(content, word, 'sdt').length) return [];
    // A mapped control can be refreshed by Word from a separate custom XML part.
    if (child(props, word, 'dataBinding')) return [];
    const checkbox = child(props, word14, 'checkbox');
    const date = child(props, word, 'date');
    const list = child(props, word, 'dropDownList') ?? child(props, word, 'comboBox');
    const isText = child(props, word, 'text') || child(props, word, 'richText');
    if (!checkbox && !date && !list && !isText) return [];
    const label = value(child(props, word, 'alias')) || value(child(props, word, 'tag')) || 'Field ' + (index + 1);
    const options = list && descendants(list, word, 'listItem').flatMap(item => {
      const display = value(item, word, 'displayText') || value(item, word, 'value');
      return display ? [display] : [];
    });
    const field: ConsentField = {
      id: crypto.randomUUID(), label, required: false, nativeName: String(index),
      kind: checkbox ? 'checkbox' : date ? 'date' : list ? 'select' : 'text',
      options,
      defaultValue: checkbox ? ['1', 'true', 'on'].includes(value(child(checkbox, word14, 'checked'), word14) ?? '')
        : date ? value(date, word, 'fullDate')?.slice(0, 10)
          : child(props, word, 'showingPlcHdr') ? undefined : textContents(content),
    };
    return [{ field, props, content, checkbox, date }];
  });
  const paragraphs = descendants(body, word, 'p').map(textContents).filter(Boolean);
  return {
    fields: controls.map(control => control.field),
    paragraphs,
    async complete(fields: ConsentField[], response: ConsentResponse) {
      for (const field of fields) {
        const control = controls.find(item => item.field.nativeName === field.nativeName);
        const answer = response.values[field.id];
        if (!control || answer === undefined) continue;
        const { props, content, checkbox, date } = control;
        child(props, word, 'showingPlcHdr')?.remove();
        if (checkbox) {
          let checked = child(checkbox, word14, 'checked');
          if (!checked) {
            checked = doc.createElementNS(word14, 'w14:checked');
            checkbox.prepend(checked);
          }
          checked.setAttributeNS(word14, 'w14:val', answer === true ? '1' : '0');
        }
        if (date && answer) date.setAttributeNS(word, 'w:fullDate', answer + 'T00:00:00Z');
        const display = checkbox ? (answer === true ? '☒' : '☐') : String(answer);
        const textNodes = descendants(content, word, 't');
        if (textNodes.length) {
          textNodes[0].textContent = display;
          textNodes[0].setAttribute('xml:space', 'preserve');
          for (const node of textNodes.slice(1)) node.textContent = '';
        } else {
          const parent = descendants(content, word, 'r')[0];
          if (parent) {
            const node = doc.createElementNS(word, 'w:t');
            node.textContent = display;
            parent.append(node);
          }
        }
      }
      const extra = fields.filter(field => field.nativeName === undefined);
      if (extra.length) await appendResponses(archive, doc, body, extra, response);
      archive.file(mainPart, new XMLSerializer().serializeToString(doc));
      return archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    },
  };
}

async function appendResponses(archive: JSZip, doc: Document, body: Element, fields: ConsentField[], response: ConsentResponse) {
  const serializer = new XMLSerializer();
  const relNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const relPart = 'word/_rels/document.xml.rels';
  const relText = await archive.file(relPart)?.async('string');
  const relationships = new DOMParser().parseFromString(relText ?? '<Relationships xmlns="' + relNamespace + '"/>', 'application/xml');
  const mimeNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const mimePart = '[Content_Types].xml';
  const mimeText = await archive.file(mimePart)?.async('string');
  if (!mimeText) throw new Error('The Word document is missing its content types.');
  const mime = new DOMParser().parseFromString(mimeText, 'application/xml');
  let drawingId = Math.max(0, ...descendants(doc, 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'docPr').map(node => Number(node.getAttribute('id')) || 0));
  for (const field of fields) {
    const paragraph = doc.createElementNS(word, 'w:p');
    const run = doc.createElementNS(word, 'w:r');
    const title = doc.createElementNS(word, 'w:t');
    const answer = response.values[field.id];
    title.textContent = field.label + (typeof answer === 'boolean' ? (answer ? ' ✓' : ' ☐') : answer ? ' — ' + answer : '');
    run.append(title);
    paragraph.append(run);
    body.insertBefore(paragraph, child(body, word, 'sectPr') ?? null);
    const signature = response.signatures[field.id];
    if (!signature) continue;
    const id = 'fieldnote' + crypto.randomUUID();
    archive.file('word/media/' + id + '.png', signature.split(',')[1], { base64: true });
    const rel = relationships.createElementNS(relNamespace, 'Relationship');
    rel.setAttribute('Id', id);
    rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image');
    rel.setAttribute('Target', 'media/' + id + '.png');
    relationships.documentElement.append(rel);
    if (!descendants(mime, mimeNamespace, 'Default').some(node => node.getAttribute('Extension') === 'png')) {
      const format = mime.createElementNS(mimeNamespace, 'Default');
      format.setAttribute('Extension', 'png');
      format.setAttribute('ContentType', 'image/png');
      mime.documentElement.append(format);
    }
    drawingId++;
    const picture = new DOMParser().parseFromString(
      `<w:r xmlns:w="${word}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:drawing><wp:inline><wp:extent cx="2286000" cy="685800"/><wp:docPr id="${drawingId}" name="Consent signature"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="Consent signature"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2286000" cy="685800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, 'application/xml',
    ).documentElement;
    paragraph.append(doc.importNode(picture, true));
  }
  archive.file(relPart, serializer.serializeToString(relationships));
  archive.file(mimePart, serializer.serializeToString(mime));
}
