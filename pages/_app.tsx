// pages/_app.tsx
import "@/styles/globals.css";
import type { AppProps } from "next/app";

import { useEffect } from "react";
import { supa } from "@/lib/supa";

function AuthBootstrap() {
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supa.auth.getSession();
      if (!session) {
        await supa.auth.signInAnonymously();   // creates or restores anon user
      }
    })();
  }, []);
  return null;
}

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <AuthBootstrap />      {/* ensure this renders once */}
      <Component {...pageProps} />
    </>
  );
}
