# Deployment Guide

Complete deployment instructions for IFRS 16 Automation platform.

## 🚀 Deployment Options

### 1. Local Development

**Quick Start:**

```bash
# Windows
start.bat

# Linux/Mac
chmod +x start.sh
./start.sh
```

**Manual Start:**

```bash
# Activate virtual environment
source venv/bin/activate  # Linux/Mac
venv\Scripts\activate  # Windows

# Start server
python app.py

# Or with uvicorn
uvicorn app:app --reload --port 8000
```

Access at: http://localhost:9000/api/docs

---

### 2. Docker Deployment

**Single Container:**

```bash
# Build image
docker build -t ifrs16-automation .

# Run container
docker run -d \
  -p 8000:8000 \
  -e ANTHROPIC_API_KEY=your-key-here \
  -v $(pwd)/uploads:/app/uploads \
  -v $(pwd)/outputs:/app/outputs \
  --name ifrs16-api \
  ifrs16-automation
```

**Docker Compose:**

```bash
# Start all services (API + PostgreSQL)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

---

### 3. AWS Deployment

#### Option A: AWS Elastic Beanstalk

1. **Install EB CLI:**

```bash
pip install awsebcli
```

2. **Initialize EB:**

```bash
eb init -p python-3.11 ifrs16-automation --region ap-south-1
```

3. **Create environment:**

```bash
eb create ifrs16-prod --instance-type t3.medium
```

4. **Set environment variables:**

```bash
eb setenv ANTHROPIC_API_KEY=your-key-here
```

5. **Deploy:**

```bash
eb deploy
```

#### Option B: AWS ECS (Fargate)

1. **Push image to ECR:**

```bash
# Login to ECR
aws ecr get-login-password --region ap-south-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-south-1.amazonaws.com

# Create repository
aws ecr create-repository --repository-name ifrs16-automation

# Tag and push
docker tag ifrs16-automation:latest <account-id>.dkr.ecr.ap-south-1.amazonaws.com/ifrs16-automation:latest
docker push <account-id>.dkr.ecr.ap-south-1.amazonaws.com/ifrs16-automation:latest
```

2. **Create ECS Task Definition:**

```json
{
  "family": "ifrs16-task",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "ifrs16-container",
      "image": "<account-id>.dkr.ecr.ap-south-1.amazonaws.com/ifrs16-automation:latest",
      "portMappings": [
        {
          "containerPort": 8000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "ANTHROPIC_API_KEY",
          "value": "your-key-here"
        }
      ]
    }
  ]
}
```

3. **Create ECS Service:**

```bash
aws ecs create-service \
  --cluster ifrs16-cluster \
  --service-name ifrs16-service \
  --task-definition ifrs16-task \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}"
```

---

### 4. Azure Deployment

#### Azure App Service

1. **Login to Azure:**

```bash
az login
```

2. **Create resource group:**

```bash
az group create --name ifrs16-rg --location centralindia
```

3. **Create App Service plan:**

```bash
az appservice plan create \
  --name ifrs16-plan \
  --resource-group ifrs16-rg \
  --sku B1 \
  --is-linux
```

4. **Create web app:**

```bash
az webapp create \
  --resource-group ifrs16-rg \
  --plan ifrs16-plan \
  --name ifrs16-automation \
  --runtime "PYTHON:3.11"
```

5. **Configure environment:**

```bash
az webapp config appsettings set \
  --resource-group ifrs16-rg \
  --name ifrs16-automation \
  --settings ANTHROPIC_API_KEY=your-key-here
```

6. **Deploy:**

```bash
az webapp up --name ifrs16-automation --resource-group ifrs16-rg
```

---

### 5. Google Cloud Platform

#### Cloud Run

1. **Build and push to GCR:**

```bash
# Configure Docker
gcloud auth configure-docker

# Build
gcloud builds submit --tag gcr.io/your-project/ifrs16-automation

# Or with Docker
docker build -t gcr.io/your-project/ifrs16-automation .
docker push gcr.io/your-project/ifrs16-automation
```

2. **Deploy to Cloud Run:**

```bash
gcloud run deploy ifrs16-automation \
  --image gcr.io/your-project/ifrs16-automation \
  --platform managed \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars ANTHROPIC_API_KEY=your-key-here \
  --memory 1Gi \
  --cpu 1 \
  --max-instances 10
```

---

### 6. Heroku Deployment

1. **Login:**

```bash
heroku login
```

2. **Create app:**

```bash
heroku create ifrs16-automation
```

3. **Set environment variables:**

```bash
heroku config:set ANTHROPIC_API_KEY=your-key-here
```

4. **Deploy:**

```bash
git push heroku main
```

5. **Scale:**

```bash
heroku ps:scale web=1:standard-1x
```

---

## 🔒 Security Configuration

### Environment Variables

**Required:**
- `ANTHROPIC_API_KEY` - Claude API key

**Optional:**
- `DATABASE_URL` - PostgreSQL connection string
- `APP_ENV` - Environment (development/production)
- `MAX_UPLOAD_SIZE_MB` - Max file upload size
- `ALLOWED_ORIGINS` - CORS allowed origins

### SSL/TLS

**For production, always use HTTPS:**

#### AWS ALB:
```bash
# Create certificate in ACM
aws acm request-certificate \
  --domain-name api.yourdomain.com \
  --validation-method DNS
```

#### Let's Encrypt (self-hosted):
```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d api.yourdomain.com
```

---

## 📊 Monitoring & Logging

### Health Checks

```bash
# Basic health check
curl https://api.yourdomain.com/api/health

# Expected response
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00",
  "anthropic_configured": true
}
```

### Logging

**Application logs:**

```python
# In app.py
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('app.log'),
        logging.StreamHandler()
    ]
)
```

**Cloud logging:**

- **AWS CloudWatch**: Automatic with Elastic Beanstalk/ECS
- **Azure Monitor**: Built-in with App Service
- **GCP Cloud Logging**: Automatic with Cloud Run

---

## 🔄 CI/CD Pipeline

### GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Set up Python
      uses: actions/setup-python@v4
      with:
        python-version: '3.11'
    
    - name: Install dependencies
      run: pip install -r requirements.txt
    
    - name: Run tests
      run: pytest tests/
    
    - name: Build Docker image
      run: docker build -t ifrs16-automation .
    
    - name: Deploy to AWS
      uses: aws-actions/amazon-ecs-deploy-task-definition@v1
      with:
        task-definition: task-definition.json
        service: ifrs16-service
        cluster: ifrs16-cluster
```

---

## 🗄️ Database Setup

### PostgreSQL

**Local:**

```bash
# Install PostgreSQL
sudo apt-get install postgresql

# Create database
sudo -u postgres createdb ifrs_db

# Create user
sudo -u postgres createuser ifrs_user

# Grant privileges
sudo -u postgres psql
GRANT ALL PRIVILEGES ON DATABASE ifrs_db TO ifrs_user;
```

**Cloud:**

- **AWS RDS**: Use RDS PostgreSQL instance
- **Azure Database**: Azure Database for PostgreSQL
- **GCP Cloud SQL**: Cloud SQL for PostgreSQL

**Connection string:**

```
postgresql://username:password@hostname:5432/database_name
```

---

## ⚡ Performance Optimization

### Caching

Add Redis for caching:

```yaml
# docker-compose.yml
redis:
  image: redis:alpine
  ports:
    - "6379:6379"
```

### Load Balancing

- **AWS**: Use Application Load Balancer (ALB)
- **Azure**: Use Azure Load Balancer
- **GCP**: Use Cloud Load Balancing
- **Self-hosted**: Use Nginx

### Auto-scaling

```bash
# AWS ECS
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/ifrs16-cluster/ifrs16-service \
  --min-capacity 2 \
  --max-capacity 10
```

---

## 🔍 Troubleshooting

### Common Issues

**1. API not responding:**
```bash
# Check logs
docker logs ifrs16-api

# Check port
netstat -tuln | grep 8000
```

**2. Database connection failed:**
```bash
# Test connection
psql postgresql://user:pass@host:5432/db

# Check environment variable
echo $DATABASE_URL
```

**3. Out of memory:**
```bash
# Increase container memory
docker run --memory="2g" ifrs16-automation
```

---

## 📝 Production Checklist

- [ ] Environment variables configured
- [ ] SSL/TLS certificate installed
- [ ] Database backups configured
- [ ] Monitoring and alerts set up
- [ ] Rate limiting enabled
- [ ] CORS configured properly
- [ ] Logs being collected
- [ ] Health checks passing
- [ ] Load testing completed
- [ ] Disaster recovery plan documented

---

## 🆘 Support

For deployment assistance:
- 📧 Email: devops@ifrsai.com
- 💬 Slack: #deployment channel
- 📖 Docs: https://docs.ifrsai.com/deployment

---

**Happy Deploying! 🚀**
