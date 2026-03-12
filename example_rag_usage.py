"""
Example: Using RAG with IFRS Platform
Demonstrates embedding, retrieval, and question answering
"""

from datetime import datetime
from decimal import Decimal
import json

from ifrs16_calculator import IFRS16Calculator, LeaseInput
from rag_engine import IFRSRagEngine


def example_rag_workflow():
    """
    Complete RAG workflow example:
    1. Calculate IFRS 16 lease
    2. Embed results in vector database
    3. Retrieve relevant context
    4. Ask questions using Claude API
    """
    
    print("="*70)
    print("IFRS RAG WORKFLOW EXAMPLE")
    print("="*70)
    
    # Initialize RAG engine
    print("\n📦 Step 1: Initialize RAG Engine")
    rag = IFRSRagEngine()
    print("✅ RAG engine initialized")
    
    # Calculate IFRS 16 lease
    print("\n🧮 Step 2: Calculate IFRS 16 Lease")
    
    lease = LeaseInput(
        lease_id="LEASE-2024-001",
        asset_description="Commercial Office Space - Mumbai - 5,000 sq ft",
        lessee_name="TechCorp India Pvt. Ltd.",
        lessor_name="Prime Properties Ltd.",
        commencement_date=datetime(2024, 1, 1),
        lease_term_months=36,
        monthly_payment=Decimal('50000'),
        annual_discount_rate=Decimal('0.085'),
        initial_direct_costs=Decimal('40000'),
        currency="INR"
    )
    
    calculator = IFRS16Calculator()
    results = calculator.calculate_full_ifrs16(lease)
    
    print(f"Lease Liability: ₹{results['lease_liability']:,.2f}")
    print(f"ROU Asset: ₹{results['rou_asset']:,.2f}")
    print(f"Monthly Depreciation: ₹{results['monthly_depreciation']:,.2f}")
    
    # Prepare data for embedding
    print("\n💾 Step 3: Embed Lease Data in Vector Database")
    
    embed_content = {
        "lease_id": lease.lease_id,
        "asset_description": lease.asset_description,
        "lessee_name": lease.lessee_name,
        "lessor_name": lease.lessor_name,
        "commencement_date": lease.commencement_date.isoformat(),
        "lease_term_months": lease.lease_term_months,
        "monthly_payment": float(lease.monthly_payment),
        "annual_discount_rate": float(lease.annual_discount_rate),
        "currency": lease.currency,
        "lease_liability": float(results['lease_liability']),
        "rou_asset": float(results['rou_asset']),
        "monthly_depreciation": float(results['monthly_depreciation']),
        "total_interest": float(results['total_interest']),
        "year_1_impact": {
            "interest_expense": float(results['year_1_impact']['interest_expense']),
            "depreciation_expense": float(results['year_1_impact']['depreciation_expense']),
            "total_p_l_expense": float(results['year_1_impact']['total_p_l_expense']),
            "ebitda_improvement": float(results['year_1_impact']['ebitda_improvement'])
        }
    }
    
    # Store in RAG
    result = rag.embed_and_store(
        company_id="COMPANY-TECHCORP",
        document_type="lease",
        content=embed_content,
        document_id=lease.lease_id
    )
    
    print(f"Status: {result['status']}")
    print(f"Chunks stored: {result.get('chunks_stored', 0)}")
    print(f"Document ID: {result['document_id']}")
    
    # Add a second lease for better examples
    print("\n🧮 Step 4: Add Second Lease")
    
    lease2 = LeaseInput(
        lease_id="LEASE-2024-002",
        asset_description="Warehouse - Delhi - 10,000 sq ft",
        lessee_name="TechCorp India Pvt. Ltd.",
        lessor_name="Industrial Realty Corp.",
        commencement_date=datetime(2024, 2, 1),
        lease_term_months=60,
        monthly_payment=Decimal('80000'),
        annual_discount_rate=Decimal('0.09'),
        initial_direct_costs=Decimal('60000'),
        currency="INR"
    )
    
    results2 = calculator.calculate_full_ifrs16(lease2)
    
    embed_content2 = {
        "lease_id": lease2.lease_id,
        "asset_description": lease2.asset_description,
        "lessee_name": lease2.lessee_name,
        "commencement_date": lease2.commencement_date.isoformat(),
        "lease_term_months": lease2.lease_term_months,
        "monthly_payment": float(lease2.monthly_payment),
        "lease_liability": float(results2['lease_liability']),
        "rou_asset": float(results2['rou_asset'])
    }
    
    rag.embed_and_store(
        company_id="COMPANY-TECHCORP",
        document_type="lease",
        content=embed_content2,
        document_id=lease2.lease_id
    )
    print(f"Second lease embedded: {lease2.lease_id}")
    
    # Retrieve context examples
    print("\n🔍 Step 5: Retrieve Relevant Context")
    
    queries = [
        "What is the lease liability?",
        "Which office location has the Mumbai lease?",
        "What is the total depreciation expense?"
    ]
    
    for query in queries:
        print(f"\n   Query: '{query}'")
        contexts = rag.retrieve_context(
            company_id="COMPANY-TECHCORP",
            query=query,
            document_type="lease",
            top_k=2
        )
        print(f"   Retrieved {len(contexts)} contexts:")
        for i, ctx in enumerate(contexts):
            preview = ctx['text'][:100].replace('\n', ' ')
            print(f"   [{i+1}] {preview}...")
    
    # Ask questions with Claude API
    print("\n💬 Step 6: Ask Questions with Claude API")
    
    questions = [
        "What is the total lease liability across all leases?",
        "Which lease has the higher ROU asset and by how much?",
        "What is the Year 1 P&L impact for the Mumbai office lease?",
        "List all leased locations and their monthly payments"
    ]
    
    for question in questions:
        print(f"\n   Question: {question}")
        answer = rag.ask_with_context(
            company_id="COMPANY-TECHCORP",
            question=question,
            document_type="lease"
        )
        
        if answer['status'] == 'success':
            print(f"   Answer: {answer['answer']}")
            print(f"   Sources used: {answer['context_count']}")
        else:
            print(f"   ⚠️  Error: {answer.get('error', 'Unknown')}")
    
    # Get company stats
    print("\n📊 Step 7: Company Statistics")
    stats = rag.get_company_stats("COMPANY-TECHCORP")
    print(f"Total documents: {stats['total_documents']}")
    print(f"Total chunks: {stats['total_chunks']}")
    print(f"Document types: {json.dumps(stats['document_types'], indent=2)}")
    
    # Cleanup (optional)
    print("\n🧹 Step 8: Cleanup (Optional)")
    print("Deleting test documents...")
    rag.delete_document("COMPANY-TECHCORP", "LEASE-2024-001")
    rag.delete_document("COMPANY-TECHCORP", "LEASE-2024-002")
    print("✅ Cleanup complete")
    
    print("\n" + "="*70)
    print("✅ RAG WORKFLOW COMPLETE")
    print("="*70)
    print("\nKey Features Demonstrated:")
    print("✅ Automatic embedding of IFRS calculations")
    print("✅ Semantic search across documents")
    print("✅ Context-aware question answering")
    print("✅ Company-level data isolation")
    print("✅ Multi-document aggregation")


def example_api_usage():
    """
    Example API calls for RAG endpoints
    """
    print("\n" + "="*70)
    print("API USAGE EXAMPLES")
    print("="*70)
    
    print("\n1. Calculate lease (auto-embeds in RAG):")
    print("""
curl -X POST "http://localhost:8000/api/calculate" \\
  -H "Content-Type: application/json" \\
  -d '{
    "lease_id": "LEASE-2024-001",
    "company_id": "COMPANY-ABC-001",
    "asset_description": "Office Space",
    "commencement_date": "2024-01-01",
    "lease_term_months": 36,
    "monthly_payment": 50000,
    "annual_discount_rate": 0.085,
    "currency": "INR"
  }'
""")
    
    print("\n2. Chat with RAG:")
    print("""
curl -X POST "http://localhost:8000/api/chat" \\
  -H "Content-Type: application/json" \\
  -d '{
    "company_id": "COMPANY-ABC-001",
    "question": "What is the total lease liability?",
    "document_type": "lease",
    "top_k": 5
  }'
""")
    
    print("\n3. Get company stats:")
    print("""
curl -X GET "http://localhost:8000/api/rag/stats/COMPANY-ABC-001"
""")
    
    print("\n4. Delete document from RAG:")
    print("""
curl -X DELETE "http://localhost:8000/api/rag/document/COMPANY-ABC-001/LEASE-2024-001"
""")


if __name__ == "__main__":
    try:
        # Run workflow example
        example_rag_workflow()
        
        # Show API examples
        example_api_usage()
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

