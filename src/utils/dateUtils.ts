import { format, isValid } from 'date-fns';

/**
 * Convierte cualquier valor (ISO string, número, Date, Timestamp de Firestore,
 * objeto serializado {seconds}) en un Date válido, o null si no es parseable.
 * Evita que un `Invalid Date` se propague y rompa el render.
 */
export const toDateSafe = (value: unknown): Date | null => {
  if (value == null) return null;

  // Firestore Timestamp (cliente) o cualquier objeto con toDate()
  if (typeof value === 'object' && typeof (value as any).toDate === 'function') {
    const d = (value as any).toDate();
    return isValid(d) ? d : null;
  }

  // Objeto serializado tipo { seconds, nanoseconds }
  if (typeof value === 'object' && typeof (value as any).seconds === 'number') {
    const d = new Date((value as any).seconds * 1000);
    return isValid(d) ? d : null;
  }

  const d = value instanceof Date ? value : new Date(value as any);
  return isValid(d) ? d : null;
};

/**
 * Formatea de forma segura. Devuelve `fallback` si la fecha es inválida
 * en lugar de lanzar "Invalid time value".
 */
export const formatDateSafe = (value: unknown, fmt: string, fallback = 'Sin fecha'): string => {
  const d = toDateSafe(value);
  return d ? format(d, fmt) : fallback;
};
