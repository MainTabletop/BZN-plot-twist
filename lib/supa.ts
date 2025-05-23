// src/lib/supa.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supa = createClient(supabaseUrl, anonKey, {
  realtime: { auth: { persistSession: false } },
});

// src/lib/supa.ts
export async function getUid() {
  const { data: { user } } = await supa.auth.getUser();
  return user?.id ?? null;          // returns string or null
}


