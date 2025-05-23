import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Debug log to verify credentials
// console.log('DEBUG - Supabase credentials:', { 
//   supabaseUrl, 
//   anonKey,
//   hasUrl: !!supabaseUrl,
//   hasKey: !!anonKey
// });

if (!supabaseUrl || !anonKey) {
  throw new Error('Missing Supabase credentials');
}

// single client for the whole app
export const supa = createClient(supabaseUrl, anonKey, {
  realtime: { auth: { persistSession: false } },
});
