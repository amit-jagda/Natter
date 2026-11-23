import React from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import {
  LogOut,
  PhoneCall,
  ArrowRight,
  LayoutDashboard,
} from "lucide-react";

export const RootLayout: React.FC = () => {
  const { isAuthenticated, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const isHospitalRoute = location.pathname.startsWith("/hospital");

  // Hospital Workspace has its own dedicated full-screen layout with left sidebar
  if (isHospitalRoute) {
    return <Outlet />;
  }

  return (
    <div className="flex min-h-screen flex-col app-product-bg text-[#150f26] dark:text-[#f6f3ff] font-['Figtree',system-ui,sans-serif] antialiased transition-colors">
      {/* Top Header Bar */}
      <div className="sticky top-0 z-50 px-3 sm:px-6 pt-3 pb-2">
        <header className="max-w-7xl mx-auto w-full backdrop-blur-xl bg-white/95 dark:bg-[#120e1f]/95 border border-[#e6e0f5] dark:border-[#2b2347] rounded-2xl sm:rounded-3xl shadow-[0_4px_20px_-4px_rgba(21,15,38,0.06)]">
          <div className="h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          {/* Brand Logo */}
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-[38px] h-[38px] rounded-[12px] bg-gradient-to-br from-[#6d28d9] to-[#9333ea] flex items-center justify-center text-white shadow-md shadow-purple-600/30 group-hover:scale-105 transition-transform">
              <PhoneCall className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base sm:text-lg text-[#150f26] dark:text-white tracking-tight">
                Hospital Voice Agent
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-100/60 dark:bg-purple-950/60 text-[#7c3aed] dark:text-purple-300 border border-[#e6e0f5] dark:border-[#2b2347] font-semibold hidden sm:inline">
                Workspace Edition
              </span>
            </div>
          </Link>

          {/* Right Header Actions */}
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <div className="flex items-center gap-2 sm:gap-3">
                <Link
                  to="/hospital"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-semibold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 transition-all"
                >
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  <span>Open Workspace</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[#625b7e] dark:text-[#a29bc2] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-semibold transition-all cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/login"
                  className="px-3.5 py-2 text-xs font-semibold text-[#625b7e] hover:text-[#150f26] dark:text-[#a29bc2] dark:hover:text-white transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  to="/register"
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-[#6d28d9] to-[#9333ea] hover:brightness-105 shadow-md shadow-purple-600/30 active:scale-95 transition-all cursor-pointer"
                >
                  <span>Register Hospital</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>
    </div>

      {/* Main Content */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-[#e6e0f5] dark:border-[#2b2347] bg-white/70 dark:bg-black/70 py-6 text-center text-xs text-[#625b7e] dark:text-[#a29bc2]">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#150f26] dark:text-white">Hospital Voice Agent</span>
            <span>&bull;</span>
            <span>Autonomous Healthcare Voice Dispatch</span>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <span>FastAPI Monolith</span>
            <span>PostgreSQL 16 Multi-Tenant</span>
            <span>Redis 7 Arq Worker</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
