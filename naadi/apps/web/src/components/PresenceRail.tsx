import type { JSX } from 'preact';
import type { Identity } from '../lib/identity';

export interface PeerEntry {
  peerId: string;
  name: string;
  color: string;
}

interface Props {
  self: Identity & { peerId: string };
  peers: PeerEntry[];
}

export default function PresenceRail({ self, peers }: Props): JSX.Element {
  return (
    <aside
      class="border-l shrink-0 flex flex-col"
      style="border-color: var(--color-hairline); width: 200px; background: var(--color-surface-soft);"
    >
      <div class="px-4 py-3 border-b shrink-0" style="border-color: var(--color-hairline);">
        <span class="caption-uppercase">In room</span>
      </div>
      <ul class="list-none m-0 p-0 overflow-auto">
        <PeerRow color={self.color} name={`${self.name} (you)`} muted={false} />
        {peers.map((p) => (
          <PeerRow key={p.peerId} color={p.color} name={p.name} muted={false} />
        ))}
        {peers.length === 0 ? (
          <li class="px-4 py-3 text-xs" style="color: var(--color-muted);">
            Share the URL to bring a peer in.
          </li>
        ) : null}
      </ul>
    </aside>
  );
}

function PeerRow({
  color,
  name,
  muted,
}: {
  color: string;
  name: string;
  muted: boolean;
}): JSX.Element {
  return (
    <li
      class="px-4 py-3 flex items-center gap-3 border-b text-sm"
      style="border-color: var(--color-hairline);"
    >
      <span
        aria-hidden="true"
        style={`background:${color};width:10px;height:10px;border-radius:9999px;flex-shrink:0;`}
      />
      <span style={`color: ${muted ? 'var(--color-muted)' : 'var(--color-body-strong)'};`}>
        {name}
      </span>
    </li>
  );
}
