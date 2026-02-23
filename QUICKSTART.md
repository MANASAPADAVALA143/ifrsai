# ⚡ Quick Start Guide - IFRS 16 Automation

**Get up and running in 5 minutes!**

---

## 🎯 What You'll Accomplish

By the end of this guide, you'll:
- ✅ Install the IFRS 16 automation platform
- ✅ Run your first lease calculation
- ✅ Generate a professional Excel report
- ✅ Extract terms from a contract using AI
- ✅ Start the REST API server

---

## 📋 Prerequisites

```bash
# Check Python version (need 3.11+)
python --version

# Should show: Python 3.11.x or higher
```

**Don't have Python 3.11?** Download from: https://www.python.org/downloads/

---

## 🚀 Step 1: Setup (2 minutes)

### Windows:

```cmd
# Double-click start.bat
# Or run in terminal:
start.bat
```

### Linux/Mac:

```bash
chmod +x start.sh
./start.sh
```

**What this does:**
- Creates virtual environment
- Installs all dependencies
- Starts the API server

---

## 🧮 Step 2: First Calculation (1 minute)

Create a file `my_first_lease.py`:

```python
from ifrs16_calculator import IFRS16Calculator, LeaseInput
from ifrs16_excel_export import IFRS16ExcelExporter
from datetime import datetime
from decimal import Decimal

# Define your lease
lease = LeaseInput(
    lease_id="LEASE-2024-001",
    asset_description="Office Space - 5,000 sq ft",
    commencement_date=datetime(2024, 1, 1),
    lease_term_months=36,
    monthly_payment=Decimal('50000'),
    annual_discount_rate=Decimal('0.085'),  # 8.5%
    currency="INR"
)

# Calculate
calc = IFRS16Calculator()
results = calc.calculate_full_ifrs16(lease)

# Show results
print(f"✅ Lease Liability: ₹{results['lease_liability']:,.2f}")
print(f"✅ ROU Asset: ₹{results['rou_asset']:,.2f}")
print(f"✅ Year 1 P&L: ₹{results['year_1_impact']['total_p_l_expense']:,.2f}")

# Export to Excel
exporter = IFRS16ExcelExporter()
exporter.export_ifrs16_workbook(results, "outputs/my_report.xlsx")
print(f"✅ Excel report: outputs/my_report.xlsx")
```

**Run it:**

```bash
python my_first_lease.py
```

**Expected Output:**

```
✅ Lease Liability: ₹1,628,405.23
✅ ROU Asset: ₹1,628,405.23
✅ Year 1 P&L: ₹625,069.20
✅ Excel report: outputs/my_report.xlsx
```

---

## 🤖 Step 3: AI Extraction (1 minute)

**Setup Claude API:**

1. Get API key from: https://console.anthropic.com/
2. Create `.env` file:

```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

**Extract from contract:**

```python
from ifrs16_extractor import IFRS16LeaseExtractor
import os

# Initialize
extractor = IFRS16LeaseExtractor(api_key=os.getenv('ANTHROPIC_API_KEY'))

# Sample contract text
contract = """
LEASE AGREEMENT
Lessor: ABC Properties
Lessee: XYZ Corp
Start: 2024-01-01
Term: 36 months
Rent: ₹50,000/month
"""

# Extract
data = extractor.extract_lease_terms(contract)
print(f"✅ Extracted {len(data)} fields")
print(f"✅ Confidence: {data['validation']['overall_confidence']['value']}%")
```

---

## 🌐 Step 4: Start API Server (1 minute)

```bash
python app.py
```

**Visit:**
- API Docs: http://localhost:8000/api/docs
- Health Check: http://localhost:8000/api/health

**Test with curl:**

```bash
curl http://localhost:8000/api/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00",
  "anthropic_configured": true
}
```

---

## 📊 Step 5: Generate Your First Report

**Using the API:**

```bash
curl -X POST "http://localhost:8000/api/calculate" \
  -H "Content-Type: application/json" \
  -d '{
    "lease_id": "LEASE-2024-001",
    "asset_description": "Office Space",
    "commencement_date": "2024-01-01",
    "lease_term_months": 36,
    "monthly_payment": 50000,
    "annual_discount_rate": 0.085,
    "currency": "INR"
  }'
```

**Download Excel:**

```bash
# Get file_id from calculate response
curl http://localhost:8000/api/download/{file_id} -o report.xlsx
```

---

## 🎓 Example Scenarios

### Scenario 1: Simple Office Lease

```python
lease = LeaseInput(
    lease_id="OFF-001",
    asset_description="Office - 3,000 sq ft",
    commencement_date=datetime(2024, 1, 1),
    lease_term_months=24,
    monthly_payment=Decimal('35000'),
    annual_discount_rate=Decimal('0.08'),
    currency="INR"
)
```

### Scenario 2: Warehouse with Escalation

```python
lease = LeaseInput(
    lease_id="WH-001",
    asset_description="Warehouse - 10,000 sq ft",
    commencement_date=datetime(2024, 1, 1),
    lease_term_months=60,
    monthly_payment=Decimal('100000'),
    annual_discount_rate=Decimal('0.09'),
    escalation_rate=Decimal('0.05'),  # 5% annual increase
    initial_direct_costs=Decimal('75000'),
    currency="INR"
)
```

### Scenario 3: Equipment Lease

```python
lease = LeaseInput(
    lease_id="EQ-001",
    asset_description="Manufacturing Equipment",
    commencement_date=datetime(2024, 1, 1),
    lease_term_months=48,
    monthly_payment=Decimal('25000'),
    annual_discount_rate=Decimal('0.10'),
    currency="INR"
)
```

---

## 📁 Where Are My Files?

```
IFRSAI/
├── outputs/          ← Excel reports here
├── uploads/          ← Uploaded contracts here
└── my_first_lease.py ← Your script
```

---

## 🎯 Common Commands

```bash
# Run examples
python example_usage.py

# Start API
python app.py

# Calculate lease
python my_first_lease.py

# Check health
curl http://localhost:8000/api/health
```

---

## ❓ Troubleshooting

### "Python not found"

**Solution:**
```bash
# Install Python 3.11+ from python.org
# Restart terminal after installation
```

### "Module not found"

**Solution:**
```bash
# Activate virtual environment
venv\Scripts\activate  # Windows
source venv/bin/activate  # Linux/Mac

# Reinstall dependencies
pip install -r requirements.txt
```

### "API key not configured"

**Solution:**
```bash
# Create .env file
echo "ANTHROPIC_API_KEY=your-key" > .env

# Get key from: https://console.anthropic.com/
```

### "Port 8000 already in use"

**Solution:**
```bash
# Change port in app.py
# Or kill existing process
# Windows: netstat -ano | findstr :8000
# Linux: lsof -i :8000
```

---

## 🎉 Success!

You now have:
- ✅ Working IFRS 16 calculator
- ✅ Excel report generator
- ✅ REST API running
- ✅ AI contract extraction

---

## 📚 Next Steps

### Learn More:
1. **Full Documentation**: [README.md](README.md)
2. **Complete Examples**: Run `python example_usage.py`
3. **API Reference**: http://localhost:8000/api/docs
4. **Deployment Guide**: [DEPLOYMENT.md](DEPLOYMENT.md)

### Try Advanced Features:
- Batch processing (multiple leases)
- PDF contract upload
- Scenario analysis
- Custom discount rates

### Go to Production:
- Deploy to AWS/Azure/GCP
- Set up database
- Configure authentication
- Add monitoring

---

## 💬 Need Help?

- 📖 **Docs**: [README.md](README.md)
- 💻 **Examples**: `example_usage.py`
- 📧 **Email**: support@ifrsai.com
- 💬 **Community**: community.ifrsai.com

---

## 🚀 Ready for Production?

**Contact us for:**
- Enterprise licenses
- Custom integrations
- Professional support
- Training sessions

📧 enterprise@ifrsai.com  
📞 +91-XXXX-XXXXXX

---

**Happy Calculating! 🎊**

*Built with ❤️ for Finance Teams*
