process.env.MEI_PUBLIC_DEMO = "1";
process.env.MEI_DISABLE_SCHEDULER = "1";
process.env.MEI_MODEL_PROVIDER = process.env.MEI_MODEL_PROVIDER
  || (process.env.GEMINI_API_KEY ? "gemini" : "local");

await import("../server.mjs");

