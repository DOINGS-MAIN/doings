import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { RequireAuth } from "@/components/RequireAuth";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import { RootRedirect } from "@/pages/RootRedirect";
import LoginPage from "@/pages/LoginPage";
import HomePage from "@/pages/dashboard/HomePage";
import EventsPage from "@/pages/dashboard/EventsPage";
import GiftsPage from "@/pages/dashboard/GiftsPage";
import LeaderboardPage from "@/pages/dashboard/LeaderboardPage";
import ProfilePage from "@/pages/dashboard/ProfilePage";
import NotFound from "./pages/NotFound";
import EventScreenPage from "./pages/EventScreenPage";

import { AdminLayout } from "./components/admin/AdminLayout";
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { AdminUsers } from "./pages/admin/AdminUsers";
import { AdminTransactions } from "./pages/admin/AdminTransactions";
import { AdminKYC } from "./pages/admin/AdminKYC";
import { AdminEvents } from "./pages/admin/AdminEvents";
import { AdminLogin } from "./pages/admin/AdminLogin";
import { AdminChangePassword } from "./pages/admin/AdminChangePassword";
import { AdminSettings } from "./pages/admin/AdminSettings";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginPage />} />

          <Route element={<RequireAuth />}>
            <Route path="/events/:eventId/screen" element={<EventScreenPage />} />
            <Route element={<DashboardLayout />}>
              <Route path="/home" element={<HomePage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route path="/gifts" element={<GiftsPage />} />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/profile" element={<ProfilePage />} />
            </Route>
          </Route>

          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin/change-password" element={<AdminChangePassword />} />

          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="transactions" element={<AdminTransactions />} />
            <Route path="kyc" element={<AdminKYC />} />
            <Route path="events" element={<AdminEvents />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
