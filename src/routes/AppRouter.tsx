import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { DashboardPageView } from '@/modules/dashboard/DashboardPageView'
import { ConversationsPageView } from '@/modules/conversations/ConversationsPageView'
import { CRMPageView } from '@/modules/crm/CRMPageView'
import { PackagesListView } from '@/modules/packages/PackagesListView'
import { QuotesListView } from '@/modules/quotes/QuotesListView'
import { AgendaPageView } from '@/modules/agenda/AgendaPageView'
import { UsersManagementView } from '@/modules/users/UsersManagementView'
import { SettingsView } from '@/modules/settings/SettingsView'
import { IntegrationsPlaceholderView } from '@/modules/integrations/IntegrationsPlaceholderView'

// Auth & Guards
import { LoginView } from '@/modules/auth/LoginView'
import { TenantSwitcher } from '@/modules/auth/TenantSwitcher'
import { AccessPendingView } from '@/modules/auth/AccessPendingView'
import { AuthLoadingGate } from '@/components/guards/AuthLoadingGate'
import { ProtectedRoute } from '@/components/guards/ProtectedRoute'
import { TenantResolvedGuard } from '@/components/guards/TenantResolvedGuard'
import { RoleGuard } from '@/components/guards/RoleGuard'

import { useAuthStore } from '@/stores/authStore'

export const AppRouter = () => {
  const { initializeAuthListener } = useAuthStore();

  useEffect(() => {
    initializeAuthListener();
  }, [initializeAuthListener]);

  return (
    <BrowserRouter>
      <AuthLoadingGate>
        <Routes>
          {/* Rutas Públicas / Accesos sin Tenant */}
          <Route path="/login" element={<LoginView />} />
          <Route path="/switch-tenant" element={<ProtectedRoute><TenantSwitcher /></ProtectedRoute>} />
          <Route path="/access-pending" element={<ProtectedRoute><AccessPendingView /></ProtectedRoute>} />

          {/* Rutas Principales Protegidas a nivel Auth y Tenant */}
          <Route 
             path="/" 
             element={
               <ProtectedRoute>
                 <TenantResolvedGuard>
                   <MainLayout />
                 </TenantResolvedGuard>
               </ProtectedRoute>
             }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPageView />} />
            <Route path="conversaciones" element={<ConversationsPageView />} />
            <Route path="crm" element={<CRMPageView />} />
            <Route path="paquetes" element={<PackagesListView />} />
            <Route path="cotizaciones" element={<QuotesListView />} />
            <Route path="agenda" element={<AgendaPageView />} />
            
            {/* Rutas Privilegiadas (Role Guard) */}
            <Route element={<RoleGuard allowedRoles={['Admin', 'Owner']} />}>
              <Route path="usuarios" element={<UsersManagementView />} />
              <Route path="configuracion" element={<SettingsView />} />
              <Route path="integraciones" element={<IntegrationsPlaceholderView />} />
            </Route>
          </Route>
        </Routes>
      </AuthLoadingGate>
    </BrowserRouter>
  )
}
