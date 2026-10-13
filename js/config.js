/**
 * Configuración de la nube (Supabase).
 *
 * Sin estos valores la app funciona igual, solo en este navegador.
 * Para usar otro proyecto, ejecuta supabase/esquema.sql en él y copia aquí la
 * "Project URL" y la clave pública ("publishable" o "anon") de Project Settings → API Keys.
 *
 * Esta clave es pública por diseño (viaja dentro de la app): la seguridad la dan
 * las políticas RLS del esquema. Nunca pongas aquí la clave "secret" ni "service_role".
 */
export const NUBE = {
  url: 'https://wpfujjkfnjqhscgeocwk.supabase.co',
  claveAnonima: 'sb_publishable_8e2gtwk8DtuzjWW7sqtF4w_Ut8ALDaR',
};
