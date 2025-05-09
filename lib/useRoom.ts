import { useEffect, useState } from 'react';
import { supa } from './supa';

export type RoomRow = {
  room_code: string;
  phase: string;
  current_host_id: string;
  settings: any;
  payload: any;
};

/**
 * Subscribe to a single row in `rooms` whose code = `roomCode`.
 */
export function useRoom(roomCode: string | undefined) {
  const [room, setRoom] = useState<RoomRow | null>(null);

  useEffect(() => {
    if (!roomCode) return;

    /* 1 — initial fetch */
    supa
      .from('rooms')
      .select('*')
      .eq('room_code', roomCode)
      .single()
      .then(async ({ data, error }) => {
        if (error && error.code === "PGRLS") {
          await supa.from("rooms").upsert(
            { room_code: roomCode, phase: "lobby" },
            { onConflict: "room_code" }
          );
          // re‑fetch so `room` state is populated
          const { data: created } = await supa
            .from("rooms")
            .select("*")
            .eq("room_code", roomCode)
            .single();
          if (created) setRoom(created as RoomRow);
          return;
        }
        if (error) console.error('useRoom fetch error', error);
        if (data)  setRoom(data as RoomRow);
      });

    /* 2 — realtime subscription */
    const channel = supa.channel('public:rooms')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'rooms', filter: `room_code=eq.${roomCode}` },
      (payload) => setRoom(payload.new as RoomRow),
    )
    .subscribe();

    return () => { channel.unsubscribe(); };
  }, [roomCode]);

  return room;
}
