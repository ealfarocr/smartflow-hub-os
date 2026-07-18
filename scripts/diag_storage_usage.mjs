import admin from 'firebase-admin';
delete process.env.FIRESTORE_EMULATOR_HOST;

admin.initializeApp({
  projectId: 'paneles-solares-bcs-mx',
  storageBucket: 'paneles-solares-bcs-mx.firebasestorage.app',
});

const bucket = admin.storage().bucket();

const fmt = (bytes) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(2)} ${u[i]}`;
};

(async () => {
  console.log(`Escaneando bucket: ${bucket.name} ...\n`);
  let total = 0, count = 0;
  const byPrefix = {};          // primer segmento del path
  const byTenant = {};          // tenants/<id>/... y whatsapp-media/<id>, chat-attachments/<id>
  const biggest = [];           // top archivos

  let query = { autoPaginate: false, maxResults: 1000 };
  let pageToken = undefined;

  do {
    const [files, nextQuery] = await bucket.getFiles({ ...query, pageToken });
    for (const f of files) {
      const size = parseInt(f.metadata?.size || '0', 10) || 0;
      total += size; count++;

      const parts = f.name.split('/');
      const prefix = parts[0] || '(raíz)';
      byPrefix[prefix] = (byPrefix[prefix] || { size: 0, n: 0 });
      byPrefix[prefix].size += size; byPrefix[prefix].n++;

      // tenant id (segundo segmento en las rutas típicas)
      if (['tenants', 'whatsapp-media', 'chat-attachments', 'media-library', 'catalog', 'logos', 'quotes'].includes(prefix) && parts[1]) {
        const key = `${prefix}/${parts[1]}`;
        byTenant[key] = (byTenant[key] || { size: 0, n: 0 });
        byTenant[key].size += size; byTenant[key].n++;
      }

      biggest.push({ name: f.name, size });
    }
    pageToken = nextQuery?.pageToken;
    if (count % 5000 === 0 && count) console.log(`  ...${count} archivos, ${fmt(total)} hasta ahora`);
  } while (pageToken);

  console.log(`\n===== TOTAL =====`);
  console.log(`Archivos: ${count.toLocaleString()}`);
  console.log(`Tamaño total: ${fmt(total)}  (${total.toLocaleString()} bytes)`);
  console.log(`Límite nivel gratis: 5 GB\n`);

  console.log(`===== POR CARPETA (top-level) =====`);
  Object.entries(byPrefix).sort((a, b) => b[1].size - a[1].size)
    .forEach(([k, v]) => console.log(`  ${fmt(v.size).padStart(11)}  |  ${String(v.n).padStart(6)} arch.  |  ${k}`));

  console.log(`\n===== TOP 15 SUB-CARPETAS (por negocio/tenant) =====`);
  Object.entries(byTenant).sort((a, b) => b[1].size - a[1].size).slice(0, 15)
    .forEach(([k, v]) => console.log(`  ${fmt(v.size).padStart(11)}  |  ${String(v.n).padStart(6)} arch.  |  ${k}`));

  console.log(`\n===== TOP 15 ARCHIVOS MÁS PESADOS =====`);
  biggest.sort((a, b) => b.size - a.size).slice(0, 15)
    .forEach(f => console.log(`  ${fmt(f.size).padStart(11)}  |  ${f.name}`));

  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
