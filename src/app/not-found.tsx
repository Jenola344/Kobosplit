import Link from "next/link";

export default function NotFound() {
  return (
    <div className="text-center py-20">
      <h1 className="text-4xl font-bold mb-4">404</h1>
      <p className="text-lg text-[var(--muted)] mb-6">
        This pool doesn&apos;t exist or has been removed.
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 bg-[var(--primary)] hover:bg-[var(--primary-dark)] text-white font-semibold px-6 py-3 rounded-xl text-base transition-colors min-h-[44px]"
      >
        ← Back to Home
      </Link>
    </div>
  );
}
