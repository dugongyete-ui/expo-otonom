import React, { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import ChatPage from "@/pages/chat";
import LoginPage from "@/pages/login";
import { getToken, isTokenValid, setTokens, getAuthMode } from "@/lib/auth";

function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading");

  const checkAuth = async () => {
    const token = getToken();
    if (isTokenValid(token)) {
      setStatus("authenticated");
      return;
    }
    const mode = await getAuthMode();
    if (mode === "none") {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "", password: "" }),
        });
        const data = await res.json();
        if (data.access_token) {
          setTokens(data.access_token, data.refresh_token || "");
          setStatus("authenticated");
          return;
        }
      } catch {}
    }
    setStatus("unauthenticated");
  };

  useEffect(() => {
    checkAuth();
  }, []);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#0A0A0C] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <img src="/favicon.ico" alt="Dzeck AI" className="w-12 h-12 opacity-80" onError={e => (e.currentTarget.style.display = "none")} />
          <div className="flex gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#6C5CE7] animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 rounded-full bg-[#6C5CE7] animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 rounded-full bg-[#6C5CE7] animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <LoginPage onAuthenticated={() => setStatus("authenticated")} />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={ChatPage} />
      <Route path="/chat" component={ChatPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthGate>
          <Router />
        </AuthGate>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
