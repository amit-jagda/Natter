import React from "react";
import { Outlet, Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Mic, PhoneCall, Layers, Settings } from "lucide-react";
import { env } from "@/lib/env";

export const RootLayout: React.FC = () => {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow">
              <PhoneCall className="h-5 w-5" />
            </div>
            <div>
              <Link to="/" className="text-lg font-bold tracking-tight">
                AI Voice Agent Platform
              </Link>
              <div className="text-xs text-muted-foreground">Outbound Voice Campaign Service</div>
            </div>
          </div>

          <nav className="flex items-center gap-6">
            <Link
              to="/"
              className="flex items-center gap-1.5 text-sm font-medium text-foreground/80 hover:text-foreground"
            >
              <Layers className="h-4 w-4" />
              Overview
            </Link>
            <Link
              to="/playground"
              className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80"
            >
              <Mic className="h-4 w-4" />
              Voice Playground
            </Link>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">
                {env.APP_ENV}
              </Badge>
              <Badge variant="secondary" className="gap-1 text-xs">
                <Mic className="h-3 w-3 text-primary" />
                v0.1.0 Foundation
              </Badge>
            </div>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        <div className="container mx-auto px-4">
          Enterprise AI Voice Agent Platform &copy; {new Date().getFullYear()} &bull; Foundation Layer
        </div>
      </footer>
    </div>
  );
};

