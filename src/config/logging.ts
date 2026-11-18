/**
 * JSON logs are the default in production (one object per line, easy to ship
 * and query); LOG_FORMAT=json|pretty overrides it in any environment.
 */
export function useJsonLogs(env: NodeJS.ProcessEnv): boolean {
  if (env.LOG_FORMAT === 'json') return true;
  if (env.LOG_FORMAT === 'pretty') return false;
  return env.NODE_ENV === 'production';
}
