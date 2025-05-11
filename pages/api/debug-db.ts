import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Initialize Supabase client with admin privileges (server-side only)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    // Check if players table exists
    const { data: tables, error: tablesError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public');
    
    if (tablesError) {
      return res.status(500).json({ error: tablesError.message, location: 'tables query' });
    }
    
    const tableNames = tables.map(t => t.table_name);
    const playersTableExists = tableNames.includes('players');
    
    // Check rows in players table if it exists
    let playersData = null;
    let playersError = null;
    
    if (playersTableExists) {
      const result = await supabase
        .from('players')
        .select('*');
      
      playersData = result.data;
      playersError = result.error;
    }
    
    // Return debug information
    return res.status(200).json({
      tables: tableNames,
      playersTableExists,
      playersCount: playersData ? playersData.length : 0,
      playersData,
      playersError: playersError ? playersError.message : null,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
} 