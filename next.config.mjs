/** @type {import('next').NextConfig} */
export default {
  // Drivers de base de datos: se cargan de node_modules, sin empaquetar (PGlite trae su propio WebAssembly)
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
  poweredByHeader: false,
};
