-- Create a function to safely assign seat numbers
CREATE OR REPLACE FUNCTION assign_seat_number(
  p_player_id UUID,
  p_room_code TEXT,
  p_name TEXT
) RETURNS VOID AS $$
BEGIN
  -- Attempt to insert the player with the next available seat number
  -- Using ON CONFLICT DO NOTHING ensures we don't create duplicates or overwrite existing assignments
  INSERT INTO players (player_id, room_code, seat_number, name, status)
  VALUES (
    p_player_id, 
    p_room_code, 
    (SELECT COALESCE(MAX(seat_number), 0) + 1 FROM players WHERE room_code = p_room_code),
    p_name,
    'ready'
  )
  ON CONFLICT (room_code, player_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; 