from langchain_chroma import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings
from loguru import logger
from src.config import get_settings

settings = get_settings()

class RAGPipeline:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(RAGPipeline, cls).__new__(cls)
            cls._instance.vectorstore = None
        return cls._instance
        
    def initialize(self):
        if self.vectorstore is not None:
            return
            
        logger.info("Loading RAG pipeline and embeddings...")
        embeddings = HuggingFaceEmbeddings(
            model_name="BAAI/bge-m3",
            model_kwargs={'device': 'cpu'},
            encode_kwargs={'normalize_embeddings': True}
        )
        
        self.vectorstore = Chroma(
            persist_directory=settings.chroma_db_dir,
            embedding_function=embeddings
        )
        logger.info("RAG pipeline initialized.")
        
    def get_retriever(self, search_kwargs={"k": 5}):
        if self.vectorstore is None:
            self.initialize()
        return self.vectorstore.as_retriever(
            search_type="mmr",
            search_kwargs=search_kwargs
        )

# Global instance for easy access
pipeline = RAGPipeline()
