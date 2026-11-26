// Genera public/config.js con las variables de entorno de Vercel.
// La "anon key" de Supabase es pública por diseño: la seguridad la ponen el login y las políticas RLS.
import { writeFileSync } from "node:fs";

const url = process.env.SUPABASE_URL || "";
const anonKey = process.env.SUPABASE_ANON_KEY || "";
if (!url || !anonKey) {
  console.warn("⚠️  Faltan SUPABASE_URL y/o SUPABASE_ANON_KEY: la app mostrará un aviso.");
}
writeFileSync(
  new URL("../public/config.js", import.meta.url),
  `window.MIA_CONFIG=${JSON.stringify({ url, anonKey })};\n`
);
console.log("config.js generado");
