import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { DashboardPageView } from '@/modules/dashboard/DashboardPageView'
import { ConversationsPageView } from '@/modules/conversations/ConversationsPageView'
import { CRMPageView } from '@/modules/crm/CRMPageView'
import { PackagesListView } from '@/modules/packages/PackagesListView'
import { QuotesListView } from '@/modules/quotes/QuotesListView'
import { CatalogPageView } from '@/modules/catalog/CatalogPageView'
import { AgendaPageView } from '@/modules/agenda/AgendaPageView'
import { UsersManagementView } from '@/modules/users/UsersManagementView'
import { SettingsView } from '@/modules/settings/SettingsView'
import { IntegrationsPlaceholderView } from '@/modules/integrations/IntegrationsPlaceholderView'
import { AIAgentView } from '@/modules/ai-agent/AIAgentView'
import { MultiAgentView } from '@/modules/multi-agent/MultiAgentView'
import { QualityAuditorView } from '@/modules/auditor/QualityAuditorView'
import { PaymentsView } from '@/modules/payments/PaymentsView'
import { MarketplaceView } from '@/modules/marketplace/MarketplaceView'
import { SubscriptionView } from '@/modules/subscription/SubscriptionView'
import { TasksView } from '@/modules/tasks/TasksView'
import { PublicPaymentView } from '@/modules/payments/PublicPaymentView'
import { AdminMailView } from '@/modules/admin-mail/AdminMailView'
import { AcademiaView } from '@/modules/academia/AcademiaView'
import { PartnersView } from '@/modules/partners/PartnersView'

// Auth & Guards
import { LoginView } from '@/modules/auth/LoginView'
import { CheckoutView } from '@/modules/auth/CheckoutView'
import { MagicOnboardingView } from '@/modules/auth/MagicOnboardingView'
import { TenantSwitcher } from '@/modules/auth/TenantSwitcher'
import { AccessPendingView } from '@/modules/auth/AccessPendingView'
import { AuthLoadingGate } from '@/components/guards/AuthLoadingGate'
import { ProtectedRoute } from '@/components/guards/ProtectedRoute'
import { TenantResolvedGuard } from '@/components/guards/TenantResolvedGuard'
import { RoleGuard } from '@/components/guards/RoleGuard'
import { FeatureGuard } from '@/components/guards/FeatureGuard'

import { useAuthStore } from '@/stores/authStore'
import { SuperAdminGuard } from '@/components/guards/SuperAdminGuard'
import { TenantsListView } from '@/modules/superadmin/TenantsListView'
import { ToolsHubView } from '@/modules/superadmin/ToolsHubView'
import { MarketingView } from '@/modules/superadmin/MarketingView'
import { GlobalAgentView } from '@/modules/superadmin/GlobalAgentView'
import { TenantEntryView } from '@/modules/superadmin/TenantEntryView'

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
          <Route path="/checkout" element={<CheckoutView />} />
          <Route path="/onboarding" element={<ProtectedRoute><MagicOnboardingView /></ProtectedRoute>} />
          <Route path="/switch-tenant" element={<ProtectedRoute><TenantSwitcher /></ProtectedRoute>} />
          <Route path="/enter-tenant/:tenantId" element={<ProtectedRoute><TenantEntryView /></ProtectedRoute>} />
          <Route path="/access-pending" element={<ProtectedRoute><AccessPendingView /></ProtectedRoute>} />
          <Route path="/pay/:id" element={<PublicPaymentView />} />

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

            {/* Super Admin Routes Integrated in MainLayout */}
            <Route element={<SuperAdminGuard children={<Outlet />} />}>
              <Route path="super-admin" element={<TenantsListView />} />
              <Route path="super-admin/tools" element={<ToolsHubView />} />
              <Route path="super-admin/agente-global" element={<GlobalAgentView />} />
              <Route path="super-admin/marketing" element={<MarketingView />} />
            </Route>

            {/* Rutas protegidas por Feature Flag */}
            <Route element={<FeatureGuard feature="hasCrm" />}>
              <Route path="crm" element={<CRMPageView />} />
            </Route>
            <Route element={<FeatureGuard feature="hasQuotes" />}>
              <Route path="cotizaciones" element={<QuotesListView />} />
            </Route>
            <Route element={<FeatureGuard feature="hasCatalog" />}>
              <Route path="catalogo" element={<CatalogPageView />} />
            </Route>
            <Route path="paquetes" element={<PackagesListView />} />
            <Route element={<FeatureGuard feature="hasAgenda" />}>
              <Route path="agenda" element={<AgendaPageView />} />
            </Route>
            <Route element={<FeatureGuard feature="hasAiAgent" />}>
              <Route path="ai-agent" element={<AIAgentView />} />
            </Route>
            <Route element={<FeatureGuard feature="hasMultiAgent" />}>
              <Route path="multi-agent" element={<MultiAgentView />} />
            </Route>
            <Route element={<FeatureGuard feature="hasQualityAuditor" />}>
              <Route path="auditoria" element={<QualityAuditorView />} />
            </Route>
            <Route element={<FeatureGuard feature="hasPaymentLinks" />}>
              <Route path="pagos" element={<PaymentsView />} />
            </Route>
            <Route path="tareas" element={<TasksView />} />
            <Route path="tienda" element={<MarketplaceView />} />
            <Route path="suscripcion" element={<SubscriptionView />} />
            <Route path="academia" element={<AcademiaView />} />
            <Route path="partners" element={<PartnersView />} />
            
            {/* Rutas Privilegiadas (Role Guard) */}
            <Route element={<RoleGuard allowedRoles={['Admin', 'Owner']} />}>
              <Route path="admin-mail" element={<AdminMailView />} />
            </Route>
            <Route element={<RoleGuard allowedRoles={['Admin', 'Owner']} />}>
              <Route path="usuarios" element={<UsersManagementView />} />
              <Route path="configuracion" element={<SettingsView />} />
              <Route element={<FeatureGuard feature="hasIntegrations" />}>
                <Route path="integraciones" element={<IntegrationsPlaceholderView />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </AuthLoadingGate>
    </BrowserRouter>
  )
}
