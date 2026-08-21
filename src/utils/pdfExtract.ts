/**
 * Extrae texto de archivos TXT o PDF.
 * Los PDF se leen con pdfjs-dist (el mismo motor que usa Firefox) para
 * decodificar streams comprimidos y fuentes correctamente — un regex
 * casero no puede hacer eso y termina "leyendo" bytes internos del PDF
 * como si fueran texto.
 * Si el PDF es escaneado (imagen, sin capa de texto) no se puede
 * extraer texto — usar el campo manual.
 */
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
    return await file.text();
  }

  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
    return extractPdfText(file);
  }

  throw new Error('Formato no soportado. Usá PDF o TXT.');
}

async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => item.str || '').join(' ');
    pageTexts.push(pageText);
  }

  const result = pageTexts
    .join('\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (!result || result.length < 50) {
    throw new Error('No se pudo extraer texto de este PDF (puede ser un PDF escaneado). Pegá el texto directamente en el campo "Información del proyecto".');
  }

  return result;
}
