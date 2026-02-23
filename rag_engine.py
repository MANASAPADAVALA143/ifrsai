"""
IFRS RAG Engine - Retrieval-Augmented Generation for IFRS Data
Company-isolated vector database for intelligent document retrieval
"""

import os
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path

import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
from anthropic import Anthropic


class IFRSRagEngine:
    """
    RAG engine for IFRS documents with company-level data isolation
    
    Features:
    - Embed and store IFRS calculations, contracts, and variances
    - Retrieve relevant context filtered by company_id
    - Answer questions using Claude API with context
    - CRITICAL: Company data isolation to prevent cross-company data leaks
    """
    
    def __init__(
        self,
        anthropic_api_key: Optional[str] = None,
        chroma_persist_dir: str = "./chroma_db",
        embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    ):
        """
        Initialize RAG engine
        
        Args:
            anthropic_api_key: Claude API key (defaults to env variable)
            chroma_persist_dir: Directory to persist ChromaDB
            embedding_model: Sentence transformer model name
        """
        # Initialize ChromaDB client
        self.chroma_persist_dir = Path(chroma_persist_dir)
        self.chroma_persist_dir.mkdir(exist_ok=True)
        
        self.chroma_client = chromadb.PersistentClient(
            path=str(self.chroma_persist_dir),
            settings=Settings(
                anonymized_telemetry=False,
                allow_reset=True
            )
        )
        
        # Get or create collection
        self.collection = self.chroma_client.get_or_create_collection(
            name="ifrs_documents",
            metadata={"description": "IFRS calculations, contracts, and documents"}
        )
        
        # Initialize embedding model
        print(f"Loading embedding model: {embedding_model}...")
        self.embedding_model = SentenceTransformer(embedding_model)
        print("✅ Embedding model loaded successfully")
        
        # Initialize Anthropic client
        self.anthropic_api_key = anthropic_api_key or os.getenv("ANTHROPIC_API_KEY")
        if self.anthropic_api_key:
            self.anthropic_client = Anthropic(api_key=self.anthropic_api_key)
        else:
            self.anthropic_client = None
            print("⚠️  Warning: ANTHROPIC_API_KEY not set. ask_with_context() will not work.")
    
    def _dict_to_text_chunks(
        self,
        content: Dict[str, Any],
        chunk_size: int = 500,
        overlap: int = 50
    ) -> List[str]:
        """
        Convert content dictionary to text chunks for embedding
        
        Args:
            content: Dictionary containing IFRS data
            chunk_size: Maximum characters per chunk
            overlap: Character overlap between chunks
            
        Returns:
            List of text chunks
        """
        # Convert dict to formatted text
        def format_value(key: str, value: Any, indent: int = 0) -> str:
            prefix = "  " * indent
            if isinstance(value, dict):
                lines = [f"{prefix}{key}:"]
                for k, v in value.items():
                    lines.append(format_value(k, v, indent + 1))
                return "\n".join(lines)
            elif isinstance(value, list):
                lines = [f"{prefix}{key}:"]
                for i, item in enumerate(value):
                    if isinstance(item, dict):
                        lines.append(f"{prefix}  Item {i+1}:")
                        for k, v in item.items():
                            lines.append(format_value(k, v, indent + 2))
                    else:
                        lines.append(f"{prefix}  - {item}")
                return "\n".join(lines)
            else:
                return f"{prefix}{key}: {value}"
        
        # Build full text
        full_text = "\n".join([format_value(k, v) for k, v in content.items()])
        
        # Split into chunks with overlap
        chunks = []
        start = 0
        while start < len(full_text):
            end = start + chunk_size
            chunk = full_text[start:end]
            
            # Try to break at newline
            if end < len(full_text):
                last_newline = chunk.rfind('\n')
                if last_newline > chunk_size // 2:
                    chunk = chunk[:last_newline]
                    end = start + last_newline + 1
            
            chunks.append(chunk.strip())
            start = end - overlap
        
        return chunks
    
    def embed_and_store(
        self,
        company_id: str,
        document_type: str,
        content: Dict[str, Any],
        document_id: str
    ) -> Dict[str, Any]:
        """
        Embed content and store in ChromaDB with company isolation
        
        Args:
            company_id: Company identifier (CRITICAL for data isolation)
            document_type: Type of document ("lease", "variance", "contract", "revenue", "ecl")
            content: Dictionary containing document data
            document_id: Unique document identifier
            
        Returns:
            Dictionary with storage status and metadata
        """
        try:
            # Convert content to text chunks
            chunks = self._dict_to_text_chunks(content)
            
            if not chunks:
                raise ValueError("No text chunks generated from content")
            
            # Generate embeddings
            embeddings = self.embedding_model.encode(
                chunks,
                convert_to_tensor=False,
                show_progress_bar=False
            ).tolist()
            
            # Prepare metadata for each chunk
            created_at = datetime.now().isoformat()
            chunk_ids = [f"{document_id}_chunk_{i}" for i in range(len(chunks))]
            
            metadatas = [
                {
                    "company_id": company_id,
                    "document_type": document_type,
                    "document_id": document_id,
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                    "created_at": created_at
                }
                for i in range(len(chunks))
            ]
            
            # Store in ChromaDB
            self.collection.add(
                ids=chunk_ids,
                embeddings=embeddings,
                documents=chunks,
                metadatas=metadatas
            )
            
            return {
                "status": "success",
                "company_id": company_id,
                "document_id": document_id,
                "document_type": document_type,
                "chunks_stored": len(chunks),
                "created_at": created_at
            }
            
        except Exception as e:
            return {
                "status": "error",
                "error": str(e),
                "company_id": company_id,
                "document_id": document_id
            }
    
    def retrieve_context(
        self,
        company_id: str,
        query: str,
        document_type: Optional[str] = None,
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Retrieve relevant context filtered by company_id
        
        CRITICAL: Always filters by company_id to ensure data isolation
        
        Args:
            company_id: Company identifier (REQUIRED for isolation)
            query: Search query
            document_type: Optional filter by document type
            top_k: Number of results to return
            
        Returns:
            List of relevant text chunks with metadata
        """
        try:
            # Generate query embedding
            query_embedding = self.embedding_model.encode(
                query,
                convert_to_tensor=False,
                show_progress_bar=False
            ).tolist()
            
            # Build where filter - CRITICAL: Always include company_id
            where_filter = {"company_id": company_id}
            if document_type:
                where_filter["document_type"] = document_type
            
            # Query ChromaDB with company filter
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=top_k,
                where=where_filter
            )
            
            # Format results
            retrieved_contexts = []
            if results['documents'] and results['documents'][0]:
                for i, doc in enumerate(results['documents'][0]):
                    retrieved_contexts.append({
                        "text": doc,
                        "metadata": results['metadatas'][0][i],
                        "distance": results['distances'][0][i] if 'distances' in results else None
                    })
            
            return retrieved_contexts
            
        except Exception as e:
            print(f"Error retrieving context: {e}")
            return []
    
    def ask_with_context(
        self,
        company_id: str,
        question: str,
        document_type: Optional[str] = None,
        top_k: int = 5
    ) -> Dict[str, Any]:
        """
        Answer question using Claude API with retrieved context
        
        Args:
            company_id: Company identifier
            question: User question
            document_type: Optional filter by document type
            top_k: Number of context chunks to retrieve
            
        Returns:
            Dictionary with answer and sources
        """
        if not self.anthropic_client:
            return {
                "status": "error",
                "error": "Anthropic API key not configured"
            }
        
        try:
            # Retrieve relevant context
            contexts = self.retrieve_context(
                company_id=company_id,
                query=question,
                document_type=document_type,
                top_k=top_k
            )
            
            if not contexts:
                return {
                    "status": "success",
                    "answer": "I couldn't find any relevant information in your documents to answer this question.",
                    "sources": []
                }
            
            # Build context text
            context_text = "\n\n---\n\n".join([
                f"Document {i+1} (from {ctx['metadata']['document_type']}):\n{ctx['text']}"
                for i, ctx in enumerate(contexts)
            ])
            
            # Build prompt
            prompt = f"""You are an IFRS accounting expert assistant. Answer the user's question based ONLY on the provided context from their company's documents.

Context from company documents:
{context_text}

User question: {question}

Instructions:
- Answer based ONLY on the provided context
- If the context doesn't contain relevant information, say so clearly
- Cite specific numbers and details from the context
- Be precise and professional
- If asked about calculations, explain the methodology

Answer:"""

            # Call Claude API
            response = self.anthropic_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2000,
                temperature=0.3,
                messages=[{
                    "role": "user",
                    "content": prompt
                }]
            )
            
            answer = response.content[0].text
            
            # Prepare sources
            sources = [
                {
                    "document_id": ctx['metadata']['document_id'],
                    "document_type": ctx['metadata']['document_type'],
                    "chunk_index": ctx['metadata']['chunk_index'],
                    "text_preview": ctx['text'][:200] + "..." if len(ctx['text']) > 200 else ctx['text']
                }
                for ctx in contexts
            ]
            
            return {
                "status": "success",
                "answer": answer,
                "sources": sources,
                "context_count": len(contexts)
            }
            
        except Exception as e:
            return {
                "status": "error",
                "error": str(e)
            }
    
    def get_company_stats(self, company_id: str) -> Dict[str, Any]:
        """
        Get statistics about stored documents for a company
        
        Args:
            company_id: Company identifier
            
        Returns:
            Dictionary with document counts by type
        """
        try:
            # Query all documents for this company
            results = self.collection.get(
                where={"company_id": company_id}
            )
            
            if not results['metadatas']:
                return {
                    "company_id": company_id,
                    "total_chunks": 0,
                    "document_types": {}
                }
            
            # Count by document type
            type_counts = {}
            document_ids = set()
            
            for metadata in results['metadatas']:
                doc_type = metadata.get('document_type', 'unknown')
                type_counts[doc_type] = type_counts.get(doc_type, 0) + 1
                document_ids.add(metadata.get('document_id'))
            
            return {
                "company_id": company_id,
                "total_chunks": len(results['metadatas']),
                "total_documents": len(document_ids),
                "document_types": type_counts
            }
            
        except Exception as e:
            return {
                "company_id": company_id,
                "error": str(e)
            }
    
    def delete_document(self, company_id: str, document_id: str) -> Dict[str, Any]:
        """
        Delete a document and all its chunks
        
        Args:
            company_id: Company identifier (for verification)
            document_id: Document identifier
            
        Returns:
            Deletion status
        """
        try:
            # Get all chunks for this document
            results = self.collection.get(
                where={
                    "company_id": company_id,
                    "document_id": document_id
                }
            )
            
            if not results['ids']:
                return {
                    "status": "success",
                    "message": "No chunks found for this document",
                    "deleted_count": 0
                }
            
            # Delete all chunks
            self.collection.delete(ids=results['ids'])
            
            return {
                "status": "success",
                "deleted_count": len(results['ids']),
                "document_id": document_id
            }
            
        except Exception as e:
            return {
                "status": "error",
                "error": str(e)
            }


# Example usage
if __name__ == "__main__":
    # Initialize RAG engine
    rag = IFRSRagEngine()
    
    # Example: Store IFRS 16 calculation
    sample_lease_data = {
        "lease_id": "LEASE-2024-001",
        "asset_description": "Commercial Office Space - 5,000 sq ft",
        "commencement_date": "2024-01-01",
        "lease_term_months": 36,
        "monthly_payment": 50000,
        "lease_liability": 1628405.23,
        "rou_asset": 1668405.23,
        "year_1_impact": {
            "interest_expense": 68934.12,
            "depreciation_expense": 556135.08,
            "total_p_l_expense": 625069.20
        }
    }
    
    # Store document
    result = rag.embed_and_store(
        company_id="COMP-ABC-001",
        document_type="lease",
        content=sample_lease_data,
        document_id="LEASE-2024-001"
    )
    print(f"\n📦 Storage result: {result}")
    
    # Retrieve context
    contexts = rag.retrieve_context(
        company_id="COMP-ABC-001",
        query="What is the lease liability?",
        document_type="lease",
        top_k=3
    )
    print(f"\n🔍 Retrieved {len(contexts)} contexts")
    
    # Ask question with context
    answer = rag.ask_with_context(
        company_id="COMP-ABC-001",
        question="What is the total lease liability and ROU asset for LEASE-2024-001?",
        document_type="lease"
    )
    print(f"\n💬 Answer: {answer.get('answer', 'No answer')}")
    
    # Get company stats
    stats = rag.get_company_stats("COMP-ABC-001")
    print(f"\n📊 Company stats: {stats}")
