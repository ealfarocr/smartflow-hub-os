import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Config de Firebase que lib/firebase.ts pasa a initializeApp/getAuth — si
// CUALQUIERA de estas falta, getAuth() lanza auth/invalid-api-key en el
// primer render (rompe TODA la app, no solo una feature), como pasó cuando
// un worktree aislado se compiló sin `.env` (gitignored, git worktree add no
// lo copia). Un bundle de producción con estos valores vacíos nunca debe
// llegar a `dist/` en silencio — mejor que `vite build` falle acá mismo.
const REQUIRED_BUILD_ENV_VARS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const missing = REQUIRED_BUILD_ENV_VARS.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(
        `BUILD FAILED: faltan variables de entorno obligatorias: ${missing.join(', ')}.\n` +
        `Sin ellas, Firebase Auth falla en el navegador con auth/invalid-api-key y ROMPE TODA la app ` +
        `(no solo una feature), incluso aunque el build y el deploy "funcionen" sin errores visibles.\n` +
        `Si estás compilando desde un worktree aislado: .env está en .gitignore, así que ` +
        `\`git worktree add\` NUNCA lo copia — hay que copiarlo a mano desde el árbol principal ` +
        `antes de \`npm run build\` (ver docs/DEPLOY_WORKTREE.md).`
      );
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
