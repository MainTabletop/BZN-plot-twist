import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// single client for the whole app
export const supa = createClient(supabaseUrl, anonKey, {
  realtime: { auth: { persistSession: false } },
});
