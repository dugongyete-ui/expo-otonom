import React, { useState, useEffect, useCallback } from "react";
import { Loader2, Eye, EyeOff, AlertCircle, CheckCircle, Sparkles } from "lucide-react";
import { getAuthMode, loginApi, registerApi, setTokens } from "@/lib/auth";

type Screen = "login" | "register" | "reset";

interface LoginPageProps {
  onAuthenticated: () => void;
}

export default function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [screen, setScreen] = useState<Screen>("login");
  const [authMode, setAuthMode] = useState<"none" | "local" | "password" | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullname, setFullname] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    getAuthMode().then(setAuthMode);
  }, []);

  const canRegister = authMode === "password";
  const canResetPassword = authMode === "password";

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) { setError("Email is required"); return; }
    if (!password) { setError("Password is required"); return; }
    setIsLoading(true);
    try {
      const result = await loginApi(email.trim(), password);
      setTokens(result.access_token, result.refresh_token);
      setSuccess("Login successful! Welcome back.");
      setTimeout(() => onAuthenticated(), 500);
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  }, [email, password, onAuthenticated]);

  const handleRegister = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!fullname.trim() || fullname.trim().length < 2) { setError("Full name must be at least 2 characters"); return; }
    if (!email.trim() || !email.includes("@")) { setError("Please enter a valid email"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    setIsLoading(true);
    try {
      const result = await registerApi(email.trim(), password, fullname.trim());
      setTokens(result.access_token, result.refresh_token);
      setSuccess("Registration successful!");
      setTimeout(() => onAuthenticated(), 500);
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setIsLoading(false);
    }
  }, [email, password, confirmPassword, fullname, onAuthenticated]);

  const handleResetPassword = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) { setError("Email is required"); return; }
    setIsLoading(true);
    try {
      await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setSuccess("If this email exists, a reset link has been sent.");
    } catch {
      setSuccess("If this email exists, a reset link has been sent.");
    } finally {
      setIsLoading(false);
    }
  }, [email]);

  if (authMode === null) {
    return (
      <div className="min-h-screen bg-[#0A0A0C] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#6C5CE7] animate-spin" />
      </div>
    );
  }

  const handleSubmit = screen === "login" ? handleLogin : screen === "register" ? handleRegister : handleResetPassword;
  const submitLabel = screen === "login" ? "Login" : screen === "register" ? "Register" : "Send Reset Link";

  return (
    <div className="min-h-screen bg-[#0A0A0C] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-10 gap-2">
          <Sparkles className="w-12 h-12 text-[#6C5CE7]" />
          <h1 className="text-3xl font-bold text-white tracking-tight">Dzeck AI</h1>
          <p className="text-xs text-[#636366] tracking-[0.15em] uppercase">Autonomous AI Agent</p>
        </div>

        <div className="bg-[#1A1A20] border border-[#2C2C30] rounded-2xl p-6 flex flex-col gap-4">
          <h2 className="text-xl font-bold text-white">
            {screen === "login" ? "Login to Dzeck AI" : screen === "register" ? "Register" : "Reset Password"}
          </h2>

          {error && (
            <div className="flex items-center gap-2 bg-[#FF453A20] border border-[#FF453A40] rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-[#FF453A] shrink-0" />
              <span className="text-[#FF453A] text-sm">{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 bg-[#30D15820] border border-[#30D15840] rounded-lg px-3 py-2.5">
              <CheckCircle className="w-4 h-4 text-[#30D158] shrink-0" />
              <span className="text-[#30D158] text-sm">{success}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {screen === "register" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-[#8E8E93] font-medium">Full Name</label>
                <input
                  type="text"
                  className="bg-[#0A0A0C] border border-[#2C2C30] rounded-xl px-3.5 py-3 text-white text-sm placeholder-[#636366] focus:outline-none focus:border-[#6C5CE7] transition-colors"
                  placeholder="Enter your full name"
                  value={fullname}
                  onChange={e => setFullname(e.target.value)}
                  autoComplete="name"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-[#8E8E93] font-medium">Email</label>
              <input
                type="email"
                className="bg-[#0A0A0C] border border-[#2C2C30] rounded-xl px-3.5 py-3 text-white text-sm placeholder-[#636366] focus:outline-none focus:border-[#6C5CE7] transition-colors"
                placeholder="Enter your email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            {screen !== "reset" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-[#8E8E93] font-medium">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    className="w-full bg-[#0A0A0C] border border-[#2C2C30] rounded-xl px-3.5 py-3 pr-11 text-white text-sm placeholder-[#636366] focus:outline-none focus:border-[#6C5CE7] transition-colors"
                    placeholder="Enter password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete={screen === "login" ? "current-password" : "new-password"}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#636366] hover:text-[#8E8E93]"
                    onClick={() => setShowPassword(v => !v)}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            )}

            {screen === "register" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-[#8E8E93] font-medium">Confirm Password</label>
                <input
                  type={showPassword ? "text" : "password"}
                  className="bg-[#0A0A0C] border border-[#2C2C30] rounded-xl px-3.5 py-3 text-white text-sm placeholder-[#636366] focus:outline-none focus:border-[#6C5CE7] transition-colors"
                  placeholder="Enter password again"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            )}

            {screen === "login" && canResetPassword && (
              <button
                type="button"
                className="self-end text-sm text-[#6C5CE7] hover:underline -mt-2"
                onClick={() => { setScreen("reset"); setError(""); setSuccess(""); }}
              >
                Forgot Password?
              </button>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="bg-[#6C5CE7] hover:bg-[#5a4dd4] disabled:opacity-60 text-white font-semibold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors mt-1"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : submitLabel}
            </button>
          </form>

          {screen === "login" && canRegister && (
            <button
              className="text-center text-sm text-[#636366]"
              onClick={() => { setScreen("register"); setError(""); setSuccess(""); }}
            >
              Don't have an account?{" "}
              <span className="text-[#6C5CE7] font-semibold">Register</span>
            </button>
          )}

          {screen === "register" && (
            <button
              className="text-center text-sm text-[#636366]"
              onClick={() => { setScreen("login"); setError(""); setSuccess(""); }}
            >
              Already have an account?{" "}
              <span className="text-[#6C5CE7] font-semibold">Login</span>
            </button>
          )}

          {screen === "reset" && (
            <button
              className="text-center text-sm text-[#6C5CE7] font-semibold"
              onClick={() => { setScreen("login"); setError(""); setSuccess(""); }}
            >
              ← Back to Login
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
