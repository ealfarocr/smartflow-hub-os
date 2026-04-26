import React from 'react';

interface Props {
  label: string;
  value: string;
  onChange: (val: string) => void;
}

export const ColorPickerField: React.FC<Props> = ({ label, value, onChange }) => {
  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-12 h-12 rounded-xl border-2 border-slate-200 dark:border-slate-600 cursor-pointer appearance-none bg-transparent [&::-webkit-color-swatch-wrapper]:p-1 [&::-webkit-color-swatch]:rounded-lg [&::-moz-color-swatch]:rounded-lg"
        />
      </div>
      <div className="flex-1">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>
        <input
          type="text"
          value={value}
          onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value) || e.target.value === '') onChange(e.target.value || '#'); }}
          className="w-28 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono focus:ring-2 focus:ring-primary-500"
          maxLength={7}
        />
      </div>
    </div>
  );
};
