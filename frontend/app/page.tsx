import { InferenceConsole } from "@/components/console/inference-console";

export default function Home() {
  // Resolved at build time: flipping INFERENCE_API_URL on Vercel triggers a redeploy anyway.
  const mode = process.env.INFERENCE_API_URL ? "live" : "mock";
  return <InferenceConsole mode={mode} />;
}
