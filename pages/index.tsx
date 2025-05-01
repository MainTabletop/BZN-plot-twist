import { useRouter } from "next/router";

export default function Home() {
  const router = useRouter();

  const handleHost = async () => {
    const res = await fetch("/api/create-room");
    if (!res.ok) return console.error("API failed");
    const { code } = await res.json();
    router.push(`/room/${code}`);
  };

  return (
    <main className="h-screen flex items-center justify-center">
      <button
        onClick={handleHost}
        className="px-6 py-3 rounded-lg bg-black text-white"
      >
        Host Game
      </button>
    </main>
  );
}
