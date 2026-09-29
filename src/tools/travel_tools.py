from typing import Type, Optional
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field
from src.rag.pipeline import pipeline

class FareSearchInput(BaseModel):
    query: str = Field(description="The natural language query describing the flight search (e.g. 'flights from DEL to BOM next week')")

class FareSearchTool(BaseTool):
    name: str = "fare_search"
    description: str = "Search for flights matching a query. Returns a list of available flights with details."
    args_schema: Type[BaseModel] = FareSearchInput
    
    def _run(self, query: str) -> str:
        retriever = pipeline.get_retriever(search_kwargs={"k": 5})
        docs = retriever.invoke(query)
        if not docs:
            return "No flights found matching your query."
        
        results = []
        for d in docs:
            metadata = d.metadata
            flight_info = (
                f"[{metadata.get('supplier')}] {metadata.get('airline_name')} {metadata.get('flight_number')} "
                f"| {metadata.get('origin_iata')} -> {metadata.get('destination_iata')} "
                f"| {metadata.get('cabin_class')} | INR {metadata.get('total_fare_inr')} "
                f"| Negotiable: {metadata.get('negotiable')}"
            )
            results.append(flight_info)
            
        return "Found the following flights:\n" + "\n".join(results)
        
    async def _arun(self, query: str) -> str:
        return self._run(query)

class PriceCompareInput(BaseModel):
    query: str = Field(description="The flight search query to compare prices for")

class PriceCompareTool(BaseTool):
    name: str = "price_compare"
    description: str = "Retrieves top 15 flights for a query and sorts them by price from cheapest to most expensive."
    args_schema: Type[BaseModel] = PriceCompareInput
    
    def _run(self, query: str) -> str:
        retriever = pipeline.get_retriever(search_kwargs={"k": 15})
        docs = retriever.invoke(query)
        if not docs:
            return "No flights found to compare."
            
        # Sort by total_fare_inr
        sorted_docs = sorted(docs, key=lambda x: x.metadata.get("total_fare_inr", 999999))
        
        results = []
        for i, d in enumerate(sorted_docs):
            metadata = d.metadata
            flight_info = (
                f"{i+1}. INR {metadata.get('total_fare_inr')} - {metadata.get('airline_name')} "
                f"({metadata.get('supplier')}) {metadata.get('origin_iata')}->{metadata.get('destination_iata')}"
            )
            results.append(flight_info)
            
        return "Price comparison (cheapest first):\n" + "\n".join(results)
        
    async def _arun(self, query: str) -> str:
        return self._run(query)

class NegotiateInput(BaseModel):
    query: str = Field(description="A comma-separated string containing flight_number, supplier, and target_price (e.g. '6E201,SupplierC,4500')")

class NegotiateTool(BaseTool):
    name: str = "negotiate_fare"
    description: str = "Attempts to negotiate a better fare for a specific flight. Input MUST be exactly a comma-separated string: flight_number, supplier, target_price"
    args_schema: Type[BaseModel] = NegotiateInput
    
    def _run(self, query: str = "", flight_number: str = "", supplier: str = "", target_price: int = 0) -> str:
        if query:
            try:
                parts = [p.strip() for p in query.split(",")]
                flight_number = parts[0]
                supplier = parts[1]
                target_price = int(parts[2])
            except Exception:
                return "Error: Input must be a comma-separated string: flight_number, supplier, target_price"

        # Rule-based negotiation simulation
        if "SupplierB" in supplier:
            return f"Negotiation failed. {supplier} (LCC) fares are non-negotiable."
            
        if target_price < 2000:
            return f"Negotiation rejected. INR {target_price} is too low for {flight_number} with {supplier}."
            
        return f"Negotiation successful! {supplier} accepted the offer of INR {target_price} for flight {flight_number}."
        
    async def _arun(self, query: str = "", flight_number: str = "", supplier: str = "", target_price: int = 0) -> str:
        return self._run(query=query, flight_number=flight_number, supplier=supplier, target_price=target_price)

class ClarifyInput(BaseModel):
    missing_info: str = Field(description="The information that is missing and needs to be asked to the user.")

class ClarifyTool(BaseTool):
    name: str = "clarify_intent"
    description: str = "Ask the user a question to clarify their search intent (e.g. asking for origin, destination, or date)."
    args_schema: Type[BaseModel] = ClarifyInput
    return_direct: bool = True
    
    def _run(self, missing_info: str) -> str:
        return missing_info
        
    async def _arun(self, missing_info: str) -> str:
        return self._run(missing_info)

# List of all tools to be bound to the agent
travel_tools = [FareSearchTool(), PriceCompareTool(), NegotiateTool(), ClarifyTool()]
