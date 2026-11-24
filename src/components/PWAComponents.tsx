import React, {useState} from 'react';
import {Download, WifiOff, X} from 'lucide-react';
import {usePWAInstall} from '../hooks/usePWAInstall';
import {useOnlineStatus} from '../hooks/useOnlineStatus';

export const PWAInstallButton: React.FC<{compact?: boolean}> = ({compact = false}) => {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
        style={{backgroundColor: 'var(--accent-primary)'}}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>{compact ? 'Install' : 'Install App'}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center justify-center gap-2 rounded-lg border app-border px-3 py-2 text-xs font-medium app-text-secondary hover:opacity-80 transition-opacity whitespace-nowrap shrink-0 min-h-[40px]"
        >
          <Download className="w-4 h-4 shrink-0" />
          <span>Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm rounded-xl border app-surface p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">Install on iPhone / iPad</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-2 rounded-lg hover:opacity-75 min-w-[40px] min-h-[40px] flex items-center justify-center"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-sm app-text-secondary list-decimal list-inside">
                <li>Tap the <strong>Share</strong> icon in the Safari toolbar.</li>
                <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                <li>Launch anytime offline from your home screen.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg py-2.5 text-sm font-semibold text-white"
                style={{backgroundColor: 'var(--accent-primary)'}}
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="no-print fixed bottom-20 lg:bottom-4 left-4 z-40 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-600 px-3 py-2 text-xs font-medium text-white shadow-lg">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Offline Mode — Local encrypted vault active</span>
    </div>
  );
};
