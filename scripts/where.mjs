/**
 * Prints the URL to actually open, for environments where `localhost` is not
 * the answer — Codespaces, Gitpod, and friends.
 *
 * Silent on a local machine: there the dev server already prints everything
 * you need, and an extra banner is just noise.
 *
 *   node scripts/where.mjs <port>
 */

const port = process.argv[2] ?? '5173';

function url() {
  const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } = process.env;
  if (CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    return `https://${CODESPACE_NAME}-${port}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}/`;
  }
  const { GITPOD_WORKSPACE_ID, GITPOD_WORKSPACE_CLUSTER_HOST } = process.env;
  if (GITPOD_WORKSPACE_ID && GITPOD_WORKSPACE_CLUSTER_HOST) {
    return `https://${port}-${GITPOD_WORKSPACE_ID}.${GITPOD_WORKSPACE_CLUSTER_HOST}/`;
  }
  return null;
}

const target = url();
if (target) {
  const rule = '─'.repeat(Math.max(20, target.length + 2));
  console.log('');
  console.log(`  ┌${rule}┐`);
  console.log(`  │ ${target} │`);
  console.log(`  └${rule}┘`);
  console.log('  Open that, not localhost. If it 404s, the server on port');
  console.log(`  ${port} is not up yet — wait for the "ready" line below, then reload.`);
  console.log('');
}
