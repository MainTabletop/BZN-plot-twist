import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Single Supabase client for the whole app
export const supa = createClient(supabaseUrl, anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    // put realtime‑specific options here‑if/when you need them
  },
});
