import sys
import time
from pathlib import Path
from loguru import logger
from rich.console import Console
from rich.table import Table

sys.path.append(str(Path(__file__).parent.parent.parent))

from src.rag.pipeline import pipeline
from src.agents.orchestrator import get_agent_executor
from src.config import get_settings

console = Console()
settings = get_settings()

TEST_QUERIES = [
    {
        "type": "search",
        "query": "Find the cheapest IndiGo flight from Delhi to Mumbai.",
        "expected_keywords": ["IndiGo", "DEL", "BOM"]
    },
    {
        "type": "negotiate",
        "query": "Negotiate fare for flight AI501 with SupplierC for 15000 INR.",
        "expected_keywords": ["SupplierC", "AI501"]
    },
    {
        "type": "clarify",
        "query": "I want to fly tomorrow.",
        "expected_keywords": ["ask", "where", "origin"]
    },
    {
        "type": "compare",
        "query": "Compare prices for flights from Bengaluru to Hyderabad.",
        "expected_keywords": ["price comparison", "cheapest"]
    },
    {
        "type": "edge_case",
        "query": "Negotiate an LCC flight with SupplierB.",
        "expected_keywords": ["failed", "non-negotiable", "SupplierB"]
    }
]

def run_evaluations():
    pipeline.initialize()
    agent_executor = get_agent_executor()
    
    table = Table(title="TravelMind Agent Evaluation Results")
    table.add_column("Query Type", style="cyan")
    table.add_column("Query", style="magenta")
    table.add_column("Status", style="green")
    table.add_column("Latency (s)", justify="right")
    table.add_column("Hit Rate (Keywords)", justify="center")
    
    for test in TEST_QUERIES:
        start_time = time.time()
        try:
            # Check if API key is not configured, we simulate or just fail gracefully
            if not settings.google_api_key:
                logger.warning("No API key, skipping real LLM call.")
                table.add_row(test["type"], test["query"], "[yellow]SKIPPED", "0.0", "N/A")
                continue
                
            max_attempts = 5
            response = None
            for attempt in range(max_attempts):
                try:
                    response = agent_executor.invoke({
                        "input": test["query"],
                        "chat_history": ""
                    })
                    break
                except Exception as e:
                    error_str = str(e).lower()
                    if ("429" in error_str or "resource_exhausted" in error_str or "quota" in error_str) and attempt < max_attempts - 1:
                        logger.warning(f"Rate limit hit! Waiting 60 seconds before retrying (Attempt {attempt+1}/{max_attempts})...")
                        time.sleep(60)
                    else:
                        raise e
            
            latency = time.time() - start_time
            
            output = response.get("output", "").lower() if response else ""
            
            hits = sum(1 for kw in test["expected_keywords"] if kw.lower() in output)
            hit_rate = f"{hits}/{len(test['expected_keywords'])}"
            
            status = "[green]PASS" if hits > 0 else "[red]FAIL"
            
            table.add_row(test["type"], test["query"], status, f"{latency:.2f}", hit_rate)
            
        except Exception as e:
            logger.error(f"Eval failed for query '{test['query']}': {e}")
            table.add_row(test["type"], test["query"], "[red]ERROR", f"{time.time() - start_time:.2f}", "0")
            
        # Removed sleep as we switched to gemini-1.5-flash
            
    console.print(table)

if __name__ == "__main__":
    run_evaluations()
