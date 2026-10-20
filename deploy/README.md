# GitHub deployment

`Deploy Portlore` is a manual workflow for `main`. It requires successful CI for
the exact commit and approval through the `Production` environment.

One-time setup:

1. Restrict `Production` to `main` and require Nic as reviewer.
2. Install `scripts/deploy-remote.sh` as `/usr/local/sbin/portlore-github-deploy`,
   owned by root with mode 755.
3. Create a dedicated SSH key. Its server authorization must use
   `restrict,command="/usr/local/sbin/portlore-github-deploy"`.
4. Store its private key as `PORTLORE_DEPLOY_KEY` in the GitHub environment.
   Store the independently verified server host-key entry as
   `PORTLORE_DEPLOY_KNOWN_HOSTS`.

The forced command accepts only `deploy` followed by a full commit SHA. It
validates archive paths, installs production dependencies in staging, retains one
previous source/configuration backup, checks nginx configuration and API health,
and rolls back on failure. Code, public client assets and nginx configuration
ship together. Runtime guides, maps, port data, credentials and environment files
remain on the server. No guide generation runs during deployment.

After approval, run `gh workflow run deploy.yml --ref main`, approve the Production
job, and verify the live port count, cached guide, directory and missing-page status.
The deployed revision is recorded in `/var/www/portlore/.release`.

`scripts/deploy.sh` is the older local full-data deployment path. Use the GitHub
workflow for application releases; it intentionally excludes local data and secrets.
