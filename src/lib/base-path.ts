// This site is served at the bare host root (see Deploy/kube/
// s3-starter-site-route.yaml) — no basePath. Kept as an empty-string helper
// rather than removing every assetPath()/BASE_PATH call site, so a future
// re-introduction of a basePath only needs to change this one file.
export const BASE_PATH = '';

export function assetPath(path: string): string {
  return `${BASE_PATH}${path}`;
}
