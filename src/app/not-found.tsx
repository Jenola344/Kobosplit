import Link from "next/link";

export default function NotFound() {
  return (
    <div className="animate-rise flex flex-col items-center py-20 text-center">
      <span className="text-5xl">⚡</span>
      <h1 className="text-gradient mt-4 text-5xl font-extrabold tracking-tight">
        404
      </h1>
      <p className="mt-3 text-lg text-[var(--muted)]">
        This pool doesn&apos;t exist or has been removed.
      </p>
      <Link href="/" className="btn btn-primary mt-6 text-base">
        ← Back to Home
      </Link>
    </div>
  );
}
