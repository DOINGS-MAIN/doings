import { Outlet } from "react-router-dom";
import { AdminAuthProvider } from "@/contexts/AdminAuthContext";

export const AdminAuthShell = () => (
  <AdminAuthProvider>
    <Outlet />
  </AdminAuthProvider>
);
