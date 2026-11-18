"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";

interface PoolData {
  id: string;
  title: string;
  description: string | null;
  targetSats: number;
  fiatCurrency: string;
  vendorLnAddress: string;
  status: string;
  releasePreimage: string | null;
  payoutInvoiceRecorded: boolean;
  collectedSats: number;
  contributorCount: number;
  progress: number;
  targetFiat: string;
  collectedFiat: string;
  rateIsFallback: boolean;
  createdAt: string;
  expiresAt: string;
  contributions: Array<{
    id: string;
    nickname: string;
    amountSats: number;
    paymentHash: string;
    preimage: string | null;
    createdAt: string;
  }>;
}

type ReceiptCheck = "checking" | "match" | "mismatch" | "unavailable";

/**
 * sha256(preimage) in the browser, so "verified" is something a visitor can
 * re-derive instead of taking on trust.
 */
async function checkPreimage(
  preimage: string,
  paymentHash: string
): Promise<ReceiptCheck> {
  try {
    const pairs = preimage.trim().match(/.{2}/g) ?? [];
    const bytes = Uint8Array.from(pairs, (pair) => parseInt(pair, 16));
    if (bytes.length === 0) return "mismatch";

    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");

    return hex === paymentHash.trim().toLowerCase() ? "match" : "mismatch";
  } catch {
    return "unavailable";
  }
}

function ReceiptProof({
  preimage,
  paymentHash,
  defaultOpen = false,
}: {
  preimage: string;
  paymentHash: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const [check, setCheck] = useState<ReceiptCheck>("checking");

  useEffect(() => {
    let cancelled = false;
    setCheck("checking");
    checkPreimage(preimage, paymentHash).then((result) => {
      if (!cancelled) setCheck(result);
    });
    return () => {
      cancelled = true;
    };
  }, [preimage, paymentHash]);

  const copyPreimage = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(preimage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the preimage is selectable, so it can still be copied.
    }
  }, [preimage]);

  const chip =
    check === "match"
      ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30"
      : check === "mismatch"
        ? "bg-amber-400/10 text-amber-300 ring-amber-400/30"
        : "bg-white/5 text-[var(--muted)] ring-white/15";

  const label =
    check === "match"
      ? "Receipt verified"
      : check === "mismatch"
        ? "Receipt unverified"
        : "Receipt";

  return (
    <div className={defaultOpen ? "text-left" : "text-right"}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors hover:brightness-125 ${chip}`}
      >
        <span aria-hidden="true">
          {check === "match" ? "✓" : check === "mismatch" ? "⚠" : "•"}
        </span>
        {label}
        <span aria-hidden="true" className="opacity-60">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div className="animate-rise mt-2 space-y-2 rounded-xl border border-[var(--border)] bg-black/30 p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
            Payment preimage
          </p>
          <p className="select-all break-all font-mono text-[11px] leading-relaxed">
            {preimage}
          </p>
          <div className="flex items-start justify-between gap-2">
            <p
              className={`text-[11px] leading-snug ${
                check === "match"
                  ? "text-emerald-300"
                  : check === "mismatch"
                    ? "text-amber-300"
                    : "text-[var(--muted)]"
              }`}
            >
              {check === "match"
                ? "SHA-256 of this preimage matches the invoice's payment hash."
                : check === "mismatch"
                  ? "SHA-256 of this preimage does not match the invoice's payment hash."
                  : check === "unavailable"
                    ? "This browser cannot compute SHA-256 here — verify the preimage in your wallet."
                    : "Checking preimage…"}
            </p>
            <button
              type="button"
              onClick={copyPreimage}
              className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-medium transition-colors hover:bg-white/10"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="break-all font-mono text-[10px] text-[var(--muted)]">
            invoice: {paymentHash}
          </p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    OPEN: "bg-sky-400/10 text-sky-300 ring-sky-400/30",
    FUNDED: "bg-amber-400/10 text-amber-300 ring-amber-400/30",
    RELEASING: "bg-amber-400/10 text-amber-300 ring-amber-400/30 animate-pulse",
    RELEASED: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30",
    REFUNDED: "bg-white/5 text-[var(--muted)] ring-white/15",
  };
  const labels: Record<string, string> = {
    OPEN: "⏳ Accepting Contributions",
    FUNDED: "✅ Fully Funded — Ready to Release",
    RELEASING: "⏳ Releasing Funds to Vendor…",
    RELEASED: "🎉 Funds Sent to Vendor",
    REFUNDED: "↩️ Refunded",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${colors[status] || "bg-white/5 text-[var(--muted)] ring-white/15"}`}
    >
      {labels[status] || status}
    </span>
  );
}

function ContributeModal({
  poolId,
  onClose,
  onContributed,
}: {
  poolId: string;
  onClose: () => void;
  onContributed: () => void;
}) {
  const [step, setStep] = useState<"form" | "pay" | "success">("form");
  const [nickname, setNickname] = useState("");
  const [amountSats, setAmountSats] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Payment state
  const [bolt11, setBolt11] = useState("");
  const [paymentHash, setPaymentHash] = useState("");
  const [preimage, setPreimage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleContribute = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const amount = parseInt(amountSats, 10);
      if (!amount || amount < 100) {
        throw new Error("Minimum contribution is 100 sats");
      }

      const res = await fetch(`/api/pools/${poolId}/contribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: nickname.trim(), amountSats: amount }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create payment");

      setBolt11(data.bolt11);
      setPaymentHash(data.paymentHash);
      setStep("pay");

      // Start polling for payment
      pollRef.current = setInterval(async () => {
        try {
          const verifyRes = await fetch(`/api/pools/${poolId}/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentHash: data.paymentHash }),
          });
          const verifyData = await verifyRes.json();

          if (verifyData.settled) {
            if (pollRef.current) clearInterval(pollRef.current);
            setPreimage(verifyData.preimage);
            setStep("success");
            onContributed();
          }
        } catch {
          // Silently retry
        }
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [poolId, nickname, amountSats, onContributed]);

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(bolt11);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = bolt11;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [bolt11]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel glass max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold">
            {step === "form" && "Contribute Your Share"}
            {step === "pay" && "Complete Payment"}
            {step === "success" && "Payment Confirmed! ✅"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-xl leading-none text-[var(--muted)] transition-colors hover:bg-white/10 hover:text-[var(--foreground)]"
          >
            ×
          </button>
        </div>

        {/* Step: Form */}
        {step === "form" && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Your Nickname
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="e.g., Chinedu"
                className="field num"
                maxLength={30}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Amount (sats)
              </label>
              <input
                type="number"
                value={amountSats}
                onChange={(e) => setAmountSats(e.target.value)}
                placeholder="e.g., 5000"
                className="field num"
                min={100}
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <button
              onClick={handleContribute}
              disabled={loading || !nickname.trim() || !amountSats}
              className="btn btn-primary w-full text-base"
            >
              {loading ? "Creating Payment..." : "⚡ Generate Payment Code"}
            </button>
          </div>
        )}

        {/* Step: Pay */}
        {step === "pay" && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-[var(--muted)]">
              Scan this code with any Lightning wallet to pay
            </p>

            {/* QR Code */}
            <div className="flex justify-center">
              <div className="inline-block rounded-xl bg-white p-3 shadow-[0_14px_44px_-16px_rgba(247,147,26,0.65)]">
                <QRCodeSVG
                  value={bolt11}
                  size={220}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
            </div>

            {/* Copy button */}
            <button
              onClick={copyToClipboard}
              className="btn btn-ghost w-full text-sm"
            >
              {copied ? "✅ Copied!" : "📋 Tap to Copy Payment Code"}
            </button>

            {/* Polling indicator */}
            <div className="flex items-center justify-center gap-2 text-sm text-[var(--muted)]">
              <span className="pulse-dot" />
              Waiting for payment...
            </div>
          </div>
        )}

        {/* Step: Success */}
        {step === "success" && (
          <div className="space-y-4 text-center">
            <div className="text-5xl mb-2">🎉</div>
            <p className="text-lg font-semibold text-[var(--success)]">
              Payment Verified!
            </p>
            <p className="text-sm text-[var(--muted)]">
              Your contribution of{" "}
              <strong>{parseInt(amountSats).toLocaleString()} sats</strong> has
              been confirmed.
            </p>
            {preimage && (
              <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3">
                <p className="mb-2 text-xs font-semibold text-emerald-300">
                  Verified Receipt
                </p>
                <ReceiptProof
                  preimage={preimage}
                  paymentHash={paymentHash}
                  defaultOpen
                />
              </div>
            )}
            <button
              onClick={onClose}
              className="btn w-full bg-[var(--success)] text-base text-[#04211a] hover:brightness-110"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ReconcilePanel({
  pool,
  onSettled,
}: {
  pool: PoolData;
  onSettled: () => void;
}) {
  const [organizerToken, setOrganizerToken] = useState("");
  const [preimage, setPreimage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`kobosplit:organizer:${pool.id}`);
      if (saved) setOrganizerToken(saved);
    } catch {
      // storage unavailable — the organizer can paste the key
    }
  }, [pool.id]);

  const handleReconcile = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setLoading(true);

      try {
        const res = await fetch(`/api/pools/${pool.id}/reconcile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizerToken: organizerToken.trim(),
            // Only sent when a vendor invoice was recorded; otherwise the claim
            // is simply handed back because nothing can have been paid.
            ...(pool.payoutInvoiceRecorded ? { preimage: preimage.trim() } : {}),
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not reconcile this payout");

        onSettled();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [pool.id, organizerToken, preimage, onSettled]
  );

  return (
    <div
      className="animate-rise rounded-2xl border border-amber-400/35 bg-amber-400/[0.07] p-5 shadow-[0_20px_60px_-30px_rgba(251,191,36,0.5)]"
    >
      <h3 className="mb-2 text-lg font-bold text-amber-200">⏳ Payout started — needs reconciling</h3>
      <p className="text-sm text-[var(--muted)] mb-4">
        {pool.payoutInvoiceRecorded
          ? "A release was started for this pool but never recorded. If your wallet shows the vendor payment as completed, paste its preimage below to settle the pool and publish the receipt. The proof is checked against the invoice recorded before payment, so a wrong preimage is rejected."
          : "A release was claimed for this pool, but no vendor invoice was ever recorded — which means nothing was paid. Release the claim to put the pool back to Fully Funded so you can run the release again."}
      </p>

      <form onSubmit={handleReconcile} className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Organizer key</label>
          <input
            type="password"
            value={organizerToken}
            onChange={(e) => setOrganizerToken(e.target.value)}
            placeholder="Your organizer key"
            className="field font-mono"
            autoComplete="off"
          />
        </div>

        {pool.payoutInvoiceRecorded && (
          <div>
            <label className="block text-sm font-medium mb-1">
              Payout preimage
            </label>
            <input
              type="text"
              value={preimage}
              onChange={(e) => setPreimage(e.target.value)}
              placeholder="64 hex characters from your wallet"
              className="field font-mono text-xs"
              autoComplete="off"
            />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={
            loading ||
            !organizerToken.trim() ||
            (pool.payoutInvoiceRecorded && !preimage.trim())
          }
          className="btn w-full bg-[var(--warning)] text-base text-[#241a00] hover:brightness-105"
        >
          {loading
            ? "Recording Payout..."
            : pool.payoutInvoiceRecorded
              ? "Record Payout Proof"
              : "Release Claim (nothing was paid)"}
        </button>
      </form>
    </div>
  );
}

function ReleasePanel({
  pool,
  onReleased,
}: {
  pool: PoolData;
  onReleased: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRelease = useCallback(async () => {
    if (
      !confirm(
        `Release ${pool.collectedSats.toLocaleString()} sats to ${pool.vendorLnAddress}?`
      )
    ) {
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/pools/${pool.id}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to release funds");

      onReleased();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [pool, onReleased]);

  return (
    <div className="animate-rise rounded-2xl border border-amber-400/30 bg-gradient-to-b from-amber-400/10 to-transparent p-5">
      <h3 className="mb-2 text-lg font-bold text-amber-200">💰 Escrow Release</h3>
      <p className="text-sm text-[var(--muted)] mb-4">
        The pool is fully funded! Release{" "}
        <strong>{pool.collectedSats.toLocaleString()} sats</strong> (
        {pool.collectedFiat}) to the vendor at{" "}
        <strong>{pool.vendorLnAddress}</strong>.
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <button
        onClick={handleRelease}
        disabled={loading}
        className="w-full bg-[var(--warning)] hover:opacity-90 disabled:opacity-50 text-black font-bold py-3 rounded-xl text-base transition-opacity min-h-[44px]"
      >
        {loading
          ? "Releasing Funds..."
          : `⚡ Send Funds to Vendor (${pool.collectedSats.toLocaleString()} sats)`}
      </button>
    </div>
  );
}

function ProofOfPayment({ pool }: { pool: PoolData }) {
  return (
    <div className="animate-rise rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.07] p-5">
      <h3 className="mb-2 text-lg font-bold text-emerald-300">
        🔐 Cryptographic Proof of Payment
      </h3>
      <p className="text-sm text-[var(--muted)] mb-4">
        Funds have been released. Every group member can independently verify
        this payout.
      </p>
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-semibold text-emerald-400">Vendor Address</p>
          <p className="break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-sm">
            {pool.vendorLnAddress}
          </p>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-emerald-400">
            Settlement Proof (Preimage)
          </p>
          <p className="break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-xs text-emerald-200">
            {pool.releasePreimage}
          </p>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-emerald-400">
            Total Released
          </p>
          <p className="text-sm font-semibold">
            {pool.collectedSats.toLocaleString()} sats ({pool.collectedFiat})
          </p>
        </div>
      </div>
    </div>
  );
}

export default function PoolPageClient({
  initialPool,
}: {
  initialPool: PoolData;
}) {
  const [pool, setPool] = useState<PoolData>(initialPool);
  const [showContribute, setShowContribute] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    // The create page hands the organizer key over in the URL fragment, which is
    // never sent to a server. Keep it on this device, then strip it from the
    // address bar so it can't be shared along with the pool link by accident.
    const hash = window.location.hash;
    if (hash.startsWith("#organizer=")) {
      const key = decodeURIComponent(hash.slice("#organizer=".length));
      try {
        window.localStorage.setItem(`kobosplit:organizer:${initialPool.id}`, key);
      } catch {
        // storage unavailable — the key stays in the fragment only
      }
      window.history.replaceState(null, "", window.location.pathname);
    }

    setShareUrl(window.location.href);
  }, [initialPool.id]);

  const refreshPool = useCallback(async () => {
    try {
      const res = await fetch(`/api/pools/${pool.id}`);
      if (res.ok) {
        const data = await res.json();
        setPool(data);
      }
    } catch {
      // Silently fail
    }
  }, [pool.id]);

  const copyShareUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Ignore
    }
  }, [shareUrl]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="animate-rise">
        <div className="mb-2 flex flex-col-reverse items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
          <h1 className="text-2xl font-extrabold tracking-tight text-balance sm:text-3xl">
            {pool.title}
          </h1>
          <StatusBadge status={pool.status} />
        </div>
        {pool.description && (
          <p className="text-[var(--muted)] text-sm">{pool.description}</p>
        )}
      </div>

      {/* Progress Bar */}
      <div className="card animate-rise p-5" style={{ animationDelay: "80ms" }}>
        <div className="mb-2 flex justify-between text-sm">
          <span className="font-semibold">
            {pool.collectedSats.toLocaleString()} /{" "}
            {pool.targetSats.toLocaleString()} sats
          </span>
          <span className="font-bold text-[var(--primary)]">
            {pool.progress}%
          </span>
        </div>
        <div className="track track-lg mb-2">
          <div
            className={`fill ${pool.progress >= 100 ? "fill-done" : ""}`}
            style={{ width: `${pool.progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-[var(--muted)]">
          <span>{pool.collectedFiat}</span>
          <span>{pool.targetFiat}</span>
        </div>
        {pool.rateIsFallback && (
          <p className="text-[11px] text-[var(--warning)] mt-1">
            ⚠️ Estimated rate — live exchange rate unavailable, fiat amounts are approximate.
          </p>
        )}
        <div className="flex items-center justify-between mt-3 text-xs text-[var(--muted)]">
          <span>👥 {pool.contributorCount} contributors</span>
          <span>⚡ {pool.vendorLnAddress}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        {pool.status === "OPEN" && (
          <button
            onClick={() => setShowContribute(true)}
            className="btn btn-primary flex-1 text-base"
          >
            ⚡ Contribute Your Share
          </button>
        )}
        <button
          onClick={copyShareUrl}
          className="btn btn-ghost text-sm"
        >
          {shareCopied ? "✅ Link Copied!" : "📤 Share"}
        </button>
      </div>

      {/* Reconciliation of a payout that was started but never recorded */}
      {pool.status === "RELEASING" && (
        <ReconcilePanel pool={pool} onSettled={refreshPool} />
      )}

      {/* Escrow Release / Proof */}
      {pool.status === "FUNDED" && (
        <ReleasePanel pool={pool} onReleased={refreshPool} />
      )}
      {pool.status === "RELEASED" && pool.releasePreimage && (
        <ProofOfPayment pool={pool} />
      )}

      {/* Contributors Ledger */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Contributors</h2>
        {pool.contributions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white/[0.02] py-10 text-center text-sm text-[var(--muted)]">
            No contributions yet. Be the first!
          </div>
        ) : (
          <div className="space-y-2">
            {pool.contributions.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-white/[0.035] px-4 py-3 transition-colors hover:bg-white/[0.06]"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">✅</span>
                  <div>
                    <p className="font-medium text-sm">{c.nickname}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm">
                    {c.amountSats.toLocaleString()} sats
                  </p>
                  {c.preimage && (
                    <div className="mt-1">
                      <ReceiptProof
                        preimage={c.preimage}
                        paymentHash={c.paymentHash}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contribute Modal */}
      {showContribute && (
        <ContributeModal
          poolId={pool.id}
          onClose={() => setShowContribute(false)}
          onContributed={refreshPool}
        />
      )}
    </div>
  );
}
