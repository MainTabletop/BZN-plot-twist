import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { supa } from "../lib/supa";

export default function Home() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const handleHost = async () => {
    try {
      setIsCreating(true);
      
      // Generate a unique ID for this host
      const hostId = crypto.randomUUID();
      
      // First create the room code via the API
      const res = await fetch("/api/create-room");
      if (!res.ok) throw new Error("API failed to create room");
      const { code } = await res.json();
      
      // Then create a row in the rooms table
      const { error } = await supa
        .from('rooms')
        .insert({
          room_code: code,
          original_host_id: hostId,
          current_host_id: hostId,
          phase: 'lobby',
          settings: {
            tone: 'Funny',
            scene: 'Party',
            length: 'Short'
          },
          payload: {}
        });
      
      if (error) throw new Error(`Failed to create room record: ${error.message}`);
      
      // Store the host ID in session storage to identify this user as host
      sessionStorage.setItem(`host_${code}`, hostId);
      sessionStorage.setItem(`originalHost_${code}`, hostId);
      
      // Navigate to the room
      router.push(`/room/${code}`);
    } catch (err) {
      console.error("Failed to create room:", err);
      alert("Failed to create room. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <main className="h-screen flex flex-col items-center justify-center gap-8">
      <h1 className="text-6xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-transparent bg-clip-text">
        PlotTwist
      </h1>
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={handleHost}
          disabled={isCreating}
          className={`px-6 py-3 rounded-lg ${
            isCreating 
              ? "bg-gray-400 cursor-not-allowed" 
              : "bg-black text-white hover:bg-gray-800 cursor-pointer"
          } transition-colors relative`}
        >
          {isCreating ? (
            <>
              <span className="opacity-0">Start New Game</span>
              <span className="absolute inset-0 flex items-center justify-center">
                Creating...
              </span>
            </>
          ) : (
            "Start New Game"
          )}
        </button>
      </div>
    </main>
  );
}
