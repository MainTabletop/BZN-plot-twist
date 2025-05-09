import { useEffect, useState } from 'react';
import { supa } from './supa';   // ← this is the Supabase client

export type RoomRow = {
  room_code: string;
  phase: string;
  current_host_id: string;
  settings: any;
  payload: any;
};

/**
 * Subscribe to the single rooms row whose code == `roomCode`.
 */
export function useRoom(roomCode?: string) {
  const [room, setRoom] = useState<RoomRow | null>(null);

  useEffect(() => {
    if (!roomCode) return;

    /* 1 – initial fetch */
    supa
      .from('rooms')
      .select('*')
      .eq('room_code', roomCode)
      .single()
      .headers({ 'x-room-code': roomCode })      // header required by the RLS policy
      .then(({ data, error }) => {
        if (error) console.error('useRoom fetch error', error);
        if (data)   setRoom(data as RoomRow);
      });

    /* 2 – realtime subscription */
    const channel = supa.channel('public:rooms', {
      headers: { 'x-room-code': roomCode }
    })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `room_code=eq.${roomCode}` },
        payload => setRoom(payload.new as RoomRow)
      )
      .subscribe();

    return () => channel.unsubscribe();
  }, [roomCode]);

  return room;
}