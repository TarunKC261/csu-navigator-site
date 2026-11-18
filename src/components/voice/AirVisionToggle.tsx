'use client';

import { Hand } from 'lucide-react';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { playUISound } from '@/utils/soundGenerator';

/**
 * "Enable hand control" button. Renders only when AirVision is available for this
 * site (super-admin entitlement + org activation, delivered via site config).
 * Opt-in: the camera is requested only when the visitor clicks.
 */
export function AirVisionToggle({ iconColor, iconBg }: { iconColor: string; iconBg: string }) {
  const available = useVoiceSessionStore((s) => s.airVisionAvailable);
  const active = useVoiceSessionStore((s) => s.airVisionActive);
  const toggle = useVoiceSessionStore((s) => s.toggleAirVision);

  if (!available) return null;

  const handleToggle = () => {
    playUISound(active ? 'off' : 'on', 'chat');
    toggle();
  };

  return (
    <button
      onClick={handleToggle}
      className={`p-2 rounded-full transition-all duration-200 ${
        active
          ? 'bg-[#4F8CFF] text-white shadow-lg shadow-[#4F8CFF]/30'
          : `${iconBg} ${iconColor}`
      }`}
      title={active ? 'Turn off hand control' : 'Enable hand control (touchless)'}
      aria-pressed={active}
    >
      <Hand className="w-4 h-4" />
    </button>
  );
}
