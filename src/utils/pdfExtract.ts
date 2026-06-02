/**
 * Extrae texto de archivos TXT o PDF.
 * Para PDFs usa una extracción básica de texto plano sin worker externo.
 * Si el PDF es escaneado (imagen) no se puede extraer texto — usar el campo manual.
 */
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
  const bytes = new Uint8Array(buffer);
  const raw = new TextDecoder('latin1').decode(bytes);

  // Extraer strings entre paréntesis en flujos de contenido PDF
  const textChunks: string[] = [];

  // Buscar bloques de texto BT ... ET
  const btEt = raw.match(/BT[\s\S]*?ET/g) || [];
  for (const block of btEt) {
    // Capturar strings: (texto) Tj o [(texto)] TJ
    const strings = block.match(/\(([^)]*)\)\s*T[jJ]/g) || [];
    for (const s of strings) {
      const m = s.match(/\(([^)]*)\)/);
      if (m) textChunks.push(m[1]);
    }
  }

  // Fallback: buscar cualquier string legible entre paréntesis
  if (textChunks.length === 0) {
    const all = raw.match(/\(([^\x00-\x08\x0e-\x1f\x7f-\xff]{3,})\)/g) || [];
    for (const s of all) {
      const m = s.match(/\((.+)\)/);
      if (m) textChunks.push(m[1]);
    }
  }

  const result = textChunks
    .join(' ')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\s{3,}/g, ' ')
    .trim();

  if (!result || result.length < 50) {
    throw new Error('No se pudo extraer texto de este PDF (puede ser un PDF escaneado). Pegá el texto directamente en el campo "Información del proyecto".');
  }

  return result;
}
