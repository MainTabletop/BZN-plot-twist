import { useRouter } from "next/router";
import DarkModeToggle from "../components/DarkModeToggle";

export default function Home() {
  const router = useRouter();

  const handleHost = async () => {
    const res = await fetch("/api/create-room");
    if (!res.ok) return console.error("API failed");
    const { code } = await res.json();
    router.push(`/room/${code}`);
  };

  return (
    <main className="h-screen flex flex-col items-center justify-center gap-8 bg-background px-4 sm:px-6 lg:px-8">
      <DarkModeToggle />
      <h1 className="text-6xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary text-transparent bg-clip-text">
        PlotTwist
      </h1>
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={handleHost}
          className="px-6 py-3 rounded-lg bg-brand-primary text-white hover:bg-brand-secondary transition-colors"
        >
          Start New Game
        </button>
      </div>
    </main>
  );
}
