-- +goose Up

-- Create rooms table for game state management
CREATE TABLE IF NOT EXISTS public.rooms (
  room_code TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  original_host_id UUID NOT NULL,
  current_host_id UUID NOT NULL,
  phase TEXT DEFAULT 'lobby',
  settings JSONB DEFAULT '{}'::jsonb,
  payload JSONB DEFAULT '{}'::jsonb
);

-- Enable RLS on the rooms table
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- Create policy that allows the current host to update the room
CREATE POLICY room_owner_updates ON public.rooms
  FOR UPDATE
  TO anon
  USING (current_host_id = auth.uid());

-- Create policy that allows any user to select room data with the correct room_code
CREATE POLICY room_select ON public.rooms
  FOR SELECT
  TO anon
  USING (room_code = current_setting('request.jwt.claims'::text)::json->>'room_code'); 