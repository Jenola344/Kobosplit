import { NextResponse } from "next/server";
import { satsToFiat, fiatToSats, getRateInfo } from "@/lib/rates";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const currency = (url.searchParams.get("currency") || "NGN") as "NGN" | "XOF";
  const sats = url.searchParams.get("sats");
  const fiat = url.searchParams.get("fiat");

  try {
    const rateInfo = await getRateInfo(currency);

    if (sats) {
      const fiatValue = await satsToFiat(parseInt(sats, 10), currency);
      return NextResponse.json({ sats: parseInt(sats, 10), fiat: fiatValue, ...rateInfo });
    }

    if (fiat) {
      const satsValue = await fiatToSats(parseFloat(fiat), currency);
      return NextResponse.json({ sats: satsValue, fiat: parseFloat(fiat), ...rateInfo });
    }

    return NextResponse.json(rateInfo);
  } catch (error) {
    console.error("Error fetching rates:", error);
    return NextResponse.json({ error: "Failed to fetch rates" }, { status: 500 });
  }
}
