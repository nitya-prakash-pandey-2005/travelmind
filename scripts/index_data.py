import json
import os
import sys
from pathlib import Path
from loguru import logger

# Add src to python path so we can import normalizer
sys.path.append(str(Path(__file__).parent.parent))

from src.data_processing.normalizer import normalize_records
from langchain_chroma import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_core.documents import Document

def main():
    processed_dir = Path("data/processed")
    fares_path = processed_dir / "fares.json"
    chroma_path = Path("data/chroma_db")
    
    if not fares_path.exists():
        logger.error(f"{fares_path} does not exist. Run build_supplier_records.py first.")
        return
        
    with open(fares_path, "r") as f:
        raw_records = json.load(f)
        
    logger.info(f"Loaded {len(raw_records)} raw records.")
    
    # 1. Normalize
    normalized = normalize_records(raw_records)
    logger.info(f"Normalized {len(normalized)} records.")
    
    # 2. Prepare LangChain Documents
    documents = []
    for record in normalized:
        metadata = {
            "record_id": record.record_id,
            "supplier": record.supplier,
            "flight_number": record.flight_number,
            "airline_name": record.airline_name,
            "origin_iata": record.origin_iata,
            "destination_iata": record.destination_iata,
            "total_fare_inr": record.total_fare_inr,
            "cabin_class": record.cabin_class,
            "negotiable": record.negotiable
        }
        doc = Document(page_content=record.embedding_text, metadata=metadata)
        documents.append(doc)
        
    # 3. Embed and Index
    logger.info("Initializing HuggingFaceEmbeddings (BAAI/bge-m3)...")
    embeddings = HuggingFaceEmbeddings(
        model_name="BAAI/bge-m3",
        model_kwargs={'device': 'cpu'},  # Change to 'cuda' if GPU available
        encode_kwargs={'normalize_embeddings': True}
    )
    
    logger.info("Creating ChromaDB index...")
    # Clean up existing DB if necessary, or just add
    if chroma_path.exists():
        logger.warning(f"{chroma_path} exists, creating a new vector store might add duplicates if not handled.")
    
    vectorstore = Chroma.from_documents(
        documents=documents, 
        embedding=embeddings,
        persist_directory=str(chroma_path)
    )
    
    logger.info(f"Successfully indexed {len(documents)} records into ChromaDB at {chroma_path}")

if __name__ == "__main__":
    main()
