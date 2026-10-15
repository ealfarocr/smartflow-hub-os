// UID exacto (nunca nombre, email ni tenant) de EDUARDO ADMIN. Excepción de QA
// limitada al prototipo /super-admin/qa-live-video: no lo vuelve SuperAdmin.
// Debe coincidir con LIVE_VIDEO_QA_TESTER_UID (functions) y storage.rules.
export const LIVE_VIDEO_QA_TESTER_UID = 'Bw4GC41RiSQ1s3pw4RpypL2eEcz1';

export const canAccessLiveVideoQa = (user?: { id?: string; isSuperAdmin?: boolean } | null): boolean =>
  user?.isSuperAdmin === true || (!!user?.id && user.id === LIVE_VIDEO_QA_TESTER_UID);
