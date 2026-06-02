import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_aykidunteyoefhgzveqa",
  dirs: ["./trigger"],
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
    },
  },
});