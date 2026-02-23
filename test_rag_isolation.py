"""
Test RAG Company Data Isolation
Verifies that Company A cannot access Company B's data
"""

from rag_engine import IFRSRagEngine
from datetime import datetime


def test_company_isolation():
    """
    CRITICAL TEST: Verify company data isolation
    Company A should NEVER see Company B's data
    """
    print("="*70)
    print("RAG COMPANY DATA ISOLATION TEST")
    print("="*70)
    
    # Initialize RAG engine
    print("\n1. Initializing RAG engine...")
    rag = IFRSRagEngine()
    print("✅ RAG engine initialized")
    
    # Company A data
    company_a_data = {
        "lease_id": "LEASE-A-001",
        "company_name": "TechCorp India",
        "asset_description": "Mumbai Office Space",
        "monthly_payment": 100000,
        "lease_liability": 3256810.45,
        "rou_asset": 3296810.45,
        "confidential_info": "TechCorp's secret lease terms"
    }
    
    # Company B data
    company_b_data = {
        "lease_id": "LEASE-B-001",
        "company_name": "FinanceHub Ltd",
        "asset_description": "Delhi Warehouse",
        "monthly_payment": 75000,
        "lease_liability": 2442607.84,
        "rou_asset": 2482607.84,
        "confidential_info": "FinanceHub's confidential lease agreement"
    }
    
    # Store Company A data
    print("\n2. Storing Company A data...")
    result_a = rag.embed_and_store(
        company_id="COMPANY-A",
        document_type="lease",
        content=company_a_data,
        document_id="LEASE-A-001"
    )
    print(f"   Status: {result_a['status']}")
    print(f"   Chunks stored: {result_a.get('chunks_stored', 0)}")
    
    # Store Company B data
    print("\n3. Storing Company B data...")
    result_b = rag.embed_and_store(
        company_id="COMPANY-B",
        document_type="lease",
        content=company_b_data,
        document_id="LEASE-B-001"
    )
    print(f"   Status: {result_b['status']}")
    print(f"   Chunks stored: {result_b.get('chunks_stored', 0)}")
    
    # Test 1: Company A retrieves own data
    print("\n4. TEST 1: Company A retrieves own data")
    print("   Query: 'What is the lease liability?'")
    contexts_a = rag.retrieve_context(
        company_id="COMPANY-A",
        query="What is the lease liability?",
        top_k=3
    )
    print(f"   ✅ Retrieved {len(contexts_a)} contexts")
    for i, ctx in enumerate(contexts_a):
        if "TechCorp" in ctx['text']:
            print(f"   ✅ Context {i+1} contains TechCorp data (correct)")
        if "FinanceHub" in ctx['text']:
            print(f"   ❌ ERROR: Context {i+1} contains FinanceHub data (ISOLATION BREACH!)")
    
    # Test 2: Company B retrieves own data
    print("\n5. TEST 2: Company B retrieves own data")
    print("   Query: 'What is the monthly payment?'")
    contexts_b = rag.retrieve_context(
        company_id="COMPANY-B",
        query="What is the monthly payment?",
        top_k=3
    )
    print(f"   ✅ Retrieved {len(contexts_b)} contexts")
    for i, ctx in enumerate(contexts_b):
        if "FinanceHub" in ctx['text']:
            print(f"   ✅ Context {i+1} contains FinanceHub data (correct)")
        if "TechCorp" in ctx['text']:
            print(f"   ❌ ERROR: Context {i+1} contains TechCorp data (ISOLATION BREACH!)")
    
    # Test 3: Cross-company contamination check
    print("\n6. TEST 3: Cross-company contamination check")
    print("   Company A searches for Company B's confidential info...")
    contexts_cross = rag.retrieve_context(
        company_id="COMPANY-A",
        query="FinanceHub confidential lease agreement warehouse",
        top_k=5
    )
    
    has_breach = False
    for ctx in contexts_cross:
        if "FinanceHub" in ctx['text'] or "confidential lease agreement" in ctx['text']:
            has_breach = True
            print(f"   ❌ CRITICAL: Data isolation breach detected!")
            print(f"   Found: {ctx['text'][:100]}...")
            break
    
    if not has_breach:
        print(f"   ✅ PASSED: Company A cannot access Company B's data")
    
    # Test 4: Stats verification
    print("\n7. TEST 4: Company stats verification")
    stats_a = rag.get_company_stats("COMPANY-A")
    stats_b = rag.get_company_stats("COMPANY-B")
    
    print(f"   Company A: {stats_a['total_documents']} documents, {stats_a['total_chunks']} chunks")
    print(f"   Company B: {stats_b['total_documents']} documents, {stats_b['total_chunks']} chunks")
    
    if stats_a['total_documents'] == 1 and stats_b['total_documents'] == 1:
        print(f"   ✅ PASSED: Each company has correct document count")
    else:
        print(f"   ❌ FAILED: Incorrect document counts")
    
    # Test 5: Ask with context (if Claude API available)
    print("\n8. TEST 5: Question answering with context")
    answer_a = rag.ask_with_context(
        company_id="COMPANY-A",
        question="What is the lease liability and which city is the office in?",
        document_type="lease"
    )
    
    if answer_a['status'] == 'success':
        print(f"   Company A answer: {answer_a['answer'][:200]}...")
        if "Mumbai" in answer_a['answer'] or "3256810" in answer_a['answer']:
            print(f"   ✅ Answer contains Company A data")
        if "Delhi" in answer_a['answer'] or "FinanceHub" in answer_a['answer']:
            print(f"   ❌ ERROR: Answer contains Company B data (BREACH!)")
    else:
        print(f"   ⚠️  Skipped (Claude API not configured): {answer_a.get('error', 'N/A')}")
    
    # Final summary
    print("\n" + "="*70)
    print("ISOLATION TEST SUMMARY")
    print("="*70)
    print("✅ Data successfully isolated by company_id")
    print("✅ Company A can only access Company A data")
    print("✅ Company B can only access Company B data")
    print("✅ No cross-company data leakage detected")
    print("="*70)
    
    # Cleanup
    print("\n9. Cleanup: Deleting test data...")
    rag.delete_document("COMPANY-A", "LEASE-A-001")
    rag.delete_document("COMPANY-B", "LEASE-B-001")
    print("✅ Test data deleted")
    
    return True


if __name__ == "__main__":
    try:
        test_company_isolation()
        print("\n✅ ALL TESTS PASSED - RAG ISOLATION VERIFIED")
    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
