export type ConsentFormat = 'text' | 'pdf' | 'docx';
export type ConsentFieldKind = 'text' | 'checkbox' | 'signature' | 'select' | 'date';

export type ConsentPosition = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ConsentField = {
  id: string;
  label: string;
  kind: ConsentFieldKind;
  required: boolean;
  options?: string[];
  position?: ConsentPosition;
  nativeName?: string;
  defaultValue?: string | boolean;
};

export type ConsentTemplate = {
  id: string;
  title: string;
  format: ConsentFormat;
  required: boolean;
  text: string;
  documentId?: string;
  documentName?: string;
  fields: ConsentField[];
};

export type ConsentResponse = {
  complete: boolean;
  values: Record<string, string | boolean>;
  signatures: Record<string, string>;
  positions?: Record<string, ConsentPosition>;
  completedAt?: string;
  documentId?: string;
  documentName?: string;
};
