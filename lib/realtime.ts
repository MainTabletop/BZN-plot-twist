import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';

export type PlotTwistEvent =
  | 'host_update'
  | 'game_phase_change'
  | 'original_host_set'
  | 'player_status_change'
  | 'submit_description'
  | 'script_update'
  | 'script_response'
  | 'direct_script_update'
  | 'request_script'
  | 'player_guess_submitted'
  | 'submit_guesses'
  | 'player_vote'
  | 'player_vote_submitted'
  | 'force_remove_player'
  | 'remove_player'
  | 'request_assignment_recovery'
  | 'assignment_recovery'
  | 'force_status_sync'
  | 'reassign_seat_numbers'
  | 'play_again'
  | 'play_again_reload'
  | 'host_correction'
  | 'script_generation_start'
  | 'script_generation_end';

/** Initialise (or return cached) Supabase client */
export const getSupabase = (() => {
  let instance: SupabaseClient | null = null;
  return () => {
    if (instance) return instance;
    instance = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    return instance;
  };
})();

/** Join (or fetch existing) realtime channel for a room */
export function getRoomChannel(roomCode: string, config?: any): RealtimeChannel {
  const client = getSupabase();
  const topic = `room:${roomCode}`;
  
  // Check for an existing subscription
  let channel = client.getChannels().find(c => c.topic === topic);
  if (channel) return channel;

  // Create a new channel builder with config
  channel = client.channel(topic, config ? { config } : undefined);

  // **Attach debug logger BEFORE the caller subscribes**
  attachDebugLogger(channel);

  // Don't subscribe here - let the caller handle subscription
  return channel;
}

/** Emit a typed event */
export function emit<T>(
  channel: RealtimeChannel,
  event: PlotTwistEvent,
  payload: T
) {
  return channel.send({ type: 'broadcast', event, payload });
}

/** Listen for one typed event */
export function on<T>(
  channel: RealtimeChannel,
  event: PlotTwistEvent,
  cb: (payload: T) => void
) {
  channel.on('broadcast', { event }, ({ payload }) => cb(payload as T));
}

/** Dev helper – logs every broadcast once */
export function attachDebugLogger(channel: RealtimeChannel) {
  if (process.env.NODE_ENV !== 'development') return;
  
  // Check if debug logger is already attached to this channel
  if ((channel as any)._debugLoggerAttached) {
    return; // Already attached, don't attach again
  }
  
  // Mark this channel as having debug logger attached
  (channel as any)._debugLoggerAttached = true;
  
  // Listen to all broadcast events by using a wildcard approach
  const events: PlotTwistEvent[] = [
    'host_update', 'game_phase_change', 'original_host_set', 'player_status_change',
    'submit_description', 'script_update', 'script_response', 'direct_script_update',
    'request_script', 'player_guess_submitted', 'submit_guesses', 'player_vote',
    'player_vote_submitted', 'force_remove_player', 'remove_player',
    'request_assignment_recovery', 'assignment_recovery', 'force_status_sync',
    'reassign_seat_numbers', 'play_again', 'play_again_reload', 'host_correction',
    'script_generation_start', 'script_generation_end'
  ];
  
  events.forEach(event => {
    channel.on('broadcast', { event }, ({ payload }) => {
      console.log('[RT debug]', event, payload);
    });
  });
} 