import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Only proceed if a secret token is provided to prevent unauthorized migrations
  if (req.body.token !== process.env.ADMIN_SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Initialize Supabase client with admin privileges (server-side only)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    // Check if the players table already exists
    const { data: tables, error: tablesError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public');
    
    if (tablesError) {
      return res.status(500).json({ error: tablesError.message, location: 'tables query' });
    }
    
    const tableNames = tables.map(t => t.table_name);
    const playersTableExists = tableNames.includes('players');
    
    // Results log
    const results = [];
    
    // Run migration if players table doesn't exist
    if (!playersTableExists) {
      // Create players table
      const { error: createTableError } = await supabase.rpc('create_players_table');
      
      if (createTableError) {
        // For MVP, we can create the table directly with SQL
        const { error: sqlError } = await supabase.rpc('run_sql', {
          sql: `
            CREATE TABLE IF NOT EXISTS players (
              player_id UUID NOT NULL,
              room_code TEXT NOT NULL,
              seat_number INT NOT NULL,
              name TEXT,
              joined_at TIMESTAMPTZ DEFAULT NOW(),
              status TEXT,
              PRIMARY KEY (player_id, room_code),
              UNIQUE(room_code, seat_number)
            );
            
            CREATE INDEX IF NOT EXISTS players_room_seat_idx ON players(room_code, seat_number);
          `
        });
        
        if (sqlError) {
          return res.status(500).json({ 
            error: sqlError.message, 
            location: 'create table SQL',
            attempted: true
          });
        }
        
        results.push('Created players table via SQL');
      } else {
        results.push('Created players table via RPC');
      }
    } else {
      results.push('Players table already exists');
    }
    
    // Check if existing players in the room need seat numbers
    const roomCode = req.body.roomCode;
    
    if (roomCode) {
      // Get players without seat numbers
      const { data: playersWithoutSeats, error: playersError } = await supabase
        .from('players')
        .select('player_id')
        .eq('room_code', roomCode)
        .is('seat_number', null);
      
      if (!playersError && playersWithoutSeats && playersWithoutSeats.length > 0) {
        results.push(`Found ${playersWithoutSeats.length} players without seat numbers`);
        
        // Assign seat numbers sequentially
        for (let i = 0; i < playersWithoutSeats.length; i++) {
          const nextSeatNumber = i + 1;
          
          const { error: updateError } = await supabase
            .from('players')
            .update({ seat_number: nextSeatNumber })
            .eq('player_id', playersWithoutSeats[i].player_id)
            .eq('room_code', roomCode);
          
          if (updateError) {
            results.push(`Error updating player ${i}: ${updateError.message}`);
          } else {
            results.push(`Assigned seat ${nextSeatNumber} to player ${playersWithoutSeats[i].player_id.substring(0, 8)}`);
          }
        }
      } else {
        results.push('No players found needing seat numbers');
      }
    }
    
    // Return success with results
    return res.status(200).json({
      success: true,
      playersTableExists,
      results,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
} 