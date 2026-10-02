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
      className={`splash ${
        visible ? 'splash--on' : 'splash--off'
      }`}
      aria-hidden="true"
    >
      <div className="splash-mark">
        <div className="glow glow--flat" />
        <AppIcon size={84} className="splash-mark-icon" />
      </div>
      <Spinner size={26} />
    </div>
  );
}
