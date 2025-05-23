-- Create the players table for persistent seat numbering
CREATE TABLE IF NOT EXISTS players (
  player_id UUID NOT NULL,
  room_code TEXT NOT NULL,
  seat_number INT NOT NULL,
  name TEXT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT,
  PRIMARY KEY (player_id, room_code),
  FOREIGN KEY (room_code) REFERENCES rooms(room_code) ON DELETE CASCADE,
  UNIQUE(room_code, seat_number)
);

-- Create an index on seat_number for faster sorting
CREATE INDEX IF NOT EXISTS players_room_seat_idx ON players(room_code, seat_number);

-- Add a comment explaining the purpose
COMMENT ON TABLE players IS 'Stores player information including stable seat numbers for consistent ordering'; 