import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuthStore } from '@/stores/authStore';
import { AuthService } from '@/services/AuthService';
import { Mail, Lock, Loader2, Globe } from 'lucide-react';

export const LoginView = () => {
  const { isAuthenticated, user, memberships } = useAuthStore();
  const [view, setView] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Redirigir si está autenticado y tiene membresías
  if (isAuthenticated && user && memberships.length > 0) {
     return <Navigate to="/" replace />;
  }

  // Redirigir a onboarding si está autenticado pero no tiene membresías (Nuevo usuario)
  if (isAuthenticated && user && memberships.length === 0) {
    return <Navigate to="/onboarding" replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    
    setIsProcessing(true);
    setError('');
    
    try {
      await AuthService.login(email.trim(), password);
    } catch (err: any) {
      console.error(err.code, err);
      
      const errorCode = err.code;
      if (errorCode === 'auth/user-not-found' || errorCode === 'auth/invalid-credential') {
        // Verificar si está invitado antes de dar el mensaje final
        try {
          const memberships = await AuthService.getMembershipsByEmail(email.trim());
          if (memberships.length > 0) {
            setError('Esta cuenta aún no tiene contraseña. Haz clic en "Crea tu cuenta aquí" o ingresa con Google.');
          } else {
            setError('Este correo no tiene acceso asignado.');
          }
        } catch (checkErr) {
          setError('Credenciales incorrectas.');
        }
      } else if (errorCode === 'auth/wrong-password') {
        setError('Contraseña incorrecta.');
      } else if (errorCode === 'auth/too-many-requests') {
        setError('Demasiados intentos fallidos. Intenta más tarde.');
      } else {
        setError('Error al iniciar sesión. Verifica tus datos.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError('Escribe tu correo arriba primero, luego toca "¿Olvidaste tu contraseña?".');
      return;
    }
    setIsProcessing(true);
    setError('');
    setInfo('');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfo('Te enviamos un correo para restablecer tu contraseña. Revisa tu bandeja (y spam).');
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        setError('Este correo no tiene cuenta creada todavía.');
      } else {
        setError('No se pudo enviar el correo de restablecimiento. Intenta de nuevo.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !name) return;
    
    setIsProcessing(true);
    setError('');
    
    try {
      await AuthService.register(email.trim(), password, name);
    } catch (err: any) {
      console.error(err);
      if (err.message.includes('acceso asignado')) {
        setError(err.message);
      } else if (err.code === 'auth/email-already-in-use') {
        setError('Este correo ya tiene una cuenta. Inicia sesión directamente.');
      } else if (err.code === 'auth/weak-password') {
        setError('La contraseña debe tener al menos 6 caracteres.');
      } else {
        setError(err.message || 'Error al crear cuenta.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsProcessing(true);
    setError('');
    try {
      await AuthService.loginWithGoogle();
    } catch (err: any) {
      const errorCode = err.code;
      if (errorCode === 'auth/popup-closed-by-user') {
        // El usuario cerró el popup, no es un error crítico
        return;
      } else if (errorCode === 'auth/popup-blocked') {
        setError('El navegador bloqueó la ventana de Google. Por favor, permite las ventanas emergentes.');
      } else if (errorCode === 'auth/unauthorized-domain') {
        setError('Este dominio no está autorizado para usar Google Sign-In. Contacta al soporte.');
      } else if (errorCode === 'auth/operation-not-allowed') {
        setError('Google Sign-In no está habilitado en Firebase. Contacta al Admin.');
      } else if (errorCode === 'auth/account-exists-with-different-credential') {
        setError('Ya existe una cuenta con este correo pero usa otro método de inicio (ej: contraseña).');
      } else if (errorCode === 'auth/user-disabled') {
        setError('Esta cuenta de usuario ha sido deshabilitada.');
      } else if (err.message.includes('acceso asignado') || errorCode === 'permission-denied') {
        setError('Este correo no tiene acceso asignado o hubo un error de permisos.');
      } else {
        setError(`Error de acceso: No se pudo validar tu invitación. Asegúrate de haber sido invitado.`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="flex justify-center mb-8">
          <img src="/brand/logo-smartflow-blue.png" alt="SmartFlow Hub Logo" className="h-16 w-auto object-contain dark:brightness-200" />
        </div>
        <p className="mt-2 text-center text-sm text-slate-600 dark:text-slate-400">
          {view === 'login' ? 'Iniciar sesión en tu portal corporativo' : 'Crear tu cuenta corporativa'}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-slate-900 py-8 px-4 shadow-xl sm:rounded-2xl sm:px-10 border border-slate-100 dark:border-slate-800">
          
          <button
            onClick={handleGoogleLogin}
            disabled={isProcessing}
            className="w-full flex items-center justify-center gap-4 px-6 py-5 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-3xl shadow-xl hover:shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all group mb-8"
          >
            {isProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : (
              <svg className="w-6 h-6" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            <span className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">Continuar con Google</span>
          </button>

          <div className="relative mb-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t-2 border-slate-100 dark:border-slate-800"></div>
            </div>
            <div className="relative flex justify-center text-[10px] font-black uppercase tracking-[0.2em]">
              <span className="px-4 bg-white dark:bg-slate-900 text-slate-400">o usa tu email corporativo</span>
            </div>
          </div>

          <form className="space-y-6" onSubmit={view === 'login' ? handleLogin : handleRegister}>
            {error && (
              <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm font-medium border border-red-200 dark:border-red-800 text-center">
                {error}
              </div>
            )}
            {info && (
              <div className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 p-3 rounded-lg text-sm font-medium border border-emerald-200 dark:border-emerald-800 text-center">
                {info}
              </div>
            )}
            
            {view === 'register' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Nombre completo</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 appearance-none block w-full px-3 py-2.5 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm placeholder-slate-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Juan Perez"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Correo electrónico</label>
              <div className="mt-1 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none block w-full pl-10 px-3 py-2.5 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm placeholder-slate-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="admin@smartflow-suite.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Contraseña</label>
              <div className="mt-1 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none block w-full pl-10 px-3 py-2.5 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm placeholder-slate-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="••••••••"
                />
              </div>
              {view === 'login' && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={isProcessing}
                  className="mt-2 text-xs font-medium text-[#1877F2] hover:underline"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              )}
            </div>

            <div>
              <button
                type="submit"
                disabled={isProcessing}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-[#1877F2] hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : view === 'login' ? 'Acceder al Sistema' : 'Crear Cuenta'}
              </button>
            </div>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setView(view === 'login' ? 'register' : 'login')}
              className="text-sm font-medium text-[#1877F2] hover:text-[#1877F2] transition-colors"
            >
              {view === 'login' ? '¿Ya fuiste invitado? Crea tu cuenta aquí' : '¿Ya tienes cuenta? Inicia sesión'}
            </button>
          </div>
        </div>
        
        <p className="text-center text-xs text-slate-400 mt-6 tracking-widest uppercase">
           SmartFlow Hub OS • v6.2
        </p>
        <p className="text-center text-[10px] text-slate-400 mt-2">
          Al ingresar aceptas nuestra{' '}
          <a href="https://smartflow-suite.com/privacidad" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">Política de Privacidad</a>
          {' '}y el uso de{' '}
          <a href="https://smartflow-suite.com/cookies" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">Cookies</a>.
        </p>
      </div>
    </div>
  );
};
