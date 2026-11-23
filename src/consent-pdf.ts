import { AnnotationMode, GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocument as WritablePdf, PDFForm, PDFSignature } from 'pdf-lib';
import type { ConsentField, ConsentPosition, ConsentResponse } from './consent-types';

GlobalWorkerOptions.workerSrc = workerUrl;

type Widget = {
  fieldName?: string;
  fieldType?: string;
  alternativeText?: string;
  fieldValue?: string | string[];
  exportValue?: string;
  buttonValue?: string;
  options?: { exportValue: string; displayValue: string }[];
  rect: number[];
  checkBox?: boolean;
  radioButton?: boolean;
  readOnly?: boolean;
  required?: boolean;
};

export async function openPdfConsent(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: true, enableXfa: false });
  let pdf;
  try {
    pdf = await loading.promise;
  } catch {
    await loading.destroy().catch(() => {});
    throw new Error('This PDF could not be opened. Choose a readable PDF without password protection.');
  }
  const fields: ConsentField[] = [];
  const fieldsByName = new Map<string, ConsentField>();
  let hasUnsupportedFields = false;
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      for (const widget of await page.getAnnotations({ intent: 'display' }) as Widget[]) {
        const name = widget.fieldName;
        if (!name || widget.readOnly) continue;
        const kind = widget.fieldType === 'Sig' ? 'signature'
          : widget.fieldType === 'Tx' ? 'text'
            : widget.checkBox ? 'checkbox'
              : widget.radioButton || widget.fieldType === 'Ch' ? 'select' : undefined;
        if (!kind) {
          if (widget.fieldType !== 'Btn') hasUnsupportedFields = true;
          continue;
        }
        const existing = fieldsByName.get(name);
        if (existing) {
          if (widget.radioButton && widget.buttonValue && !existing.options?.includes(widget.buttonValue)) existing.options?.push(widget.buttonValue);
          continue;
        }
        const [x1, y1] = viewport.convertToViewportPoint(widget.rect[0], widget.rect[1]);
        const [x2, y2] = viewport.convertToViewportPoint(widget.rect[2], widget.rect[3]);
        const field: ConsentField = {
          id: crypto.randomUUID(), label: widget.alternativeText || name, kind,
          required: widget.required === true, nativeName: name,
          position: { page: number, x: Math.min(x1, x2) / viewport.width, y: Math.min(y1, y2) / viewport.height, width: Math.abs(x2 - x1) / viewport.width, height: Math.abs(y2 - y1) / viewport.height },
          options: widget.options?.map(option => option.exportValue) ?? (widget.radioButton ? (widget.buttonValue ? [widget.buttonValue] : []) : undefined),
          defaultValue: widget.checkBox ? Boolean(widget.fieldValue && widget.fieldValue !== 'Off')
            : kind === 'signature' ? undefined
              : Array.isArray(widget.fieldValue) ? widget.fieldValue[0] : widget.fieldValue === 'Off' ? undefined : widget.fieldValue,
        };
        fieldsByName.set(name, field);
        fields.push(field);
      }
    }
  } catch (error) {
    await loading.destroy().catch(() => {});
    throw error;
  }
  return {
    fields,
    pageCount: pdf.numPages,
    hasUnsupportedFields,
    close: () => loading.destroy(),
    async render(number: number, canvas: HTMLCanvasElement, cssWidth: number) {
      const page = await pdf.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(2, Math.max(1, window.devicePixelRatio)) * cssWidth / natural.width;
      const viewport = page.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE_FORMS }).promise;
    },
    async complete(templateFields: ConsentField[], response: ConsentResponse) {
      const { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFSignature, StandardFonts, degrees, rgb } = await import('pdf-lib');
      const doc = await PDFDocument.load(bytes);
      const fonts = await doc.embedFont(StandardFonts.Helvetica);
      const form = templateFields.some(field => field.nativeName) ? doc.getForm() : undefined;
      const unpositioned: ConsentField[] = [];
      for (const field of templateFields) {
        const answer = response.values[field.id];
        const signature = response.signatures[field.id];
        if (!signature && (answer === undefined || answer === '')) continue;
        const native = field.nativeName ? form?.getFieldMaybe(field.nativeName) : undefined;
        if (native instanceof PDFTextField) {
          try {
            fonts.encodeText(String(answer));
            native.setText(String(answer));
            continue;
          } catch {
            // Preserve characters outside the standard PDF font by drawing the visible answer.
            form?.removeField(native);
          }
        } else if (native instanceof PDFCheckBox) {
          if (answer === true) native.check();
          else native.uncheck();
          continue;
        } else if (native instanceof PDFRadioGroup || native instanceof PDFDropdown || native instanceof PDFOptionList) {
          if (answer) native.select(String(answer));
          continue;
        } else if (native instanceof PDFSignature && signature) {
          // The drawn mark is a visual signature, so the empty certificate widget must not overlay it.
          if (form) removeSignatureWidget(doc, form, native);
        }
        if (!field.position) {
          unpositioned.push(field);
          continue;
        }
        const p = field.position;
        const view = (await pdf.getPage(p.page)).getViewport({ scale: 1 });
        const page = doc.getPage(p.page - 1);
        const width = p.width * view.width;
        const height = p.height * view.height;
        const image = await doc.embedPng(signature || answerImage(answer, width, height));
        const size = signature ? image.scaleToFit(width, height) : { width, height };
        const [x, y] = view.convertToPdfPoint(
          p.x * view.width + (width - size.width) / 2,
          p.y * view.height + (height + size.height) / 2,
        );
        page.drawImage(image, { x, y, ...size, rotate: degrees(view.rotation) });
      }
      if (unpositioned.length) {
        let page = doc.addPage();
        let y = page.getHeight() - 60;
        page.drawText('Consent responses', { x: 48, y, size: 17, font: fonts, color: rgb(0.1, 0.1, 0.16) });
        y -= 35;
        for (const field of unpositioned) {
          if (y < 125) {
            page = doc.addPage();
            y = page.getHeight() - 55;
          }
          const inline = response.signatures[field.id];
          const title = await doc.embedPng(answerImage(field.label + (inline ? '' : ' — ' + displayValue(response.values[field.id])), 475, 24));
          page.drawImage(title, { x: 48, y: y - 24, width: 475, height: 24 });
          y -= 30;
          if (inline) {
            const image = await doc.embedPng(inline);
            page.drawImage(image, { x: 48, y: y - 72, width: 240, height: 72 });
            y -= 80;
          }
        }
      }
      return doc.save();
    },
  };
}

function removeSignatureWidget(pdf: WritablePdf, form: PDFForm, field: PDFSignature) {
  // Empty signature widgets may lack a normal appearance that PDFForm.removeField requires.
  const widgetRefs = field.acroField.getWidgets().flatMap(widget => {
    const ref = pdf.context.getObjectRef(widget.dict);
    return ref ? [ref] : [];
  });
  for (const page of pdf.getPages()) {
    for (const ref of widgetRefs) page.node.removeAnnot(ref);
  }
  form.acroForm.removeField(field.acroField);
  for (const ref of widgetRefs) pdf.context.delete(ref);
  pdf.context.delete(field.ref);
}

function displayValue(value: string | boolean) {
  return typeof value === 'boolean' ? (value ? '☒' : '☐') : value;
}

function answerImage(answer: string | boolean, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * 2));
  canvas.height = Math.max(1, Math.ceil(height * 2));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#131626';
  ctx.font = Math.min(28, Math.max(10, canvas.height * .69)) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(displayValue(answer), 2, canvas.height / 2, Math.max(1, canvas.width - 4));
  return canvas.toDataURL('image/png');
}
