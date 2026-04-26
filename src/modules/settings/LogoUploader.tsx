import React, { useCallback } from 'react';
import { SettingsService } from '@/services/firebase/SettingsService';
import { X, Image as ImageIcon } from 'lucide-react';

interface Props {
  logoUrl: string;
  tenantId: string;
  onLogoUploaded: (url: string) => void;
}

export const LogoUploader: React.FC<Props> = ({ logoUrl, tenantId, onLogoUploaded }) => {
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 2 * 1024 * 1024) { alert('Máximo 2MB'); return; }
    setUploading(true);
    try {
      const url = await SettingsService.uploadLogo(tenantId, file);
      onLogoUploaded(url);
    } catch (e) { console.error(e); alert('Error subiendo logo'); }
    finally { setUploading(false); }
  }, [tenantId, onLogoUploaded]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Logo de la Empresa</label>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`relative cursor-pointer border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center transition-all min-h-[160px] ${
          dragOver ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-slate-300 dark:border-slate-600 hover:border-primary-400'
        }`}
      >
        {uploading ? (
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-slate-500">Subiendo...</p>
          </div>
        ) : logoUrl ? (
          <div className="flex flex-col items-center">
            <img src={logoUrl} alt="Logo" className="max-h-24 max-w-[200px] object-contain rounded-lg mb-3" />
            <p className="text-xs text-slate-400">Click o arrastra para cambiar</p>
          </div>
        ) : (
          <div className="flex flex-col items-center text-slate-400">
            <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded-full mb-3">
              <ImageIcon className="w-8 h-8" />
            </div>
            <p className="text-sm font-medium">Arrastra tu logo aquí</p>
            <p className="text-xs mt-1">PNG, JPG o SVG · Máx. 2MB</p>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
      </div>
      {logoUrl && (
        <button onClick={(e) => { e.stopPropagation(); onLogoUploaded(''); }} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
          <X className="w-3 h-3" /> Quitar logo
        </button>
      )}
    </div>
  );
};
