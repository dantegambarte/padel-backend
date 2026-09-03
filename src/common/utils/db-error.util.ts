/**
 * Forma mínima de los errores que llegan a los `catch` de los servicios:
 * errores de Postgres (traen `code`, ej. 23505 unique_violation, 23514 check_violation)
 * y excepciones HTTP de Nest (traen `getStatus`).
 */
export interface DbErrorLike {
  code?: string;
  message?: string;
  stack?: string;
  getStatus?: () => number;
}

/**
 * Acota un error capturado como `unknown` sin perder información.
 * Devuelve un objeto vacío si lo capturado no es un objeto (por ejemplo un
 * `throw 'texto'`), de modo que el acceso a las propiedades sea siempre seguro.
 */
export function asDbError(error: unknown): DbErrorLike {
  return typeof error === 'object' && error !== null ? error : {};
}
