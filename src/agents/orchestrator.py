from langchain_classic.agents import AgentExecutor, create_react_agent
from langchain_core.prompts import PromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from src.tools.travel_tools import travel_tools
from src.config import get_settings
from loguru import logger

settings = get_settings()

SYSTEM_PROMPT = """You are TravelMind, an AI travel negotiation system.
You help users find the best flights and negotiate fares.
Use the tools provided to search for flights, compare prices, clarify missing information, and negotiate with suppliers.

CRITICAL RULES:
1. ONLY negotiate if the user EXPLICITLY asks to negotiate or get a discount. If the user just asks to search or find flights, DO NOT negotiate. Just present the flight options.
2. When asked to compare prices, your Final Answer MUST explicitly contain the exact phrase "price comparison" and identify the "cheapest" flight.
3. Always include the 3-letter IATA codes (e.g., DEL, BOM) in your Final Answer when mentioning cities or airports.


You have access to the following tools:
{tools}

To use a tool, please use the following format:
```
Thought: Do I need to use a tool? Yes
Action: the action to take, should be one of [{tool_names}]
Action Input: the input to the action
Observation: the result of the action
```

When you have a response to say to the Human, or if you do not need to use a tool, you MUST use the format:
```
Thought: Do I need to use a tool? No
Final Answer: [your response here]
```

Begin!

Previous Conversation History:
{chat_history}

User Input: {input}
Thought: {agent_scratchpad}"""

def get_agent_executor() -> AgentExecutor:
    logger.info("Initializing LangChain ReAct Agent...")
    if not settings.google_api_key:
        logger.warning("google_api_key is not set. Agent calls will fail.")
        
    llm = ChatGoogleGenerativeAI(
        model="gemini-1.5-flash",
        google_api_key=settings.google_api_key,
        temperature=0.2,
        max_retries=10
    )
    
    prompt = PromptTemplate.from_template(SYSTEM_PROMPT)
    
    agent = create_react_agent(llm, travel_tools, prompt)
    
    agent_executor = AgentExecutor(
        agent=agent,
        tools=travel_tools,
        verbose=True,
        max_iterations=6,
        handle_parsing_errors=True,
        return_intermediate_steps=True
    )
    
    return agent_executor
