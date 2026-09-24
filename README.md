# Raycast Favicons Service

A service used in the Raycast app to fetch and serve favicons from websites.

## Setup

Create a `.env` file:

```
NODE_ENV=development
RAYCAST_IGNORE_CACHE=false # set to true to always look for favicons rather than using cache
REDIS_URL=redis://localhost:6379
AWS_ACCESS_KEY_ID=... # for S3
AWS_SECRET_ACCESS_KEY=... # for S3
```

## Usage

Development:

```bash
bun dev # served at :3000. use `PORT=NNNN bun dev` to specify port
```

Load favicon:

```bash
curl http://localhost:3000/favicon?url={encoded URL}
```

Parameters:
- `url`: encoded URL (e.g. encoded with `encodeURIComponent()`)
- `size`: supports `favicon`, `32` or `64`
- `dpr`: pass the scale factor along with required `size` in points to get icons that look good at e.g. `@2x` or `@3x`

## Implementation

- Uses [RxJS](https://rxjs.dev/) to implement the concurrent behaviour of finding the best favicon from a given URL
- Looks for favicons from:
  - `/favicon.ico` (and `/favicon.ico` at any recursive subdomains)
  - `<link />` tags found from loading the page at the given URL
  - The website's web application manifest (if it exists)
- Protection from abuse:
  - Utilises timeouts when loading all resources
  - Has data length limits for both images and other resources to prevent resource exhaustion attacks
  - Refuses to connect to loopback, private, link-local and other non-public addresses, including after DNS resolution and redirects (`src/lib/network.ts`)

## Deployment

The service runs on AWS ECS Express behind CloudFront (`api.ray.so`); cached icons are served from S3 through `favicon.ray.so`.

- **Staging** (`raycast-favicons-staging`): deployed on every push to `main` by `.github/workflows/deploy_aws.yml`.
- **Production** (`raycast-favicons-production`): deployed by hand from `main` with `.github/workflows/deploy_aws_production.yml` (Actions > Deploy AWS Favicons Production > Run workflow), after the commit is verified on staging.
- Configuration lives in SSM Parameter Store under `/raycast-favicons/<env>` (`raycast-infra/scripts/config`). S3 access comes from the ECS task role; no AWS keys are configured.
- Infrastructure (ECR, IAM roles, log groups, ElastiCache, CloudFront, deploy roles) is owned by `raycast-infra`.
- Health check: `GET /up`.
