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

  const symbol = fiatCurrency === "NGN" ? "₦" : "CFA ";

  // Fetch conversion whenever amount or mode changes
  useEffect(() => {
    const amount = parseFloat(amountInput);
    if (!amount || amount <= 0) {
      setConvertedDisplay("");
      return;
    }

    const controller = new AbortController();
    const param = isFiatMode
      ? `fiat=${amount}&currency=${fiatCurrency}`
      : `sats=${Math.round(amount)}&currency=${fiatCurrency}`;

    fetch(`/api/rates?${param}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
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

        router.push(`/pool/${data.id}`);
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

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create a Split Pool</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium mb-1">Pool Title *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Hostel Generator Fuel Split"
            className="w-full border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            required
            maxLength={100}
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium mb-1">
            Description{" "}
            <span className="text-[var(--muted)] font-normal">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this split for?"
            className="w-full border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] resize-none"
            maxLength={500}
          />
        </div>

        {/* Currency Toggle */}
        <div>
          <label className="block text-sm font-medium mb-1">Currency</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFiatCurrency("NGN")}
              className={`px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] transition-colors ${
                fiatCurrency === "NGN"
                  ? "bg-[var(--primary)] text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              🇳🇬 NGN (Naira)
            </button>
            <button
              type="button"
              onClick={() => setFiatCurrency("XOF")}
              className={`px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] transition-colors ${
                fiatCurrency === "XOF"
                  ? "bg-[var(--primary)] text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              🇸🇳 XOF (CFA Franc)
            </button>
          </div>
        </div>

        {/* Target Amount */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium">Target Amount *</label>
            <button
              type="button"
              onClick={() => setIsFiatMode(!isFiatMode)}
              className="text-xs text-[var(--primary)] hover:underline font-medium"
            >
              Switch to {isFiatMode ? "Sats" : fiatCurrency}
            </button>
          </div>
          <div className="relative">
            <input
              type="number"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder={isFiatMode ? `Amount in ${fiatCurrency}` : "Amount in sats"}
              className="w-full border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] pr-20"
              required
              min={1}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">
              {isFiatMode ? fiatCurrency : "sats"}
            </span>
          </div>
          {convertedDisplay && (
            <p className="text-xs text-[var(--muted)] mt-1">{convertedDisplay}</p>
          )}
        </div>

        {/* Vendor Lightning Address */}
        <div>
          <label className="block text-sm font-medium mb-1">
            Vendor Payment Address *
          </label>
          <input
            type="text"
            value={vendorLnAddress}
            onChange={(e) => setVendorLnAddress(e.target.value)}
            placeholder="e.g., vendor@blink.sv"
            className="w-full border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            required
          />
          <p className="text-xs text-[var(--muted)] mt-1">
            The Lightning Address where collected funds will be sent
          </p>
        </div>

        {/* Demo Wallet Toggle */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={useDemoWallet}
              onChange={(e) => setUseDemoWallet(e.target.checked)}
              className="mt-0.5 w-5 h-5 accent-[var(--primary)]"
            />
            <div>
              <span className="font-medium text-sm">
                🧪 Use Demo Testnet Wallet
              </span>
              <p className="text-xs text-[var(--muted)] mt-1">
                Perfect for testing! Uses a pre-configured testnet wallet so you
                can try KoboSplit without setting up your own Lightning node.
              </p>
            </div>
          </label>
        </div>

        {/* NWC URI (hidden if demo mode) */}
        {!useDemoWallet && (
          <div>
            <label className="block text-sm font-medium mb-1">
              Wallet Connection URI *
            </label>
            <input
              type="password"
              value={nwcUri}
              onChange={(e) => setNwcUri(e.target.value)}
              placeholder="nostr+walletconnect://..."
              className="w-full border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] font-mono text-xs"
              required={!useDemoWallet}
            />
            <p className="text-xs text-[var(--muted)] mt-1">
              Your NWC connection string from Alby Hub or any NWC-compatible
              wallet. Encrypted at rest — never stored in plain text.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[var(--primary)] hover:bg-[var(--primary-dark)] disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-base transition-colors min-h-[44px]"
        >
          {loading ? "Creating Pool..." : "⚡ Create Split Pool"}
        </button>
      </form>
    </div>
  );
}
