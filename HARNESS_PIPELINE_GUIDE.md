# Master Harness.io Pipeline Guide: Express.js, Tests, Sonar, Black Duck & AWS ECR

A practical, production-ready, step-by-step blueprint to build a clean Express.js backend with an embedded database, automated test suite, Docker containerization, and a fully configured **Harness.io CI Pipeline** integrating **SonarQube/SonarCloud**, **Synopsys Black Duck**, and **Amazon ECR**.

---

## Table of Contents
1. [Architecture & Workflow Overview](#1-architecture--workflow-overview)
2. [Backend Project Blueprint & Local Files](#2-backend-project-blueprint--local-files)
3. [AWS Configuration: Amazon ECR & IAM](#3-aws-configuration-amazon-ecr--iam)
4. [SonarQube / SonarCloud Setup](#4-sonarqube--sonarcloud-setup)
5. [Synopsys Black Duck Setup](#5-synopsys-black-duck-setup)
6. [Harness.io Platform Setup (Manual Console Walkthrough)](#6-harnessio-platform-setup-manual-console-walkthrough)
7. [Harness Pipeline as Code (YAML Definition)](#7-harness-pipeline-as-code-yaml-definition)
8. [Execution, Verification & Troubleshooting](#8-execution-verification--troubleshooting)

---

## 1. Architecture & Workflow Overview

This setup implements a robust Continuous Integration (CI) pipeline in **Harness.io** without requiring local Docker execution. Every change pushed to the repository triggers automated testing, code quality analysis, software composition analysis (SCA), container build, and secure publication to **Amazon Elastic Container Registry (ECR)**.

```mermaid
flowchart TD
    subgraph Dev["Source Control (Git/GitHub)"]
        Repo["Git Repository (master/main)"]
        Code["Express.js + SQLite DB"]
        Tests["Jest & Supertest Suite"]
        Config["Dockerfile & sonar-project.properties"]
    end

    subgraph HarnessCI["Harness.io CI Pipeline (Build Stage)"]
        Clone["1. Clone Repository"]
        TestStep["2. Run Tests & LCOV Coverage\n(node:20-alpine)"]
        SonarStep["3. Sonar Quality Analysis\n(sonarsource/sonar-scanner-cli)"]
        BDStep["4. Black Duck SCA Scan\n(Synopsys Detect CLI)"]
        ECRStep["5. Build & Push Image\n(Harness ECR Step)"]

        Clone --> TestStep
        TestStep --> SonarStep
        SonarStep --> BDStep
        BDStep --> ECRStep
    end

    subgraph CloudServices["External Cloud & Security Services"]
        SonarCloud["SonarCloud / SonarQube\n(Bugs, Vulnerabilities, Coverage)"]
        BlackDuckHub["Synopsys Black Duck Hub\n(License & Open Source CVEs)"]
        AWSECR["Amazon ECR\n(<aws_account_id>.dkr.ecr.<region>.amazonaws.com)"]
    end

    SonarStep -. Reports Metrics .-> SonarCloud
    BDStep -. Sends Dependency BOM .-> BlackDuckHub
    ECRStep -. Pushes Tagged Image .-> AWSECR
```

### Pipeline Key Metrics
- **Zero Local Docker Dependency:** You can write and run tests locally via Node.js; Docker image building and registry push occur entirely inside Harness Cloud runners.
- **Embedded Database:** SQLite is utilized so that unit and integration tests run self-contained in memory or local file without requiring database container orchestration in CI.
- **Security & Quality Gates:** Code cannot reach Amazon ECR unless tests pass, code coverage meets quality criteria, and dependencies are vetted.

---

## 2. Backend Project Blueprint & Local Files

### 2.1 Project Directory Structure
```text
ECR-1/
├── src/
│   ├── db/
│   │   └── db.js            # SQLite database initialization & CRUD queries
│   ├── routes/
│   │   └── items.js         # REST endpoints (healthcheck & items CRUD)
│   ├── tests/
│   │   └── items.test.js    # Comprehensive Jest & Supertest suite
│   ├── app.js               # Express application configuration & middleware
│   └── server.js            # Server entrypoint (listening on PORT)
├── .dockerignore            # Excludes node_modules, logs, and git
├── .env.example             # Environment variable template
├── .gitignore               # Git ignore rules
├── Dockerfile               # Production multi-stage Alpine Dockerfile
├── jest.config.js           # Jest configuration with LCOV coverage
├── package.json             # App manifest & test scripts
├── sonar-project.properties # SonarQube/SonarCloud scanner configuration
├── harness-pipeline.yaml    # Declarative Harness Pipeline as Code
└── HARNESS_PIPELINE_GUIDE.md# This manual guide
```

### 2.2 Package Manifest (`package.json`)
```json
{
  "name": "express-harness-demo",
  "version": "1.0.0",
  "description": "Express.js REST API with database for Harness CI pipeline demo",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node src/server.js",
    "test": "jest --coverage --detectOpenHandles --forceExit"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "sqlite3": "^5.1.7"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^7.0.0"
  }
}
```

### 2.3 Express App (`src/app.js`)
Separating `app.js` from `server.js` enables Jest/Supertest to run against Express without binding to an open network port, preventing EADDRINUSE conflicts.

```javascript
const express = require('express');
const itemsRouter = require('./routes/items');

const app = express();

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

// REST API routes
app.use('/api/items', itemsRouter);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

module.exports = app;
```

### 2.4 Server Entrypoint (`src/server.js`)
```javascript
const app = require('./app');
require('dotenv').config();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### 2.5 Database Module (`src/db/db.js`)
Uses SQLite for persistent or in-memory storage without needing external database servers:

```javascript
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.NODE_ENV === 'test' 
  ? ':memory:' 
  : (process.env.DB_PATH || path.join(__dirname, '../../database.sqlite'));

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Could not connect to database', err);
  } else {
    initSchema();
  }
});

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

module.exports = db;
```

### 2.6 REST Routes (`src/routes/items.js`)
Provides CRUD endpoints:
- `GET /api/items` - List all items
- `GET /api/items/:id` - Get item by ID
- `POST /api/items` - Create new item (`name` required)
- `DELETE /api/items/:id` - Delete item by ID

### 2.7 Multi-Stage Production `Dockerfile`
```dockerfile
# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Stage 2: Minimal Production Image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Security: Run as unprivileged user
USER node

COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node src ./src

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
```

### 2.8 Sonar Scanner Configuration (`sonar-project.properties`)
```properties
sonar.projectKey=express-harness-demo
sonar.projectName=Express Harness Demo
sonar.sources=src
sonar.tests=src/tests
sonar.exclusions=**/node_modules/**,**/coverage/**
sonar.javascript.lcov.reportPaths=coverage/lcov.info
sonar.sourceEncoding=UTF-8
```

---

## 3. AWS Configuration: Amazon ECR & IAM

In AWS, we only require **Amazon Elastic Container Registry (ECR)** to store container images. No ECS/EKS clusters or EC2 instances are required.

### Step 3.1: Create Amazon ECR Repository

#### Option A: Via AWS Management Console
1. Log in to the [AWS Management Console](https://console.aws.amazon.com).
2. Ensure you are in your desired target region (e.g., `us-east-1` or `eu-central-1`).
3. Search for **Elastic Container Registry** (ECR) in the top search bar.
4. Click **Repositories** in the left sidebar, then click **Create repository**.
5. Set the following:
   - **Visibility settings:** `Private`
   - **Repository name:** `express-harness-demo`
   - **Tag immutability:** `Disabled` (or `Enabled` if you enforce unique SemVer tags)
   - **Scan on push:** `Enabled` (AWS Basic Scanning for vulnerabilities)
   - **KMS encryption:** `Default (AES-256)`
6. Click **Create repository**.
7. Note down your **Repository URI**, which follows the pattern:
   ```text
   <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/express-harness-demo
   ```

#### Option B: Via AWS CLI
```bash
aws ecr create-repository \
    --repository-name express-harness-demo \
    --region us-east-1 \
    --image-scanning-configuration scanOnPush=true \
    --encryption-configuration encryptionType=AES256
```

---

### Step 3.2: Create Least-Privilege IAM User & Credentials for Harness

Harness requires credentials to authenticate with AWS ECR, request an authorization token, and push image layers.

#### 1. Create IAM Policy
1. Navigate to **IAM** > **Policies** > **Create policy**.
2. Select the **JSON** tab and paste the following least-privilege policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAuthToken",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ECRPushOperations",
      "Effect": "Allow",
      "Action": [
        "ecr:CompleteLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:InitiateLayerUpload",
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:DescribeRepositories",
        "ecr:DescribeImages"
      ],
      "Resource": "arn:aws:ecr:*:*:repository/express-harness-demo"
    }
  ]
}
```
3. Name the policy `HarnessECRPushPolicy` and click **Create policy**.

#### 2. Create IAM User & Access Keys
1. Go to **IAM** > **Users** > **Create user**.
2. Set User name: `harness-ci-ecr-builder`.
3. Select **Attach policies directly**, search for `HarnessECRPushPolicy`, and select it.
4. Complete creation, then click on the user `harness-ci-ecr-builder`.
5. Open the **Security credentials** tab > Scroll to **Access keys** > Click **Create access key**.
6. Select **Third-party service** (or **Application running outside AWS**).
7. Download or copy:
   - `Access Key ID` (e.g., `AKIAIOSFODNN7EXAMPLE`)
   - `Secret Access Key` (e.g., `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`)

> [!WARNING]
> Store the Secret Access Key securely. You will store these as encrypted secrets in Harness.io in Section 6.

---

## 4. SonarQube / SonarCloud Setup

Sonar analyzes source code for bugs, security hotspots, code smells, and validates test coverage against your Quality Gate.

### Using SonarCloud (SaaS)
1. Sign in to [SonarCloud.io](https://sonarcloud.io) using your GitHub/GitLab account.
2. In the top-right corner, click **+** > **Analyze new project**.
3. Select your repository (or set up manually).
4. Note your **Organization Key** (e.g., `my-org`) and **Project Key** (e.g., `express-harness-demo`).
5. Generate an Analysis Token:
   - Click your profile icon (top right) > **My Account** > **Security**.
   - Under **Generate Token**, enter name: `harness-ci-token`, Type: `User Token` (or `Project Analysis Token`).
   - Click **Generate** and save the token securely.

### Using Self-Hosted SonarQube
1. Log in to your SonarQube web UI.
2. Go to **Administration** > **Security** > **Users**.
3. Click the **Tokens** icon for your service user, name it `harness-ci`, click **Generate**, and copy the token.
4. Ensure your SonarQube instance URL (e.g., `https://sonarqube.yourcompany.com`) is accessible from the Harness runner.

---

## 5. Synopsys Black Duck Setup

Synopsys Black Duck performs Software Composition Analysis (SCA), scanning `package.json` and `package-lock.json` to identify third-party open-source components, license compliance risks, and known CVE vulnerabilities.

### Step 5.1: Generate Black Duck API Token
1. Log into your Black Duck Hub console (e.g., `https://yourcompany.app.blackduck.com`).
2. In the top-right navigation bar, click on your username > **My Access Tokens**.
3. Click **Generate Token**.
4. Set:
   - **Token Name:** `harness-ci-token`
   - **Scopes:** Select `Read and Write Access` (required to upload dependency Bill of Materials).
5. Click **Generate** and copy the resulting API token.

### Step 5.2: How Black Duck Scans Run
Black Duck scans are triggered via **Synopsys Detect**, an intelligent scan orchestrator. In Harness CI, we run Synopsys Detect inside a container or script step:
```bash
bash <(curl -s -L https://detect.synopsys.com/detect9.sh) \
  --blackduck.url="${BLACKDUCK_URL}" \
  --blackduck.api.token="${BLACKDUCK_API_TOKEN}" \
  --detect.project.name="express-harness-demo" \
  --detect.project.version.name="1.0.0" \
  --detect.tools=DETECTOR \
  --detect.detector.search.depth=2 \
  --blackduck.trust.cert=true
```

---

## 6. Harness.io Platform Setup (Manual Console Walkthrough)

### Step 6.1: Create Project in Harness
1. Log into [app.harness.io](https://app.harness.io).
2. Choose **Continuous Integration** (CI) module.
3. In the left navigation bar, choose your Account/Organization (e.g., `default`).
4. Click **Projects** > **New Project**.
   - **Name:** `Express Harness CI`
   - **Identifier:** `express_harness_ci`
5. Click **Save and Continue**.

---

### Step 6.2: Configure Secrets in Harness Secret Manager
Navigate to **Project Settings** (gear icon in lower left) > **Secrets** > **+ New Secret** > **Secret Text**.

Create the following 4 secrets:

| Secret Name | Secret Identifier | Value | Description |
| :--- | :--- | :--- | :--- |
| `AWS Access Key` | `aws_access_key` | `AKIA...` | AWS IAM Access Key ID |
| `AWS Secret Key` | `aws_secret_key` | `wJalr...` | AWS IAM Secret Access Key |
| `Sonar Token` | `sonar_token` | `sqp_...` | SonarQube/SonarCloud Token |
| `Black Duck Token` | `blackduck_token` | `OGYx...` | Synopsys Black Duck API Token |

*(Optional)* If using custom or on-prem URLs:
- `sonar_host_url`: e.g., `https://sonarcloud.io` or `https://sonar.internal`
- `blackduck_url`: e.g., `https://blackduck.internal.company.com`

---

### Step 6.3: Configure Connectors in Harness
Navigate to **Project Settings** > **Connectors** > **+ New Connector**.

#### 1. Code Repository Connector (GitHub / GitLab / Bitbucket)
1. Select **GitHub** (or your git provider).
2. **Name:** `github-repo-connector`.
3. **URL Type:** `Repository` (or `Account`).
4. **Repository URL:** `https://github.com/<your-username>/express-harness-demo`.
5. **Authentication:** Personal Access Token (PAT) with repository read access.
6. **Connectivity Mode:** Connect through **Harness Platform** (Harness Cloud).
7. Test the connection and save.

#### 2. AWS Connector (for ECR Authentication)
1. Select **AWS**.
2. **Name:** `aws-ecr-connector`.
3. **Credentials:** Select **Assume IAM Role on other account** or **AWS Access Key**.
4. Under **AWS Access Key**:
   - **Access Key:** Select your Harness Secret `aws_access_key`.
   - **Secret Key:** Select your Harness Secret `aws_secret_key`.
5. **Connectivity Mode:** Connect through **Harness Platform**.
6. Test connection and save.

#### 3. Docker Registry Connector (pointing to ECR)
1. Select **Docker Registry**.
2. **Name:** `aws-ecr-registry`.
3. **Docker Registry URL:** `https://<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com`.
4. **Provider Type:** `Amazon Web Services (AWS)`.
5. **AWS Connector:** Select `aws-ecr-connector`.
6. Test connection and save.

---

### Step 6.4: Create the Pipeline in Harness UI
1. In the left navigation, click **Pipelines** > **+ Create a Pipeline**.
2. **Name:** `express-ci-pipeline`.
3. Click **Start**.
4. In the pipeline canvas, click **Add Stage** > Select **Build** stage.
   - **Stage Name:** `Build Test and Security`
   - **Clone Codebase:** Toggle **ON** and select `github-repo-connector`.
5. Under **Infrastructure** tab:
   - Select **Cloud** (Harness Cloud hosted runners - Linux AMD64).
6. Under **Execution** tab, add the steps in order:

#### Step 1: Run Tests & Coverage
- Click **Add Step** > **Run**.
- **Name:** `Run Tests`
- **Container Registry:** `Docker Hub` (or library)
- **Image:** `node:20-alpine`
- **Command:**
  ```bash
  npm ci
  npm test
  ```
- **Report Paths:** Under **Optional Configuration** > **Report Paths**, add `coverage/lcov.info` to enable test intelligence.

#### Step 2: Sonar Code Quality Scan
- Click **Add Step** > **Run**.
- **Name:** `Sonar Scan`
- **Container Registry:** `Docker Hub`
- **Image:** `sonarsource/sonar-scanner-cli:latest`
- **Environment Variables:**
  - `SONAR_TOKEN`: `<+secrets.getValue("sonar_token")>`
  - `SONAR_HOST_URL`: `https://sonarcloud.io` (or your SonarQube URL)
- **Command:**
  ```bash
  sonar-scanner \
    -Dsonar.token="$SONAR_TOKEN" \
    -Dsonar.host.url="$SONAR_HOST_URL" \
    -Dsonar.projectKey=express-harness-demo \
    -Dsonar.sources=src \
    -Dsonar.tests=src/tests \
    -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info
  ```

#### Step 3: Synopsys Black Duck SCA Scan
- Click **Add Step** > **Run**.
- **Name:** `Black Duck Scan`
- **Container Registry:** `Docker Hub`
- **Image:** `openjdk:17-slim` (Synopsys Detect requires Java 11+)
- **Environment Variables:**
  - `BLACKDUCK_URL`: `<+secrets.getValue("blackduck_url")>`
  - `BLACKDUCK_API_TOKEN`: `<+secrets.getValue("blackduck_token")>`
- **Command:**
  ```bash
  apt-get update && apt-get install -y curl bash
  bash <(curl -s -L https://detect.synopsys.com/detect9.sh) \
    --blackduck.url="$BLACKDUCK_URL" \
    --blackduck.api.token="$BLACKDUCK_API_TOKEN" \
    --detect.project.name="express-harness-demo" \
    --detect.project.version.name="1.0.<+pipeline.sequenceId>" \
    --detect.tools=DETECTOR \
    --detect.detector.search.depth=2 \
    --detect.npm.include.dev.dependencies=false \
    --blackduck.trust.cert=true
  ```

#### Step 4: Build and Push to AWS ECR
- Click **Add Step** > Search for **Build and Push to ECR** (or **Build and Push an image to Docker Registry**).
- **Name:** `Push to ECR`
- **Docker Connector:** `aws-ecr-registry` (or select AWS Connector)
- **Region:** `us-east-1` (your ECR region)
- **Account Id:** `<AWS_ACCOUNT_ID>`
- **Image Name:** `express-harness-demo`
- **Tags:**
  ```text
  <+pipeline.sequenceId>
  latest
  ```
- **Dockerfile:** `Dockerfile`
- **Context:** `.`

7. Click **Save** in the top right.

---

## 7. Harness Pipeline as Code (YAML Definition)

Instead of manually clicking through every step, Harness allows you to switch to the **YAML Editor** tab (top right of the Pipeline Studio) and paste the complete declarative pipeline definition.

Below is the complete `pipeline.yaml`:

```yaml
pipeline:
  name: express-ci-pipeline
  identifier: express_ci_pipeline
  projectIdentifier: express_harness_ci
  orgIdentifier: default
  tags: {}
  stages:
    - stage:
        name: Build Test and Security
        identifier: Build_Test_and_Security
        description: Runs Jest tests, Sonar scan, Black Duck SCA, and pushes to AWS ECR
        type: CI
        spec:
          cloneCodebase: true
          infrastructure:
            type: Cloud
            spec:
              type: Linux
              size: M
              arch: Amd64
          execution:
            steps:
              - step:
                  type: Run
                  name: Run Tests and Generate Coverage
                  identifier: Run_Tests
                  spec:
                    connectorRef: account.harnessImage
                    image: node:20-alpine
                    shell: Sh
                    command: |-
                      echo "Installing dependencies..."
                      npm ci
                      echo "Running test suite with LCOV coverage..."
                      npm test
                    reports:
                      type: JUnit
                      spec:
                        paths:
                          - "coverage/lcov.info"

              - step:
                  type: Run
                  name: SonarQube / SonarCloud Code Analysis
                  identifier: Sonar_Scan
                  spec:
                    connectorRef: account.harnessImage
                    image: sonarsource/sonar-scanner-cli:latest
                    shell: Sh
                    envVariables:
                      SONAR_TOKEN: <+secrets.getValue("sonar_token")>
                      SONAR_HOST_URL: https://sonarcloud.io
                    command: |-
                      sonar-scanner \
                        -Dsonar.token="$SONAR_TOKEN" \
                        -Dsonar.host.url="$SONAR_HOST_URL" \
                        -Dsonar.projectKey=express-harness-demo \
                        -Dsonar.sources=src \
                        -Dsonar.tests=src/tests \
                        -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info

              - step:
                  type: Run
                  name: Synopsys Black Duck SCA Scan
                  identifier: Black_Duck_Scan
                  spec:
                    connectorRef: account.harnessImage
                    image: openjdk:17-slim
                    shell: Bash
                    envVariables:
                      BLACKDUCK_URL: <+secrets.getValue("blackduck_url")>
                      BLACKDUCK_API_TOKEN: <+secrets.getValue("blackduck_token")>
                    command: |-
                      apt-get update && apt-get install -y curl bash
                      bash <(curl -s -L https://detect.synopsys.com/detect9.sh) \
                        --blackduck.url="$BLACKDUCK_URL" \
                        --blackduck.api.token="$BLACKDUCK_API_TOKEN" \
                        --detect.project.name="express-harness-demo" \
                        --detect.project.version.name="1.0.<+pipeline.sequenceId>" \
                        --detect.tools=DETECTOR \
                        --detect.detector.search.depth=2 \
                        --detect.npm.include.dev.dependencies=false \
                        --blackduck.trust.cert=true

              - step:
                  type: BuildAndPushECR
                  name: Build and Push Docker Image to ECR
                  identifier: Push_To_ECR
                  spec:
                    connectorRef: aws_ecr_connector
                    region: us-east-1
                    account: "<AWS_ACCOUNT_ID>"
                    imageName: express-harness-demo
                    tags:
                      - "<+pipeline.sequenceId>"
                      - latest
                    dockerfile: Dockerfile
                    context: .
```

---

## 8. Execution, Verification & Troubleshooting

### 8.1 How to Trigger the Pipeline
1. In Harness CI, click **Run** (top right corner).
2. Select your Git branch (e.g., `main` or `master`).
3. Click **Run Pipeline**.
4. Alternatively, configure a **Git Trigger**:
   - Go to **Pipelines** > `express-ci-pipeline` > **Triggers** tab > **+ Add Trigger**.
   - Connector: `github-repo-connector`.
   - Event: `Push` on branch `main`.

---

### 8.2 Verification Checklist
After the pipeline completes with green status:

1. **Verify Unit & Integration Tests in Harness:**
   - Click the `Run Tests` step in the execution view.
   - Inspect the logs to confirm all test suites in `src/tests/items.test.js` passed with 100% success.
   - Confirm coverage table displays line and branch coverage.

2. **Verify Sonar Quality Gate:**
   - Log into SonarCloud or SonarQube.
   - Open project `express-harness-demo`.
   - Confirm:
     - 0 Bugs, 0 Vulnerabilities, 0 Security Hotspots.
     - Code Coverage > 80%.
     - Quality Gate status: **Passed**.

3. **Verify Black Duck SCA Bill of Materials:**
   - Open your Synopsys Black Duck dashboard.
   - Navigate to **Projects** > `express-harness-demo` > Version `1.0.<build_number>`.
   - Verify the Bill of Materials (BOM) contains identified components (`express`, `sqlite3`, etc.) with zero critical policy violations.

4. **Verify Image in Amazon ECR:**
   - Open AWS Management Console > **Amazon ECR** > **Repositories** > `express-harness-demo`.
   - Confirm two new image tags appear:
     - Tag: `<pipeline.sequenceId>` (e.g., `1`, `2`)
     - Tag: `latest`
   - Review the AWS Basic / Enhanced Vulnerability scan findings column.

---

### 8.3 Troubleshooting Common Issues

| Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| **`ecr:GetAuthorizationToken` AccessDenied** | The IAM credentials configured in the AWS connector lack global ECR authorization permissions. | Ensure the IAM policy contains `"Action": "ecr:GetAuthorizationToken"` with `"Resource": "*"`. |
| **Sonar fails with "No coverage report found"** | The path in `sonar.javascript.lcov.reportPaths` does not match the Jest output directory. | Verify `jest.config.js` sets `coverageDirectory: 'coverage'` and `sonar-project.properties` specifies `coverage/lcov.info`. |
| **Black Duck Detect fails: "Detect run failed"** | Running Detect in Alpine Linux images lacks `glibc` or Java runtime. | Use `openjdk:17-slim` (Debian-based) for the Detect step as configured in the YAML. |
| **Database connection error in CI** | Database file attempted to be written to read-only directory. | Use `process.env.NODE_ENV === 'test' ? ':memory:' : ...` in `src/db/db.js` so tests execute in-memory. |
| **Harness Step Timeout** | Downloading large images or slow dependency installs. | Enable Harness Cache Intelligence or use slim Alpine/distroless base images. |
