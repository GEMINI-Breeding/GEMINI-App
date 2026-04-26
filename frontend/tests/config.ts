import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.join(__dirname, "../../.env") })
dotenv.config({ path: path.join(__dirname, "../../backend/gemini/pipeline/.env") })

function envOr(name: string, fallback: string): string {
  return process.env[name] || fallback
}

// Credentials for the initial superuser bootstrapped by
// `geminibase bootstrap-superuser`. Defaults match the pipeline .env
// so a fresh local stack authenticates without extra wiring.
export const firstSuperuser = envOr(
  "GEMINI_FIRST_SUPERUSER_EMAIL",
  envOr("FIRST_SUPERUSER", "admin@gemini.example.com"),
)
export const firstSuperuserPassword = envOr(
  "GEMINI_FIRST_SUPERUSER_PASSWORD",
  envOr("FIRST_SUPERUSER_PASSWORD", "gemini-admin-dev"),
)
