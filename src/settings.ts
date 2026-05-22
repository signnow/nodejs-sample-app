import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  SIGNNOW_API_HOST: z.string().url().default("https://api.signnow.com"),
  SIGNNOW_API_BASIC_TOKEN: z.string().min(1),
  SIGNNOW_API_USERNAME: z.string().email(),
  SIGNNOW_API_PASSWORD: z.string().min(1),
  SIGNNOW_DOWNLOADS_DIR: z.string().default("/tmp/signnow-downloads"),
  SN_SIGNER_EMAIL: z.string().email().default("signer@signnow.com"),
  APP_BASE_URL: z.string().url().default("http://localhost:8080"),
  PORT: z.coerce.number().int().positive().default(8080),
});

export type Settings = z.infer<typeof schema>;

export const settings: Settings = schema.parse(process.env);
