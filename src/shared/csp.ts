/**
 * Content-Security-Policy for the renderer.
 * Dev relaxes script/connect only as far as Vite HMR and the React refresh preamble require.
 */
export function contentSecurityPolicy(isDev: boolean): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // pdf.js compiles WebAssembly image decoders (JPX/JBIG2), hence wasm-unsafe-eval.
    'script-src': isDev
      ? ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"]
      : ["'self'", "'wasm-unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'worker-src': ["'self'", 'blob:'],
    'connect-src': isDev ? ["'self'", 'ws://localhost:*'] : ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"]
  }
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}
