# Quick RAG Reference

## 🚀 5-Minute Setup

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Set API key in .env
echo "ANTHROPIC_API_KEY=your-key-here" >> .env

# 3. Start server
python app.py
```

---

## 💬 Common API Calls

### Calculate Lease (Auto-embeds in RAG)

```bash
curl -X POST "http://localhost:8000/api/calculate" \
  -H "Content-Type: application/json" \
  -d '{
    "lease_id": "LEASE-2024-001",
    "company_id": "COMPANY-ABC-001",
    "asset_description": "Office Space",
    "commencement_date": "2024-01-01",
    "lease_term_months": 36,
    "monthly_payment": 50000,
    "annual_discount_rate": 0.085
  }'
```

### Ask Question

```bash
curl -X POST "http://localhost:8000/api/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "company_id": "COMPANY-ABC-001",
    "question": "What is the total lease liability?",
    "document_type": "lease"
  }'
```

### Get Stats

```bash
curl "http://localhost:8000/api/rag/stats/COMPANY-ABC-001"
```

---

## 🐍 Python Usage

### Embed Document

```python
from rag_engine import IFRSRagEngine

rag = IFRSRagEngine()
rag.embed_and_store(
    company_id="COMPANY-ABC-001",
    document_type="lease",
    content={"lease_id": "L001", "liability": 1000000},
    document_id="L001"
)
```

### Ask Question

```python
answer = rag.ask_with_context(
    company_id="COMPANY-ABC-001",
    question="What is the total lease liability?"
)
print(answer['answer'])
```

### Retrieve Context

```python
contexts = rag.retrieve_context(
    company_id="COMPANY-ABC-001",
    query="lease liability",
    top_k=5
)
```

---

## 🔐 Security: Company Isolation

✅ **CRITICAL**: Every query is filtered by `company_id`  
✅ Company A can NEVER see Company B's data  
✅ Test isolation: `python test_rag_isolation.py`

---

## 📊 Document Types

- `lease` - IFRS 16 lease calculations (auto-indexed)
- `variance` - Variance analysis
- `contract` - Revenue contracts (IFRS 15)
- `revenue` - Revenue recognition
- `ecl` - Expected credit loss (IFRS 9)

---

## 🧪 Testing

```bash
# Test isolation
python test_rag_isolation.py

# Test workflow
python example_rag_usage.py

# API docs
# http://localhost:8000/api/docs
```

---

## 💡 Example Questions

```
✅ "What is the total lease liability?"
✅ "Which leases have payments over ₹50,000?"
✅ "Show me the Mumbai office lease details"
✅ "What is the Year 1 P&L impact?"
✅ "Compare all office leases"
```

---

## ⚡ Quick Troubleshooting

**Model not loading?**
```bash
python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
```

**ChromaDB errors?**
```bash
rm -rf chroma_db/
python app.py
```

**Claude API errors?**
- Check `.env` file has `ANTHROPIC_API_KEY`
- Restart server

---

## 📚 Full Documentation

- [RAG_README.md](RAG_README.md) - Complete guide
- [RAG_IMPLEMENTATION_COMPLETE.md](RAG_IMPLEMENTATION_COMPLETE.md) - Implementation details
- API Docs: http://localhost:8000/api/docs

---

**Need Help?** Run: `python example_rag_usage.py`
