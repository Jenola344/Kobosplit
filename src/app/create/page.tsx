"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CreatePoolPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useDemoWallet, setUseDemoWallet] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [isFiatMode, setIsFiatMode] = useState(false);
  const [fiatCurrency, setFiatCurrency] = useState<"NGN" | "XOF">("NGN");
  const [vendorLnAddress, setVendorLnAddress] = useState("");
  const [nwcUri, setNwcUri] = useState("");

  // Converted amount display
  const [convertedDisplay, setConvertedDisplay] = useState("");
  const [rateIsFallback, setRateIsFallback] = useState(false);

  const symbol = fiatCurrency === "NGN" ? "₦" : "CFA ";

  // Fetch conversion whenever amount or mode changes
  useEffect(() => {
    const amount = parseFloat(amountInput);
    if (!amount || amount <= 0) {
      setConvertedDisplay("");
      setRateIsFallback(false);
      return;
    }

    const controller = new AbortController();
    const param = isFiatMode
      ? `fiat=${amount}&currency=${fiatCurrency}`
      : `sats=${Math.round(amount)}&currency=${fiatCurrency}`;

    fetch(`/api/rates?${param}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        setRateIsFallback(Boolean(data.isFallback));
        if (isFiatMode) {
          setConvertedDisplay(`≈ ${data.sats?.toLocaleString() ?? "?"} sats`);
        } else {
          setConvertedDisplay(
            `≈ ${symbol}${data.fiat?.toLocaleString() ?? "?"}`
          );
        }
      })
      .catch(() => {});

    return () => controller.abort();
  }, [amountInput, isFiatMode, fiatCurrency, symbol]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setLoading(true);

      try {
        const amount = parseFloat(amountInput);
        if (!amount || amount <= 0) {
          throw new Error("Enter a valid amount");
        }

        // Convert fiat to sats if needed
        let targetSats: number;
        if (isFiatMode) {
          const rateRes = await fetch(
            `/api/rates?fiat=${amount}&currency=${fiatCurrency}`
          );
          const rateData = await rateRes.json();
          targetSats = rateData.sats;
        } else {
          targetSats = Math.round(amount);
        }

        const payload: Record<string, unknown> = {
          title,
          description: description || undefined,
          targetSats,
          fiatCurrency,
          vendorLnAddress,
          useDemoWallet,
        };

        if (!useDemoWallet && nwcUri) {
          payload.nwcUri = nwcUri;
        }

        const res = await fetch("/api/pools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to create pool");
        }

        // The organizer key can only reconcile a payout stuck mid-release. Hand
        // it to the pool page through the URL fragment (never sent to a server,
        // never logged) so the device that created the pool keeps it.
        router.push(
          data.organizerToken
            ? `/pool/${data.id}#organizer=${encodeURIComponent(data.organizerToken)}`
            : `/pool/${data.id}`
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [
      title,
      description,
      amountInput,
      isFiatMode,
      fiatCurrency,
      vendorLnAddress,
      nwcUri,
      useDemoWallet,
      router,
    ]
  );

  const currencyButton = (value: "NGN" | "XOF", label: string) => (
    <button
      type="button"
      onClick={() => setFiatCurrency(value)}
      aria-pressed={fiatCurrency === value}
      className={`min-h-[44px] flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
        fiatCurrency === value
          ? "bg-[var(--primary)] text-[#1a1206] shadow-[0_10px_24px_-12px_var(--primary-glow)]"
          : "bg-white/5 text-[var(--muted)] ring-1 ring-[var(--border)] hover:bg-white/10 hover:text-[var(--foreground)]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-lg">
      <div className="animate-rise mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">
          New pool
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">
          Create a Split Pool
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Set the target, point it at a vendor&apos;s Lightning address, and
          share the link with your group.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="card animate-rise space-y-5 p-5 sm:p-6"
        style={{ animationDelay: "90ms" }}
      >
        {/* Title */}
        <div>
          <label htmlFor="pool-title" className="mb-1.5 block text-sm font-medium">
            Pool Title <span className="text-[var(--primary)]">*</span>
          </label>
          <input
            id="pool-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Hostel Generator Fuel Split"
            className="field"
            required
            maxLength={100}
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="pool-description" className="mb-1.5 block text-sm font-medium">
            Description{" "}
            <span className="font-normal text-[var(--muted)]">(optional)</span>
          </label>
          <textarea
            id="pool-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this split for?"
            className="field min-h-[80px] resize-none"
            maxLength={500}
          />
        </div>

        {/* Currency Toggle */}
        <div>
          <span className="mb-1.5 block text-sm font-medium">Currency</span>
          <div className="flex gap-2">
            {currencyButton("NGN", "🇳🇬 NGN (Naira)")}
            {currencyButton("XOF", "🇸🇳 XOF (CFA Franc)")}
          </div>
        </div>

        {/* Target Amount */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="pool-amount" className="text-sm font-medium">
              Target Amount <span className="text-[var(--primary)]">*</span>
            </label>
            <button
              type="button"
              onClick={() => setIsFiatMode(!isFiatMode)}
              className="text-xs font-medium text-[var(--primary)] transition-opacity hover:opacity-80 hover:underline"
            >
              Switch to {isFiatMode ? "Sats" : fiatCurrency}
            </button>
          </div>
          <div className="relative">
            <input
              id="pool-amount"
              type="number"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder={isFiatMode ? `Amount in ${fiatCurrency}` : "Amount in sats"}
              className="field num pr-20"
              required
              min={1}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-[var(--muted)]">
              {isFiatMode ? fiatCurrency : "sats"}
            </span>
          </div>
          {convertedDisplay && (
            <p className="num mt-1.5 text-xs text-[var(--muted)]">
              {convertedDisplay}
              {rateIsFallback && (
                <span className="text-[var(--warning)]"> · estimated rate</span>
              )}
            </p>
          )}
        </div>

        {/* Vendor Lightning Address */}
        <div>
          <label htmlFor="vendor-address" className="mb-1.5 block text-sm font-medium">
            Vendor Payment Address <span className="text-[var(--primary)]">*</span>
          </label>
          <input
            id="vendor-address"
            type="text"
            value={vendorLnAddress}
            onChange={(e) => setVendorLnAddress(e.target.value)}
            placeholder="e.g., vendor@blink.sv"
            className="field font-mono"
            required
          />
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            The Lightning Address where collected funds will be sent
          </p>
        </div>

        {/* Demo Wallet Toggle */}
        <div className="rounded-xl border border-[var(--primary)]/25 bg-[var(--primary)]/[0.07] p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={useDemoWallet}
              onChange={(e) => setUseDemoWallet(e.target.checked)}
              className="mt-0.5 h-5 w-5 accent-[var(--primary)]"
            />
            <div>
              <span className="text-sm font-medium">🧪 Use Demo Testnet Wallet</span>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                Perfect for testing! Uses a pre-configured testnet wallet so you
                can try KoboSplit without setting up your own Lightning node.
              </p>
            </div>
          </label>
        </div>

        {/* NWC URI (hidden if demo mode) */}
        {!useDemoWallet && (
          <div className="animate-rise">
            <label htmlFor="nwc-uri" className="mb-1.5 block text-sm font-medium">
              Wallet Connection URI <span className="text-[var(--primary)]">*</span>
            </label>
            <input
              id="nwc-uri"
              type="password"
              value={nwcUri}
              onChange={(e) => setNwcUri(e.target.value)}
              placeholder="nostr+walletconnect://..."
              className="field font-mono text-xs"
              required={!useDemoWallet}
            />
            <p className="mt-1.5 text-xs text-[var(--muted)]">
              Your NWC connection string from Alby Hub or any NWC-compatible
              wallet. Encrypted at rest — never stored in plain text.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="animate-rise rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* Submit */}
        <button type="submit" disabled={loading} className="btn btn-primary w-full text-base">
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#1a1206]/30 border-t-[#1a1206]" />
              Creating Pool...
            </>
          ) : (
            "⚡ Create Split Pool"
          )}
        </button>

        <p className="text-center text-xs leading-relaxed text-[var(--muted)]">
          An organizer key is created with the pool and kept on this device. It is
          the only way to record a payout if a release is interrupted.
        </p>
      </form>
    </div>
  );
}
