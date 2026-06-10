"use client";

import { useState, useRef, useCallback } from "react";
import { useEscape } from "@/lib/use-escape";

type User = {
  id: string;
  email: string | null;
  name: string;
  role: string;
  groupName?: string;
  totpEnabled: boolean;
};

const GROUP_BADGE: Record<string, string> = {
  Admin: "bg-amber-700 text-amber-100",
  "Super User": "bg-blue-700 text-blue-100",
  Scheduler: "bg-emerald-700 text-emerald-100",
  Staff: "bg-slate-600 text-slate-300",
};

export function AccountPage({ user }: { user: User }) {
  const [totpEnabled, setTotpEnabled] = useState(user.totpEnabled);
  const [setupState, setSetupState] = useState<"idle" | "scanning" | "verifying">("idle");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [pwForm, setPwForm] = useState({ current: "", new_: "", confirm: "" });
  const [pwError, setPwError] = useState("");
  const cancel2FA = useCallback(() => {
    if (setupState !== "idle") {
      setSetupState("idle");
      setQrCode("");
      setSecret("");
      setDigits(["", "", "", "", "", ""]);
      setError("");
    }
  }, [setupState]);
  useEscape(cancel2FA);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  async function handlePasswordChange() {
    setPwError("");
    setPwSuccess(false);
    if (pwForm.new_ !== pwForm.confirm) {
      setPwError("Passwords do not match");
      return;
    }
    setPwLoading(true);
    const res = await fetch("/api/auth/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.new_ }),
    });
    if (!res.ok) {
      const data = await res.json();
      setPwError(data.error);
      setPwLoading(false);
      return;
    }
    setPwForm({ current: "", new_: "", confirm: "" });
    setPwSuccess(true);
    setPwLoading(false);
  }

  async function startSetup() {
    setError("");
    const res = await fetch("/api/auth/totp");
    if (!res.ok) { setError("Failed to generate setup code"); return; }
    const data = await res.json();
    setQrCode(data.qrCode);
    setSecret(data.secret);
    setSetupState("scanning");
  }

  async function verifyCode(code: string) {
    setError("");
    const res = await fetch("/api/auth/totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, code }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Verification failed");
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
      return;
    }
    setTotpEnabled(true);
    setSetupState("idle");
    setQrCode("");
    setSecret("");
  }

  async function disable2FA() {
    if (!confirm("Disable two-factor authentication?")) return;
    const res = await fetch("/api/auth/totp", { method: "DELETE" });
    if (res.ok) setTotpEnabled(false);
  }

  function handleInput(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;
    const newDigits = [...digits];
    newDigits[index] = value.slice(-1);
    setDigits(newDigits);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
    if (newDigits.every((d) => d) && newDigits.join("").length === 6) {
      verifyCode(newDigits.join(""));
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      setDigits(text.split(""));
      verifyCode(text);
    }
  }

  return (
    <main className="flex-1 p-6 bg-slate-950 text-slate-100">
      <div className="max-w-lg mx-auto space-y-8">
        <h1 className="text-xl font-bold">Account</h1>

        <section className="bg-slate-800 rounded border border-slate-700 p-4 space-y-3">
          <h2 className="text-sm font-medium text-slate-300">Profile</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-slate-500">Name</span>
              <p>{user.name}</p>
            </div>
            <div>
              <span className="text-slate-500">Email</span>
              <p className="text-slate-400">{user.email ?? "—"}</p>
            </div>
            <div>
              <span className="text-slate-500">Group</span>
              <p>
                <span className={`text-xs px-1.5 py-0.5 rounded ${GROUP_BADGE[user.groupName ?? ""] || "bg-slate-600 text-slate-300"}`}>
                  {user.groupName || user.role}
                </span>
              </p>
            </div>
          </div>
        </section>

        <section className="bg-slate-800 rounded border border-slate-700 p-4 space-y-3">
          <h2 className="text-sm font-medium text-slate-300">Change Password</h2>
          <div className="space-y-3 max-w-xs">
            <input
              placeholder="Current password"
              type="password"
              autoComplete="current-password"
              value={pwForm.current}
              onChange={(e) => { setPwForm({ ...pwForm, current: e.target.value }); setPwSuccess(false); }}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              placeholder="New password"
              type="password"
              autoComplete="new-password"
              value={pwForm.new_}
              onChange={(e) => { setPwForm({ ...pwForm, new_: e.target.value }); setPwSuccess(false); }}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              placeholder="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={pwForm.confirm}
              onChange={(e) => { setPwForm({ ...pwForm, confirm: e.target.value }); setPwSuccess(false); }}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-500">Min 8 characters, uppercase, lowercase, and a number</p>
            {pwError && <p className="text-sm text-red-400">{pwError}</p>}
            {pwSuccess && <p className="text-sm text-green-400">Password updated</p>}
            <button
              onClick={handlePasswordChange}
              disabled={pwLoading || !pwForm.current || !pwForm.new_ || !pwForm.confirm}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 rounded transition-colors"
            >
              {pwLoading ? "Updating..." : "Update password"}
            </button>
          </div>
        </section>

        <section className="bg-slate-800 rounded border border-slate-700 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-slate-300">Two-Factor Authentication</h2>
              <p className="text-xs text-slate-500 mt-1">
                {totpEnabled
                  ? "Your account is protected with 2FA"
                  : "Add an extra layer of security to your account"}
              </p>
            </div>
            {totpEnabled ? (
              <span className="text-xs px-2 py-1 rounded bg-green-800 text-green-200">Enabled</span>
            ) : (
              <span className="text-xs px-2 py-1 rounded bg-slate-600 text-slate-400">Disabled</span>
            )}
          </div>

          {setupState === "idle" && !totpEnabled && (
            <button
              onClick={startSetup}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors"
            >
              Set up 2FA
            </button>
          )}

          {setupState === "idle" && totpEnabled && (
            <button
              onClick={disable2FA}
              className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 border border-red-800 hover:border-red-700 rounded transition-colors"
            >
              Disable 2FA
            </button>
          )}

          {setupState === "scanning" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-400">
                Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.)
              </p>
              <div className="flex justify-center">
                <div className="bg-white p-3 rounded">
                  <img src={qrCode} alt="2FA QR Code" width={200} height={200} />
                </div>
              </div>
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer hover:text-slate-400">
                  Can&#39;t scan? Enter this key manually
                </summary>
                <code className="block mt-2 p-2 bg-slate-900 rounded font-mono text-slate-400 break-all select-all">
                  {secret}
                </code>
              </details>
              <button
                onClick={() => {
                  setSetupState("verifying");
                  setTimeout(() => inputRefs.current[0]?.focus(), 100);
                }}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors"
              >
                I&#39;ve scanned it
              </button>
              <button
                onClick={() => { setSetupState("idle"); setQrCode(""); setSecret(""); }}
                className="ml-2 px-3 py-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {setupState === "verifying" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-400">
                Enter the 6-digit code from your authenticator app to confirm setup
              </p>
              <div className="flex justify-center gap-2" onPaste={handlePaste}>
                {digits.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleInput(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    className="w-11 h-13 text-center text-xl font-mono bg-slate-900 border border-slate-700 rounded text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                ))}
              </div>
              {error && <p className="text-sm text-red-400 text-center">{error}</p>}
              <button
                onClick={() => {
                  setSetupState("scanning");
                  setDigits(["", "", "", "", "", ""]);
                  setError("");
                }}
                className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                Back
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
