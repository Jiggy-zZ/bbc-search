import type { SearchResult } from "@/lib/search/types";
import { formatTime } from "@/lib/ui/format-time";

interface PlayerPlaceholderProps {
  selection: SearchResult | null;
}

export function PlayerPlaceholder({ selection }: PlayerPlaceholderProps) {
  const episode = selection?.episode;
  const speaker = selection?.speaker;

  return (
    <aside className="player-panel" aria-label="Clip preview">
      <div className="player-screen">
        <span className="large-play" aria-hidden="true">▶</span>
        <span className="placeholder-label">Clip preview</span>
      </div>
      <div className="player-copy">
        {selection ? (
          <>
            <p className="eyebrow">Selected clip</p>
            <h2>{selection.textEn ?? selection.textZh ?? "Untitled subtitle segment"}</h2>
            {selection.textEn && selection.textZh ? <p>{selection.textZh}</p> : null}
            <div className="player-meta">
              {episode ? <span>{episode}</span> : null}
              {speaker ? <span>{speaker}</span> : null}
              <span>{formatTime(selection.startMs)}</span>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">Player</p>
            <h2>Select a result to preview it here</h2>
            <p>Playback arrives in a later phase. This panel confirms the clip selection flow.</p>
          </>
        )}
      </div>
    </aside>
  );
}
