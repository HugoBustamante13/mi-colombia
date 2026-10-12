/**
 * Configuración de la nube (opcional).
 *
 * Sin estos valores la app funciona igual, solo en este navegador.
 * Para sincronizar entre dispositivos, crea un proyecto gratuito en https://supabase.com,
 * ejecuta supabase/esquema.sql y copia aquí los datos de
 * Project Settings → API ("Project URL" y la clave "anon public").
 *
 * La clave "anon" es pública por diseño: la seguridad la dan las políticas RLS del esquema.
 */
export const NUBE = {
  url: '',          // p. ej. 'https://abcdefghijkl.supabase.co'
  claveAnonima: '', // p. ej. 'eyJhbGciOi…'
};
