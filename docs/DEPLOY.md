# Production hosting

Triage Cam runs on AWS in `us-east-1` and is served at `https://crowdpulse.care` through Cloudflare. Everything in AWS and the DNS records are Terraform (`infra/`), applied by hand. Deploys of the app are a GitHub Actions workflow (`.github/workflows/deploy.yml`) that runs on every push to `main` that touches the web app, or the same steps run by hand (`infra/deploy.sh`, see "Deploying by hand") when Actions is not available, which is the case today.

The repository is public. Account ids, zone ids, ARNs and IP addresses are kept out of it: they live in git-ignored `infra/terraform.tfvars` and `infra/backend.hcl`, in the Terraform state, and in GitHub Actions secrets.

## State on 14 November 2026

- **Live in stage 2** (below): `https://crowdpulse.care` answers through Cloudflare, `www` redirects to it, and only Cloudflare's addresses can reach the load balancer. The Cloudflare zone went active at 18:07 UTC, during the build; stage 1 was brought up and checked first, then the switch described below was made.
- **The deploy workflow has never run on GitHub.** Every run was refused before it started: "The job was not started because your account is locked due to a billing issue." Every deploy so far was made by hand: the image built and pushed from a laptop with the owner's credentials, then `infra/deploy.sh` ("Deploying by hand"). That path is proven; the build on GitHub's runner, the OIDC sign-in and the role's permissions in real use are not (the role's policy was checked call by call with IAM's policy simulator). Once the billing issue is cleared: `gh workflow run deploy.yml --ref main` after this branch is merged, and watch it.
- **Nobody can sign in yet, and "Create an account" on the landing page leads nowhere**: there is no `RESEND_API_KEY`, so no verification email is sent (see Secrets). Set it before anyone is pointed at the site. The production database has the schema and no accounts.
- **The origin check is written but not switched on** ("Who can reach the load balancer"): the Cloudflare token in use cannot manage transform rules. Until the owner applies it with a wider token, the load balancer accepts requests from any Cloudflare customer's zone or Worker that names this domain, not only from this zone.
- The Cloudflare SSL/TLS mode could not be read (the token has DNS rights only). Cloudflare does reach the origin over HTTPS today; confirm in the dashboard that the mode is **Full (strict)**.
- The repository was renamed to `DylanMashini/crowdpulse`. The `origin` remote of the checkouts on the owner's Mac still uses the old name (`recheck`), which GitHub redirects; pushes and `gh` work. The deploy role's trust names the new name (see "Who may deploy").

## Shape

```
visitor ── HTTPS ──> Cloudflare (proxy, DNS) ── HTTPS ──> ALB ── HTTP :3000 ──> one Fargate task ──> RDS Postgres
                                                       (public subnets, 2 zones)                  (private subnets, Multi-AZ)
```

| Piece | What | Where in `infra/` |
|---|---|---|
| Network | A VPC of its own, two public and two private subnets across two zones. No NAT gateway: the task has a public address for outbound calls and accepts connections only from the load balancer. | `network.tf` |
| Load balancer | Application Load Balancer, idle timeout 300 s (the readings stream and the live view are responses that never end; both send something every 15 s). Deletion protection on. | `alb.tf` |
| App | ECS on Fargate, **one** service, desired count 1, 4 vCPU and 16 GB, `linux/amd64`. | `ecs.tf` |
| Database | RDS Postgres 17, `db.m7g.large`, Multi-AZ, encrypted, 7 days of automated backups, deletion protection on, a final snapshot on destroy. | `rds.tf` |
| Domain | Cloudflare DNS: apex and `www` as proxied CNAMEs to the load balancer. ACM certificate for both names, validated by DNS records in the same zone. `www` redirects to the apex at the load balancer. | `dns.tf` |
| Secrets | The database password is made and kept by RDS in Secrets Manager. The app's own keys are one Secrets Manager secret, `triagecam-prod/app`. | `rds.tf`, `secrets.tf` |
| Deploy access | GitHub's OIDC provider and one IAM role that only this repository's workflow runs on `main` can assume. No AWS keys are stored in GitHub. | `github.tf` |
| State | S3 bucket `triagecam-tfstate-<account id>`, versioned, encrypted, locked with S3's own lock file. | `bootstrap/` |

Sizes are variables (`task_cpu`, `task_memory`, `db_instance_class`, `db_multi_az`, see `infra/variables.tf`). The defaults are far above what the app needs and were chosen for the demo; see "Cost" below.

### Why one task

The app is one process by design: the live view relay, the fan-out of the event stream, the rate limits and the timers (overdue check, cleanup) are in memory (`docs/CONTRACTS.md`, Live view). Two tasks behind the load balancer would each see half the picture. So the service runs exactly one task, there is no standby and no Cloudflare Load Balancing, and availability comes from ECS replacing the task when its health check fails, in whichever of the two zones has room.

Two tasks do overlap for about two minutes during a deploy (below). What that means:

- Only one of them receives traffic at any moment, so the live view and the event stream are never split.
- Both run the overdue timer if both have served a signed-in request. Opening a flag is serialised in Postgres (an advisory lock per patient plus a unique index), and so is the push cool-down (`claimPush` in `apps/web/src/server/push.ts`), so a patient is flagged once and pushed once.
- Rate limits are per process, so a caller can get both tasks' allowances during the overlap.
- When the old task stops, its open streams are cut. The dashboard's `EventSource` and the phone reconnect by themselves; the live view picture resumes with the next frame.

### Health

`GET /api/health` (public, `docs/CONTRACTS.md` section 4). 200 when the server can open a new connection to Postgres and run a query, 503 when it cannot. Requests within five seconds of each other share one check, so the public route cannot be used to open database connections at will. The load balancer asks every 15 seconds; three failures in a row and ECS replaces the task. **A database restart therefore also replaces the web task**: a Multi-AZ failover or a minor version upgrade takes the database away for longer than 45 seconds, the task fails its checks and a new one starts (open streams are cut, about a minute and a half more of 503s). Minor version upgrades happen in the maintenance window, Wednesday 09:00 UTC. Measured on 14 November 2026 by stopping the running task: the site answered 503 for 58 seconds, and the replacement was serving 87 seconds after the stop. It does not read a session, so health checks alone never start the app's timers: those start with the first signed-in request a task serves (`apps/web/src/server/jobs.ts`), which means **after a deploy or a task replacement, nobody is marked overdue until a signed-in client has made a request**. An open dashboard or nurse app reconnects within seconds, so in practice this is immediate, but an unattended server with no clients does not run the overdue check.

## The two stages

HTTPS on the domain needs the domain to resolve through Cloudflare, which needs the registrar to point `crowdpulse.care` at Cloudflare's nameservers (the `cloudflare_name_servers` output). Until that has happened the Cloudflare zone is "pending": its DNS records exist but nobody can resolve them, and ACM cannot validate the certificate. The stack is built so that `terraform apply` never waits for that.

| | Stage 1: zone pending | Stage 2: zone active |
|---|---|---|
| Reachable at | `http://<load balancer name>` (the `load_balancer_dns_name` output) | `https://crowdpulse.care` |
| Who can reach the load balancer | Only `operator_cidrs`, on port 80 | Cloudflare's address ranges on 443 (and on 80, which only redirects to HTTPS), plus `operator_cidrs` on 443 while that list is not empty |
| Certificate | Requested, validation records in place, not yet issued | Issued, on the 443 listener |
| `APP_URL` in the task | `http://<load balancer name>` | `https://crowdpulse.care` (so cookies are `Secure`) |
| `TRUSTED_PROXY_HOPS` in the task | 1 | 2 |

Which stage applies is decided by `local.domain_live` in `infra/main.tf`: it follows the Cloudflare zone's status, and the variable `domain_live` overrides it (`false` holds the stack in stage 1 whatever the zone says).

### Going from stage 1 to stage 2

1. At the registrar, set the domain's nameservers to the two in `terraform output cloudflare_name_servers`. Wait until `terraform output cloudflare_zone_status` (after a `terraform refresh`) or the Cloudflare dashboard says `active`.
2. In the Cloudflare dashboard, **SSL/TLS > Overview: set the mode to Full (strict)**. Terraform cannot do this: the API token has DNS rights only. With "Flexible", Cloudflare would talk to the origin on port 80, which answers with a redirect to HTTPS, and the site loops.
3. Make sure `domain_live` is not set to `false` in `terraform.tfvars`, then:

   ```bash
   cd infra
   terraform apply
   ```

   This waits for ACM to issue the certificate (minutes once the zone is active; the timeout is 45 minutes), adds the 443 listener, moves the app's listener rule to it, turns port 80 into a redirect, and replaces the security group rules. ECS starts a blue/green deployment of its own to pick up the new rule (about three minutes). For the first minute after the apply the apex can answer Cloudflare's 521 while the rules settle.
4. The task definition changed (`APP_URL`, `TRUSTED_PROXY_HOPS`), and the service only takes a new task definition from a deploy. Run one:

   ```bash
   gh workflow run deploy.yml --ref main
   # or, without Actions, redeploy the image that is running: see "Deploying by hand"
   ```

5. Check: `curl -sI https://crowdpulse.care/api/health` answers 200 with a `cf-ray` header; `curl -sI https://www.crowdpulse.care/` answers 301 to the apex. (The load balancer writes the redirect target as `https://crowdpulse.care:443/...`; browsers drop the port.)
6. Remove your own address from `operator_cidrs` and apply again, so that only Cloudflare can reach the origin. This matters for more than tidiness: with `TRUSTED_PROXY_HOPS=2` the rate limits take the caller's address from the `X-Forwarded-For` entry that Cloudflare wrote, and a caller who can reach the load balancer directly could write that entry themselves.

## First-time setup

For a new AWS account, or after `terraform destroy`. Needs Terraform 1.11 or newer, the AWS CLI signed in, Docker, and `gh`.

```bash
# 1. The state bucket.
cd infra/bootstrap
terraform init && terraform apply
echo "bucket = \"$(terraform output -raw state_bucket)\"" > ../backend.hcl

# 2. Variables. See terraform.tfvars.example: the Cloudflare zone id, how GitHub names the
#    repository in its OIDC tokens, and your own IP address. The zone id can come from the
#    environment instead: export TF_VAR_cloudflare_zone_id=...
cd ..
cp terraform.tfvars.example terraform.tfvars   # fill in

# 3. Cloudflare token with "Zone > DNS > Edit" and "Zone > Zone > Read" on the zone, and
#    "Zone > Transform Rules > Edit" as well if origin_header_check is to be switched on.
#    From the environment only; it is not a Terraform variable and never reaches the state.
export CLOUDFLARE_API_TOKEN=...

terraform init -backend-config=backend.hcl
terraform apply

# 4. The service is created with the image tag "bootstrap", which has to exist once.
#    (Until it does, ECS retries the pull; nothing else is wrong.)
cd ..
registry=$(cd infra && terraform output -raw ecr_repository_url)
aws ecr get-login-password | docker login --username AWS --password-stdin "${registry%%/*}"
docker build --platform linux/amd64 -f apps/web/Dockerfile -t "$registry:bootstrap" .
docker push "$registry:bootstrap"

# 5. What the workflow needs.
gh variable set AWS_REGION --body us-east-1
(cd infra && terraform output -raw deploy_role_arn) | gh secret set AWS_DEPLOY_ROLE_ARN

# 6. First deploy: runs the migrations and replaces the bootstrap image.
#    (Without GitHub Actions: "Deploying by hand", below.)
gh workflow run deploy.yml --ref main
```

**Every later `terraform plan` or `apply` needs the same two things from the environment**: `CLOUDFLARE_API_TOKEN`, and the zone id unless it is in `terraform.tfvars`. On the owner's Mac the `terraform.tfvars` in use does not hold the zone id: both values are in the git-ignored `.env` at the root of the main checkout, as `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID`.

```bash
set -a; . /path/to/main/checkout/.env; set +a
export TF_VAR_cloudflare_zone_id=$CLOUDFLARE_ZONE_ID
cd infra && terraform plan
```

The bootstrap state (`infra/bootstrap/terraform.tfstate`) is a local, git-ignored file holding only the bucket. If it is lost, `terraform import aws_s3_bucket.state triagecam-tfstate-<account id>` brings it back.

## Deploys

`.github/workflows/deploy.yml` runs on a push to `main` that changes `apps/web`, `packages/contracts`, the fonts, the lockfile, the workflow itself or `infra/deploy.sh`, and by hand (`gh workflow run deploy.yml --ref main`). One deploy runs at a time. It:

1. Signs in to AWS with GitHub's OIDC token (role `triagecam-prod-github-deploy`; the account id is masked in the public log).
2. Builds `apps/web/Dockerfile` for `linux/amd64` and pushes it to ECR tagged with the commit hash. Tags are immutable; a re-run of the same commit reuses the image.
3. Runs `infra/deploy.sh <commit hash>`, which does the rest:
   - Registers a task definition: a copy of the one Terraform manages, with the new image. Terraform's revision is the template and its ARN is in the SSM parameter `/triagecam-prod/deploy/task-definition-template`.
   - Runs the migrations as a one-off task from that task definition (`node src/db/migrate.mts`, the same image) and waits for it, up to 30 minutes. A non-zero exit stops the deploy before the service is touched. The migration output is printed.
   - Updates the service and follows the ECS deployment until it has succeeded (about three minutes). A deployment that ECS rolls back fails the script.

The workflow's actions are pinned to commit hashes, with the version in a comment beside each. To update one, look up the commit of the new version's tag (`gh api repos/<owner>/<action>/commits/<tag> -q .sha`) and change both.

**Blue/green, by ECS itself** (not CodeDeploy). ECS starts the new task in the idle one of the two target groups, waits for it to pass the health check, moves the listener rule to it in one step, keeps the old task for `bake_time_minutes` (1) in case it has to go back, then stops it. If the new task never becomes healthy the deployment is rolled back and the old task carries on untouched.

**Migrations run while the old code is still serving**, so a migration has to be compatible with the code before it: add columns and tables first, remove them in a later deploy. Nothing seeds the production database; the seed script is for development.

**A deploy cuts the open streams once**, when the old task stops. Do not deploy during a demo.

**Terraform changes to the task** (environment, sizes, secrets wiring) make a new template revision; the service keeps running the old one until the next deploy. After such an apply, deploy: run the workflow by hand, or redeploy the running image by hand (below).

### Deploying by hand

For when GitHub Actions is not available (today: the billing lock), and for redeploying or rolling back without a commit. It is the workflow's own steps: the image build, then the same script. Needs Docker, `jq` and the AWS CLI signed in as someone who may push to ECR and update the service (the owner's credentials; the deploy role is for GitHub only).

```bash
# From the repository root, on the commit to deploy, with nothing uncommitted: the image is
# named after the commit, so it has to be exactly that commit.
git status --short            # must print nothing
commit=$(git rev-parse HEAD)

repository=$(aws ecr describe-repositories --repository-names triagecam-prod-web \
  --query 'repositories[0].repositoryUri' --output text)
aws ecr get-login-password | docker login --username AWS --password-stdin "${repository%%/*}"
docker build --platform linux/amd64 -f apps/web/Dockerfile -t "$repository:$commit" .
docker push "$repository:$commit"

infra/deploy.sh "$commit"     # migrations, then the blue/green deployment; about six minutes
```

On an Apple-silicon Mac the build is emulated and takes several minutes; it needs a few GB of free disk in Docker. If the image for that commit is already in ECR (a re-run, or the workflow built it), skip the build and run only `infra/deploy.sh`.

To **redeploy what is running** (after a Terraform change to the task, or after filling in a secret when you also want the new template), find the running commit and deploy it again without the migrations:

```bash
running=$(aws ecs describe-services --cluster triagecam-prod --services triagecam-prod-web \
  --query 'services[0].taskDefinition' --output text)
commit=$(aws ecs describe-task-definition --task-definition "$running" \
  --query 'taskDefinition.containerDefinitions[0].image' --output text)
infra/deploy.sh --skip-migrations "${commit##*:}"
```

### Rolling back

**With a commit**: `git revert` the commit on `main`, push, and deploy the result (the workflow does it on the push; by hand, as above). This is the normal way and keeps `main` and production the same.

**Without a commit**, go back to an earlier image. ECR keeps the newest 20:

```bash
# Images, newest first: when each was pushed and the commit it was built from.
aws ecr describe-images --repository-name triagecam-prod-web \
  --query 'reverse(sort_by(imageDetails, &imagePushedAt))[].[imagePushedAt, imageTags[0]]' --output text

infra/deploy.sh --skip-migrations <commit hash of the earlier image>
```

`infra/deploy.sh` only accepts a 40-character commit hash and always copies the current Terraform template, so a rollback made with it has today's settings and a real build.

**Do not roll back by pointing the service at an old task definition revision** (`aws ecs update-service --task-definition triagecam-prod-web:<n>`). The revisions are not a history of good deploys:

- The revision Terraform manages (the template; a new one after every apply that changes the task) names the image tag `bootstrap`, a hand-pushed image from before the first deploy. It is often the second newest revision.
- A revision registered before a Terraform change carries the old settings. One from stage 1 would have `APP_URL=http://<load balancer name>` and `TRUSTED_PROXY_HOPS=1`: cookies stop being `Secure`, verification links point at an address nobody can reach, and every visitor shares a handful of rate-limit buckets. (The stage-1 revision of this stack was deregistered on 14 November 2026 for that reason.)

To see what each revision is before trusting it:

```bash
for arn in $(aws ecs list-task-definitions --family-prefix triagecam-prod-web --sort DESC \
  --max-items 10 --query 'taskDefinitionArns' --output text); do
  aws ecs describe-task-definition --task-definition "$arn" --output text --query \
    'taskDefinition.[revision, containerDefinitions[0].image, containerDefinitions[0].environment[?name==`APP_URL`].value | [0]]'
done
```

A revision is safe to run only if its image ends in a commit hash and its `APP_URL` is `https://crowdpulse.care`.

No rollback undoes a migration. If the earlier code cannot run against the newer schema, write a new migration that makes it compatible and deploy forward.

### Who may deploy

The role trusts workflow runs of this repository on `refs/heads/main` only (`github_deploy_refs`), which covers pushes to `main` and manual runs from `main`. Any workflow file on `main` qualifies, not only `deploy.yml`.

The repository is named in the trust policy by the exact prefix GitHub reports for it (`github_oidc_subject_prefix`). This repository uses GitHub's immutable form, `repo:<owner>@<owner id>/<repository>@<repository id>`. The ids stop someone who later takes over a freed name from deploying, but **the names are still part of the string, so renaming or transferring the repository changes it and every deploy is then refused at "Sign in to AWS"** until the new value is applied:

```bash
gh api repos/<owner>/<repository>/actions/oidc/customization/sub -q .sub_claim_prefix
# put the answer in infra/terraform.tfvars as github_oidc_subject_prefix, then
cd infra && terraform apply
```

The trust policy today matches the repository under its current name, `DylanMashini/crowdpulse`.

## Secrets

| Secret | What | Who writes it |
|---|---|---|
| `rds!db-…` (see the RDS console, "Master credentials ARN") | The database user and password | RDS |
| `triagecam-prod/app` | A JSON object with the keys `RESEND_API_KEY`, `RESEND_FROM`, `EMAIL_FROM`, `EXPO_ACCESS_TOKEN` | The owner |

The task gets each JSON key as an environment variable of the same name when it starts. Terraform creates `triagecam-prod/app` with every value empty and never writes it again; the app reads an empty variable as "not set" and runs without it. To fill them in:

```bash
aws secretsmanager put-secret-value --secret-id triagecam-prod/app --secret-string '{
  "RESEND_API_KEY": "re_...",
  "RESEND_FROM": "Triage Cam <no-reply@crowdpulse.care>",
  "EMAIL_FROM": "",
  "EXPO_ACCESS_TOKEN": ""
}'
aws ecs update-service --cluster triagecam-prod --service triagecam-prod-web --force-new-deployment
```

(Or edit the secret in the Secrets Manager console.) The second command needs neither GitHub Actions nor a build: it restarts the task on the revision it already runs. Keep all four keys in the object, empty if unused: a missing key stops the task from starting. Values are read when a task starts, so the second command, or any deploy, is what makes them take effect. `RESEND_FROM` must be on a domain verified in Resend.

**The database password is not rotated.** RDS would rotate it every seven days by default, and the running task, which was started with the old one, could then open no new connections until it was replaced. Rotation is switched off (`db_password_rotation_enabled`). If it is ever switched on, the health check notices (it opens a fresh connection each time) and ECS replaces the task with one that has the new password, at the cost of a minute or two of errors at a time nobody chose.

The task builds `DATABASE_URL` itself from `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD` (`apps/web/scripts/container-entrypoint.sh`), with `sslmode=verify-full`: the connection is encrypted and the server's certificate is checked against Amazon's RDS root certificates, which the image carries.

### Until `RESEND_API_KEY` is set, nobody can sign in

**"Create an account" is the main button on the public landing page, and until this key is set it is a dead end**: the account is made, the visitor is told to check their email, and no email comes. Nothing in the app works around this and nothing should; the fix is the key. Put `RESEND_API_KEY` and `RESEND_FROM` into `triagecam-prod/app` and restart the task (the two commands above) before a judge or anyone else is sent to the site, then sign up once yourself to see the email arrive.

Sign-up creates the account and answers 201, but no verification email is sent (the server logs "RESEND_API_KEY is not set, so the verification email was not sent"), the verification token is not returned to the caller or written to the log in production, and sign-in answers 403 `email_not_verified` for an unverified account. So without the key there is no way through email verification, by design, and production has no accounts. Once the key is set, an account created earlier gets a working link from "resend verification".

## Operating it

```bash
# What is running
aws ecs describe-services --cluster triagecam-prod --services triagecam-prod-web \
  --query 'services[0].{running: runningCount, taskDefinition: taskDefinition, events: events[0:5].message}'

# Logs
aws logs tail /ecs/triagecam-prod/web --follow

# Deployments, newest first
aws ecs list-service-deployments --cluster triagecam-prod --service triagecam-prod-web

# Restart the task (blue/green, no downtime beyond the stream reconnect)
aws ecs update-service --cluster triagecam-prod --service triagecam-prod-web --force-new-deployment
```

The database is in private subnets and has no public address. To run SQL against it, run a one-off task from the service's task definition with a command override, the way the workflow runs the migrations.

Rate limits (`apps/web/src/server/rate-limit.ts`) take the caller's address from `X-Forwarded-For`, counting `TRUSTED_PROXY_HOPS` entries from the right: the load balancer appends the address it was called from, and Cloudflare before it appends the visitor's. Terraform sets the variable to match the stage. An IPv6 caller is counted by /64. Sign-in allows, per five minutes, 60 attempts from one address (so a venue behind one address can sign in to its different accounts), 10 on one account from one address, and 30 on one account from all addresses together. The counters are in memory and start again with every deploy.

The app sends its own security headers on every response (`apps/web/next.config.ts`): HSTS, `X-Frame-Options: DENY` with `frame-ancestors 'none'`, `nosniff`, a referrer policy and a permissions policy. Nothing at Cloudflare adds or removes them. There is no script or style content policy.

### Who can reach the load balancer

Two layers, of which the second is **not switched on yet**:

1. **Cloudflare's addresses only** (the security group, `infra/network.tf`). Direct connections time out. The list is read from Cloudflare when Terraform plans, so it is as old as the last apply: **run `terraform apply` every month or two**, and whenever Cloudflare announces new ranges, or visitors routed through a new range get timeouts.
2. **This zone only** (`origin_header_check`, `infra/dns.tf`). Cloudflare's addresses are shared by all its customers, so anyone can send requests to the load balancer through a zone or Worker of their own. With the check on, a Cloudflare rule adds a header holding a generated secret to every request of this zone on its way to the origin, and the listener rule that forwards to the app requires it; anything else gets the listener's 404. The secret is generated by Terraform and is only in the state, at Cloudflare and in the listener rule.

   Switching it on needs a Cloudflare API token that has **Zone > Transform Rules > Edit** on the zone as well as the DNS rights; the token used so far has DNS rights only, so this has been planned (`terraform plan -var origin_header_check=true`: one rule set, one secret, one listener rule change) but never applied. With such a token in `CLOUDFLARE_API_TOKEN`:

   ```bash
   # infra/terraform.tfvars
   origin_header_check = true
   ```

   ```bash
   cd infra && terraform apply
   curl -sI https://crowdpulse.care/api/health    # still 200
   ```

   Terraform makes the Cloudflare rule first and changes the load balancer after it. If the site answers 404 "Not found" afterwards, Cloudflare is not adding the header: set the variable back to `false` and apply. If the zone already has "Modify request header" rules made in the dashboard, Cloudflare refuses a second rule set for that phase; import the existing one into `cloudflare_ruleset.origin_header[0]` first. Every later apply needs the wider token too.

The mobile app has to be built against the production URL (`EXPO_PUBLIC_API_URL=https://crowdpulse.care` in `apps/mobile/.env.local`, then a new build); nothing in this stack does that.

## Cost

What the defaults cost while they run, `us-east-1` on-demand prices, rounded:

| | Per month |
|---|---|
| Fargate, 4 vCPU and 16 GB, one task | $170 |
| RDS `db.m7g.large` Multi-AZ, 20 GB gp3 | $250 |
| Load balancer | $20 |
| Three public IPv4 addresses (two for the load balancer, one for the task) | $11 |
| Secrets Manager, CloudWatch logs, ECR, S3 | $5 |
| **Total** | **about $455** |

Cloudflare is on the free plan. With `task_cpu = 1024`, `task_memory = 2048`, `db_instance_class = "db.t4g.small"` and `db_multi_az = false` the same stack is about $90 a month.

### Scaling down after the demo

Do this when nobody is using the site: the database change takes it away for some minutes.

1. In `infra/terraform.tfvars`:

   ```hcl
   task_cpu             = 1024
   task_memory          = 2048
   db_instance_class    = "db.t4g.small"
   db_multi_az          = false
   db_apply_immediately = true
   ```

   **Without `db_apply_immediately = true` the database does not change when you apply.** RDS holds a change of instance class or Multi-AZ until the next maintenance window (Wednesday 09:00 UTC), and the bill stays as it was until then. `terraform apply` reports success either way; the held change shows as `PendingModifiedValues` in `aws rds describe-db-instances --db-instance-identifier triagecam-prod`.

2. `cd infra && terraform apply`. The database restarts on the smaller class. The site answers 503 while it is away, the web task fails its health checks and ECS replaces it; allow ten minutes for it all to settle, and check `curl -sI https://crowdpulse.care/api/health`.

3. The smaller task size is in the new template but **not in the running service until a deploy**. Redeploy the running image ("Deploying by hand", the `--skip-migrations` commands, or the workflow). This is a blue/green deploy with no downtime beyond the stream reconnect.

4. Take `db_apply_immediately` out of `terraform.tfvars` again (no apply needed; it only says when later changes are made), so that a future change does not restart the database at a moment nobody chose.

Scaling back up is the same in reverse.

### Pausing it

To stop paying for the task and the database for a few days without destroying anything (the load balancer and its addresses, about $30 a month, keep running; the site answers 503). These steps have not been exercised on this stack:

```bash
aws ecs update-service --cluster triagecam-prod --service triagecam-prod-web --desired-count 0
aws rds stop-db-instance --db-instance-identifier triagecam-prod
```

**RDS starts a stopped database again by itself after seven days.** While paused, `terraform plan` shows the service's count as a change (1 in the configuration); do not apply until it is running again. To resume:

```bash
aws rds start-db-instance --db-instance-identifier triagecam-prod
aws rds wait db-instance-available --db-instance-identifier triagecam-prod
aws ecs update-service --cluster triagecam-prod --service triagecam-prod-web --desired-count 1
```

## Taking it down

`terraform destroy` is refused by design until deletion protection is switched off on the database and the load balancer (set `deletion_protection = false` in `rds.tf` and `enable_deletion_protection = false` in `alb.tf`, apply, then destroy). RDS takes a final snapshot named `triagecam-prod-final`. The ECR repository must be emptied first. The state bucket is separate (`infra/bootstrap`) and has `prevent_destroy`.
