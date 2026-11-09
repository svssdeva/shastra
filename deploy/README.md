# Deploying yantra / darshan / naadi

Static sites served at `beyondcodekarma.in/projects/<name>/`, fronted by the existing CloudFront +
S3 setup for the domain. Each app sets Astro `base: '/projects/<name>/'`; hand-written links and
runtime fetches use `import.meta.env.BASE_URL`.

```
deploy/
  deploy-projects.sh            build + sync + MIME/cache + invalidate
  deploy-projects.env.example   per-environment config (copy to deploy-projects.env)
  cloudfront-subdir-index.js    CloudFront Function: append index.html to projects/* dir URIs
  iam-deploy-policy.json        least-privilege policy for the deploy IAM user
  signal/                       naadi signaling server (Caddy + systemd)
```

## 0. Credentials (you, locally — never paste secrets into chat)

```
aws configure --profile beyondcodekarma     # paste IAM access key + secret from the CSV here
```

## 1. One-time AWS wiring

### 1a. Discover the distribution + bucket
```
aws --profile beyondcodekarma cloudfront list-distributions \
  --query "DistributionList.Items[].{Id:Id,Domain:DomainName,Aliases:Aliases.Items,Origin:Origins.Items[0].DomainName}" \
  --output table
```
Note the distribution `Id` and the S3 origin bucket. Confirm the OAC bucket policy grants the
distribution `s3:GetObject` on `arn:aws:s3:::<bucket>/*` (covers the new `projects/` prefix):
```
aws --profile beyondcodekarma s3api get-bucket-policy --bucket <bucket> --query Policy --output text
```

### 1b. Create + publish the subdir-index function
```
aws --profile beyondcodekarma cloudfront create-function \
  --name projects-subdir-index \
  --function-config Comment="append index.html for projects/* dirs",Runtime=cloudfront-js-2.0 \
  --function-code fileb://deploy/cloudfront-subdir-index.js
# take the ETag from the response, then:
aws --profile beyondcodekarma cloudfront publish-function \
  --name projects-subdir-index --if-match <ETag>
```

### 1c. Add the `projects/*` cache behavior
On the existing distribution add a behavior (leave the default behavior untouched):
- Path pattern: `projects/*`
- Origin: the existing S3 (OAC) origin
- Viewer protocol policy: redirect-to-https
- Cache policy: `CachingOptimized` (Managed); compress objects automatically: yes
- Function association: Viewer request -> `projects-subdir-index`

Easiest via the console; or `get-distribution-config` -> edit JSON (add to `CacheBehaviors` +
bump `Quantity`) -> `update-distribution --if-match <ETag>`.

### 1d. Deploy IAM policy
Edit `iam-deploy-policy.json` (replace `BUCKET`, `ACCOUNT_ID`, `DIST_ID`), attach to the deploy user.

## 2. Configure + deploy
```
cp deploy/deploy-projects.env.example deploy/deploy-projects.env
# set BUCKET and DIST_ID
deploy/deploy-projects.sh all          # or: deploy/deploy-projects.sh yantra darshan
```

## 3. naadi signaling server (Lightsail + Caddy)

naadi rooms need a WebSocket server (can't live on S3). Production builds connect to
`wss://signal.beyondcodekarma.in/ws` (baked in `naadi/apps/web/src/lib/peer-id.ts`, override via
`PUBLIC_NAADI_SIGNAL_URL`).

1. Lightsail: create the cheapest Ubuntu **instance** (nano), attach a **static IP**.
2. DNS (Hostinger): add `A  signal  ->  <static IP>`. Wait for it to resolve before step 4.
3. On the instance: install Bun (`curl -fsSL https://bun.sh/install | bash`) and Caddy; clone the
   repo to `/opt/naadi` (only `apps/signal` + its deps are needed); create user `naadi`.
4. Install `signal/Caddyfile` -> `/etc/caddy/Caddyfile` and `signal/naadi-signal.service` ->
   `/etc/systemd/system/`. Then:
   ```
   sudo systemctl daemon-reload
   sudo systemctl enable --now naadi-signal
   sudo systemctl reload caddy
   ```
5. Lightsail firewall: allow 80 + 443 (and 22 from your IP only); do NOT expose 3030.
6. Verify: `curl https://signal.beyondcodekarma.in/health` -> `{"ok":true,...}`.

> Single in-memory instance — no horizontal scaling. Fine for this use. Ops-free alternative:
> Lightsail **container service** (nano, managed TLS, no Caddy) at a slightly higher price.

## Verify end-to-end
- `https://beyondcodekarma.in/projects/yantra/` and `.../yantra/sim/` load; STL fixtures fetch.
- `https://beyondcodekarma.in/projects/darshan/run/` loads; `curl -I .../darshan/wasm/darshan-inference-core.wasm`
  returns `content-type: application/wasm`.
- `https://beyondcodekarma.in/projects/naadi/` -> Create room -> two tabs on the same `/r#<id>`
  reach connection status `open` and edits sync.
- Root site `https://beyondcodekarma.in/` still works (no regression from the new behavior).
