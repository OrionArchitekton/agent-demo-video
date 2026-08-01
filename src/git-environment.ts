/**
 * Return a copy of the process environment that cannot redirect Git to a
 * caller-selected repository, worktree, index, object store, or config.
 *
 * Git has a broad and extensible GIT_* environment surface. An allowlist of
 * known repository selectors would become unsafe when Git adds another one,
 * so authority-sensitive calls remove the entire namespace, then restore only
 * config-neutral values that disable system, global, and system-attribute
 * inputs. Command arguments separately disable repository-local fsmonitor and
 * hook execution.
 */
export function sanitizedGitEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = { ...source };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("GIT_")) {
      delete environment[name];
    }
  }
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = "/dev/null";
  environment.GIT_ATTR_NOSYSTEM = "1";
  return environment;
}
