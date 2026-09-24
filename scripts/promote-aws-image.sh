#!/usr/bin/env bash
#
# Move a stable deployment tag to an immutable image after its ECS rollout succeeds.
#
# Usage:
#   promote-aws-image.sh <region> <ecr-repository> <source-tag> <deployment-tag>

set -euo pipefail

REGION="${1:?region required}"
ECR_REPOSITORY="${2:?ecr repository required}"
SOURCE_TAG="${3:?source tag required}"
DEPLOYMENT_TAG="${4:?deployment tag required}"

SOURCE_IMAGE="$(aws ecr batch-get-image \
  --repository-name "${ECR_REPOSITORY}" \
  --image-ids imageTag="${SOURCE_TAG}" \
  --region "${REGION}" \
  --output json)"

SOURCE_DIGEST="$(printf '%s' "${SOURCE_IMAGE}" | jq -r '.images[0].imageId.imageDigest // empty')"
IMAGE_MANIFEST="$(printf '%s' "${SOURCE_IMAGE}" | jq -r '.images[0].imageManifest // empty')"
IMAGE_MEDIA_TYPE="$(printf '%s' "${SOURCE_IMAGE}" | jq -r '.images[0].imageManifestMediaType // empty')"

if [ -z "${SOURCE_DIGEST}" ] || [ -z "${IMAGE_MANIFEST}" ] || [ -z "${IMAGE_MEDIA_TYPE}" ]; then
  echo "::error::Unable to find ${ECR_REPOSITORY}:${SOURCE_TAG} in ${REGION}."
  exit 1
fi

TARGET_IMAGE="$(aws ecr batch-get-image \
  --repository-name "${ECR_REPOSITORY}" \
  --image-ids imageTag="${DEPLOYMENT_TAG}" \
  --region "${REGION}" \
  --output json)"
TARGET_DIGEST="$(printf '%s' "${TARGET_IMAGE}" | jq -r '.images[0].imageId.imageDigest // empty')"

if [ "${TARGET_DIGEST}" = "${SOURCE_DIGEST}" ]; then
  echo "${ECR_REPOSITORY}:${DEPLOYMENT_TAG} already points to ${SOURCE_DIGEST}."
  exit 0
fi

aws ecr put-image \
  --repository-name "${ECR_REPOSITORY}" \
  --image-tag "${DEPLOYMENT_TAG}" \
  --image-manifest "${IMAGE_MANIFEST}" \
  --image-manifest-media-type "${IMAGE_MEDIA_TYPE}" \
  --region "${REGION}" \
  --output json >/dev/null

echo "Promoted ${ECR_REPOSITORY}:${SOURCE_TAG} (${SOURCE_DIGEST}) to ${DEPLOYMENT_TAG}."
