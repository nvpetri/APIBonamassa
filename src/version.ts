import { version } from "../package.json";

// TypeScript copies package.json into dist: Docker and local builds use the
// version of the compiled artifact, independently of npm and the working dir.
export const apiVersion = version;

export function releaseInfo(env: NodeJS.ProcessEnv = process.env) {
  const candidate = env.RENDER_GIT_COMMIT || env.APP_COMMIT_SHA;
  const commit =
    candidate && /^[a-f0-9]{40}$/i.test(candidate)
      ? candidate.toLowerCase()
      : null;
  return { version: apiVersion, commit };
}
