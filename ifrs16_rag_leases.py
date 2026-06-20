"""IFRS 16 lease contract RAG — dedicated ChromaDB collection ifrs16_leases."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from rag_engine import IFRSRagEngine
from claude_model_config import CLAUDE_MODEL


LEASE_COLLECTION = "ifrs16_leases"
LEASE_SYSTEM_PROMPT = (
    "You are an IFRS 16 lease accounting assistant. Answer questions only from the "
    "provided lease data. Be specific about lease names, dates, and amounts."
)


def _lease_collection(engine: IFRSRagEngine):
    return engine.chroma_client.get_or_create_collection(
        name=LEASE_COLLECTION,
        metadata={"description": "IFRS 16 indexed lease contracts"},
    )


def index_lease(
    engine: IFRSRagEngine,
    lease_id: str,
    contract_text: str,
    metadata: Dict[str, Any],
    company_id: str = "default",
) -> Dict[str, Any]:
    """Index lease contract text into ifrs16_leases collection."""
    if not contract_text or not str(contract_text).strip():
        contract_text = _metadata_to_text(metadata)

    chunks = engine._dict_to_text_chunks(
        {"contract": contract_text, **{k: v for k, v in metadata.items() if v is not None}}
    )
    if not chunks:
        return {"indexed": False, "lease_id": lease_id, "error": "No content to index"}

    embeddings = engine.embedding_model.encode(chunks, convert_to_tensor=False, show_progress_bar=False).tolist()
    created_at = datetime.now().isoformat()
    coll = _lease_collection(engine)

    # Remove prior chunks for this lease
    try:
        existing = coll.get(where={"lease_id": lease_id, "company_id": company_id})
        if existing and existing.get("ids"):
            coll.delete(ids=existing["ids"])
    except Exception:
        pass

    chunk_ids = [f"{lease_id}_chunk_{i}" for i in range(len(chunks))]
    metadatas = [
        {
            "company_id": company_id,
            "lease_id": lease_id,
            "document_type": "lease",
            "chunk_index": i,
            "created_at": created_at,
            "property_name": str(metadata.get("property_name") or metadata.get("asset_description") or ""),
            "start_date": str(metadata.get("start_date") or metadata.get("commencement_date") or ""),
            "end_date": str(metadata.get("end_date") or ""),
            "monthly_payment": str(metadata.get("monthly_payment") or ""),
            "currency": str(metadata.get("currency") or ""),
            "ibr": str(metadata.get("ibr") or metadata.get("annual_discount_rate") or ""),
            "tenant_name": str(metadata.get("tenant_name") or metadata.get("lessee_name") or ""),
        }
        for i in range(len(chunks))
    ]
    coll.add(ids=chunk_ids, embeddings=embeddings, documents=chunks, metadatas=metadatas)
    return {"indexed": True, "lease_id": lease_id, "chunks": len(chunks)}


def search_leases(
    engine: IFRSRagEngine,
    query: str,
    company_id: str = "default",
    top_k: int = 5,
) -> Dict[str, Any]:
    """Search leases and answer with Claude."""
    if not engine.anthropic_client:
        return {"answer": "Anthropic API key not configured.", "sources": []}

    coll = _lease_collection(engine)
    query_embedding = engine.embedding_model.encode(
        query, convert_to_tensor=False, show_progress_bar=False
    ).tolist()

    try:
        results = coll.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            where={"company_id": company_id},
        )
    except Exception:
        results = coll.query(query_embeddings=[query_embedding], n_results=top_k)

    contexts: List[Dict[str, Any]] = []
    source_ids: List[str] = []
    if results.get("documents") and results["documents"][0]:
        for i, doc in enumerate(results["documents"][0]):
            meta = results["metadatas"][0][i] if results.get("metadatas") else {}
            contexts.append({"text": doc, "metadata": meta})
            lid = meta.get("lease_id") or meta.get("property_name")
            if lid and lid not in source_ids:
                source_ids.append(str(lid))

    if not contexts:
        return {
            "answer": "No indexed lease contracts found. Calculate or index leases first.",
            "sources": [],
        }

    context_text = "\n\n---\n\n".join(
        f"Lease {i + 1}:\n{ctx['text']}" for i, ctx in enumerate(contexts)
    )
    prompt = f"""{LEASE_SYSTEM_PROMPT}

Lease data:
{context_text}

Question: {query}

Answer:"""

    response = engine.anthropic_client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2000,
        temperature=0.2,
        messages=[{"role": "user", "content": prompt}],
    )
    answer = response.content[0].text
    return {"answer": answer, "sources": source_ids}


def _metadata_to_text(metadata: Dict[str, Any]) -> str:
    parts = [f"{k}: {v}" for k, v in metadata.items() if v not in (None, "", 0)]
    return "\n".join(parts) if parts else "Lease record"
