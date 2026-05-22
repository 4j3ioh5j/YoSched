"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense, useRef } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"credentials" | "totp">("credentials");
  const [savedEmail, setSavedEmail] = useState("");
  const [savedPassword, setSavedPassword] = useState("");
  const totpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [totpDigits, setTotpDigits] = useState(["", "", "", "", "", ""]);
  const [rememberDevice, setRememberDevice] = useState(true);

  async function handleCredentials(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const check = await fetch("/api/auth/pre-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!check.ok) {
      const data = await check.json();
      setError(data.error || "Invalid email or password");
      setLoading(false);
      return;
    }

    const { requiresTotp } = await check.json();

    if (requiresTotp) {
      setSavedEmail(email);
      setSavedPassword(password);
      setStep("totp");
      setLoading(false);
      setTimeout(() => totpRefs.current[0]?.focus(), 100);
      return;
    }

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Authentication failed");
      setLoading(false);
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  }

  async function handleTotp(code: string) {
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email: savedEmail,
      password: savedPassword,
      totpCode: code,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid verification code");
      setTotpDigits(["", "", "", "", "", ""]);
      totpRefs.current[0]?.focus();
      setLoading(false);
    } else {
      if (rememberDevice) {
        await fetch("/api/auth/trust-device", { method: "POST" });
      }
      router.push(callbackUrl);
      router.refresh();
    }
  }

  function handleTotpInput(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;
    const newDigits = [...totpDigits];
    newDigits[index] = value.slice(-1);
    setTotpDigits(newDigits);

    if (value && index < 5) {
      totpRefs.current[index + 1]?.focus();
    }

    if (newDigits.every((d) => d) && newDigits.join("").length === 6) {
      handleTotp(newDigits.join(""));
    }
  }

  function handleTotpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !totpDigits[index] && index > 0) {
      totpRefs.current[index - 1]?.focus();
    }
  }

  function handleTotpPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      const newDigits = text.split("");
      setTotpDigits(newDigits);
      handleTotp(text);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)" }}
    >
      <div
        className="fixed inset-0 animate-[drift_20s_linear_infinite]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(99,179,237,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(99,179,237,0.03) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />
      <div className="w-full max-w-sm mx-4 relative z-10">
        <div className="text-center mb-12">
          <h1
            className="text-6xl font-extrabold tracking-tight"
            style={{ textShadow: "0 0 40px rgba(99, 179, 237, 0.3)" }}
          >
            <span className="text-white">Yo</span>
            <span style={{ color: "#63b3ed" }}>Sched</span>
          </h1>
          <p className="text-lg text-white/40 font-light mt-2">Staff Scheduling</p>
        </div>

        {step === "credentials" ? (
          <form onSubmit={handleCredentials} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-400 mb-1">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400/50 focus:border-transparent backdrop-blur-sm"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-400 mb-1">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400/50 focus:border-transparent backdrop-blur-sm"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="pt-6">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-sky-500/80 hover:bg-sky-500 disabled:bg-sky-800/50 disabled:text-slate-400 text-white font-medium rounded transition-colors backdrop-blur-sm"
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-6">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-sky-500/10 border border-sky-500/20 mb-3">
                <svg className="w-6 h-6 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <p className="text-sm text-slate-400">
                Enter the 6-digit code from your authenticator app
              </p>
            </div>
            <div className="flex justify-center gap-2" onPaste={handleTotpPaste}>
              {totpDigits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { totpRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleTotpInput(i, e.target.value)}
                  onKeyDown={(e) => handleTotpKeyDown(i, e)}
                  disabled={loading}
                  className="w-11 h-13 text-center text-xl font-mono bg-white/5 border border-white/10 rounded text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400/50 focus:border-transparent backdrop-blur-sm disabled:opacity-50"
                />
              ))}
            </div>
            <label className="flex items-center justify-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
              />
              <span className="text-sm text-slate-400">Remember this device for 30 days</span>
            </label>
            {error && <p className="text-sm text-red-400 text-center">{error}</p>}
            <button
              onClick={() => {
                setStep("credentials");
                setError("");
                setTotpDigits(["", "", "", "", "", ""]);
              }}
              className="block mx-auto text-sm text-slate-500 hover:text-slate-300 transition-colors"
            >
              Back to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
