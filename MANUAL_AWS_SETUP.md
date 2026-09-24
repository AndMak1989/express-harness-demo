# Manual AWS Setup Guide: Automated ECR to EC2 Deployment

Follow these manual steps directly in the [AWS Management Console](https://console.aws.amazon.com) in region **`us-east-1`**.

---

## Step 1: Create IAM Role for EC2 (`EC2-ECR-SSM-DeploymentRole`)

1. Go to **IAM Console** > **Roles** > click **Create role**.
2. **Trusted entity type:** Select **AWS service**.
3. **Use case:** Select **EC2** > click **Next**.
4. **Permissions:** Search and check the boxes for:
   - ✅ `AmazonSSMManagedInstanceCore`
   - ✅ `AmazonEC2ContainerRegistryReadOnly`
5. Click **Next**.
6. **Role name:** `EC2-ECR-SSM-DeploymentRole`
7. Click **Create role**.

---

## Step 2: Launch the EC2 Instance

1. Go to **EC2 Console** (in `us-east-1`) > click **Launch instance**.
2. **Name:** `express-docker-host`
3. **AMI:** `Amazon Linux 2023 AMI` (Free Tier eligible).
4. **Instance type:** `t2.micro` or `t3.micro` (Free Tier eligible).
5. **Key pair:** Select **Proceed without a key pair** (you will use AWS Session Manager instead of SSH).
6. **Network settings** > click **Edit**:
   - Check **Allow HTTP traffic from the internet** (Port 80).
   - Click **Add security group rule**:
     - **Type:** Custom TCP
     - **Port range:** `3000`
     - **Source:** Anywhere (`0.0.0.0/0`)
     - **Description:** `Express REST API`
7. **Advanced details** (scroll to the bottom):
   - **IAM instance profile:** Select **`EC2-ECR-SSM-DeploymentRole`**.
   - **User data** (paste this script to install Docker on launch):
     ```bash
     #!/bin/bash
     dnf update -y
     dnf install -y docker
     systemctl start docker
     systemctl enable docker
     usermod -aG docker ec2-user
     ```
8. Click **Launch instance**.
9. Wait 1–2 minutes until the instance shows **Running** with **2/2 checks passed**.
10. Note your **Public IPv4 address** (e.g. `54.210.xx.xx`) and **Instance ID** (e.g. `i-0123456789abcdef0`).

---

## Step 3: Run the Container Manually Once (Sanity Check)

1. In the EC2 Console, select `express-docker-host` > click **Connect**.
2. Select the **Session Manager** tab > click **Connect** (opens a terminal in your browser).
3. Paste the following commands:
   ```bash
   sudo su -
   
   export AWS_ACCOUNT_ID="123806350293"
   export AWS_REGION="us-east-1"
   export IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/express-harness-demo:latest"

   # 1. Login to ECR
   aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

   # 2. Pull image
   docker pull ${IMAGE_URI}

   # 3. Start container
   docker run -d --restart unless-stopped -p 3000:3000 --name express-app ${IMAGE_URI}

   # 4. Check status
   docker ps
   ```
4. Open your browser to:
   ```text
   http://<YOUR_EC2_PUBLIC_IP>:3000/health
   ```
   You will see: `{"status": "UP", "service": "express-harness-demo"}`.

---

## Step 4: Automate Deployment with AWS EventBridge & Systems Manager

### 4.1 Create the EventBridge Rule
1. Open the [Amazon EventBridge Console](https://console.aws.amazon.com/events) in `us-east-1`.
2. In the left menu, click **Rules** > click **Create rule**.
3. **Name:** `ECR-To-EC2-AutoDeploy`
4. **Rule type:** `Rule with an event pattern` > click **Next**.
5. Under **Event pattern**, select:
   - **Event source:** `AWS services`
   - **AWS service:** `Elastic Container Registry (ECR)`
   - **Event type:** `ECR Image Action`
   - In the **Event pattern JSON** box, paste:
     ```json
     {
       "source": ["aws.ecr"],
       "detail-type": ["ECR Image Action"],
       "detail": {
         "action-type": ["PUSH"],
         "result": ["SUCCESS"],
         "repository-name": ["express-harness-demo"],
         "image-tag": ["latest"]
       }
     }
     ```
6. Click **Next**.

### 4.2 Set Systems Manager as Target
1. **Target types:** Select **AWS service**.
2. **Select a target:** Choose **Systems Manager Run Command**.
3. **Document:** Select **`AWS-RunShellScript`**.
4. **Target selection:** Select **Choose instances manually** > check your EC2 instance `express-docker-host`.
5. Under **Commands**, paste:
   ```bash
   #!/bin/bash
   set -e
   export AWS_ACCOUNT_ID="123806350293"
   export AWS_REGION="us-east-1"
   export IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/express-harness-demo:latest"

   # Authenticate with ECR
   aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

   # Pull latest image
   docker pull ${IMAGE_URI}

   # Stop and replace old container
   docker stop express-app || true
   docker rm express-app || true

   # Run updated container
   docker run -d --restart unless-stopped -p 3000:3000 --name express-app ${IMAGE_URI}

   # Clean up dangling images
   docker image prune -f
   ```
6. **Execution role:** Select **Create a new role for this specific resource**.
7. Click **Next** > **Next** > click **Create rule**.

---

## Step 5: Test the Complete Automated Flow!

1. Make a small code change in your project and push to GitHub:
   ```bash
   git commit -am "test: automatic deploy to EC2"
   git push origin master
   ```
2. **Harness CI** will automatically run your tests, build the Docker container, and push `latest` to **Amazon ECR**.
3. **AWS EventBridge** catches the push and instructs **Systems Manager** to update EC2.
4. Refresh `http://<YOUR_EC2_PUBLIC_IP>:3000/health` — your new code is live!
