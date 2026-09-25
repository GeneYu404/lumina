import { useId } from 'react';
import { cn } from '../../utils/cn';
import { BLOOM_SVG } from '../../utils/samples';

function useSafeId() {
  return 'i' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

export function AppIcon({ size = 20, className }: { size?: number; className?: string }) {
  const id = useSafeId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}a`} x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#62D0FF" />
          <stop offset="1" stopColor="#1A6FE0" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="20" x2="0" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F4FBFF" />
          <stop offset="1" stopColor="#BFE3FF" />
        </linearGradient>
        <clipPath id={`${id}c`}>
          <rect x="5" y="8" width="38" height="32" rx="7" />
        </clipPath>
      </defs>
      <rect x="5" y="8" width="38" height="32" rx="7" fill={`url(#${id}a)`} />
      <g clipPath={`url(#${id}c)`}>
        <circle cx="32" cy="18" r="4.5" fill="#FFD66B" />
        <path d="M2 36 L17 21 L28 32 L33 27 L46 40 V44 H2 Z" fill={`url(#${id}b)`} />
      </g>
    </svg>
  );
}

export function WinLogo({ size = 22 }: { size?: number }) {
  const id = useSafeId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6fd3ff" />
          <stop offset="1" stopColor="#0b6fe6" />
        </linearGradient>
      </defs>
      <g fill={`url(#${id})`}>
        <rect x="2" y="2" width="9.6" height="9.6" rx="1.2" />
        <rect x="12.4" y="2" width="9.6" height="9.6" rx="1.2" />
        <rect x="2" y="12.4" width="9.6" height="9.6" rx="1.2" />
        <rect x="12.4" y="12.4" width="9.6" height="9.6" rx="1.2" />
      </g>
    </svg>
  );
}

export function CaptionMin() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function CaptionMax() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function CaptionRestore() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <rect x="0.5" y="2.5" width="7" height="7" rx="1.2" />
      <path d="M2.5 2.5V1.8A1.3 1.3 0 0 1 3.8 0.5H8.2A1.3 1.3 0 0 1 9.5 1.8V6.2A1.3 1.3 0 0 1 8.2 7.5H7.5" />
    </svg>
  );
}

export function CaptionClose() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function Spinner({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg className={cn('animate-spin text-accent', className)} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="40 100" />
    </svg>
  );
}

export function Wallpaper({ className }: { className?: string }) {
  return (
    <div
      className={cn('pv-wallpaper pointer-events-none absolute inset-0', className)}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: BLOOM_SVG }}
    />
  );
}
