import { defineConfig } from "tsup";

// The render host has Node and ffmpeg, with no npm install or private tooling.
export default defineConfig({ noExternal: ["zod"] });
