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
import { PinAccessView } from '@/modules/auth/PinAccessView'
import { MyShiftView } from '@/modules/auth/MyShiftView'
import { CheckoutView } from '@/modules/auth/CheckoutView'
import { MagicOnboardingView } from '@/modules/auth/MagicOnboardingView'
import { TenantSwitcher } from '@/modules/auth/TenantSwitcher'
import { AccessPendingView } from '@/modules/auth/AccessPendingView'
import { AuthLoadingGate } from '@/components/guards/AuthLoadingGate'
import { ProtectedRoute } from '@/components/guards/ProtectedRoute'
import { TenantResolvedGuard } from '@/components/guards/TenantResolvedGuard'
import { RoleGuard } from '@/components/guards/RoleGuard'
import { LandingRedirect } from '@/components/guards/LandingRedirect'
import { FeatureGuard } from '@/components/guards/FeatureGuard'
import { ToolGuard } from '@/components/guards/ToolGuard'

import { useAuthStore } from '@/stores/authStore'
import { SuperAdminGuard } from '@/components/guards/SuperAdminGuard'
import { LiveVideoQaView } from '@/modules/qa/LiveVideoQaView'
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
          <Route path="/acceso" element={<PinAccessView />} />
          <Route path="/mi-turno" element={<ProtectedRoute><MyShiftView /></ProtectedRoute>} />
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
            {/* El Asesor Comercial aterriza en las conversaciones; Owner/Admin/
                SuperAdmin conservan el Dashboard. Ver LandingRedirect. */}
            <Route index element={<LandingRedirect />} />
            <Route path="dashboard" element={<DashboardPageView />} />
            {/* WhatsApp: antes sin ningún guard — es el techo, ToolGuard es
                puramente aditivo (fallback = todos, ver getDefaultToolsForRole). */}
            <Route element={<ToolGuard tool="conversaciones" />}>
              <Route path="conversaciones" element={<ConversationsPageView />} />
            </Route>

            {/* Super Admin Routes Integrated in MainLayout */}
            <Route element={<SuperAdminGuard children={<Outlet />} />}>
              <Route path="super-admin" element={<TenantsListView />} />
              <Route path="super-admin/tools" element={<ToolsHubView />} />
              <Route path="super-admin/agente-global" element={<GlobalAgentView />} />
              <Route path="super-admin/marketing" element={<MarketingView />} />
              <Route path="super-admin/qa-live-video" element={<LiveVideoQaView />} />
            </Route>

            {/* Rutas protegidas por Feature Flag (tenant) + ToolGuard (usuario) */}
            <Route element={<FeatureGuard feature="hasCrm" />}>
              <Route element={<ToolGuard tool="crm" />}>
                <Route path="crm" element={<CRMPageView />} />
              </Route>
            </Route>
            {/* Catálogo, Cotizaciones y Paquetes son ADMINISTRACIÓN comercial:
                productos maestros, plantillas y paquetes los define Owner/Admin.
                El asesor no navega acá, pero sigue usando esos recursos DESDE la
                conversación (elegir un producto, mandar una cotización) — esas
                acciones no pasan por estos guards. */}
            <Route element={<RoleGuard allowedRoles={['Admin', 'Owner']} />}>
              <Route element={<FeatureGuard feature="hasQuotes" />}>
                <Route element={<ToolGuard tool="cotizaciones" />}>
                  <Route path="cotizaciones" element={<QuotesListView />} />
                </Route>
              </Route>
              <Route element={<FeatureGuard feature="hasCatalog" />}>
                <Route element={<ToolGuard tool="catalogo" />}>
                  <Route path="catalogo" element={<CatalogPageView />} />
                </Route>
              </Route>
              <Route path="paquetes" element={<PackagesListView />} />
            </Route>
            <Route element={<FeatureGuard feature="hasAgenda" />}>
              <Route element={<ToolGuard tool="agenda" />}>
                <Route path="agenda" element={<AgendaPageView />} />
              </Route>
            </Route>
            {/* Multi-Agente / Agente IA / Auditor IA: sus PANELES son
                administrativos, así que además del ToolGuard llevan RoleGuard —
                defensa en profundidad, para que escribir la URL a mano tampoco
                sirva aunque alguien marque la herramienta por error en la ficha
                del usuario. Los procesos de fondo no se tocan: el Auditor sigue
                analizando todo el tenant, el Agente IA sigue respondiendo y el
                asesor sigue siendo elegible para los leads del Multi-Agente. */}
            <Route element={<RoleGuard allowedRoles={['Admin', 'Owner']} />}>
              <Route element={<FeatureGuard feature="hasAiAgent" />}>
                <Route element={<ToolGuard tool="ai-agent" />}>
                  <Route path="ai-agent" element={<AIAgentView />} />
                </Route>
              </Route>
              <Route element={<FeatureGuard feature="hasMultiAgentPanel" />}>
                <Route element={<ToolGuard tool="multi-agent" />}>
                  <Route path="multi-agent" element={<MultiAgentView />} />
                </Route>
              </Route>
              <Route element={<FeatureGuard feature="hasQualityAuditor" />}>
                <Route element={<ToolGuard tool="auditoria" />}>
                  <Route path="auditoria" element={<QualityAuditorView />} />
                </Route>
              </Route>
            </Route>
            <Route element={<RoleGuard allowedRoles={['Admin', 'Owner']} />}>
              <Route element={<FeatureGuard feature="hasPaymentLinks" />}>
                <Route element={<ToolGuard tool="pagos" />}>
                  <Route path="pagos" element={<PaymentsView />} />
                </Route>
              </Route>
            </Route>
            <Route path="tareas" element={<TasksView />} />
            <Route element={<RoleGuard allowedRoles={['Admin', 'Owner']} />}>
              <Route path="tienda" element={<MarketplaceView />} />
            </Route>
            {/* Mi Suscripción es administración del negocio (plan, cobros del
                servicio): antes no tenía NINGÚN guard y cualquier vendedor podía
                abrirla escribiendo la URL. */}
            <Route element={<RoleGuard allowedRoles={['Admin', 'Owner']} />}>
              <Route path="suscripcion" element={<SubscriptionView />} />
            </Route>
            <Route path="academia" element={<AcademiaView />} />
            <Route path="partners" element={<PartnersView />} />

            {/* Rutas Privilegiadas (Role Guard = techo real; ToolGuard solo puede
                estrechar DENTRO de lo que el rol ya permite, nunca ampliarlo) */}
            <Route element={<RoleGuard allowedRoles={['Admin', 'Owner']} />}>
              <Route path="admin-mail" element={<AdminMailView />} />
            </Route>
            <Route element={<RoleGuard allowedRoles={['Admin', 'Owner']} />}>
              <Route element={<ToolGuard tool="usuarios" />}>
                <Route path="usuarios" element={<UsersManagementView />} />
              </Route>
              <Route element={<ToolGuard tool="configuracion" />}>
                <Route path="configuracion" element={<SettingsView />} />
              </Route>
              <Route element={<FeatureGuard feature="hasIntegrations" />}>
                <Route element={<ToolGuard tool="integraciones" />}>
                  <Route path="integraciones" element={<IntegrationsPlaceholderView />} />
                </Route>
              </Route>
            </Route>
          </Route>
        </Routes>
      </AuthLoadingGate>
    </BrowserRouter>
  )
}
