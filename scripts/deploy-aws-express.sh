#!/usr/bin/env bash
#
# Deploy a Raycast backend role to AWS ECS Express Mode (web, AI, or AnyCable).
#
# Why this script instead of Pulumi: the AWS::ECS::ExpressGatewayService
# CloudFormation/CloudControl resource is broken on create (opaque InternalFailure),
# while the native ECS API works. So Pulumi (raycast-infra) owns the supporting
# resources (ECR repo, IAM roles, log groups, CloudFront) and this script
# creates/updates the Express service via the native ECS API.
#
# The service definition (image, env, secrets, ports, scaling) lives here. On every
# deploy we either create the service (first run) or push a new revision that pulls
# the freshly published image tag with the current SSM secrets.
#
# IAM roles and log group follow the Pulumi naming convention
# (ecs-<kind>-<service-name> / /ecs/<service-name>). Role-specific values (SSM prefix,
# OTEL name, extra env, sizing, scaling) come from env vars with staging-web defaults.
#
# Usage:
#   deploy-aws-express.sh <region> <cluster> <service-name> <ecr-repository> <image-tag>
#
# Role-specific env overrides:
#   BACKEND_SSM_PREFIX        SSM parameter prefix (default: /raycast-backend/staging)
#   BACKEND_CONTAINER_PORT    Container port (default: 3000)
#   BACKEND_HEALTH_CHECK_PATH ALB health check path (default: /up)
#   BACKEND_RAILS_ENV         RAILS_ENV for the container (default: staging)
#   BACKEND_ALB_IDLE_TIMEOUT  Idle timeout (s) for the shared gateway ALB, 0=skip (default: 0)
#   BACKEND_EXTRA_ENV_JSON    Extra plain env vars, JSON array of {name,value} (default: []);
#                             an entry named NODE_ENV or PORT replaces the default
#   BACKEND_CPU / BACKEND_MEMORY
#   BACKEND_MIN_TASKS / BACKEND_MAX_TASKS / BACKEND_SCALING_TARGET
#   BACKEND_SCALING_METRIC    AVERAGE_CPU (default), AVERAGE_MEMORY, or REQUEST_COUNT_PER_TARGET
#                             (requests per task per minute; Express maps it to ALBRequestCountPerTarget)
#   BACKEND_ENV_TAG           env tag (default: staging)
#   BACKEND_USAGE_TAG         usage tag (default: backend-web)
#   BACKEND_BAKE_TIME_MINUTES        production bake minutes (default: 0)
#   BACKEND_CANARY_BAKE_TIME_MINUTES canary bake minutes (default: 0)
#   BACKEND_ROLLBACK_ALARM_MODE       "target-5xx" to replace the Express rollback alarm (default: preserve)
#   BACKEND_ROLLBACK_MIN_ERRORS       minimum target 5XX count before rate evaluation (default: 5)
#   BACKEND_ROLLBACK_ERROR_RATE       target 5XX percentage threshold (default: 1)
#   BACKEND_ROLLBACK_ALARM_REFRESH_TIMEOUT  seconds to wait for ECS to recreate its alarm (default: 60)
#   BACKEND_TARGET_GROUP_WAIT_TIMEOUT   seconds to wait for the gateway target groups after creating the service (default: 300)
#   BACKEND_TARGET_GROUP_WAIT_INTERVAL  poll interval for that wait (default: 10)

set -euo pipefail

REGION="${1:?region required}"
CLUSTER="${2:?cluster required}"
SERVICE_NAME="${3:?service name required}"
ECR_REPOSITORY="${4:?ecr repository required}"
IMAGE_TAG="${5:?image tag required}"

SSM_PREFIX="${BACKEND_SSM_PREFIX:-/raycast-release-api/staging}"
CONTAINER_PORT="${BACKEND_CONTAINER_PORT:-3000}"
HEALTH_CHECK_PATH="${BACKEND_HEALTH_CHECK_PATH:-/up}"
# Rails environment for the container. Staging services keep the default; the
# CloudSync v1 production service runs the same image with RAILS_ENV=production.
# Optional extra plain env vars as a JSON array of {name, value} objects, e.g.
# '[{"name":"FOO","value":"bar"}]'. Plain env wins over a same-named SSM secret
# (the collision filter below drops the secret).
EXTRA_ENV_JSON="${BACKEND_EXTRA_ENV_JSON:-[]}"
CPU="${BACKEND_CPU:-1024}"
MEMORY="${BACKEND_MEMORY:-2048}"
MIN_TASKS="${BACKEND_MIN_TASKS:-2}"
MAX_TASKS="${BACKEND_MAX_TASKS:-4}"
SCALING_TARGET_VALUE="${BACKEND_SCALING_TARGET:-70}"
SCALING_METRIC="${BACKEND_SCALING_METRIC:-AVERAGE_CPU}"
case "${SCALING_METRIC}" in
  AVERAGE_CPU|AVERAGE_MEMORY|REQUEST_COUNT_PER_TARGET) ;;
  *) echo "::error::BACKEND_SCALING_METRIC must be AVERAGE_CPU, AVERAGE_MEMORY, or REQUEST_COUNT_PER_TARGET (got '${SCALING_METRIC}')"; exit 1 ;;
esac
ENV_TAG="${BACKEND_ENV_TAG:-staging}"
USAGE_TAG="${BACKEND_USAGE_TAG:-backend-web}"
# After submitting the deploy we block until the managed rollout finishes (see the
# wait loop at the end of this script).
ROLLOUT_TIMEOUT="${BACKEND_ROLLOUT_TIMEOUT:-900}"
ROLLOUT_POLL_INTERVAL="${BACKEND_ROLLOUT_POLL_INTERVAL:-15}"
ROLLOUT_INITIAL_DELAY="${BACKEND_ROLLOUT_INITIAL_DELAY:-20}"
# ECS Express provisions services with a canary deployment that bakes the new revision
# (canary slice + full production cut) before draining the old one. Defaults are 3+3
# minutes, which dominates deploy time. Staging is low-traffic and we prefer fast
# deploys, so both bakes default to 0. Bump these (via the workflow) for environments
# that want an instant-rollback soak window.
BAKE_TIME_MINUTES="${BACKEND_BAKE_TIME_MINUTES:-0}"
CANARY_BAKE_TIME_MINUTES="${BACKEND_CANARY_BAKE_TIME_MINUTES:-0}"
# ECS Express creates a rollback alarm that combines target 4XX and 5XX rates. That
# is unsafe for public endpoints: ordinary authentication/authorization failures can
# flap the alarm and roll back a healthy revision. Production CloudSync opts into a
# target-5XX-only replacement while staging preserves the ECS-managed default.
ROLLBACK_ALARM_MODE="${BACKEND_ROLLBACK_ALARM_MODE:-preserve}"
ROLLBACK_MIN_ERRORS="${BACKEND_ROLLBACK_MIN_ERRORS:-5}"
ROLLBACK_ERROR_RATE="${BACKEND_ROLLBACK_ERROR_RATE:-1}"
ROLLBACK_ALARM_WAIT_TIMEOUT="${BACKEND_ROLLBACK_ALARM_WAIT_TIMEOUT:-240}"
ROLLBACK_ALARM_WAIT_INTERVAL="${BACKEND_ROLLBACK_ALARM_WAIT_INTERVAL:-10}"
ROLLBACK_ALARM_REFRESH_TIMEOUT="${BACKEND_ROLLBACK_ALARM_REFRESH_TIMEOUT:-60}"
ROLLBACK_ALARM_REFRESH_INTERVAL="${BACKEND_ROLLBACK_ALARM_REFRESH_INTERVAL:-1}"
TARGET_5XX_ROLLBACK_METRICS=""
# ECS Express creates its ALB target groups with slow defaults: health check interval
# 30s x healthy threshold 5 = ~150s before a new task is in service, plus a 300s
# deregistration (drain) delay on the old task. On low-traffic staging that dominates
# the blue/green rollout. We dial those down (see tune_target_groups below). Override
# per environment via the workflow; a soak-sensitive env can raise them again.
TUNE_TARGET_GROUPS="${BACKEND_TUNE_TARGET_GROUPS:-true}"
# ECS creates the gateway target groups asynchronously after create-express-gateway-service.
# The tuning and rollback-alarm steps look them up by tag, so the create path waits for them.
TARGET_GROUP_WAIT_TIMEOUT="${BACKEND_TARGET_GROUP_WAIT_TIMEOUT:-300}"
TARGET_GROUP_WAIT_INTERVAL="${BACKEND_TARGET_GROUP_WAIT_INTERVAL:-10}"
HC_INTERVAL="${BACKEND_HC_INTERVAL:-10}"
HC_TIMEOUT="${BACKEND_HC_TIMEOUT:-5}"
HC_HEALTHY_THRESHOLD="${BACKEND_HC_HEALTHY_THRESHOLD:-2}"
HC_UNHEALTHY_THRESHOLD="${BACKEND_HC_UNHEALTHY_THRESHOLD:-2}"
DEREGISTRATION_DELAY="${BACKEND_DEREGISTRATION_DELAY:-20}"
# Idle timeout (seconds) to set on the ECS Express gateway ALB, 0 = leave as-is.
# The gateway ALB is SHARED by every Express service in the account/region, so this
# is a global knob: the CloudSync v1 deploy sets 240 so long-running bridge
# sync requests survive past the 60s ALB default (the reason we left Heroku's 30s
# router limit). Raising it is benign for the other services -- it only bounds idle
# time, and user-facing traffic is capped by CloudFront's own origin timeout anyway.
ALB_IDLE_TIMEOUT="${BACKEND_ALB_IDLE_TIMEOUT:-0}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
SERVICE_ARN="arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service/${CLUSTER}/${SERVICE_NAME}"
# Register the task definition against the image digest, not the mutable sha-* tag:
# the tag is what the build pushed, but only the digest is immutable, and the
# compliance rule for Fargate services (Vanta "Fargate deploys version-controlled
# images") requires digest-pinned, immutable-tag or semver image references.
IMAGE_DIGEST="$(aws ecr describe-images \
  --repository-name "${ECR_REPOSITORY}" \
  --image-ids imageTag="${IMAGE_TAG}" \
  --region "${REGION}" \
  --query 'imageDetails[0].imageDigest' \
  --output text)"
if ! [[ "${IMAGE_DIGEST}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Could not resolve the digest of ${ECR_REPOSITORY}:${IMAGE_TAG} (got '${IMAGE_DIGEST}')" >&2
  exit 1
fi
IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPOSITORY}@${IMAGE_DIGEST}"

EXECUTION_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/ecs-execution-${SERVICE_NAME}"
INFRASTRUCTURE_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/ecs-infrastructure-${SERVICE_NAME}"
TASK_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/ecs-task-${SERVICE_NAME}"
LOG_GROUP="/ecs/${SERVICE_NAME}"

# Build the secrets array from every SSM parameter under the role's prefix. Rails
# needs the full Heroku-equivalent config, so each parameter becomes a container
# secret named after the parameter's leaf key.
echo "Collecting SSM parameters under ${SSM_PREFIX} ..."
SECRETS_JSON="[]"
NEXT_TOKEN=""
while true; do
  if [ -z "${NEXT_TOKEN}" ]; then
    RESULT="$(aws ssm get-parameters-by-path \
      --path "${SSM_PREFIX}" \
      --recursive \
      --region "${REGION}" \
      --query '{Names: Parameters[].Name, NextToken: NextToken}' \
      --output json)"
  else
    RESULT="$(aws ssm get-parameters-by-path \
      --path "${SSM_PREFIX}" \
      --recursive \
      --region "${REGION}" \
      --next-token "${NEXT_TOKEN}" \
      --query '{Names: Parameters[].Name, NextToken: NextToken}' \
      --output json)"
  fi

  SECRETS_JSON="$(echo "${RESULT}" | jq \
    --argjson acc "${SECRETS_JSON}" \
    --arg region "${REGION}" \
    --arg account "${ACCOUNT_ID}" \
    '$acc + [ (.Names // [])[] | {
        name: (. | split("/") | last),
        valueFrom: ("arn:aws:ssm:" + $region + ":" + $account + ":parameter" + .)
      } ]')"

  NEXT_TOKEN="$(echo "${RESULT}" | jq -r '.NextToken // empty')"
  [ -z "${NEXT_TOKEN}" ] && break
done

# Plain env vars set on the container directly: PORT makes Fastify bind to the ALB
# target port (Heroku injects PORT, AWS does not). Anything else comes from
# BACKEND_EXTRA_ENV_JSON. Drop any SSM secret whose key collides with a plain env var
# (ECS rejects duplicates), so plain env wins.
PLAIN_ENV_JSON="$(jq -n \
  --arg port "${CONTAINER_PORT}" \
  --argjson extra "${EXTRA_ENV_JSON}" \
  '($extra | map(.name)) as $overrides
  | [
      { name: "NODE_ENV", value: "production" },
      { name: "PORT", value: $port }
    ]
    | map(select(.name as $n | ($overrides | index($n)) | not))
    | . + $extra')"

SECRETS_JSON="$(jq -n \
  --argjson secrets "${SECRETS_JSON}" \
  --argjson plain "${PLAIN_ENV_JSON}" \
  '($plain | map(.name)) as $pk | $secrets | map(select(.name as $k | ($pk | index($k)) | not))')"

SECRET_COUNT="$(echo "${SECRETS_JSON}" | jq 'length')"
echo "Attaching ${SECRET_COUNT} SSM secrets to ${SERVICE_NAME}."

PRIMARY_CONTAINER="$(jq -n \
  --arg image "${IMAGE}" \
  --arg log_group "${LOG_GROUP}" \
  --argjson port "${CONTAINER_PORT}" \
  --argjson env "${PLAIN_ENV_JSON}" \
  --argjson secrets "${SECRETS_JSON}" \
  '{
    image: $image,
    containerPort: $port,
    environment: $env,
    secrets: $secrets,
    awsLogsConfiguration: {
      logGroup: $log_group,
      logStreamPrefix: "app"
    }
  }')"

SCALING_TARGET="$(jq -n \
  --arg metric "${SCALING_METRIC}" \
  --argjson target "${SCALING_TARGET_VALUE}" \
  --argjson min "${MIN_TASKS}" \
  --argjson max "${MAX_TASKS}" \
  '{ autoScalingMetric: $metric, autoScalingTargetValue: $target, minTaskCount: $min, maxTaskCount: $max }')"

# Record the newest service-deployment ARN before we submit, so the wait loop below can
# tell the rollout we trigger apart from any prior one (including a stale failed rollout
# that hasn't been cleaned up). Empty on first create / when none exist.
PREVIOUS_DEPLOYMENT_ARN="$(aws ecs list-service-deployments \
  --cluster "${CLUSTER}" \
  --service "${SERVICE_NAME}" \
  --region "${REGION}" \
  --query 'sort_by(serviceDeployments, &createdAt)[-1].serviceDeploymentArn' \
  --output text 2>/dev/null || true)"
[ "${PREVIOUS_DEPLOYMENT_ARN}" = "None" ] && PREVIOUS_DEPLOYMENT_ARN=""

# Patch the bake durations on the underlying ECS service. ECS Express has no API knob for
# this, so we read the live deploymentConfiguration, override only the bake fields
# (preserving the circuit breaker, rollback alarm, strategy, and canary percent), and
# write it back. An update-service call that only changes deploymentConfiguration does not
# start a new rollout, so this is safe to run on every deploy and is idempotent.
apply_bake_config() {
  local current desired
  current="$(aws ecs describe-services \
    --cluster "${CLUSTER}" \
    --services "${SERVICE_NAME}" \
    --region "${REGION}" \
    --query 'services[0].deploymentConfiguration' \
    --output json 2>/dev/null || true)"

  if [ -z "${current}" ] || [ "${current}" = "null" ]; then
    echo "No deployment configuration found for ${SERVICE_NAME}; skipping bake override."
    return 0
  fi

  desired="$(printf '%s' "${current}" | jq \
    --argjson bake "${BAKE_TIME_MINUTES}" \
    --argjson canaryBake "${CANARY_BAKE_TIME_MINUTES}" \
    '.bakeTimeInMinutes = $bake
     | (if .canaryConfiguration then .canaryConfiguration.canaryBakeTimeInMinutes = $canaryBake else . end)')"

  if [ "$(printf '%s' "${current}" | jq -S .)" = "$(printf '%s' "${desired}" | jq -S .)" ]; then
    echo "Deployment bake config already set for ${SERVICE_NAME} (bake=${BAKE_TIME_MINUTES}m, canary=${CANARY_BAKE_TIME_MINUTES}m)."
    return 0
  fi

  echo "Setting deployment bake config for ${SERVICE_NAME} (bake=${BAKE_TIME_MINUTES}m, canary=${CANARY_BAKE_TIME_MINUTES}m) ..."
  aws ecs update-service \
    --cluster "${CLUSTER}" \
    --service "${SERVICE_NAME}" \
    --region "${REGION}" \
    --deployment-configuration "${desired}" \
    --output json >/dev/null
}

# Wait until the service's gateway target groups exist and are attached to the gateway
# load balancer. Only needed right after create-express-gateway-service: ECS provisions
# them asynchronously, and the tuning and rollback-alarm steps below skip or fail when
# the tag lookup comes back empty or the groups have no load balancer yet.
wait_for_target_groups() {
  local deadline tgs attached total
  deadline=$(( $(date +%s) + TARGET_GROUP_WAIT_TIMEOUT ))
  echo "Waiting up to ${TARGET_GROUP_WAIT_TIMEOUT}s for target groups tagged env=${ENV_TAG},usage=${USAGE_TAG} ..."
  while :; do
    tgs="$(aws resourcegroupstaggingapi get-resources \
      --region "${REGION}" \
      --resource-type-filters elasticloadbalancing:targetgroup \
      --tag-filters "Key=env,Values=${ENV_TAG}" "Key=usage,Values=${USAGE_TAG}" \
      --query 'ResourceTagMappingList[].ResourceARN' --output text 2>/dev/null || true)"
    if [ -n "${tgs}" ] && [ "${tgs}" != "None" ]; then
      total="$(echo "${tgs}" | wc -w | tr -d ' ')"
      # shellcheck disable=SC2086
      attached="$(aws elbv2 describe-target-groups \
        --target-group-arns ${tgs} \
        --region "${REGION}" \
        --query 'length(TargetGroups[?length(LoadBalancerArns) > `0`])' --output text 2>/dev/null || echo 0)"
      if [ "${attached}" = "${total}" ]; then
        echo "Target groups ready (${total} attached to the gateway load balancer)."
        return 0
      fi
      echo "  ${attached}/${total} target groups attached to a load balancer ... waiting ${TARGET_GROUP_WAIT_INTERVAL}s"
    fi
    if [ "$(date +%s)" -ge "${deadline}" ]; then
      echo "::warning::No target groups tagged env=${ENV_TAG},usage=${USAGE_TAG} after ${TARGET_GROUP_WAIT_TIMEOUT}s; continuing without them."
      return 0
    fi
    sleep "${TARGET_GROUP_WAIT_INTERVAL}"
  done
}

# Speed up the blue/green rollout by lowering the health-check cadence and drain delay
# on this service's ECS Express target groups. Express hides the ALB (the service only
# exposes an ingress endpoint) but tags the two managed target groups it created with
# env=<ENV_TAG> and usage=<USAGE_TAG> -- the same tags we set on the service -- so we
# find them by tag. Best-effort: this must never fail a deploy. It needs elbv2 Modify*
# and tag:GetResources on the deploy role; without them (or if Express hasn't created
# the groups yet) it logs and returns. Re-applied every deploy since Express may reset
# the groups on a rollout.
tune_target_groups() {
  [ "${TUNE_TARGET_GROUPS}" = "true" ] || { echo "Target-group tuning disabled (BACKEND_TUNE_TARGET_GROUPS=${TUNE_TARGET_GROUPS})."; return 0; }

  local tgs
  tgs="$(aws resourcegroupstaggingapi get-resources \
    --region "${REGION}" \
    --resource-type-filters elasticloadbalancing:targetgroup \
    --tag-filters "Key=env,Values=${ENV_TAG}" "Key=usage,Values=${USAGE_TAG}" \
    --query 'ResourceTagMappingList[].ResourceARN' --output text 2>/dev/null || true)"

  if [ -z "${tgs}" ] || [ "${tgs}" = "None" ]; then
    echo "No target groups tagged env=${ENV_TAG},usage=${USAGE_TAG} found (or missing tag:GetResources); skipping target-group tuning."
    return 0
  fi

  for tg in ${tgs}; do
    echo "Tuning target group ${tg##*targetgroup/} (interval=${HC_INTERVAL}s healthy=${HC_HEALTHY_THRESHOLD} dereg=${DEREGISTRATION_DELAY}s) ..."
    aws elbv2 modify-target-group \
      --target-group-arn "${tg}" \
      --health-check-interval-seconds "${HC_INTERVAL}" \
      --health-check-timeout-seconds "${HC_TIMEOUT}" \
      --healthy-threshold-count "${HC_HEALTHY_THRESHOLD}" \
      --unhealthy-threshold-count "${HC_UNHEALTHY_THRESHOLD}" \
      --region "${REGION}" --output json >/dev/null 2>&1 \
      || echo "::warning::modify-target-group failed for ${tg##*targetgroup/} (deploy role may lack elbv2:ModifyTargetGroup); continuing."
    aws elbv2 modify-target-group-attributes \
      --target-group-arn "${tg}" \
      --attributes "Key=deregistration_delay.timeout_seconds,Value=${DEREGISTRATION_DELAY}" \
      --region "${REGION}" --output json >/dev/null 2>&1 \
      || echo "::warning::modify-target-group-attributes failed for ${tg##*targetgroup/}; continuing."
  done
}

# Raise the idle timeout on the shared ECS Express gateway ALB (see the
# BACKEND_ALB_IDLE_TIMEOUT comment above; 0 = skip). The ALB is discovered through
# this service's tagged target groups, mirroring tune_target_groups. Best-effort:
# a failure logs a warning and never blocks the deploy. Idempotent -- skips the
# modify when the attribute already matches.
tune_alb_idle_timeout() {
  [ "${ALB_IDLE_TIMEOUT}" != "0" ] || return 0

  local tg alb current
  tg="$(aws resourcegroupstaggingapi get-resources \
    --region "${REGION}" \
    --resource-type-filters elasticloadbalancing:targetgroup \
    --tag-filters "Key=env,Values=${ENV_TAG}" "Key=usage,Values=${USAGE_TAG}" \
    --query 'ResourceTagMappingList[0].ResourceARN' --output text 2>/dev/null || true)"
  if [ -z "${tg}" ] || [ "${tg}" = "None" ]; then
    echo "No tagged target group found for env=${ENV_TAG},usage=${USAGE_TAG}; skipping ALB idle-timeout tuning."
    return 0
  fi

  alb="$(aws elbv2 describe-target-groups \
    --target-group-arns "${tg}" \
    --region "${REGION}" \
    --query 'TargetGroups[0].LoadBalancerArns[0]' --output text 2>/dev/null || true)"
  if [ -z "${alb}" ] || [ "${alb}" = "None" ]; then
    echo "Target group not attached to a load balancer yet; skipping ALB idle-timeout tuning."
    return 0
  fi

  current="$(aws elbv2 describe-load-balancer-attributes \
    --load-balancer-arn "${alb}" \
    --region "${REGION}" \
    --query "Attributes[?Key=='idle_timeout.timeout_seconds'].Value | [0]" --output text 2>/dev/null || true)"
  if [ "${current}" = "${ALB_IDLE_TIMEOUT}" ]; then
    echo "Gateway ALB idle timeout already ${ALB_IDLE_TIMEOUT}s."
    return 0
  fi

  echo "Setting gateway ALB idle timeout ${current:-?}s -> ${ALB_IDLE_TIMEOUT}s (${alb##*loadbalancer/})"
  aws elbv2 modify-load-balancer-attributes \
    --load-balancer-arn "${alb}" \
    --attributes "Key=idle_timeout.timeout_seconds,Value=${ALB_IDLE_TIMEOUT}" \
    --region "${REGION}" --output json >/dev/null 2>&1 \
    || echo "::warning::modify-load-balancer-attributes failed (deploy role may lack elbv2:ModifyLoadBalancerAttributes); continuing."
}

# Replace the ECS Express rollback alarm's generic 4XX+5XX calculation with a
# service-scoped target-5XX rate. The gateway ALB is shared, so ALB-level 5XX metrics
# could be caused by another Express service; target-group metrics keep the rollback
# decision attributable to this service. The denominator sums the target's 2XX-5XX
# response counters so it remains the actual target-group request volume regardless
# of how many tasks are healthy. Requiring a small absolute error count also prevents
# a single 5XX during a low-traffic canary from exceeding the percentage threshold.
#
# Updating an existing CloudWatch alarm leaves its current state unchanged until new
# datapoints are evaluated. Wait for OK before submitting the ECS update, then restore
# and verify the custom definition again after ECS refreshes its managed alarm.
rollback_alarm_snapshot() {
  local alarm_name
  alarm_name="${CLUSTER}/${SERVICE_NAME}/RollbackAlarm"
  aws cloudwatch describe-alarms \
    --alarm-names "${alarm_name}" \
    --region "${REGION}" \
    --query 'MetricAlarms[0].{updated:AlarmConfigurationUpdatedTimestamp,custom:length(Metrics[?Id == `m0_2xx`]),state:StateValue}' \
    --output json
}

rollback_alarm_is_target_5xx() {
  local snapshot
  [ "${ROLLBACK_ALARM_MODE}" = "target-5xx" ] || return 0
  snapshot="$(rollback_alarm_snapshot 2>/dev/null || true)"
  [ -n "${snapshot}" ] || return 0
  [ "${snapshot}" != "null" ] || return 1
  [ "$(printf '%s' "${snapshot}" | jq -r '.custom // 0')" -gt 0 ]
}

# ECS Express recreates its managed rollback alarm asynchronously after an update.
# Wait until that refresh is visible before restoring our service-specific definition;
# otherwise ECS overwrites the custom alarm a few seconds after the deploy script writes
# it and stale public 4XX datapoints can roll back the new revision.
wait_for_managed_rollback_alarm_refresh() {
  local previous_updated snapshot current_updated custom deadline
  [ "${ROLLBACK_ALARM_MODE}" = "target-5xx" ] || return 0

  previous_updated="$1"
  echo "Waiting up to ${ROLLBACK_ALARM_REFRESH_TIMEOUT}s for ECS to refresh its managed rollback alarm ..."
  deadline=$(( $(date +%s) + ROLLBACK_ALARM_REFRESH_TIMEOUT ))

  while true; do
    snapshot="$(rollback_alarm_snapshot 2>/dev/null || true)"
    current_updated="$(printf '%s' "${snapshot:-null}" | jq -r '.updated // empty')"
    custom="$(printf '%s' "${snapshot:-null}" | jq -r '.custom // -1')"

    if [ -n "${current_updated}" ] && { [ "${current_updated}" != "${previous_updated}" ] || [ "${custom}" -eq 0 ]; }; then
      echo "ECS rollback alarm refresh detected; restoring target-5XX configuration."
      return 0
    fi
    if [ "$(date +%s)" -ge "${deadline}" ]; then
      echo "::warning::ECS did not visibly refresh the rollback alarm within ${ROLLBACK_ALARM_REFRESH_TIMEOUT}s; restoring it defensively."
      return 0
    fi
    sleep "${ROLLBACK_ALARM_REFRESH_INTERVAL}"
  done
}

put_target_5xx_rollback_alarm() {
  local alarm_name metrics
  alarm_name="$1"
  metrics="$2"
  aws cloudwatch put-metric-alarm \
    --alarm-name "${alarm_name}" \
    --alarm-description "Target 5XX error rate for ${SERVICE_NAME}" \
    --actions-enabled \
    --evaluation-periods 3 \
    --datapoints-to-alarm 2 \
    --threshold "${ROLLBACK_ERROR_RATE}" \
    --comparison-operator GreaterThanThreshold \
    --treat-missing-data notBreaching \
    --metrics "${metrics}" \
    --region "${REGION}"
}

configure_rollback_alarm() {
  [ "${ROLLBACK_ALARM_MODE}" = "target-5xx" ] || return 0

  local alarm_name tgs first_tg alb alb_dimension metrics max_terms index tg tg_dimension
  local metric_2xx metric_3xx metric_4xx metric_5xx total_expression_id total_expression
  local expression_id expression alarm_state alarm_snapshot custom deadline
  alarm_name="${CLUSTER}/${SERVICE_NAME}/RollbackAlarm"
  tgs="$(aws resourcegroupstaggingapi get-resources \
    --region "${REGION}" \
    --resource-type-filters elasticloadbalancing:targetgroup \
    --tag-filters "Key=env,Values=${ENV_TAG}" "Key=usage,Values=${USAGE_TAG}" \
    --query 'ResourceTagMappingList[].ResourceARN' --output text)"

  if [ -z "${tgs}" ] || [ "${tgs}" = "None" ]; then
    echo "::error::Cannot configure ${alarm_name}: no target groups tagged env=${ENV_TAG},usage=${USAGE_TAG}."
    return 1
  fi

  first_tg="${tgs%%[[:space:]]*}"
  alb="$(aws elbv2 describe-target-groups \
    --target-group-arns "${first_tg}" \
    --region "${REGION}" \
    --query 'TargetGroups[0].LoadBalancerArns[0]' --output text)"
  if [ -z "${alb}" ] || [ "${alb}" = "None" ]; then
    echo "::error::Cannot configure ${alarm_name}: target group is not attached to a load balancer."
    return 1
  fi

  alb_dimension="${alb##*:loadbalancer/}"
  metrics="[]"
  max_terms=""
  index=0

  for tg in ${tgs}; do
    tg_dimension="${tg##*:}"
    metric_2xx="m${index}_2xx"
    metric_3xx="m${index}_3xx"
    metric_4xx="m${index}_4xx"
    metric_5xx="m${index}_5xx"
    total_expression_id="et${index}"
    expression_id="em${index}"
    total_expression="FILL(${metric_2xx}, 0) + FILL(${metric_3xx}, 0) + FILL(${metric_4xx}, 0) + FILL(${metric_5xx}, 0)"
    expression="100 * IF(FILL(${metric_5xx}, 0) < ${ROLLBACK_MIN_ERRORS}, 0, FILL(${metric_5xx}, 0)) / IF(${total_expression_id} < 1, 1, ${total_expression_id})"

    metrics="$(jq -n \
      --argjson metrics "${metrics}" \
      --arg metric2xx "${metric_2xx}" \
      --arg metric3xx "${metric_3xx}" \
      --arg metric4xx "${metric_4xx}" \
      --arg metric5xx "${metric_5xx}" \
      --arg totalExpressionId "${total_expression_id}" \
      --arg totalExpression "${total_expression}" \
      --arg expressionId "${expression_id}" \
      --arg expression "${expression}" \
      --arg targetGroup "${tg_dimension}" \
      --arg loadBalancer "${alb_dimension}" \
      'def response_metric($id; $name):
        {
          Id: $id,
          MetricStat: {
            Metric: {
              Namespace: "AWS/ApplicationELB",
              MetricName: $name,
              Dimensions: [
                {Name: "TargetGroup", Value: $targetGroup},
                {Name: "LoadBalancer", Value: $loadBalancer}
              ]
            },
            Period: 60,
            Stat: "Sum"
          },
          ReturnData: false
        };
      $metrics + [
        response_metric($metric2xx; "HTTPCode_Target_2XX_Count"),
        response_metric($metric3xx; "HTTPCode_Target_3XX_Count"),
        response_metric($metric4xx; "HTTPCode_Target_4XX_Count"),
        response_metric($metric5xx; "HTTPCode_Target_5XX_Count"),
        {Id: $totalExpressionId, Expression: $totalExpression, ReturnData: false},
        {Id: $expressionId, Expression: $expression, ReturnData: false}
      ]')"

    if [ -z "${max_terms}" ]; then
      max_terms="${expression_id}"
    else
      max_terms="${max_terms},${expression_id}"
    fi
    index=$((index + 1))
  done

  metrics="$(jq -n \
    --argjson metrics "${metrics}" \
    --arg expression "MAX([${max_terms}])" \
    '$metrics + [{Id: "e", Expression: $expression, Label: "Target 5XX error percentage", ReturnData: true}]')"
  TARGET_5XX_ROLLBACK_METRICS="${metrics}"

  echo "Configuring ${alarm_name} for target 5XX only (>=${ROLLBACK_MIN_ERRORS} errors, >${ROLLBACK_ERROR_RATE}%)."
  put_target_5xx_rollback_alarm "${alarm_name}" "${metrics}"

  echo "Waiting up to ${ROLLBACK_ALARM_WAIT_TIMEOUT}s for ${alarm_name} to evaluate OK ..."
  deadline=$(( $(date +%s) + ROLLBACK_ALARM_WAIT_TIMEOUT ))
  while true; do
    alarm_snapshot="$(rollback_alarm_snapshot 2>/dev/null || true)"
    alarm_state="$(printf '%s' "${alarm_snapshot:-null}" | jq -r '.state // "UNKNOWN"')"
    custom="$(printf '%s' "${alarm_snapshot:-null}" | jq -r '.custom // -1')"
    if [ "${custom}" -eq 0 ]; then
      echo "::warning::ECS replaced ${alarm_name} while waiting; restoring target-5XX configuration."
      put_target_5xx_rollback_alarm "${alarm_name}" "${metrics}"
      alarm_state="RESTORING"
    fi
    if [ "${custom}" -gt 0 ] && [ "${alarm_state}" = "OK" ]; then
      echo "${alarm_name} is OK."
      break
    fi
    if [ "$(date +%s)" -ge "${deadline}" ]; then
      echo "::error::${alarm_name} remained ${alarm_state} after ${ROLLBACK_ALARM_WAIT_TIMEOUT}s; refusing to deploy."
      return 1
    fi
    echo "  ${alarm_name} is ${alarm_state}; waiting ${ROLLBACK_ALARM_WAIT_INTERVAL}s"
    sleep "${ROLLBACK_ALARM_WAIT_INTERVAL}"
  done
}

# Decide between updating the existing service and creating a new one from the
# service status, not from the describe call succeeding: ECS keeps answering for a
# deleted (INACTIVE) Express service for a while, and updating it fails with
# ServiceNotActiveException. A DRAINING service is still being deleted; retry later.
EXISTING_SERVICE_STATUS="$(aws ecs describe-express-gateway-service \
  --service-arn "${SERVICE_ARN}" \
  --region "${REGION}" \
  --query 'service.status.statusCode' \
  --output text 2>/dev/null || true)"
if [ "${EXISTING_SERVICE_STATUS}" = "DRAINING" ]; then
  echo "::error::${SERVICE_NAME} is DRAINING (being deleted); re-run the deploy once it is gone."
  exit 1
fi
if [ "${EXISTING_SERVICE_STATUS}" = "ACTIVE" ]; then
  # Apply the bake override before triggering the rollout so this deploy honors it.
  apply_bake_config
  # Tune the target groups before submitting so this rollout's new tasks get the faster
  # health-check cadence (both blue/green groups already exist and are tagged).
  tune_target_groups
  tune_alb_idle_timeout
  configure_rollback_alarm
  ROLLBACK_ALARM_CONFIGURED_AT=""
  if [ "${ROLLBACK_ALARM_MODE}" = "target-5xx" ]; then
    ROLLBACK_ALARM_CONFIGURED_AT="$(rollback_alarm_snapshot | jq -r '.updated // empty')"
  fi
  echo "Updating existing Express service ${SERVICE_NAME} with image ${ECR_REPOSITORY}:${IMAGE_TAG} (${IMAGE_DIGEST})"
  aws ecs update-express-gateway-service \
    --service-arn "${SERVICE_ARN}" \
    --cpu "${CPU}" \
    --memory "${MEMORY}" \
    --health-check-path "${HEALTH_CHECK_PATH}" \
    --execution-role-arn "${EXECUTION_ROLE_ARN}" \
    --task-role-arn "${TASK_ROLE_ARN}" \
    --primary-container "${PRIMARY_CONTAINER}" \
    --scaling-target "${SCALING_TARGET}" \
    --region "${REGION}" \
    --output json
  if [ "${ROLLBACK_ALARM_MODE}" = "target-5xx" ]; then
    wait_for_managed_rollback_alarm_refresh "${ROLLBACK_ALARM_CONFIGURED_AT}"
    configure_rollback_alarm
  fi
else
  echo "Creating Express service ${SERVICE_NAME} in cluster ${CLUSTER} with image ${ECR_REPOSITORY}:${IMAGE_TAG} (${IMAGE_DIGEST})"
  aws ecs create-express-gateway-service \
    --cluster "${CLUSTER}" \
    --service-name "${SERVICE_NAME}" \
    --cpu "${CPU}" \
    --memory "${MEMORY}" \
    --health-check-path "${HEALTH_CHECK_PATH}" \
    --execution-role-arn "${EXECUTION_ROLE_ARN}" \
    --infrastructure-role-arn "${INFRASTRUCTURE_ROLE_ARN}" \
    --task-role-arn "${TASK_ROLE_ARN}" \
    --primary-container "${PRIMARY_CONTAINER}" \
    --scaling-target "${SCALING_TARGET}" \
    --tags key=env,value="${ENV_TAG}" key=usage,value="${USAGE_TAG}" \
    --region "${REGION}" \
    --output json
  # ECS provisions the target groups asynchronously; wait for them before tuning them
  # and before the rollback alarm, which needs their ARNs.
  wait_for_target_groups
  # The initial rollout uses Express defaults; set the bake override for future deploys.
  apply_bake_config
  # Tune the target groups now (takes effect from the next rollout onward).
  tune_target_groups
  tune_alb_idle_timeout
  configure_rollback_alarm
fi

echo "Deploy request submitted for ${SERVICE_NAME}."

# Block until the managed rollout reaches a terminal state instead of returning as
# soon as the request is accepted. ECS Express runs a blue/green-style rollout that
# shifts traffic across two target groups on the gateway ALB. If a second deploy is
# submitted (or tasks are rolled out-of-band) while one is still in flight, the
# listener rule can be left split across both target groups. ECS then refuses every
# subsequent deploy with "should have exactly one target group serving traffic but
# found 2", and any traffic weighted to the drained group 503s. Waiting here keeps
# deploys strictly sequential and surfaces failures immediately.
#
# Poll the ECS service-deployment lifecycle API (the same one the deploy role already
# grants for Express) and follow the deployment our submit creates -- identified by an
# ARN newer than the one captured before submit. The ServiceDeployment status is an
# explicit lifecycle value, so this cleanly distinguishes success from a circuit-breaker
# rollback without inferring anything from PRIMARY/COMPLETED races:
#   SUCCESSFUL                -> done
#   PENDING / IN_PROGRESS     -> keep waiting
#   ROLLBACK_* / STOPPED / .. -> fail fast with the reason
# A failed/empty poll is treated as inconclusive (transient) and simply retried.
echo "Waiting up to ${ROLLOUT_TIMEOUT}s for ${SERVICE_NAME} rollout to stabilize ..."
sleep "${ROLLOUT_INITIAL_DELAY}"

DEADLINE=$(( $(date +%s) + ROLLOUT_TIMEOUT ))
while true; do
  if ! rollback_alarm_is_target_5xx; then
    echo "::warning::Managed rollback alarm no longer uses target-5XX configuration; restoring it."
    if [ -z "${TARGET_5XX_ROLLBACK_METRICS}" ]; then
      echo "::warning::Target-5XX metrics are unavailable; continuing rollout status polling."
    elif ! put_target_5xx_rollback_alarm "${CLUSTER}/${SERVICE_NAME}/RollbackAlarm" "${TARGET_5XX_ROLLBACK_METRICS}"; then
      echo "::warning::Could not restore the target-5XX alarm; continuing rollout status polling."
    fi
  fi

  # "<arn>\t<status>\t<statusReason>" for the newest deployment ("" if API failed).
  LATEST="$(aws ecs list-service-deployments \
    --cluster "${CLUSTER}" \
    --service "${SERVICE_NAME}" \
    --region "${REGION}" \
    --query 'sort_by(serviceDeployments, &createdAt)[-1].[serviceDeploymentArn, status, statusReason]' \
    --output text 2>/dev/null || true)"
  DEPLOY_ARN="$(printf '%s' "${LATEST}" | awk -F'\t' '{print $1}')"
  DEPLOY_STATUS="$(printf '%s' "${LATEST}" | awk -F'\t' '{print $2}')"
  DEPLOY_REASON="$(printf '%s' "${LATEST}" | cut -f3-)"

  if [ -z "${DEPLOY_ARN}" ] || [ "${DEPLOY_ARN}" = "None" ]; then
    PROGRESS="poll inconclusive, retrying"
  elif [ "${DEPLOY_ARN}" = "${PREVIOUS_DEPLOYMENT_ARN}" ]; then
    PROGRESS="awaiting new deployment"
  else
    case "${DEPLOY_STATUS}" in
      SUCCESSFUL)
        echo "${SERVICE_NAME} rollout SUCCESSFUL."
        break
        ;;
      PENDING|IN_PROGRESS)
        PROGRESS="rollout ${DEPLOY_STATUS}"
        ;;
      *)
        echo "::error::${SERVICE_NAME} rollout ${DEPLOY_STATUS}: ${DEPLOY_REASON}"
        exit 1
        ;;
    esac
  fi

  if [ "$(date +%s)" -ge "${DEADLINE}" ]; then
    echo "::error::Timed out after ${ROLLOUT_TIMEOUT}s waiting for ${SERVICE_NAME} rollout (${PROGRESS})."
    exit 1
  fi
  echo "  ${SERVICE_NAME} ${PROGRESS} ... waiting ${ROLLOUT_POLL_INTERVAL}s"
  sleep "${ROLLOUT_POLL_INTERVAL}"
done
