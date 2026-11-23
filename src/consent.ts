import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { esc } from './html';
import type { ConsentField, ConsentFieldKind, ConsentFormat, ConsentPosition, ConsentResponse, ConsentTemplate } from './consent-types';
import type { openPdfConsent } from './consent-pdf';
import type { openWordConsent } from './consent-word';
import './consent.css';

type Pdf = Awaited<ReturnType<typeof openPdfConsent>>;
type Word = Awaited<ReturnType<typeof openWordConsent>>;
const maxDocumentBytes = 25 * 1024 * 1024;
const labels: Record<ConsentFieldKind, string> = { text: 'Text field', checkbox: 'Checkbox', signature: 'Signature', select: 'Dropdown', date: 'Date' };

export async function saveConsentCopy(response: ConsentResponse) {
  if (!response.documentId) return;
  const name = response.documentName ?? 'Completed consent.pdf';
  const extension = name.endsWith('.docx') ? 'docx' : 'pdf';
  const path = await save({ defaultPath: name, filters: [{ name: extension === 'pdf' ? 'PDF document' : 'Word document', extensions: [extension] }] });
  if (path) await invoke('save_consent_copy', { id: response.documentId, path });
}

async function readDocument(id: string) {
  return new Uint8Array(await invoke<ArrayBuffer>('read_consent_document', { id }));
}

async function saveDocument(bytes: Uint8Array, extension: 'pdf' | 'docx') {
  const result = await invoke<{ id: string }>('save_consent_document', bytes, { headers: { 'x-consent-extension': extension } });
  return result.id;
}

function createField(kind: ConsentFieldKind, label = labels[kind], required = true): ConsentField {
  return { id: crypto.randomUUID(), label, kind, required };
}

function initialFields() {
  return [createField('checkbox', 'I agree to this consent form'), createField('signature', 'Participant signature')];
}

function popup<T>(title: string, markup: string) {
  const dialog = document.createElement('dialog');
  dialog.className = 'consent-dialog';
  dialog.setAttribute('aria-labelledby', 'consent-title');
  dialog.innerHTML = `<h2 id="consent-title">${esc(title)}</h2>${markup}<p class="consent-status" role="status"></p>`;
  const status = dialog.querySelector<HTMLElement>('.consent-status')!;
  dialog.querySelector<HTMLElement>('.buttons')?.before(status);
  document.body.append(dialog);
  let result: T | undefined;
  let busy = false;
  let temporarilyDisabled: (HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[] = [];
  const closed = new Promise<T | undefined>(resolve => {
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    }, { once: true });
  });
  dialog.addEventListener('cancel', event => {
    if (busy) event.preventDefault();
  });
  const find = <E extends HTMLElement>(selector: string) => dialog.querySelector<E>(selector)!;
  const message = (value: string, error = false) => {
    status.textContent = value;
    status.toggleAttribute('data-error', error);
  };
  const pending = (next: boolean) => {
    busy = next;
    if (next) {
      temporarilyDisabled = Array.from(dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button:enabled, input:enabled, select:enabled, textarea:enabled'));
      for (const control of temporarilyDisabled) control.disabled = true;
    } else {
      for (const control of temporarilyDisabled) control.disabled = false;
      temporarilyDisabled = [];
    }
    dialog.toggleAttribute('data-busy', next);
  };
  dialog.showModal();
  find('.consent-close').onclick = () => dialog.close();
  return {
    dialog, find, closed, message, pending,
    fail: (error: unknown) => message(error instanceof Error ? error.message : String(error), true),
    finish: (value: T) => { result = value; dialog.close(); },
  };
}

type PdfViewerOptions = {
  pdf: Pdf;
  container: HTMLElement;
  fields: () => ConsentField[];
  preview: (overlay: HTMLElement, field: ConsentField) => void;
  placed: (field: ConsentField, position: ConsentPosition) => void;
  fail: (error: unknown) => void;
};

function pdfViewer(options: PdfViewerOptions) {
  const { pdf, container } = options;
  let number = 1;
  let painting = 0;
  let placing: ConsentField | undefined;
  let drag: { x: number; y: number } | undefined;
  container.innerHTML = `<div class="consent-document-bar">
    <button class="btn consent-previous" type="button" aria-label="Previous PDF page">←</button>
    <span class="consent-page-count" aria-live="polite"></span>
    <button class="btn consent-next" type="button" aria-label="Next PDF page">→</button>
    <button class="textbtn consent-cancel-placement" type="button" hidden>Cancel placement</button>
  </div><div class="consent-pdf-scroll"><div class="consent-pdf-page"></div></div>`;
  const page = container.querySelector<HTMLElement>('.consent-pdf-page')!;
  const caption = container.querySelector<HTMLElement>('.consent-page-count')!;
  const previous = container.querySelector<HTMLButtonElement>('.consent-previous')!;
  const next = container.querySelector<HTMLButtonElement>('.consent-next')!;
  const cancel = container.querySelector<HTMLButtonElement>('.consent-cancel-placement')!;
  const overlay = document.createElement('div');
  overlay.className = 'consent-overlay';
  const position = (element: HTMLElement, shape: ConsentPosition) => {
    element.style.left = shape.x * 100 + '%';
    element.style.top = shape.y * 100 + '%';
    element.style.width = shape.width * 100 + '%';
    element.style.height = shape.height * 100 + '%';
  };
  const refresh = () => {
    overlay.replaceChildren();
    for (const field of options.fields()) {
      if (field.position?.page !== number) continue;
      const box = document.createElement(field.kind === 'signature' ? 'div' : 'button');
      if (box instanceof HTMLButtonElement) box.type = 'button';
      box.className = 'consent-box';
      box.title = field.label;
      position(box, field.position);
      options.preview(box, field);
      overlay.append(box);
    }
  };
  const paint = async () => {
    const request = ++painting;
    previous.disabled = number === 1;
    next.disabled = number === pdf.pageCount;
    caption.textContent = `Page ${number} of ${pdf.pageCount}`;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', `Consent PDF page ${number}`);
    try {
      await pdf.render(number, canvas, Math.max(280, Math.min(740, page.clientWidth || 470)));
      if (request !== painting || !page.isConnected) return;
      page.replaceChildren(canvas, overlay);
      refresh();
    } catch (error) {
      if (request === painting && page.isConnected) options.fail(error);
    }
  };
  const setPlacing = (field?: ConsentField) => {
    placing = field;
    page.toggleAttribute('data-place', Boolean(field));
    cancel.hidden = !field;
    page.setAttribute('aria-label', field ? 'Drag to place ' + field.label : 'PDF page');
  };
  const point = (event: PointerEvent) => {
    const rect = page.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  previous.onclick = () => { if (number > 1) { number--; void paint(); } };
  next.onclick = () => { if (number < pdf.pageCount) { number++; void paint(); } };
  cancel.onclick = () => setPlacing();
  page.addEventListener('pointerdown', event => {
    if (!placing || !page.querySelector('canvas') || event.button !== 0) return;
    event.preventDefault();
    drag = point(event);
    page.setPointerCapture(event.pointerId);
  });
  page.addEventListener('pointerup', event => {
    if (!placing || !drag) return;
    if (page.hasPointerCapture(event.pointerId)) page.releasePointerCapture(event.pointerId);
    const end = point(event);
    const width = Math.abs(drag.x - end.x);
    const height = Math.abs(drag.y - end.y);
    const w = width > .025 ? width : (placing.kind === 'checkbox' ? .045 : .28);
    const h = height > .012 ? height : (placing.kind === 'signature' ? .08 : .032);
    const x = Math.min(Math.min(drag.x, end.x), 1 - w);
    const y = Math.min(Math.min(drag.y, end.y), 1 - h);
    const field = placing;
    drag = undefined;
    setPlacing();
    options.placed(field, { page: number, x, y, width: w, height: h });
    refresh();
  });
  page.addEventListener('pointercancel', () => { drag = undefined; });
  void paint();
  return {
    refresh, place: setPlacing,
    showPage(pageNumber: number) {
      if (pageNumber !== number) {
        number = pageNumber;
        void paint();
      }
    },
  };
}

function paper(container: HTMLElement, paragraphs: string[]) {
  const preview = document.createElement('article');
  preview.className = 'consent-paper';
  for (const value of paragraphs) {
    const line = document.createElement('p');
    line.textContent = value;
    preview.append(line);
  }
  container.replaceChildren(preview);
}

function optionList(entries: string[], selected?: string) {
  return entries.map(entry => `<option value="${esc(entry)}" ${selected === entry ? 'selected' : ''}>${esc(entry)}</option>`).join('');
}

export function openConsentTemplate(existing?: ConsentTemplate): Promise<ConsentTemplate | undefined> {
  const template: ConsentTemplate = existing ? structuredClone(existing) : { id: crypto.randomUUID(), title: '', format: 'text', required: false, text: '', fields: initialFields() };
  const panel = popup<ConsentTemplate>(existing ? 'Edit consent form' : 'Add consent form', `
    <label class="field">Form name<input class="consent-name" maxlength="200" value="${esc(template.title)}" autofocus></label>
    <label class="field">Source<select class="consent-format">
      <option value="text">Write or paste text</option><option value="pdf">PDF document</option><option value="docx">Word document (.docx)</option>
    </select></label>
    <div class="consent-layout">
      <div class="consent-preview"></div>
      <div class="consent-template-fields">
        <h3>Fields in this form</h3>
        <div class="consent-field-list"></div>
        <div class="row"><select aria-label="New field type" class="consent-new-field">
          <option value="text">Text field</option><option value="checkbox">Checkbox</option><option value="signature">Signature</option><option value="date">Date</option>
        </select><button class="btn consent-add" type="button">Add field</button></div>
      </div>
    </div>
    <div class="buttons"><button class="btn consent-close" type="button">Cancel</button><button class="btn primary consent-save" type="button">Save form</button></div>
  `);
  const format = panel.find<HTMLSelectElement>('.consent-format');
  const name = panel.find<HTMLInputElement>('.consent-name');
  const preview = panel.find<HTMLElement>('.consent-preview');
  const fields = panel.find<HTMLElement>('.consent-field-list');
  let selectedFile: { bytes: Uint8Array; name: string } | undefined;
  let pdf: Pdf | undefined;
  let viewer: ReturnType<typeof pdfViewer> | undefined;
  let opened = 0;
  let documentOpen = template.format === 'text';
  let loading = false;
  format.value = template.format;

  const drawFields = () => {
    fields.innerHTML = template.fields.map(field => `<div class="consent-field-editor" data-consent-field="${field.id}">
      <label class="field">${labels[field.kind]} name<input data-field-name value="${esc(field.label)}" maxlength="200"></label>
      ${field.nativeName !== undefined ? '<small class="muted">Imported document field</small>' : ''}
      <label class="consent-check"><input data-field-required type="checkbox" ${field.required ? 'checked' : ''}> Required to complete this form</label>
      ${template.format === 'pdf' && field.nativeName === undefined ? `<button type="button" class="textbtn" data-place-field ${viewer ? '' : 'disabled'}>${field.position ? 'Move field on page ' + field.position.page : 'Place on PDF'}</button>` : ''}
      ${field.nativeName === undefined ? '<button class="textbtn" type="button" data-remove-field>Remove field</button>' : ''}
    </div>`).join('');
  };

  const showPreview = async (file?: File) => {
    const request = ++opened;
    const loadedFormat = template.format;
    if (pdf) void pdf.close().catch(() => {});
    pdf = undefined;
    viewer = undefined;
    loading = false;
    documentOpen = loadedFormat === 'text';
    if (loadedFormat === 'text') {
      preview.innerHTML = `<label class="field">Consent text<textarea class="consent-template-text" placeholder="Write or paste the consent text" maxlength="50000">${esc(template.text)}</textarea></label>`;
      preview.querySelector('textarea')!.oninput = event => { template.text = (event.target as HTMLTextAreaElement).value; };
      drawFields();
      return;
    }
    preview.innerHTML = `<label class="field consent-choose">Upload ${loadedFormat === 'pdf' ? 'PDF' : 'Word document'}
      <input class="consent-file" type="file" accept="${loadedFormat === 'pdf' ? '.pdf,application/pdf' : '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'}">
    </label><p class="filelabel"></p><div class="consent-document"></div>`;
    const fileInput = preview.querySelector<HTMLInputElement>('.consent-file')!;
    const label = preview.querySelector<HTMLElement>('.filelabel')!;
    const documentHost = preview.querySelector<HTMLElement>('.consent-document')!;
    fileInput.onchange = () => { if (fileInput.files?.[0]) void showPreview(fileInput.files[0]); };
    label.textContent = file?.name ?? selectedFile?.name ?? template.documentName ?? '';
    drawFields();
    if (!file && !selectedFile && !template.documentId) return;
    panel.message('Loading document…');
    loading = true;
    try {
      if (file && (file.size > maxDocumentBytes || !file.name.toLowerCase().endsWith('.' + loadedFormat))) {
        throw new Error(`Choose a .${loadedFormat} file no larger than 25 MB.`);
      }
      const bytes = file ? new Uint8Array(await file.arrayBuffer()) : selectedFile?.bytes ?? await readDocument(template.documentId!);
      if (request !== opened) return;
      let imported: ConsentField[];
      if (loadedFormat === 'pdf') {
        const document = await (await import('./consent-pdf')).openPdfConsent(bytes);
        if (request !== opened) { void document.close().catch(() => {}); return; }
        pdf = document;
        imported = pdf.fields;
        viewer = pdfViewer({
          container: documentHost, pdf, fields: () => template.fields,
          preview(box, field) {
            box.textContent = field.label;
            box.onclick = () => fields.querySelector<HTMLElement>(`[data-consent-field="${field.id}"] [data-field-name]`)?.focus();
          },
          placed(field, position) {
            field.position = position;
            panel.message(field.label + ' placed on page ' + position.page + '.');
            drawFields();
          },
          fail: panel.fail,
        });
      } else {
        const document = await (await import('./consent-word')).openWordConsent(bytes);
        if (request !== opened) return;
        imported = document.fields;
        paper(documentHost, document.paragraphs);
      }
      if (file) {
        const extras = template.fields.filter(field => field.nativeName === undefined).map(field => ({ ...field, position: undefined }));
        template.fields = [...imported, ...extras.filter(field => !(field.kind === 'signature' && imported.some(entry => entry.kind === 'signature')))];
        if (!template.fields.some(field => field.kind === 'signature')) template.fields.push(createField('signature', 'Participant signature'));
        selectedFile = { bytes, name: file.name };
      }
      documentOpen = true;
      drawFields();
      viewer?.refresh();
      const warning = pdf?.hasUnsupportedFields ? 'Some PDF fields could not be imported. Add Fieldnote fields to collect those answers.' : '';
      panel.message(warning || (loadedFormat === 'pdf' ? 'Place your fields on the preview to include them on the page.' : 'Word preview shows the document text and supported form fields.'));
    } catch (error) {
      if (request === opened) {
        panel.fail(error);
        if (file) {
          // Keep the previous document selectable after a failed replacement.
          const retry = document.createElement('button');
          retry.className = 'btn';
          retry.textContent = 'Restore previous document';
          retry.hidden = !selectedFile && !template.documentId;
          retry.onclick = () => { void showPreview(); };
          documentHost.append(retry);
        }
      }
    } finally {
      if (request === opened) loading = false;
    }
  };

  format.onchange = () => {
    template.format = format.value as ConsentFormat;
    template.documentId = undefined;
    template.documentName = undefined;
    selectedFile = undefined;
    template.fields = template.format === 'text' ? initialFields() : [];
    panel.message('');
    void showPreview();
  };
  fields.addEventListener('input', event => {
    const target = event.target as HTMLInputElement;
    const id = target.closest<HTMLElement>('[data-consent-field]')?.dataset.consentField;
    const field = template.fields.find(entry => entry.id === id);
    if (!field) return;
    if (target.hasAttribute('data-field-name')) field.label = target.value;
    if (target.hasAttribute('data-field-required')) field.required = target.checked;
    viewer?.refresh();
  });
  fields.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    const id = button.closest<HTMLElement>('[data-consent-field]')?.dataset.consentField;
    const field = template.fields.find(entry => entry.id === id);
    if (!field) return;
    if (button.hasAttribute('data-remove-field')) {
      template.fields = template.fields.filter(entry => entry !== field);
      drawFields();
      viewer?.refresh();
    }
    if (button.hasAttribute('data-place-field')) {
      if (field.position) viewer?.showPage(field.position.page);
      viewer?.place(field);
      panel.message('Click or drag on the document to place ' + field.label + '.');
    }
  });
  panel.find('.consent-add').onclick = () => {
    const field = createField(panel.find<HTMLSelectElement>('.consent-new-field').value as ConsentFieldKind);
    template.fields.push(field);
    drawFields();
    fields.querySelector<HTMLInputElement>(`[data-consent-field="${field.id}"] input`)?.focus();
  };
  panel.find('.consent-save').onclick = async () => {
    template.title = name.value.trim();
    if (!template.title) { panel.message('Give this consent form a name.', true); name.focus(); return; }
    if (template.format === 'text' && !template.text.trim()) { panel.message('Add the consent text.', true); return; }
    if (loading) { panel.message('Wait for the document to finish loading.'); return; }
    if (!documentOpen || (template.format !== 'text' && !selectedFile && !template.documentId)) {
      panel.message('Choose a document to use for this form.', true);
      return;
    }
    if (template.fields.some(field => !field.label.trim())) { panel.message('Give every field a name.', true); return; }
    panel.pending(true);
    try {
      if (selectedFile && template.format !== 'text') {
        template.documentId = await saveDocument(selectedFile.bytes, template.format);
        template.documentName = selectedFile.name;
      }
      panel.finish(template);
    } catch (error) {
      panel.fail(error);
      panel.pending(false);
    }
  };
  void showPreview();
  return panel.closed.finally(() => { opened++; if (pdf) void pdf.close().catch(() => {}); });
}

export function openConsentForm(template: ConsentTemplate, existing?: ConsentResponse): Promise<ConsentResponse | undefined> {
  const response: ConsentResponse = existing ? structuredClone(existing) : { values: {}, signatures: {}, positions: {}, complete: false };
  const positions = response.positions ??= {};
  for (const field of template.fields) {
    if (!(field.id in response.values) && field.defaultValue !== undefined) response.values[field.id] = field.defaultValue;
  }
  const panel = popup<ConsentResponse>(template.title, `
    <div class="consent-layout"><div class="consent-preview"></div><div class="consent-field-list"></div></div>
    <div class="buttons">
      ${existing?.documentId ? '<button class="btn consent-copy" type="button">Save completed copy…</button>' : ''}
      <button class="btn consent-close" type="button">Cancel</button>
      <button class="btn primary consent-save" type="button">Save and close</button>
    </div>`);
  const preview = panel.find<HTMLElement>('.consent-preview');
  const list = panel.find<HTMLElement>('.consent-field-list');
  let pdf: Pdf | undefined;
  let word: Word | undefined;
  let viewer: ReturnType<typeof pdfViewer> | undefined;
  let ready = template.format === 'text';
  let closed = false;
  const fields = () => template.fields.map(field => ({ ...field, position: positions[field.id] ?? field.position }));
  const pads = new Map<string, Set<HTMLCanvasElement>>();

  function drawFieldSignature(canvas: HTMLCanvasElement, field: ConsentField, inline: boolean) {
    let fieldPads = pads.get(field.id);
    if (!fieldPads) { fieldPads = new Set(); pads.set(field.id, fieldPads); }
    fieldPads.add(canvas);
    canvas.parentElement?.toggleAttribute('data-signed', Boolean(response.signatures[field.id]));
    const changed = (image: string) => {
      if (image) response.signatures[field.id] = image;
      else delete response.signatures[field.id];
      for (const pad of fieldPads) {
        if (!pad.isConnected) fieldPads.delete(pad);
        else {
          pad.parentElement?.toggleAttribute('data-signed', Boolean(image));
          if (pad !== canvas) void restoreSignature(pad, image);
        }
      }
    };
    canvas.setAttribute('aria-label', 'Draw ' + field.label);
    const rect = canvas.getBoundingClientRect();
    canvas.width = 660;
    canvas.height = inline && rect.width && rect.height
      ? Math.max(45, Math.min(600, Math.round(660 * rect.height / rect.width))) : 198;
    const pencil = addSignatureDrawing(canvas, changed);
    void pencil.restore(response.signatures[field.id]);
    return pencil;
  }

  function drawFields() {
    list.replaceChildren();
    for (const field of fields()) {
      const row = document.createElement('fieldset');
      row.className = 'consent-answer';
      row.innerHTML = `<legend>${esc(field.label)}${field.required ? '<span class="consent-req">Required</span>' : ''}</legend>`;
      list.append(row);
      const id = 'consent-answer-' + field.id;
      if (field.kind === 'signature') {
        row.innerHTML += `<canvas id="${id}" class="consent-signature"></canvas>
          <div class="consent-sign-tools">
            <button class="textbtn" type="button" data-clear>Clear signature</button>
            ${pdf ? `<button class="textbtn" type="button" data-place>${field.position ? 'Show on PDF' : 'Place signature on PDF'}</button>` : ''}
          </div>
          <label class="field">Or type a signature<input data-typed maxlength="120" autocomplete="off"></label>
          <button class="textbtn" type="button" data-apply>Use typed signature</button>`;
        const canvas = row.querySelector('canvas')!;
        const pencil = drawFieldSignature(canvas, field, false);
        row.querySelector<HTMLButtonElement>('[data-clear]')!.onclick = () => pencil.clear();
        row.querySelector<HTMLButtonElement>('[data-apply]')!.onclick = () => {
          const input = row.querySelector<HTMLInputElement>('[data-typed]')!;
          if (input.value.trim()) pencil.type(input.value.trim());
        };
        const place = row.querySelector<HTMLButtonElement>('[data-place]');
        if (place) place.onclick = () => {
          if (field.position) {
            viewer?.showPage(field.position.page);
            preview.scrollIntoView({ block: 'nearest' });
          } else {
            viewer?.place(field);
            preview.scrollIntoView({ block: 'nearest' });
            panel.message('Click or drag on the PDF to place a signature box, then draw inside it.');
          }
        };
        continue;
      }
      const label = document.createElement('label');
      label.className = field.kind === 'checkbox' ? 'consent-check' : 'field';
      if (field.kind === 'checkbox') {
        label.innerHTML = `<input type="checkbox" id="${id}"> ${esc(field.label)}`;
      } else if (field.kind === 'select') {
        label.innerHTML = `<select id="${id}" aria-label="${esc(field.label)}"><option value="">Choose an option</option>${optionList(field.options ?? [], String(response.values[field.id] ?? ''))}</select>`;
      } else {
        label.innerHTML = `<input id="${id}" aria-label="${esc(field.label)}" type="${field.kind === 'date' ? 'date' : 'text'}" value="${esc(response.values[field.id])}" maxlength="2000">`;
      }
      row.append(label);
      const input = label.querySelector<HTMLInputElement | HTMLSelectElement>('input, select')!;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = response.values[field.id] === true;
      input.oninput = () => {
        response.values[field.id] = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value;
        viewer?.refresh();
      };
    }
  }

  async function openDocument() {
    if (template.format === 'text') {
      paper(preview, [template.text]);
      return;
    }
    if (!template.documentId) { panel.message('The original consent document is missing.', true); return; }
    panel.message('Loading document…');
    try {
      const bytes = await readDocument(template.documentId);
      if (closed) return;
      if (template.format === 'pdf') {
        const document = await (await import('./consent-pdf')).openPdfConsent(bytes);
        if (closed) { void document.close().catch(() => {}); return; }
        pdf = document;
        viewer = pdfViewer({
          pdf, container: preview, fields,
          preview(box, field) {
            const value = response.values[field.id];
            if (field.kind === 'signature') {
              box.textContent = 'Sign here';
              const canvas = window.document.createElement('canvas');
              box.append(canvas);
              requestAnimationFrame(() => { if (canvas.isConnected) drawFieldSignature(canvas, field, true); });
              return;
            }
            box.textContent = typeof value === 'boolean' ? (value ? '☒' : '☐') : value || field.label;
            box.onclick = () => panel.find(`#consent-answer-${field.id}`)?.focus();
          },
          placed(field, position) {
            positions[field.id] = position;
            panel.message('Draw your signature directly in the box on the PDF.');
            drawFields();
          },
          fail: panel.fail,
        });
        drawFields();
      } else {
        const document = await (await import('./consent-word')).openWordConsent(bytes);
        if (closed) return;
        word = document;
        paper(preview, document.paragraphs);
      }
      ready = true;
      panel.message('');
    } catch (error) {
      if (!closed) panel.fail(error);
    }
  }

  const copy = panel.dialog.querySelector<HTMLButtonElement>('.consent-copy');
  if (copy && existing) copy.onclick = async () => {
    panel.pending(true);
    try { await saveConsentCopy(existing); }
    catch (error) { panel.fail(error); }
    finally { panel.pending(false); }
  };
  panel.find('.consent-save').onclick = async () => {
    if (!ready) return;
    response.complete = fields().every(field => {
      if (!field.required) return true;
      if (field.kind === 'signature') return Boolean(response.signatures[field.id]);
      if (field.kind === 'checkbox') return response.values[field.id] === true;
      return Boolean(String(response.values[field.id] ?? '').trim());
    });
    const existingUnchanged = existing && JSON.stringify(response.values) === JSON.stringify(existing.values)
      && JSON.stringify(response.signatures) === JSON.stringify(existing.signatures)
      && JSON.stringify(response.positions ?? {}) === JSON.stringify(existing.positions ?? {});
    if (existingUnchanged && response.complete === existing.complete) { panel.finish(existing); return; }
    if (!response.complete) {
      response.completedAt = undefined;
      response.documentId = undefined;
      response.documentName = undefined;
      panel.finish(response);
      return;
    }
    panel.pending(true);
    panel.message('Saving completed consent…');
    try {
      const output = pdf ? await pdf.complete(fields(), response)
        : word ? await word.complete(fields(), response)
          : await (await import('./consent-text')).completeTextConsent(template, response);
      const extension = word ? 'docx' : 'pdf';
      response.documentId = await saveDocument(output, extension);
      response.documentName = (template.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 100) || 'Consent') + ' - completed.' + extension;
      response.completedAt = new Date().toISOString();
      panel.finish(response);
    } catch (error) {
      panel.fail(error);
      panel.pending(false);
    }
  };
  // Keep the existing signed document immutable. A changed response saves a new copy.
  drawFields();
  void openDocument();
  return panel.closed.finally(() => { closed = true; if (pdf) void pdf.close().catch(() => {}); });
}

const restoreVersion = new WeakMap<HTMLCanvasElement, number>();

async function restoreSignature(canvas: HTMLCanvasElement, url?: string) {
  const version = (restoreVersion.get(canvas) ?? 0) + 1;
  restoreVersion.set(canvas, version);
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!url || !url.startsWith('data:image/png;base64,')) return;
  let image: ImageBitmap;
  try {
    const bytes = Uint8Array.from(atob(url.slice(22)), char => char.charCodeAt(0));
    image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  } catch { return; }
  try {
    if (restoreVersion.get(canvas) !== version) return;
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    const width = scale * image.width;
    const height = scale * image.height;
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  } finally {
    image.close();
  }
}

function addSignatureDrawing(canvas: HTMLCanvasElement, changed: (image: string) => void) {
  const context = canvas.getContext('2d')!;
  context.strokeStyle = '#15234d';
  context.fillStyle = '#15234d';
  context.lineWidth = Math.max(2.5, canvas.height / 34);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  let active: number | undefined;
  let moved = false;
  const point = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height] as const;
  };
  const publish = () => changed(canvas.toDataURL('image/png'));
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || active !== undefined) return;
    event.stopPropagation();
    event.preventDefault();
    restoreVersion.set(canvas, (restoreVersion.get(canvas) ?? 0) + 1);
    active = event.pointerId;
    moved = false;
    canvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(...point(event));
  });
  canvas.addEventListener('pointermove', event => {
    if (active !== event.pointerId) return;
    moved = true;
    context.lineTo(...point(event));
    context.stroke();
    context.beginPath();
    context.moveTo(...point(event));
  });
  const stop = (event: PointerEvent) => {
    if (active !== event.pointerId) return;
    active = undefined;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (moved) publish();
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  return {
    restore: (image?: string) => restoreSignature(canvas, image),
    clear() { void restoreSignature(canvas); changed(''); },
    type(text: string) {
      void restoreSignature(canvas);
      context.font = `italic ${Math.round(canvas.height * .44)}px cursive`;
      context.textBaseline = 'middle';
      context.fillText(text, 12, canvas.height / 2, canvas.width - 24);
      publish();
    },
  };
}
