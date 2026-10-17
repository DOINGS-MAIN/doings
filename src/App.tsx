import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { RequireAuth } from "@/components/RequireAuth";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import LandingPage from "@/pages/LandingPage";
import ContactPage from "@/pages/ContactPage";
import LoginPage from "@/pages/LoginPage";
import HomePage from "@/pages/dashboard/HomePage";
import EventsPage from "@/pages/dashboard/EventsPage";
import GiftsPage from "@/pages/dashboard/GiftsPage";
import LeaderboardPage from "@/pages/dashboard/LeaderboardPage";
import ProfilePage from "@/pages/dashboard/ProfilePage";
import NotFound from "./pages/NotFound";
import EventScreenPage from "./pages/EventScreenPage";
import AuthCallbackPage from "./pages/AuthCallbackPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import JoinEventLinkPage from "./pages/JoinEventLinkPage";
import RedeemGiveawayLinkPage from "./pages/RedeemGiveawayLinkPage";

import { AdminAuthShell } from "./components/admin/AdminAuthShell";
import { AdminLayout } from "./components/admin/AdminLayout";
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { AdminUsers } from "./pages/admin/AdminUsers";
import { AdminTransactions } from "./pages/admin/AdminTransactions";
import { AdminPayouts } from "./pages/admin/AdminPayouts";
import { AdminBundleOrders } from "./pages/admin/AdminBundleOrders";
import { AdminUser360 } from "./pages/admin/AdminUser360";
import { AdminGiveaways } from "./pages/admin/AdminGiveaways";
import { AdminKYC } from "./pages/admin/AdminKYC";
import { AdminEvents } from "./pages/admin/AdminEvents";
import { AdminLogin } from "./pages/admin/AdminLogin";
import { AdminChangePassword } from "./pages/admin/AdminChangePassword";
import { AdminSettings } from "./pages/admin/AdminSettings";
import { AdminPaymentRails } from "./pages/admin/AdminPaymentRails";
import { AdminFxSettings } from "./pages/admin/AdminFxSettings";
import { AdminTeam } from "./pages/admin/AdminTeam";
import { AdminAuditLog } from "./pages/admin/AdminAuditLog";
import { AdminDanceFloor } from "./pages/admin/AdminDanceFloor";
import { AdminAds } from "./pages/admin/AdminAds";
import { AdminPaymentsOverview } from "./pages/admin/AdminPaymentsOverview";
import { AdminWebhooks } from "./pages/admin/AdminWebhooks";
import { AdminTransactionDetail } from "./pages/admin/AdminTransactionDetail";
import { AdminQueue } from "./pages/admin/AdminQueue";
import { AdminPspEvents } from "./pages/admin/AdminPspEvents";

// Admin data that fails to load says so, instead of showing zeros and empty tables as if real.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err, query) => {
      if (query.queryKey[0] !== "admin") return;
      toast.error(err instanceof Error ? err.message : "Couldn't load admin data");
    },
  }),
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/join/:eventCode" element={<JoinEventLinkPage />} />
          <Route path="/redeem/:code" element={<RedeemGiveawayLinkPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
          <Route path="/events/:eventId/screen" element={<EventScreenPage />} />
          <Route path="/watch/:eventCode" element={<EventScreenPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<DashboardLayout />}>
              <Route path="/home" element={<HomePage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route path="/gifts" element={<GiftsPage />} />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/profile" element={<ProfilePage />} />
            </Route>
          </Route>

          <Route element={<AdminAuthShell />}>
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin/change-password" element={<AdminChangePassword />} />

            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="users/:id" element={<AdminUser360 />} />
              <Route path="transactions" element={<AdminTransactions />} />
              <Route path="transactions/:txnId" element={<AdminTransactionDetail />} />
              <Route path="payouts" element={<AdminPayouts />} />
              <Route path="bundle-orders" element={<AdminBundleOrders />} />
              <Route path="giveaways" element={<AdminGiveaways />} />
              <Route path="payments" element={<AdminPaymentsOverview />} />
              <Route path="queue" element={<AdminQueue />} />
              <Route path="psp-events" element={<AdminPspEvents />} />
              <Route path="webhooks" element={<AdminWebhooks />} />
              <Route path="payment-rails" element={<AdminPaymentRails />} />
              <Route path="fx" element={<AdminFxSettings />} />
              <Route path="dance-floor" element={<AdminDanceFloor />} />
              <Route path="ads" element={<AdminAds />} />
              <Route path="kyc" element={<AdminKYC />} />
              <Route path="events" element={<AdminEvents />} />
              <Route path="team" element={<AdminTeam />} />
              <Route path="audit" element={<AdminAuditLog />} />
              <Route path="settings" element={<AdminSettings />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
