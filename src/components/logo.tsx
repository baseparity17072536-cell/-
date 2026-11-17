export default function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center leading-none ${className}`}>
      <svg viewBox="0 0 80 18" className="mb-1 h-4 w-16" aria-hidden>
        <defs>
          <linearGradient id="logo-gold" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#f5dfa6" />
            <stop offset="1" stopColor="#c49a4c" />
          </linearGradient>
        </defs>
        <path d="M4 12 C 20 0, 40 0, 60 8 C 66 10, 72 10, 78 7" stroke="url(#logo-gold)" strokeWidth="2.2" fill="none" />
        <path d="M14 16 C 28 8, 46 8, 70 13" stroke="url(#logo-gold)" strokeWidth="1.6" fill="none" />
      </svg>
      <span className="text-gold font-display text-xl font-semibold tracking-[0.18em]">FAHTALAY</span>
      <span className="text-gold font-display text-[9px] tracking-[0.6em]">RESORT</span>
    </div>
  );
}
