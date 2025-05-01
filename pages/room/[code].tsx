import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { supa } from "../../lib/supa";

type Player = { id: string; name: string };

export default function Room() {
  const router = useRouter();
  const slug = router.query.code as string | undefined;
  const [players, setPlayers] = useState<Player[]>([]);

  useEffect(() => {
    if (!slug) return;

    const channel = supa.channel(`room:${slug}`, {
      config: { presence: { key: crypto.randomUUID() } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<Record<string, Player>>();
        const flat = Object.values(state).flat();
        setPlayers(flat);
      })
      .subscribe(() => {
        channel.track({ id: crypto.randomUUID(), name: "Player" });
      });

    return () => channel.unsubscribe();
  }, [slug]);

  return (
    <main className="h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="text-3xl">Room code: {slug}</h1>
      <h2 className="text-xl">Players</h2>
      <ul>
        {players.map((p) => (
          <li key={p.id}>{p.name}</li>
        ))}
      </ul>
    </main>
  );
}
