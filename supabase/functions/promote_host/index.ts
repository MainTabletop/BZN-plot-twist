import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Create a Supabase client with the admin key
const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

serve(async (req) => {
  try {
    // Parse the request body
    const { room_code } = await req.json()
    
    if (!room_code) {
      return new Response(JSON.stringify({ error: 'room_code is required' }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      })
    }
    
    // 1. Fetch the current room state
    const { data: room, error } = await supabase
      .from('rooms')
      .select('phase, current_host_id')
      .eq('room_code', room_code)
      .single()
      
    if (error || !room) {
      return new Response(JSON.stringify({ error: 'Room not found' }), { status: 404 })
    }
    
    // 2. If the phase is not 'lobby', do nothing
    if (room.phase !== 'lobby') {
      return new Response(JSON.stringify({ ok: true, message: 'Not in lobby phase' }))
    }
    
    // 3. TODO: Check if the current host is present in realtime
    // This requires admin access to the realtime presence API which will be implemented later
    
    // 4. For now, assume the host is absent and update the room status
    const { error: updateError } = await supabase
      .from('rooms')
      .update({ phase: 'roomClosed' })
      .eq('room_code', room_code)
    
    return new Response(JSON.stringify({ 
      ok: !updateError,
      message: updateError ? updateError.message : 'Room closed successfully' 
    }), { status: updateError ? 500 : 200 })
    
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
}) 