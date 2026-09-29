from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Dict, List
from src.rag.pipeline import pipeline
from src.agents.orchestrator import get_agent_executor
from src.tools.travel_tools import NegotiateTool
from loguru import logger

app = FastAPI(title="TravelMind API", description="Production-grade AI travel negotiation system", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SearchRequest(BaseModel):
    query: str

class AgentRequest(BaseModel):
    query: str
    chat_history: str = ""

class NegotiateRequest(BaseModel):
    flight_number: str
    supplier: str
    target_price: int

@app.on_event("startup")
async def startup_event():
    logger.info("Application starting up, initializing RAG pipeline...")
    pipeline.initialize()
    logger.info("Startup complete.")

@app.get("/health")
def health_check():
    return {"status": "ok", "vectorstore_loaded": pipeline.vectorstore is not None}

@app.post("/search")
async def search_flights(req: SearchRequest):
    logger.info(f"RAG fast path search for: {req.query}")
    retriever = pipeline.get_retriever()
    docs = retriever.invoke(req.query)
    
    results = []
    for d in docs:
        results.append({
            "content": d.page_content,
            "metadata": d.metadata
        })
    return {"results": results}

@app.post("/agent")
async def agent_query(req: AgentRequest):
    logger.info(f"Agent full reasoning path for: {req.query}")
    agent_executor = get_agent_executor()
    
    try:
        response = agent_executor.invoke({"input": req.query, "chat_history": req.chat_history})
        
        # Format intermediate steps for observability
        steps = []
        for action, observation in response.get("intermediate_steps", []):
            steps.append({
                "tool": action.tool,
                "input": action.tool_input,
                "log": action.log,
                "observation": str(observation)
            })
            
        return {
            "output": response.get("output"),
            "steps": steps
        }
    except Exception as e:
        logger.error(f"Agent execution failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/negotiate")
async def negotiate_fare(req: NegotiateRequest):
    logger.info(f"Direct negotiation for flight {req.flight_number} with {req.supplier} for INR {req.target_price}")
    tool = NegotiateTool()
    result = tool._run(flight_number=req.flight_number, supplier=req.supplier, target_price=req.target_price)
    return {"result": result}
