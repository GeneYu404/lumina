import { AppIcon, Spinner } from './ui/Icons';

/**
 * Startup cover, desktop only. Restoring the previous folder means reading a
 * large directory (metadata + header probe) before anything is on screen —
 * without a cover the user sees an empty welcome page that later jumps to the
 * restored images. It stays up until the restore resolves, fading out so the
 * first real frame never pops in cold.
 */
export default function Splash({ visible }: { visible: boolean }) {
  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-app transition-[opacity,visibility] duration-300 ease-out ${
        visible ? 'visible opacity-100' : 'invisible opacity-0'
      }`}
      aria-hidden="true"
    >
      <div className="relative">
        <div className="absolute inset-0 scale-[1.8] rounded-full bg-accent opacity-25 blur-3xl" />
        <AppIcon size={84} className="relative drop-shadow-xl" />
      </div>
      <Spinner size={26} />
    </div>
  );
}
