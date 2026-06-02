import { X, Sparkles, ArrowRight } from 'lucide-react';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useNavigate } from 'react-router-dom';

export const OnboardingBanner = () => {
  const { currentStep, dismissStep } = useOnboarding();
  const navigate = useNavigate();

  if (!currentStep) return null;

  const handleAction = () => {
    navigate(currentStep.route);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    dismissStep(currentStep.id);
  };

  // Render different styles based on the trigger/step if needed
  // For now, let's use a premium, non-invasive banner style

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-right-10 duration-500">
      <div 
        onClick={handleAction}
        className="group relative max-w-sm bg-white dark:bg-slate-900 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-100 dark:border-slate-800 p-5 cursor-pointer hover:scale-[1.02] transition-all"
      >
        <button 
          onClick={handleClose}
          className="absolute top-4 right-4 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex gap-4">
          <div className="w-12 h-12 shrink-0 bg-primary-50 dark:bg-primary-900/20 rounded-2xl flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-primary-500" />
          </div>
          
          <div className="flex-1 pr-6">
            <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider mb-1">
              {currentStep.title}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
              {currentStep.message}
            </p>
            
            <div className="mt-4 flex items-center text-primary-600 dark:text-primary-400 text-xs font-black uppercase tracking-widest gap-2 group-hover:gap-3 transition-all">
              {currentStep.buttonLabel}
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Decorative progress bar or something subtle */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-100 dark:bg-slate-800 rounded-b-3xl overflow-hidden">
          <div className="h-full bg-primary-500 w-1/3 animate-pulse" />
        </div>
      </div>
    </div>
  );
};
