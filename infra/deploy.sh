#!/usr/bin/env bash
# Deploys one image, already in ECR, to production: registers a task definition (the current
# Terraform template with that image), runs the database migrations from it, moves the service
# to it and follows the blue/green deployment to the end.
#
#   infra/deploy.sh <commit hash>                      deploy, or roll forward
#   infra/deploy.sh --skip-migrations <commit hash>    go back to an earlier image
#
# The GitHub Actions workflow runs this after it has built the image, and so does a person
# when Actions is not available (docs/DEPLOY.md, "Deploying by hand"). It needs the AWS CLI
# (signed in, region set or AWS_REGION exported) and jq.
#
# Every deploy starts from the current template, so its settings (APP_URL, sizes, secrets) are
# always the ones Terraform last applied, and the image is always one named by a commit hash.
# It cannot put the service back on the bootstrap image or on an older template's settings.
set -euo pipefail

CLUSTER=${CLUSTER:-triagecam-prod}
SERVICE=${SERVICE:-triagecam-prod-web}
ECR_REPOSITORY=${ECR_REPOSITORY:-triagecam-prod-web}
CONTAINER=${CONTAINER:-web}
LOG_GROUP=${LOG_GROUP:-/ecs/triagecam-prod/web}
TEMPLATE_PARAMETER=${TEMPLATE_PARAMETER:-/triagecam-prod/deploy/task-definition-template}
export AWS_REGION=${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}

fail() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::$*"; else echo "error: $*" >&2; fi
  exit 1
}

migrate=true
if [ "${1:-}" = "--skip-migrations" ]; then
  migrate=false
  shift
fi
tag=${1:-}
if ! [[ "$tag" =~ ^[0-9a-f]{40}$ ]]; then
  fail "Give the full commit hash of the image to deploy: infra/deploy.sh [--skip-migrations] <commit hash>"
fi

# The registry is taken from the image itself, so the account id is never typed or printed.
registry=$(aws ecr describe-images --repository-name "$ECR_REPOSITORY" --image-ids "imageTag=$tag" \
  --query 'imageDetails[0].registryId' --output text 2> /dev/null) \
  || fail "There is no image tagged $tag in the ECR repository $ECR_REPOSITORY. Build and push it first."
image="$registry.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY:$tag"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# --- the task definition: the template Terraform manages, with this image ------------------

template=$(aws ssm get-parameter --name "$TEMPLATE_PARAMETER" --query Parameter.Value --output text)
aws ecs describe-task-definition --task-definition "$template" --query taskDefinition > "$work/template.json"
jq --arg image "$image" --arg container "$CONTAINER" '
  {family, taskRoleArn, executionRoleArn, networkMode, containerDefinitions, volumes,
   placementConstraints, requiresCompatibilities, cpu, memory, runtimePlatform}
  | (.containerDefinitions[] | select(.name == $container) | .image) = $image
' "$work/template.json" > "$work/task-definition.json"
task_definition=$(aws ecs register-task-definition --cli-input-json "file://$work/task-definition.json" \
  --query taskDefinition.taskDefinitionArn --output text)
echo "Registered ${task_definition##*/} from template ${template##*/} with image ${tag:0:12}."
jq -r --arg container "$CONTAINER" '
  .containerDefinitions[] | select(.name == $container) | .environment[]
  | select(.name == "APP_URL" or .name == "TRUSTED_PROXY_HOPS") | "  \(.name)=\(.value)"
' "$work/task-definition.json"

# --- migrations -----------------------------------------------------------------------------
# Before the service changes: the new code never runs against an old schema. Migrations must
# therefore stay compatible with the code that is still serving while they run.

if [ "$migrate" = true ]; then
  network=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
    --query 'services[0].networkConfiguration' --output json)
  overrides=$(jq -cn --arg container "$CONTAINER" \
    '{containerOverrides: [{name: $container, command: ["node", "src/db/migrate.mts"]}]}')
  task=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$task_definition" \
    --launch-type FARGATE --network-configuration "$network" --overrides "$overrides" \
    --started-by "deploy-${GITHUB_RUN_ID:-by-hand}" --query 'tasks[0].taskArn' --output text)
  if [ -z "$task" ] || [ "$task" = "None" ]; then
    fail "The migration task could not be started."
  fi
  echo "Migration task ${task##*/} started; waiting for it to finish."

  deadline=$(($(date +%s) + 30 * 60))
  while :; do
    status=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" --query 'tasks[0].lastStatus' --output text)
    if [ "$status" = "STOPPED" ]; then break; fi
    if [ "$(date +%s)" -gt "$deadline" ]; then
      fail "The migration task ${task##*/} was still $status after 30 minutes. It is still running; nothing was deployed."
    fi
    sleep 10
  done

  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::group::Migration output"
  aws logs get-log-events --log-group-name "$LOG_GROUP" \
    --log-stream-name "$CONTAINER/$CONTAINER/${task##*/}" --start-from-head \
    --query 'events[].message' --output text | tr '\t' '\n' || echo "(no log output)"
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::endgroup::"

  result=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" \
    --query 'tasks[0].{exit: containers[0].exitCode, reason: stoppedReason, container: containers[0].reason}' --output json)
  if [ "$(jq -r '.exit' <<< "$result")" != "0" ]; then
    fail "The migration failed, so nothing was deployed: $(jq -c . <<< "$result")"
  fi
  echo "Migrations applied."
else
  echo "Skipping the migrations, as asked."
fi

# --- the service ------------------------------------------------------------------------------
# Blue/green: ECS starts the new task beside the old one, health checks it, moves all traffic
# to it at once and stops the old one after the bake time. A task that never becomes healthy
# is rolled back, and this script fails.

started=$(($(date +%s) - 5))
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$task_definition" > /dev/null

deployment=""
for _ in $(seq 1 30); do
  deployment=$(aws ecs list-service-deployments --cluster "$CLUSTER" --service "$SERVICE" \
    --created-at "after=$started" \
    --query 'sort_by(serviceDeployments, &createdAt)[-1].serviceDeploymentArn' --output text)
  if [ -n "$deployment" ] && [ "$deployment" != "None" ]; then break; fi
  deployment=""
  sleep 5
done
if [ -z "$deployment" ]; then
  fail "ECS did not start a deployment. (The service may already be running ${task_definition##*/}.)"
fi
echo "Deployment ${deployment##*/} started."

previous=""
deadline=$(($(date +%s) + 30 * 60))
while :; do
  state=$(aws ecs describe-service-deployments --service-deployment-arns "$deployment" \
    --query 'serviceDeployments[0].{status: status, reason: statusReason, stage: lifecycleStage}' --output json)
  status=$(jq -r '.status' <<< "$state")
  line="$status $(jq -r '.stage // ""' <<< "$state")"
  if [ "$line" != "$previous" ]; then
    echo "$(date -u +%H:%M:%S) $line"
    previous=$line
  fi
  case "$status" in
    SUCCESSFUL) break ;;
    STOPPED | ROLLBACK_SUCCESSFUL | ROLLBACK_FAILED)
      fail "The deployment did not go through ($status): $(jq -r '.reason // "no reason given"' <<< "$state")"
      ;;
  esac
  if [ "$(date +%s)" -gt "$deadline" ]; then
    fail "The deployment was still $status after 30 minutes."
  fi
  sleep 10
done

aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"
echo "Deployed ${tag:0:12} as ${task_definition##*/}."
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Deployed"
    echo "- Commit: \`$tag\`"
    echo "- Task definition: \`${task_definition##*/}\`"
  } >> "$GITHUB_STEP_SUMMARY"
fi
